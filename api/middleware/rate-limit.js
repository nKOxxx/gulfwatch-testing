/**
 * Gulf Watch - API Rate Limiting Middleware
 *
 * Sliding-window rate limiter backed by an in-memory store.
 * Drop-in replacement for a Redis-backed limiter when running
 * on Vercel (serverless) -- swap the store for Redis in production
 * containers.
 *
 * Configuration per-endpoint via `createLimiter(options)`:
 *   windowMs   - sliding window size in milliseconds  (default 60 000)
 *   max        - max requests per window              (default 60)
 *   keyFn      - function(req) => string key           (default: IP)
 *   message    - error body on 429                     (default obj)
 *   skipFn     - function(req) => boolean              (default: false)
 *
 * Standard headers returned:
 *   X-RateLimit-Limit      - max requests in window
 *   X-RateLimit-Remaining  - requests left
 *   X-RateLimit-Reset      - epoch seconds when window resets
 *   Retry-After            - seconds until next allowed request (on 429)
 */

// ---------------------------------------------------------------------------
// In-memory store (per-isolate)
// ---------------------------------------------------------------------------

class MemoryStore {
  constructor() {
    /** @type {Map<string, number[]>} key -> sorted array of timestamps */
    this.hits = new Map();
    // Garbage-collect stale keys every 2 minutes
    this._gcInterval = setInterval(() => this._gc(), 120_000);
    if (this._gcInterval.unref) this._gcInterval.unref();
  }

  /**
   * Record a hit and return the count within the window.
   * @param {string} key
   * @param {number} windowMs
   * @returns {{ count: number, oldestInWindow: number }}
   */
  increment(key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    // Prune expired entries
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    timestamps.push(now);

    return {
      count: timestamps.length,
      oldestInWindow: timestamps[0] || now,
    };
  }

  /** Remove keys that have had zero traffic for over their window. */
  _gc() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > 300_000) {
        this.hits.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this._gcInterval);
    this.hits.clear();
  }
}

// Shared store across all limiters in the same process
const globalStore = new MemoryStore();

// ---------------------------------------------------------------------------
// Key extractors
// ---------------------------------------------------------------------------

function ipKey(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function userKey(req) {
  // Requires auth middleware to have run first
  return req.user?.sub || ipKey(req);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a rate-limiting middleware with the given configuration.
 *
 * @param {object} options
 * @param {number}   [options.windowMs=60000]   Window size in ms
 * @param {number}   [options.max=60]           Max requests per window
 * @param {function} [options.keyFn=ipKey]      Request -> string key
 * @param {object}   [options.message]          Response body on 429
 * @param {function} [options.skipFn]           Return true to bypass
 * @returns {function} Express/Vercel middleware
 */
function createLimiter(options = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    keyFn = ipKey,
    message = { error: 'Too many requests', code: 'RATE_LIMITED' },
    skipFn = null,
  } = options;

  return (req, res, next) => {
    // Allow skipping (e.g. health checks, internal calls)
    if (skipFn && skipFn(req)) {
      if (typeof next === 'function') return next();
      return;
    }

    const key = keyFn(req);
    const { count, oldestInWindow } = globalStore.increment(key, windowMs);

    const resetEpochSeconds = Math.ceil((oldestInWindow + windowMs) / 1000);
    const remaining = Math.max(0, max - count);

    // Always set informational headers
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetEpochSeconds));

    if (count > max) {
      const retryAfter = Math.ceil((oldestInWindow + windowMs - Date.now()) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json(message);
    }

    if (typeof next === 'function') next();
  };
}

// ---------------------------------------------------------------------------
// Preset limiters per architecture spec (Section 5.8)
// ---------------------------------------------------------------------------

/** General API: 60 req / min per IP */
const apiLimiter = createLimiter({ windowMs: 60_000, max: 60 });

/** Auth endpoints: 10 req / min per IP (brute-force protection) */
const authLimiter = createLimiter({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many authentication attempts', code: 'AUTH_RATE_LIMITED' },
});

/** Heavy endpoints (reports, exports): 5 req / min per user */
const heavyLimiter = createLimiter({
  windowMs: 60_000,
  max: 5,
  keyFn: userKey,
  message: { error: 'Too many requests for this resource', code: 'HEAVY_RATE_LIMITED' },
});

/** Aircraft proxy: 30 req / min per IP (matches aircraft.js inline limiter) */
const aircraftLimiter = createLimiter({ windowMs: 60_000, max: 30 });

/** WebSocket connection limiter: 5 connections / min per IP */
const wsLimiter = createLimiter({
  windowMs: 60_000,
  max: 5,
  message: { error: 'Too many connection attempts', code: 'WS_RATE_LIMITED' },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createLimiter,
  apiLimiter,
  authLimiter,
  heavyLimiter,
  aircraftLimiter,
  wsLimiter,
  ipKey,
  userKey,
  // Exposed for testing
  _store: globalStore,
};
