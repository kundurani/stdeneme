require("dotenv").config();
const header = require("../header");
const sslfix = require("./sslfix");
const cheerio = require("cheerio");
const Axios = require('axios')
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");

// Axios instance - Optimize edilmiş ayarlar
const instance = Axios.create({
    timeout: 10000, // 10 saniye timeout
    maxRedirects: 5,
    validateStatus: function (status) {
        return status >= 200 && status < 500;
    }
});
const axios = setupCache(instance, {
    ttl: 60 * 60 * 1000, // 1 saat cache (milisaniye)
    interpretHeader: false,
    methods: ['get', 'post'],
    cachePredicate: {
        statusCheck: (status) => status >= 200 && status < 400
    }
});
axiosRetry(axios, { 
    retries: 2,
    retryDelay: (retryCount) => retryCount * 500, // Hızlı retry
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

// Aktif domain'i tespit et
async function detectActiveDomain(startDomain = 'dizipall27') {
    const fs = require('fs');
    const path = require('path');
    const cacheDir = path.join(__dirname, '../../cache');
    const domainCacheFile = path.join(cacheDir, 'active_domain.cache');
    
    // Cache'den kontrol et - Daha uzun cache (6 saat)
    if (fs.existsSync(domainCacheFile)) {
        const cacheAge = (Date.now() - fs.statSync(domainCacheFile).mtime.getTime()) / 1000;
        if (cacheAge < 21600) { // 6 saat cache - domain sık değişmez
            const cachedDomain = fs.readFileSync(domainCacheFile, 'utf8').trim();
            if (cachedDomain) {
                return cachedDomain; // Test etme, direkt kullan (hızlı)
            }
        }
    }
    
    // Domain'leri test et
    const maxAttempts = 10;
    const startNumber = parseInt(startDomain.match(/\d+$/)?.[0] || '27');
    
    for (let i = 0; i < maxAttempts; i++) {
        const domainNumber = startNumber + i;
        const testDomain = `dizipall${domainNumber}.com`;
        const testUrl = `https://${testDomain}/`;
        
        try {
            const result = await axios.get(testUrl, { 
                ...sslfix, 
                headers: header, 
                timeout: 3000, // 3 saniye - daha hızlı
                maxRedirects: 0, 
                validateStatus: () => true 
            });
            
            if (result.status === 200 || result.status === 301 || result.status === 302) {
                const finalDomain = result.request?.responseURL ? new URL(result.request.responseURL).hostname : testDomain;
                // Cache'e kaydet
                if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
                fs.writeFileSync(domainCacheFile, finalDomain);
                return finalDomain;
            }
        } catch (e) {
            // Devam et
        }
        
        // Daha kısa bekleme - hızlı failover
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return startDomain + '.com';
}

// Poster URL'lerini tam URL'ye çevir
function normalizePosterUrl(posterUrl, baseUrl) {
    if (!posterUrl) return '';
    
    // Base64, SVG, placeholder gibi geçersiz URL'leri reddet
    if (posterUrl.includes('data:image') || 
        posterUrl.includes('base64') || 
        posterUrl.includes('svg+xml') ||
        posterUrl.includes('placeholder') ||
        posterUrl.length < 5) {
        return '';
    }
    
    // Zaten tam URL ise direkt dön
    if (posterUrl.startsWith('http://') || posterUrl.startsWith('https://')) {
        return posterUrl;
    }
    
    // Relative URL ise base URL ile birleştir
    if (posterUrl.startsWith('//')) {
        return `https:${posterUrl}`;
    }
    
    if (posterUrl.startsWith('/')) {
        return `${baseUrl}${posterUrl}`;
    }
    
    return `${baseUrl}/${posterUrl}`;
}

async function SearchMovieAndSeries(name) {
    try {
        const activeDomain = await detectActiveDomain();
        const proxyUrl = process.env.PROXY_URL || `https://${activeDomain}`;
        
        console.log(`[SEARCH] Searching for: "${name}" on ${proxyUrl}`);
        
        const results = [];
        const seen = new Set();
        const searchLower = name.toLowerCase().trim();
        
        if (!searchLower || searchLower.length < 1) {
            return results;
        }
        
        // Normalize fonksiyonu - Türkçe karakterleri normalize et (önce tanımla)
        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
                .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ı/g, 'i')
                .replace(/İ/g, 'i').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        };
        
        // Slug'dan title çıkarma fonksiyonu
        const slugToTitle = (slug) => {
            if (!slug) return '';
            return slug
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')
                .replace(/\d+/g, '') // Sayıları kaldır
                .trim();
        };
        
        // Arama terimini normalize et ve farklı varyasyonlar oluştur
        const searchVariations = [];
        searchVariations.push(name); // Orijinal
        searchVariations.push(name.toLowerCase()); // Küçük harf
        searchVariations.push(normalize(name)); // Normalize edilmiş
        
        // Eğer birden fazla kelime varsa, her kelimeyi ayrı ayrı dene
        const words = name.toLowerCase().trim().split(/\s+/).filter(w => w.length > 2);
        if (words.length > 1) {
            // Son kelimeyi al (genellikle daha önemli)
            searchVariations.push(words[words.length - 1]);
            // İlk kelimeyi al
            searchVariations.push(words[0]);
            // Tüm kelimeleri birleştir
            searchVariations.push(words.join(' '));
        }
        
        // ÖNCE: Dizipall27.com'un kendi arama API'sini kullan (POST request - HTML/JSON response)
        // Tüm varyasyonları dene
        let apiResultsFound = false;
        for (const searchTerm of searchVariations) {
            if (apiResultsFound && results.length > 0) break; // Zaten sonuç bulunduysa dur
            
            try {
                console.log(`[SEARCH] Using dizipall27.com search API (POST) - Searching: "${searchTerm}"...`);
                
                // POST request to /search endpoint - HTML snippet döndürüyor
            const searchResponse = await axios.post(`${proxyUrl}/search`, 
                    `query=${encodeURIComponent(searchTerm)}`, 
                {
                    ...sslfix,
                    headers: {
                        'accept': 'application/json, text/javascript, */*; q=0.01',
                        'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'x-requested-with': 'XMLHttpRequest',
                        'referer': `${proxyUrl}/`,
                        'origin': proxyUrl,
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin'
                    },
                        timeout: 5000, // 5 saniye - daha uzun timeout
                    cache: {
                        ttl: 60 * 60 * 1000 // 1 saat cache
                    }
                }
            );
            
            if (searchResponse && searchResponse.status === 200 && searchResponse.data) {
                let apiResultCount = 0;
                
                // Response JSON olabilir veya HTML olabilir
                let searchData = searchResponse.data;
                
                // Eğer string ise JSON parse et veya HTML olarak işle
                if (typeof searchData === 'string') {
                    // Önce HTML içinde arama sonuçlarını bul (API HTML snippet döndürebilir)
                    const $search = cheerio.load(searchData);
                    
                    // Tüm potansiyel liste öğelerini bul (geniş kapsamlı)
                        // li, div, article gibi tüm container'ları kontrol et
                        const selectors = ['li', 'div[class*="item"]', 'div[class*="card"]', 'article', 'a[href*="/dizi/"]', 'a[href*="/film/"]'];
                        
                        for (const selector of selectors) {
                            $search(selector).each((i, element) => {
                                const $el = $search(element);
                                
                                // Linki bul - önce element'in kendisi link mi kontrol et
                                let link = $el;
                                if (!link.is('a')) {
                                    link = $el.find('a[href*="/dizi/"], a[href*="/film/"]').first();
                                }
                        if (link.length === 0) return;
                        
                                let href = link.attr('href');
                        if (!href) return;
                                
                                // Relative URL'leri tam URL'ye çevir
                                if (href.startsWith('/')) {
                                    href = `${proxyUrl}${href}`;
                                }
                        
                        const isMovie = href.includes('/film/');
                        const isSeries = href.includes('/dizi/');
                        
                        if (!isMovie && !isSeries) return;
                        if (href.includes('/sezon-') || href.includes('/bolum-') || href.includes('/tur/')) return;
                        
                        const urlMatch = href.match(/\/(dizi|film)\/([^\/\?#]+)/);
                        if (!urlMatch) return;
                        
                        const type = isMovie ? 'movie' : 'series';
                        const slug = urlMatch[2];
                        const uniqueKey = `${type}:${slug}`;
                        
                        if (seen.has(uniqueKey)) return;
                        
                                // Title bulma önceliği - daha kapsamlı
                        let title = '';
                        
                        // 1. Link içindeki veya yanındaki başlıklar
                                const h2 = $el.find('h2').first();
                                const h3 = $el.find('h3').first();
                                const h4 = $el.find('h4').first();
                                const h5 = $el.find('h5').first();
                                const p = $el.find('p').first();
                        
                        if (h2.length > 0) title = h2.text().trim();
                        else if (h3.length > 0) title = h3.text().trim();
                        else if (h4.length > 0) title = h4.text().trim();
                                else if (h5.length > 0) title = h5.text().trim();
                        
                        // 2. Resim alt/title attribute'ları
                                const img = $el.find('img').first();
                        if (!title && img.length > 0) {
                            title = img.attr('alt') || img.attr('title') || '';
                        }
                        
                        // 3. Link text veya title
                        if (!title) {
                            title = link.attr('title') || link.text().trim();
                        }
                        
                                // 4. P etiketinden temizleme
                        if (!title && p.length > 0) {
                            let pText = p.text().trim();
                            title = pText.replace(/^\d{4}\s*-\s*/, '').trim();
                        }
                                
                                // 5. Slug'dan title çıkarma (son çare)
                                if (!title || title.length < 2) {
                                    title = slugToTitle(slug);
                        }

                        // Title temizliği
                        title = title.replace(/Yayınlandı/g, '')
                                    .replace(/Sezon \d+/g, '')
                                    .replace(/\s+\d+\.\d+\s+\d{4}/g, '')
                                    .replace(/\s+\d{4}/g, '')
                                    .replace(/\s+\d+\.\d+/g, '')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                        
                        // Poster bulma - tüm img'leri kontrol et
                        let posterSrc = '';
                        if (img.length > 0) {
                            posterSrc = img.attr('src') || 
                                       img.attr('data-src') || 
                                       img.attr('data-lazy-src') || 
                                       img.attr('data-original') || 
                                       img.attr('data-url') || '';
                        }
                        
                        // Poster bulunamadıysa tüm img'leri tara
                        if (!posterSrc || posterSrc.length < 5) {
                                    const allImgs = $el.find('img');
                            for (let j = 0; j < allImgs.length; j++) {
                                const imgEl = $search(allImgs[j]);
                                const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
                                if (src && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                    if (!src.includes('svg') && !src.includes('base64')) {
                                        posterSrc = src;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        const poster = normalizePosterUrl(posterSrc, proxyUrl);
                        
                                // Eşleşme kontrolü - çok esnek
                                const titleNormalized = normalize(title);
                                const slugNormalized = normalize(slug);
                                const searchNormalized = normalize(searchTerm);
                                
                                // Eşleşme kontrolü - slug veya title'da arama terimi var mı?
                                const matches = titleNormalized.includes(searchNormalized) || 
                                               slugNormalized.includes(searchNormalized) ||
                                               searchNormalized.includes(titleNormalized) ||
                                               searchNormalized.includes(slugNormalized);
                                
                                if (matches && title && title.length > 1) {
                            seen.add(uniqueKey);
                            results.push({
                                title: title,
                                name: title,
                                url: `/${type === 'movie' ? 'film' : 'dizi'}/${slug}`,
                                slug: slug,
                                poster: poster,
                                type: type,
                                genres: ''
                            });
                            apiResultCount++;
                                    console.log(`[SEARCH] Found match: ${title} (slug: ${slug})`);
                        }
                    });
                        }
                        
                        if (apiResultCount > 0) {
                            apiResultsFound = true;
                        }
                    
                    // JSON parse denemesi (string içinde JSON varsa)
                    try {
                        if (searchData.trim().startsWith('{') || searchData.trim().startsWith('[')) {
                            searchData = JSON.parse(searchData);
                        } else {
                            searchData = null; // Sadece HTML idi
                        }
                    } catch (e) {
                        searchData = null;
                    }
                }
                
                // Eğer JSON response ise
                if (searchData && typeof searchData === 'object' && !Array.isArray(searchData)) {
                    const items = searchData.results || searchData.data || (Array.isArray(searchData) ? searchData : []);
                    
                    if (Array.isArray(items) && items.length > 0) {
                        items.forEach((item) => {
                            if (!item || !item.url) return;
                            
                            const href = item.url || item.link || item.href;
                            if (!href) return;
                            
                            const isMovie = href.includes('/film/');
                            const isSeries = href.includes('/dizi/');
                            
                            if (!isMovie && !isSeries) return;
                            if (href.includes('/sezon-') || href.includes('/bolum-') || href.includes('/tur/')) return;
                            
                            const urlMatch = href.match(/\/(dizi|film)\/([^\/\?#]+)/);
                            if (!urlMatch) return;
                            
                            const type = urlMatch[1];
                            const slug = urlMatch[2];
                            const uniqueKey = `${type}:${slug}`;
                            
                            if (seen.has(uniqueKey)) return;
                            
                                const title = (item.title || item.name || slugToTitle(slug) || '').trim();
                            const posterSrc = item.poster || item.image || item.thumbnail || '';
                            const poster = normalizePosterUrl(posterSrc, proxyUrl);
                            
                                // Eşleşme kontrolü
                                const titleNormalized = normalize(title);
                                const slugNormalized = normalize(slug);
                                const searchNormalized = normalize(searchTerm);
                                
                                const matches = titleNormalized.includes(searchNormalized) || 
                                               slugNormalized.includes(searchNormalized) ||
                                               searchNormalized.includes(titleNormalized) ||
                                               searchNormalized.includes(slugNormalized);
                                
                                if (matches && title && title.length > 2) {
                                seen.add(uniqueKey);
                                results.push({
                                    title: title,
                                    name: title,
                                    url: `/${type}/${slug}`,
                                    slug: slug,
                                    poster: poster,
                                    type: isMovie ? 'movie' : 'series',
                                    genres: item.genres || []
                                });
                                apiResultCount++;
                            }
                        });
                    }
                }
                
                    // Bu varyasyon için sonuç bulunduysa dur
                    if (apiResultCount > 0) {
                        apiResultsFound = true;
                        console.log(`[SEARCH] API returned ${apiResultCount} results for "${searchTerm}"`);
                    }
                }
            } catch (apiError) {
                console.log(`[SEARCH] API search failed for "${searchTerm}": ${apiError.message}`);
                // Bir sonraki varyasyonu dene
            }
        }
        
        // API'den sonuç geldiyse kontrol et - SONUÇ BULUNDUYSA HEMEN DÖN
                if (results.length > 0) {
                    const postersCount = results.filter(r => r.poster && r.poster.length > 10).length;
            console.log(`[SEARCH] Total API results: ${results.length} (${postersCount} with posters)`);
                    
            // Sonuç bulunduysa hemen dön - daha fazla sayfa taramaya gerek yok
            console.log(`[SEARCH] Results found - RETURNING IMMEDIATELY!`);
                        return results;
                    }
                    
        // FALLBACK: Sayfa scraping (API çalışmazsa veya yeterli sonuç yoksa)
        // Hem diziler hem filmler için scraping yap
        
        // Sayıları normalize et (2 -> iki, ikinci, vb.)
        const normalizeNumbers = (str) => {
            return str.replace(/2/g, 'iki').replace(/3/g, 'uc').replace(/4/g, 'dort')
                     .replace(/5/g, 'bes').replace(/6/g, 'alti').replace(/7/g, 'yedi')
                     .replace(/8/g, 'sekiz').replace(/9/g, 'dokuz').replace(/10/g, 'on');
        };
        
        const searchWords = normalize(searchLower).split(/\s+/).filter(w => w.length > 0);
        const searchWordsWithNumbers = normalizeNumbers(normalize(searchLower)).split(/\s+/).filter(w => w.length > 0);
        
        // 1. ANA SAYFA - Hem diziler hem filmler için
        try {
            console.log(`[SEARCH] Fallback: Fetching from homepage (series + movies)...`);
            const homeResponse = await axios.get(proxyUrl, {
                ...sslfix,
                headers: header,
                timeout: 3000, // 3 saniye - HIZLI
                cache: { ttl: 60 * 60 * 1000 }
            });
            
            if (homeResponse && homeResponse.status === 200 && homeResponse.data) {
                const $home = cheerio.load(homeResponse.data);
                
                // DİZİLER - Ana sayfadaki tüm dizi linklerini tara
                $home('a[href*="/dizi/"]').each((i, element) => {
                    const $link = $home(element);
                    const href = $link.attr('href');
                    
                    if (!href) return;
                    
                    // Dizi slug'ını çıkar (bölüm linki olsa bile)
                    const diziMatch = href.match(/\/dizi\/([^\/\?#]+)/);
                    if (!diziMatch) return;
                    
                    const slug = diziMatch[1];
                    const uniqueKey = `series:${slug}`;
                    
                    // Zaten varsa ama posteri yoksa, sadece posteri güncelle
                    const existingIndex = results.findIndex(r => r.slug === slug && r.type === 'series');
                    if (existingIndex >= 0) {
                        // Zaten var - poster yoksa güncelle
                        if (!results[existingIndex].poster || results[existingIndex].poster.length < 10) {
                            // Poster güncelleme moduna geç
                        } else {
                            return; // Posterli zaten var, skip
                        }
                    }
                    if (seen.has(uniqueKey) && existingIndex < 0) return; // Duplicate kontrolü
                    
                    // Title bul - img alt, heading, link text
                    let title = '';
                    let posterSrc = '';
                    
                    // Parent elementlerde img ara
                    const $parent = $link.parent();
                    const $grandParent = $parent.parent();
                    
                    // Önce yakındaki h2'leri kontrol et
                    const h2 = $link.find('h2').first();
                    if (h2.length > 0) {
                        title = h2.text().trim();
                    }
                    
                    // h2 yoksa img alt/title'dan al
                    if (!title) {
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            title = img.attr('alt') || img.attr('title') || '';
                            posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        }
                    }
                    
                    // Poster henüz yoksa, tüm img'leri kontrol et (link içinde, parent'ta, grandparent'ta)
                    if (!posterSrc || posterSrc.length < 5) {
                        // Önce link içindeki img'leri kontrol et
                        const allImgs = $link.find('img');
                        for (let j = 0; j < allImgs.length; j++) {
                            const img = $home(allImgs[j]);
                            const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('data-url') || '';
                            if (src && src.length > 5 && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp') || src.includes('.jpeg'))) {
                                if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                    posterSrc = src;
                                    break;
                                }
                            }
                        }
                        
                        // Hala yoksa parent elementlerde ara
                        if (!posterSrc || posterSrc.length < 5) {
                            const parentImgs = $parent.find('img');
                            for (let j = 0; j < parentImgs.length; j++) {
                                const img = $home(parentImgs[j]);
                                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || '';
                                if (src && src.length > 5 && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                    if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                        posterSrc = src;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Hala yoksa grandparent'ta ara
                        if (!posterSrc || posterSrc.length < 5) {
                            const grandParentImgs = $grandParent.find('img');
                            for (let j = 0; j < grandParentImgs.length; j++) {
                                const img = $home(grandParentImgs[j]);
                                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || '';
                                if (src && src.length > 5 && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                    if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                        posterSrc = src;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // Hala yoksa link text'inden al
                    if (!title) {
                        title = $link.attr('title') || '';
                    }
                    
                    // Title temizle
                    title = title.replace(/Yayınlandı/g, '')
                                .replace(/Sezon \d+/g, '')
                                .replace(/Bölüm \d+/g, '')
                                .replace(/\d{2}\s\w+\s\d{4}/g, '') // Tarihleri kaldır
                                .replace(/\n/g, ' ')
                                .replace(/\s+·\s+/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                    
                    const poster = normalizePosterUrl(posterSrc, proxyUrl);
                    
                    if (title && title.length > 2) {
                        const titleNormalized = normalize(title);
                        const slugNormalized = normalize(slug);
                        
                        // Eşleşme kontrolü - esnek
                        let matches = false;
                        if (searchWords.length === 1) {
                            const word = searchWords[0];
                            matches = titleNormalized.includes(word) || 
                                     slugNormalized.includes(word) ||
                                     word.length >= 3 && (titleNormalized.indexOf(word) >= 0 || slugNormalized.indexOf(word) >= 0);
                        } else {
                            const matchedWords = searchWords.filter(word => {
                                if (word.length < 2) return false;
                                return titleNormalized.includes(word) || 
                                       slugNormalized.includes(word) ||
                                       titleNormalized.indexOf(word) >= 0 ||
                                       slugNormalized.indexOf(word) >= 0;
                            });
                            matches = matchedWords.length > 0;
                        }
                        
                        if (matches) {
                            // Zaten varsa ve posteri yoksa, sadece posteri güncelle
                            if (existingIndex >= 0) {
                                if (poster && poster.length > 10) {
                                    results[existingIndex].poster = poster;
                                    console.log(`[SEARCH] Updated poster for: ${title}`);
                                }
                            } else {
                                // Yeni ekleme
                                seen.add(uniqueKey);
                                results.push({
                                    title: title,
                                    name: title,
                                    url: `/dizi/${slug}`,
                                    slug: slug,
                                    poster: poster,
                                    type: 'series',
                                    genres: ''
                                });
                            }
                        }
                    }
                });
                
                // FİLMLER - Ana sayfadaki tüm film linklerini de tara
                $home('a[href*="/film/"]').each((i, element) => {
                    const $link = $home(element);
                    const href = $link.attr('href');
                    
                    if (!href) return;
                    
                    // Film slug'ını çıkar
                    const filmMatch = href.match(/\/film\/([^\/\?#]+)/);
                    if (!filmMatch) return;
                    if (href.includes('/tur/')) return; // Kategori linklerini atla
                    
                    const slug = filmMatch[1];
                    const uniqueKey = `movie:${slug}`;
                    
                    // Zaten varsa ama posteri yoksa, sadece posteri güncelle
                    const existingIndex = results.findIndex(r => r.slug === slug && r.type === 'movie');
                    if (existingIndex >= 0) {
                        if (!results[existingIndex].poster || results[existingIndex].poster.length < 10) {
                            // Poster güncelleme moduna geç
                        } else {
                            return; // Posterli zaten var, skip
                        }
                    }
                    if (seen.has(uniqueKey) && existingIndex < 0) return;
                    
                    // Title ve poster bul
                    let title = '';
                    let posterSrc = '';
                    
                    const h2 = $link.find('h2').first();
                    if (h2.length > 0) {
                        title = h2.text().trim();
                    }
                    
                    const img = $link.find('img').first();
                    if (img.length > 0) {
                        if (!title) title = img.attr('alt') || img.attr('title') || '';
                        posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                    }
                    
                    // Tüm img'leri kontrol et
                    if (!posterSrc) {
                        const allImgs = $link.find('img');
                        for (let j = 0; j < allImgs.length; j++) {
                            const imgEl = $home(allImgs[j]);
                            const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
                            if (src && (src.includes('/uploads/movies/') || src.includes('/uploads/') || src.includes('.jpg') || src.includes('.webp'))) {
                                if (!src.includes('svg') && !src.includes('base64')) {
                                    posterSrc = src;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (!title) title = $link.attr('title') || '';
                    
                    // Title temizle
                    title = title.replace(/Yayınlandı/g, '')
                                .replace(/\s+\d+\.\d+\s+\d{4}/g, '')
                                .replace(/\s+\d{4}/g, '')
                                .replace(/\d{2}\s\w+\s\d{4}/g, '')
                                .replace(/\n/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                    
                    const poster = normalizePosterUrl(posterSrc, proxyUrl);
                    
                    if (title && title.length > 2) {
                        const titleNormalized = normalize(title);
                        const slugNormalized = normalize(slug);
                        
                        // Eşleşme kontrolü
                        let matches = false;
                        if (searchWords.length === 1) {
                            const word = searchWords[0];
                            matches = titleNormalized.includes(word) || slugNormalized.includes(word);
                        } else {
                            const matchedWords = searchWords.filter(word => 
                                titleNormalized.includes(word) || slugNormalized.includes(word)
                            );
                            matches = matchedWords.length > 0;
                        }
                        
                        if (matches) {
                            if (existingIndex >= 0) {
                                if (poster && poster.length > 10) {
                                    results[existingIndex].poster = poster;
                                    console.log(`[SEARCH] Updated poster for movie: ${title}`);
                                }
                            } else {
                                seen.add(uniqueKey);
                                results.push({
                                    title: title,
                                    name: title,
                                    url: `/film/${slug}`,
                                    slug: slug,
                                    poster: poster,
                                    type: 'movie',
                                    genres: ''
                                });
                            }
                        }
                    }
                });
            }
        } catch (homeError) {
            console.log(`[SEARCH] Homepage error: ${homeError.message}`);
        }
        
        // 2. DİZİLER için /diziler sayfasını kontrol et - GENİŞLETİLMİŞ
        try {
            console.log(`[SEARCH] Fallback: Fetching series from ${proxyUrl}/diziler...`);
            
            const seriesPagesToCheck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            
            for (const pageNum of seriesPagesToCheck) {
                if (results.length > 0) break; // Sonuç bulunduysa hemen dur
                
                const pageUrl = pageNum === 1 ? `${proxyUrl}/diziler` : `${proxyUrl}/diziler/${pageNum}`;
                
                try {
                    const seriesResponse = await axios.get(pageUrl, {
                        ...sslfix,
                        headers: header,
                        timeout: 5000,
                        cache: { ttl: 60 * 60 * 1000 }
                    });
                    
                    if (seriesResponse && seriesResponse.status === 200 && seriesResponse.data) {
                        const $series = cheerio.load(seriesResponse.data);
                        let pageSeriesCount = 0;
                        
                        $series('a[href*="/dizi/"]').each((i, element) => {
                            const $link = $series(element);
                            const href = $link.attr('href');
                            
                            if (!href || href.includes('/sezon-') || href.includes('/bolum-') || href.includes('/tur/')) return;
                            
                            const diziMatch = href.match(/\/dizi\/([^\/\?#]+)/);
                            if (!diziMatch) return;
                            
                            const slug = diziMatch[1];
                            const uniqueKey = `series:${slug}`;
                            
                            if (seen.has(uniqueKey)) return;
                            
                            let title = '';
                            const h2 = $link.find('h2').first();
                            if (h2.length > 0) {
                                title = h2.text().trim();
                            }
                            
                            const img = $link.find('img').first();
                            if (!title && img.length > 0) {
                                title = img.attr('alt') || img.attr('title') || '';
                            }
                            
                            if (!title) {
                                title = $link.attr('title') || slugToTitle(slug);
                            }
                            
                            title = title.replace(/Yayınlandı/g, '')
                                        .replace(/Sezon \d+/g, '')
                                        .replace(/Bölüm \d+/g, '')
                                        .replace(/\n/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                            
                            // Poster bulma - daha kapsamlı
                            let posterSrc = '';
                            if (img.length > 0) {
                                posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('data-url') || '';
                            }
                            
                            // Poster bulunamadıysa parent elementlerde ara
                            if (!posterSrc || posterSrc.length < 5) {
                                const $parent = $link.parent();
                                const $grandParent = $parent.parent();
                                
                                // Parent'taki img'leri kontrol et
                                const parentImgs = $parent.find('img');
                                for (let j = 0; j < parentImgs.length; j++) {
                                    const imgEl = $series(parentImgs[j]);
                                    const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('data-original') || '';
                                    if (src && src.length > 5 && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                        if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                            posterSrc = src;
                                            break;
                                        }
                                    }
                                }
                                
                                // Grandparent'taki img'leri kontrol et
                                if (!posterSrc || posterSrc.length < 5) {
                                    const grandParentImgs = $grandParent.find('img');
                                    for (let j = 0; j < grandParentImgs.length; j++) {
                                        const imgEl = $series(grandParentImgs[j]);
                                        const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('data-original') || '';
                                        if (src && src.length > 5 && (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                            if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                                posterSrc = src;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            const poster = normalizePosterUrl(posterSrc, proxyUrl);
                            
                            if (title && title.length > 2) {
                                const titleNormalized = normalize(title);
                                const slugNormalized = normalize(slug);
                                
                                // Çok esnek eşleşme kontrolü
                                let matches = false;
                                for (const searchWord of searchWords) {
                                    if (searchWord.length < 2) continue;
                                    if (titleNormalized.includes(searchWord) || 
                                        slugNormalized.includes(searchWord) ||
                                        searchWord.includes(titleNormalized) ||
                                        searchWord.includes(slugNormalized)) {
                                        matches = true;
                                        break;
                                    }
                                }
                                
                                if (matches) {
                                    seen.add(uniqueKey);
                                    results.push({
                                        title: title,
                                        name: title,
                                        url: `/dizi/${slug}`,
                                        slug: slug,
                                        poster: poster,
                                        type: 'series',
                                        genres: ''
                                    });
                                    pageSeriesCount++;
                                }
                            }
                        });
                        
                        console.log(`[SEARCH] Series page ${pageNum}: Found ${pageSeriesCount} matched series`);
                        
                        // Sonuç bulunduysa hemen dur
                        if (pageSeriesCount > 0) {
                            console.log(`[SEARCH] Results found on series page ${pageNum} - STOPPING SEARCH!`);
                            break;
                        }
                    }
                } catch (pageError) {
                    console.log(`[SEARCH] Series page ${pageNum} error: ${pageError.message}`);
                    break;
                }
            }
        } catch (seriesError) {
            console.log(`[SEARCH] Series page error: ${seriesError.message}`);
        }
        
        // 3. FİLMLER için /filmler sayfasını kontrol et - GENİŞLETİLMİŞ
        try {
            console.log(`[SEARCH] Fallback: Fetching movies from ${proxyUrl}/filmler...`);
            
            // GENİŞLETİLMİŞ: İlk 10 sayfayı kontrol et
            const pagesToCheck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            
            // Sıralı istekler (daha güvenilir) ama hızlı timeout
            for (const pageNum of pagesToCheck) {
                if (results.length > 0) break; // Sonuç bulunduysa hemen dur
                
                const pageUrl = pageNum === 1 ? `${proxyUrl}/filmler` : `${proxyUrl}/filmler/${pageNum}`;
                
                try {
                    const moviesResponse = await axios.get(pageUrl, {
                        ...sslfix,
                        headers: header,
                        timeout: 5000, // 5 saniye - daha uzun timeout
                        cache: { ttl: 60 * 60 * 1000 }
                    });
                    
                    if (moviesResponse && moviesResponse.status === 200 && moviesResponse.data) {
                        const $movies = cheerio.load(moviesResponse.data);
                        let pageFilmCount = 0;
                        
                        // Film kartlarını bul - tüm li elementlerini kontrol et
                        $movies('li').each((i, element) => {
                            const $li = $movies(element);
                            const link = $li.find('a[href*="/film/"]').first();
                            
                            if (link.length === 0) return;
                            
                            const href = link.attr('href');
                            
                            if (href && href.includes('/film/') && !href.includes('/tur/')) {
                                const urlMatch = href.match(/\/film\/([^\/\?#]+)/);
                                if (urlMatch) {
                                    const slug = urlMatch[1];
                                    const uniqueKey = `movie:${slug}`;
                                    
                                    // Zaten varsa ama posteri yoksa, sadece posteri güncelle
                                    const existingIndex = results.findIndex(r => r.slug === slug && r.type === 'movie');
                                    if (existingIndex >= 0) {
                                        // Zaten var - poster yoksa güncelle
                                        if (!results[existingIndex].poster || results[existingIndex].poster.length < 10) {
                                            // Poster güncelleme moduna geç
                                        } else {
                                            return; // Posterli zaten var, skip
                                        }
                                    }
                                    if (seen.has(uniqueKey) && existingIndex < 0) return; // Duplicate kontrolü
                                    
                                    // li elementini kullan
                                    const $el = $li;
                                    
                                    // Title bul - önce h2, sonra link text, sonra img alt
                                    let title = '';
                                    const h2 = $el.find('h2').first();
                                    if (h2.length > 0) {
                                        title = h2.text().trim();
                                    }
                                    
                                    // H2 yoksa link text'inden al
                                    if (!title) {
                                        title = link.text().trim() || link.attr('title') || '';
                                    }
                                    
                                    // Poster bul - AGRESIF: Tüm img etiketlerini kontrol et
                                    let posterSrc = '';
                                    const allImgs = $el.find('img');
                                    
                                    // Önce /uploads/movies/ içerenleri bul
                                    for (let j = 0; j < allImgs.length; j++) {
                                        const img = $movies(allImgs[j]);
                                        const srcList = [
                                            img.attr('src'),
                                            img.attr('data-src'),
                                            img.attr('data-lazy-src'),
                                            img.attr('data-original'),
                                            img.attr('data-url'),
                                            img.attr('srcset')?.split(',')[0]?.split(' ')[0]
                                        ];
                                        
                                        for (const src of srcList) {
                                            if (src && src.length > 10) {
                                                // Base64, SVG, placeholder atla
                                                if (src.includes('data:image') || src.includes('base64') || src.includes('svg') || src.includes('placeholder')) {
                                                    continue;
                                                }
                                                // Gerçek poster URL'leri - /uploads/ veya resim uzantısı
                                                if (src.includes('/uploads/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp') || src.includes('.jpeg')) {
                                                    posterSrc = src;
                                                    if (!title) {
                                                        title = img.attr('alt') || img.attr('title') || '';
                                                    }
                                                    break;
                                                }
                                            }
                                        }
                                        if (posterSrc) break;
                                    }
                                    
                                    // Title temizle
                                    title = title.replace(/\s+\d+\.\d+\s+\d{4}/g, '')
                                                .replace(/\s+\d{4}/g, '')
                                                .replace(/\s+\d+\.\d+/g, '')
                                                .replace(/Yayınlandı/g, '')
                                                .replace(/\n/g, ' ')
                                                .replace(/\s+/g, ' ')
                                                .trim();
                                    
                                    // Poster URL'ini tam URL'ye çevir
                                    const poster = normalizePosterUrl(posterSrc, proxyUrl);
                                    
                                    if (title && title.length > 2) {
                                        const titleNormalized = normalize(title);
                                        const slugNormalized = normalize(slug);
                                        const titleNormalizedWithNumbers = normalizeNumbers(titleNormalized);
                                        
                                        // Eşleşme kontrolü - çok esnek
                                        let matches = false;
                                        
                                        // Çok esnek eşleşme - her kelime için kontrol et
                                        if (searchWords.length === 1) {
                                            // Tek kelime - title, slug veya normalize edilmiş versiyonda ara
                                            const word = searchWords[0];
                                            matches = titleNormalized.includes(word) || 
                                                     slugNormalized.includes(word) ||
                                                     titleNormalizedWithNumbers.includes(normalizeNumbers(word)) ||
                                                     word.length >= 3 && (titleNormalized.indexOf(word) >= 0 || slugNormalized.indexOf(word) >= 0);
                                        } else {
                                            // Çoklu kelime - EN AZ BİR kelime eşleşiyorsa yeterli (çok esnek)
                                            const matchedWords = searchWords.filter(word => {
                                                if (word.length < 2) return false;
                                                return titleNormalized.includes(word) || 
                                                       slugNormalized.includes(word) ||
                                                       titleNormalizedWithNumbers.includes(normalizeNumbers(word)) ||
                                                       titleNormalized.indexOf(word) >= 0 ||
                                                       slugNormalized.indexOf(word) >= 0;
                                            });
                                            
                                            // Sayıları da kontrol et
                                            const matchedWordsWithNumbers = searchWordsWithNumbers.filter(word => {
                                                if (word.length < 2) return false;
                                                return titleNormalized.includes(word) || 
                                                       titleNormalizedWithNumbers.includes(word) ||
                                                       titleNormalized.indexOf(word) >= 0;
                                            });
                                            
                                            // En az bir kelime eşleşiyorsa
                                            matches = matchedWords.length > 0 || matchedWordsWithNumbers.length > 0;
                                        }
                                        
                                        if (matches) {
                                            pageFilmCount++;
                                            
                                            // Zaten varsa ve posteri yoksa, sadece posteri güncelle
                                            if (existingIndex >= 0) {
                                                if (poster && poster.length > 10) {
                                                    results[existingIndex].poster = poster;
                                                    console.log(`[SEARCH] Updated poster for film: ${title}`);
                                                }
                                            } else {
                                                // Yeni ekleme
                                                seen.add(uniqueKey);
                                                results.push({
                                                    title: title,
                                                    name: title,
                                                    url: `/film/${slug}`,
                                                    slug: slug,
                                                    poster: poster, // Tam URL
                                                    type: 'movie',
                                                    genres: ''
                                                });
                                                console.log(`[SEARCH] Matched film: ${title} (poster: ${poster ? 'YES' : 'NO'})`);
                                            }
                                        }
                                    }
                                }
                            }
                        });
                        
                        console.log(`[SEARCH] Movies page ${pageNum}: Found ${pageFilmCount} matched films`);
                        
                        // Sonuç bulunduysa hemen dur
                        if (pageFilmCount > 0) {
                            console.log(`[SEARCH] Results found on movies page ${pageNum} - STOPPING SEARCH!`);
                            break;
                        }
                    }
                } catch (pageError) {
                    // Hata olsa bile devam et (hızlı olması için)
                    console.log(`[SEARCH] Movies page ${pageNum} error: ${pageError.message}`);
                    break; // Hata varsa dur (hızlı olması için)
                }
            }
        } catch (moviesError) {
            console.log(`[SEARCH] Movies page error: ${moviesError.message}`);
        }
        
        console.log(`[SEARCH] Final results for "${name}": ${results.length} items`);
        return results;
        
    } catch (error) {
        console.log('Search error:', error.message);
        return [];
    }
}

async function SearchMetaMovieAndSeries(id, type) {
    try {
        const activeDomain = await detectActiveDomain();
        const proxyUrl = process.env.PROXY_URL || `https://${activeDomain}`;
        
        console.log(`Fetching meta for: ${id} (type: ${type})`);
        
        const response = await axios.get(proxyUrl + id, {
            ...sslfix,
            headers: header,
            timeout: 8000, // 8 saniye - daha hızlı
            cache: {
                ttl: 60 * 60 * 1000 // 1 saat cache - meta bilgiler sık değişmez
            }
        });
        
        if (response && response.status === 200) {
            const $ = cheerio.load(response.data);
            let metaObj = {};
            
            // Yeni site yapısına göre CSS selectorları - HIZLI VERSYON
            // Title bulma - h1'den direkt al
            let name = $('h1 a').first().text().trim() || 
                       $('h1').first().text().trim() || 
                       $('title').text().split('|')[0].trim().split('izle')[0].trim();
            
            // Poster bulma - TÜM img etiketlerini tara
            let posterSrc = '';
            
            // Tüm img etiketlerini bul ve /uploads/ içerenleri filtrele
            const allImgs = $('img');
            console.log(`[META] Found ${allImgs.length} total images on page`);
            
            for (let i = 0; i < allImgs.length; i++) {
                const img = $(allImgs[i]);
                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                
                // Gerçek poster URL'lerini bul
                if (src && (src.includes('/uploads/series/') || src.includes('/uploads/movies/') || src.includes('/uploads/video/'))) {
                    // SVG, base64, placeholder atla
                    if (!src.includes('svg') && !src.includes('base64') && !src.includes('placeholder') && !src.includes('dual-')) {
                        posterSrc = src;
                        console.log(`[META] Found poster: ${posterSrc}`);
                        break;
                    }
                }
            }
            
            // Bulunamadıysa alternatif yöntemler
            if (!posterSrc) {
                // Name içeren img'leri ara
                allImgs.each((i, element) => {
                    if (posterSrc) return;
                    const img = $(element);
                    const alt = img.attr('alt') || '';
                    if (alt.includes(name.substring(0, 10))) {
                        const src = img.attr('src') || img.attr('data-src') || '';
                        if (src && !src.includes('svg') && !src.includes('base64')) {
                            posterSrc = src;
                            console.log(`[META] Found poster by alt match: ${posterSrc}`);
                        }
                    }
                });
            }
            
            const poster = normalizePosterUrl(posterSrc, proxyUrl);
            console.log(`[META] Final poster URL: ${poster}`);
            
            // IMDb rating
            const imdbText = $('*:contains("IMDb")').parent().text() || '';
            const imdbMatch = imdbText.match(/(\d+\.?\d*)/);
            const imdb = imdbMatch ? imdbMatch[1] : '0';
            
            // Açıklama
            const description = $('p').filter((i, el) => {
                const text = $(el).text();
                return text.length > 50;
            }).first().text().trim();
            
            // Sezon sayısı - Sadece diziler için
            let season = 1;
            
            if (type === "series") {
                // Sezon linklerinden maksimum sezon numarasını bul
                const allSeasonMatches = response.data.match(/sezon-(\d+)/g);
                if (allSeasonMatches && allSeasonMatches.length > 0) {
                    const seasonNumbers = allSeasonMatches.map(m => parseInt(m.match(/\d+/)[0]));
                    season = Math.max(...seasonNumbers);
                }
            }
            
            // Ülke bilgisi
            const bodyText = $('body').text();
            const country = bodyText.includes('Yerli') || bodyText.includes('Türk') ? 'TR' : 'US';
            
            // Release info
            const releaseInfo = $('.series-profile-info').find('*:contains("20")').first().text().trim() ||
                               $('*:contains("20")').filter((i, el) => {
                                   const text = $(el).text();
                                   return text.match(/20\d{2}/);
                               }).first().text().trim();
            
            // Runtime (süre) - Filmler için
            let runtime = undefined;
            if (type === "movie") {
                // "Süre: 162 dk" formatını bul
                const durationText = $('*:contains("Süre")').parent().text() || '';
                const durationMatch = durationText.match(/Süre[:\s]+(\d+)\s*dk/i);
                if (durationMatch) {
                    runtime = parseInt(durationMatch[1]);
                } else {
                    // Alternatif: "162 dk" formatını ara
                    const altMatch = durationText.match(/(\d+)\s*dk/i);
                    if (altMatch) {
                        runtime = parseInt(altMatch[1]);
                    }
                }
                console.log(`[META] Movie runtime found: ${runtime} minutes`);
            }
            
            metaObj = {
                name: name,
                background: poster,
                country: country,
                season: type === "movie" ? 0 : season, // Filmler için season = 0
                imdbRating: parseFloat(imdb) || 0,
                description: description,
                releaseInfo: releaseInfo,
                runtime: runtime, // Filmler için runtime (dakika)
            };
            
            console.log(`Meta found: ${name}, type: ${type}, seasons: ${metaObj.season}`);
            return metaObj;
        }
    } catch (error) {
        console.log('Meta search error:', error.message);
    }
    return null;
}

async function SearchDetailMovieAndSeries(id, type, season) {
    try {
        if (type === "series") {
            const activeDomain = await detectActiveDomain();
            const proxyUrl = process.env.PROXY_URL || `https://${activeDomain}`;
            
            console.log(`[EPISODES] Fetching season ${season} for: ${id}`);
            
            const response = await axios.get(proxyUrl + id, {
                ...sslfix,
                headers: header,
                timeout: 8000, // 8 saniye - daha hızlı
                cache: {
                    ttl: 30 * 60 * 1000 // 30 dakika cache - bölümler güncel olmalı
                }
            });
            
            if (response && response.status === 200) {
                const $ = cheerio.load(response.data);
                const values = [];
                
                // Tüm bölüm linklerini bul
                $('a[href*="/sezon-' + season + '/bolum-"]').each((i, element) => {
                    const href = $(element).attr('href');
                    const match = href.match(/\/sezon-(\d+)\/bolum-(\d+)/);
                    
                    if (match) {
                        const episodeNum = parseInt(match[2]);
                        
                        // Title ve thumbnail bul
                        let title = $(element).attr('title') || 
                                   $(element).text().trim() || 
                                   `Bölüm ${episodeNum}`;
                        
                        // Gereksiz textleri temizle
                        title = title.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                        if (title.match(/^\d+\.\s*Sezon\s*\d+\.\s*Bölüm$/)) {
                            title = `Bölüm ${episodeNum}`;
                        }
                        
                        const thumbnail = $(element).find('img').attr('src') || 
                                         $(element).find('img').attr('data-src') || '';
                        
                        // Benzersiz bölüm kontrolü
                        if (!values.find(v => v.episode === episodeNum)) {
                            values.push({
                                id: href,
                                title: title,
                                thumbnail: thumbnail,
                                episode: episodeNum
                            });
                        }
                    }
                });
                
                // Episode numarasına göre sırala
                values.sort((a, b) => a.episode - b.episode);
                
                console.log(`Found ${values.length} episodes for season ${season}`);
                return values;
            }
        } else if (type === "movie") {
            // Filmler için direkt film ID'sini döndür (bölüm yok)
            console.log(`[MOVIE] Returning movie ID: ${id}`);
            // ID zaten /film/... formatında olmalı
            return [{
                id: id, // Tam path döndür: /film/slug
                title: "Film İzle",
                thumbnail: "",
                episode: 1
            }];
        }
    } catch (error) {
        console.log('Detail search error:', error.message);
    }
    return [];
}

module.exports = { SearchMovieAndSeries, SearchMetaMovieAndSeries, SearchDetailMovieAndSeries, detectActiveDomain };

