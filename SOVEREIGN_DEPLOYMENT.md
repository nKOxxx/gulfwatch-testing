# Gulf Watch - Sovereign Deployment Architecture

## 1. UAE In-Country Deployment

### 1.1 Data Center Infrastructure

**Primary Site:** Khazna Data Centers (Abu Dhabi)
- Tier III+ certified facility
- UAE sovereign cloud zone
- Physical security: 24/7 manned, biometric access, mantrap entry
- Power: N+1 redundant UPS, dual utility feeds, on-site generators (48hr fuel)

**Secondary Site:** du/EITC Cloud (Dubai)
- Geo-redundant failover within UAE borders
- Connected via dedicated dark fiber (encrypted, physically inspectable route)
- Active-passive configuration with async replication

**Network Architecture:**
- Dedicated VLAN per classification tier
- No internet-routable addresses for SECRET-tier systems
- Network segmentation enforced at hardware level (physical switches, not VLANs alone)
- All east-west traffic inspected by IDS/IPS (Suricata with custom MENA rulesets)

### 1.2 Compute & Storage

| Component | Specification |
|-----------|--------------|
| Application servers | 8x bare-metal (no hypervisor for SECRET tier), 64-core, 512GB RAM |
| Database cluster | 3-node PostgreSQL with Patroni HA, NVMe storage |
| Redis cluster | 3-node sentinel, persistence to encrypted volumes |
| Object storage | MinIO cluster (S3-compatible), erasure-coded, on-premises |
| GPU nodes | 2x NVIDIA A100 for local ML inference (no cloud API calls) |

---

## 2. Air-Gap Operation

### 2.1 Data Diode Architecture

Ingest follows a hardware-enforced one-way data flow:

```
OSINT Sources (Internet)
        |
  [ Fetch Servers ] (DMZ, internet-facing)
        |
  [ Data Diode ] (hardware-enforced unidirectional)
        |
  [ Ingest Buffer ] (air-gapped side)
        |
  [ Gulf Watch Core ] (classified network)
```

**Data Diode Specifications:**
- Hardware: Owl Cyber Defense DualDiode or Waterfall Security unidirectional gateway
- Throughput: 1 Gbps sustained
- Protocol: Custom UDP-based transfer with forward error correction
- Content inspection: Schema validation on receiving side before database insert
- No TCP (no acknowledgments cross the boundary)

### 2.2 Offline Map Tiles

- Self-hosted OpenStreetMap tile server (OpenMapTiles stack)
- Pre-rendered vector tiles for MENA region (zoom levels 0-18)
- Storage: approximately 120 GB for full MENA coverage
- Satellite imagery: licensed Maxar/Planet tiles loaded via secure media
- Update cycle: monthly via verified, signed tile packages transferred through data diode
- Tile server: Martin (Rust-based) or TileServer GL for vector rendering

### 2.3 Bundled ML Models

All machine learning runs locally. No external API calls.

| Model | Purpose | Size | Runtime |
|-------|---------|------|---------|
| Multilingual NER (custom) | Entity extraction (Arabic, Farsi, English) | 1.2 GB | ONNX Runtime |
| Sentence Transformers (multilingual) | Semantic similarity for dedup | 800 MB | ONNX Runtime |
| Threat classifier (custom) | Severity scoring | 400 MB | ONNX Runtime |
| Geocoder (Pelias, offline) | Location resolution | 15 GB index | Elasticsearch |
| Translation (NLLB-200) | Cross-language processing | 2.4 GB | CTranslate2 |

Model updates delivered via signed packages on encrypted removable media, verified against published checksums before installation.

---

## 3. Encryption

### 3.1 At Rest

- **Algorithm:** AES-256-GCM for all stored data
- **Key management:** HSM-backed (Thales Luna or Entrust nShield)
- **Database:** PostgreSQL TDE (Transparent Data Encryption) with HSM-stored keys
- **File storage:** LUKS2 full-disk encryption on all volumes
- **Backup encryption:** Separate key hierarchy; backup keys escrowed in HSM with M-of-N recovery
- **Key rotation:** Automatic every 90 days; manual rotation capability for incident response

### 3.2 In Transit

- **External:** TLS 1.3 only (no fallback to 1.2)
- **Internal (service-to-service):** mTLS with short-lived certificates (24hr)
- **Certificate authority:** Private CA hosted on HSM, no external CA dependency
- **Certificate management:** Automated issuance via Vault PKI or CFSSL
- **Cipher suites:** TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256 only
- **API gateway:** Envoy proxy with mTLS termination and re-encryption

### 3.3 HSM Key Management

- Primary HSM: Thales Luna Network HSM 7 (FIPS 140-2 Level 3)
- Backup HSM: Cold standby at secondary site
- Key hierarchy: Master Key (HSM-resident, never exported) -> Data Encryption Keys -> Per-record keys
- Admin access: M-of-N quorum (3-of-5) with physical smart cards
- Audit: All HSM operations logged to tamper-evident log

---

## 4. Identity & Access Management

### 4.1 SAML 2.0 / ADFS Integration

- **IdP:** UAE government ADFS instance or compatible SAML 2.0 provider
- **SP metadata:** Gulf Watch registered as Service Provider with signed assertions
- **Attribute mapping:**

| SAML Attribute | Gulf Watch Field |
|---------------|-----------------|
| NameID | user.sub |
| emailAddress | user.email |
| memberOf (AD group) | user.role (mapped via group-to-role table) |
| clearanceLevel | user.max_classification |
| organizationalUnit | user.department |

- **Session lifetime:** 8 hours (configurable per classification tier)
- **Single Logout (SLO):** Supported via SAML SLO protocol
- **Fallback:** Local authentication (HSM-signed JWTs) when IdP unavailable

### 4.2 Multi-Factor Authentication

- SAML assertion must include MFA claim
- Supported second factors: FIDO2/WebAuthn hardware keys, TOTP
- SMS-based MFA explicitly prohibited for SECRET-tier access

---

## 5. Classification System

### 5.1 Marking Levels

| Level | Label | Color | Access |
|-------|-------|-------|--------|
| 0 | UNCLASSIFIED | Green | All authenticated users |
| 1 | RESTRICTED | Blue | Analyst role and above |
| 2 | CONFIDENTIAL | Yellow | Senior analyst with need-to-know |
| 3 | SECRET | Red | Designated personnel only, individual access list |

### 5.2 Classification Enforcement

- Every data record carries a `classification` field (immutable after creation, can only be upgraded)
- API responses filtered by user's `max_classification` level
- Exports include classification banner in header and footer
- UI renders classification banner at top and bottom of every page
- Cross-classification queries prohibited (no joins across tiers)
- Clipboard operations blocked for SECRET-tier content in the UI

### 5.3 Spillage Procedures

If classified data is found in an unauthorized location:

1. **Detect:** Automated classification scanner runs hourly on all tiers
2. **Contain:** Immediately isolate affected system(s) from network
3. **Report:** Auto-generate spillage report with: data description, classification level, exposure scope, timestamps
4. **Remediate:**
   - Cryptographic wipe of affected storage sectors (not just file deletion)
   - Revoke and reissue all credentials on affected system
   - Audit trail preserved for post-incident review
5. **Verify:** Independent verification that spillage is fully remediated
6. **Document:** Formal incident report filed with security officer

---

## 6. Data Retention

### 6.1 Retention Periods (Configurable)

| Classification | Default Retention | Minimum | Maximum |
|---------------|------------------|---------|---------|
| UNCLASSIFIED | 5 years | 1 year | Indefinite |
| RESTRICTED | 3 years | 1 year | 10 years |
| CONFIDENTIAL | 2 years | 6 months | 5 years |
| SECRET | 1 year | 3 months | 3 years |

### 6.2 Cryptographic Deletion

- **Method:** Key destruction (destroy DEK, data becomes unrecoverable)
- **Verification:** Post-deletion scan confirms data unreadable
- **Audit:** Deletion certificate generated with:
  - Hash of deleted data set
  - Key destruction confirmation from HSM
  - Timestamp and authorizing officer
  - Witness signature (for SECRET tier)
- **Physical media:** NIST SP 800-88 compliant sanitization for decommissioned drives

---

## 7. Role-Based Access Control (RBAC)

### 7.1 Role Structure

Roles mapped to UAE military/intelligence organizational structure:

| System Role | Rank Equivalent | Permissions |
|-------------|----------------|-------------|
| viewer | Junior Analyst / Lieutenant | Read UNCLASSIFIED and RESTRICTED; view dashboards |
| analyst | Analyst / Captain | Read up to CONFIDENTIAL; create incidents; run modules; export non-classified |
| senior_analyst | Senior Analyst / Major | Read up to SECRET; edit incidents; approve exports; manage entities |
| team_lead | Team Lead / Colonel | All analyst permissions; manage team members; configure modules |
| admin | System Admin / Director | Full system access; user management; audit logs; system configuration |
| auditor | Inspector / Auditor | Read-only access to all tiers including audit logs; no write operations |

### 7.2 Permission Matrix

| Action | viewer | analyst | senior_analyst | team_lead | admin | auditor |
|--------|--------|---------|---------------|-----------|-------|---------|
| View incidents (UNCLAS) | Y | Y | Y | Y | Y | Y |
| View incidents (SECRET) | - | - | Y | Y | Y | Y |
| Create incidents | - | Y | Y | Y | Y | - |
| Edit incidents | - | - | Y | Y | Y | - |
| Run analysis modules | - | Y | Y | Y | Y | - |
| Export data | - | Y | Y | Y | Y | - |
| Export SECRET data | - | - | Y | Y | Y | - |
| Manage users | - | - | - | Y | Y | - |
| View audit logs | - | - | - | Y | Y | Y |
| System configuration | - | - | - | - | Y | - |

---

## 8. Penetration Test Checklist

### 8.1 OWASP Top 10 (2021)

- [ ] A01: Broken Access Control - Verify RBAC enforcement at API and UI layer
- [ ] A02: Cryptographic Failures - Validate TLS config, key management, at-rest encryption
- [ ] A03: Injection - SQL injection, OS command injection, LDAP injection on all inputs
- [ ] A04: Insecure Design - Review threat model, data flow diagrams, trust boundaries
- [ ] A05: Security Misconfiguration - Default credentials, unnecessary services, error handling
- [ ] A06: Vulnerable Components - Dependency audit (npm audit, pip-audit, Trivy scan)
- [ ] A07: Authentication Failures - Brute force, credential stuffing, session fixation
- [ ] A08: Software and Data Integrity - Verify signed deployments, SBOM validation
- [ ] A09: Logging & Monitoring Failures - Verify audit completeness, alert coverage
- [ ] A10: SSRF - Server-side request forgery on all URL-accepting endpoints

### 8.2 API Security

- [ ] Authentication bypass on all endpoints
- [ ] Authorization escalation (horizontal and vertical)
- [ ] Rate limiting effectiveness under load
- [ ] Input validation on all query parameters and request bodies
- [ ] Response data leakage (verbose errors, stack traces, internal IDs)
- [ ] CORS misconfiguration
- [ ] HTTP method tampering
- [ ] Content-Type validation
- [ ] JWT manipulation (algorithm confusion, key injection, claim tampering)
- [ ] Pagination abuse (excessive limit values, cursor manipulation)

### 8.3 WebSocket Security

- [ ] Authentication on WS upgrade
- [ ] Message injection
- [ ] DoS via message flooding
- [ ] Cross-site WebSocket hijacking
- [ ] Subscription authorization (can user subscribe to channels above their clearance?)

### 8.4 Authentication Flow

- [ ] Password brute force protection
- [ ] Account lockout after failed attempts
- [ ] Refresh token rotation correctness
- [ ] Session fixation prevention
- [ ] Cookie security flags (HttpOnly, Secure, SameSite)
- [ ] SAML assertion replay protection
- [ ] Token revocation effectiveness
- [ ] MFA bypass attempts

### 8.5 Data Exfiltration Prevention

- [ ] Bulk export rate limiting
- [ ] Classification downgrade prevention
- [ ] Print/screenshot blocking for SECRET tier (DLP)
- [ ] USB/removable media policy enforcement
- [ ] DNS tunneling detection
- [ ] Covert channel analysis on data diode boundary
- [ ] Clipboard interception for classified content

---

## 9. Compliance Mapping

### 9.1 ISO 27001:2022

| Control | Gulf Watch Implementation |
|---------|-------------------------|
| A.5 (Organizational) | Security policies documented, reviewed quarterly |
| A.6 (People) | Role-based access, security clearance verification |
| A.7 (Physical) | Khazna/du facility controls, HSM physical security |
| A.8 (Technological) | Encryption, access control, logging, vulnerability management |
| A.8.11 (Data masking) | Classification-based field redaction in API responses |
| A.8.12 (Data leakage prevention) | DLP controls at network and endpoint level |
| A.8.16 (Monitoring) | Continuous monitoring via SIEM, anomaly detection |
| A.8.24 (Cryptography) | HSM key management, approved algorithms only |

### 9.2 UAE Information Assurance (IA) Standards

- Compliance with UAE National Electronic Security Authority (NESA) requirements
- IAS controls implemented per UAE Critical Infrastructure Protection policy
- Annual assessment by NESA-accredited auditor
- Incident reporting to UAE CERT within mandated timeframes

### 9.3 NIST SP 800-53 Rev. 5

| Control Family | Key Controls |
|---------------|-------------|
| AC (Access Control) | AC-2 Account Management, AC-3 Access Enforcement, AC-6 Least Privilege |
| AU (Audit) | AU-2 Event Logging, AU-6 Review/Analysis, AU-9 Protection of Audit Info |
| CA (Assessment) | CA-2 Control Assessments, CA-7 Continuous Monitoring |
| CM (Configuration) | CM-2 Baseline Configuration, CM-6 Configuration Settings |
| IA (Identification) | IA-2 MFA, IA-5 Authenticator Management, IA-8 Non-Org Users |
| IR (Incident Response) | IR-4 Incident Handling, IR-6 Incident Reporting |
| MP (Media Protection) | MP-5 Media Transport, MP-6 Media Sanitization |
| PE (Physical) | PE-3 Physical Access Control, PE-6 Monitoring Physical Access |
| SC (System & Comms) | SC-8 Transmission Confidentiality, SC-12 Crypto Key Mgmt, SC-13 Crypto Protection |
| SI (System Integrity) | SI-2 Flaw Remediation, SI-4 System Monitoring, SI-7 Software Integrity |

---

## 10. Disaster Recovery

### 10.1 Recovery Objectives

| Metric | Target |
|--------|--------|
| RPO (Recovery Point Objective) | 1 hour |
| RTO (Recovery Time Objective) | 4 hours |
| MTTR (Mean Time to Recovery) | 2 hours |

### 10.2 Replication Architecture

```
Khazna (Primary)                 du/EITC (Secondary)
+------------------+             +------------------+
| PostgreSQL       | --async-->  | PostgreSQL       |
| (Patroni HA)     |   repl     | (Standby)        |
| RPO: 1 hour      |            | Promoted on fail |
+------------------+             +------------------+
| Redis Sentinel   | --sync-->  | Redis Sentinel   |
| (3-node)         |            | (3-node)         |
+------------------+             +------------------+
| MinIO            | --async--> | MinIO            |
| (Erasure coded)  |   repl     | (Erasure coded)  |
+------------------+             +------------------+
```

### 10.3 Failover Procedure

1. **Detection:** Automated health checks every 30 seconds; alert after 3 consecutive failures
2. **Decision:** Auto-failover for database (Patroni); manual approval for full site failover
3. **Execution:**
   - DNS updated to point to secondary site (TTL: 60s)
   - PostgreSQL standby promoted to primary
   - Application servers at secondary activated
   - Data diode reconfigured to route to secondary ingest buffer
4. **Verification:** Automated smoke tests confirm all API endpoints operational
5. **Communication:** Status page updated; stakeholders notified via secure channel

### 10.4 Backup Strategy

| Data Type | Method | Frequency | Retention | Location |
|-----------|--------|-----------|-----------|----------|
| Database (full) | pg_dump + encryption | Daily | 90 days | Both sites + offline tape |
| Database (WAL) | Continuous archiving | Continuous | 7 days | Secondary site |
| Application config | Git + signed tags | On change | Indefinite | Both sites |
| Audit logs | Append-only + encryption | Continuous | 7 years | Both sites + offline |
| ML models | Versioned + signed | On update | 5 versions | Both sites |

### 10.5 DR Testing Schedule

- **Tabletop exercise:** Quarterly
- **Partial failover test:** Semi-annually (database failover, single service recovery)
- **Full site failover test:** Annually
- **Backup restoration test:** Monthly (random data set verified against checksums)
