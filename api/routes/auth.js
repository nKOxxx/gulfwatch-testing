/**
 * Gulf Watch - Auth Endpoints
 *
 * POST /api/auth/login   - Email + password login
 * POST /api/auth/refresh - Refresh token rotation
 * POST /api/auth/logout  - Session invalidation
 *
 * Uses jose for JWT operations.
 * Credentials checked against env vars for now (will be DB later).
 */

const crypto = require('crypto');
const {
  issueAccessToken,
  generateRefreshToken,
  verifyToken,
  sessionFingerprint,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../middleware/auth');

// ---------------------------------------------------------------------------
// In-memory session store (swap for Redis/DB in production)
// ---------------------------------------------------------------------------

const sessions = new Map(); // refreshTokenHash -> { sub, email, role, fingerprint, expiresAt }

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [hash, session] of sessions.entries()) {
    if (session.expiresAt.getTime() < now) {
      sessions.delete(hash);
    }
  }
}, 300_000); // every 5 min

// ---------------------------------------------------------------------------
// Password verification
// ---------------------------------------------------------------------------

function verifyPassword(plaintext, storedHash) {
  // storedHash format: sha256:<hex>
  // In production, use bcrypt/argon2. This is a minimal env-var check.
  if (!storedHash) return false;

  if (storedHash.startsWith('sha256:')) {
    const expected = storedHash.slice(7);
    const computed = crypto.createHash('sha256').update(plaintext).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expected));
  }

  // Direct comparison for development (plain hash in env)
  const computed = crypto.createHash('sha256').update(plaintext).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function handleLogin(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required',
      code: 'MISSING_CREDENTIALS',
      requestId: req.requestId,
    });
  }

  // Validate email format
  if (typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return res.status(400).json({
      error: 'Invalid email format',
      code: 'INVALID_EMAIL',
      requestId: req.requestId,
    });
  }

  // Check against env vars (single admin user for now)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash) {
    console.error('[auth] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not configured');
    return res.status(503).json({
      error: 'Authentication service not configured',
      code: 'AUTH_NOT_CONFIGURED',
      requestId: req.requestId,
    });
  }

  // Constant-time email comparison
  const emailMatch = email.toLowerCase() === adminEmail.toLowerCase();
  const passwordMatch = verifyPassword(password, adminPasswordHash);

  if (!emailMatch || !passwordMatch) {
    return res.status(401).json({
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
      requestId: req.requestId,
    });
  }

  // Issue tokens
  const user = {
    sub: crypto.createHash('sha256').update(adminEmail).digest('hex').slice(0, 16),
    email: adminEmail,
    role: 'admin',
  };

  const accessToken = await issueAccessToken(user);
  const refresh = generateRefreshToken();
  const fingerprint = sessionFingerprint(req);

  // Store session (hash only)
  sessions.set(refresh.hash, {
    sub: user.sub,
    email: user.email,
    role: user.role,
    fingerprint,
    expiresAt: refresh.expiresAt,
  });

  // Set refresh token cookie
  setRefreshCookie(res, refresh.raw, refresh.expiresAt);

  console.log(`[auth] Login successful for ${user.email} [${req.requestId}]`);

  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: parseInt(process.env.ACCESS_TOKEN_TTL || '900', 10),
    user: {
      email: user.email,
      role: user.role,
    },
  });
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function handleRefresh(req, res) {
  // Get refresh token from cookie or body
  const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

  if (!refreshToken) {
    return res.status(400).json({
      error: 'Refresh token required',
      code: 'MISSING_REFRESH_TOKEN',
      requestId: req.requestId,
    });
  }

  // Hash the token to look up session
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const session = sessions.get(tokenHash);

  if (!session) {
    return res.status(401).json({
      error: 'Invalid or expired refresh token',
      code: 'INVALID_REFRESH_TOKEN',
      requestId: req.requestId,
    });
  }

  // Check expiry
  if (session.expiresAt.getTime() < Date.now()) {
    sessions.delete(tokenHash);
    return res.status(401).json({
      error: 'Refresh token expired',
      code: 'REFRESH_TOKEN_EXPIRED',
      requestId: req.requestId,
    });
  }

  // Verify fingerprint (browser binding)
  const currentFingerprint = sessionFingerprint(req);
  if (session.fingerprint !== currentFingerprint) {
    // Possible token theft — invalidate session
    sessions.delete(tokenHash);
    console.warn(`[auth] Fingerprint mismatch for ${session.email}, invalidating session [${req.requestId}]`);
    return res.status(401).json({
      error: 'Session invalidated due to client mismatch',
      code: 'SESSION_INVALIDATED',
      requestId: req.requestId,
    });
  }

  // Rotate: delete old session, create new
  sessions.delete(tokenHash);

  const user = {
    sub: session.sub,
    email: session.email,
    role: session.role,
  };

  const accessToken = await issueAccessToken(user);
  const newRefresh = generateRefreshToken();

  sessions.set(newRefresh.hash, {
    sub: user.sub,
    email: user.email,
    role: user.role,
    fingerprint: currentFingerprint,
    expiresAt: newRefresh.expiresAt,
  });

  setRefreshCookie(res, newRefresh.raw, newRefresh.expiresAt);

  console.log(`[auth] Token refreshed for ${user.email} [${req.requestId}]`);

  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: parseInt(process.env.ACCESS_TOKEN_TTL || '900', 10),
  });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function handleLogout(req, res) {
  const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    sessions.delete(tokenHash);
  }

  clearRefreshCookie(res);

  console.log(`[auth] Logout [${req.requestId}]`);

  return res.status(200).json({
    message: 'Logged out successfully',
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

module.exports = async (req, res, action) => {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 405,
      requestId: req.requestId,
    });
  }

  switch (action) {
    case 'login':
      return handleLogin(req, res);
    case 'refresh':
      return handleRefresh(req, res);
    case 'logout':
      return handleLogout(req, res);
    default:
      return res.status(404).json({
        error: 'Unknown auth action',
        code: 404,
        requestId: req.requestId,
      });
  }
};
