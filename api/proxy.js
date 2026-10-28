// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).send('❌ Missing ?url= parameter');

        // Fetch the original game HTML
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

        // 1. Remove the annoying iframe error popup script
        const iframeCheckRegex = /<script\b[^>]*>[\s\S]*?The way this game is embedded is incorrect[\s\S]*?<\/script>/gi;
        html = html.replace(iframeCheckRegex, '');

        // 2. Inject the Base Tag
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="${origin}${basePath}">`);
        }

        // 3. Inject the Asset Interceptor & Ad Blocker
        const injection = `
        <script>
            const ORIGIN = "${origin}";
            const BASE_PATH = "${basePath}";

            // Fix absolute paths (e.g., "/level1/img.png" -> "https://cdn.yad.com/Just-Draw/level1/img.png")
            function fixUrl(url) {
                if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
                    return ORIGIN + BASE_PATH + url.substring(1);
                }
                return url;
            }

            // Intercept Fetch API
            const originalFetch = window.fetch;
            window.fetch = function(input, init) {
                let url = typeof input === 'string' ? input : (input ? input.url : '');
                if (url) {
                    const fixedUrl = fixUrl(url);
                    if (fixedUrl !== url) {
                        if (typeof input === 'string') input = fixedUrl;
                        else if (input instanceof Request) input = new Request(fixedUrl, input);
                    }
                }
                return originalFetch(input, init);
            };

            // Intercept XMLHttpRequest
            const originalXHR = window.XMLHttpRequest;
            window.XMLHttpRequest = function() {
                const xhr = new originalXHR();
                const originalOpen = xhr.open;
                xhr.open = function(method, url, ...args) {
                    return originalOpen.call(this, method, fixUrl(url), ...args);
                };
                return xhr;
            };

            // Intercept Image loading
            const OriginalImage = window.Image;
            window.Image = function(...args) {
                const img = new OriginalImage(...args);
                const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
                Object.defineProperty(img, 'src', {
                    set: function(val) { descriptor.set.call(this, fixUrl(val)); },
                    get: function() { return descriptor.get.call(this); }
                });
                return img;
            };

            // Kill all popups and alerts
            window.open = function() { return null; };
            window.alert = function() {};
            window.confirm = function() { return true; };
            setInterval(function() {
                document.querySelectorAll('#modal, .modal-overlay, .modal').forEach(m => m.remove());
            }, 50);
        </script>
        <style>
            /* Force Fullscreen and Hide Modals */
            #modal, .modal-overlay, .modal { display: none !important; opacity: 0 !important; pointer-events: none !important; }
            html, body { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important; }
            #Game, #GameCanvas { width: 100% !important; height: 100% !important; display: block !important; top: 0 !important; left: 0 !important; }
            canvas { object-fit: contain !important; }
        </style>
        `;

        // Inject everything right after <head>
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
