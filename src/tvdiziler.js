require("dotenv").config();
const Axios = require('axios');
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");
const cheerio = require('cheerio');
const ytdl = require('@distube/ytdl-core');

// Axios instance
const instance = Axios.create({
    timeout: 10000,
    maxRedirects: 5,
    validateStatus: function (status) {
        return status >= 200 && status < 500;
    }
});

const axios = setupCache(instance, {
    ttl: 60 * 60 * 1000, // 1 saat cache
    interpretHeader: false,
    methods: ['get', 'post'],
    cachePredicate: {
        statusCheck: (status) => status >= 200 && status < 400
    }
});

axiosRetry(axios, { 
    retries: 2,
    retryDelay: (retryCount) => retryCount * 500,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

// TvDiziler Base URL
const TVDIZILER_BASE_URL = 'https://tvdiziler.cc';

// YouTube ID'sini ayıklayan fonksiyon
function getYoutubeID(url) {
    if (!url) return null;
    // URL içinden v=... kısmını bulur ve ID'yi çeker
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Poster URL'lerini normalize et
function normalizePosterUrl(posterUrl, baseUrl) {
    if (!posterUrl) return '';
    
    if (posterUrl.includes('data:image') || 
        posterUrl.includes('base64') || 
        posterUrl.includes('svg+xml') ||
        posterUrl.includes('placeholder') ||
        posterUrl.length < 5) {
        return '';
    }
    
    if (posterUrl.startsWith('http://') || posterUrl.startsWith('https://')) {
        return posterUrl;
    }
    
    if (posterUrl.startsWith('//')) {
        return `https:${posterUrl}`;
    }
    
    if (posterUrl.startsWith('/')) {
        return `${baseUrl}${posterUrl}`;
    }
    
    return `${baseUrl}/${posterUrl}`;
}

// Normalize fonksiyonu - Türkçe karakterleri normalize et
function normalize(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
        .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ı/g, 'i')
        .replace(/İ/g, 'i').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Slug'dan title çıkarma fonksiyonu
function slugToTitle(slug) {
    if (!slug) return '';
    return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/\d+/g, '') // Sayıları kaldır
        .replace(/\s+bolum\s+izle\s*/gi, '')
        .replace(/\s+izle\s*/gi, '')
        .replace(/\s+full\s*/gi, '')
        .replace(/\s+son\s+bolum\s*/gi, '')
        .trim();
}

// TvDiziler Search
async function TvDizilerSearch(query) {
    try {
        console.log(`[TvDiziler] Searching for: "${query}"`);
        
        const results = [];
        const seen = new Set();
        const searchLower = query.toLowerCase().trim();
        
        if (!searchLower || searchLower.length < 1) {
            return results;
        }
        
        // Arama terimini normalize et
        const searchNormalized = normalize(query);
        
        // 1. ÖNCE: Gerçek API endpoint'ini kullan
        try {
            const apiResponse = await axios.post(`${TVDIZILER_BASE_URL}/search?qr=${encodeURIComponent(query)}`, null, {
                headers: {
                    'accept': 'application/json, text/javascript, */*; q=0.01',
                    'x-requested-with': 'XMLHttpRequest',
                    'referer': `${TVDIZILER_BASE_URL}/home`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                timeout: 8000,
                cache: { ttl: 5 * 60 * 1000 } // 5 dakika cache
            });
            
            if (apiResponse && apiResponse.status === 200 && apiResponse.data && apiResponse.data.success === 1) {
                const htmlData = apiResponse.data.data || '';
                if (htmlData) {
                    const $ = cheerio.load(htmlData);
                    
                    // Dizi linklerini bul
                    $('a[href*="dizi/"]').each((i, element) => {
                        const $link = $(element);
                        const href = $link.attr('href');
                        
                        if (!href || href.includes('/tur/')) return;
                        
                        // Dizi slug'ını çıkar: dizi/zerhun-son-bolum-izle -> zerhun-son-bolum-izle
                        const diziMatch = href.match(/dizi\/([^\/\?#]+)/);
                        if (!diziMatch) return;
                        
                        const slug = diziMatch[1];
                        const uniqueKey = `series:${slug}`;
                        
                        if (seen.has(uniqueKey)) return;
                        seen.add(uniqueKey);
                        
                        // Title bul
                        let title = '';
                        const h2 = $link.find('h2').first();
                        if (h2.length > 0) {
                            title = h2.text().trim();
                        }
                        
                        if (!title) {
                            const img = $link.find('img').first();
                            if (img.length > 0) {
                                title = img.attr('alt') || img.attr('title') || '';
                            }
                        }
                        
                        if (!title) {
                            title = slugToTitle(slug);
                        }
                        
                        // Title temizle
                        title = title.replace(/Yayınlandı/g, '')
                                    .replace(/Sezon \d+/g, '')
                                    .replace(/Bölüm \d+/g, '')
                                    .replace(/\d{2}\s\w+\s\d{4}/g, '')
                                    .replace(/\s+izle\s*/gi, '')
                                    .replace(/\s+son\s+bolum\s*/gi, '')
                                    .replace(/\s+full\s*/gi, '')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                        
                        // Poster bul
                        let posterSrc = '';
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        }
                        
                        // Parent elementlerde poster ara
                        if (!posterSrc || posterSrc.length < 5) {
                            const $parent = $link.parent();
                            const parentImgs = $parent.find('img');
                            for (let j = 0; j < parentImgs.length; j++) {
                                const imgEl = $(parentImgs[j]);
                                const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
                                if (src && (src.includes('/uploads/series/') || src.includes('uploads/series/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                    if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                        posterSrc = src;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        const poster = normalizePosterUrl(posterSrc, TVDIZILER_BASE_URL);
                        
                        // Eşleşme kontrolü
                        const titleNormalized = normalize(title);
                        const slugNormalized = normalize(slug);
                        
                        const matches = titleNormalized.includes(searchNormalized) || 
                                       slugNormalized.includes(searchNormalized) ||
                                       searchNormalized.includes(titleNormalized) ||
                                       searchNormalized.includes(slugNormalized);
                        
                        if (matches && title && title.length > 2) {
                            results.push({
                                id: `tvdiziler-${slug}`,
                                title: title,
                                name: title,
                                url: `/dizi/${slug}`,
                                slug: slug,
                                poster: poster,
                                type: 'series',
                                genres: [],
                                source: 'TvDiziler'
                            });
                        }
                    });
                    
                    // Film linklerini bul
                    $('a[href*="film/"]').each((i, element) => {
                        const $link = $(element);
                        const href = $link.attr('href');
                        
                        if (!href || href.includes('/tur/')) return;
                        
                        const filmMatch = href.match(/film\/([^\/\?#]+)/);
                        if (!filmMatch) return;
                        
                        const slug = filmMatch[1];
                        const uniqueKey = `movie:${slug}`;
                        
                        if (seen.has(uniqueKey)) return;
                        seen.add(uniqueKey);
                        
                        // Title bul
                        let title = '';
                        const h2 = $link.find('h2').first();
                        if (h2.length > 0) {
                            title = h2.text().trim();
                        }
                        
                        if (!title) {
                            const img = $link.find('img').first();
                            if (img.length > 0) {
                                title = img.attr('alt') || img.attr('title') || '';
                            }
                        }
                        
                        if (!title) {
                            title = slugToTitle(slug);
                        }
                        
                        // Title temizle
                        title = title.replace(/Yayınlandı/g, '')
                                    .replace(/\s+izle\s*/gi, '')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                        
                        // Poster bul
                        let posterSrc = '';
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        }
                        
                        const poster = normalizePosterUrl(posterSrc, TVDIZILER_BASE_URL);
                        
                        // Eşleşme kontrolü
                        const titleNormalized = normalize(title);
                        const slugNormalized = normalize(slug);
                        
                        const matches = titleNormalized.includes(searchNormalized) || 
                                       slugNormalized.includes(searchNormalized) ||
                                       searchNormalized.includes(titleNormalized) ||
                                       searchNormalized.includes(slugNormalized);
                        
                        if (matches && title && title.length > 2) {
                            results.push({
                                id: `tvdiziler-${slug}`,
                                title: title,
                                name: title,
                                url: `/film/${slug}`,
                                slug: slug,
                                poster: poster,
                                type: 'movie',
                                genres: [],
                                source: 'TvDiziler'
                            });
                        }
                    });
                    
                    if (results.length > 0) {
                        console.log(`[TvDiziler] Found ${results.length} results from API`);
                        return results;
                    }
                }
            }
        } catch (apiError) {
            console.log(`[TvDiziler] API search error: ${apiError.message}`);
        }
        
        // 2. FALLBACK: Ana sayfadan arama (sayfa scraping)
        try {
            const homeResponse = await axios.get(`${TVDIZILER_BASE_URL}/home`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                timeout: 5000,
                cache: { ttl: 60 * 60 * 1000 }
            });
            
            if (homeResponse && homeResponse.status === 200 && homeResponse.data) {
                const $ = cheerio.load(homeResponse.data);
                
                // ÖNCE: Bölüm linklerinden dizi slug'larını çıkar (ana sayfada çok var)
                $('a[href*="-bolum-izle"]').each((i, element) => {
                    const $link = $(element);
                    const href = $link.attr('href');
                    
                    if (!href) return;
                    
                    // Bölüm linkinden dizi slug'ını çıkar
                    // Örnek: guller-ve-gunahlar-7-bolum-izle -> guller-ve-gunahlar-son-bolum-izle-1
                    const match = href.match(/([^-]+(?:-[^-]+)*)-\d+-bolum-izle(?:-full)?/);
                    if (!match) return;
                    
                    // Dizi slug'ını oluştur (genellikle slug-son-bolum-izle-1 formatında)
                    const baseSlug = match[1];
                    // Dizi sayfası slug'ını tahmin et (bazı sitelerde farklı formatlar olabilir)
                    const possibleSlugs = [
                        `${baseSlug}-son-bolum-izle-1`,
                        `${baseSlug}-izle-hd`,
                        `${baseSlug}`
                    ];
                    
                    // Her olası slug için kontrol et
                    for (const slug of possibleSlugs) {
                        const uniqueKey = `series:${slug}`;
                        if (seen.has(uniqueKey)) continue;
                        
                        // Title bul
                        let title = '';
                        const h2 = $link.find('h2').first();
                        if (h2.length > 0) {
                            title = h2.text().trim();
                        }
                        
                        if (!title) {
                            const img = $link.find('img').first();
                            if (img.length > 0) {
                                title = img.attr('alt') || img.attr('title') || '';
                            }
                        }
                        
                        // Title temizle
                        title = title.replace(/Yayınlandı/g, '')
                                    .replace(/Sezon \d+/g, '')
                                    .replace(/Bölüm \d+/g, '')
                                    .replace(/\d{2}\s\w+\s\d{4}/g, '')
                                    .replace(/\s+izle\s*/gi, '')
                                    .replace(/\s+son\s+bolum\s*/gi, '')
                                    .replace(/\s+full\s*/gi, '')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                        
                        if (!title || title.length < 2) {
                            title = slugToTitle(baseSlug);
                        }
                        
                        // Poster bul
                        let posterSrc = '';
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                        }
                        
                        // Parent elementlerde poster ara
                        if (!posterSrc || posterSrc.length < 5) {
                            const $parent = $link.parent();
                            const parentImgs = $parent.find('img');
                            for (let j = 0; j < parentImgs.length; j++) {
                                const imgEl = $(parentImgs[j]);
                                const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
                                if (src && (src.includes('/uploads/series/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                    if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                        posterSrc = src;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        const poster = normalizePosterUrl(posterSrc, TVDIZILER_BASE_URL);
                        
                        // Eşleşme kontrolü
                        const titleNormalized = normalize(title);
                        const slugNormalized = normalize(slug);
                        const baseSlugNormalized = normalize(baseSlug);
                        
                        const matches = titleNormalized.includes(searchNormalized) || 
                                       slugNormalized.includes(searchNormalized) ||
                                       baseSlugNormalized.includes(searchNormalized) ||
                                       searchNormalized.includes(titleNormalized) ||
                                       searchNormalized.includes(slugNormalized) ||
                                       searchNormalized.includes(baseSlugNormalized);
                        
                        if (matches && title && title.length > 2) {
                            seen.add(uniqueKey);
                            results.push({
                                id: `tvdiziler-${slug}`,
                                title: title,
                                name: title,
                                url: `/dizi/${slug}`,
                                slug: slug,
                                poster: poster,
                                type: 'series',
                                genres: [],
                                source: 'TvDiziler'
                            });
                            break; // İlk eşleşen slug'ı kullan
                        }
                    }
                });
                
                // SONRA: Dizi linklerini bul (/dizi/ ile başlayan)
                $('a[href*="/dizi/"]').each((i, element) => {
                    const $link = $(element);
                    const href = $link.attr('href');
                    
                    if (!href || href.includes('/tur/')) return;
                    
                    // Dizi slug'ını çıkar
                    const diziMatch = href.match(/\/dizi\/([^\/\?#]+)/);
                    if (!diziMatch) return;
                    
                    const slug = diziMatch[1];
                    const uniqueKey = `series:${slug}`;
                    
                    if (seen.has(uniqueKey)) return;
                    
                    // Title bul
                    let title = '';
                    const h2 = $link.find('h2').first();
                    if (h2.length > 0) {
                        title = h2.text().trim();
                    }
                    
                    // h2 yoksa img alt/title'dan al
                    if (!title) {
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            title = img.attr('alt') || img.attr('title') || '';
                        }
                    }
                    
                    // Link text'inden al
                    if (!title) {
                        title = $link.attr('title') || slugToTitle(slug);
                    }
                    
                    // Title temizle
                    title = title.replace(/Yayınlandı/g, '')
                                .replace(/Sezon \d+/g, '')
                                .replace(/Bölüm \d+/g, '')
                                .replace(/\d{2}\s\w+\s\d{4}/g, '')
                                .replace(/\s+izle\s*/gi, '')
                                .replace(/\s+son\s+bolum\s*/gi, '')
                                .replace(/\s+full\s*/gi, '')
                                .replace(/\n/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                    
                    // Poster bul
                    let posterSrc = '';
                    const img = $link.find('img').first();
                    if (img.length > 0) {
                        posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                    }
                    
                    // Parent elementlerde poster ara
                    if (!posterSrc || posterSrc.length < 5) {
                        const $parent = $link.parent();
                        const parentImgs = $parent.find('img');
                        for (let j = 0; j < parentImgs.length; j++) {
                            const imgEl = $(parentImgs[j]);
                            const src = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
                            if (src && (src.includes('/uploads/series/') || src.includes('.jpg') || src.includes('.png') || src.includes('.webp'))) {
                                if (!src.includes('svg') && !src.includes('base64') && !src.includes('data:image')) {
                                    posterSrc = src;
                                    break;
                                }
                            }
                        }
                    }
                    
                    const poster = normalizePosterUrl(posterSrc, TVDIZILER_BASE_URL);
                    
                    // Eşleşme kontrolü
                    const titleNormalized = normalize(title);
                    const slugNormalized = normalize(slug);
                    
                    const matches = titleNormalized.includes(searchNormalized) || 
                                   slugNormalized.includes(searchNormalized) ||
                                   searchNormalized.includes(titleNormalized) ||
                                   searchNormalized.includes(slugNormalized);
                    
                    if (matches && title && title.length > 2) {
                        seen.add(uniqueKey);
                        results.push({
                            id: `tvdiziler-${slug}`,
                            title: title,
                            name: title,
                            url: `/dizi/${slug}`,
                            slug: slug,
                            poster: poster,
                            type: 'series',
                            genres: [],
                            source: 'TvDiziler'
                        });
                    }
                });
                
                // Film linklerini bul
                $('a[href*="/film/"]').each((i, element) => {
                    const $link = $(element);
                    const href = $link.attr('href');
                    
                    if (!href || href.includes('/tur/')) return;
                    
                    // Film slug'ını çıkar
                    const filmMatch = href.match(/\/film\/([^\/\?#]+)/);
                    if (!filmMatch) return;
                    
                    const slug = filmMatch[1];
                    const uniqueKey = `movie:${slug}`;
                    
                    if (seen.has(uniqueKey)) return;
                    
                    // Title bul
                    let title = '';
                    const h2 = $link.find('h2').first();
                    if (h2.length > 0) {
                        title = h2.text().trim();
                    }
                    
                    if (!title) {
                        const img = $link.find('img').first();
                        if (img.length > 0) {
                            title = img.attr('alt') || img.attr('title') || '';
                        }
                    }
                    
                    if (!title) {
                        title = $link.attr('title') || slugToTitle(slug);
                    }
                    
                    // Title temizle
                    title = title.replace(/Yayınlandı/g, '')
                                .replace(/\s+izle\s*/gi, '')
                                .replace(/\n/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                    
                    // Poster bul
                    let posterSrc = '';
                    const img = $link.find('img').first();
                    if (img.length > 0) {
                        posterSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                    }
                    
                    const poster = normalizePosterUrl(posterSrc, TVDIZILER_BASE_URL);
                    
                    // Eşleşme kontrolü
                    const titleNormalized = normalize(title);
                    const slugNormalized = normalize(slug);
                    
                    const matches = titleNormalized.includes(searchNormalized) || 
                                   slugNormalized.includes(searchNormalized) ||
                                   searchNormalized.includes(titleNormalized) ||
                                   searchNormalized.includes(slugNormalized);
                    
                    if (matches && title && title.length > 2) {
                        seen.add(uniqueKey);
                        results.push({
                            id: `tvdiziler-${slug}`,
                            title: title,
                            name: title,
                            url: `/film/${slug}`,
                            slug: slug,
                            poster: poster,
                            type: 'movie',
                            genres: [],
                            source: 'TvDiziler'
                        });
                    }
                });
            }
        } catch (homeError) {
            console.log(`[TvDiziler] Homepage search error: ${homeError.message}`);
        }
        
        console.log(`[TvDiziler] Found ${results.length} results`);
        return results;
    } catch (error) {
        console.log(`[TvDiziler] Search error: ${error.message}`);
    }
    return [];
}

// TvDiziler Get Series Meta
async function TvDizilerGetSeriesMeta(seriesId) {
    try {
        // seriesId formatı: tvdiziler-slug -> slug
        const slug = seriesId.replace('tvdiziler-', '');
        console.log(`[TvDiziler] Fetching series meta for: ${slug}`);
        
        const url = `${TVDIZILER_BASE_URL}/dizi/${slug}`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 8000,
            cache: { ttl: 30 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const $ = cheerio.load(response.data);
            
            // İsim
            let name = '';
            const h1 = $('h1').first();
            if (h1.length > 0) {
                name = h1.text().trim().replace(/\s*\([^)]*\)\s*$/, '').trim(); // Yıl parantezini kaldır
            } else {
                const title = $('title').first();
                if (title.length > 0) {
                    name = title.text().trim().replace(/\s*-\s*Tvdiziler\.cc.*$/i, '').trim();
                } else {
                    name = slugToTitle(slug);
                }
            }
            
            // Poster - /uploads/series/ içeren ama thumb içermeyen img'leri bul
            let poster = '';
            const allImgs = $('img');
            for (let i = 0; i < allImgs.length; i++) {
                const img = $(allImgs[i]);
                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
                // Relative URL'leri de kontrol et (uploads/series/ ile başlayan)
                if (src && (src.includes('/uploads/series/') || src.includes('uploads/series/')) && !src.includes('thumb') && !src.includes('cover/cat')) {
                    poster = src;
                    break;
                }
            }
            
            // Background (poster ile aynı olabilir)
            let background = poster;
            
            // Açıklama
            let description = '';
            const desc = $('p').filter((i, el) => {
                const text = $(el).text();
                return text.length > 50 && !text.includes('@admin');
            }).first();
            if (desc.length > 0) {
                description = desc.text().trim();
            }
            
            // Sezon sayısı - bölüm linklerinden çıkar
            let season = 1;
            const bolumLinks = $('a[href*="-bolum-izle"]');
            const seasonSet = new Set();
            bolumLinks.each((i, el) => {
                const href = $(el).attr('href');
                // URL formatı: slug-{episode}-bolum-izle veya slug-{episode}-bolum-izle-full
                // Sezon bilgisi genellikle sayfada "Sezon 1" gibi görünür
            });
            
            // Sezon bilgisini sayfadan çıkar
            const seasonText = $('*:contains("Sezon")').first().text();
            const seasonMatch = seasonText.match(/Sezon\s*(\d+)/i);
            if (seasonMatch) {
                season = parseInt(seasonMatch[1]);
            }
            
            // Yıl
            let year = '';
            const yearMatch = name.match(/\((\d{4})\)/) || response.data.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
                year = yearMatch[1] || yearMatch[0];
            }
            
            // IMDb rating
            let imdbRating = 0;
            const imdbText = $('*:contains("IMDb")').parent().text() || '';
            const imdbMatch = imdbText.match(/IMDb[:\s]+(\d+\.?\d*)/i);
            if (imdbMatch) {
                imdbRating = parseFloat(imdbMatch[1]) || 0;
            }
            
            poster = normalizePosterUrl(poster, TVDIZILER_BASE_URL);
            background = normalizePosterUrl(background, TVDIZILER_BASE_URL);
            
            return {
                name: name,
                background: background || poster,
                poster: poster || background,
                country: 'TR',
                season: season,
                imdbRating: imdbRating,
                description: description || `${name} izle - ücretsiz 1080p | TvDiziler.cc`,
                releaseInfo: year,
                runtime: undefined
            };
        }
    } catch (error) {
        console.log(`[TvDiziler] Series meta error: ${error.message}`);
    }
    return null;
}

// TvDiziler Get Episodes
async function TvDizilerGetEpisodes(seriesId, seasonNum) {
    try {
        const slug = seriesId.replace('tvdiziler-', '');
        console.log(`[TvDiziler] Fetching episodes for: ${slug}, season: ${seasonNum}`);
        
        const url = `${TVDIZILER_BASE_URL}/dizi/${slug}`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 8000,
            cache: { ttl: 30 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const $ = cheerio.load(response.data);
            const episodes = [];
            
            // Bölüm linklerini bul - format: slug-{episode}-bolum-izle veya slug-{episode}-bolum-izle-full
            const episodeLinks = $('a[href*="-bolum-izle"]');
            console.log(`[TvDiziler] Total bolum links: ${episodeLinks.length}`);
            
            const seenEpisodes = new Set(); // Duplicate kontrolü için
            
            episodeLinks.each((i, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                
                // URL formatı: slug-{episode}-bolum-izle veya slug-{episode}-bolum-izle-full
                // Örnek: guller-ve-gunahlar-7-bolum-izle
                const match = href.match(/([^-]+(?:-[^-]+)*)-(\d+)-bolum-izle(?:-full)?/);
                if (match) {
                    const episode = parseInt(match[2]);
                    const episodeKey = `${seasonNum}-${episode}`;
                    
                    // Duplicate kontrolü
                    if (seenEpisodes.has(episodeKey)) return;
                    seenEpisodes.add(episodeKey);
                    
                    // Sezon kontrolü - şimdilik tüm bölümleri al (sezon bilgisi sayfada yok)
                    let title = $(el).text().trim();
                    // Title temizle
                    title = title.replace(/Dizinin İlk Bölümünü İzle/gi, '')
                                .replace(/Dizinin Son Bölümünü İzle/gi, '')
                                .replace(/\s+izle\s*/gi, '')
                                .replace(/\s+full\s*/gi, '')
                                .replace(/\n/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                    
                    if (!title || title.length < 3) {
                        title = `Bölüm ${episode}`;
                    }
                    
                    const episodeId = href.startsWith('/') ? href : `/${href}`;
                    
                    // Thumbnail'ı bulmaya çalış
                    let thumbnail = '';
                    const img = $(el).find('img').first();
                    if (img.length > 0) {
                        thumbnail = img.attr('src') || img.attr('data-src') || '';
                    }
                    
                    episodes.push({
                        id: episodeId,
                        season: seasonNum, // Varsayılan olarak istenen sezon
                        episode: episode,
                        title: title,
                        thumbnail: thumbnail
                    });
                }
            });
            
            console.log(`[TvDiziler] Processed ${episodes.length} episodes for season ${seasonNum}`);
            // Bölümleri episode numarasına göre sırala
            episodes.sort((a, b) => a.episode - b.episode);
            console.log(`[TvDiziler] Found ${episodes.length} episodes for season ${seasonNum}`);
            return episodes;
        }
    } catch (error) {
        console.error(`[TvDiziler] Get Episodes error for ${seriesId}, season ${seasonNum}: ${error.message}`);
    }
    return [];
}

// TvDiziler Get Video URL
async function TvDizilerGetVideoUrl(episodeUrl) {
    try {
        console.log(`[TvDiziler] Fetching video URL from: ${episodeUrl}`);
        
        // URL'yi tam URL'ye çevir
        const fullUrl = episodeUrl.startsWith('http') ? episodeUrl : `${TVDIZILER_BASE_URL}${episodeUrl.startsWith('/') ? episodeUrl : '/' + episodeUrl}`;
        
        const response = await axios.get(fullUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': TVDIZILER_BASE_URL
            },
            timeout: 10000,
            cache: { ttl: 10 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const $ = cheerio.load(response.data);
            
            // ÖNCE: YouTube URL'lerini kontrol et
            const youtubePatterns = [
                /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/g,
                /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/g,
                /youtu\.be\/([a-zA-Z0-9_-]+)/g
            ];
            
            let youtubeVideoId = null;
            let youtubeUrl = null;
            
            // HTML içinde YouTube URL'lerini ara
            for (const pattern of youtubePatterns) {
                const matches = response.data.matchAll(pattern);
                for (const match of matches) {
                    if (match[1]) {
                        youtubeVideoId = match[1];
                        // YouTube watch URL'sini oluştur
                        youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
                        console.log(`[TvDiziler] Found YouTube video: ${youtubeUrl}`);
                        break;
                    }
                }
                if (youtubeUrl) break;
            }
            
            // Iframe içinde YouTube URL'lerini ara
            if (!youtubeUrl) {
                const iframes = $('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    const iframeSrc = $(iframes[i]).attr('src') || '';
                    if (iframeSrc) {
                        // Iframe src içinde YouTube URL'si var mı?
                        for (const pattern of youtubePatterns) {
                            const match = iframeSrc.match(pattern);
                            if (match && match[1]) {
                                youtubeVideoId = match[1];
                                youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
                                console.log(`[TvDiziler] Found YouTube video in iframe: ${youtubeUrl}`);
                                break;
                            }
                        }
                        // Iframe src içinde /vid/kapat/?git= parametresi var mı? (YouTube URL içerebilir)
                        if (!youtubeUrl && iframeSrc.includes('/vid/kapat/')) {
                            const gitMatch = iframeSrc.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/i);
                            if (gitMatch && gitMatch[1]) {
                                youtubeVideoId = gitMatch[1];
                                youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
                                console.log(`[TvDiziler] Found YouTube video in iframe git param: ${youtubeUrl}`);
                            }
                        }
                        if (youtubeUrl) break;
                    }
                }
            }
            
            // Link içinde YouTube URL'lerini ara
            if (!youtubeUrl) {
                const links = $('a[href*="youtube"]');
                for (let i = 0; i < links.length; i++) {
                    const href = $(links[i]).attr('href') || '';
                    if (href) {
                        for (const pattern of youtubePatterns) {
                            const match = href.match(pattern);
                            if (match && match[1]) {
                                youtubeVideoId = match[1];
                                youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
                                console.log(`[TvDiziler] Found YouTube video in link: ${youtubeUrl}`);
                                break;
                            }
                        }
                        if (youtubeUrl) break;
                    }
                }
            }
            
            // Eğer YouTube URL bulunduysa, Stremio için ytId formatında döndür
            if (youtubeUrl) {
                console.log(`[TvDiziler] YouTube URL found: ${youtubeUrl}`);
                const youtubeId = getYoutubeID(youtubeUrl);
                if (youtubeId) {
                    console.log(`[TvDiziler] Extracted YouTube ID: ${youtubeId}`);
                    // Stremio için ytId formatında döndür
                    return { ytId: youtubeId, subtitles: [] };
                } else {
                    console.log(`[TvDiziler] Could not extract YouTube ID from URL: ${youtubeUrl}`);
                    // YouTube ID çıkarılamazsa normal video URL aramasına devam et
                }
            }
            
            // YouTube yoksa normal video URL aramasına devam et
            // Iframe src'yi bul - format: /vid/ply/{hash} veya vid/ply/{hash}
            let iframe = $('iframe[src*="/vid/ply/"]').first();
            if (iframe.length === 0) {
                // Alternatif: vid/ply/ içeren iframe
                iframe = $('iframe[src*="vid/ply/"]').first();
            }
            let iframeSrc = iframe.attr('src') || iframe.attr('data-src') || '';
            
            // Eğer iframe bulunamadıysa HTML içinde direkt ara
            if (!iframeSrc) {
                const vidPlyMatch = response.data.match(/["']([^"']*\/vid\/ply\/[^"']*)["']/i);
                if (vidPlyMatch && vidPlyMatch[1]) {
                    iframeSrc = vidPlyMatch[1];
                }
            }
            
            // Eğer relative URL ise tam URL'ye çevir
            if (iframeSrc) {
                if (iframeSrc.startsWith('/')) {
                    iframeSrc = `${TVDIZILER_BASE_URL}${iframeSrc}`;
                } else if (iframeSrc.startsWith('vid/')) {
                    iframeSrc = `${TVDIZILER_BASE_URL}/${iframeSrc}`;
                } else if (!iframeSrc.startsWith('http')) {
                    iframeSrc = `${TVDIZILER_BASE_URL}/${iframeSrc}`;
                }
            }
            
            if (iframeSrc) {
                console.log(`[TvDiziler] Found iframe: ${iframeSrc}`);
                
                // Iframe içindeki video URL'sini çek
                const iframeResponse = await axios.get(iframeSrc, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Referer': fullUrl
                    },
                    timeout: 15000
                });
                
                if (iframeResponse && iframeResponse.status === 200) {
                    const $iframe = cheerio.load(iframeResponse.data);
                    
                    // Script içinde video URL'lerini ara
                    const scripts = $iframe('script');
                    let videoUrl = null;
                    
                    for (let i = 0; i < scripts.length; i++) {
                        const scriptContent = $iframe(scripts[i]).html() || '';
                        if (scriptContent.length > 100) {
                            // Playerjs pattern: file:"url" veya file: "url"
                            const playerjsMatch = scriptContent.match(/file["\s:=]+["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                            if (playerjsMatch) {
                                videoUrl = playerjsMatch[1];
                                console.log(`[TvDiziler] Found video URL (playerjs) in script: ${videoUrl.substring(0, 100)}...`);
                                break;
                            }
                            
                            // master.m3u8 URL'lerini ara
                            const m3u8Match = scriptContent.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
                            if (m3u8Match) {
                                videoUrl = m3u8Match[1];
                                console.log(`[TvDiziler] Found video URL (m3u8) in script: ${videoUrl.substring(0, 100)}...`);
                                break;
                            }
                            
                            // .m3u8 URL'lerini ara (master olmayan)
                            const m3u8GeneralMatch = scriptContent.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i);
                            if (m3u8GeneralMatch) {
                                videoUrl = m3u8GeneralMatch[1];
                                console.log(`[TvDiziler] Found video URL (m3u8 general) in script: ${videoUrl.substring(0, 100)}...`);
                                break;
                            }
                            
                            // .mp4 URL'lerini ara
                            const mp4Match = scriptContent.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i);
                            if (mp4Match) {
                                videoUrl = mp4Match[1];
                                console.log(`[TvDiziler] Found video URL (mp4) in script: ${videoUrl.substring(0, 100)}...`);
                                break;
                            }
                        }
                    }
                    
                    // HTML içinde direkt video URL ara (script dışında)
                    if (!videoUrl) {
                        // HTML içinde m3u8 URL'leri ara
                        const htmlM3u8Match = iframeResponse.data.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i);
                        if (htmlM3u8Match) {
                            videoUrl = htmlM3u8Match[1];
                            console.log(`[TvDiziler] Found video URL (m3u8) in HTML: ${videoUrl.substring(0, 100)}...`);
                        }
                        
                        // HTML içinde mp4 URL'leri ara
                        if (!videoUrl) {
                            const htmlMp4Match = iframeResponse.data.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i);
                            if (htmlMp4Match) {
                                videoUrl = htmlMp4Match[1];
                                console.log(`[TvDiziler] Found video URL (mp4) in HTML: ${videoUrl.substring(0, 100)}...`);
                            }
                        }
                    }
                    
                    if (videoUrl && videoUrl.startsWith('http')) {
                        return { url: videoUrl, subtitles: [] };
                    }
                }
            }
            
            // Fallback: Ana sayfada script içinde direkt video URL ara
            const scripts = $('script');
            for (let i = 0; i < scripts.length; i++) {
                const scriptContent = $(scripts[i]).html() || '';
                if (scriptContent.length > 100) {
                    // Playerjs pattern
                    const playerjsMatch = scriptContent.match(/file["\s:=]+["']([^"']+\.(m3u8|mp4)[^"']*)["']/i);
                    if (playerjsMatch) {
                        return { url: playerjsMatch[1], subtitles: [] };
                    }
                    
                    // m3u8 URL'leri
                    const m3u8Match = scriptContent.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i);
                    if (m3u8Match) {
                        return { url: m3u8Match[1], subtitles: [] };
                    }
                    
                    // mp4 URL'leri
                    const mp4Match = scriptContent.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i);
                    if (mp4Match) {
                        return { url: mp4Match[1], subtitles: [] };
                    }
                }
            }
        }
    } catch (error) {
        console.log(`[TvDiziler] Video URL error: ${error.message}`);
    }
    return null;
}

module.exports = { 
    TvDizilerSearch,
    TvDizilerGetSeriesMeta,
    TvDizilerGetEpisodes,
    TvDizilerGetVideoUrl
};

