// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send('❌ Missing ?url= parameter');

        // Fetch the game's original HTML
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.h5games4u.com/'
            },
            responseType: 'text'
        });

        let html = response.data;
        const urlObj = new URL(targetUrl);
        const origin = urlObj.origin; // e.g., https://cdn.yad.com
        const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1); // e.g., /Just-Draw/

        // 🚨 THE FIX: Parse the HTML and rewrite absolute paths 🚨
        const $ = cheerio.load(html);

        // Loop through all elements that load assets
        $('script, link, img, source, video, audio').each((i, el) => {
            const src = $(el).attr('src');
            const href = $(el).attr('href');
            const dataSrc = $(el).attr('data-src');

            // Rewrite 'src' attributes
            if (src && src.startsWith('/')) {
                $(el).attr('src', `${origin}${src}`);
            }
            // Rewrite 'href' attributes (for CSS)
            if (href && href.startsWith('/')) {
                $(el).attr('href', `${origin}${href}`);
            }
            // Rewrite 'data-src' attributes
            if (dataSrc && dataSrc.startsWith('/')) {
                $(el).attr('data-src', `${origin}${dataSrc}`);
            }
        });

        html = $.html();

        // Inject <base> tag as a fallback for relative paths
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="${origin}${basePath}">`);
        }

        // Strip CSP headers
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        // Anti-popup nuke & Fullscreen CSS
        const injection = `
        <script>
            window.open = function() { return null; };
            window.alert = function() {};
            window.confirm = function() { return true; };
            setInterval(function() {
                document.querySelectorAll('#modal, .modal-overlay, .modal').forEach(m => m.remove());
            }, 50);
        </script>
        <style>
            #modal, .modal-overlay, .modal { display: none !important; opacity: 0 !important; pointer-events: none !important; }
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
        res.removeHeader('X-Frame-Options');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
