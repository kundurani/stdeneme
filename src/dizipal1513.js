require("dotenv").config();
const Axios = require('axios');
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");
const cheerio = require('cheerio');

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

// Dizipal1513 Base URL
const DIZIPAL1513_BASE_URL = 'https://dizipal1513.com';

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

// Dizipal1513 Search
async function Dizipal1513Search(query) {
    try {
        console.log(`[Dizipal1513] Searching for: "${query}"`);
        
        // Önce ana sayfayı alarak cKey ve cValue'yu al
        const homeResponse = await axios.get(DIZIPAL1513_BASE_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000
        });
        
        let cKey = 'ca1d4a53d0f4761a949b85e51e18f096'; // Default değer
        let cValue = '';
        
        if (homeResponse && homeResponse.data) {
            const $home = cheerio.load(homeResponse.data);
            // Form'dan cKey ve cValue'yu al
            const cKeyInput = $home('input[name="cKey"]').attr('value');
            const cValueInput = $home('input[name="cValue"]').attr('value');
            if (cKeyInput) cKey = cKeyInput;
            if (cValueInput) cValue = cValueInput;
        }
        
        // POST /bg/searchcontent
        const url = `${DIZIPAL1513_BASE_URL}/bg/searchcontent`;
        const body = `cKey=${encodeURIComponent(cKey)}&cValue=${encodeURIComponent(cValue)}&type=hepsi&searchterm=${encodeURIComponent(query)}`;
        
        const response = await axios.post(url, body, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': DIZIPAL1513_BASE_URL
            },
            timeout: 5000,
            cache: { ttl: 60 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const results = [];
            const seen = new Set();
            
            // Response JSON veya HTML olabilir
            let searchData = response.data;
            
            // JSON response kontrolü
            if (typeof searchData === 'string') {
                try {
                    searchData = JSON.parse(searchData);
                } catch (e) {
                    // JSON değilse HTML olarak işle
                }
            }
            
            // JSON response ise - API formatı: { data: { state: true, result: [...] } }
            if (typeof searchData === 'object' && searchData !== null) {
                // API response formatı: { data: { state: true, result: [...] } }
                if (searchData.data && searchData.data.result && Array.isArray(searchData.data.result)) {
                    searchData.data.result.forEach(item => {
                        if (item && item.used_slug) {
                            const slugMatch = item.used_slug.match(/(series|movie|dizi|film)\/([^\/\?#]+)/);
                            if (slugMatch) {
                                const slug = slugMatch[2];
                                const type = (slugMatch[1] === 'series' || slugMatch[1] === 'dizi') ? 'series' : 'movie';
                                const uniqueKey = `${type}:${slug}`;
                                
                                if (!seen.has(uniqueKey)) {
                                    seen.add(uniqueKey);
                                    
                                    // Poster URL oluştur
                                    let poster = '';
                                    if (item.object_related_imdb_id) {
                                        // IMDB ID'den poster oluştur
                                        poster = `https://images.cdnhipter.xyz/images/tv/poster/360/540/80/${item.object_related_imdb_id}.jpg?v=3.645`;
                                    }
                                    
                                    results.push({
                                        id: `dizipal1513-${slug}`,
                                        title: item.object_name || slug,
                                        name: item.object_name || slug,
                                        url: `${DIZIPAL1513_BASE_URL}/${item.used_slug}`,
                                        slug: slug,
                                        poster: poster,
                                        type: type,
                                        genres: [],
                                        year: item.object_release_year || '',
                                        source: 'Dizipal1513'
                                    });
                                }
                            }
                        }
                    });
                }
            }
            
            console.log(`[Dizipal1513] Found ${results.length} results`);
            return results;
        }
    } catch (error) {
        console.log(`[Dizipal1513] Search error: ${error.message}`);
    }
    return [];
}

// Dizipal1513 Get Series Meta
async function Dizipal1513GetSeriesMeta(seriesId) {
    try {
        // seriesId formatı: dizipal1513-slug -> slug
        const slug = seriesId.replace('dizipal1513-', '');
        console.log(`[Dizipal1513] Fetching series meta for: ${slug}`);
        
        const url = `${DIZIPAL1513_BASE_URL}/series/${slug}`;
        
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
            const title = $('title').first();
            if (h1.length > 0) {
                name = h1.text().trim();
            } else if (title.length > 0) {
                name = title.text().trim().replace(/\s*-\s*Dizipal.*$/i, '').trim();
            } else {
                name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
            
            // Poster
            let poster = '';
            const posterImg = $('img[src*="poster"], img[src*="images"], .poster img, .series-poster img').first();
            if (posterImg.length > 0) {
                poster = posterImg.attr('src') || posterImg.attr('data-src') || '';
            }
            
            // Background
            let background = '';
            const bgImg = $('img[src*="backdrop"], img[src*="brand"], .background img').first();
            if (bgImg.length > 0) {
                background = bgImg.attr('src') || bgImg.attr('data-src') || '';
            }
            
            // Açıklama
            let description = '';
            const desc = $('.description, .content, [itemprop="description"]').first();
            if (desc.length > 0) {
                description = desc.text().trim();
            }
            
            // Sezon sayısı - bölüm linklerinden çıkar
            let season = 1;
            const bolumLinks = $('a[href*="/bolum/"]');
            const seasonSet = new Set();
            bolumLinks.each((i, el) => {
                const href = $(el).attr('href');
                const match = href.match(/bolum\/[^-]+-(\d+)x\d+/);
                if (match) {
                    seasonSet.add(parseInt(match[1]));
                }
            });
            if (seasonSet.size > 0) {
                season = Math.max(...Array.from(seasonSet));
            }
            
            // Yıl
            let year = '';
            const yearMatch = description.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
                year = yearMatch[0];
            }
            
            poster = normalizePosterUrl(poster, DIZIPAL1513_BASE_URL);
            background = normalizePosterUrl(background, DIZIPAL1513_BASE_URL);
            
            return {
                name: name,
                background: background || poster,
                poster: poster || background,
                country: 'TR',
                season: season,
                imdbRating: 0,
                description: description || `${name} izle - ücretsiz 1080p | Dizipal izle`,
                releaseInfo: year,
                runtime: undefined
            };
        }
    } catch (error) {
        console.log(`[Dizipal1513] Series meta error: ${error.message}`);
    }
    return null;
}

// Dizipal1513 Get Episodes
async function Dizipal1513GetEpisodes(seriesId, seasonNum) {
    try {
        const slug = seriesId.replace('dizipal1513-', '');
        console.log(`[Dizipal1513] Fetching episodes for: ${slug}, season: ${seasonNum}`);
        
        const url = `${DIZIPAL1513_BASE_URL}/series/${slug}`;
        
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
            
            // Bölüm linklerini bul
            const episodeLinks = $('a[href*="/bolum/"]');
            console.log(`[Dizipal1513] Total links: ${$('a').length}, Bolum links: ${episodeLinks.length}`);
            
            episodeLinks.each((i, el) => {
                const href = $(el).attr('href');
                if (!href) return;
                
                // Regex: /bolum/slug-{season}x{episode} formatını yakala
                const match = href.match(/\/bolum\/[^-]+-(\d+)x(\d+)/);
                if (match) {
                    const season = parseInt(match[1]);
                    const episode = parseInt(match[2]);
                    
                    if (season === seasonNum) {
                        const title = $(el).text().trim();
                        const episodeId = href.replace(DIZIPAL1513_BASE_URL, ''); // Sadece path'i al
                        
                        // Thumbnail'ı bulmaya çalış
                        let thumbnail = '';
                        const img = $(el).find('img').first();
                        if (img.length > 0) {
                            thumbnail = img.attr('src') || img.attr('data-src') || '';
                        }
                        
                        episodes.push({
                            id: episodeId,
                            season: season,
                            episode: episode,
                            title: title,
                            thumbnail: thumbnail
                        });
                    }
                }
            });
            
            console.log(`[Dizipal1513] Processed ${episodes.length} episodes for season ${seasonNum}`);
            // Bölümleri episode numarasına göre sırala
            episodes.sort((a, b) => a.episode - b.episode);
            console.log(`[Dizipal1513] Found ${episodes.length} episodes for season ${seasonNum}`);
            return episodes;
        }
    } catch (error) {
        console.error(`[Dizipal1513] Get Episodes error for ${seriesId}, season ${seasonNum}: ${error.message}`);
    }
    return [];
}

// Dizipal1513 Get Video URL
async function Dizipal1513GetVideoUrl(episodeUrl) {
    try {
        console.log(`[Dizipal1513] Fetching video URL from: ${episodeUrl}`);
        
        const response = await axios.get(episodeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': DIZIPAL1513_BASE_URL
            },
            timeout: 10000,
            cache: { ttl: 10 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const $ = cheerio.load(response.data);
            
            // Iframe src'yi bul - sn.dplayer82.site formatında
            const iframe = $('iframe').first();
            let iframeSrc = iframe.attr('src') || iframe.attr('data-src') || '';
            
            // Script içinde iframe URL'sini ara (JavaScript ile dinamik yükleniyor olabilir)
            if (!iframeSrc) {
                const scripts = $('script');
                for (let i = 0; i < scripts.length; i++) {
                    const scriptContent = $(scripts[i]).html() || '';
                    if (scriptContent.length > 50) {
                        // Daha geniş pattern'ler - sn.dplayer82.site veya four.dplayer82.site
                        const patterns = [
                            /(https?:\/\/[^"'\s]+dplayer[^"'\s]+iframe\.php\?v=[^"'\s&]+)/,
                            /(https?:\/\/[^"'\s]+iframe\.php\?v=[^"'\s&]+)/,
                            /iframe\.php\?v=([^"'\s&]+)/
                        ];
                        
                        for (const pattern of patterns) {
                            const match = scriptContent.match(pattern);
                            if (match) {
                                iframeSrc = match[1] || match[0];
                                // Eğer sadece parametre varsa, base URL ekle
                                if (!iframeSrc.startsWith('http')) {
                                    const baseMatch = scriptContent.match(/(https?:\/\/[^"'\s]+dplayer[^"'\s]+)/);
                                    if (baseMatch) {
                                        iframeSrc = `${baseMatch[1]}iframe.php?v=${iframeSrc}`;
                                    } else {
                                        // Varsayılan olarak sn.dplayer82.site kullan
                                        iframeSrc = `https://sn.dplayer82.site/iframe.php?v=${iframeSrc}`;
                                    }
                                }
                                console.log(`[Dizipal1513] Found iframe in script: ${iframeSrc.substring(0, 100)}...`);
                                break;
                            }
                        }
                        if (iframeSrc) break;
                    }
                }
            }
            
            if (iframeSrc) {
                console.log(`[Dizipal1513] Found iframe: ${iframeSrc}`);
                
                // Iframe içindeki video URL'sini çek
                const iframeResponse = await axios.get(iframeSrc, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Referer': episodeUrl
                    },
                    timeout: 15000
                });
                
                if (iframeResponse && iframeResponse.status === 200) {
                    const $iframe = cheerio.load(iframeResponse.data);
                    const baseUrl = iframeSrc.match(/(https?:\/\/[^\/]+)/);
                    const baseUrlStr = baseUrl ? baseUrl[1] : '';
                    
                    // 1. source2.php, l.php veya ld.php endpoint'lerini kontrol et
                    const scripts = $iframe('script');
                    let videoUrl = null;
                    
                    // Script'leri for loop ile işle (await için)
                    for (let i = 0; i < scripts.length; i++) {
                        const scriptContent = $iframe(scripts[i]).html() || '';
                        if (scriptContent.length > 100) {
                            // source2.php, l.php veya ld.php bul
                            const source2Match = scriptContent.match(/source2\.php\?v=([^"'\s&]+)/);
                            const lMatch = scriptContent.match(/l\.php\?v=([^"'\s&]+)/);
                            const ldMatch = scriptContent.match(/ld\.php\?v=([^"'\s&]+)/);
                            
                            // Öncelik sırası: source2.php > l.php > ld.php
                            let param = null;
                            let endpoint = null;
                            
                            if (source2Match) {
                                param = source2Match[1];
                                endpoint = 'source2.php';
                            } else if (lMatch) {
                                param = lMatch[1];
                                endpoint = 'l.php';
                            } else if (ldMatch) {
                                param = ldMatch[1];
                                endpoint = 'ld.php';
                            }
                            
                            if (param && endpoint) {
                                const apiUrl = `${baseUrlStr}/${endpoint}?v=${param}`;
                                
                                console.log(`[Dizipal1513] Found API endpoint: ${apiUrl.substring(0, 100)}...`);
                                
                                // API'yi çağır
                                try {
                                    const apiResponse = await axios.get(apiUrl, {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                            'Accept': '*/*',
                                            'Referer': iframeSrc
                                        },
                                        timeout: 10000
                                    });
                                    
                                    // API response'da master.m3u8 ara
                                    const m3u8Match = apiResponse.data.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
                                    if (m3u8Match) {
                                        videoUrl = m3u8Match[1];
                                        console.log(`[Dizipal1513] Found video URL from API: ${videoUrl.substring(0, 100)}...`);
                                        break;
                                    }
                                } catch (e) {
                                    console.log(`[Dizipal1513] API error: ${e.message}`);
                                }
                            }
                            
                            // Direkt master.m3u8 ara (script içinde)
                            if (!videoUrl) {
                                const m3u8Match = scriptContent.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
                                if (m3u8Match) {
                                    videoUrl = m3u8Match[1];
                                    console.log(`[Dizipal1513] Found video URL in script: ${videoUrl.substring(0, 100)}...`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    // 2. HTML içinde direkt master.m3u8 ara
                    if (!videoUrl) {
                        const m3u8Patterns = [
                            /(https?:\/\/[^\s"']+master\.m3u8\?v=[^\s"']+)/i,
                            /(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i,
                            /master\.m3u8\?v=([^"'\s&]+)/i
                        ];
                        
                        for (const pattern of m3u8Patterns) {
                            const match = iframeResponse.data.match(pattern);
                            if (match) {
                                let foundUrl = match[1] || match[0];
                                
                                // Eğer sadece parametre varsa, base URL ekle
                                if (!foundUrl.startsWith('http')) {
                                    foundUrl = `${baseUrlStr}/master.m3u8?v=${foundUrl}`;
                                }
                                
                                if (foundUrl.startsWith('http')) {
                                    videoUrl = foundUrl;
                                    console.log(`[Dizipal1513] Found video URL in HTML: ${videoUrl.substring(0, 100)}...`);
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (videoUrl && videoUrl.startsWith('http')) {
                        return { url: videoUrl, subtitles: [] };
                    }
                }
            }
            
            // Fallback: Script içinde direkt video URL ara
            const scripts = $('script');
            for (let i = 0; i < scripts.length; i++) {
                const scriptContent = $(scripts[i]).html() || '';
                const m3u8Match = scriptContent.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
                const mp4Match = scriptContent.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/);
                
                if (m3u8Match) {
                    return { url: m3u8Match[1], subtitles: [] };
                }
                if (mp4Match) {
                    return { url: mp4Match[1], subtitles: [] };
                }
            }
        }
    } catch (error) {
        console.log(`[Dizipal1513] Video URL error: ${error.message}`);
    }
    return null;
}

module.exports = { 
    Dizipal1513Search,
    Dizipal1513GetSeriesMeta,
    Dizipal1513GetEpisodes,
    Dizipal1513GetVideoUrl
};

