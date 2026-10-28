// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        // 1. Check if the game SDK is requesting the missing logo
        if (req.url.includes('/gameSDK/logo/OTHER/144x144.png')) {
            // Return a transparent 1x1 pixel image
            const transparentPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.status(200).send(transparentPixel);
        }

        // 2. Otherwise, fetch the game HTML
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

        // 3. Inject <base> tag so game assets load correctly
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head><base href="https://www.h5games4u.com/games/Brainrot-Escape-Diamond-Quest/">');
        }

        // 4. Strip Meta CSP tags
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        // 5. Remove the anti-iframe script (the popup error)
        const iframeCheckRegex = /<script\b[^>]*>[\s\S]*?The way this game is embedded is incorrect[\s\S]*?<\/script>/gi;
        html = html.replace(iframeCheckRegex, '');

        // 6. Send the modified HTML back
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.removeHeader('X-Frame-Options');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
