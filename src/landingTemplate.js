module.exports = function landing(manifest) {
    const hostingUrl = process.env.HOSTING_URL || 'http://localhost:7000';
    // Stremio için URL'den http:// veya https:// kaldır
    const stremioUrl = hostingUrl.replace(/^https?:\/\//, '');
    return `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${manifest.name} - Premium Türkçe İçerik Platformu</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Poppins', sans-serif;
            background: #0a0e27;
            color: #ffffff;
            min-height: 100vh;
            overflow-x: hidden;
        }
        
        /* Animated Background */
        .bg-animation {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            overflow: hidden;
        }
        
        .bg-animation::before {
            content: '';
            position: absolute;
            width: 200%;
            height: 200%;
            background: linear-gradient(45deg, 
                #1e3a8a 0%, 
                #7c3aed 25%, 
                #db2777 50%, 
                #dc2626 75%, 
                #ea580c 100%);
            animation: gradientShift 15s ease infinite;
            opacity: 0.15;
        }
        
        @keyframes gradientShift {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            25% { transform: translate(-10%, 10%) rotate(90deg); }
            50% { transform: translate(10%, -10%) rotate(180deg); }
            75% { transform: translate(-10%, -10%) rotate(270deg); }
        }
        
        /* Lightning Effects */
        .lightning {
            position: absolute;
            width: 2px;
            height: 150px;
            background: linear-gradient(180deg, transparent, #60a5fa, transparent);
            animation: lightning 3s infinite;
            opacity: 0;
        }
        
        @keyframes lightning {
            0%, 100% { opacity: 0; transform: translateY(-100%); }
            10% { opacity: 1; }
            20% { opacity: 0; transform: translateY(100vh); }
        }
        
        .lightning:nth-child(1) { left: 10%; animation-delay: 0s; }
        .lightning:nth-child(2) { left: 30%; animation-delay: 1.5s; }
        .lightning:nth-child(3) { left: 50%; animation-delay: 3s; }
        .lightning:nth-child(4) { left: 70%; animation-delay: 4.5s; }
        .lightning:nth-child(5) { left: 90%; animation-delay: 6s; }
        
        /* Main Container */
        .container {
            position: relative;
            z-index: 1;
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        
        /* Header */
        .header {
            text-align: center;
            margin-bottom: 60px;
            animation: fadeInDown 1s ease;
        }
        
        @keyframes fadeInDown {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .logo-container {
            position: relative;
            margin-bottom: 30px;
        }
        
        .logo {
            width: 180px;
            height: 180px;
            margin: 0 auto;
            position: relative;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
        }
        
        .logo-text {
            font-size: 5em;
            font-weight: 800;
            background: linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 0 30px rgba(96, 165, 250, 0.5);
            position: relative;
            display: inline-block;
        }
        
        .logo-text::after {
            content: 'TV';
            position: absolute;
            right: -50px;
            top: -10px;
            font-size: 0.4em;
            background: linear-gradient(135deg, #f59e0b, #ef4444);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .tagline {
            font-size: 1.3em;
            color: #94a3b8;
            font-weight: 300;
            margin-top: 15px;
            letter-spacing: 1px;
        }
        
        /* Feature Cards */
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 25px;
            margin-bottom: 50px;
            width: 100%;
            animation: fadeInUp 1s ease 0.3s both;
        }
        
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .feature-card {
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            border: 1px solid rgba(96, 165, 250, 0.2);
            transition: all 0.3s ease;
        }
        
        .feature-card:hover {
            transform: translateY(-10px);
            border-color: rgba(96, 165, 250, 0.5);
            box-shadow: 0 20px 40px rgba(96, 165, 250, 0.2);
        }
        
        .feature-icon {
            font-size: 3em;
            margin-bottom: 15px;
        }
        
        .feature-title {
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 10px;
            color: #60a5fa;
        }
        
        .feature-desc {
            color: #94a3b8;
            font-size: 0.95em;
            line-height: 1.6;
        }
        
        /* CTA Section */
        .cta-section {
            text-align: center;
            animation: fadeInUp 1s ease 0.6s both;
        }
        
        .install-btn {
            display: inline-block;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899);
            color: white;
            padding: 20px 60px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: 600;
            font-size: 1.3em;
            transition: all 0.3s ease;
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.4);
            position: relative;
            overflow: hidden;
            border: 2px solid rgba(255, 255, 255, 0.1);
        }
        
        .install-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .install-btn:hover::before {
            left: 100%;
        }
        
        .install-btn:hover {
            transform: translateY(-5px) scale(1.05);
            box-shadow: 0 15px 40px rgba(59, 130, 246, 0.6);
        }
        
        .manual-install {
            margin-top: 40px;
            padding: 30px;
            background: rgba(30, 41, 59, 0.5);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            border: 1px solid rgba(96, 165, 250, 0.2);
        }
        
        .manual-install h3 {
            color: #60a5fa;
            font-size: 1.3em;
            margin-bottom: 15px;
        }
        
        .manual-install p {
            color: #cbd5e1;
            margin-bottom: 15px;
            line-height: 1.6;
        }
        
        .url-box {
            background: rgba(15, 23, 42, 0.8);
            padding: 15px 20px;
            border-radius: 10px;
            border: 1px solid rgba(96, 165, 250, 0.3);
            font-family: 'Courier New', monospace;
            color: #60a5fa;
            font-size: 1.1em;
            word-break: break-all;
            margin-top: 10px;
        }
        
        /* Stats */
        .stats {
            display: flex;
            justify-content: center;
            gap: 40px;
            margin-top: 50px;
            flex-wrap: wrap;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.5em;
            font-weight: 700;
            background: linear-gradient(135deg, #60a5fa, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .stat-label {
            color: #94a3b8;
            font-size: 0.9em;
            margin-top: 5px;
        }
        
        /* Footer */
        .footer {
            margin-top: 60px;
            text-align: center;
            color: #64748b;
            font-size: 0.9em;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .logo-text {
                font-size: 3.5em;
            }
            
            .tagline {
                font-size: 1.1em;
            }
            
            .features {
                grid-template-columns: 1fr;
            }
            
            .install-btn {
                padding: 18px 40px;
                font-size: 1.1em;
            }
            
            .stats {
                gap: 25px;
            }
        }
    </style>
</head>
<body>
    <div class="bg-animation">
        <div class="lightning"></div>
        <div class="lightning"></div>
        <div class="lightning"></div>
        <div class="lightning"></div>
        <div class="lightning"></div>
    </div>
    
    <div class="container">
        <div class="header">
            <div class="logo-container">
                <div class="logo">
                    <div class="logo-text">⚡ZEUS</div>
                </div>
            </div>
            <div class="tagline">Premium Türkçe İçerik Deneyimi</div>
        </div>
        
        <div class="features">
            <div class="feature-card">
                <div class="feature-icon">🎬</div>
                <div class="feature-title">Sınırsız İçerik</div>
                <div class="feature-desc">Binlerce Türkçe dizi ve filme anında erişim</div>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">⚡</div>
                <div class="feature-title">Işık Hızında</div>
                <div class="feature-desc">Akıllı cache sistemi ile ultra hızlı yükleme</div>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">🎯</div>
                <div class="feature-title">HD Kalite</div>
                <div class="feature-desc">Kristal netliğinde HD streaming deneyimi</div>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">🔄</div>
                <div class="feature-title">Otomatik Güncelleme</div>
                <div class="feature-desc">Yeni bölümler otomatik olarak eklenir</div>
            </div>
        </div>
        
        <div class="cta-section">
            <a href="stremio://${stremioUrl}/manifest.json" class="install-btn">
                ⚡ Hemen Başla
            </a>
            
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-number">1000+</div>
                    <div class="stat-label">Dizi & Film</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">HD</div>
                    <div class="stat-label">Kalite</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">24/7</div>
                    <div class="stat-label">Erişim</div>
                </div>
            </div>
            
            <div class="manual-install">
                <h3>📱 Manuel Kurulum</h3>
                <p><strong>1.</strong> Stremio'yu açın</p>
                <p><strong>2.</strong> Addons → Community Addons → URL ekle</p>
                <p><strong>3.</strong> Aşağıdaki URL'yi yapıştırın:</p>
                <div class="url-box">${hostingUrl}/manifest.json</div>
            </div>
        </div>
        
        <div class="footer">
            <p>⚡ Zeus TV - Powered by Lightning Technology</p>
            <p style="margin-top: 10px; font-size: 0.85em;">Tüm içerikler Dizipal'a aittir • Sadece eğitim amaçlıdır</p>
        </div>
    </div>
</body>
</html>`;
};
