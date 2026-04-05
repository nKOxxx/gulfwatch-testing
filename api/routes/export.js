/**
 * Gulf Watch - Export API Route
 *
 * GET /api/export/:format
 * Supported formats: json, csv, geojson, stix
 * Classification marking in metadata.
 * Audit log entry for every export.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let incidentsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

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
    console.error('[export] Failed to load incidents.json:', err.message);
    return incidentsCache || [];
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_LEVELS = ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET'];

function getClassification() {
  return process.env.CLASSIFICATION_LEVEL || 'UNCLASSIFIED';
}

function classificationBanner(level) {
  return `// CLASSIFICATION: ${level} // GULF WATCH EXPORT // ${new Date().toISOString()}`;
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

function auditLog(req, format, recordCount) {
  const entry = {
    timestamp: new Date().toISOString(),
    action: 'EXPORT',
    format: format.toUpperCase(),
    user: req.user?.sub || 'unknown',
    email: req.user?.email || 'unknown',
    role: req.user?.role || 'unknown',
    record_count: recordCount,
    classification: getClassification(),
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
    user_agent: req.headers['user-agent'] || 'unknown',
    request_id: req.requestId,
  };

  // Console log for now; will be swapped to DB insert
  console.log(`[audit] EXPORT ${JSON.stringify(entry)}`);
  return entry;
}

// ---------------------------------------------------------------------------
// Format: JSON
// ---------------------------------------------------------------------------

function exportJSON(incidents, classification) {
  return JSON.stringify({
    classification,
    exported_at: new Date().toISOString(),
    system: 'Gulf Watch v2.0',
    total: incidents.length,
    incidents: incidents.map(i => ({
      ...i,
      data_source: 'live',
    })),
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Format: CSV
// ---------------------------------------------------------------------------

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCSV(incidents, classification) {
  const headers = [
    'id', 'title', 'type', 'severity', 'country', 'city',
    'latitude', 'longitude', 'timestamp', 'source', 'description',
  ];

  const lines = [
    `# ${classificationBanner(classification)}`,
    headers.join(','),
  ];

  for (const i of incidents) {
    lines.push([
      escapeCSV(i.id),
      escapeCSV(i.title),
      escapeCSV(i.type),
      escapeCSV(i.severity),
      escapeCSV(i.country || i.location?.country),
      escapeCSV(i.location?.city),
      escapeCSV(i.location?.lat || i.latitude),
      escapeCSV(i.location?.lon || i.longitude),
      escapeCSV(i.timestamp || i.date),
      escapeCSV(i.source),
      escapeCSV(i.description || i.summary),
    ].join(','));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Format: GeoJSON
// ---------------------------------------------------------------------------

function exportGeoJSON(incidents, classification) {
  const features = incidents
    .filter(i => {
      const lat = i.location?.lat || i.latitude;
      const lon = i.location?.lon || i.longitude;
      return lat != null && lon != null;
    })
    .map(i => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          parseFloat(i.location?.lon || i.longitude),
          parseFloat(i.location?.lat || i.latitude),
        ],
      },
      properties: {
        id: i.id,
        title: i.title,
        type: i.type,
        severity: i.severity,
        country: i.country || i.location?.country,
        timestamp: i.timestamp || i.date,
        source: i.source,
        data_source: 'live',
      },
    }));

  return JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      classification,
      exported_at: new Date().toISOString(),
      system: 'Gulf Watch v2.0',
      total: features.length,
    },
    features,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Format: STIX 2.1
// ---------------------------------------------------------------------------

function toSTIXId(type, id) {
  // Deterministic STIX ID from our internal ID
  const hash = crypto.createHash('sha256').update(`gulfwatch:${type}:${id}`).digest('hex');
  const uuid = [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16), // version 5
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
  return `${type}--${uuid}`;
}

function exportSTIX(incidents, classification) {
  const objects = [];

  // Identity for Gulf Watch
  const identityId = toSTIXId('identity', 'gulfwatch-system');
  objects.push({
    type: 'identity',
    spec_version: '2.1',
    id: identityId,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    name: 'Gulf Watch',
    description: 'MENA Security Intelligence Platform',
    identity_class: 'system',
  });

  for (const i of incidents) {
    const incidentId = toSTIXId('incident', i.id || crypto.randomUUID());
    const ts = i.timestamp || i.date || new Date().toISOString();

    // STIX Incident (using extension or observed-data as proxy)
    objects.push({
      type: 'incident',
      spec_version: '2.1',
      id: incidentId,
      created: ts,
      modified: ts,
      name: i.title || 'Unnamed incident',
      description: i.description || i.summary || '',
      created_by_ref: identityId,
      extensions: {
        'extension-definition--gulfwatch': {
          extension_type: 'property-extension',
          severity: i.severity || 'unknown',
          incident_type: i.type || 'unknown',
          country: i.country || i.location?.country || 'unknown',
          source: i.source || 'unknown',
          data_source: 'live',
        },
      },
    });

    // Location if available
    if (i.location?.lat || i.latitude) {
      const locationId = toSTIXId('location', `${i.id}-loc`);
      objects.push({
        type: 'location',
        spec_version: '2.1',
        id: locationId,
        created: ts,
        modified: ts,
        name: i.location?.city || i.country || 'Unknown',
        country: i.country || i.location?.country,
        latitude: parseFloat(i.location?.lat || i.latitude),
        longitude: parseFloat(i.location?.lon || i.longitude),
      });

      // Relationship: incident -> located-at -> location
      objects.push({
        type: 'relationship',
        spec_version: '2.1',
        id: toSTIXId('relationship', `${i.id}-loc-rel`),
        created: ts,
        modified: ts,
        relationship_type: 'located-at',
        source_ref: incidentId,
        target_ref: locationId,
      });
    }
  }

  return JSON.stringify({
    type: 'bundle',
    id: toSTIXId('bundle', `export-${Date.now()}`),
    spec_version: '2.1',
    objects,
    metadata: {
      classification,
      exported_at: new Date().toISOString(),
      system: 'Gulf Watch v2.0',
    },
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const SUPPORTED_FORMATS = { json: true, csv: true, geojson: true, stix: true };

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 405,
      requestId: req.requestId,
    });
  }

  const format = (req.params?.format || '').toLowerCase();

  if (!SUPPORTED_FORMATS[format]) {
    return res.status(400).json({
      error: `Unsupported format. Supported: ${Object.keys(SUPPORTED_FORMATS).join(', ')}`,
      code: 400,
      requestId: req.requestId,
    });
  }

  const incidents = loadIncidents();
  const classification = getClassification();

  // Audit log
  auditLog(req, format, incidents.length);

  let body;
  let contentType;

  switch (format) {
    case 'json':
      body = exportJSON(incidents, classification);
      contentType = 'application/json';
      break;
    case 'csv':
      body = exportCSV(incidents, classification);
      contentType = 'text/csv';
      break;
    case 'geojson':
      body = exportGeoJSON(incidents, classification);
      contentType = 'application/geo+json';
      break;
    case 'stix':
      body = exportSTIX(incidents, classification);
      contentType = 'application/json';
      break;
  }

  const filename = `gulfwatch-export-${Date.now()}.${format === 'stix' ? 'stix.json' : format === 'geojson' ? 'geojson' : format}`;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Classification', classification);
  res.status(200).send(body);
};
