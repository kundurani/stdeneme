require("dotenv").config();
const Axios = require('axios');
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");

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

// RecTV API Configuration
const RECTV_BASE_URL = 'https://m.prectv60.lol/api';
const RECTV_DEVICE_ID = '4F5A9C3D9A86FA54EACEDDD635185';
const RECTV_SESSION_ID = 'c3c5bd17-e37b-4b94-a944-8a3688a30452';

// RecTV Search
async function RecTVSearch(query) {
    try {
        console.log(`[RecTV] Searching for: "${query}"`);
        
        const url = `${RECTV_BASE_URL}/search/${encodeURIComponent(query)}/${RECTV_DEVICE_ID}/${RECTV_SESSION_ID}/`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'okhttp/4.9.0',
                'Accept': 'application/json'
            },
            timeout: 5000,
            cache: { ttl: 60 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            const results = [];
            
            // Posters array'ini işle (filmler ve diziler)
            if (response.data.posters && Array.isArray(response.data.posters)) {
                response.data.posters.forEach(item => {
                    // Genres formatını düzelt - Stremio string array bekliyor, obje array geliyorsa map et
                    let genres = [];
                    if (item.genres && Array.isArray(item.genres)) {
                        genres = item.genres.map(g => {
                            // Eğer obje ise title'ı al, string ise direkt kullan
                            if (typeof g === 'object' && g !== null && g.title) {
                                return g.title;
                            } else if (typeof g === 'string') {
                                return g;
                            }
                            return null;
                        }).filter(g => g !== null); // null değerleri filtrele
                    }
                    
                    results.push({
                        id: `rectv-${item.id}`,
                        title: item.title,
                        type: item.type === 'serie' ? 'series' : 'movie',
                        poster: item.image || '',
                        cover: item.cover || '',
                        description: item.description || '',
                        year: item.year,
                        rating: item.rating,
                        imdb: item.imdb,
                        duration: item.duration,
                        genres: genres, // Düzeltilmiş format: string array
                        source: 'RecTV'
                    });
                });
            }
            
            console.log(`[RecTV] Found ${results.length} results`);
            return results;
        }
    } catch (error) {
        console.log(`[RecTV] Search error: ${error.message}`);
    }
    return [];
}

// RecTV Get Serie Seasons
async function RecTVGetSeasons(serieId) {
    try {
        // serieId formatı: rectv-12345 -> 12345
        const id = serieId.replace('rectv-', '');
        console.log(`[RecTV] Fetching seasons for serie ID: ${id}`);
        
        const url = `${RECTV_BASE_URL}/season/by/serie/${id}/${RECTV_DEVICE_ID}/${RECTV_SESSION_ID}/`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'okhttp/4.9.0',
                'Accept': 'application/json'
            },
            timeout: 8000,
            cache: { ttl: 30 * 60 * 1000 }
        });
        
        if (response && response.status === 200 && response.data) {
            console.log(`[RecTV] Found ${response.data.length} seasons`);
            return response.data;
        }
    } catch (error) {
        console.log(`[RecTV] Seasons error: ${error.message}`);
    }
    return [];
}

// RecTV Get Movie Details
async function RecTVGetMovieDetails(movieId) {
    try {
        // movieId formatı: rectv-12345 -> 12345
        const id = movieId.replace('rectv-', '');
        console.log(`[RecTV] Fetching movie details for ID: ${id}`);
        
        // Film detayları için /api/first/ veya /api/movie/by/filtres/ kullanabiliriz
        // Ancak HAR dosyasında direkt poster endpoint'i yok
        // Search sonucunda zaten sources var mı kontrol edelim
        
        // Şimdilik search sonucunu kullanacağız
        return null;
    } catch (error) {
        console.log(`[RecTV] Movie details error: ${error.message}`);
    }
    return null;
}

// RecTV Get Stream URL from Episode
async function RecTVGetStreamUrl(episodeId, seasonData) {
    try {
        console.log(`[RecTV] Getting stream URL for episode: ${episodeId}`);
        
        // episodeId formatı: rectv-episode-12345 -> 12345
        const id = episodeId.replace('rectv-episode-', '');
        
        // Season data içinden episode'u bul
        if (seasonData && Array.isArray(seasonData)) {
            for (const season of seasonData) {
                if (season.episodes && Array.isArray(season.episodes)) {
                    const episode = season.episodes.find(ep => ep.id == id);
                    if (episode && episode.sources && episode.sources.length > 0) {
                        const source = episode.sources[0];
                        console.log(`[RecTV] Found stream URL: ${source.url}`);
                        return {
                            url: source.url,
                            quality: source.quality || 'HD',
                            type: source.type || 'm3u8'
                        };
                    }
                }
            }
        }
        
        console.log(`[RecTV] No stream URL found for episode ${id}`);
    } catch (error) {
        console.log(`[RecTV] Stream error: ${error.message}`);
    }
    return null;
}

module.exports = { 
    RecTVSearch, 
    RecTVGetSeasons, 
    RecTVGetMovieDetails,
    RecTVGetStreamUrl,
    RECTV_BASE_URL,
    RECTV_DEVICE_ID,
    RECTV_SESSION_ID
};

