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

// Canlı TV için cache süresini çok kısa tutuyoruz (URL'ler sık değişiyor)
const axios = setupCache(instance, {
    ttl: 2 * 60 * 1000, // 2 dakika cache - canlı TV için çok kısa
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

// Spor kanalları listesi - M3U dosyasından dinamik olarak güncellenecek
const SPORTS_CHANNELS = [
    { id: 'beinsport-1', name: 'BeIN Sports 1', quality: '720p' },
    { id: 'beinsport-2', name: 'BeIN Sports 2', quality: '720p' },
    { id: 'tabii-spor', name: 'Tabii Spor', quality: '1080p' },
    { id: 's-sport', name: 'S Sport', quality: '1080p' },
    { id: 'tivibu-spor', name: 'Tivibu Spor', quality: '720p' },
    { id: 'smart-spor', name: 'Smart Spor', quality: '1080p' },
    { id: 'exxen-spor', name: 'Exxen Spor', quality: '1080p' }
];

// M3U dosyasından stream URL'lerini çek
const M3U_URL = 'https://raw.githubusercontent.com/primatzeka/kurbaga/main/NeonSpor/NeonSpor.m3u';
let streamUrlCache = {}; // Channel ID -> Stream URL mapping
let channelCategories = {}; // Channel ID -> Category mapping
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 dakikada bir güncelle

// M3U dosyasından stream URL'lerini güncelle
async function updateStreamUrlsFromGitHub() {
    try {
        const now = Date.now();
        // Eğer son güncelleme 5 dakikadan kısa bir süre önce yapıldıysa, cache'den dön
        // Ama BeIN Sport 2 için özel kontrol - cache'i bypass et
        const needsUpdate = now - lastUpdateTime >= UPDATE_INTERVAL || 
                           Object.keys(streamUrlCache).length === 0 ||
                           !streamUrlCache['beinsport-2'];
        
        if (!needsUpdate) {
            return streamUrlCache;
        }
        
        console.log(`[NeonSpor] Updating stream URLs from M3U file...`);
        
        try {
            // M3U dosyasını çek
            const m3uResponse = await axios.get(M3U_URL, {
                timeout: 15000,
                cache: false // Cache kullanma, her zaman güncel veri çek
            });
            
            if (m3uResponse && m3uResponse.data) {
                const m3uContent = m3uResponse.data;
                const lines = m3uContent.split('\n');
                
                let currentChannel = null;
                let currentUrl = null;
                let currentCategory = null;
                
                // M3U dosyasını parse et
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    
                    // #EXTINF satırı - kanal bilgileri
                    if (line.startsWith('#EXTINF')) {
                        // group-title="BeINSports" gibi kategorileri çıkar
                        const groupMatch = line.match(/group-title="([^"]+)"/i);
                        if (groupMatch) {
                            currentCategory = groupMatch[1];
                        }
                        
                        // tvg-name="BeIN Sport 1" gibi kanal adını çıkar
                        const nameMatch = line.match(/tvg-name="([^"]+)"/i);
                        if (nameMatch) {
                            currentChannel = nameMatch[1];
                        } else {
                            // Eğer tvg-name yoksa, satırın sonundaki ismi al
                            const lastComma = line.lastIndexOf(',');
                            if (lastComma > 0) {
                                currentChannel = line.substring(lastComma + 1).trim();
                            }
                        }
                    }
                    // URL satırı - stream URL'i
                    else if (line.startsWith('http://') || line.startsWith('https://')) {
                        currentUrl = line;
                        
                        // Eğer kanal adı ve URL varsa, eşleştir
                        if (currentChannel && currentUrl) {
                            // Kanal adını normalize et ve eşleştir
                            const channelNameLower = currentChannel.toLowerCase();
                            
                            // SPORTS_CHANNELS listesindeki kanallarla eşleştir
                            for (const channel of SPORTS_CHANNELS) {
                                const channelNameLower2 = channel.name.toLowerCase();
                                
                                // Eşleşme kontrolü - daha esnek
                                // "Sports" ve "Sport" farkını normalize et
                                const normalizedM3UName = channelNameLower.replace(/sports/g, 'sport').replace(/\s+/g, ' ').trim();
                                const normalizedChannelName = channelNameLower2.replace(/sports/g, 'sport').replace(/\s+/g, ' ').trim();
                                
                                // Sayıları da normalize et (1, 2, vb.)
                                const m3uNumber = normalizedM3UName.match(/\b([12])\b/);
                                const channelNumber = normalizedChannelName.match(/\b([12])\b/);
                                
                                // Çeşitli eşleşme pattern'leri
                                let matches = false;
                                
                                // Spesifik kanal eşleştirmeleri - öncelik sırasına göre
                                
                                // BeIN Sport 1 - çok spesifik kontrol
                                if (channel.id === 'beinsport-1') {
                                    if (normalizedM3UName.includes('bein sport 1') && 
                                        !normalizedM3UName.includes('max') && 
                                        !normalizedM3UName.includes('yedek') && 
                                        !normalizedM3UName.includes('2') && 
                                        !normalizedM3UName.includes('smart') &&
                                        !normalizedM3UName.includes('spor smart')) {
                                        matches = true;
                                    }
                                }
                                // BeIN Sport 2 - çok spesifik kontrol
                                else if (channel.id === 'beinsport-2') {
                                    const urlLower = currentUrl.toLowerCase();
                                    // "BeIN Sport 2" tam eşleşmesi veya URL'den kontrol (yayinb2)
                                    // M3U'da "BeIN Sport 2" (tekil) yazıyor, bizde "BeIN Sports 2" (çoğul)
                                    const isBeinSport2 = (normalizedM3UName.includes('bein sport 2') || 
                                                          normalizedM3UName === 'bein sport 2' ||
                                                          normalizedM3UName === 'bein sports 2') &&
                                                         !normalizedM3UName.includes('max') && 
                                                         !normalizedM3UName.includes('yedek') &&
                                                         !normalizedM3UName.includes('smart') &&
                                                         !normalizedM3UName.includes('3') &&
                                                         !normalizedM3UName.includes('4') &&
                                                         !normalizedM3UName.includes('5');
                                    
                                    const isCorrectUrl = urlLower.includes('yayinb2') && !urlLower.includes('bm2');
                                    
                                    if (isBeinSport2 || isCorrectUrl) {
                                        matches = true;
                                    }
                                }
                                // Tabii Spor - spesifik kontrol
                                else if (channel.id === 'tabii-spor') {
                                    if (normalizedM3UName.includes('tabii spor') && 
                                        !normalizedM3UName.includes('trt') &&
                                        !normalizedM3UName.includes('a spor')) {
                                        matches = true;
                                    }
                                }
                                // S Sport - spesifik kontrol (Smart Spor ile karışmaması için)
                                else if (channel.id === 's-sport') {
                                    if ((normalizedM3UName.includes('s sport') || normalizedM3UName === 's sport') && 
                                        !normalizedM3UName.includes('smart') &&
                                        !normalizedM3UName.includes('spor smart')) {
                                        matches = true;
                                    }
                                }
                                // Tivibu Spor - spesifik kontrol
                                else if (channel.id === 'tivibu-spor') {
                                    if (normalizedM3UName.includes('tivibu spor') && 
                                        !normalizedM3UName.includes('trt')) {
                                        matches = true;
                                    }
                                }
                                // Smart Spor - spesifik kontrol
                                else if (channel.id === 'smart-spor') {
                                    if ((normalizedM3UName.includes('smart spor') || normalizedM3UName.includes('spor smart')) &&
                                        !normalizedM3UName.includes('bein')) {
                                        matches = true;
                                    }
                                }
                                // Exxen Spor - spesifik kontrol
                                else if (channel.id === 'exxen-spor') {
                                    if (normalizedM3UName.includes('exxen spor') &&
                                        !normalizedM3UName.includes('trt')) {
                                        matches = true;
                                    }
                                }
                                
                                if (matches) {
                                    // URL'den kontrol et - yanlış eşleşmeleri önle
                                    const urlLower = currentUrl.toLowerCase();
                                    
                                    // BeIN Sport 1 için yanlış URL'leri filtrele
                                    if (channel.id === 'beinsport-1') {
                                        // yayinsms2, yayinb2, yayinb3, yayinb4, yayinb5, yayinbm2 gibi yanlış URL'leri atla
                                        if (urlLower.includes('sms') || urlLower.includes('yayinb2') || urlLower.includes('yayinb3') || urlLower.includes('yayinb4') || urlLower.includes('yayinb5') || urlLower.includes('bm2') || urlLower.includes('bm3') || urlLower.includes('bm4') || urlLower.includes('bm5')) {
                                            // Yanlış eşleşme, atla
                                            break;
                                        }
                                        // Sadece yayinzirve veya benzeri URL'leri kabul et
                                        if (!urlLower.includes('zirve') && !urlLower.includes('bein')) {
                                            // URL'den kanal adını kontrol et - eğer "smart" veya "spor smart" içeriyorsa atla
                                            if (normalizedM3UName.includes('smart') || normalizedM3UName.includes('spor smart')) {
                                                break;
                                            }
                                        }
                                    }
                                    // BeIN Sport 2 için yanlış URL'leri filtrele
                                    if (channel.id === 'beinsport-2') {
                                        // yayinsms2, yayinzirve, yayinb3, yayinb4, yayinb5, yayinbm1, yayinbm2 gibi yanlış URL'leri atla
                                        if (urlLower.includes('sms') || urlLower.includes('zirve') || urlLower.includes('yayinb3') || urlLower.includes('yayinb4') || urlLower.includes('yayinb5') || urlLower.includes('bm1') || urlLower.includes('bm3') || urlLower.includes('bm4') || urlLower.includes('bm5')) {
                                            // Yanlış eşleşme, atla
                                            break;
                                        }
                                        // Sadece yayinb2 URL'lerini kabul et
                                        if (!urlLower.includes('yayinb2') && !urlLower.includes('b2')) {
                                            break;
                                        }
                                    }
                                    
                                    // İlk URL'i al (yedek URL'ler varsa ilkini tercih et)
                                    // Eğer zaten URL varsa ve "Yedek" içermiyorsa, yeni URL'i atla
                                    if (!streamUrlCache[channel.id] || !currentChannel.toLowerCase().includes('yedek')) {
                                        streamUrlCache[channel.id] = currentUrl;
                                        channelCategories[channel.id] = currentCategory || 'Diğerleri';
                                        console.log(`[NeonSpor] Found stream URL for ${channel.name} (${currentChannel}): ${currentUrl.substring(0, 80)}...`);
                                    }
                                    break;
                                }
                            }
                            
                            // Reset
                            currentChannel = null;
                            currentUrl = null;
                        }
                    }
                }
            }
        } catch (m3uError) {
            console.log(`[NeonSpor] M3U file error: ${m3uError.message}`);
        }
        
        lastUpdateTime = now;
        console.log(`[NeonSpor] Stream URL cache updated. Found ${Object.keys(streamUrlCache).length} URLs`);
        
        return streamUrlCache;
    } catch (error) {
        console.log(`[NeonSpor] Update stream URLs error: ${error.message}`);
    }
    return streamUrlCache;
}

// NeonSpor Search - Tüm canlı TV kanallarını döndürür (kategorilere göre)
async function NeonSporSearch(query) {
    try {
        console.log(`[NeonSpor] Searching for: "${query}"`);
        
        // Önce stream URL'lerini güncelle
        await updateStreamUrlsFromGitHub();
        
        const results = [];
        const searchLower = query.toLowerCase().trim();
        
        // Eğer arama boşsa veya "spor", "bein", "canlı" gibi genel terimler varsa tüm kanalları döndür
        const generalTerms = ['spor', 'bein', 'canlı', 'tv', 'live', 'neonspor', ''];
        const isGeneralSearch = generalTerms.some(term => searchLower.includes(term) || term === searchLower);
        
        SPORTS_CHANNELS.forEach(channel => {
            const channelNameLower = channel.name.toLowerCase();
            // Genel arama ise tüm kanalları göster, değilse filtrele
            if (isGeneralSearch || channelNameLower.includes(searchLower) || searchLower.includes(channelNameLower.split(' ')[0])) {
                const category = channelCategories[channel.id] || 'Spor';
                const hasStream = !!streamUrlCache[channel.id];
                
                results.push({
                    id: `neonspor-${channel.id}`,
                    title: channel.name,
                    name: channel.name,
                    type: 'tv', // Canlı TV için tv type'ı
                    poster: '', // Spor kanalları için poster yok
                    description: `${channel.name} - ${channel.quality} kalitede canlı spor yayını${hasStream ? ' [Aktif]' : ' [URL Bekleniyor]'}`,
                    genres: ['Spor', 'Canlı TV', category],
                    source: 'NeonSpor',
                    quality: channel.quality,
                    category: category
                });
            }
        });
        
        console.log(`[NeonSpor] Found ${results.length} results (${Object.keys(streamUrlCache).length} with stream URLs)`);
        return results;
    } catch (error) {
        console.log(`[NeonSpor] Search error: ${error.message}`);
    }
    return [];
}

// NeonSpor Get Channel Meta
async function NeonSporGetChannelMeta(channelId) {
    try {
        const id = channelId.replace('neonspor-', '');
        const channel = SPORTS_CHANNELS.find(c => c.id === id);
        
        if (!channel) {
            return null;
        }
        
        console.log(`[NeonSpor] Fetching channel meta for: ${channel.name}`);
        
        const category = channelCategories[channel.id] || 'Spor';
        
        return {
            name: channel.name,
            background: '',
            poster: '',
            country: 'TR',
            season: 1,
            imdbRating: 0,
            description: `${channel.name} - ${channel.quality} kalitede canlı spor yayını [${category}]`,
            releaseInfo: new Date().getFullYear().toString(),
            runtime: undefined
        };
    } catch (error) {
        console.log(`[NeonSpor] Channel meta error: ${error.message}`);
    }
    return null;
}

// NeonSpor Get Stream URL - Canlı TV stream URL'sini döndürür
async function NeonSporGetStreamUrl(channelId) {
    try {
        const id = channelId.replace('neonspor-', '').replace('-live', '');
        const channel = SPORTS_CHANNELS.find(c => c.id === id);
        
        if (!channel) {
            return null;
        }
        
        console.log(`[NeonSpor] Fetching stream URL for: ${channel.name}`);
        
        // Önce M3U dosyasından stream URL'lerini güncelle
        await updateStreamUrlsFromGitHub();
        
        // Cache'den stream URL'ini al
        const streamUrl = streamUrlCache[channel.id];
        
        if (streamUrl) {
            console.log(`[NeonSpor] Found stream URL for ${channel.name}: ${streamUrl.substring(0, 80)}...`);
            return { url: streamUrl, subtitles: [] };
        }
        
        // Eğer cache'de yoksa, direkt M3U'dan tekrar dene (cache bypass)
        console.log(`[NeonSpor] Stream URL not in cache, fetching fresh from M3U...`);
        lastUpdateTime = 0; // Cache'i bypass et
        const freshCache = await updateStreamUrlsFromGitHub();
        const freshUrl = freshCache[channel.id];
        
        if (freshUrl) {
            console.log(`[NeonSpor] Found fresh stream URL for ${channel.name}`);
            return { url: freshUrl, subtitles: [] };
        }
        
        console.log(`[NeonSpor] Stream URL not found for ${channel.name}`);
        return null;
    } catch (error) {
        console.log(`[NeonSpor] Stream URL error: ${error.message}`);
    }
    return null;
}

// NeonSpor Get Episodes - Canlı TV için tek bir "episode" döndürür
async function NeonSporGetEpisodes(channelId, seasonNum) {
    try {
        const id = channelId.replace('neonspor-', '');
        const channel = SPORTS_CHANNELS.find(c => c.id === id);
        
        if (!channel) {
            return [];
        }
        
        // Canlı TV için tek bir "episode" döndür
        return [{
            id: `neonspor-${id}-live`,
            season: 1,
            episode: 1,
            title: `${channel.name} - Canlı Yayın`,
            thumbnail: ''
        }];
    } catch (error) {
        console.log(`[NeonSpor] Get Episodes error: ${error.message}`);
    }
    return [];
}

module.exports = { 
    NeonSporSearch,
    NeonSporGetChannelMeta,
    NeonSporGetStreamUrl,
    NeonSporGetEpisodes,
    updateStreamUrlsFromGitHub,
    SPORTS_CHANNELS
};
