/**
 * Gulf Watch - Incidents API Route
 *
 * GET /api/incidents
 * Query params: country, severity, type, timeRange, search, cursor, limit
 * Returns paginated incident list with cursor-based pagination.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let incidentsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // Re-read file every 60s

function loadIncidents() {
  const now = Date.now();
  if (incidentsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return incidentsCache;
  }

  const filePath = path.join(__dirname, '..', '..', 'incidents.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    incidentsCache = Array.isArray(data) ? data : data.incidents || [];
    cacheTimestamp = now;
    return incidentsCache;
  } catch (err) {
    console.error('[incidents] Failed to load incidents.json:', err.message);
    return incidentsCache || [];
  }
}

// ---------------------------------------------------------------------------
// Validation & Sanitization
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_TYPES = [
  'military', 'maritime', 'cyber', 'political', 'terrorism',
  'economic', 'infrastructure', 'humanitarian', 'environmental',
];
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_SEARCH_LENGTH = 200;

function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>{}]/g, '').trim();
}

function parseTimeRange(timeRange) {
  if (!timeRange) return null;
  const match = timeRange.match(/^(\d+)([hdwm])$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();

  const multipliers = { h: 3600_000, d: 86400_000, w: 604800_000, m: 2592000_000 };
  return new Date(now - value * multipliers[unit]);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function filterIncidents(incidents, query) {
  let filtered = [...incidents];

  // Country filter
  if (query.country) {
    const country = sanitizeString(query.country).toLowerCase();
    filtered = filtered.filter(i =>
      (i.country || '').toLowerCase() === country ||
      (i.location?.country || '').toLowerCase() === country
    );
  }

  // Severity filter
  if (query.severity) {
    const severity = sanitizeString(query.severity).toLowerCase();
    if (VALID_SEVERITIES.includes(severity)) {
      filtered = filtered.filter(i => (i.severity || '').toLowerCase() === severity);
    }
  }

  // Type filter
  if (query.type) {
    const type = sanitizeString(query.type).toLowerCase();
    if (VALID_TYPES.includes(type)) {
      filtered = filtered.filter(i => (i.type || '').toLowerCase() === type);
    }
  }

  // Time range filter
  if (query.timeRange) {
    const cutoff = parseTimeRange(sanitizeString(query.timeRange));
    if (cutoff) {
      filtered = filtered.filter(i => {
        const ts = i.timestamp || i.date || i.created_at;
        if (!ts) return true;
        return new Date(ts) >= cutoff;
      });
    }
  }

  // Free-text search
  if (query.search) {
    const search = sanitizeString(query.search, MAX_SEARCH_LENGTH).toLowerCase();
    filtered = filtered.filter(i => {
      const searchable = [
        i.title, i.description, i.summary,
        i.country, i.location?.country, i.location?.city,
        i.source, i.type,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(search);
    });
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function paginate(items, cursor, limit) {
  let startIndex = 0;

  if (cursor) {
    // Cursor is a base64-encoded index
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      startIndex = parseInt(decoded, 10);
      if (isNaN(startIndex) || startIndex < 0) startIndex = 0;
    } catch {
      startIndex = 0;
    }
  }

  const page = items.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + limit;
  const nextCursor = nextIndex < items.length
    ? Buffer.from(String(nextIndex)).toString('base64url')
    : null;

  return { page, nextCursor, total: items.length };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 405,
      requestId: req.requestId,
    });
  }

  const query = req.query || {};

  // Parse and clamp limit
  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  // Load and filter
  const incidents = loadIncidents();
  const filtered = filterIncidents(incidents, query);

  // Paginate
  const { page, nextCursor, total } = paginate(filtered, query.cursor, limit);

  // Add data_source to each incident
  const results = page.map(incident => ({
    ...incident,
    data_source: 'live',
  }));

  return res.status(200).json({
    incidents: results,
    cursor: nextCursor,
    total,
    data_source: 'live',
  });
};
