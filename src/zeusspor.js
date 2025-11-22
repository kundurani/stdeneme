require("dotenv").config();
const Axios = require('axios');
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");

// Axios instance
const instance = Axios.create({
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: function (status) {
        return status >= 200 && status < 500;
    }
});

// Canlı TV için cache kullanmıyoruz - her zaman güncel veri çekmeliyiz
// Cache'i devre dışı bırakıyoruz çünkü linkler sürekli güncelleniyor
const axios = instance; // Cache kullanmıyoruz

axiosRetry(axios, { 
    retries: 2,
    retryDelay: (retryCount) => retryCount * 500,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

// M3U dosyası URL'i
const M3U_URL = 'https://raw.githubusercontent.com/ahmet21ahmet/Trgoalsvsdengetv/refs/heads/main/birlesik_liste.m3u';

// Kategoriler ve kanallar cache'i - Sadece bellek içi cache (her istekte M3U'dan çek)
let categoriesCache = {}; // category -> channels array
let allChannelsCache = []; // Tüm kanallar
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 0; // Cache yok - her zaman güncel veri çek

// Kategori isimlerini normalize et
function normalizeCategoryName(category, channelName = '') {
    if (!category) return 'Diğerleri';
    
    const catLower = category.toLowerCase();
    const channelLower = channelName.toLowerCase();
    
    // beIN Sport kategorisi (kanal adına da bak)
    if (catLower.includes('bein') || catLower.includes('beinsport') || 
        channelLower.includes('bein') || channelLower.includes('beinsport')) {
        return 'beIN Sport';
    }
    
    // Tivibu Sport kategorisi
    if (catLower.includes('tivibu') || channelLower.includes('tivibu')) {
        return 'Tivibu Sport';
    }
    
    // Smart Sport kategorisi
    if (catLower.includes('smart') || channelLower.includes('smart sport')) {
        return 'Smart Sport';
    }
    
    // S Sport kategorisi
    if (catLower.includes('s sport') || catLower === 'sport' || 
        channelLower.includes('s sport')) {
        return 'S Sport';
    }
    
    // Tabii kategorisi
    if (catLower.includes('tabii') || channelLower.includes('tabii')) {
        return 'Tabii Sport';
    }
    
    // Exxen kategorisi
    if (catLower.includes('exxen') || channelLower.includes('exxen')) {
        return 'Exxen Sport';
    }
    
    // Ulusal Kanallar (spor kanalları hariç)
    if ((catLower.includes('ulusal') || catLower.includes('trt') || 
        catLower.includes('atv') || catLower.includes('show') || 
        catLower.includes('star') || catLower.includes('fox') ||
        (catLower.includes('kanal') && !catLower.includes('sport')) || 
        (catLower.includes('tv') && !catLower.includes('sport'))) &&
        !catLower.includes('sport') && !catLower.includes('spor') &&
        !catLower.includes('bein') && !catLower.includes('tivibu') &&
        !catLower.includes('smart') && !catLower.includes('tabii') &&
        !catLower.includes('exxen') &&
        !channelLower.includes('sport') && !channelLower.includes('spor') &&
        !channelLower.includes('bein') && !channelLower.includes('tivibu') &&
        !channelLower.includes('smart') && !channelLower.includes('tabii') &&
        !channelLower.includes('exxen')) {
        return 'Ulusal Kanallar';
    }
    
    // Çocuk Kanalları
    if (catLower.includes('çocuk') || catLower.includes('cocuk') || 
        catLower.includes('çizgi') || catLower.includes('cizgi') ||
        catLower.includes('disney') || catLower.includes('nickelodeon')) {
        return 'Çocuk Kanalları';
    }
    
    // Dizi Son Bölümler
    if (catLower.includes('dizi') || catLower.includes('bölüm') || 
        catLower.includes('bolum') || catLower.includes('episode')) {
        return 'Dizi Son Bölümler';
    }
    
    // Haber Kanalları
    if (catLower.includes('haber') || catLower.includes('news')) {
        return 'HABER';
    }

    // Dini Kanallar
    if (catLower.includes('dini') || catLower.includes('islam') || catLower.includes('kuran') || catLower.includes('diyanet')) {
        return 'DİNİ';
    }

    // Belgesel Kanalları
    if (catLower.includes('belgesel') || catLower.includes('documentary') || catLower.includes('geographic') || catLower.includes('dmax') || catLower.includes('tlc')) {
        return 'BELGESEL';
    }

    // Sinema-Dizi Kanalları
    if (catLower.includes('sinema') || catLower.includes('film') || catLower.includes('movie') || catLower.includes('cine')) {
        return 'SİNEMA-DİZİ';
    }

    // Yerel Kanallar
    if (catLower.includes('yerel') || catLower.includes('bursa') || catLower.includes('izmir') || catLower.includes('ankara') || catLower.includes('istanbul') || catLower.includes('tv')) {
        return 'YEREL';
    }
    
    return category;
}

// M3U dosyasını parse et ve kategorilere ayır
// Her çağrıldığında M3U dosyasından güncel veriyi çeker (cache yok)
async function updateChannelsFromM3U() {
    try {
        console.log(`[ZeusSpor] Fetching fresh channels from M3U file: ${M3U_URL}`);
        
        const response = await axios.get(M3U_URL, {
            timeout: 20000,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (response && response.status === 200 && response.data) {
            const lines = response.data.split('\n');
            let currentChannel = null;
            let currentUrl = null;
            let currentCategory = null;
            let currentLogo = null;
            let currentTvgId = null;
            
            // Cache'leri temizle
            categoriesCache = {};
            allChannelsCache = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // #EXTINF satırı - kanal bilgileri
                if (line.startsWith('#EXTINF')) {
                    // Önce kanal adını çıkar (kategori normalizasyonu için gerekli)
                    let tempChannelName = '';
                    const nameMatch = line.match(/tvg-name="([^"]+)"/i);
                    if (nameMatch) {
                        tempChannelName = nameMatch[1].replace(/^TR:/i, '').trim();
                        currentChannel = tempChannelName;
                    } else {
                        // Eğer tvg-name yoksa, satırın sonundaki ismi al
                        const lastComma = line.lastIndexOf(',');
                        if (lastComma > 0) {
                            tempChannelName = line.substring(lastComma + 1).trim();
                            currentChannel = tempChannelName;
                        }
                    }
                    
                    // group-title="NexaTV" gibi kategorileri çıkar ve kanal adına göre normalize et
                    const groupMatch = line.match(/group-title="([^"]+)"/i);
                    if (groupMatch) {
                        currentCategory = normalizeCategoryName(groupMatch[1], tempChannelName);
                    }
                    
                    // tvg-logo çıkar
                    const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
                    if (logoMatch) {
                        currentLogo = logoMatch[1];
                    }
                    
                    // tvg-id çıkar
                    const tvgIdMatch = line.match(/tvg-id="([^"]+)"/i);
                    if (tvgIdMatch) {
                        currentTvgId = tvgIdMatch[1];
                    }
                }
                // URL satırı - stream URL'i
                else if (line.startsWith('http://') || line.startsWith('https://')) {
                    currentUrl = line;
                    
                    // Eğer kanal adı ve URL varsa, ekle
                    if (currentChannel && currentUrl) {
                        // Kanal adına göre kategoriyi tekrar normalize et (daha doğru kategori için)
                        let finalCategory = currentCategory || 'Diğerleri';
                        if (currentChannel) {
                            finalCategory = normalizeCategoryName(finalCategory, currentChannel);
                        }
                        // Kategori adından emoji'leri kaldır
                        finalCategory = finalCategory.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
                        
                        const channelId = `zeusspor-${currentTvgId || currentChannel.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                        
                        const channelData = {
                            id: channelId,
                            name: currentChannel,
                            url: currentUrl,
                            logo: currentLogo || '',
                            category: finalCategory,
                            tvgId: currentTvgId || ''
                        };
                        
                        // Kategoriye göre ekle (finalCategory kullan, emoji'siz)
                        if (!categoriesCache[finalCategory]) {
                            categoriesCache[finalCategory] = [];
                        }
                        categoriesCache[finalCategory].push(channelData);
                        
                        // Tüm kanallar listesine ekle
                        allChannelsCache.push(channelData);
                        
                        // Reset
                        currentChannel = null;
                        currentUrl = null;
                        currentCategory = null;
                        currentLogo = null;
                        currentTvgId = null;
                    }
                }
            }
            
            lastUpdateTime = Date.now();
            console.log(`[ZeusSpor] Fresh channels loaded. Found ${allChannelsCache.length} channels in ${Object.keys(categoriesCache).length} categories`);
            console.log(`[ZeusSpor] Categories:`, Object.keys(categoriesCache));
        }
    } catch (error) {
        console.log(`[ZeusSpor] M3U file error: ${error.message}`);
        // Hata durumunda eski cache'i döndür (eğer varsa)
        if (Object.keys(categoriesCache).length > 0) {
            console.log(`[ZeusSpor] Using cached data due to error`);
            return { categories: categoriesCache, channels: allChannelsCache };
        }
    }
    
    return { categories: categoriesCache, channels: allChannelsCache };
}

// Zeus Spor Search - Kategorileri önce göster, kategoriye tıklayınca kanalları göster
async function ZeusSporSearch(query) {
    try {
        console.log(`[ZeusSpor] Searching for: "${query}"`);
        
        // Önce kanalları güncelle
        const { categories, channels } = await updateChannelsFromM3U();
        
        const results = [];
        const searchLower = query.toLowerCase().trim();
        
        // Eğer arama boşsa veya genel terimler varsa tüm kategorileri döndür
        const generalTerms = ['spor', 'bein', 'canlı', 'tv', 'live', 'zeusspor', 'zeus spor', ''];
        const isGeneralSearch = generalTerms.some(term => searchLower.includes(term) || term === searchLower);
        
        // Kategori isimlerini kontrol et - eğer arama bir kategori adına eşleşiyorsa, o kategorinin kanallarını döndür
        let matchedCategory = null;
        const categoryNames = Object.keys(categories);
        for (const catName of categoryNames) {
            const catLower = catName.toLowerCase();
            // Kategori adına tam eşleşme veya içerme kontrolü
            if (catLower === searchLower || catLower.includes(searchLower) || searchLower.includes(catLower.replace(/\s+/g, ''))) {
                matchedCategory = catName;
                break;
            }
        }
        
        if (matchedCategory) {
            // Kategori eşleştiyse, o kategorinin tüm kanallarını döndür
            const categoryChannels = categories[matchedCategory] || [];
            categoryChannels.forEach(channel => {
                results.push({
                    id: channel.id,
                    title: channel.name,
                    name: channel.name,
                    type: 'tv',
                    poster: channel.logo || '',
                    description: `${channel.name} - Canlı TV yayını [${channel.category}]`,
                    genres: ['Canlı TV', channel.category],
                    source: 'ZeusSpor',
                    category: channel.category,
                    url: channel.url
                });
            });
            console.log(`[ZeusSpor] Category match: "${matchedCategory}", returning ${results.length} channels`);
        } else if (isGeneralSearch) {
            // Genel arama ise tüm kategorileri meta olarak döndür (kategorileri göster)
            categoryNames.forEach(catName => {
                const categoryChannels = categories[catName] || [];
                if (categoryChannels.length > 0) {
                    // Kategoriyi meta olarak ekle
                    results.push({
                        id: `zeusspor-category-${catName.toLowerCase().replace(/\s+/g, '-')}`,
                        title: `${catName} (${categoryChannels.length} kanal)`,
                        name: catName,
                        type: 'tv',
                        poster: categoryChannels[0]?.logo || '', // İlk kanalın logosunu kullan
                        description: `${catName} kategorisinde ${categoryChannels.length} kanal bulunmaktadır. Tıklayarak kanalları görüntüleyin.`,
                        genres: ['Kategori', 'Canlı TV'],
                        source: 'ZeusSpor',
                        category: catName,
                        isCategory: true, // Kategori meta olduğunu belirt
                        channelCount: categoryChannels.length
                    });
                }
            });
            console.log(`[ZeusSpor] General search, returning ${results.length} categories`);
        } else {
            // Spesifik arama - hem kategorileri hem de kanalları kontrol et
            const matchedCategories = new Set();
            const matchedChannels = [];
            
            // Önce kategorileri kontrol et
            categoryNames.forEach(catName => {
                const catLower = catName.toLowerCase();
                if (catLower.includes(searchLower) || searchLower.includes(catLower.replace(/\s+/g, ''))) {
                    matchedCategories.add(catName);
                }
            });
            
            // Sonra kanalları kontrol et
            channels.forEach(channel => {
                const channelNameLower = channel.name.toLowerCase();
                const categoryLower = channel.category.toLowerCase();
                
                if (channelNameLower.includes(searchLower) || 
                    categoryLower.includes(searchLower) ||
                    searchLower.includes(channelNameLower.split(' ')[0])) {
                    if (matchedCategories.has(channel.category)) {
                        // Eğer kategori zaten eşleştiyse, kategori meta'sını ekle
                        matchedCategories.delete(channel.category);
                        const categoryChannels = categories[channel.category] || [];
                        // Kategori ID'sini oluştur - emoji'leri kaldır, sadece harf ve rakam kullan
                        const categoryNameClean = channel.category.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
                        const categoryId = `zeusspor-category-${categoryNameClean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')}`;
                        results.push({
                            id: categoryId,
                            title: `${channel.category} (${categoryChannels.length} kanal)`,
                            name: channel.category,
                            type: 'tv',
                            poster: categoryChannels[0]?.logo || '',
                            description: `${channel.category} kategorisinde ${categoryChannels.length} kanal bulunmaktadır.`,
                            genres: ['Kategori', 'Canlı TV'],
                            source: 'ZeusSpor',
                            category: channel.category,
                            isCategory: true,
                            channelCount: categoryChannels.length
                        });
                    } else {
                        // Kategori eşleşmediyse direkt kanalı ekle
                        matchedChannels.push(channel);
                    }
                }
            });
            
            // Eşleşen kategorileri ekle
            matchedCategories.forEach(catName => {
                const categoryChannels = categories[catName] || [];
                if (categoryChannels.length > 0) {
                    // Kategori ID'sini oluştur - emoji'leri kaldır, sadece harf ve rakam kullan
                    const categoryNameClean = catName.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
                    const categoryId = `zeusspor-category-${categoryNameClean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')}`;
                    results.push({
                        id: categoryId,
                        title: `${catName} (${categoryChannels.length} kanal)`,
                        name: catName,
                        type: 'tv',
                        poster: categoryChannels[0]?.logo || '',
                        description: `${catName} kategorisinde ${categoryChannels.length} kanal bulunmaktadır.`,
                        genres: ['Kategori', 'Canlı TV'],
                        source: 'ZeusSpor',
                        category: catName,
                        isCategory: true,
                        channelCount: categoryChannels.length
                    });
                }
            });
            
            // Eşleşen kanalları ekle
            matchedChannels.forEach(channel => {
                results.push({
                    id: channel.id,
                    title: channel.name,
                    name: channel.name,
                    type: 'tv',
                    poster: channel.logo || '',
                    description: `${channel.name} - Canlı TV yayını [${channel.category}]`,
                    genres: ['Canlı TV', channel.category],
                    source: 'ZeusSpor',
                    category: channel.category,
                    url: channel.url
                });
            });
            
            console.log(`[ZeusSpor] Specific search, found ${matchedCategories.size} categories and ${matchedChannels.length} channels`);
        }
        
        // Sonuçları sırala - önce kategoriler, sonra kanallar
        results.sort((a, b) => {
            // Kategoriler önce gelsin
            if (a.isCategory && !b.isCategory) return -1;
            if (!a.isCategory && b.isCategory) return 1;
            
            // İkisi de kategori ise kategori ismine göre
            if (a.isCategory && b.isCategory) {
                return (a.name || '').localeCompare(b.name || '', 'tr');
            }
            
            // İkisi de kanal ise önce kategoriye göre, sonra kanal ismine göre
            const categoryA = a.category || 'Diğerleri';
            const categoryB = b.category || 'Diğerleri';
            if (categoryA !== categoryB) {
                return categoryA.localeCompare(categoryB, 'tr');
            }
            return (a.name || a.title || '').localeCompare(b.name || b.title || '', 'tr');
        });
        
        console.log(`[ZeusSpor] Found ${results.length} results`);
        return results;
    } catch (error) {
        console.log(`[ZeusSpor] Search error: ${error.message}`);
    }
    return [];
}

// Kategorileri döndür
async function ZeusSporGetCategories() {
    try {
        const { categories } = await updateChannelsFromM3U();
        return Object.keys(categories).map(categoryName => {
            // Kategori adından emoji'leri kaldır
            const cleanName = categoryName.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
            return {
                name: cleanName,
                count: categories[categoryName].length
            };
        });
    } catch (error) {
        console.log(`[ZeusSpor] Get categories error: ${error.message}`);
    }
    return [];
}

// Kategoriye göre kanalları döndür
async function ZeusSporGetChannelsByCategory(categoryName) {
    try {
        const { channels } = await updateChannelsFromM3U();
        // Kategoriye göre kanalları filtrele
        const filteredChannels = channels.filter(c => c.category === categoryName);
        // Stremio formatına uygun şekilde döndür
        return filteredChannels.map(channel => ({
            id: channel.id,
            name: channel.name,
            logo: channel.logo || '',
            category: channel.category,
            url: channel.url,
            tvgId: channel.tvgId || ''
        }));
    } catch (error) {
        console.log(`[ZeusSpor] Get channels by category error: ${error.message}`);
    }
    return [];
}

// Kanal meta bilgilerini döndür
async function ZeusSporGetChannelMeta(channelId) {
    try {
        const { channels } = await updateChannelsFromM3U();
        const channel = channels.find(c => c.id === channelId);
        
        if (!channel) {
            return null;
        }
        
        console.log(`[ZeusSpor] Fetching channel meta for: ${channel.name}`);
        
        return {
            name: channel.name,
            background: channel.logo || '',
            poster: channel.logo || '',
            country: 'TR',
            season: 1,
            imdbRating: 0,
            description: `${channel.name} - Canlı TV yayını [${channel.category}]`,
            releaseInfo: new Date().getFullYear().toString(),
            runtime: undefined
        };
    } catch (error) {
        console.log(`[ZeusSpor] Channel meta error: ${error.message}`);
    }
    return null;
}

// Stream URL'ini döndür
async function ZeusSporGetStreamUrl(channelId) {
    try {
        const { channels } = await updateChannelsFromM3U();
        const channel = channels.find(c => c.id === channelId);
        
        if (!channel) {
            return null;
        }
        
        console.log(`[ZeusSpor] Fetching stream URL for: ${channel.name}`);
        
        if (channel.url) {
            console.log(`[ZeusSpor] Found stream URL for ${channel.name}`);
            return { url: channel.url, subtitles: [] };
        }
        
        console.log(`[ZeusSpor] Stream URL not found for ${channel.name}`);
        return null;
    } catch (error) {
        console.log(`[ZeusSpor] Stream URL error: ${error.message}`);
    }
    return null;
}

// Episodes döndür (canlı TV için tek bir episode)
async function ZeusSporGetEpisodes(channelId, seasonNum) {
    try {
        const { channels } = await updateChannelsFromM3U();
        const channel = channels.find(c => c.id === channelId);
        
        if (!channel) {
            return [];
        }
        
        // Canlı TV için tek bir "episode" döndür
        return [{
            id: `${channelId}-live`,
            season: 1,
            episode: 1,
            title: `${channel.name} - Canlı Yayın`,
            thumbnail: channel.logo || ''
        }];
    } catch (error) {
        console.log(`[ZeusSpor] Get Episodes error: ${error.message}`);
    }
    return [];
}

// Zeus Dizi Search - Dizi Son Bölümler kategorisindeki içerikleri döndürür
async function ZeusDiziSearch(query) {
    try {
        console.log(`[ZeusDizi] Searching for: "${query}"`);
        
        // Önce kanalları güncelle
        const { categories, channels } = await updateChannelsFromM3U();
        
        // Dizi Son Bölümler kategorisindeki kanalları filtrele
        const diziCategory = 'Dizi Son Bölümler';
        const diziChannels = channels.filter(c => c.category === diziCategory);
        
        const results = [];
        const searchLower = query.toLowerCase().trim();
        
        // Eğer arama boşsa tüm dizileri döndür
        if (!searchLower || searchLower === '') {
            diziChannels.forEach(channel => {
                results.push({
                    id: channel.id,
                    title: channel.name,
                    name: channel.name,
                    type: 'series', // Diziler için series type
                    poster: channel.logo || '',
                    description: `${channel.name} - Dizi Son Bölüm [${channel.category}]`,
                    genres: ['Dizi', 'Son Bölüm', channel.category],
                    source: 'ZeusDizi',
                    category: channel.category,
                    url: channel.url
                });
            });
        } else {
            // Arama terimine göre filtrele
            diziChannels.forEach(channel => {
                const channelNameLower = channel.name.toLowerCase();
                
                if (channelNameLower.includes(searchLower) || 
                    searchLower.includes(channelNameLower.split(' ')[0])) {
                    results.push({
                        id: channel.id,
                        title: channel.name,
                        name: channel.name,
                        type: 'series',
                        poster: channel.logo || '',
                        description: `${channel.name} - Dizi Son Bölüm [${channel.category}]`,
                        genres: ['Dizi', 'Son Bölüm', channel.category],
                        source: 'ZeusDizi',
                        category: channel.category,
                        url: channel.url
                    });
                }
            });
        }
        
        console.log(`[ZeusDizi] Found ${results.length} results`);
        return results;
    } catch (error) {
        console.log(`[ZeusDizi] Search error: ${error.message}`);
    }
    return [];
}

module.exports = {
    ZeusSporSearch,
    ZeusSporGetChannelMeta,
    ZeusSporGetStreamUrl,
    ZeusSporGetEpisodes,
    ZeusSporGetCategories,
    ZeusSporGetChannelsByCategory,
    ZeusDiziSearch,
    updateChannelsFromM3U
};

