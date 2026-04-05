-- ============================================================
-- Gulf Watch v2 -- PostgreSQL + TimescaleDB Schema
-- Author: Rena Oduya, Backend Core
-- Date: 2026-04-05
--
-- Execution order matters: extensions -> roles -> tables ->
-- hypertables -> indexes -> RLS policies -> revocations
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;           -- trigram similarity search
CREATE EXTENSION IF NOT EXISTS vector;            -- pgvector for ARGUS embeddings
CREATE EXTENSION IF NOT EXISTS postgis;           -- geospatial queries

-- ============================================================
-- 2. DATABASE ROLES
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gw_app') THEN
        CREATE ROLE gw_app LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gw_readonly') THEN
        CREATE ROLE gw_readonly LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gw_admin') THEN
        CREATE ROLE gw_admin LOGIN;
    END IF;
END
$$;

-- ============================================================
-- 3. ENUM TYPES (explicit types for cleaner constraints)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('viewer', 'analyst', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_type') THEN
        CREATE TYPE incident_type AS ENUM (
            'military', 'political', 'economic', 'humanitarian',
            'security', 'diplomatic', 'environmental', 'cyber'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'severity_level') THEN
        CREATE TYPE severity_level AS ENUM ('critical', 'high', 'medium', 'low');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        CREATE TYPE verification_status AS ENUM ('confirmed', 'unconfirmed', 'disputed', 'retracted');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_source_type') THEN
        CREATE TYPE data_source_type AS ENUM ('live', 'mock');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_type') THEN
        CREATE TYPE entity_type AS ENUM (
            'nation', 'organization', 'person', 'military_unit',
            'weapon_system', 'facility', 'vessel', 'aircraft'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'module_name') THEN
        CREATE TYPE module_name AS ENUM (
            'argus', 'babel', 'chatter', 'chronos',
            'ignite', 'skyline', 'scenario_modeling'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scenario_type') THEN
        CREATE TYPE scenario_type AS ENUM ('escalation', 'de-escalation', 'status_quo', 'custom');
    END IF;
END
$$;

-- ============================================================
-- 4. USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT,                       -- bcrypt cost 12; NULL if OIDC-only
    mfa_secret      TEXT,                       -- TOTP secret, AES-256-GCM encrypted at app layer
    mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
    role            user_role NOT NULL DEFAULT 'viewer',
    status          user_status NOT NULL DEFAULT 'active',
    oidc_provider   TEXT,                       -- 'google', 'azure', 'custom'
    oidc_subject    TEXT,                       -- provider subject id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    UNIQUE (oidc_provider, oidc_subject)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status) WHERE status != 'active';

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   TEXT NOT NULL UNIQUE,       -- SHA-256 hashed
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ                 -- NULL = active
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (refresh_token);

-- ============================================================
-- 5. INCIDENTS (TimescaleDB hypertable)
-- ============================================================

CREATE TABLE IF NOT EXISTS incidents (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    external_id     TEXT,                       -- original source ID (RSS guid, etc.)
    title           TEXT NOT NULL,
    title_ar        TEXT,                       -- Arabic title (BABEL output)
    description     TEXT,
    description_ar  TEXT,
    source          TEXT NOT NULL,              -- 'al_jazeera', 'reuters', etc.
    source_url      TEXT,
    source_reliability REAL,                   -- 0.0-1.0
    published_at    TIMESTAMPTZ NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    incident_type   incident_type NOT NULL,
    severity        severity_level NOT NULL DEFAULT 'medium',
    status          verification_status NOT NULL DEFAULT 'unconfirmed',
    location_name   TEXT,
    country_code    CHAR(2),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    countries       TEXT[] NOT NULL DEFAULT '{}',
    credibility     INTEGER CHECK (credibility BETWEEN 0 AND 100),
    sentiment_score REAL,                      -- -100 to +100
    sentiment_label TEXT,
    data_source     data_source_type NOT NULL DEFAULT 'live',
    raw_payload     JSONB,
    PRIMARY KEY (id, published_at)
);

-- Convert to TimescaleDB hypertable partitioned on published_at.
-- The IF NOT EXISTS guard is handled by catching the error in migration.
SELECT create_hypertable('incidents', 'published_at',
    migrate_data => true,
    if_not_exists => true
);

CREATE INDEX IF NOT EXISTS idx_incidents_country
    ON incidents (country_code, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity
    ON incidents (severity, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_type
    ON incidents (incident_type, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_external
    ON incidents (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_source
    ON incidents (source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_countries_gin
    ON incidents USING GIN (countries);
CREATE INDEX IF NOT EXISTS idx_incidents_fts
    ON incidents USING GIN (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
    );
CREATE INDEX IF NOT EXISTS idx_incidents_data_source
    ON incidents (data_source);

-- ============================================================
-- 6. ENTITIES (ARGUS output)
-- ============================================================

CREATE TABLE IF NOT EXISTS entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name  TEXT NOT NULL,
    canonical_name_ar TEXT,
    entity_type     entity_type NOT NULL,
    country_code    CHAR(2),
    aliases         TEXT[] NOT NULL DEFAULT '{}',
    metadata        JSONB NOT NULL DEFAULT '{}',
    embedding       VECTOR(384),               -- MiniLM-L6 embedding
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entities_type
    ON entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm
    ON entities USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_country
    ON entities (country_code) WHERE country_code IS NOT NULL;
-- IVFFlat index for vector similarity; requires data to exist first.
-- Created conditionally in a later migration after initial seed.
-- CREATE INDEX idx_entities_embedding ON entities
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- 7. INCIDENT <-> ENTITY JUNCTION
-- ============================================================

CREATE TABLE IF NOT EXISTS incident_entities (
    incident_id     BIGINT NOT NULL,
    incident_time   TIMESTAMPTZ NOT NULL,      -- needed for hypertable FK
    entity_id       UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    role            TEXT,                       -- 'actor', 'target', 'location', 'mentioned'
    confidence      REAL NOT NULL DEFAULT 1.0
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    PRIMARY KEY (incident_id, incident_time, entity_id),
    FOREIGN KEY (incident_id, incident_time)
        REFERENCES incidents(id, published_at) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incident_entities_entity
    ON incident_entities (entity_id);

-- ============================================================
-- 8. MODULE OUTPUTS
-- ============================================================

CREATE TABLE IF NOT EXISTS module_outputs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_name     module_name NOT NULL,
    run_id          UUID NOT NULL,             -- groups outputs from same pipeline run
    input_hash      TEXT NOT NULL,             -- SHA-256 of input for dedup
    output_data     JSONB NOT NULL,
    data_source     data_source_type NOT NULL DEFAULT 'live',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms     INTEGER,
    error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_module_outputs_module
    ON module_outputs (module_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_outputs_run
    ON module_outputs (run_id);
CREATE INDEX IF NOT EXISTS idx_module_outputs_hash
    ON module_outputs (input_hash);

-- ============================================================
-- 9. THERMAL DETECTIONS (IGNITE, TimescaleDB hypertable)
-- ============================================================

CREATE TABLE IF NOT EXISTS thermal_detections (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    detected_at     TIMESTAMPTZ NOT NULL,
    satellite       TEXT NOT NULL,              -- 'VIIRS-NPP', 'MODIS-Aqua'
    fire_radiative_power REAL,
    brightness      REAL,
    confidence      TEXT,
    fire_type       TEXT,                      -- 'industrial_large', 'wildfire', etc.
    risk_level      TEXT,
    region          TEXT,
    data_source     data_source_type NOT NULL DEFAULT 'live',
    PRIMARY KEY (id, detected_at)
);

SELECT create_hypertable('thermal_detections', 'detected_at',
    migrate_data => true,
    if_not_exists => true
);

CREATE INDEX IF NOT EXISTS idx_thermal_geo
    ON thermal_detections
    USING GIST (ST_MakePoint(longitude, latitude));
CREATE INDEX IF NOT EXISTS idx_thermal_satellite
    ON thermal_detections (satellite, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_thermal_data_source
    ON thermal_detections (data_source);

-- ============================================================
-- 10. AUDIT LOG (append-only, Priya owns read, Rena owns write)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID REFERENCES users(id),  -- NULL for system actions
    action          TEXT NOT NULL,               -- 'login', 'ingest', 'view_incident', etc.
    resource_type   TEXT,                        -- 'incident', 'entity', 'user'
    resource_id     TEXT,
    ip_address      INET,
    user_agent      TEXT,
    details         JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, timestamp)
);

SELECT create_hypertable('audit_log', 'timestamp',
    migrate_data => true,
    if_not_exists => true
);

CREATE INDEX IF NOT EXISTS idx_audit_user
    ON audit_log (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action
    ON audit_log (action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
    ON audit_log (resource_type, resource_id, timestamp DESC);

-- ============================================================
-- 11. PROMPT OVERRIDES (improvement loop)
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_overrides (
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

CREATE INDEX IF NOT EXISTS idx_overrides_active
    ON prompt_overrides (module_name) WHERE active = true;

-- ============================================================
-- 12. IMPROVEMENT RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS improvement_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iteration           INTEGER NOT NULL,
    module_modified     TEXT NOT NULL,
    override_id         UUID REFERENCES prompt_overrides(id),
    pass_rate_before    REAL NOT NULL,
    pass_rate_after     REAL NOT NULL,
    cost_before         REAL,
    cost_after          REAL,
    kept                BOOLEAN NOT NULL,
    reason              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. SCENARIO MODELS
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    model_type      scenario_type NOT NULL,
    input_data      JSONB NOT NULL,
    output_data     JSONB NOT NULL,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. SCHEMA MIGRATIONS TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version         TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum        TEXT NOT NULL              -- SHA-256 of the SQL file
);

-- ============================================================
-- 15. ROW-LEVEL SECURITY POLICIES
-- ============================================================

-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Users: viewers see only their own record; analysts/admins see all
CREATE POLICY users_self_read ON users
    FOR SELECT TO gw_app
    USING (
        id = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_user_role', true) IN ('admin', 'analyst')
    );

CREATE POLICY users_admin_write ON users
    FOR ALL TO gw_app
    USING (current_setting('app.current_user_role', true) = 'admin')
    WITH CHECK (current_setting('app.current_user_role', true) = 'admin');

-- Sessions: users see only their own
CREATE POLICY sessions_own ON sessions
    FOR ALL TO gw_app
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Incidents: all authenticated users can read; analysts/admins can write
CREATE POLICY incidents_read ON incidents
    FOR SELECT TO gw_app
    USING (true);

CREATE POLICY incidents_write ON incidents
    FOR INSERT TO gw_app
    WITH CHECK (
        current_setting('app.current_user_role', true) IN ('admin', 'analyst')
    );

CREATE POLICY incidents_update ON incidents
    FOR UPDATE TO gw_app
    USING (current_setting('app.current_user_role', true) IN ('admin', 'analyst'))
    WITH CHECK (current_setting('app.current_user_role', true) IN ('admin', 'analyst'));

-- Audit log: only admins can read; nobody deletes or updates
CREATE POLICY audit_admin_read ON audit_log
    FOR SELECT TO gw_app
    USING (current_setting('app.current_user_role', true) = 'admin');

-- Allow system inserts into audit log (no user context check)
CREATE POLICY audit_insert ON audit_log
    FOR INSERT TO gw_app
    WITH CHECK (true);

-- ============================================================
-- 16. GRANT PERMISSIONS
-- ============================================================

-- gw_app: the application service account
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO gw_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gw_app;

-- gw_readonly: dashboards and analytics
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gw_readonly;

-- gw_admin: schema migrations only
GRANT ALL ON ALL TABLES IN SCHEMA public TO gw_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gw_admin;

-- ============================================================
-- 17. AUDIT LOG IMMUTABILITY (R4)
-- Critical: revoke DELETE and UPDATE on audit_log for app roles
-- ============================================================

REVOKE DELETE, UPDATE ON audit_log FROM gw_app;
REVOKE DELETE, UPDATE ON audit_log FROM gw_readonly;

-- ============================================================
-- 18. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 19. DATA RETENTION POLICIES (TimescaleDB)
-- Keep raw incidents 2 years, thermal 6 months, audit 1 year in hot
-- ============================================================

SELECT add_retention_policy('thermal_detections', INTERVAL '6 months',
    if_not_exists => true);
-- Audit log: 1 year hot; archive job handled externally
-- Incidents: no auto-drop; compress instead
SELECT add_compression_policy('incidents', INTERVAL '30 days',
    if_not_exists => true);
SELECT add_compression_policy('thermal_detections', INTERVAL '7 days',
    if_not_exists => true);
SELECT add_compression_policy('audit_log', INTERVAL '30 days',
    if_not_exists => true);

COMMIT;
