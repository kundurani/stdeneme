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

async function SearchMovieAndSeries(name) {
    try {
        const activeDomain = await detectActiveDomain();
        const proxyUrl = process.env.PROXY_URL || `https://${activeDomain}`;
        
        console.log(`Searching for: "${name}" on ${proxyUrl}`);
        
        // Ana sayfayı çek - Daha hızlı timeout
        const response = await axios.get(proxyUrl, {
            ...sslfix,
            headers: header,
            timeout: 8000, // 8 saniye - daha hızlı
            cache: {
                ttl: 60 * 60 * 1000 // 1 saat cache
            }
        });
        
        if (response && response.status === 200 && response.data) {
            const $ = cheerio.load(response.data);
            const results = [];
            const seen = new Set();
            
            // Tüm dizi linklerini bul
            $('a[href]').each((i, element) => {
                const href = $(element).attr('href');
                
                if (href && href.includes('/dizi/') && !href.includes('/sezon-') && !href.includes('/bolum-')) {
                    // URL'den slug çıkar
                    const urlMatch = href.match(/\/dizi\/([^\/\?#]+)/);
                    if (urlMatch) {
                        const slug = urlMatch[1];
                        
                        // Zaten eklendiyse atla
                        if (seen.has(slug)) return;
                        
                        // Title bul - img alt attribute en temiz veri
                        const img = $(element).find('img');
                        let title = '';
                        
                        if (img.length > 0) {
                            title = img.attr('alt') || img.attr('title') || '';
                        }
                        
                        if (!title) {
                            title = $(element).attr('title') || $(element).text().trim();
                        }
                        
                        // Gereksiz kelimeleri temizle
                        title = title.replace(/Yayınlandı/g, '')
                                    .replace(/Sezon \d+/g, '')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                        
                        // Poster bul
                        const poster = img.attr('src') || img.attr('data-src') || '';
                        
                        if (title) {
                            // Arama terimiyle eşleşiyor mu?
                            const searchLower = name.toLowerCase();
                            const titleLower = title.toLowerCase();
                            
                            if (titleLower.includes(searchLower) || slug.toLowerCase().includes(searchLower)) {
                                seen.add(slug);
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
                }
            });
            
            console.log(`Search "${name}" found ${results.length} results`);
            return results;
        }
    } catch (error) {
        console.log('Search error:', error.message);
    }
    return [];
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
            
            // Poster/Background
            const poster = $('img[src*="/uploads/series/"]').first().attr('src') ||
                          $('img[data-src*="/uploads/series/"]').first().attr('data-src') ||
                          '';
            
            // IMDb rating
            const imdbText = $('*:contains("IMDb")').parent().text() || '';
            const imdbMatch = imdbText.match(/(\d+\.?\d*)/);
            const imdb = imdbMatch ? imdbMatch[1] : '0';
            
            // Açıklama
            const description = $('p').filter((i, el) => {
                const text = $(el).text();
                return text.length > 50;
            }).first().text().trim();
            
            // Sezon sayısı - HIZLI YÖNTEM
            let season = 1;
            
            // Sezon linklerinden maksimum sezon numarasını bul
            const allSeasonMatches = response.data.match(/sezon-(\d+)/g);
            if (allSeasonMatches && allSeasonMatches.length > 0) {
                const seasonNumbers = allSeasonMatches.map(m => parseInt(m.match(/\d+/)[0]));
                season = Math.max(...seasonNumbers);
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
            
            metaObj = {
                name: name,
                background: poster,
                country: country,
                season: season,
                imdbRating: parseFloat(imdb) || 0,
                description: description,
                releaseInfo: releaseInfo,
            };
            
            console.log(`Meta found: ${name}, ${season} seasons`);
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
        } else {
            return [{
                id: id
            }];
        }
    } catch (error) {
        console.log('Detail search error:', error.message);
    }
    return [];
}

module.exports = { SearchMovieAndSeries, SearchMetaMovieAndSeries, SearchDetailMovieAndSeries, detectActiveDomain };

