require("dotenv").config()
const MANIFEST = require('./manifest');
const landing = require("./src/landingTemplate");
const header = require('./header');
const fs = require('fs')
const Path = require("path");
const express = require("express");
const app = express();
const searchVideo = require("./src/search");
const listVideo = require("./src/videos");
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

var respond = function (res, data) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(data);
};

// Ana sayfa
app.get('/', function (req, res) {
    res.set('Content-Type', 'text/html');
    res.send(landing(MANIFEST));
});

app.get("/:userConf?/configure", function (req, res) {
    if (req.params.userConf !== "addon") {
        res.redirect("/addon/configure")
    } else {
        res.set('Content-Type', 'text/html');
        const newManifest = { ...MANIFEST };
        res.send(landing(newManifest));
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
        
        if (id == "cursorstrem") {
            var cached = myCache.get(search + type)
            if (cached) {
                return respond(res, { 
                    metas: cached,
                    cacheMaxAge: CACHE_MAX_AGE, 
                    staleRevalidate: STALE_REVALIDATE_AGE, 
                    staleError: STALE_ERROR_AGE 
                });
            }
            
            console.log(`[CATALOG] Searching for "${search}" in type "${type}"`);
            
            var metaData = [];
            
            // Search videolarını çek
            try {
                var video = await searchVideo.SearchMovieAndSeries(search);
                console.log(`[CATALOG] Search returned ${video ? video.length : 0} results`);
            } catch (searchError) {
                console.log(`[CATALOG ERROR] Search failed:`, searchError.message);
                var video = [];
            }

            if (video && Array.isArray(video)) {
                for (const item of video) {
                    if (typeof (item.type) === "undefined") {
                        item.type = "movie";
                    }
                    if (type === item.type) {
                        var value = {
                            id: item.url || item.slug,
                            type: item.type || "movie",
                            name: item.title || item.name,
                            poster: item.poster || item.image || "",
                            description: item.description || "",
                            genres: item.genres ? (typeof item.genres === 'string' ? item.genres.split(",").map(g => g.trim()) : item.genres) : []
                        }
                        metaData.push(value);
                    }
                }
            }
            
            myCache.set(search + type, metaData);
            return respond(res, { 
                metas: metaData,
                cacheMaxAge: CACHE_MAX_AGE, 
                staleRevalidate: STALE_REVALIDATE_AGE, 
                staleError: STALE_ERROR_AGE 
            });
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

        var data = await searchVideo.SearchMetaMovieAndSeries(id, type);

        if (data) {
            metaObj = {
                id: id,
                type: type,
                name: data.name,
                background: data.background,
                country: data.country || "TR",
                genres: [],
                season: Number(data.season) || undefined,
                videos: [],
                imdbRating: Number(data.imdbRating) || 0,
                description: data.description,
                releaseInfo: String(data.releaseInfo),
                poster: data.background,
                posterShape: 'poster',
            }
            
            // Series için bölümleri çek
            if (type === "series" && data.season) {
                for (let i = 1; i <= data.season; i++) {
                    var dizipalVideo = await searchVideo.SearchDetailMovieAndSeries(id, type, i);
                    if (dizipalVideo && Array.isArray(dizipalVideo) && dizipalVideo.length > 0) {
                        dizipalVideo.forEach(element => {
                            if (element && element.id) {
                                // ID'yi kısalt - Stremio için relative path yeterli
                                const videoId = element.id.replace('https://dizipall27.com', '').replace('http://dizipall27.com', '');
                                
                                // Bölüm başlığını düzenle - Dizi Adı + Sezon/Bölüm + İzle
                                const seasonStr = i.toString().padStart(2, '0');
                                const episodeStr = element.episode.toString().padStart(2, '0');
                                
                                // Kullanıcının istediği format: "Gibi - S06E10 Bölüm İzle"
                                const episodeTitle = `${data.name} - S${seasonStr}E${episodeStr} Bölüm İzle`;
                                
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

// Stream endpoint - Video URL'lerini döndürür (Stremio /addon prefix'siz çağırıyor!)
app.get('/stream/:type/:id(*)', async (req, res, next) => {
    try {
        var { type, id } = req.params;
        id = String(id).replace(".json", "");
        
        console.log(`Stream request: type=${type}, id=${id}`);
        
        if (id) {
            var video = await listVideo.GetVideos(id);
            if (video && video.url) {
                console.log(`Stream found for id: ${id}`);
                
                // ID'den dizi ismi ve bölüm bilgisini çıkar
                // Örnek: /dizi/gibi-d24/sezon-1/bolum-5
                let streamTitle = "CursorStrem İzle";
                
                try {
                    const urlParts = id.split('/');
                    // /dizi/slug/sezon-X/bolum-Y formatından bilgileri çıkar
                    if (urlParts.length >= 4) {
                        const slug = urlParts[2]; // gibi-d24
                        const seasonMatch = urlParts[3].match(/sezon-(\d+)/);
                        const episodeMatch = urlParts[4] ? urlParts[4].match(/bolum-(\d+)/) : null;
                        
                        if (slug && seasonMatch && episodeMatch) {
                            // Slug'dan dizi ismini temizle (- ile ayrılmış, son -dXX kısmını kaldır)
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

