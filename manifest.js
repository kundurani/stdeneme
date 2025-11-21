require("dotenv").config()
const manifest = {
    id: 'com.zeustv.addon',
    version: '1.0.0',
    name: 'Zeus TV',
    description: "Dizipal'dan Türkçe dizi ve filmleri Stremio'ya getirir. HD kalitede sınırsız içerik!",
    contactEmail: "",
    logo: process.env.HOSTING_URL ? `${process.env.HOSTING_URL}/logo.png` : 'http://localhost:7000/logo.png',
    background: process.env.HOSTING_URL ? `${process.env.HOSTING_URL}/background.jpg` : 'http://localhost:7000/background.jpg',
    behaviorHints: {
        configurable: false,
        configurationRequired: false,
    },
    catalogs: [{
        type: "series",
        id: "zeustv",
        name: "Zeus TV Diziler",
        extra: [{
            name: "search",
            isRequired: true
        }]
    }],
    resources: ['stream', 'meta'],
    types: ['series'],
    idPrefixes: ["/"]
}

module.exports = manifest;
