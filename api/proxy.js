// api/proxy.js (Vercel Serverless Function)
const axios = require('axios');

module.exports = async (req, res) => {
    try {
        const targetUrl = 'https://www.h5games4u.com/games/Brainrot-Escape-Diamond-Quest/index.html?cid=yyg';
        
        // Fetch the game's HTML using standard browser headers
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Referer': 'https://www.h5games4u.com/'
            },
            responseType: 'text'
        });

        let html = response.data;

        // 🚨 THE FIX: Inject a <base> tag so relative files (JS/CSS/Images) load from the original site
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head><base href="https://www.h5games4u.com/games/Brainrot-Escape-Diamond-Quest/">');
        }

        // Strip out any Meta CSP tags that might block embedding
        html = html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
        
        // Send the modified HTML back to your frontend, overriding security headers
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.removeHeader('X-Frame-Options'); // Remove the block!
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
