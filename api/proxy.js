// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        const targetUrl = 'https://www.h5games4u.com/games/Brainrot-Escape-Diamond-Quest/index.html?cid=yyg';
        
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.h5games4u.com/'
            },
            responseType: 'text'
        });

        let html = response.data;

        // 1. Inject <base> tag so game assets load correctly
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head><base href="https://www.h5games4u.com/games/Brainrot-Escape-Diamond-Quest/">');
        }

        // 2. Strip Meta CSP tags
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        // 🚨 3. THE FIX: Inject a script to nuke the popup dynamically 🚨
        const antiIframeNuke = `
        <script>
            // Forcefully hide the modal via CSS immediately
            const style = document.createElement('style');
            style.innerHTML = '#modal, .modal-overlay { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }';
            document.head.appendChild(style);

            // Watch for the modal being added to the DOM and delete it
            const observer = new MutationObserver(() => {
                const modal = document.getElementById('modal');
                if (modal) {
                    modal.remove();
                }
            });
            
            // Start observing once the body is ready
            document.addEventListener('DOMContentLoaded', () => {
                observer.observe(document.body, { childList: true, subtree: true });
            });

            // Fallback: Auto-click the close/confirm buttons if they somehow show up
            setInterval(() => {
                const btn = document.getElementById('confirmBtn') || document.getElementById('closeBtn');
                if (btn) btn.click();
            }, 500);
        </script>
        `;

        // Inject the nuke script right after <head>
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>' + antiIframeNuke);
        }

        // Send the modified HTML back
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.removeHeader('X-Frame-Options');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
