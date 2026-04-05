const https = require('https');

/**
 * Gulf Watch - OpenSky Aircraft Proxy
 * Proxies requests to OpenSky Network API for live aircraft tracking
 * in the Gulf/MENA region (lat 12-35, lon 34-60).
 *
 * Security: credentials sourced from environment variables, CORS
 * restricted to allowed origins, basic rate limiting via in-memory
 * sliding window.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://gulfwatch.io')
  .split(',')
  .map(o => o.trim());

const OPENSKY_USERNAME = process.env.OPENSKY_USERNAME;
const OPENSKY_PASSWORD = process.env.OPENSKY_PASSWORD;

// Simple in-memory sliding-window rate limiter (per-IP, 30 req / 60 s)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const requestLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  if (!requestLog.has(ip)) requestLog.set(ip, []);
  const timestamps = requestLog.get(ip).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  requestLog.set(ip, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  return false;
}

// Periodic cleanup to prevent memory leak (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const active = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (active.length === 0) requestLog.delete(ip);
    else requestLog.set(ip, active);
  }
}, 300_000);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = (req, res) => {
  // Determine caller origin
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  // CORS headers — restrict to known origins
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';

  if (isRateLimited(clientIp)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
    return;
  }

  // Validate credentials are configured
  if (!OPENSKY_USERNAME || !OPENSKY_PASSWORD) {
    console.error('[aircraft] Missing OPENSKY_USERNAME or OPENSKY_PASSWORD env vars');
    res.status(503).json({ error: 'Service misconfigured — contact administrator' });
    return;
  }

  const authString = Buffer.from(`${OPENSKY_USERNAME}:${OPENSKY_PASSWORD}`).toString('base64');

  const options = {
    hostname: 'opensky-network.org',
    path: '/api/states/all?lamin=12&lamax=35&lomin=34&lomax=60',
    method: 'GET',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Accept': 'application/json',
    },
    timeout: 15_000,
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
      } catch (parseErr) {
        console.error('[aircraft] Response parse error:', parseErr.message);
        res.status(502).json({ error: 'Upstream response parse error' });
      }
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Upstream timeout' });
  });

  proxyReq.on('error', (error) => {
    console.error('[aircraft] Proxy error:', error.message);
    res.status(502).json({ error: 'Upstream request failed' });
  });

  proxyReq.end();
};
