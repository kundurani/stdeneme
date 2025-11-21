// SSL sertifika doğrulamasını atla (geliştirme için)
module.exports = {
    httpsAgent: require('https').Agent({
        rejectUnauthorized: false
    })
};

