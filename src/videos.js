require("dotenv").config();
const header = require("../header");
const sslfix = require("./sslfix");
const { detectActiveDomain } = require("./search");
const cheerio = require("cheerio");
const Axios = require('axios')
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");

// Axios instance - Optimize edilmiş ayarlar
const instance = Axios.create({
    timeout: 12000, // 12 saniye timeout
    maxRedirects: 5,
    validateStatus: function (status) {
        return status >= 200 && status < 500;
    }
});
const axios = setupCache(instance, {
    ttl: 10 * 60 * 1000, // 10 dakika cache - stream URL'ler daha kısa süre cache olmalı
    interpretHeader: false,
    methods: ['get'],
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

async function GetVideos(id) {
    try {
        const activeDomain = await detectActiveDomain();
        const proxyUrl = process.env.PROXY_URL || `https://${activeDomain}`;
        
        console.log(`GetVideos: Fetching video for ${id}`);
        
        const response = await axios.get(proxyUrl + id, {
            ...sslfix,
            headers: header,
            timeout: 12000, // 12 saniye - video için biraz daha fazla
            cache: {
                ttl: 10 * 60 * 1000 // 10 dakika cache
            }
        });
        
        if (response && response.status === 200) {
            const $ = cheerio.load(response.data);
            
            // Yöntem 1: vast_new iframe (eski)
            let videoLink = $("#vast_new > iframe").attr("src");
            
            // Yöntem 2: Genel iframe arama
            if (!videoLink) {
                videoLink = $('iframe[src*="dizipal"]').first().attr('src') ||
                           $('iframe[src*="embed"]').first().attr('src') ||
                           $('iframe').first().attr('src');
            }
            
            // Yöntem 3: data-src
            if (!videoLink) {
                videoLink = $('iframe[data-src]').first().attr('data-src');
            }
            
            console.log(`Found iframe: ${videoLink}`);
            
            if (videoLink) {
                const jsFileUrl = await ScrapeVideoUrl(videoLink, proxyUrl);
                if (jsFileUrl) return jsFileUrl;
            } else {
                console.log('No iframe found in page');
            }
        }
    } catch (error) {
        console.log('GetVideos error:', error.message);
    }
    return null;
}

async function ScrapeVideoUrl(scrapeUrl, refererUrl) {
    try {
        const scrapeHeader = {
            "referer": refererUrl,
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
        };
        
        const response = await axios.get(scrapeUrl, {
            headers: scrapeHeader,
            timeout: 15000
        });
        
        if (response && response.status === 200) {
            let playerFileLink = "";
            let subtitles;
            const $ = cheerio.load(response.data);
            const videoLinks = $("body > script:nth-child(2)");
            
            videoLinks.each((index, script) => {
                const scriptContent = $(script).html().trim();
                if (scriptContent.includes('new Playerjs')) {
                    const fileMatch = scriptContent.match(/file:"([^"]+)"/);
                    const subtitleMatch = scriptContent.match(/"subtitle":"([^"]+)"/);
                    
                    if (fileMatch && fileMatch[1]) {
                        playerFileLink = fileMatch[1];
                    }
                    if (subtitleMatch && subtitleMatch[1]) {
                        subtitles = subtitleMatch[1].split(",");
                    }
                }
            });
            
            // Eğer Playerjs'den bulunamadıysa, alternatif yöntemler dene
            if (!playerFileLink) {
                // Yöntem 1: dizipal.website için API çağrısı
                if (scrapeUrl.includes('dizipal')) {
                    const filecodeMatch = scrapeUrl.match(/dizipal[^\/]*\/([a-f0-9]{10,20})/);
                    if (filecodeMatch && filecodeMatch[1]) {
                        const filecode = filecodeMatch[1];
                        const apiBaseUrl = scrapeUrl.replace(/\/[^\/]+$/, '');
                        const apiUrl = `${apiBaseUrl}/ajax/stream2?filecode=${filecode}`;
                        
                        try {
                            const apiResult = await axios.get(apiUrl, {
                                headers: {
                                    ...scrapeHeader,
                                    'X-Requested-With': 'XMLHttpRequest',
                                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                                },
                                timeout: 10000
                            });
                            
                            if (apiResult.status === 200 && apiResult.data) {
                                const apiData = typeof apiResult.data === 'string' ? JSON.parse(apiResult.data) : apiResult.data;
                                if (apiData && apiData.streaming_url) {
                                    playerFileLink = apiData.streaming_url;
                                }
                            }
                        } catch (apiError) {
                            console.log('API error:', apiError.message);
                        }
                    }
                }
                
                // Yöntem 2: HTML'den direkt .m3u8 URL'lerini ara
                if (!playerFileLink) {
                    const m3u8Patterns = [
                        /(https?:\/\/[^\s"\'<>]+\/master\.m3u8[^\s"\'<>]*)/i,
                        /(https?:\/\/[^\s"\'<>]+\.m3u8[^\s"\'<>]*)/i,
                        /["'](https?:\/\/[^"\']+\/master\.m3u8[^"\']*)["']/i,
                        /["'](https?:\/\/[^"\']+\.m3u8[^"\']*)["']/i
                    ];
                    
                    for (const pattern of m3u8Patterns) {
                        const match = response.data.match(pattern);
                        if (match && match[1]) {
                            const possibleUrl = match[1].replace(/["'\\]/g, '').trim();
                            if (possibleUrl.startsWith('http')) {
                                playerFileLink = possibleUrl;
                                break;
                            }
                        }
                    }
                }
                
                // Yöntem 3: .mp4 URL'lerini ara
                if (!playerFileLink) {
                    const mp4Patterns = [
                        /(https?:\/\/[^\s"\'<>]+\.mp4[^\s"\'<>]*)/i,
                        /["'](https?:\/\/[^"\']+\.mp4[^"\']*)["']/i
                    ];
                    
                    for (const pattern of mp4Patterns) {
                        const match = response.data.match(pattern);
                        if (match && match[1]) {
                            const possibleUrl = match[1].replace(/["'\\]/g, '').trim();
                            if (possibleUrl.startsWith('http')) {
                                playerFileLink = possibleUrl;
                                break;
                            }
                        }
                    }
                }
            }
            
            const video = {
                url: playerFileLink,
                subtitles: subtitles || []
            };
            
            if (video.url) return video;
        }
    } catch (error) {
        console.log('ScrapeVideoUrl error:', error.message);
    }
    return null;
}

module.exports = { GetVideos };

