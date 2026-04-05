/**
 * Gulf Watch - Central API Router
 *
 * Vercel serverless function that dispatches to route handlers.
 * Applies auth, rate limiting, CORS, and structured error responses.
 */

const crypto = require('crypto');
const { auth, requireRole } = require('./middleware/auth');
const { apiLimiter, authLimiter, heavyLimiter, aircraftLimiter } = require('./middleware/rate-limit');

// Route handlers
const incidentsHandler = require('./routes/incidents');
const entitiesHandler = require('./routes/entities');
const modulesHandler = require('./routes/modules');
const exportHandler = require('./routes/export');
const authHandler = require('./routes/auth');
const aircraftHandler = require('./aircraft');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://gulfwatch.io')
  .split(',')
  .map(o => o.trim());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRequestId() {
  return `gw-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function sendError(res, status, message, requestId) {
  return res.status(status).json({
    error: message,
    code: status,
    requestId,
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [key, ...rest] = c.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=').trim();
  });
  return cookies;
}

/**
 * Apply CORS headers based on allowed origins.
 */
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, ETag');
}

/**
 * Run middleware as a promise.
 */
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Parse JSON body from request.
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

function matchRoute(pathname) {
  // /api/auth/login, /api/auth/refresh, /api/auth/logout
  if (pathname === '/api/auth/login') return { handler: 'auth', action: 'login' };
  if (pathname === '/api/auth/refresh') return { handler: 'auth', action: 'refresh' };
  if (pathname === '/api/auth/logout') return { handler: 'auth', action: 'logout' };

  // /api/incidents
  if (pathname === '/api/incidents') return { handler: 'incidents' };

  // /api/entities
  if (pathname === '/api/entities') return { handler: 'entities' };

  // /api/modules/:name
  const modulesMatch = pathname.match(/^\/api\/modules\/([a-z]+)$/);
  if (modulesMatch) return { handler: 'modules', name: modulesMatch[1] };

  // /api/export/:format
  const exportMatch = pathname.match(/^\/api\/export\/([a-z0-9]+)$/);
  if (exportMatch) return { handler: 'export', format: exportMatch[1] };

  // /api/aircraft
  if (pathname === '/api/aircraft') return { handler: 'aircraft' };

  // /api/health
  if (pathname === '/api/health') return { handler: 'health' };

  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  const requestId = req.headers['x-request-id'] || generateRequestId();
  const startTime = Date.now();

  // Attach requestId to response
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CORS
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  req.query = Object.fromEntries(url.searchParams.entries());
  req.cookies = parseCookies(req.headers.cookie);

  // Match route
  const route = matchRoute(pathname);

  if (!route) {
    console.log(`[api] ${req.method} ${pathname} -> 404 (${Date.now() - startTime}ms) [${requestId}]`);
    return sendError(res, 404, 'Not found', requestId);
  }

  try {
    // --- Health (no auth, no rate limit) ---
    if (route.handler === 'health') {
      console.log(`[api] ${req.method} ${pathname} -> 200 (${Date.now() - startTime}ms) [${requestId}]`);
      return res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '2.0.0',
        requestId,
      });
    }

    // --- Auth routes (rate limited, no auth required) ---
    if (route.handler === 'auth') {
      await runMiddleware(req, res, authLimiter);
      if (res.writableEnded) return;

      try {
        req.body = await parseBody(req);
      } catch (e) {
        return sendError(res, 400, 'Invalid JSON body', requestId);
      }

      req.requestId = requestId;
      console.log(`[api] ${req.method} ${pathname} -> auth/${route.action} [${requestId}]`);
      return await authHandler(req, res, route.action);
    }

    // --- Aircraft (rate limited, no auth for public data) ---
    if (route.handler === 'aircraft') {
      await runMiddleware(req, res, aircraftLimiter);
      if (res.writableEnded) return;

      console.log(`[api] ${req.method} ${pathname} -> aircraft [${requestId}]`);
      return aircraftHandler(req, res);
    }

    // --- Protected routes: auth + rate limiting ---

    // Apply auth
    await runMiddleware(req, res, auth);
    if (res.writableEnded) return;

    req.requestId = requestId;

    // Apply rate limiting per endpoint type
    if (route.handler === 'export') {
      await runMiddleware(req, res, heavyLimiter);
    } else {
      await runMiddleware(req, res, apiLimiter);
    }
    if (res.writableEnded) return;

    // Dispatch to handler
    switch (route.handler) {
      case 'incidents':
        console.log(`[api] ${req.method} ${pathname} -> incidents [${requestId}] user=${req.user.sub}`);
        return await incidentsHandler(req, res);

      case 'entities':
        console.log(`[api] ${req.method} ${pathname} -> entities [${requestId}] user=${req.user.sub}`);
        return await entitiesHandler(req, res);

      case 'modules':
        console.log(`[api] ${req.method} ${pathname} -> modules/${route.name} [${requestId}] user=${req.user.sub}`);
        req.params = { name: route.name };
        return await modulesHandler(req, res);

      case 'export':
        console.log(`[api] ${req.method} ${pathname} -> export/${route.format} [${requestId}] user=${req.user.sub}`);
        req.params = { format: route.format };
        return await exportHandler(req, res);

      default:
        return sendError(res, 404, 'Not found', requestId);
    }
  } catch (err) {
    console.error(`[api] ERROR ${req.method} ${pathname} [${requestId}]:`, err.message);
    return sendError(res, 500, 'Internal server error', requestId);
  }
};
