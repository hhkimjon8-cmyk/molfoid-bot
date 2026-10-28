// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        // Get the game URL from the ?url= parameter
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

        // Inject <base> tag dynamically
        const urlObj = new URL(targetUrl);
        const baseHref = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="${baseHref}">`);
        }

        // Strip CSP and inject the anti-popup nuke
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        const antiIframeNuke = `
        <style>#modal, .modal-overlay { display: none !important; opacity: 0 !important; pointer-events: none !important; }</style>
        <script>
            const observer = new MutationObserver(() => {
                const modal = document.getElementById('modal');
                if (modal) modal.remove();
            });
            document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }));
            setInterval(() => {
                const btn = document.getElementById('confirmBtn') || document.getElementById('closeBtn');
                if (btn) btn.click();
            }, 500);
        </script>
        `;

        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>' + antiIframeNuke);
        }

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.removeHeader('X-Frame-Options');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
