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

        // 🚨 3. THE FIX: Remove the anti-iframe script 🚨
        // This regex finds the script block containing the specific error message and deletes it.
        // It looks for <script> ... "The way this game is embedded is incorrect" ... </script>
        const iframeCheckRegex = /<script\b[^>]*>[\s\S]*?The way this game is embedded is incorrect[\s\S]*?<\/script>/gi;
        
        // We replace it with an empty string to delete the check completely
        html = html.replace(iframeCheckRegex, '');

        // Send the modified HTML back
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.removeHeader('X-Frame-Options');
        
        res.status(200).send(html);
    } catch (error) {
        res.status(500).send('❌ Proxy Error: ' + error.message);
    }
};
