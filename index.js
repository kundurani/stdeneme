require("dotenv").config()
const MANIFEST = require('./manifest');
const landing = require("./src/landingTemplate");
const header = require('./header');
const fs = require('fs')
const Path = require("path");
const express = require("express");
const app = express();

// Reverse proxy desteği (Render.com, Heroku, vb. için)
// Bu ayar, x-forwarded-* header'larının doğru şekilde işlenmesini sağlar
app.set('trust proxy', true);
const searchVideo = require("./src/search");
const listVideo = require("./src/videos");
const rectv = require("./src/rectv");
const tvdiziler = require("./src/tvdiziler");
const dizipal1513 = require("./src/dizipal1513");
const neonspor = require("./src/neonspor");
const path = require("path");
const NodeCache = require("node-cache");
const { v4: uuidv4 } = require('uuid');
const subsrt = require('subtitle-converter');
const Axios = require('axios')
const axiosRetry = require("axios-retry").default;
const { setupCache } = require("axios-cache-interceptor");

const instance = Axios.create();
const axios = setupCache(instance);
axiosRetry(axios, { retries: 2 });

// Cache süreleri - HIZLI ama GÜNCEL
const CACHE_MAX_AGE = 1 * 60 * 60; // 1 saat - güncel içerik için
const STALE_REVALIDATE_AGE = 2 * 60 * 60; // 2 saat
const STALE_ERROR_AGE = 24 * 60 * 60; // 1 gün

// NodeCache - Daha agresif cache (1 saat)
const myCache = new NodeCache({ 
    stdTTL: 60 * 60, // 1 saat cache
    checkperiod: 120, // Her 2 dakikada kontrol et
    useClones: false // Performans için clone yapma
});

// Static dosyalar
app.use(express.static(path.join(__dirname, "static")));

// NeonSpor stream URL'lerini periyodik olarak güncelle (canlı TV için)
// Her 5 dakikada bir M3U dosyasından güncel URL'leri çek
setInterval(async () => {
    try {
        console.log(`[NeonSpor] Periodic update: Fetching stream URLs from M3U file...`);
        const neonsporModule = require("./src/neonspor");
        if (neonsporModule && typeof neonsporModule.updateStreamUrlsFromGitHub === 'function') {
            await neonsporModule.updateStreamUrlsFromGitHub();
        }
    } catch (error) {
        console.log(`[NeonSpor] Periodic update error: ${error.message}`);
    }
}, 5 * 60 * 1000); // 5 dakikada bir

// İlk başlatmada hemen güncelle
setTimeout(async () => {
    try {
        console.log(`[NeonSpor] Initial update: Fetching stream URLs from M3U file...`);
        const neonsporModule = require("./src/neonspor");
        if (neonsporModule && typeof neonsporModule.updateStreamUrlsFromGitHub === 'function') {
            await neonsporModule.updateStreamUrlsFromGitHub();
        }
    } catch (error) {
        console.log(`[NeonSpor] Initial update error: ${error.message}`);
    }
}, 5000); // 5 saniye sonra ilk güncelleme

var respond = function (res, data) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(data);
};

// Ana sayfa
app.get('/', function (req, res) {
    res.set('Content-Type', 'text/html');
    // Request'ten gelen host bilgisini al (dinamik domain)
    // Reverse proxy (Render.com, Heroku, vb.) için x-forwarded-* header'larını öncelikle kontrol et
    let protocol = 'http';
    if (req.headers['x-forwarded-proto']) {
        protocol = req.headers['x-forwarded-proto'].split(',')[0].trim();
    } else if (req.protocol === 'https' || req.secure) {
        protocol = 'https';
    }
    
    let host = null;
    // Önce x-forwarded-host'u kontrol et (reverse proxy için)
    if (req.headers['x-forwarded-host']) {
        host = req.headers['x-forwarded-host'].split(',')[0].trim();
    }
    // Sonra req.get('host') veya req.headers.host
    if (!host) {
        host = req.get('host') || req.headers.host;
    }
    // Eğer hala yoksa varsayılan
    if (!host) {
        host = 'localhost:7000';
    }
    
    const hostingUrl = process.env.HOSTING_URL || `${protocol}://${host}`;
    console.log(`[LANDING] Request headers:`, {
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'host': req.headers.host,
        'req.protocol': req.protocol,
        'req.secure': req.secure
    });
    console.log(`[LANDING] Using hosting URL: ${hostingUrl}`);
    res.send(landing(MANIFEST, hostingUrl));
});

app.get("/:userConf?/configure", function (req, res) {
    if (req.params.userConf !== "addon") {
        res.redirect("/addon/configure")
    } else {
        res.set('Content-Type', 'text/html');
        // Request'ten gelen host bilgisini al (dinamik domain)
        // Reverse proxy (Render.com, Heroku, vb.) için x-forwarded-* header'larını öncelikle kontrol et
        let protocol = 'http';
        if (req.headers['x-forwarded-proto']) {
            protocol = req.headers['x-forwarded-proto'].split(',')[0].trim();
        } else if (req.protocol === 'https' || req.secure) {
            protocol = 'https';
        }
        
        let host = null;
        // Önce x-forwarded-host'u kontrol et (reverse proxy için)
        if (req.headers['x-forwarded-host']) {
            host = req.headers['x-forwarded-host'].split(',')[0].trim();
        }
        // Sonra req.get('host') veya req.headers.host
        if (!host) {
            host = req.get('host') || req.headers.host;
        }
        // Eğer hala yoksa varsayılan
        if (!host) {
            host = 'localhost:7000';
        }
        
        const hostingUrl = process.env.HOSTING_URL || `${protocol}://${host}`;
        console.log(`[LANDING] Using hosting URL: ${hostingUrl}`);
        const newManifest = { ...MANIFEST };
        res.send(landing(newManifest, hostingUrl));
    }
});

// Manifest endpoint
app.get('/manifest.json', function (req, res) {
    return respond(res, MANIFEST);
});

app.get('/addon/manifest.json', function (req, res) {
    return respond(res, MANIFEST);
});

app.get('/:userConf/manifest.json', function (req, res) {
    return respond(res, MANIFEST);
});

// Catalog endpoint - Arama sonuçlarını döndürür (Stremio /addon prefix'siz çağırıyor!)
app.get("/catalog/:type/:id/search=:search", async (req, res, next) => {
    try {
        var { type, id, search } = req.params;
        search = search.replace(".json", "");
        
        // Zeus TV catalog ID'leri: zeustv (series), zeustv-movies (movie) ve neonspor (tv)
        if (id == "zeustv" || id == "zeustv-movies" || id == "neonspor") {
            var cached = myCache.get(search + type)
            if (cached) {
                console.log(`[CATALOG] Cache hit for "${search}" type "${type}"`);
                return respond(res, { 
                    metas: cached,
                    cacheMaxAge: CACHE_MAX_AGE, 
                    staleRevalidate: STALE_REVALIDATE_AGE, 
                    staleError: STALE_ERROR_AGE 
                });
            }
            
            console.log(`[CATALOG] Searching for "${search}" in type "${type}" (catalog: ${id})`);
            
            var metaData = [];
            
            // Search videolarını çek
            try {
                var video = [];
                
                // TV type ise sadece NeonSpor'dan ara
                if (type === "tv" && id == "neonspor") {
                    var neonsporResults = await neonspor.NeonSporSearch(search);
                    console.log(`[CATALOG] NeonSpor returned ${neonsporResults ? neonsporResults.length : 0} results`);
                    video = neonsporResults || [];
                } else {
                    // Series ve Movie için diğer kaynaklardan ara
                    // 1. RecTV'den ara
                    var rectvResults = await rectv.RecTVSearch(search);
                    console.log(`[CATALOG] RecTV returned ${rectvResults ? rectvResults.length : 0} results`);
                    
                    // 2. Dizipal'dan ara
                    var dizipalResults = await searchVideo.SearchMovieAndSeries(search);
                    console.log(`[CATALOG] Dizipal returned ${dizipalResults ? dizipalResults.length : 0} results`);
                    
                    // 3. Dizipal1513'den ara
                    var dizipal1513Results = await dizipal1513.Dizipal1513Search(search);
                    console.log(`[CATALOG] Dizipal1513 returned ${dizipal1513Results ? dizipal1513Results.length : 0} results`);
                    
                    // 4. TvDiziler'den ara
                    var tvdizilerResults = await tvdiziler.TvDizilerSearch(search);
                    console.log(`[CATALOG] TvDiziler returned ${tvdizilerResults ? tvdizilerResults.length : 0} results`);
                    
                    // 5. NeonSpor'dan canlı TV kanallarını ara (genel aramalarda da göster)
                    var neonsporResults = [];
                    try {
                        neonsporResults = await neonspor.NeonSporSearch(search);
                        console.log(`[CATALOG] NeonSpor returned ${neonsporResults ? neonsporResults.length : 0} results for general search`);
                    } catch (neonsporError) {
                        console.log(`[CATALOG] NeonSpor search error: ${neonsporError.message}`);
                    }
                    
                    // 6. Tüm kaynaklardan gelen sonuçları birleştir (NeonSpor dahil)
                    video = [...(rectvResults || []), ...(dizipalResults || []), ...(dizipal1513Results || []), ...(tvdizilerResults || []), ...(neonsporResults || [])];
                    console.log(`[CATALOG] Total results: ${video.length} (RecTV: ${rectvResults ? rectvResults.length : 0}, Dizipal: ${dizipalResults ? dizipalResults.length : 0}, Dizipal1513: ${dizipal1513Results ? dizipal1513Results.length : 0}, TvDiziler: ${tvdizilerResults ? tvdizilerResults.length : 0}, NeonSpor: ${neonsporResults ? neonsporResults.length : 0})`);
                }
            } catch (searchError) {
                console.log(`[CATALOG ERROR] Search failed:`, searchError.message);
                var video = [];
            }

            if (video && Array.isArray(video)) {
                for (const item of video) {
                    // Type kontrolü - RecTV sonuçlarında zaten type var, Dizipal için URL'den belirle
                    if (typeof (item.type) === "undefined") {
                        // RecTV sonuçlarında type zaten var, sadece Dizipal için kontrol et
                        if (item.url && item.url.includes('/film/')) {
                            item.type = "movie";
                        } else if (item.url && item.url.includes('/dizi/')) {
                            item.type = "series";
                        } else {
                            item.type = "movie"; // Default
                        }
                    }
                    
                    // Sadece istenen type'ı ekle (veya NeonSpor canlı TV kanalları için tv type'ını da göster)
                    // Genel aramalarda (series/movie) canlı TV kanallarını da göster
                    const isNeonSpor = item.id && item.id.startsWith('neonspor-');
                    const shouldInclude = (type === item.type) || (isNeonSpor && item.type === 'tv' && (type === 'series' || type === 'movie'));
                    
                    if (shouldInclude) {
                        // Poster yoksa veya varsayılan SVG ise, meta bilgilerinden çek
                        // RecTV sonuçlarında poster zaten var (item.image), Dizipal için meta çek
                        let poster = item.poster || item.image || "";
                        const isRecTV = item.id && item.id.startsWith('rectv-');
                        const isTvDiziler = item.id && item.id.startsWith('tvdiziler-');
                        const isDizipal1513 = item.id && item.id.startsWith('dizipal1513-');
                        
                        // Sadece Dizipal sonuçları için meta çek (RecTV, TvDiziler ve Dizipal1513'de zaten poster var)
                        if (!isRecTV && !isTvDiziler && !isDizipal1513 && (!poster || poster.includes('dual-') || poster.includes('.svg') || poster.includes('base64'))) {
                            try {
                                // Meta bilgilerini çek ve poster'ı al (sadece Dizipal için)
                                if (item.url) {
                                const metaInfo = await searchVideo.SearchMetaMovieAndSeries(item.url, item.type);
                                if (metaInfo && metaInfo.poster) {
                                    poster = metaInfo.poster;
                                    console.log(`[CATALOG] Fetched poster from meta for ${item.title || item.name}: ${poster.substring(0, 50)}...`);
                                    }
                                }
                            } catch (metaError) {
                                // Sessizce devam et - poster yoksa boş kalır
                            }
                        }
                        
                        // ID'yi temizle - Stremio encode etmesin diye prefix'siz gönder
                        let cleanId = item.id || item.url || item.slug;
                        
                        // Dizipal için prefix temizle (RecTV, TvDiziler ve Dizipal1513 için zaten temiz)
                        if (cleanId && typeof cleanId === 'string' && !isRecTV && !isTvDiziler && !isDizipal1513) {
                            if (cleanId.startsWith('/dizi/')) {
                                cleanId = cleanId.replace('/dizi/', '');
                            } else if (cleanId.startsWith('/film/')) {
                                cleanId = cleanId.replace('/film/', '');
                            }
                        }
                        
                        // Kaynak bilgisini ekle (Dizipal, Dizipal1513, RecTV, TvDiziler veya NeonSpor)
                        const isNeonSpor = item.id && item.id.startsWith('neonspor-');
                        const source = item.source || (isNeonSpor ? 'NeonSpor' : (isRecTV ? 'RecTV' : (isTvDiziler ? 'TvDiziler' : (isDizipal1513 ? 'Dizipal1513' : 'Dizipal'))));
                        const itemName = item.title || item.name || 'Unknown';
                        const nameWithSource = `${itemName} [${source}]`;
                        
                        // Genres formatını kontrol et ve düzelt - Stremio string array bekliyor
                        let genres = [];
                        if (item.genres) {
                            if (typeof item.genres === 'string') {
                                // String ise virgülle ayır
                                genres = item.genres.split(",").map(g => g.trim()).filter(g => g.length > 0);
                            } else if (Array.isArray(item.genres)) {
                                // Array ise kontrol et
                                genres = item.genres.map(g => {
                                    // Eğer obje ise title'ı al, string ise direkt kullan
                                    if (typeof g === 'object' && g !== null && g.title) {
                                        return g.title;
                                    } else if (typeof g === 'string') {
                                        return g;
                                    }
                                    return null;
                                }).filter(g => g !== null && g.length > 0); // null ve boş string'leri filtrele
                            }
                        }
                        
                        var value = {
                            id: cleanId,
                            type: item.type || type,
                            name: nameWithSource,
                            poster: poster,
                            description: item.description || "",
                            genres: genres // Düzeltilmiş format: string array
                        }
                        metaData.push(value);
                        console.log(`[CATALOG] Added ${source} result: ${itemName} (type: ${item.type}, id: ${cleanId})`);
                    } else {
                        // Type eşleşmediği için log
                        console.log(`[CATALOG] Skipped ${item.title || item.name} - type mismatch (wanted: ${type}, got: ${item.type})`);
                    }
                }
                console.log(`[CATALOG] Filtered to ${metaData.length} results for type "${type}"`);
            }
            
            myCache.set(search + type, metaData);
            return respond(res, { 
                metas: metaData,
                cacheMaxAge: CACHE_MAX_AGE, 
                staleRevalidate: STALE_REVALIDATE_AGE, 
                staleError: STALE_ERROR_AGE 
            });
        } else {
            console.log(`[CATALOG] Unknown catalog ID: ${id}`);
            return respond(res, { metas: [] });
        }
    } catch (error) {
        console.log('Catalog error:', error);
        return respond(res, { metas: [] });
    }
})

// Meta endpoint - Dizi/film detaylarını döndürür (Stremio /addon prefix'siz çağırıyor!)
app.get('/meta/:type/:id(*)', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        
        // URL decode - Stremio %2F gibi encode ediyor
        id = decodeURIComponent(id);
        
        // Eğer ID /dizi/ veya /film/ ile başlıyorsa, prefix'i kaldır
        if (id.startsWith('/dizi/')) {
            id = id.replace('/dizi/', '');
        } else if (id.startsWith('/film/')) {
            id = id.replace('/film/', '');
        }
        
        console.log(`Meta request: type=${type}, id=${id}`);
        
        var metaObj = {};
        var cached = myCache.get('meta_' + id);
        if (cached) {
            return respond(res, { 
                meta: cached,
                cacheMaxAge: CACHE_MAX_AGE, 
                staleRevalidate: STALE_REVALIDATE_AGE, 
                staleError: STALE_ERROR_AGE 
            })
        }

        // RecTV mi TvDiziler mi Dizipal1513 mi NeonSpor mu Dizipal mi kontrol et
        if (id.startsWith('neonspor-')) {
            // NeonSpor içeriği - Canlı TV
            console.log(`[META] NeonSpor content detected: ${id}`);
            
            if (type === 'tv') {
                const meta = await neonspor.NeonSporGetChannelMeta(id);
                if (meta) {
                    var data = {
                        name: meta.name,
                        background: meta.background || meta.poster || '',
                        country: meta.country || 'TR',
                        season: meta.season || 1,
                        imdbRating: meta.imdbRating || 0,
                        description: meta.description || '',
                        releaseInfo: meta.releaseInfo || '',
                        runtime: undefined,
                        poster: meta.poster || meta.background || ''
                    };
                } else {
                    var data = null;
                }
            } else {
                var data = null;
            }
        } else if (id.startsWith('dizipal1513-')) {
            // Dizipal1513 içeriği
            console.log(`[META] Dizipal1513 content detected: ${id}`);
            
            if (type === 'series') {
                const meta = await dizipal1513.Dizipal1513GetSeriesMeta(id);
                if (meta) {
                    var data = {
                        name: meta.name,
                        background: meta.background || meta.poster || '',
                        country: meta.country || 'TR',
                        season: meta.season || 1,
                        imdbRating: meta.imdbRating || 0,
                        description: meta.description || '',
                        releaseInfo: meta.releaseInfo || '',
                        runtime: undefined,
                        poster: meta.poster || meta.background || ''
                    };
                } else {
                    var data = null;
                }
            } else if (type === 'movie') {
                // Dizipal1513 film desteği şimdilik yok
                var data = null;
            } else {
                var data = null;
            }
        } else if (id.startsWith('tvdiziler-')) {
            // TvDiziler içeriği
            console.log(`[META] TvDiziler content detected: ${id}`);
            
            if (type === 'series') {
                const meta = await tvdiziler.TvDizilerGetSeriesMeta(id);
                if (meta) {
                    var data = {
                        name: meta.name,
                        background: meta.background || meta.poster || '',
                        country: meta.country || 'TR',
                        season: meta.season || 1,
                        imdbRating: meta.imdbRating || 0,
                        description: meta.description || '',
                        releaseInfo: meta.releaseInfo || '',
                        runtime: undefined,
                        poster: meta.poster || meta.background || ''
                    };
                } else {
                    var data = null;
                }
            } else if (type === 'movie') {
                // TvDiziler film desteği şimdilik yok
                var data = null;
            } else {
                var data = null;
            }
        } else if (id.startsWith('rectv-')) {
            // RecTV içeriği
            console.log(`[META] RecTV content detected: ${id}`);
            
            // Search cache'inden RecTV bilgilerini al
            let rectvInfo = null;
            // Tüm cache key'lerini kontrol et
            const allCacheKeys = myCache.keys();
            for (const cacheKey of allCacheKeys) {
                // Catalog cache'leri "search+type" formatında (örn: "mahsunseries")
                if (cacheKey.includes('search') || (!cacheKey.includes('meta_') && !cacheKey.includes('rectv_seasons_'))) {
                    const cachedResults = myCache.get(cacheKey);
                    if (Array.isArray(cachedResults)) {
                        const found = cachedResults.find(item => item.id === id);
                        if (found) {
                            rectvInfo = found;
                            console.log(`[META] Found RecTV info in cache key: ${cacheKey}`);
                            break;
                        }
                    }
                }
            }
            
            // Cache'de bulunamazsa, search yap
            if (!rectvInfo) {
                console.log(`[META] RecTV info not in cache, searching...`);
                // ID'den sayısal kısmı al (rectv-6465 -> 6465)
                const numericId = id.replace('rectv-', '');
                // Basit bir arama yap (örneğin "mahsun" gibi)
                // Ama bu çok karmaşık olur, şimdilik cache'e güvenelim
            }
            
            if (type === 'series') {
                // RecTV dizisi için seasons al
                const seasons = await rectv.RecTVGetSeasons(id);
                
                // Seasons'ı cache'e kaydet (stream için gerekli)
                if (seasons && seasons.length > 0) {
                    myCache.set(`rectv_seasons_${id}`, seasons, 60 * 60); // 1 saat
                    
                    // Search sonucundan bilgileri al
                    let serieTitle = rectvInfo ? (rectvInfo.name || rectvInfo.title || '').replace(' [RecTV]', '').replace(' [Dizipal]', '') : `RecTV Serie ${id.replace('rectv-', '')}`;
                    let poster = rectvInfo ? (rectvInfo.poster || rectvInfo.image || '') : '';
                    let description = rectvInfo ? (rectvInfo.description || '') : '';
                    let year = rectvInfo && rectvInfo.year ? String(rectvInfo.year) : '';
                    let imdbRating = rectvInfo && rectvInfo.imdb ? Number(rectvInfo.imdb) : 0;
                    let genres = rectvInfo && rectvInfo.genres ? rectvInfo.genres : [];
                    
                    console.log(`[META] RecTV Serie Title: ${serieTitle}, Poster: ${poster.substring(0, 50)}...`);
                    
                    var data = {
                        name: serieTitle,
                        background: poster || '',
                        country: 'TR',
                        season: seasons.length,
                        imdbRating: imdbRating,
                        description: description,
                        releaseInfo: year,
                        runtime: undefined,
                        poster: poster
                    };
                } else {
                    // Seasons yoksa bile basic bilgileri döndür
                    let serieTitle = rectvInfo ? rectvInfo.name.replace(' [RecTV]', '') : `RecTV Serie ${id.replace('rectv-', '')}`;
                    var data = {
                        name: serieTitle,
                        background: rectvInfo ? rectvInfo.poster : '',
                        country: 'TR',
                        season: 0,
                        imdbRating: rectvInfo && rectvInfo.imdb ? Number(rectvInfo.imdb) : 0,
                        description: rectvInfo ? rectvInfo.description : '',
                        releaseInfo: rectvInfo && rectvInfo.year ? String(rectvInfo.year) : '',
                        runtime: undefined,
                        poster: rectvInfo ? rectvInfo.poster : ''
                    };
                }
            } else if (type === 'movie') {
                // RecTV filmi
                let movieTitle = rectvInfo ? rectvInfo.name.replace(' [RecTV]', '') : `RecTV Film ${id.replace('rectv-', '')}`;
                var data = {
                    name: movieTitle,
                    background: rectvInfo ? rectvInfo.poster : '',
                    country: 'TR',
                    season: 0,
                    imdbRating: rectvInfo && rectvInfo.imdb ? Number(rectvInfo.imdb) : 0,
                    description: rectvInfo ? rectvInfo.description : '',
                    releaseInfo: rectvInfo && rectvInfo.year ? String(rectvInfo.year) : '',
                    runtime: rectvInfo && rectvInfo.duration ? parseInt(rectvInfo.duration) : undefined,
                    poster: rectvInfo ? rectvInfo.poster : ''
                };
            } else {
                var data = null;
            }
        } else {
            // Dizipal içeriği
            const fullId = type === 'movie' ? `/film/${id}` : `/dizi/${id}`;
            var data = await searchVideo.SearchMetaMovieAndSeries(fullId, type);
        }

        if (data) {
            metaObj = {
                id: id,
                type: type,
                       name: id.startsWith('tvdiziler-') ? `${data.name} [TvDiziler]` : (id.startsWith('rectv-') ? `${data.name} [RecTV]` : (id.startsWith('dizipal1513-') ? `${data.name} [Dizipal1513]` : (id.startsWith('neonspor-') ? `${data.name} [NeonSpor]` : `${data.name} [Dizipal]`))),
                background: data.background || data.poster || '',
                country: data.country || "TR",
                genres: [],
                season: Number(data.season) || undefined,
                videos: [],
                imdbRating: Number(data.imdbRating) || 0,
                description: data.description,
                releaseInfo: String(data.releaseInfo),
                poster: data.poster || data.background || '',
                posterShape: 'poster',
                runtime: type === "movie" && data.runtime ? Number(data.runtime) : undefined, // Filmler için runtime (dakika)
            }
            
            // TV type için canlı yayın bölümü ekle
            if (type === "tv" && id.startsWith('neonspor-')) {
                // NeonSpor kanalı - Canlı TV için tek bir "episode" göster
                const episodes = await neonspor.NeonSporGetEpisodes(id, 1);
                if (episodes && Array.isArray(episodes) && episodes.length > 0) {
                    episodes.forEach(element => {
                        if (element && element.id) {
                            const seasonNum = element.season || 1;
                            const episodeNum = element.episode || 1;
                            
                            const streamId = element.id;
                            const episodeTitle = `${data.name} - Canlı Yayın [NeonSpor]`;
                            
                            metaObj.videos.push({
                                id: streamId,
                                title: episodeTitle,
                                released: "2024-01-09T00:00:00.000Z",
                                season: seasonNum,
                                episode: episodeNum,
                                overview: element.title || episodeTitle,
                                thumbnail: element.thumbnail || ""
                            });
                        }
                    });
                }
            } else if (type === "series" && data.season) {
                // Series için bölümleri çek
                // RecTV mi TvDiziler mi Dizipal1513 mi Dizipal mi?
                if (id.startsWith('dizipal1513-')) {
                    // Dizipal1513 dizisi - Sadece Dizipal1513 bölümlerini göster
                    for (let i = 1; i <= data.season; i++) {
                        const episodes = await dizipal1513.Dizipal1513GetEpisodes(id, i);
                        if (episodes && Array.isArray(episodes) && episodes.length > 0) {
                            episodes.forEach(element => {
                                if (element && element.id) {
                                    // Sezon ve bölüm numarasını çıkar
                                    const seasonNum = element.season || i;
                                    const episodeNum = element.episode || 1;
                                    
                                    const seasonStr = seasonNum.toString().padStart(2, '0');
                                    const episodeStr = episodeNum.toString().padStart(2, '0');
                                    
                                    // Stream için ID formatı: dizipal1513-episodeUrl
                                    let episodeUrl = element.id.startsWith('/') ? element.id.substring(1) : element.id;
                                    const streamId = `dizipal1513-${episodeUrl}`;
                                    
                                    const episodeTitle = `${data.name} - S${seasonStr}E${episodeStr} Bölüm İzle [Dizipal1513]`;
                                    
                                    metaObj.videos.push({
                                        id: streamId,
                                        title: episodeTitle,
                                        released: "2024-01-09T00:00:00.000Z",
                                        season: seasonNum,
                                        episode: episodeNum,
                                        overview: element.title || episodeTitle,
                                        thumbnail: element.thumbnail || ""
                                    });
                                }
                            });
                        }
                    }
                } else if (id.startsWith('tvdiziler-')) {
                    // TvDiziler dizisi - Sadece TvDiziler bölümlerini göster
                    for (let i = 1; i <= data.season; i++) {
                        const episodes = await tvdiziler.TvDizilerGetEpisodes(id, i);
                        if (episodes && Array.isArray(episodes) && episodes.length > 0) {
                            episodes.forEach(element => {
                                if (element && element.id) {
                                    // Sezon ve bölüm numarasını çıkar
                                    const seasonNum = element.season || i;
                                    const episodeNum = element.episode || 1;
                                    
                                    const seasonStr = seasonNum.toString().padStart(2, '0');
                                    const episodeStr = episodeNum.toString().padStart(2, '0');
                                    
                                    // Stream için ID formatı: tvdiziler-episodeUrl
                                    // episodeUrl formatı: slug-{episode}-bolum-izle veya slug-{episode}-bolum-izle-full
                                    let episodeUrl = element.id.startsWith('/') ? element.id.substring(1) : element.id;
                                    // Stream ID: tvdiziler-episodeUrl (slug tekrar etmeye gerek yok)
                                    const streamId = `tvdiziler-${episodeUrl}`;
                                    
                                    const episodeTitle = `${data.name} - S${seasonStr}E${episodeStr} Bölüm İzle [TvDiziler]`;
                                    
                                    metaObj.videos.push({
                                        id: streamId,
                                        title: episodeTitle,
                                        released: "2024-01-09T00:00:00.000Z",
                                        season: seasonNum,
                                        episode: episodeNum,
                                        overview: element.title || episodeTitle,
                                        thumbnail: element.thumbnail || ""
                                    });
                                }
                            });
                        }
                    }
                } else if (id.startsWith('rectv-')) {
                    // RecTV dizisi - Sadece RecTV bölümlerini göster
                    const seasons = await rectv.RecTVGetSeasons(id);
                    
                    // Seasons'ı cache'e kaydet (stream için gerekli)
                    myCache.set(`rectv_seasons_${id}`, seasons, 60 * 60); // 1 saat cache
                        
                        // RecTV bölümlerini ekle
                    if (seasons && Array.isArray(seasons)) {
                        for (let seasonIndex = 0; seasonIndex < seasons.length; seasonIndex++) {
                            const season = seasons[seasonIndex];
                            const seasonNum = seasonIndex + 1;
                            
                            if (season.episodes && Array.isArray(season.episodes)) {
                                for (let episodeIndex = 0; episodeIndex < season.episodes.length; episodeIndex++) {
                                    const episode = season.episodes[episodeIndex];
                                    const episodeNum = episodeIndex + 1;
                                    const seasonStr = seasonNum.toString().padStart(2, '0');
                                    const episodeStr = episodeNum.toString().padStart(2, '0');
                                    
                                    // RecTV episode ID formatı: serieId:episodeId (stream için gerekli)
                                    const videoId = `${id}:${episode.id}`;
                                    const episodeTitle = `${data.name} - S${seasonStr}E${episodeStr} Bölüm İzle [RecTV]`;
                                    
                                    // RecTV stream'i ekle
                                    metaObj.videos.push({
                                        id: videoId,
                                        title: episodeTitle,
                                        released: "2024-01-09T00:00:00.000Z",
                                        season: seasonNum,
                                        episode: episodeNum,
                                        overview: episode.title || episodeTitle,
                                        thumbnail: ""
                                    });
                                }
                            }
                        }
                    }
                } else {
                    // Dizipal dizisi - Sadece Dizipal bölümlerini göster
                    for (let i = 1; i <= data.season; i++) {
                        // ID'ye type prefix ekle (/dizi/)
                        const fullId = `/dizi/${id}`;
                        var dizipalVideo = await searchVideo.SearchDetailMovieAndSeries(fullId, type, i);
                    if (dizipalVideo && Array.isArray(dizipalVideo) && dizipalVideo.length > 0) {
                        dizipalVideo.forEach(element => {
                            if (element && element.id) {
                                // Dizi için sadece relative path yeterli (Stremio zaten /stream/series/ ekliyor)
                                // element.id = "/dizi/slug/sezon-X/bolum-Y" formatında
                                // Stremio'ya sadece "dizi/slug/sezon-X/bolum-Y" göndermemiz lazım (başındaki / olmadan)
                                let videoId = element.id.replace('https://dizipall27.com', '').replace('http://dizipall27.com', '');
                                if (videoId.startsWith('/')) videoId = videoId.substring(1); // Başındaki / kaldır
                                
                                // Bölüm başlığını düzenle - Dizi Adı + Sezon/Bölüm + İzle
                                const seasonStr = i.toString().padStart(2, '0');
                                const episodeStr = element.episode.toString().padStart(2, '0');
                                
                                // Kullanıcının istediği format: "Gibi - S06E10 Bölüm İzle"
                                const episodeTitle = `${data.name} - S${seasonStr}E${episodeStr} Bölüm İzle [Dizipal]`;
                                
                                    // Dizipal stream'i ekle
                                    metaObj.videos.push({
                                        id: videoId,
                                        title: episodeTitle,
                                        released: "2024-01-09T00:00:00.000Z",
                                        season: i,
                                        episode: element.episode,
                                        overview: element.title || episodeTitle,
                                        thumbnail: element.thumbnail || ""
                                    });
                                }
                            });
                        }
                    }
                }
            } else if (type === "movie") {
                // Filmler için tek video ekle (bölüm yok)
                // ID'ye type prefix ekle (/film/)
                const fullId = `/film/${id}`;
                var movieVideo = await searchVideo.SearchDetailMovieAndSeries(fullId, type, 0);
                if (movieVideo && Array.isArray(movieVideo) && movieVideo.length > 0) {
                    const element = movieVideo[0];
                    if (element && element.id) {
                        // Film için sadece slug kullan (Stremio zaten /stream/movie/ ekliyor)
                        // element.id = "/film/slug" formatında
                        // Stremio'ya sadece "slug" göndermemiz lazım
                        let videoId = element.id.replace('https://dizipall27.com', '').replace('http://dizipall27.com', '');
                        videoId = videoId.replace('/film/', ''); // /film/ prefix'ini kaldır
                        
                        // Film başlığı
                        const movieTitle = `${data.name} - Film İzle`;
                        
                        metaObj.videos.push({
                            id: videoId,
                            title: movieTitle,
                            released: "2024-01-09T00:00:00.000Z",
                            overview: data.description || movieTitle,
                            thumbnail: element.thumbnail || data.background || ""
                        });
                    }
                }
            }
            
            myCache.set('meta_' + id, metaObj);
            console.log(`Meta for "${data.name}": ${metaObj.videos.length} episodes`);
            return respond(res, { 
                meta: metaObj,
                cacheMaxAge: CACHE_MAX_AGE, 
                staleRevalidate: STALE_REVALIDATE_AGE, 
                staleError: STALE_ERROR_AGE 
            })
        } else {
            console.log(`Meta not found for id: ${id}`);
            return respond(res, { meta: null });
        }
    } catch (error) {
        console.log('Meta error:', error);
        return respond(res, { meta: null });
    }
})

// YouTube Proxy Endpoint - YouTube URL'lerini stream URL'lerine çevirir
app.get('/youtube-proxy/:youtubeUrl(*)', async (req, res, next) => {
    try {
        const encodedUrl = req.params.youtubeUrl;
        const youtubeUrl = decodeURIComponent(encodedUrl);
        
        console.log(`[YOUTUBE-PROXY] Converting YouTube URL to stream: ${youtubeUrl}`);
        
        // YouTube video ID'yi çıkar
        const videoIdMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (!videoIdMatch || !videoIdMatch[1]) {
            return res.status(400).send('Invalid YouTube URL');
        }
        
        const videoId = videoIdMatch[1];
        const ytdl = require('@distube/ytdl-core');
        
        // YouTube'dan stream bilgilerini al
        const videoInfo = await ytdl.getInfo(youtubeUrl, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });
        
        // En yüksek kaliteli video+audio formatını al
        const formats = videoInfo.formats || [];
        const videoFormats = formats.filter(f => f.hasVideo && f.hasAudio && f.url && !f.isLive);
        
        if (videoFormats.length === 0) {
            return res.status(404).send('No video format found');
        }
        
        // Kaliteye göre sırala (yüksekten düşüğe)
        videoFormats.sort((a, b) => {
            const qualityA = a.qualityLabel ? parseInt(a.qualityLabel.replace('p', '')) : 0;
            const qualityB = b.qualityLabel ? parseInt(b.qualityLabel.replace('p', '')) : 0;
            return qualityB - qualityA;
        });
        
        const bestFormat = videoFormats[0];
        const streamUrl = bestFormat.url;
        
        console.log(`[YOUTUBE-PROXY] Found stream URL (quality: ${bestFormat.qualityLabel || 'unknown'})`);
        
        // Stream URL'ini direkt döndür (Stremio bunu oynatabilir)
        // CORS headers ekle
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Content-Type', 'application/json');
        res.json({ url: streamUrl });
    } catch (error) {
        console.log(`[YOUTUBE-PROXY] Error: ${error.message}`);
        res.status(500).json({ error: 'Error converting YouTube URL' });
    }
});

// Stream endpoint - Video URL'lerini döndürür (Stremio /addon prefix'siz çağırıyor!)
app.get('/stream/:type/:id(*)', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        
        // URL decode - Stremio %2F gibi encode ediyor
        id = decodeURIComponent(id);
        
        console.log(`Stream request: type=${type}, id=${id}`);
        
        if (id) {
            // RecTV mi TvDiziler mi Dizipal1513 mi NeonSpor mu Dizipal mi kontrol et
            if (id.startsWith('neonspor-')) {
                // NeonSpor kanal stream - Canlı TV
                console.log(`[STREAM] NeonSpor channel detected: ${id}`);
                
                // ID formatı: neonspor-{channelId}-live -> neonspor-{channelId}
                const channelId = id.replace('-live', '');
                const videoData = await neonspor.NeonSporGetStreamUrl(channelId);
                if (videoData && videoData.url) {
                    return respond(res, {
                        streams: [{
                            url: videoData.url,
                            title: "NeonSpor [Canlı Yayın]",
                            subtitles: videoData.subtitles || []
                        }]
                    });
                }
                console.log(`[STREAM] NeonSpor stream URL not found for: ${id}`);
                return respond(res, { streams: [] });
            } else if (id.startsWith('dizipal1513-')) {
                // Dizipal1513 episode stream
                console.log(`[STREAM] Dizipal1513 episode detected: ${id}`);
                
                // ID formatı: dizipal1513-episodeUrl
                const withoutPrefix = id.replace('dizipal1513-', '');
                const episodeUrl = withoutPrefix.startsWith('/') ? withoutPrefix : `/${withoutPrefix}`;
                
                const videoData = await dizipal1513.Dizipal1513GetVideoUrl(episodeUrl);
                if (videoData && videoData.url) {
                    return respond(res, {
                        streams: [{
                            url: videoData.url,
                            title: "Dizipal1513",
                            subtitles: videoData.subtitles || []
                        }]
                    });
                }
                console.log(`[STREAM] Dizipal1513 video URL not found for: ${id}`);
                return respond(res, { streams: [] });
            } else if (id.startsWith('tvdiziler-')) {
                // TvDiziler episode stream
                console.log(`[STREAM] TvDiziler episode detected: ${id}`);
                
                // ID formatı: tvdiziler-slug-episodeUrl
                // episodeUrl formatı: slug-{episode}-bolum-izle veya slug-{episode}-bolum-izle-full
                // Örnek: tvdiziler-guller-ve-gunahlar-son-bolum-izle-1-guller-ve-gunahlar-7-bolum-izle
                // İlk "tvdiziler-" kısmını kaldır
                const withoutPrefix = id.replace('tvdiziler-', '');
                
                // Slug'ı bulmak için cache'den veya meta'dan alabiliriz, ama şimdilik
                // episodeUrl'in başında slug olduğunu varsayalım
                // En iyi yöntem: episodeUrl'i direkt kullan (zaten tam path)
                const episodeUrl = withoutPrefix.startsWith('/') ? withoutPrefix : `/${withoutPrefix}`;
                
                const videoData = await tvdiziler.TvDizilerGetVideoUrl(episodeUrl);
                if (videoData) {
                    // YouTube ID varsa ytId formatında döndür
                    if (videoData.ytId) {
                        console.log(`[STREAM] TvDiziler YouTube video detected: ${videoData.ytId}`);
                        return respond(res, {
                            streams: [{
                                ytId: videoData.ytId,
                                title: "TvDiziler [YouTube]",
                                subtitles: videoData.subtitles || []
                            }]
                        });
                    } else if (videoData.url) {
                        // Normal video URL'i varsa url formatında döndür
                        return respond(res, {
                            streams: [{
                                url: videoData.url,
                                title: "TvDiziler",
                                subtitles: videoData.subtitles || []
                            }]
                        });
                    }
                }
                console.log(`[STREAM] TvDiziler video URL not found for: ${id}`);
                return respond(res, { streams: [] });
            } else if (id.includes('rectv-')) {
                // RecTV episode stream
                // ID formatı: rectv-4669:35256 (serieId:episodeId)
                console.log(`[STREAM] RecTV episode detected: ${id}`);
                
                const parts = id.split(':');
                if (parts.length === 2) {
                    const serieId = parts[0]; // rectv-4669
                    const episodeId = parts[1]; // 35256
                    
                    // Cache'den seasons al
                    const seasons = myCache.get(`rectv_seasons_${serieId}`);
                    
                    if (seasons && Array.isArray(seasons)) {
                        // Episode'u bul
                        for (const season of seasons) {
                            if (season.episodes && Array.isArray(season.episodes)) {
                                const episode = season.episodes.find(ep => ep.id == episodeId);
                                if (episode && episode.sources && episode.sources.length > 0) {
                                    const source = episode.sources[0];
                                    var video = {
                                        url: source.url,
                                        subtitles: []
                                    };
                                    console.log(`[STREAM] RecTV stream found: ${source.url.substring(0, 80)}...`);
                                    break;
                                }
                            }
                        }
                    } else {
                        console.log(`[STREAM] RecTV seasons not in cache, fetching...`);
                        // Cache'de yoksa tekrar çek
                        const freshSeasons = await rectv.RecTVGetSeasons(serieId);
                        if (freshSeasons) {
                            myCache.set(`rectv_seasons_${serieId}`, freshSeasons, 60 * 60);
                            // Episode'u bul
                            for (const season of freshSeasons) {
                                if (season.episodes && Array.isArray(season.episodes)) {
                                    const episode = season.episodes.find(ep => ep.id == episodeId);
                                    if (episode && episode.sources && episode.sources.length > 0) {
                                        const source = episode.sources[0];
                                        var video = {
                                            url: source.url,
                                            subtitles: []
                                        };
                                        console.log(`[STREAM] RecTV stream found (fresh): ${source.url.substring(0, 80)}...`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (!video) {
                    console.log(`[STREAM] RecTV stream not found for ${id}`);
                    var video = null;
                }
            } else {
                // Dizipal içeriği
                // Film için: id = "slug" -> "/film/slug"
                // Dizi için: id = "dizi/slug/sezon-X/bolum-Y" -> "/dizi/slug/sezon-X/bolum-Y"
                let fullId = id;
                
                // Başında / yoksa ekle
                if (!id.startsWith('/')) {
                    fullId = `/${id}`;
                }
                
                // Film için /film/ prefix'i yoksa ekle (sadece slug ise)
                if (type === 'movie') {
                    if (!fullId.includes('/film/') && !fullId.includes('/dizi/')) {
                        // Sadece slug var, /film/ ekle
                        fullId = fullId.replace('/', '/film/');
                    }
                }
                
                console.log(`[STREAM] Dizipal: Fetching video from ${fullId}`);
                var video = await listVideo.GetVideos(fullId);
            }
            if (video && video.url) {
                console.log(`Stream found for id: ${id}`);
                
                // ID'den içerik ismi ve bilgisini çıkar
                // Örnek diziler: /dizi/gibi-d24/sezon-1/bolum-5
                // Örnek filmler: /film/one-battle-after-another
                let streamTitle = "Zeus TV İzle";
                
                try {
                    const urlParts = id.split('/').filter(p => p); // Boş stringleri filtrele
                    
                    if (urlParts[0] === 'film' && urlParts.length >= 2) {
                        // Film formatı: /film/slug
                        const slug = urlParts[1];
                        const movieName = slug
                            .replace(/-d\d+$/, '') // Son -dXX kısmını kaldır
                            .split('-')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                            .join(' ');
                        
                        streamTitle = `${movieName} - Film İzle`;
                    } else if (urlParts[0] === 'dizi' && urlParts.length >= 4) {
                        // Dizi formatı: /dizi/slug/sezon-X/bolum-Y
                        const slug = urlParts[1];
                        const seasonMatch = urlParts[2]?.match(/sezon-(\d+)/);
                        const episodeMatch = urlParts[3]?.match(/bolum-(\d+)/);
                        
                        if (slug && seasonMatch && episodeMatch) {
                            // Slug'dan dizi ismini temizle
                            const seriesName = slug
                                .replace(/-d\d+$/, '') // Son -dXX kısmını kaldır
                                .split('-')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            
                            const season = seasonMatch[1].padStart(2, '0');
                            const episode = episodeMatch[1].padStart(2, '0');
                            
                            streamTitle = `${seriesName} - S${season}E${episode} Bölüm İzle`;
                        }
                    }
                } catch (parseError) {
                    console.log('Stream title parse error:', parseError.message);
                    // Hata olursa default title kullan
                }
                
                const stream = { 
                    url: video.url,
                    title: streamTitle
                };
                
                if (video.subtitles && video.subtitles.length > 0) {
                    myCache.set('subs_' + id, video.subtitles);
                }
                return respond(res, { 
                    streams: [stream],
                    cacheMaxAge: CACHE_MAX_AGE, 
                    staleRevalidate: STALE_REVALIDATE_AGE, 
                    staleError: STALE_ERROR_AGE 
                })
            } else {
                console.log(`No video found for id: ${id}`);
            }
        }
        return respond(res, { streams: [] });
    } catch (error) {
        console.log('Stream error:', error);
        return respond(res, { streams: [] });
    }
})

// Subtitles endpoint (Stremio /addon prefix'siz çağırıyor!)
app.get('/subtitles/:type/:id(*)', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        var subtitles = [];
        var data = myCache.get('subs_' + id)
        
        if (data && Array.isArray(data)) {
            for (const value of data) {
                const valueStr = String(value);
                
                if (valueStr.includes("Türkçe")) {
                    var url = valueStr.replace("[Türkçe]", "");
                    var newUrl = await WriteSubtitles(url, uuidv4());
                    if (newUrl) {
                        subtitles.push({ url: newUrl, lang: "tur", id: "cursorstrem-tur" });
                    }
                }
                if (valueStr.includes("İngilizce")) {
                    var url = valueStr.replace("[İngilizce]", "");
                    var newUrl = await WriteSubtitles(url, uuidv4());
                    if (newUrl) {
                        subtitles.push({ url: newUrl, lang: "eng", id: "cursorstrem-eng" });
                    }
                }
            }

            if (subtitles.length > 0) {
                return respond(res, { 
                    subtitles: subtitles,
                    cacheMaxAge: CACHE_MAX_AGE, 
                    staleRevalidate: STALE_REVALIDATE_AGE, 
                    staleError: STALE_ERROR_AGE 
                })
            }
        }
        return respond(res, { subtitles: [] });
    } catch (error) {
        console.log('Subtitles error:', error);
        return respond(res, { subtitles: [] });
    }
})

async function WriteSubtitles(url, name) {
    try {
        var response = await axios({ url: url, method: "GET", headers: header, timeout: 10000 });
        if (response && response.status === 200) {
            CheckSubtitleFoldersAndFiles();
            const outputExtension = '.srt';
            const options = {
                removeTextFormatting: true,
            };

            var subtitle = subsrt.convert(response.data, outputExtension, options).subtitle;

            const subsDir = path.join(__dirname, "static", "subs");
            if (!fs.existsSync(subsDir)) {
                fs.mkdirSync(subsDir, { recursive: true });
            }
            
            fs.writeFileSync(path.join(subsDir, name + ".srt"), subtitle);
            var subtitleUrl = `${process.env.HOSTING_URL || 'http://localhost:7000'}/subs/${name}.srt`;
            return subtitleUrl;
        }
    } catch (error) {
        console.log('WriteSubtitles error:', error.message);
    }
    return null;
}

function CheckSubtitleFoldersAndFiles() {
    try {
        const folderPath = path.join(__dirname, "static", "subs");

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const files = fs.readdirSync(folderPath);

        if (files.length > 500) {
            files.forEach((file) => {
                const filePath = Path.join(folderPath, file);
                const fileStats = fs.statSync(filePath);

                if (fileStats.isFile()) {
                    fs.unlinkSync(filePath);
                } else if (fileStats.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true });
                }
            });
        }
    } catch (error) {
        console.log('CheckSubtitleFoldersAndFiles error:', error.message);
    }
}

if (module.parent) {
    module.exports = app;
} else {
    const port = process.env.PORT || 7000;
    app.listen(port, function (err) {
        if (err) {
            return console.error("Error in server setup", err.message);
        }
        console.log(`Stremio eklentisi çalışıyor: http://localhost:${port}`);
        console.log(`Manifest: http://localhost:${port}/manifest.json`);
    });
}

