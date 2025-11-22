require("dotenv").config()
const manifest = {
    id: 'com.zeustv.addon',
    version: '2.0.0',
    name: 'Zeus TV',
    description: "Dizipal, Dizipal1513, RecTV, TvDiziler ve Zeus Spor'dan Türkçe dizi, film ve spor kanallarını Stremio'ya getirir. 5 kaynak, HD kalitede sınırsız içerik!",
    contactEmail: "",
    logo: process.env.HOSTING_URL ? `${process.env.HOSTING_URL}/logo.png` : 'http://localhost:7000/logo.png',
    background: process.env.HOSTING_URL ? `${process.env.HOSTING_URL}/background.jpg` : 'http://localhost:7000/background.jpg',
    behaviorHints: {
        configurable: false,
        configurationRequired: false,
    },
    catalogs: [
        {
            type: "series",
            id: "zeustv",
            name: "Zeus TV Diziler",
            extra: [{
                name: "search",
                isRequired: true
            }]
        },
        {
            type: "movie",
            id: "zeustv-movies",
            name: "Zeus TV Filmler",
            extra: [{
                name: "search",
                isRequired: true
            }]
        },
        {
            type: "tv",
            id: "zeusspor",
            name: "Zeus Spor Canlı TV",
            extra: [{
                name: "search",
                isRequired: true
            }]
        },
        {
            type: "series",
            id: "zeusdizi",
            name: "Zeus Dizi Son Bölümler",
            extra: [{
                name: "search",
                isRequired: true
            }]
        }
    ],
    resources: [
        'catalog',
        'stream', 
        'meta'
    ],
    types: ['series', 'movie', 'tv'],
    idPrefixes: [""]
}

module.exports = manifest;
