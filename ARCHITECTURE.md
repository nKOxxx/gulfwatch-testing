# Gulf Watch v2 -- Architecture Document

**Author:** Viktor Almeida, Architect / CTO
**Date:** 2026-04-05
**Status:** APPROVED -- guides all Phase 2 and Phase 3 engineering

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Diagram](#2-component-diagram)
3. [Tech Stack Decisions](#3-tech-stack-decisions)
4. [Database Schema](#4-database-schema)
5. [API Specification](#5-api-specification)
6. [Security Architecture](#6-security-architecture)
7. [Data Flow: Ingestion to Frontend](#7-data-flow-ingestion-to-frontend)
8. [Deployment Architecture](#8-deployment-architecture)
9. [Engineer Integration Contracts](#9-engineer-integration-contracts)
10. [Review Addendum Traceability](#10-review-addendum-traceability)

---

## 1. System Overview

Gulf Watch v2 is a sovereign geopolitical intelligence platform focused on the Middle East.
It replaces the current static SPA + JSON-in-Git architecture with a real-time,
authenticated, encrypted, containerized system capable of air-gapped deployment.

### Current State (v1) -- What We Are Replacing

```
Browser (vanilla HTML/CSS/JS SPA on Vercel)
    |
    +-- Static JSON committed to Git (incidents.json, prices.json, etc.)
    +-- 3 serverless endpoints (aircraft.js, argus.py, report.py)
    +-- 5 Python modules (ARGUS, CHATTER, CHRONOS, IGNITE, SKYLINE) -- all rule-based
    +-- GitHub Actions 12hr cron -> fetch RSS -> commit JSON -> Vercel redeploy
    +-- No auth, no database, no encryption, no audit logging
    +-- Hardcoded OpenSky credentials in api/aircraft.js (line 16-17)
    +-- Runtime bugs: argus_module.py:26 calls .includes() (JS not Python),
        chronos_module.py:57 uses math.sqrt() without importing math
```

### Target State (v2)

```
React SPA (Next.js on Node 20)
    |
    +-- API Gateway (rate-limited, authenticated, CSP-enforced)
    +-- Real-time WebSocket layer (sub-5-min data freshness)
    +-- PostgreSQL 16 + TimescaleDB (encrypted at rest, TLS in transit)
    +-- Immutable append-only audit log
    +-- 7 intelligence modules (ARGUS upgraded to ML, new BABEL Arabic NLP module)
    +-- OAuth 2.0 / OIDC auth with MFA and 3-role RBAC
    +-- Containerized (Docker Compose for dev, Kubernetes for prod, air-gap capable)
    +-- Secrets in HashiCorp Vault (or env-injected via CI, never in code)
```

---

## 2. Component Diagram

```
+-----------------------------------------------------------------------------------+
|                              EXTERNAL DATA SOURCES                                 |
|  [RSS Feeds]  [OpenSky API]  [NASA FIRMS]  [Twitter/X API]  [NewsData API]        |
+-------+---------------+-------------+---------------+-------------+---------------+
        |               |             |               |             |
        v               v             v               v             v
+-----------------------------------------------------------------------------------+
|                          INGESTION LAYER (Rena)                                    |
|                                                                                    |
|  +-------------+  +-------------+  +-------------+  +-------------+                |
|  | RSS Poller  |  | OpenSky     |  | FIRMS       |  | Twitter     |                |
|  | (5 min)     |  | Poller      |  | Poller      |  | Stream      |                |
|  +------+------+  +------+------+  +------+------+  +------+------+                |
|         |                |                |                |                        |
|         v                v                v                v                        |
|  +---------------------------------------------------------------------+           |
|  |              MESSAGE QUEUE (Redis Streams / BullMQ)                 |           |
|  |  Channels: raw_events | enriched_events | alerts | audit           |           |
|  +---------------------------+---------------------------------------------+       |
|                              |                                                     |
+------------------------------|-----------------------------------------------------+
                               v
+-----------------------------------------------------------------------------------+
|                       PROCESSING LAYER (Marcus + Farah)                            |
|                                                                                    |
|  +-------------------+  +-------------------+  +-------------------+               |
|  | ARGUS v2 (ML)     |  | BABEL (Arabic NLP)|  | CHATTER v2       |               |
|  | Embeddings +      |  | Entity extraction |  | Sentiment via    |               |
|  | Cosine similarity |  | Transliteration   |  | transformer      |               |
|  | Entity resolution |  | ar/en alignment   |  | Source scoring   |               |
|  +--------+----------+  +--------+----------+  +--------+----------+               |
|           |                      |                       |                          |
|  +--------+----------+  +-------+-----------+  +--------+----------+               |
|  | CHRONOS v2        |  | IGNITE v2         |  | SKYLINE v2       |               |
|  | Time-series with  |  | NASA FIRMS live   |  | Weather + ops    |               |
|  | math import fixed |  | fire detection    |  | impact scoring   |               |
|  +--------+----------+  +--------+----------+  +--------+----------+               |
|           |                      |                       |                          |
|           +----------------------+-----------------------+                          |
|                                  |                                                  |
|                                  v                                                  |
|                     +---------------------------+                                   |
|                     | SCENARIO MODELING ENGINE   |                                  |
|                     | (replaces "prediction      |                                  |
|                     |  engine" -- renamed per R9) |                                  |
|                     +---------------------------+                                   |
+------------------------------|-----------------------------------------------------+
                               v
+-----------------------------------------------------------------------------------+
|                        STORAGE LAYER (Rena + Priya)                                |
|                                                                                    |
|  +----------------------------------+  +----------------------------------+        |
|  | PostgreSQL 16 + TimescaleDB      |  | Redis 7                         |        |
|  | - incidents (hypertable)         |  | - Session cache                 |        |
|  | - entities                       |  | - Rate limit counters           |        |
|  | - audit_log (append-only)        |  | - WebSocket pub/sub             |        |
|  | - users, sessions, roles         |  | - Message queue (BullMQ)        |        |
|  | - prompt_overrides               |  +----------------------------------+        |
|  | - module_outputs                 |                                              |
|  | AES-256 encryption at rest       |                                              |
|  | TLS 1.3 in transit               |                                              |
|  +----------------------------------+                                              |
+------------------------------|-----------------------------------------------------+
                               v
+-----------------------------------------------------------------------------------+
|                         API LAYER (Ines)                                           |
|                                                                                    |
|  +----------------------------------+  +----------------------------------+        |
|  | REST API (Express/Fastify)       |  | WebSocket Server (ws/Socket.io) |        |
|  | /api/v1/incidents                |  | /ws/live-feed                   |        |
|  | /api/v1/entities                 |  | /ws/alerts                      |        |
|  | /api/v1/modules/*                |  | /ws/module-updates              |        |
|  | /api/v1/auth/*                   |  +----------------------------------+        |
|  | /api/v1/admin/*                  |                                              |
|  | /api/v1/audit                    |                                              |
|  +----------------------------------+                                              |
|  Rate limiting: 100 req/min (analyst), 500 req/min (admin)                         |
|  Auth: Bearer JWT (access) + HttpOnly cookie (refresh)                             |
+------------------------------|-----------------------------------------------------+
                               v
+-----------------------------------------------------------------------------------+
|                       FRONTEND (Suki)                                              |
|                                                                                    |
|  +----------------------------------+  +----------------------------------+        |
|  | Next.js 14 App Router            |  | Map (Mapbox GL JS)              |        |
|  | - Dashboard (live feed)          |  | - Incident markers              |        |
|  | - Module panels (7 modules)      |  | - Thermal overlay (IGNITE)      |        |
|  | - Entity graph                   |  | - Airspace tracks               |        |
|  | - Scenario modeling UI           |  | - Weather overlay (SKYLINE)     |        |
|  | - Admin panel (users, audit)     |  +----------------------------------+        |
|  | - Arabic RTL support             |                                              |
|  +----------------------------------+                                              |
|  CSP: script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:    |
+-----------------------------------------------------------------------------------+
|                                                                                    |
|                       INFRASTRUCTURE (Carlos)                                      |
|  +----------------------------------+  +----------------------------------+        |
|  | Docker Compose (dev)             |  | Kubernetes (prod)               |        |
|  | - api (Node 20 Alpine)           |  | - Helm charts                   |        |
|  | - postgres (16-alpine + TS)      |  | - Air-gap registry              |        |
|  | - redis (7-alpine)               |  | - Network policies              |        |
|  | - nginx (reverse proxy)          |  | - Pod security standards        |        |
|  +----------------------------------+  +----------------------------------+        |
|  Secrets: HashiCorp Vault / K8s Secrets (never in code, never in env files)        |
|  Monitoring: Prometheus + Grafana (Priya)                                          |
+-----------------------------------------------------------------------------------+
```

---

## 3. Tech Stack Decisions

### Runtime

| Component | Choice | Why | Rejected | Why Rejected |
|-----------|--------|-----|----------|-------------|
| Backend language | TypeScript (Node 20) | Type safety, team expertise, shared types with frontend | Python (FastAPI) | Would split the team across two ecosystems; Python modules run as child processes or WASM |
| Backend framework | Fastify 4 | 2x throughput vs Express, schema validation built-in, plugin system | Express 4 | Slower, less structured |
| Frontend framework | Next.js 14 (App Router) | SSR for initial load, RSC for data-heavy panels, built-in routing | Vite + React | No SSR, no API routes |
| Database | PostgreSQL 16 + TimescaleDB | Time-series hypertables for incidents, mature RBAC, encryption | MongoDB | No ACID for audit log, weaker query planner |
| Cache / Queue | Redis 7 | Pub/sub for WebSocket fan-out, BullMQ for job queue, session store | RabbitMQ | Overkill for our message patterns; Redis covers queue + cache + pub/sub |
| Search | PostgreSQL full-text + pg_trgm | Good enough for <10M rows; avoids operational burden of Elasticsearch | Elasticsearch | Separate cluster to maintain, overkill at our scale |
| ML model serving | ONNX Runtime (Node bindings) | Run ARGUS embeddings in-process, no separate inference server | TensorFlow Serving | Separate service, GPU dependency |
| Arabic NLP | CAMeL Tools + custom pipeline | Best Arabic morphological analysis; MIT licensed | spaCy Arabic | Weaker entity extraction for Arabic |
| Map | Mapbox GL JS | Vector tiles, 3D terrain, custom layers, offline capable | Leaflet | No vector tiles, limited styling |
| Auth | Custom OAuth 2.0 / OIDC via `openid-client` + `jose` | Full control, no vendor lock-in, air-gap compatible | Auth0 / Clerk | SaaS dependency breaks air-gap requirement |
| Secrets | HashiCorp Vault (prod), dotenv-vault (dev) | Air-gap capable, audit trail, dynamic secrets | AWS Secrets Manager | Cloud vendor lock-in |

### Python Modules Strategy

The 5 existing Python modules (ARGUS, CHATTER, CHRONOS, IGNITE, SKYLINE) plus new BABEL
are called from Node via child_process.spawn with JSON over stdin/stdout. Each module:

1. Reads JSON from stdin (events array + config)
2. Processes and writes JSON to stdout
3. Exits with code 0 (success) or 1 (failure, stderr has error)

This avoids rewriting working Python logic while keeping the API server in TypeScript.
ARGUS v2 additionally loads an ONNX model for embeddings.

---

## 4. Database Schema

### 4.1 Core Tables

```sql
-- ============================================================
-- USERS & AUTH (Carlos owns implementation, Rena owns schema)
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT,                    -- bcrypt, NULL if OIDC-only
    mfa_secret      TEXT,                    -- TOTP secret, encrypted at app layer
    mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
    role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('viewer', 'analyst', 'admin')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'pending')),
    oidc_provider   TEXT,                    -- 'google', 'azure', 'custom', NULL
    oidc_subject    TEXT,                    -- Provider subject ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    UNIQUE (oidc_provider, oidc_subject)
);

CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   TEXT NOT NULL UNIQUE,    -- hashed (SHA-256)
    user_agent      TEXT,
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ            -- NULL = active
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE revoked_at IS NULL;

-- ============================================================
-- INCIDENTS (Rena owns, TimescaleDB hypertable)
-- ============================================================

CREATE TABLE incidents (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    external_id     TEXT,                    -- Original source ID (RSS guid, etc.)
    title           TEXT NOT NULL,
    title_ar        TEXT,                    -- Arabic title (BABEL output)
    description     TEXT,
    description_ar  TEXT,
    source          TEXT NOT NULL,            -- 'al_jazeera', 'reuters', etc.
    source_url      TEXT,
    source_reliability REAL,                 -- 0.0-1.0
    published_at    TIMESTAMPTZ NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    incident_type   TEXT NOT NULL
                    CHECK (incident_type IN (
                        'military', 'political', 'economic', 'humanitarian',
                        'security', 'diplomatic', 'environmental', 'cyber'
                    )),
    severity        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status          TEXT NOT NULL DEFAULT 'unconfirmed'
                    CHECK (status IN ('confirmed', 'unconfirmed', 'disputed', 'retracted')),
    location_name   TEXT,
    country_code    CHAR(2),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    countries       TEXT[] NOT NULL DEFAULT '{}',  -- All countries involved
    credibility     INTEGER CHECK (credibility BETWEEN 0 AND 100),
    sentiment_score REAL,                    -- -100 to +100
    sentiment_label TEXT,                    -- 'positive', 'negative', 'neutral'
    data_source     TEXT NOT NULL DEFAULT 'live'
                    CHECK (data_source IN ('live', 'mock')),  -- R14
    raw_payload     JSONB,                   -- Original source data
    PRIMARY KEY (id, published_at)
);

-- Convert to TimescaleDB hypertable (partitioned on published_at)
SELECT create_hypertable('incidents', 'published_at');

CREATE INDEX idx_incidents_country ON incidents(country_code, published_at DESC);
CREATE INDEX idx_incidents_severity ON incidents(severity, published_at DESC);
CREATE INDEX idx_incidents_type ON incidents(incident_type, published_at DESC);
CREATE INDEX idx_incidents_external ON incidents(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_incidents_source ON incidents(source, published_at DESC);
CREATE INDEX idx_incidents_gin ON incidents USING GIN (countries);
CREATE INDEX idx_incidents_fts ON incidents USING GIN (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);

-- ============================================================
-- ENTITIES (ARGUS output)
-- ============================================================

CREATE TABLE entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name  TEXT NOT NULL,
    canonical_name_ar TEXT,                  -- Arabic canonical name
    entity_type     TEXT NOT NULL
                    CHECK (entity_type IN (
                        'nation', 'organization', 'person', 'military_unit',
                        'weapon_system', 'facility', 'vessel', 'aircraft'
                    )),
    country_code    CHAR(2),
    aliases         TEXT[] NOT NULL DEFAULT '{}',
    metadata        JSONB NOT NULL DEFAULT '{}',
    embedding       VECTOR(384),             -- MiniLM-L6 embedding for ARGUS v2
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_name ON entities USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Junction table: incidents <-> entities
CREATE TABLE incident_entities (
    incident_id     BIGINT NOT NULL,
    incident_time   TIMESTAMPTZ NOT NULL,    -- Needed for hypertable FK
    entity_id       UUID NOT NULL REFERENCES entities(id),
    role            TEXT,                     -- 'actor', 'target', 'location', 'mentioned'
    confidence      REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (incident_id, incident_time, entity_id),
    FOREIGN KEY (incident_id, incident_time) REFERENCES incidents(id, published_at)
);

-- ============================================================
-- MODULE OUTPUTS (all 7 modules write here)
-- ============================================================

CREATE TABLE module_outputs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_name     TEXT NOT NULL
                    CHECK (module_name IN (
                        'argus', 'babel', 'chatter', 'chronos',
                        'ignite', 'skyline', 'scenario_modeling'
                    )),
    run_id          UUID NOT NULL,            -- Groups outputs from same pipeline run
    input_hash      TEXT NOT NULL,            -- SHA-256 of input for deduplication
    output_data     JSONB NOT NULL,
    data_source     TEXT NOT NULL DEFAULT 'live'
                    CHECK (data_source IN ('live', 'mock')),  -- R14
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms     INTEGER,
    error           TEXT
);

CREATE INDEX idx_module_outputs_module ON module_outputs(module_name, created_at DESC);
CREATE INDEX idx_module_outputs_run ON module_outputs(run_id);

-- ============================================================
-- THERMAL DATA (IGNITE output, TimescaleDB hypertable)
-- ============================================================

CREATE TABLE thermal_detections (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    detected_at     TIMESTAMPTZ NOT NULL,
    satellite       TEXT NOT NULL,            -- 'VIIRS-NPP', 'MODIS-Aqua'
    fire_radiative_power REAL,
    brightness      REAL,
    confidence      TEXT,
    fire_type       TEXT,                     -- 'industrial_large', 'wildfire', etc.
    risk_level      TEXT,
    region          TEXT,
    data_source     TEXT NOT NULL DEFAULT 'live'
                    CHECK (data_source IN ('live', 'mock')),
    PRIMARY KEY (id, detected_at)
);

SELECT create_hypertable('thermal_detections', 'detected_at');

CREATE INDEX idx_thermal_geo ON thermal_detections
    USING GIST (ST_MakePoint(longitude, latitude));

-- ============================================================
-- AUDIT LOG (Priya owns, append-only, R4)
-- ============================================================

CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID REFERENCES users(id),   -- NULL for system actions
    action          TEXT NOT NULL,                -- 'login', 'view_incident', 'export', etc.
    resource_type   TEXT,                         -- 'incident', 'entity', 'user', etc.
    resource_id     TEXT,
    ip_address      INET,
    user_agent      TEXT,
    details         JSONB NOT NULL DEFAULT '{}',  -- Action-specific data
    PRIMARY KEY (id, timestamp)
);

SELECT create_hypertable('audit_log', 'timestamp');

-- CRITICAL: revoke DELETE and UPDATE on audit_log for all app roles
-- Only the postgres superuser can modify. App connects as gw_app role.
REVOKE DELETE, UPDATE ON audit_log FROM gw_app;
REVOKE DELETE, UPDATE ON audit_log FROM gw_readonly;

CREATE INDEX idx_audit_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_log(action, timestamp DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id, timestamp DESC);

-- ============================================================
-- PROMPT OVERRIDES (improvement loop)
-- ============================================================

CREATE TABLE prompt_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name     TEXT NOT NULL,
    override_suffix TEXT NOT NULL,
    reason          TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    iteration       INTEGER NOT NULL,
    score_before    JSONB,
    score_after     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at  TIMESTAMPTZ
);

CREATE INDEX idx_overrides_active ON prompt_overrides(module_name) WHERE active = true;

-- ============================================================
-- IMPROVEMENT RUNS
-- ============================================================

CREATE TABLE improvement_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iteration       INTEGER NOT NULL,
    module_modified TEXT NOT NULL,
    override_id     UUID REFERENCES prompt_overrides(id),
    pass_rate_before REAL NOT NULL,
    pass_rate_after  REAL NOT NULL,
    cost_before     REAL,
    cost_after      REAL,
    kept            BOOLEAN NOT NULL,
    reason          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SCENARIO MODELS (replaces "predictions", R9)
-- ============================================================

CREATE TABLE scenario_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    model_type      TEXT NOT NULL
                    CHECK (model_type IN ('escalation', 'de-escalation', 'status_quo', 'custom')),
    input_data      JSONB NOT NULL,          -- Incident IDs, entity IDs, parameters
    output_data     JSONB NOT NULL,          -- Scenario tree, probability weights
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DATABASE ROLES
-- ============================================================

-- gw_app: the application service account
-- gw_readonly: read-only for dashboards / analytics
-- gw_admin: schema migrations only, used by CI

-- CREATE ROLE gw_app LOGIN PASSWORD '...' (set via Vault);
-- CREATE ROLE gw_readonly LOGIN PASSWORD '...' (set via Vault);
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO gw_app;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO gw_readonly;
-- REVOKE DELETE, UPDATE ON audit_log FROM gw_app;
```

### 4.2 Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- Trigram similarity search
CREATE EXTENSION IF NOT EXISTS vector;         -- pgvector for ARGUS embeddings
CREATE EXTENSION IF NOT EXISTS postgis;        -- Geospatial queries for thermal data
```

---

## 5. API Specification

### 5.1 Base URL

```
Production:  https://api.gulfwatch.io/v1
Development: http://localhost:3001/v1
WebSocket:   wss://api.gulfwatch.io/ws
```

### 5.2 Authentication Endpoints

All auth endpoints are under `/v1/auth`.

| Method | Path | Auth | Rate Limit | Request Body | Response |
|--------|------|------|-----------|-------------|----------|
| POST | `/auth/login` | None | 10/min/IP | `{ email, password }` | `{ accessToken, expiresIn }` + Set-Cookie: refreshToken |
| POST | `/auth/login/oidc` | None | 20/min/IP | `{ provider, idToken }` | Same as login |
| POST | `/auth/refresh` | Cookie | 30/min/user | (cookie only) | `{ accessToken, expiresIn }` |
| POST | `/auth/logout` | Bearer | 10/min/user | (none) | `{ ok: true }` |
| POST | `/auth/mfa/enable` | Bearer | 5/min/user | (none) | `{ secret, qrCodeUrl }` |
| POST | `/auth/mfa/verify` | Bearer | 10/min/user | `{ code }` | `{ ok: true }` |

**Token format:**
- Access token: JWT, 15-minute TTL, signed with RS256 (RSA 2048-bit key pair)
- Refresh token: opaque 256-bit random, HttpOnly Secure SameSite=Strict cookie, 7-day TTL
- JWT payload: `{ sub: userId, role: "analyst", iat, exp }`

### 5.3 Incident Endpoints

| Method | Path | Auth | Roles | Rate Limit | Description |
|--------|------|------|-------|-----------|-------------|
| GET | `/incidents` | Bearer | all | 100/min | List incidents (paginated) |
| GET | `/incidents/:id` | Bearer | all | 100/min | Get single incident |
| GET | `/incidents/search` | Bearer | all | 50/min | Full-text search |
| POST | `/incidents` | Bearer | analyst, admin | 20/min | Create incident manually |
| PATCH | `/incidents/:id` | Bearer | analyst, admin | 20/min | Update incident |
| GET | `/incidents/export` | Bearer | analyst, admin | 5/min | Export CSV/JSON |

**GET /incidents query parameters:**

```
?country=IR          -- Filter by country code
&severity=critical   -- Filter by severity
&type=military       -- Filter by incident_type
&status=confirmed    -- Filter by status
&source=reuters      -- Filter by source
&from=2026-03-01     -- Published after (ISO 8601)
&to=2026-04-01       -- Published before (ISO 8601)
&q=missile+launch    -- Full-text search
&page=1              -- Page number (1-indexed)
&limit=50            -- Items per page (max 200)
&sort=published_at   -- Sort field
&order=desc          -- Sort order
```

**Response format (all list endpoints):**

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 1234,
    "totalPages": 25,
    "dataSource": "live"
  }
}
```

The `dataSource` field in `meta` is either `"live"` or `"mock"`, satisfying R14.
Every individual record also carries `data_source: "live" | "mock"`.

### 5.4 Entity Endpoints

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/entities` | Bearer | all | List entities (paginated) |
| GET | `/entities/:id` | Bearer | all | Get entity with linked incidents |
| GET | `/entities/:id/graph` | Bearer | all | Get entity relationship graph |
| GET | `/entities/search` | Bearer | all | Search by name (trigram + embedding) |

### 5.5 Module Endpoints

Each intelligence module has its own namespace. All require Bearer auth.

```
GET  /modules/argus              -- Entity resolution + threat scores
GET  /modules/argus/threats      -- Country threat rankings
GET  /modules/babel/translate    -- Arabic entity extraction (POST with text body)
GET  /modules/chatter            -- Social intelligence / sentiment
GET  /modules/chatter/trends     -- Trending topics
GET  /modules/chronos            -- Temporal analysis + anomaly detection
GET  /modules/chronos/timeseries -- Time series data (for charts)
GET  /modules/ignite             -- Thermal detections
GET  /modules/ignite/hotspots    -- Active hotspot clusters
GET  /modules/skyline            -- Weather intelligence
GET  /modules/skyline/maritime   -- Maritime weather
GET  /modules/skyline/forecast   -- Regional forecast
GET  /modules/scenario           -- List scenario models
POST /modules/scenario           -- Create scenario model (analyst+)
```

**Module response envelope:**

```json
{
  "module": "argus",
  "version": "2.0.0",
  "dataSource": "live",
  "generatedAt": "2026-04-05T12:00:00Z",
  "durationMs": 342,
  "data": { ... }
}
```

### 5.6 Admin Endpoints

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/admin/users` | Bearer | admin | List users |
| POST | `/admin/users` | Bearer | admin | Create user |
| PATCH | `/admin/users/:id` | Bearer | admin | Update user role/status |
| GET | `/admin/audit` | Bearer | admin | Query audit log |
| GET | `/admin/system/health` | Bearer | admin | System health check |
| GET | `/admin/system/metrics` | Bearer | admin | Prometheus metrics |

### 5.7 WebSocket Protocol

Connection: `wss://api.gulfwatch.io/ws?token=<access_token>`

**Server -> Client messages:**

```json
{ "type": "incident.new",    "data": { /* incident object */ } }
{ "type": "incident.update", "data": { /* incident object */ } }
{ "type": "alert.threat",    "data": { "country": "IR", "level": "critical", "reason": "..." } }
{ "type": "module.update",   "data": { "module": "argus", "summary": { ... } } }
{ "type": "thermal.new",     "data": { /* thermal detection */ } }
{ "type": "heartbeat",       "data": { "ts": 1712300000 } }
```

**Client -> Server messages:**

```json
{ "type": "subscribe",   "channels": ["incidents", "alerts", "thermal"] }
{ "type": "unsubscribe", "channels": ["thermal"] }
{ "type": "pong" }
```

Heartbeat interval: 30 seconds. Client must respond with pong within 10 seconds or connection is dropped.

### 5.8 Rate Limiting

Implemented via Redis sliding window:

| Role | REST Requests | WebSocket Messages | Export |
|------|--------------|-------------------|--------|
| viewer | 60/min | 10/min (outbound) | N/A |
| analyst | 100/min | 30/min | 5/min |
| admin | 500/min | unlimited | 20/min |
| unauthenticated | 10/min (auth endpoints only) | N/A | N/A |

Rate limit headers on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1712300060
```

---

## 6. Security Architecture

### 6.1 Authentication Flow

```
User                    Frontend              API                  DB
  |                        |                    |                    |
  |-- Login (email/pw) --> |                    |                    |
  |                        |-- POST /auth/login |                    |
  |                        |                    |-- verify bcrypt -> |
  |                        |                    |<- user record -----|
  |                        |                    |                    |
  |                        |   IF mfa_enabled:  |                    |
  |                        |<- { mfaRequired }  |                    |
  |<- Show TOTP prompt --- |                    |                    |
  |-- Enter TOTP code ---> |                    |                    |
  |                        |-- POST /auth/mfa/verify               |
  |                        |                    |-- verify TOTP      |
  |                        |                    |                    |
  |                        |<- { accessToken }  |                    |
  |                        |   Set-Cookie:      |                    |
  |                        |   refresh=<hash>   |                    |
  |<- Store in memory ---- |   HttpOnly Secure  |                    |
  |   (NOT localStorage)   |   SameSite=Strict  |                    |
  |                        |                    |-- INSERT audit_log |
```

### 6.2 RBAC Roles

| Role | Incidents | Entities | Modules | Scenario Models | Users | Audit | Export |
|------|-----------|----------|---------|----------------|-------|-------|--------|
| viewer | read | read | read | read | -- | -- | -- |
| analyst | read/write | read | read | read/write | -- | -- | yes |
| admin | read/write | read/write | read/config | read/write | read/write | read | yes |

### 6.3 Encryption

| Layer | Method | Key Management |
|-------|--------|---------------|
| Data at rest (PostgreSQL) | AES-256 via pgcrypto TDE or filesystem encryption | Key in Vault |
| Data in transit (API) | TLS 1.3, HSTS, min TLS 1.2 | Let's Encrypt (cloud) or self-signed (air-gap) |
| Data in transit (DB) | TLS 1.3 client cert auth | Cert generated per environment |
| Passwords | bcrypt (cost factor 12) | N/A |
| MFA secrets | AES-256-GCM encrypted at app layer before storage | Encryption key in Vault |
| JWT signing | RS256 (RSA 2048-bit) | Private key in Vault, public key served at `/auth/.well-known/jwks.json` |
| Refresh tokens | SHA-256 hashed before storage | Raw token only in HttpOnly cookie |

### 6.4 Content Security Policy (R8)

```
Content-Security-Policy:
    default-src 'none';
    script-src 'self';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https://api.mapbox.com https://*.tiles.mapbox.com;
    font-src 'self';
    connect-src 'self' wss://api.gulfwatch.io https://api.mapbox.com;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
    upgrade-insecure-requests;
```

### 6.5 Secrets Management (R1, R10)

**Never in code. Never in environment files committed to Git.**

| Secret | Storage | Rotation |
|--------|---------|----------|
| Database password | Vault dynamic secret | Auto-rotated every 24h |
| JWT signing key (RSA) | Vault KV v2 | Manual, quarterly |
| OpenSky API credentials | Vault KV v2 | Manual |
| NASA FIRMS API key | Vault KV v2 | Manual |
| NewsData API key | Vault KV v2 | Manual |
| Redis password | Vault dynamic secret | Auto-rotated every 24h |
| OIDC client secret | Vault KV v2 | Per provider policy |

Development: `dotenv-vault` with `.env.vault` (encrypted) committed, `.env` in `.gitignore`.
CI/CD: Secrets injected as environment variables from Vault agent sidecar.

### 6.6 Additional Security Headers

Applied by the reverse proxy (nginx) or Fastify plugin:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0              -- CSP replaces this; 0 prevents double-handling bugs
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store           -- For authenticated API responses
```

### 6.7 CORS Policy

```
Access-Control-Allow-Origin: https://gulfwatch.io   (NOT *)
Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

---

## 7. Data Flow: Ingestion to Frontend

### 7.1 Ingestion Pipeline (replaces 12hr GitHub Actions cron)

```
Step 1: POLLERS (run every 5 minutes, managed by BullMQ repeatable jobs)
    |
    |   rss-poller       -> fetches 15+ RSS feeds (Al Jazeera, Reuters, AP, etc.)
    |   opensky-poller   -> fetches OpenSky aircraft states (credentials from Vault)
    |   firms-poller     -> fetches NASA FIRMS VIIRS + MODIS data
    |   twitter-poller   -> fetches Twitter/X search results
    |
    v
Step 2: RAW EVENT NORMALIZATION
    |
    |   Each poller normalizes its data into a common RawEvent schema:
    |   {
    |     sourceId: string,       -- Unique across sources
    |     source: string,         -- 'reuters', 'opensky', 'firms', etc.
    |     title: string,
    |     description?: string,
    |     publishedAt: ISO8601,
    |     location?: { name, country, lat, lon },
    |     rawPayload: object      -- Original source data
    |   }
    |
    v
Step 3: DEDUPLICATION
    |
    |   SHA-256 hash of (source + sourceId) checked against module_outputs.input_hash.
    |   Exact duplicates are dropped silently.
    |   Near-duplicates (same event from different sources) are merged:
    |     - Highest credibility source wins for title
    |     - All source URLs preserved in raw_payload
    |
    v
Step 4: ENRICHMENT PIPELINE (sequential, each step reads/writes the event)
    |
    |   4a. BABEL      -- Arabic text detection, entity extraction, transliteration
    |   4b. ARGUS v2   -- Entity resolution (embedding similarity), threat scoring
    |   4c. CHATTER    -- Sentiment analysis, source reliability scoring
    |   4d. CHRONOS    -- Temporal classification, anomaly flagging
    |   4e. IGNITE     -- (only for thermal data) Fire classification, clustering
    |   4f. SKYLINE    -- Weather correlation (for operational impact)
    |
    v
Step 5: PERSIST
    |
    |   INSERT INTO incidents + entities + incident_entities + module_outputs
    |   All in a single transaction per event batch
    |   INSERT INTO audit_log (action='ingest', details={source, count})
    |
    v
Step 6: NOTIFY
    |
    |   Publish to Redis channels:
    |     channel:incidents  -> { type: 'incident.new', data: incident }
    |     channel:alerts     -> { type: 'alert.threat', data: threat }  (if severity=critical)
    |     channel:thermal    -> { type: 'thermal.new', data: detection }
    |
    v
Step 7: WEBSOCKET FAN-OUT
    |
    |   WebSocket server subscribes to Redis channels.
    |   Broadcasts to connected clients based on their channel subscriptions.
    |   Authenticated clients only; message filtered by user role if needed.
```

### 7.2 Data Freshness Guarantee (R5)

| Source | Poll Interval | Expected Latency (source -> client) |
|--------|-------------|--------------------------------------|
| RSS feeds | 5 minutes | 5-7 minutes |
| OpenSky aircraft | 2 minutes | 2-3 minutes |
| NASA FIRMS | 5 minutes | 5-8 minutes |
| Twitter/X | 3 minutes | 3-5 minutes |
| Manual incidents | Immediate | <2 seconds |

All well under the 5-minute requirement. Current system is 12 hours.

---

## 8. Deployment Architecture

### 8.1 Docker Compose (Development)

```yaml
# docker-compose.yml
services:
  api:
    build: ./docker/api
    image: gulfwatch-api:dev
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: postgres://gw_app:dev@postgres:5432/gulfwatch
      REDIS_URL: redis://redis:6379
      JWT_PRIVATE_KEY_PATH: /secrets/jwt-private.pem
      JWT_PUBLIC_KEY_PATH: /secrets/jwt-public.pem
      NODE_ENV: development
    volumes:
      - ./src:/app/src
      - ./modules:/app/modules
      - ./secrets/dev:/secrets:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  frontend:
    build: ./docker/frontend
    image: gulfwatch-frontend:dev
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001/v1
      NEXT_PUBLIC_WS_URL: ws://localhost:3001/ws

  postgres:
    image: timescale/timescaledb:latest-pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: gulfwatch
      POSTGRES_USER: gw_admin
      POSTGRES_PASSWORD: dev_only_password
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gw_admin -d gulfwatch"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --requirepass dev_only_password --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "dev_only_password", "ping"]
      interval: 5s
      retries: 5

volumes:
  pgdata:
```

### 8.2 Kubernetes (Production)

```
Namespace: gulfwatch

Deployments:
  gw-api           Replicas: 3    CPU: 500m-2000m   Mem: 512Mi-2Gi
  gw-frontend      Replicas: 2    CPU: 200m-1000m   Mem: 256Mi-1Gi
  gw-ingestion     Replicas: 1    CPU: 1000m-4000m  Mem: 1Gi-4Gi  (runs pollers + pipeline)

StatefulSets:
  gw-postgres      Replicas: 2    CPU: 2000m-8000m  Mem: 4Gi-16Gi (primary + standby)
  gw-redis         Replicas: 1    CPU: 500m-2000m   Mem: 1Gi-4Gi

Services:
  gw-api-svc           ClusterIP   -> gw-api:3001
  gw-frontend-svc      ClusterIP   -> gw-frontend:3000
  gw-postgres-svc      ClusterIP   -> gw-postgres:5432     (headless for StatefulSet)
  gw-redis-svc         ClusterIP   -> gw-redis:6379

Ingress:
  gulfwatch.io         -> gw-frontend-svc:3000
  api.gulfwatch.io     -> gw-api-svc:3001                   (TLS termination)

NetworkPolicies:
  - gw-api can reach gw-postgres, gw-redis
  - gw-frontend can reach gw-api only
  - gw-ingestion can reach gw-postgres, gw-redis, egress to external APIs
  - gw-postgres denies all ingress except from gw-api, gw-ingestion
  - gw-redis denies all ingress except from gw-api, gw-ingestion

PodSecurityStandards: restricted
  - runAsNonRoot: true
  - readOnlyRootFilesystem: true (api, frontend)
  - allowPrivilegeEscalation: false
  - seccompProfile: RuntimeDefault
```

### 8.3 Air-Gap Deployment (R12)

For sovereign deployments without internet access:

1. **Registry mirror:** All container images pushed to an internal Harbor registry.
   Images: `gulfwatch-api`, `gulfwatch-frontend`, `gulfwatch-ingestion`,
   `timescaledb:pg16`, `redis:7-alpine`.

2. **Offline data ingestion:** USB/DVD import tool reads JSON/CSV files in the
   same RawEvent format. Dropped into `/data/import/` volume mount, picked up by
   the ingestion worker.

3. **ONNX models bundled in container image:** No model download at startup.
   ARGUS embedding model (all-MiniLM-L6-v2, ~80MB) and BABEL NLP models (~200MB)
   are baked into the `gulfwatch-ingestion` image at build time.

4. **Self-signed TLS:** Helm value `tls.selfSigned=true` generates CA + certs
   at install time. Trust store distributed to all pods.

5. **No external telemetry:** Prometheus + Grafana run inside the cluster.
   No data leaves the air-gapped network.

6. **Vault in air-gap mode:** HashiCorp Vault runs as a pod with Raft backend.
   Initialized with Shamir seal (5 shares, 3 threshold).

### 8.4 Cost Model

| Component | 1K users/day | 100K users/day | 1M users/day |
|-----------|-------------|----------------|--------------|
| API servers | 1x $40/mo | 3x $120/mo | 10x $400/mo |
| PostgreSQL | 1x $80/mo | 1x primary + 1 read replica $200/mo | 2x primary (sharded) + 2 replicas $800/mo |
| Redis | 1x $20/mo | 1x $60/mo | 3x cluster $200/mo |
| Ingestion worker | 1x $40/mo | 1x $80/mo | 2x $160/mo |
| Bandwidth | ~$10/mo | ~$100/mo | ~$500/mo |
| **Total** | **~$190/mo** | **~$560/mo** | **~$2,060/mo** |

---

## 9. Engineer Integration Contracts

### 9.1 Rena Oduya -- Backend Core

**Owns:** Database layer, ingestion pipeline, WebSocket server, message queue.

**Deliverables:**

1. **Database initialization script** (`db/init.sql`):
   - Create all tables, indexes, extensions from Section 4
   - Create database roles (gw_app, gw_readonly, gw_admin)
   - Ensure audit_log is append-only (REVOKE DELETE/UPDATE)

2. **Ingestion pipeline** (`src/ingestion/`):
   - `poller-rss.ts` -- RSS feed poller, 5-min BullMQ repeatable job
   - `poller-opensky.ts` -- OpenSky API poller, 2-min interval. Credentials from Vault/env, NOT hardcoded (fixes R1)
   - `poller-firms.ts` -- NASA FIRMS poller, 5-min interval
   - `poller-twitter.ts` -- Twitter/X search poller, 3-min interval
   - `normalizer.ts` -- Converts raw source data to RawEvent schema
   - `deduplicator.ts` -- SHA-256 based exact + near-duplicate detection
   - `pipeline.ts` -- Orchestrates enrichment: BABEL -> ARGUS -> CHATTER -> CHRONOS -> IGNITE -> SKYLINE
   - Each module called via `child_process.spawn` with JSON stdin/stdout

3. **WebSocket server** (`src/ws/`):
   - `ws-server.ts` -- Connection handling, auth verification, channel subscription
   - `ws-broadcaster.ts` -- Redis subscriber -> fan-out to connected clients
   - Protocol: see Section 5.7
   - Heartbeat: 30s interval, 10s timeout

4. **Data access layer** (`src/db/`):
   - `incidents.ts` -- CRUD with pagination, filtering, full-text search
   - `entities.ts` -- CRUD with trigram search, embedding search
   - `thermal.ts` -- Insert + query thermal detections
   - `module-outputs.ts` -- Insert + query module outputs
   - All queries parameterized (no string interpolation)
   - All writes wrapped in transactions
   - Every write includes corresponding audit_log INSERT

**Interface contract with Marcus (ML):**

```typescript
// Module execution interface -- Rena calls, Marcus implements
interface ModuleExecution {
  moduleName: 'argus' | 'babel' | 'chatter' | 'chronos' | 'ignite' | 'skyline';
  input: {
    events: RawEvent[];
    config: ModuleConfig;
    promptOverride?: string;   // Appended to system prompt if present
  };
  output: {
    module: string;
    version: string;
    dataSource: 'live' | 'mock';
    data: Record<string, unknown>;
    durationMs: number;
    error?: string;
  };
}

// Rena spawns: python3 modules/{moduleName}/main.py
// Rena writes JSON to stdin, reads JSON from stdout
// Timeout: 30 seconds per module. On timeout -> error in module_outputs.
```

**Interface contract with Priya (audit):**

```typescript
// Rena provides this function. Priya defines the audit schema.
async function writeAuditLog(entry: {
  userId?: string;        // null for system actions
  action: string;         // 'ingest', 'create_incident', 'update_incident', etc.
  resourceType?: string;  // 'incident', 'entity', 'user', etc.
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}): Promise<void>;
```

### 9.2 Priya Nakamura -- Reliability & Testing

**Owns:** Audit logging, monitoring, test infrastructure, data integrity.

**Deliverables:**

1. **Immutable audit logging** (R4):
   - Verify audit_log table is truly append-only (test DELETE/UPDATE are denied)
   - Audit log query API (`src/audit/query.ts`): filter by user, action, resource, time range
   - Audit log retention policy: 1 year in hot storage, archive to compressed CSV after
   - Audit every: login, logout, incident view, incident create/update, export, user management action, config change

2. **Monitoring stack** (`monitoring/`):
   - Prometheus config with scrape targets for all services
   - Grafana dashboards:
     - System health (CPU, memory, disk, network)
     - API metrics (request rate, latency p50/p95/p99, error rate)
     - Ingestion metrics (events/min by source, pipeline latency, failures)
     - Module metrics (execution time, error rate per module)
     - WebSocket metrics (connections, messages/sec, disconnects)
   - Alert rules:
     - API error rate > 5% for 5 minutes
     - Ingestion pipeline stalled > 10 minutes
     - Database connection pool exhausted
     - Disk usage > 80%

3. **Test infrastructure** (`tests/`):
   - `tests/unit/` -- Unit tests for all modules, data access, auth
   - `tests/integration/` -- API endpoint tests with test database
   - `tests/e2e/` -- Playwright tests for critical frontend flows
   - `tests/load/` -- k6 load test scripts
     - Target: 100 concurrent users, < 200ms p95 API response
   - `tests/chaos/` -- Network partition, DB failover, Redis failure scenarios
   - `tests/security/` -- Penetration test prep (R11):
     - SQL injection test vectors
     - XSS test vectors
     - CSRF verification
     - Auth bypass attempts
     - Rate limit verification

4. **Data integrity checks:**
   - Nightly job: verify incident counts match between hypertable and module_outputs
   - Verify no orphaned entities (entity with 0 incident links)
   - Verify audit_log has no gaps in sequence

**Interface with Rena:** Priya defines the audit entry schema. Rena implements the write path. Priya implements the read/query path and retention.

### 9.3 Marcus Lindgren -- AI / ML

**Owns:** ARGUS v2 (ML upgrade), model serving, eval suite, scenario modeling engine.

**Deliverables:**

1. **ARGUS v2 -- ML Entity Resolution** (R7):
   - Replace the rule-based `similarity()` function (which has the `.includes()` bug, R13) with embedding-based cosine similarity
   - Model: `all-MiniLM-L6-v2` via ONNX Runtime (384-dim embeddings)
   - Entity resolution pipeline:
     1. Encode incoming entity name -> 384-dim vector
     2. Query pgvector for top-5 nearest neighbors (cosine distance < 0.3)
     3. If match found: link to existing entity, update aliases
     4. If no match: create new entity, store embedding
   - Threat scoring: keep rule-based (works fine), add embedding-weighted severity

2. **Module implementations** (`modules/`):
   - Each module is a Python package with `main.py` entry point:
     ```
     modules/
       argus/main.py       -- Entity resolution + threat scoring (ML)
       babel/main.py       -- Arabic NLP (Farah implements, Marcus reviews)
       chatter/main.py     -- Sentiment + source reliability
       chronos/main.py     -- Temporal analysis (fix math.sqrt import, R13)
       ignite/main.py      -- Fire/thermal classification
       skyline/main.py     -- Weather intelligence
       scenario/main.py    -- Scenario modeling (replaces "prediction engine", R9)
     ```
   - All modules must:
     - Read JSON from stdin, write JSON to stdout
     - Include `data_source: "live" | "mock"` in output (R14)
     - Use specific exception handling, no bare `except:` (R17)
     - Exit 0 on success, 1 on failure (stderr for errors)

3. **Bug fixes** (R13):
   - `argus_module.py:26`: Replace `.includes()` with `in` operator
   - `chronos_module.py:57`: Add `import math` at top of file

4. **Eval suite** (`tests/eval/`):
   - Offline eval: entity resolution accuracy on labeled test set (target: >90% F1)
   - Online eval: compare ARGUS v1 vs v2 on same input, report precision/recall delta
   - Scenario modeling eval: verify scenario trees are well-formed

5. **Scenario Modeling Engine** (replaces "prediction engine", R9):
   - No predictions. Generates scenario trees with probability weights.
   - Input: set of incidents + entities + user parameters
   - Output: 3-5 scenarios (escalation, de-escalation, status_quo) with weighted branches
   - Stored in `scenario_models` table

**Interface contract -- Module stdin/stdout protocol:**

```
STDIN (JSON):
{
  "events": [ { "id": ..., "title": ..., ... } ],
  "config": {
    "dataSource": "live" | "mock",
    "country": "IR" | null,
    "limit": 50,
    "days": 7
  },
  "promptOverride": "Additional instruction text..." | null
}

STDOUT (JSON):
{
  "module": "argus",
  "version": "2.0.0",
  "dataSource": "live",
  "data": { ... },
  "durationMs": 342,
  "error": null
}

STDERR (on failure):
Human-readable error message. Exit code 1.
```

### 9.4 Carlos Medina -- Security & DevSecOps

**Owns:** Auth system, encryption, CSP, containerization, CI/CD, secrets management.

**Deliverables:**

1. **Authentication system** (`src/auth/`, R2):
   - `auth-controller.ts` -- Login, OIDC, refresh, logout, MFA endpoints
   - `jwt.ts` -- RS256 JWT issue/verify using `jose` library
   - `mfa.ts` -- TOTP generation/verification using `otpauth`
   - `oidc.ts` -- OIDC provider integration using `openid-client`
   - `middleware.ts` -- Express/Fastify middleware: verify JWT, attach user to request, check role
   - `rate-limiter.ts` -- Redis sliding window rate limiter per Section 5.8

2. **RBAC middleware:**
   ```typescript
   // Usage in route handlers:
   router.get('/incidents', auth('viewer'), getIncidents);
   router.post('/incidents', auth('analyst'), createIncident);
   router.get('/admin/users', auth('admin'), listUsers);
   ```

3. **CSP implementation** (R8): Apply Content-Security-Policy header per Section 6.4.

4. **Secrets management** (R1, R10):
   - Remove hardcoded credentials from `api/aircraft.js` (OpenSky email/password on lines 16-17)
   - Vault integration: `src/config/vault.ts`
   - Development: `dotenv-vault` with encrypted `.env.vault`
   - CI/CD: GitHub Actions secrets -> Vault agent sidecar in K8s
   - Make repository private (R10)

5. **Docker images** (`docker/`):
   - `docker/api/Dockerfile` -- Multi-stage build, Node 20 Alpine, non-root user
   - `docker/frontend/Dockerfile` -- Multi-stage build, Next.js standalone output
   - `docker/ingestion/Dockerfile` -- Node 20 + Python 3.11 (for modules), ONNX models baked in
   - All images: read-only root filesystem, no shell in production, distroless where possible

6. **CI/CD pipeline** (`.github/workflows/`):
   - `ci.yml`: lint + type-check + unit tests + integration tests on every PR
   - `cd.yml`: build images -> push to registry -> deploy to K8s on merge to main
   - `security.yml`: Trivy image scan, npm audit, OWASP ZAP baseline scan (R11 prep)
   - Replace the 12hr RSS cron (`update-feeds.yml`) with the new ingestion pipeline

7. **Kubernetes manifests** (`k8s/`):
   - Helm chart or Kustomize overlays for dev/staging/prod
   - NetworkPolicies per Section 8.2
   - PodSecurityStandards: restricted
   - Horizontal Pod Autoscaler for API and ingestion

### 9.5 Farah Al-Rashidi -- Arabic NLP

**Owns:** BABEL module (new), Arabic entity extraction, transliteration.

**Deliverables:**

1. **BABEL module** (`modules/babel/`, R6):
   - `main.py` -- Entry point (stdin/stdout protocol per Marcus contract)
   - `detector.ts` -- Arabic text detection (Unicode range 0x0600-0x06FF)
   - `entity_extractor.py` -- Named entity recognition for Arabic text using CAMeL Tools
   - `transliterator.py` -- Arabic-to-Latin transliteration (Buckwalter + custom rules)
   - `aligner.py` -- Arabic/English entity alignment (same entity, different scripts)

2. **Entity extraction pipeline:**
   ```
   Input text (Arabic) -> Morphological analysis (CAMeL)
                       -> NER (PER, ORG, LOC, GPE tags)
                       -> Transliteration to Latin
                       -> Alignment with English entities from ARGUS
                       -> Output: entities with both ar/en canonical names
   ```

3. **Integration with ARGUS:**
   - BABEL runs BEFORE ARGUS in the pipeline
   - BABEL outputs entities with `canonical_name_ar` field
   - ARGUS receives BABEL entities and merges with its own entity resolution
   - Shared embedding space: Arabic entities get embeddings via multilingual model

4. **Output format:**
   ```json
   {
     "module": "babel",
     "version": "1.0.0",
     "dataSource": "live",
     "data": {
       "detectedLanguage": "ar",
       "entities": [
         {
           "text_ar": "...",
           "text_en": "Islamic Revolutionary Guard Corps",
           "type": "organization",
           "confidence": 0.92,
           "transliteration": "al-Haras al-Thawri al-Islami"
         }
       ],
       "translatedTitle": "...",
       "translatedDescription": "..."
     }
   }
   ```

5. **Test data:** Curated set of 200+ Arabic news headlines with gold-standard entity annotations for eval.

### 9.6 Suki Parekh -- Frontend

**Owns:** Next.js application, all UI components, map, real-time views.

**Deliverables:**

1. **Next.js 14 application** (`frontend/`):
   - App Router with route groups:
     ```
     app/
       (auth)/login/page.tsx
       (auth)/mfa/page.tsx
       (dashboard)/page.tsx            -- Main dashboard (live feed + map)
       (dashboard)/incidents/page.tsx   -- Incident list/search
       (dashboard)/incidents/[id]/page.tsx
       (dashboard)/entities/page.tsx
       (dashboard)/entities/[id]/page.tsx
       (dashboard)/modules/page.tsx     -- Module panel overview
       (dashboard)/modules/[name]/page.tsx
       (dashboard)/scenario/page.tsx    -- Scenario modeling (renamed from "prediction", R9)
       (admin)/users/page.tsx
       (admin)/audit/page.tsx
       layout.tsx
     ```

2. **Component library** (`frontend/components/`):
   - `IncidentCard.tsx` -- Incident display with severity badge, source, time
   - `IncidentList.tsx` -- Paginated, filterable incident list
   - `EntityGraph.tsx` -- D3-based entity relationship visualization
   - `ThreatMap.tsx` -- Mapbox GL JS map with incident markers, thermal overlay, airspace
   - `ModulePanel.tsx` -- Generic module output display
   - `SentimentChart.tsx` -- CHATTER sentiment distribution
   - `TimeSeriesChart.tsx` -- CHRONOS temporal analysis (Recharts)
   - `ThermalOverlay.tsx` -- IGNITE fire detection map layer
   - `WeatherPanel.tsx` -- SKYLINE weather intelligence
   - `ScenarioBuilder.tsx` -- Scenario modeling UI (NOT "prediction", R9)
   - `AuditLog.tsx` -- Admin audit log viewer
   - `UserManagement.tsx` -- Admin user CRUD

3. **API client** (`frontend/lib/api.ts`):
   ```typescript
   // All API calls go through this client
   // Handles: auth header injection, token refresh, error handling
   const api = {
     get: <T>(path: string, params?: Record<string, string>) => Promise<ApiResponse<T>>,
     post: <T>(path: string, body: unknown) => Promise<ApiResponse<T>>,
     patch: <T>(path: string, body: unknown) => Promise<ApiResponse<T>>,
   };
   ```

4. **WebSocket client** (`frontend/lib/ws.ts`):
   ```typescript
   // Connects to wss://api.gulfwatch.io/ws?token=<accessToken>
   // Auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s)
   // Dispatches events to React context for real-time updates
   const ws = {
     connect: (token: string) => void,
     subscribe: (channels: string[]) => void,
     onMessage: (handler: (msg: WsMessage) => void) => void,
     disconnect: () => void,
   };
   ```

5. **Arabic RTL support:**
   - CSS `direction: rtl` applied when Arabic content detected
   - All text components support bidirectional rendering
   - Arabic font stack: Noto Sans Arabic

6. **Removals per R9:**
   - Remove `public/js/predictor.js` (prediction engine -> replaced by Scenario Modeling UI)
   - Remove missile defense dashboard (if it exists in ragnarok.js or elsewhere)
   - Remove user report auto-suppression UI (the 5-report auto-hide mechanism)

**Interface contract -- API response types:**

```typescript
// Suki consumes these types. Rena/Ines produce them.

interface Incident {
  id: number;
  externalId?: string;
  title: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  source: string;
  sourceUrl?: string;
  sourceReliability?: number;
  publishedAt: string;     // ISO 8601
  ingestedAt: string;
  incidentType: 'military' | 'political' | 'economic' | 'humanitarian' | 'security' | 'diplomatic' | 'environmental' | 'cyber';
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'confirmed' | 'unconfirmed' | 'disputed' | 'retracted';
  locationName?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  countries: string[];
  credibility?: number;
  sentimentScore?: number;
  sentimentLabel?: string;
  dataSource: 'live' | 'mock';
}

interface Entity {
  id: string;
  canonicalName: string;
  canonicalNameAr?: string;
  entityType: 'nation' | 'organization' | 'person' | 'military_unit' | 'weapon_system' | 'facility' | 'vessel' | 'aircraft';
  countryCode?: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface WsMessage {
  type: 'incident.new' | 'incident.update' | 'alert.threat' | 'module.update' | 'thermal.new' | 'heartbeat';
  data: unknown;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    dataSource: 'live' | 'mock';
  };
}
```

### 9.7 Ines Kowalski -- Integration

**Owns:** API gateway, route definitions, cross-layer workflows, health checks.

**Deliverables:**

1. **Fastify API server** (`src/server.ts`):
   - Plugin registration: CORS, helmet, rate limiter, auth middleware
   - Route registration: all endpoints from Section 5
   - Error handling: structured error responses with correlation IDs
   - Request logging: structured JSON logs (pino)
   - Graceful shutdown: drain connections, close DB pool, close Redis

2. **Route definitions** (`src/routes/`):
   - `incidents.ts` -- All incident endpoints
   - `entities.ts` -- All entity endpoints
   - `modules.ts` -- All module endpoints (proxies to module execution)
   - `auth.ts` -- Auth endpoints (delegates to Carlos's auth controller)
   - `admin.ts` -- Admin endpoints
   - `health.ts` -- `/health` (liveness), `/ready` (readiness: DB + Redis check)

3. **API Gateway middleware stack** (applied in order):
   ```
   1. Request ID (X-Request-Id header, UUID)
   2. Request logging (method, path, duration, status)
   3. CORS (Section 6.7)
   4. Security headers (Section 6.6)
   5. CSP (Section 6.4)
   6. Rate limiter (Section 5.8)
   7. Auth (JWT verification, role extraction)
   8. Route handler
   9. Audit log write (for state-changing operations)
   10. Response serialization (camelCase)
   ```

4. **Cross-layer workflows:**
   - Incident creation: validate -> persist -> enrich (trigger pipeline) -> notify (WebSocket)
   - User export: auth check -> query -> format (CSV/JSON) -> audit log -> stream response
   - Module refresh: trigger re-run of specific module -> persist -> notify

5. **OpenAPI specification** (`docs/openapi.yaml`):
   - Full OpenAPI 3.1 spec for all endpoints
   - Used for: documentation, client generation, request validation

6. **Integration test suite** (`tests/integration/`):
   - Test every endpoint with valid and invalid auth
   - Test rate limiting behavior
   - Test WebSocket connection lifecycle
   - Test end-to-end: ingest event -> see it via API -> see it via WebSocket

---

## 10. Review Addendum Traceability

This section maps each of the 17 review addendum requirements to the architecture component that addresses it.

| ID | Requirement | Owner | Where Addressed |
|----|------------|-------|----------------|
| R1 | Remove hardcoded credentials | Carlos | Section 6.5 (Secrets Management). `api/aircraft.js` lines 16-17 deleted. OpenSky creds moved to Vault. |
| R2 | Auth + RBAC (OAuth 2.0/OIDC, MFA, 3 roles) | Carlos | Section 6.1-6.2 (Auth Flow, RBAC). `users` table with role column. |
| R3 | Encrypted PostgreSQL + TimescaleDB | Rena | Section 4 (full schema). TimescaleDB hypertables for incidents, thermal, audit. AES-256 at rest. |
| R4 | Immutable audit logging | Priya | Section 4 (`audit_log` table, REVOKE DELETE/UPDATE). Section 9.2 (Priya contract). |
| R5 | Sub-5-minute data freshness | Rena | Section 7.2 (Data Freshness). Pollers at 2-5 min intervals. WebSocket push. |
| R6 | Arabic NLP | Farah | Section 9.5 (BABEL module). CAMeL Tools entity extraction + transliteration. |
| R7 | ML upgrade (ARGUS) | Marcus | Section 9.3 (ARGUS v2). all-MiniLM-L6-v2 embeddings, pgvector cosine similarity. |
| R8 | CSP + rate limiting | Carlos/Ines | Section 6.4 (CSP policy). Section 5.8 (rate limits). |
| R9 | Rename prediction engine, remove missile dashboard, remove auto-suppression | Marcus/Suki | Section 9.3 (Scenario Modeling Engine). Section 9.6 (removals). `predictor.js` deleted. |
| R10 | Private repo + secrets management | Carlos | Section 6.5. Repository set to private. All secrets in Vault. |
| R11 | Penetration test prep | Priya/Carlos | Section 9.2 (security test suite). Section 9.4 (OWASP ZAP in CI). |
| R12 | Sovereign deployment architecture | Carlos | Section 8.3 (Air-Gap Deployment). Offline ingestion, bundled models, self-signed TLS. |
| R13 | Fix runtime bugs (ARGUS .includes(), CHRONOS math.sqrt) | Marcus | Section 9.3 (Bug fixes). Both bugs fixed in module rewrites. |
| R14 | data_source live/mock indicator | All | Every table has `data_source` column. Every API response includes `dataSource`. Every module output includes it. |
| R15 | Audit all 20 modules for real capability | Marcus/All | Section 9.3 (module audit). 5 existing modules assessed; 1 new (BABEL); "prediction engine" replaced by Scenario Modeling. |
| R16 | Move API writes to persistent store | Rena | Section 4 (all data in PostgreSQL). `api/report.py` file-write pattern replaced with DB INSERT. |
| R17 | Replace bare except clauses | All | Coding standard: no bare `except:`. All modules rewritten with specific exception types. Enforced by linting (ruff B001). |

---

## Appendix A: File Structure (Target)

```
gulfwatch/
  src/
    server.ts                  -- Fastify server entry point (Ines)
    config/
      vault.ts                 -- Vault client (Carlos)
      env.ts                   -- Environment config validation (Carlos)
    auth/
      auth-controller.ts       -- Auth endpoints (Carlos)
      jwt.ts                   -- JWT issue/verify (Carlos)
      mfa.ts                   -- MFA TOTP (Carlos)
      oidc.ts                  -- OIDC providers (Carlos)
      middleware.ts            -- Auth middleware (Carlos)
      rate-limiter.ts          -- Rate limiting (Carlos)
    db/
      pool.ts                  -- PostgreSQL connection pool (Rena)
      incidents.ts             -- Incident CRUD (Rena)
      entities.ts              -- Entity CRUD (Rena)
      thermal.ts               -- Thermal CRUD (Rena)
      module-outputs.ts        -- Module output CRUD (Rena)
      audit.ts                 -- Audit log read/write (Rena + Priya)
      users.ts                 -- User CRUD (Carlos)
      sessions.ts              -- Session CRUD (Carlos)
    ingestion/
      poller-rss.ts            -- RSS poller (Rena)
      poller-opensky.ts        -- OpenSky poller (Rena)
      poller-firms.ts          -- NASA FIRMS poller (Rena)
      poller-twitter.ts        -- Twitter poller (Rena)
      normalizer.ts            -- Raw event normalization (Rena)
      deduplicator.ts          -- Deduplication (Rena)
      pipeline.ts              -- Enrichment orchestrator (Rena)
    ws/
      ws-server.ts             -- WebSocket server (Rena)
      ws-broadcaster.ts        -- Redis -> WS fan-out (Rena)
    routes/
      incidents.ts             -- Incident routes (Ines)
      entities.ts              -- Entity routes (Ines)
      modules.ts               -- Module routes (Ines)
      auth.ts                  -- Auth routes (Ines)
      admin.ts                 -- Admin routes (Ines)
      health.ts                -- Health/readiness (Ines)
  modules/
    argus/main.py              -- Entity resolution + threat (Marcus)
    babel/main.py              -- Arabic NLP (Farah)
    chatter/main.py            -- Sentiment + trends (Marcus)
    chronos/main.py            -- Temporal analysis (Marcus)
    ignite/main.py             -- Thermal detection (Marcus)
    skyline/main.py            -- Weather intelligence (Marcus)
    scenario/main.py           -- Scenario modeling (Marcus)
  frontend/
    app/                       -- Next.js App Router (Suki)
    components/                -- React components (Suki)
    lib/
      api.ts                   -- API client (Suki)
      ws.ts                    -- WebSocket client (Suki)
      auth.ts                  -- Frontend auth state (Suki)
  db/
    init.sql                   -- Database initialization (Rena)
    migrations/                -- Incremental migrations (Rena)
  docker/
    api/Dockerfile             -- API image (Carlos)
    frontend/Dockerfile        -- Frontend image (Carlos)
    ingestion/Dockerfile       -- Ingestion + Python modules (Carlos)
  k8s/                         -- Kubernetes manifests (Carlos)
  monitoring/                  -- Prometheus + Grafana configs (Priya)
  tests/
    unit/                      -- Unit tests (All)
    integration/               -- API integration tests (Ines + Priya)
    e2e/                       -- Playwright E2E tests (Priya)
    load/                      -- k6 load tests (Priya)
    chaos/                     -- Chaos engineering (Priya)
    security/                  -- Security test vectors (Priya)
    eval/                      -- ML eval suite (Marcus)
  docs/
    openapi.yaml               -- API specification (Ines)
  docker-compose.yml           -- Development environment (Carlos)
```

---

## Appendix B: Top 5 Risks

| # | Risk | Mitigation | Owner |
|---|------|-----------|-------|
| 1 | Arabic NLP model accuracy insufficient for intelligence-grade entity extraction | Curate 500+ gold-standard annotations; accept >85% F1 for v1, iterate | Farah + Marcus |
| 2 | Air-gap deployment breaks OAuth/OIDC (no external IdP reachable) | Support local username/password auth as fallback; OIDC optional per deployment | Carlos |
| 3 | TimescaleDB hypertable performance degrades at >100M rows with complex joins | Continuous aggregates for dashboard queries; materialized views for entity counts; partition by month | Rena + Priya |
| 4 | WebSocket fan-out bottleneck at scale (>10K concurrent connections) | Redis pub/sub with multiple subscriber instances; consider Socket.io with Redis adapter; horizontal scaling behind LB | Rena |
| 5 | ONNX model inference latency adds >500ms per event to ingestion pipeline | Batch embedding computation (32 events per batch); async pipeline (don't block ingestion on ML) | Marcus |

---

*This document is the source of truth for Gulf Watch v2 engineering. All engineers build to these contracts. Deviations require Viktor's approval and a documented ADR (Architecture Decision Record).*
