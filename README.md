# ⚡ Zeus TV - Stremio Eklentisi

> **Türkiye'nin En Hızlı ve En Kapsamlı Stremio Eklentisi**

Dizipal'dan binlerce Türkçe dizi ve filmi HD kalitede Stremio'ya getirir. Lightning technology ile ultra hızlı streaming deneyimi!

## ✨ Özellikler

- ⚡ **Lightning Fast** - Işık hızında yükleme ve streaming
- 🎬 **Binlerce İçerik** - Türk dizileri ve filmler
- 🎯 **HD Kalite** - Kristal netliğinde video kalitesi
- 🔄 **Otomatik Güncelleme** - Yeni bölümler anında eklenir
- 🌐 **Akıllı Domain Tespiti** - Her zaman çalışan bağlantı
- 💾 **Akıllı Cache** - Optimize edilmiş performans
- 🎨 **Modern Arayüz** - Premium kullanıcı deneyimi

## 📋 Gereksinimler

- **Node.js** v14+ ([İndir](https://nodejs.org/))
- **Stremio** ([İndir](https://www.stremio.com/downloads))

## 🚀 Kurulum

### Hızlı Kurulum

```bash
# 1. Projeyi indir
git clone https://github.com/KULLANICI_ADIN/zeustv-stremio-addon.git
cd zeustv-stremio-addon

# 2. Bağımlılıkları yükle
npm install

# 3. Başlat!
npm start
```

Sunucu başladığında:
```
⚡ Zeus TV çalışıyor!
📡 http://localhost:7000
```

### Stremio'ya Ekleme

**Otomatik (Önerilen):**
1. Tarayıcıda aç: http://localhost:7000
2. **"⚡ Hemen Başla"** butonuna tıkla

**Manuel:**
1. Stremio → Addons → URL ekle
2. `http://localhost:7000/manifest.json` gir
3. Install tıkla

## 🎯 Nasıl Kullanılır?

1. Stremio'yu aç
2. Discover veya Search'ten içerik ara
3. İzlemek istediğin diziyi seç
4. Sağda **"Zeus TV"** altında stream görünecek
5. İzlemeye başla! ⚡

## 📁 Proje Yapısı

```
zeustv-stremio-addon/
├── 📄 index.js                 # Ana sunucu
├── 📄 manifest.js              # Stremio manifest
├── 📄 package.json             # Bağımlılıklar
├── 📄 .gitignore               # Git ignore
├── 📄 README.md                # Bu dosya
├── 📁 src/
│   ├── search.js               # İçerik arama ve scraping
│   ├── videos.js               # Video URL çıkarma
│   ├── sslfix.js               # SSL ayarları
│   └── landingTemplate.js      # Modern web arayüzü
├── 📁 cache/
│   └── active_domain.cache     # Domain cache
└── 📁 static/
    ├── images/                 # Logo ve görseller
    └── subs/                   # Altyazılar
```

## ⚙️ Yapılandırma

`.env` dosyası oluşturarak özelleştirin:

```env
# Port (varsayılan: 7000)
PORT=7000

# Hosting URL
HOSTING_URL=http://localhost:7000

# Proxy URL (varsayılan: otomatik)
PROXY_URL=https://dizipall27.com
```

## 🔧 Performans Ayarları

Zeus TV akıllı cache sistemi kullanır:

| Veri Tipi | Cache Süresi | Amaç |
|-----------|--------------|------|
| Domain | 6 saat | Stability |
| Meta | 1 saat | Fresh content |
| Bölümler | 30 dakika | Latest episodes |
| Stream | 10 dakika | Fast access |

### Cache Temizleme

```bash
# Cache klasörüne git
cd cache

# Windows
del *.cache

# Linux/Mac
rm *.cache

# NOT: active_domain.cache'i sakla!
```

## 🛠️ Teknoloji Stack

| Teknoloji | Amaç |
|-----------|------|
| Express.js | Web server |
| Axios | HTTP client |
| Cheerio | HTML parsing |
| Node-cache | In-memory cache |
| Stremio SDK | Stremio integration |

## 🐛 Sorun Giderme

### Port kullanımda

```bash
# Windows
netstat -ano | findstr :7000
taskkill /PID <PID> /F

# Linux/Mac  
lsof -ti:7000 | xargs kill -9
```

### Failed to Fetch

1. Sunucu çalışıyor mu? → http://localhost:7000
2. Eklentiyi kaldır ve tekrar ekle
3. Stremio'yu yeniden başlat

### Yavaş Yükleme

- İlk yükleme: ~8-10 saniye (cache dolacak)
- Sonraki: <1 saniye ⚡
- Internet bağlantınızı kontrol edin

## 📊 Performans

| Metric | Değer |
|--------|-------|
| İlk Yükleme | ~8s |
| Cache'li Yükleme | <1s ⚡ |
| Stream Başlatma | Anında |
| Concurrent Users | Sınırsız |

## 🚀 Deploy (Opsiyonel)

### Heroku

```bash
# Heroku CLI ile
heroku create zeustv-app
git push heroku main
heroku config:set HOSTING_URL=https://zeustv-app.herokuapp.com
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 7000
CMD ["node", "index.js"]
```

```bash
docker build -t zeustv .
docker run -p 7000:7000 zeustv
```

## 📝 GitHub'a Yükleme

### İlk Kez

```bash
# Git ayarla
git config --global user.email "email@example.com"
git config --global user.name "YourName"

# Commit
git add .
git commit -m "Initial commit - Zeus TV"

# GitHub'a push
git remote add origin https://github.com/USERNAME/zeustv-stremio-addon.git
git branch -M main
git push -u origin main
```

### Güncelleme

```bash
git add .
git commit -m "Update: açıklama"
git push
```

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing`)
5. Pull Request açın

## 📈 Roadmap

- [ ] Film desteği
- [ ] Çoklu dil altyazı
- [ ] Torrent entegrasyonu
- [ ] Mobil uygulama
- [ ] Premium özellikler

## ❓ SSS

**S: Yasal mı?**  
C: Bu proje sadece eğitim amaçlıdır. İçerik Dizipal'a aittir.

**S: Ücretsiz mi?**  
C: Evet, tamamen ücretsiz ve açık kaynak!

**S: Internet gerekli mi?**  
C: Evet, içerik online olarak stream edilir.

**S: Hangi cihazlarda çalışır?**  
C: Stremio'nun desteklediği tüm cihazlarda (Windows, Mac, Linux, Android, iOS)

## ⚖️ Yasal Uyarı

Bu proje **sadece eğitim amaçlıdır**. Tüm içerikler Dizipal'a aittir. Kullanıcılar yasal sorumluluğu kabul eder.

## 📄 Lisans

MIT License - Özgürce kullanın!

## 🌟 Destek

Projeyi beğendiyseniz ⭐ vermeyi unutmayın!

**Sorular?** [Issues](https://github.com/USERNAME/zeustv-stremio-addon/issues) açın

---

<div align="center">

**⚡ Zeus TV - Lightning Fast Streaming**

Made with ❤️ in Turkey

[Website](http://localhost:7000) • [GitHub](https://github.com) • [Stremio](https://www.stremio.com)

</div>
