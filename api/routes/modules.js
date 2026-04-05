/**
 * Gulf Watch - Module Outputs API Route
 *
 * GET /api/modules/:name
 * Runs a named Python analysis module and returns its output.
 * Supported: argus, chatter, chronos, ignite, skyline, babel
 * ETag caching via response body hash.
 */

const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUPPORTED_MODULES = new Set([
  'argus',    // Entity & relationship extraction
  'chatter',  // Communications intercept analysis
  'chronos',  // Timeline reconstruction
  'ignite',   // Threat escalation scoring
  'skyline',  // Geospatial overlay generation
  'babel',    // Multi-language NLP processing
]);

const MODULE_DIR = path.join(__dirname, '..', '..', 'modules');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const MODULE_TIMEOUT_MS = parseInt(process.env.MODULE_TIMEOUT_MS || '30000', 10);

// In-memory cache for module outputs
const outputCache = new Map();
const CACHE_TTL_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Module execution
// ---------------------------------------------------------------------------

function runModule(moduleName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(MODULE_DIR, `${moduleName}.py`);

    execFile(
      PYTHON_BIN,
      [scriptPath, '--format', 'json'],
      {
        timeout: MODULE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: {
          ...process.env,
          GULFWATCH_MODULE: moduleName,
          GULFWATCH_DATA_DIR: path.join(__dirname, '..', '..', 'data'),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            return reject(new Error(`Module "${moduleName}" timed out after ${MODULE_TIMEOUT_MS}ms`));
          }
          console.error(`[modules] ${moduleName} stderr:`, stderr);
          return reject(new Error(`Module "${moduleName}" failed: ${error.message}`));
        }

        try {
          const output = JSON.parse(stdout);
          resolve(output);
        } catch (parseErr) {
          // If JSON parse fails, return raw output wrapped
          resolve({
            module: moduleName,
            raw_output: stdout.trim(),
            warning: 'Output was not valid JSON',
          });
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function getCached(moduleName) {
  const entry = outputCache.get(moduleName);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    outputCache.delete(moduleName);
    return null;
  }
  return entry;
}

function setCache(moduleName, data, etag) {
  outputCache.set(moduleName, {
    data,
    etag,
    timestamp: Date.now(),
  });
}

function computeETag(body) {
  return `"${crypto.createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
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

  const moduleName = (req.params?.name || '').toLowerCase();

  // Validate module name
  if (!moduleName || !SUPPORTED_MODULES.has(moduleName)) {
    return res.status(400).json({
      error: `Invalid module. Supported: ${Array.from(SUPPORTED_MODULES).join(', ')}`,
      code: 400,
      requestId: req.requestId,
    });
  }

  try {
    // Check cache first
    const cached = getCached(moduleName);
    if (cached) {
      // ETag conditional response
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === cached.etag) {
        return res.status(304).end();
      }

      res.setHeader('ETag', cached.etag);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).json(cached.data);
    }

    // Run module
    const output = await runModule(moduleName);

    // Build response
    const response = {
      module: moduleName,
      data: output,
      data_source: 'live',
      generated_at: new Date().toISOString(),
    };

    // Compute ETag
    const body = JSON.stringify(response);
    const etag = computeETag(body);

    // Cache
    setCache(moduleName, response, etag);

    // ETag conditional response
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(response);
  } catch (err) {
    console.error(`[modules] Error running ${moduleName}:`, err.message);
    return res.status(500).json({
      error: `Module execution failed: ${err.message}`,
      code: 500,
      module: moduleName,
      requestId: req.requestId,
    });
  }
};
