const https = require('https');

module.exports = (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    // OpenSky credentials (set OPENSKY_USERNAME / OPENSKY_PASSWORD in the environment)
    const username = process.env.OPENSKY_USERNAME;
    const password = process.env.OPENSKY_PASSWORD;

    if (!username || !password) {
        console.error('Missing OPENSKY_USERNAME or OPENSKY_PASSWORD env vars');
        res.status(500).json({ error: 'OpenSky credentials not configured' });
        return;
    }

    const authString = Buffer.from(`${username}:${password}`).toString('base64');
    
    const options = {
        hostname: 'opensky-network.org',
        path: '/api/states/all?lamin=12&lamax=35&lomin=34&lomax=60',
        method: 'GET',
        headers: {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json'
        }
    };
    
    const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        
        proxyRes.on('data', (chunk) => {
            data += chunk;
        });
        
        proxyRes.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                res.status(200).json(jsonData);
            } catch (e) {
                console.error('Aircraft feed parse error:', e.message, data.substring(0, 200));
                res.status(502).json({ error: 'Upstream feed returned an unreadable response' });
            }
        });
    });

    proxyReq.on('error', (error) => {
        console.error('Proxy error:', error.message);
        res.status(502).json({ error: 'Upstream feed request failed' });
    });
    
    proxyReq.end();
};