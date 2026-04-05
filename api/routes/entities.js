/**
 * Gulf Watch - Entities API Route
 *
 * GET /api/entities
 * Query params: search, type, limit
 * Extracts and resolves entities from incident data.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let incidentsCache = null;
let entitiesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 120_000;

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
    entitiesCache = null; // invalidate entity cache
    cacheTimestamp = now;
    return incidentsCache;
  } catch (err) {
    console.error('[entities] Failed to load incidents.json:', err.message);
    return incidentsCache || [];
  }
}

// ---------------------------------------------------------------------------
// Entity extraction (Argus-style processing)
// ---------------------------------------------------------------------------

const ENTITY_TYPES = ['person', 'organization', 'location', 'vessel', 'aircraft', 'military_unit', 'weapon_system'];

function extractEntities(incidents) {
  if (entitiesCache) return entitiesCache;

  const entityMap = new Map();

  for (const incident of incidents) {
    // Extract from structured entity fields if present
    if (incident.entities && Array.isArray(incident.entities)) {
      for (const entity of incident.entities) {
        const key = `${(entity.type || 'unknown').toLowerCase()}::${(entity.name || '').toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: entity.name,
            type: (entity.type || 'unknown').toLowerCase(),
            aliases: new Set(entity.aliases || []),
            incident_ids: new Set(),
            first_seen: incident.timestamp || incident.date,
            last_seen: incident.timestamp || incident.date,
            metadata: entity.metadata || {},
          });
        }
        const existing = entityMap.get(key);
        existing.incident_ids.add(incident.id);
        if (entity.aliases) {
          entity.aliases.forEach(a => existing.aliases.add(a));
        }
        const ts = incident.timestamp || incident.date;
        if (ts && ts > existing.last_seen) existing.last_seen = ts;
        if (ts && ts < existing.first_seen) existing.first_seen = ts;
      }
    }

    // Extract location entities from incident location fields
    if (incident.country) {
      const key = `location::${incident.country.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: incident.country,
          type: 'location',
          aliases: new Set(),
          incident_ids: new Set(),
          first_seen: incident.timestamp || incident.date,
          last_seen: incident.timestamp || incident.date,
          metadata: {},
        });
      }
      entityMap.get(key).incident_ids.add(incident.id);
    }

    if (incident.location?.city) {
      const key = `location::${incident.location.city.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: incident.location.city,
          type: 'location',
          aliases: new Set(),
          incident_ids: new Set(),
          first_seen: incident.timestamp || incident.date,
          last_seen: incident.timestamp || incident.date,
          metadata: { country: incident.country },
        });
      }
      entityMap.get(key).incident_ids.add(incident.id);
    }

    // Extract source as organization
    if (incident.source) {
      const key = `organization::${incident.source.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: incident.source,
          type: 'organization',
          aliases: new Set(),
          incident_ids: new Set(),
          first_seen: incident.timestamp || incident.date,
          last_seen: incident.timestamp || incident.date,
          metadata: { role: 'source' },
        });
      }
      entityMap.get(key).incident_ids.add(incident.id);
    }
  }

  // Convert Sets to arrays for serialization
  const entities = Array.from(entityMap.values()).map(e => ({
    ...e,
    aliases: Array.from(e.aliases),
    incident_ids: Array.from(e.incident_ids),
    incident_count: e.incident_ids.size,
  }));

  entitiesCache = entities;
  return entities;
}

// ---------------------------------------------------------------------------
// Name resolution (fuzzy matching)
// ---------------------------------------------------------------------------

function resolveEntity(entities, searchName) {
  const needle = searchName.toLowerCase().trim();

  // Exact match first
  const exact = entities.find(e => e.name.toLowerCase() === needle);
  if (exact) return [{ ...exact, match: 'exact', score: 1.0 }];

  // Alias match
  const aliasMatch = entities.filter(e =>
    e.aliases.some(a => a.toLowerCase() === needle)
  ).map(e => ({ ...e, match: 'alias', score: 0.95 }));
  if (aliasMatch.length > 0) return aliasMatch;

  // Substring match
  const partial = entities.filter(e =>
    e.name.toLowerCase().includes(needle) ||
    needle.includes(e.name.toLowerCase()) ||
    e.aliases.some(a => a.toLowerCase().includes(needle))
  ).map(e => {
    const nameLen = e.name.length;
    const score = Math.min(needle.length, nameLen) / Math.max(needle.length, nameLen);
    return { ...e, match: 'partial', score: Math.round(score * 100) / 100 };
  });

  return partial.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>{}]/g, '').trim();
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

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
  const incidents = loadIncidents();
  const entities = extractEntities(incidents);

  // Parse limit
  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  // Filter by type
  let results = entities;
  if (query.type) {
    const type = sanitizeString(query.type).toLowerCase();
    if (ENTITY_TYPES.includes(type)) {
      results = results.filter(e => e.type === type);
    }
  }

  // Search / resolution
  if (query.search) {
    const search = sanitizeString(query.search);
    results = resolveEntity(results, search);
  }

  // Sort by incident count (most referenced first)
  results.sort((a, b) => (b.incident_count || 0) - (a.incident_count || 0));

  // Apply limit
  results = results.slice(0, limit);

  return res.status(200).json({
    entities: results,
    total: results.length,
    data_source: 'live',
  });
};
