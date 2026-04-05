/**
 * Gulf Watch - Authentication & Authorization Middleware
 *
 * JWT verification via jose (RFC 7515-7519 compliant).
 * Role-based access control: admin > analyst > viewer.
 * Session management with refresh token rotation.
 *
 * Usage:
 *   const { auth, requireRole } = require('./middleware/auth');
 *   router.get('/incidents',   auth,                getIncidents);  // any authenticated user
 *   router.post('/incidents',  requireRole('analyst'), createIncident);
 *   router.get('/admin/users', requireRole('admin'),   listUsers);
 */

const { jwtVerify, createRemoteJWKSSet, SignJWT, importPKCS8 } = require('jose');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration (all from environment)
// ---------------------------------------------------------------------------

const JWT_ISSUER = process.env.JWT_ISSUER || 'https://gulfwatch.io';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'gulfwatch-api';
const JWKS_URI = process.env.JWKS_URI || `${JWT_ISSUER}/auth/.well-known/jwks.json`;

// For local/air-gap mode: use a symmetric secret instead of JWKS
const JWT_SECRET = process.env.JWT_SECRET; // base64-encoded, >= 256 bits

// Access token lifetime in seconds
const ACCESS_TOKEN_TTL = parseInt(process.env.ACCESS_TOKEN_TTL || '900', 10);   // 15 min
const REFRESH_TOKEN_TTL = parseInt(process.env.REFRESH_TOKEN_TTL || '604800', 10); // 7 days

// Role hierarchy: higher index = more privilege
const ROLE_HIERARCHY = Object.freeze({
  viewer: 0,
  analyst: 1,
  admin: 2,
});

// ---------------------------------------------------------------------------
// JWKS setup (lazy init)
// ---------------------------------------------------------------------------

let jwksSet = null;

function getJWKS() {
  if (!jwksSet) {
    if (JWT_SECRET) {
      // Air-gap / local mode: skip JWKS, verification uses symmetric key
      return null;
    }
    jwksSet = createRemoteJWKSSet(new URL(JWKS_URI), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }
  return jwksSet;
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify a JWT and return its payload.
 * Supports both RS256 (JWKS) and HS256 (symmetric secret for air-gap).
 */
async function verifyToken(token) {
  const options = {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: 30, // seconds of clock skew allowed
  };

  if (JWT_SECRET) {
    // Symmetric verification (air-gap / development)
    const secretKey = Buffer.from(JWT_SECRET, 'base64');
    const { payload } = await jwtVerify(token, secretKey, {
      ...options,
      algorithms: ['HS256'],
    });
    return payload;
  }

  // Asymmetric verification via JWKS
  const { payload } = await jwtVerify(token, getJWKS(), {
    ...options,
    algorithms: ['RS256'],
  });
  return payload;
}

// ---------------------------------------------------------------------------
// Token issuance (for login endpoints)
// ---------------------------------------------------------------------------

/**
 * Issue an access token for a verified user.
 * @param {{ sub: string, email: string, role: string }} user
 * @returns {Promise<string>} Signed JWT
 */
async function issueAccessToken(user) {
  const builder = new SignJWT({
    sub: user.sub,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: JWT_SECRET ? 'HS256' : 'RS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .setJti(crypto.randomUUID());

  if (JWT_SECRET) {
    return builder.sign(Buffer.from(JWT_SECRET, 'base64'));
  }

  // RS256: requires JWT_PRIVATE_KEY env var (PEM-encoded PKCS#8)
  const privateKey = await importPKCS8(process.env.JWT_PRIVATE_KEY, 'RS256');
  return builder.sign(privateKey);
}

/**
 * Generate an opaque refresh token and its SHA-256 hash (for DB storage).
 * The raw token is returned to the client in an HttpOnly cookie.
 * Only the hash is stored server-side.
 */
function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000) };
}

// ---------------------------------------------------------------------------
// Middleware: authenticate
// ---------------------------------------------------------------------------

/**
 * Express/Vercel middleware that verifies the Bearer token.
 * On success, attaches `req.user` with { sub, email, role }.
 */
async function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'MISSING_TOKEN',
    });
  }

  const token = authHeader.slice(7);
  if (!token) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'MISSING_TOKEN',
    });
  }

  try {
    const payload = await verifyToken(token);

    // Validate required claims
    if (!payload.sub || !payload.role) {
      return res.status(401).json({
        error: 'Invalid token claims',
        code: 'INVALID_CLAIMS',
      });
    }

    if (!ROLE_HIERARCHY.hasOwnProperty(payload.role)) {
      return res.status(403).json({
        error: 'Unknown role',
        code: 'INVALID_ROLE',
      });
    }

    req.user = {
      sub: payload.sub,
      email: payload.email || '',
      role: payload.role,
      jti: payload.jti,
    };

    if (typeof next === 'function') next();
  } catch (err) {
    const code = err.code === 'ERR_JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({
      error: code === 'TOKEN_EXPIRED' ? 'Token expired' : 'Invalid token',
      code,
    });
  }
}

// ---------------------------------------------------------------------------
// Middleware: role-based access control
// ---------------------------------------------------------------------------

/**
 * Returns middleware that enforces a minimum role.
 * Must be used AFTER `auth` middleware.
 *
 * @param {'viewer' | 'analyst' | 'admin'} minimumRole
 */
function requireRole(minimumRole) {
  if (!ROLE_HIERARCHY.hasOwnProperty(minimumRole)) {
    throw new Error(`requireRole: unknown role "${minimumRole}"`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'MISSING_TOKEN',
      });
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minimumRole];

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Requires "${minimumRole}" role or higher`,
        code: 'INSUFFICIENT_ROLE',
        required: minimumRole,
        current: req.user.role,
      });
    }

    if (typeof next === 'function') next();
  };
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Extract session fingerprint from request for session binding.
 * Includes User-Agent hash so stolen refresh tokens on a different
 * browser are detected.
 */
function sessionFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16);
}

/**
 * Set refresh token as an HttpOnly secure cookie.
 */
function setRefreshCookie(res, rawToken, expiresAt) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `refresh_token=${rawToken}`,
    'HttpOnly',
    'Secure',
    `SameSite=${isProduction ? 'Strict' : 'Lax'}`,
    'Path=/api/auth/refresh',
    `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`,
  ].join('; '));
}

/**
 * Clear the refresh cookie (used on logout).
 */
function clearRefreshCookie(res) {
  res.setHeader('Set-Cookie', [
    'refresh_token=',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/api/auth/refresh',
    'Max-Age=0',
  ].join('; '));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  auth,
  requireRole,
  verifyToken,
  issueAccessToken,
  generateRefreshToken,
  sessionFingerprint,
  setRefreshCookie,
  clearRefreshCookie,
  ROLE_HIERARCHY,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
};
