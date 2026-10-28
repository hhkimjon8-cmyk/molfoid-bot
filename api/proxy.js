// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        const targetUrl = req.query.url;
        
        if (!targetUrl) {
            return res.status(400).send('❌ Missing ?url= parameter');
        }

        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.h5games4u.com/'
            },
            responseType: 'text'
        });

        let html = response.data;

        // 1. Inject <base> tag so assets load correctly
        const urlObj = new URL(targetUrl);
        const baseHref = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="${baseHref}">`);
        }

        // 2. Strip CSP tags
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        // 🚨 3. THE FIX: Ad Blocker & Fullscreen CSS 🚨
        const injection = `
        <script>
            // Block all popups and alerts
            window.open = function() { return null; };
            window.alert = function() {};
            window.confirm = function() { return true; };
            
            // Instantly delete the iframe error popup if it somehow appears
            setInterval(function() {
                var modals = document.querySelectorAll('#modal, .modal-overlay, .modal');
                modals.forEach(function(m) { m.remove(); });
            }, 50);
        </script>
        <style>
            /* Hide the error modal */
            #modal, .modal-overlay, .modal { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; z-index: -9999 !important; }
            
            /* Force Native Fullscreen Scaling */
            html, body { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important; }
            #Game, #GameCanvas { width: 100% !important; height: 100% !important; display: block !important; top: 0 !important; left: 0 !important; }
            canvas { object-fit: contain !important; }
        </style>
        `;

        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>' + injection);
        }

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
