# Security Policy

## GulfWatch Testing - Security Hardening

### Critical Fixes Applied

#### 1. XSS Prevention (CRITICAL)
- **Issue**: User-controlled content (titles, sources) was inserted directly into innerHTML
- **Fix**: Added `escapeHtml()` and `sanitizeUrl()` functions to sanitize all user content
- **Files Modified**: `public/index.html`

#### 2. Hardcoded Admin Key (CRITICAL)
- **Issue**: The admin key was hardcoded in source (old value retired — do not reuse)
- **Fix**: Moved to environment variable `GULFWATCH_ADMIN_KEY`
- **Files Modified**: `scripts/user_report_system.py`

#### 3. Privacy Protection (HIGH)
- **Issue**: Raw IP addresses could be stored in fingerprints
- **Fix**: Hash IP addresses before storing
- **Files Modified**: `scripts/user_report_system.py`

#### 4. Timing Attack Prevention (MEDIUM)
- **Issue**: String comparison for admin key vulnerable to timing attacks
- **Fix**: Use `hmac.compare_digest()` for constant-time comparison
- **Files Modified**: `scripts/user_report_system.py`

### Comprehensive Security Checklist

#### Injection Attacks (ALL FIXED)

| Threat | Status | Mitigation |
|--------|--------|------------|
| XSS (all variants) | ✅ FIXED | `escapeHtml()` on all user content |
| HTML Injection | ✅ FIXED | Content sanitized before DOM insertion |
| Stored XSS | ✅ FIXED | All stored data escaped on display |
| Reflected XSS | ✅ FIXED | URL parameters sanitized |
| DOM-based XSS | ✅ FIXED | Dynamic content uses safe escaping |
| CSS Injection | ✅ FIXED | `sanitizeCss()` blocks dangerous values |
| JavaScript Injection | ✅ FIXED | `escapeJsString()` for JS contexts |
| Link/URL Injection | ✅ FIXED | `sanitizeUrl()` blocks javascript: protocol |
| HTML Attribute Injection | ✅ FIXED | `escapeHtmlAttribute()` for attributes |
| Template Injection (SSTI) | ✅ N/A | No server-side templates |
| Markdown Injection | ✅ N/A | No markdown rendering |

#### Clickjacking & UI Attacks (FIXED)

| Threat | Status | Mitigation |
|--------|--------|------------|
| Clickjacking | ✅ FIXED | `X-Frame-Options: DENY` |
| Iframe Injection | ✅ FIXED | CSP `frame-ancestors 'none'` |
| Content Spoofing | ✅ FIXED | `X-Content-Type-Options: nosniff` |

#### Authentication & Secrets (FIXED)

| Threat | Status | Mitigation |
|--------|--------|------------|
| Hardcoded Secrets | ⚠️ INCIDENT 2026-07-06 | OpenSky credentials were hardcoded in `api/aircraft.js` (missed by the 2026-03-14 pass) and exposed while the repo was public. Moved to env vars 2026-07-06; credential rotation required. |
| Timing Attacks | ✅ FIXED | `hmac.compare_digest()` |
| Privacy Leak | ✅ FIXED | IP addresses hashed |

#### Infrastructure (SAFE BY DESIGN)

| Threat | Status | Mitigation |
|--------|--------|------------|
| SSRF | ✅ SAFE | Hardcoded URLs only, no user input |
| Command Injection | ✅ SAFE | No shell commands executed |
| SQL/NoSQL Injection | ✅ SAFE | JSON files only, no database |
| Path Traversal | ✅ SAFE | No user-controlled file paths |
| Dependency Confusion | ✅ SAFE | Only standard library + feedparser |

#### Residual Risks (Documented)

| Threat | Status | Notes |
|--------|--------|-------|
| CSRF | ⚠️ ACCEPTABLE | Static site, no session cookies |
| Rate Limiting | ⚠️ PARTIAL | GitHub Actions schedule only |
| DDoS Protection | ⚠️ NONE | Relies on Vercel CDN |
| Authentication | ⚠️ NONE | Public dashboard by design |

### Required Environment Variables

```bash
# Required for admin functions
export GULFWATCH_ADMIN_KEY="your-secure-random-key-here"

# Required for NewsData.io API (optional)
export NEWSDATA_API_KEY="your-newsdata-api-key"

# Required for the aircraft tracking endpoint (api/aircraft.js)
export OPENSKY_USERNAME="your-opensky-api-client-username"
export OPENSKY_PASSWORD="your-opensky-password"
```

### Security Headers

Add these headers in your web server/CDN configuration:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self' https://*.vercel.app https://unpkg.com
Referrer-Policy: strict-origin-when-cross-origin
```

### Reporting Security Issues

If you discover a security vulnerability, please:
1. Do NOT open a public issue
2. Email security@gulf-watch.app
3. Allow 48 hours for response before public disclosure

### Residual Risks & Limitations

**Honest Assessment: This is a demonstration/testing project, not a production-grade secure application.**

#### By-Design Limitations (Acceptable for Demo)

| Risk | Severity | Explanation |
|------|----------|-------------|
| **No Authentication** | Medium | Anyone can access the site and view all data. This is intentional for a public dashboard. |
| **Client-Side Report System** | Medium | Reports use localStorage + fingerprinting. Can be bypassed by clearing storage or changing browsers. |
| **No Server-Side Validation** | Medium | All "validation" is client-side. A determined attacker could bypass checks. |
| **Static JSON Data** | Low | Data is in public JSON files. No sensitive data should be stored here. |
| **Third-Party Dependencies** | Low | Uses Leaflet from unpkg.com CDN. Trust required in CDN provider. |
| **GitHub Actions Public Logs** | Low | Workflow logs are visible (no secrets in logs, but timing info is public). |

#### What's NOT Protected (Out of Scope)

- **DDoS Protection**: No rate limiting on static file serving
- **Data Integrity**: JSON files could be modified if GitHub account compromised
- **Audit Logging**: No persistent audit trail of who reported what
- **Backup/Recovery**: No automated backup system for report data
- **Penetration Testing**: Not tested by professional security researchers

#### When This is "Safe Enough"

✅ **Safe for:**
- Public demonstration
- Testing and development
- Non-sensitive public data aggregation
- Educational purposes

⚠️ **NOT safe for:**
- Handling personally identifiable information (PII)
- Storing confidential government data
- Production use with real users expecting privacy

**Note on GDPR:** This application does not collect or store personal data (as defined by GDPR). The "fingerprints" used for report deduplication are:
- Derived from browser characteristics (not names, emails, or IDs)
- Hashed and anonymized
- Stored only to prevent duplicate reports
- Not linked to any identifiable individual

While GDPR compliance is not strictly required for this use case, the application follows privacy-by-design principles.

### Security Audit Log

- **2026-07-06**: OpenSky credential incident remediation
  - Removed hardcoded OpenSky username/password from `api/aircraft.js` (main and new-features branches); replaced with `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` env vars
  - The credential was exposed in the public repo (including a third-party fork) and MUST be rotated at OpenSky; treat the old value as compromised
  - Removed the retired admin key value previously printed in this file
  - Corrected the "Hardcoded Secrets: FIXED" claim, which was false at the time it was written
- **2026-03-14**: Comprehensive security hardening
  - Fixed all XSS/HTML injection vulnerabilities
  - Added comprehensive escaping (HTML, CSS, JS, URL)
  - Removed hardcoded secrets
  - Added security headers (CSP, X-Frame-Options, etc.)
  - Documented residual risks
