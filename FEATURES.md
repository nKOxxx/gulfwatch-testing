# Gulf Watch — Features

> Real-time geopolitical intelligence platform for the Middle East.
> Monitors security events across 48+ sources, tracking 212+ incidents with situational awareness, predictive analysis, and comprehensive analytics.

---

## Table of Contents

- [1. Real-Time Incident Feed](#1-real-time-incident-feed)
- [2. Circuit Breaker Deduplication](#2-circuit-breaker-deduplication)
- [3. Cross-Source Verification](#3-cross-source-verification)
- [4. Coordinate Extraction](#4-coordinate-extraction)
- [5. Interactive Map](#5-interactive-map)
- [6. Real-Time Tracking Layers](#6-real-time-tracking-layers)
- [7. Analytics Dashboard](#7-analytics-dashboard)
- [8. Scenario Prediction Engine](#8-scenario-prediction-engine)
- [9. RAGNAROK — OODA Loop Escalation Engine](#9-ragnarok--ooda-loop-escalation-engine)
- [10. Missile Defense Dashboard](#10-missile-defense-dashboard)
- [11. AI Intelligence Modules](#11-ai-intelligence-modules)
  - [11a. ARGUS — Entity Resolution & Threat Scoring](#11a-argus--entity-resolution--threat-scoring)
  - [11b. CHRONOS — Temporal Change Detection](#11b-chronos--temporal-change-detection)
  - [11c. SKYLINE — Weather Intelligence](#11c-skyline--weather-intelligence)
  - [11d. IGNITE — NASA FIRMS Heat Detection](#11d-ignite--nasa-firms-heat-detection)
  - [11e. CHATTER — Social Media & News Intelligence](#11e-chatter--social-media--news-intelligence)
- [12. Data Export](#12-data-export)
- [13. User Reporting System](#13-user-reporting-system)
- [14. Mobile Experience](#14-mobile-experience)
- [15. Navigation & Layout](#15-navigation--layout)
- [Implementation Status](#implementation-status)

---

## 1. Real-Time Incident Feed

The primary interface for monitoring security events across the Middle East.

- Displays 212+ tracked incidents as expandable detail cards
- Each card shows: country flag, severity indicator, timestamp, event type, confidence percentage, and source badges
- **Severity scoring** with four tiers: Critical, High, Medium, Low
- **Event classification** into categories: missile strikes, airstrikes, drone operations, naval incidents, cyber attacks, ground operations, explosions
- Government and keyword-based severity scoring
- New incidents animate in from the top with a 0.3s ease-out transition
- Cards highlight on hover with cyan border activation

---

## 2. Circuit Breaker Deduplication

Intelligent deduplication algorithm that prevents data bloat from multi-source monitoring.

- Processes 251 raw events down to 212 unique entries
- **Duplicate detection:** MD5 hash signature matching + textual similarity analysis
  - Items exceeding 85% similarity are flagged as duplicates
  - 80–85% similarity generates warnings for manual review
- **Recap filtering:** Identifies summary/roundup articles using characteristic phrases ("update," "recap," "roundup," "over the past," "death toll rises"). A recap score of 2+ triggers filtering
- **Incident classification:** Automatically categorizes events into 7 types
- 92% deduplication threshold

**File:** `scripts/` (integration with RSS pipeline)

---

## 3. Cross-Source Verification

Confidence scoring system that assesses incident reliability across multiple sources.

| Tier | Confidence | Description |
|------|-----------|-------------|
| Verified | 90–100% | Confirmed by multiple high-quality sources |
| Likely | 70–89% | Strong evidence from reliable sources |
| Partial | 50–69% | Limited corroboration |
| Unconfirmed | <50% | Single source or low-quality origin |

**Scoring formula:**
- Source Quality: 40%
- Cross-Verification: 35%
- Timeliness: 15%
- Detail Consistency: 10%

Source credibility scoring tracks reliability of each of the 48+ monitored sources including official government accounts and international news outlets.

---

## 4. Coordinate Extraction

Ensures every event is geolocated with five precision fallback levels:

1. **Extracted coordinates** — parsed directly from the source data
2. **City database matching** — matched against 50+ city entries across 15 countries
3. **Region centers** — fallback to region centroid
4. **Country centers** — fallback to country centroid
5. **Gulf region fallback** — default positioning when no other match is available

---

## 5. Interactive Map

Full-screen geospatial intelligence view built on Leaflet with dark CARTO tiles.

- 212 incident markers with severity-based coloring:
  - Red — Critical
  - Orange — High
  - Yellow — Medium
  - Green — Low
- **Freshness encoding:** pulsing glows for recent events, fading glows for older ones
- 12px diameter markers with white 2px borders; scale 1.2x on hover
- Interactive layers: events, airspace, ballistic trajectories, troop movements
- Timeline slider to filter events by time window
- Pinch-to-zoom support on mobile

---

## 6. Real-Time Tracking Layers

Live overlay layers on the interactive map:

| Layer | Data Source | Update Frequency |
|-------|-----------|-----------------|
| Aircraft | OpenSky API | 30 seconds |
| Satellites | CelesTrak TLE data | Orbital pass intervals |
| Maritime Vessels | AIS simulation | 20 seconds |

---

## 7. Analytics Dashboard

Six-chart grid providing strategic intelligence at a glance:

1. **Timeline** — 30-day incident trend line
2. **Country Heat Map** — incident density by country
3. **Finance Impact** — oil, gold, bitcoin, and gas price correlation with events
4. **Casualty Tracking** — reported casualties over time
5. **Source Reliability** — bar chart of source credibility scores
6. **Conflict Intensity** — event relationships and network connections

---

## 8. Scenario Prediction Engine

Rule-based modeling system trained on 14-day incident patterns.

- **Input:** Actor / Action / Target selections
- **Output:** Probability-based outcomes with:
  - Escalation alerts
  - Trend analysis
  - Multi-scenario probability distributions

---

## 9. RAGNAROK — OODA Loop Escalation Engine

Military-grade threat escalation timeline visualization modeling the OODA (Observe-Orient-Decide-Act) decision loop.

**What it models for each incident:**
- 4 sequential OODA phases with time estimates
- Actors/systems involved in each phase
- Key metrics per phase (confidence, time-to-action)
- Bottleneck analysis — where the loop slows down and why
- Actionable recommendations to close gaps

### Phase Duration Model (High-Severity)

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Observe | 2 min | Radar/IRST detection, initial tracking |
| Orient | 5 min | AI + intelligence cell classify threat type |
| Decide | 15 min | Commander approves response under ROE |
| Act | 5 min | Interceptors launched, forces deployed |

### Modifiers

- **Severity:** Critical/High = 1.0x (fastest), Medium = 3–4x, Low = 5–6x
- **Actor:** State military (Israel, US, UK, France) = 0.5x; non-state actors = 1.2x
- **Threat type:** Missile/ballistic = 0.3x (fastest); drone = 0.5x; attack/strike = 0.7x

### Bottleneck Detection

| Phase | Threshold | Severity |
|-------|-----------|----------|
| Decide | >30 min | High (>60 min = Critical) |
| Observe | >5 min | Medium |
| Act | >20 min | Medium (>30 min = High) |
| Orient | >20 min | Medium |

**Access:** Dedicated "Ragnarok" tab + per-incident button on every incident card (opens modal).

**Files:** `public/js/ragnarok.js`, `public/css/ragnarok.css`

---

## 10. Missile Defense Dashboard

Dedicated dashboard for missile defense intelligence:

- Detection rates by system
- Intercept success rates
- Per-country breakdowns
- Historical performance tracking

---

## 11. AI Intelligence Modules

Five Python-based AI modules that power the platform's analytical capabilities.

### 11a. ARGUS — Entity Resolution & Threat Scoring

The "all-seeing" intelligence layer that resolves entities and scores threats.

- **Entity canonicalization:** normalizes names for cross-source matching
- **Similarity scoring:** compares entity references across sources using Levenshtein-approximation matching
- **Threat scoring:** assigns risk levels to resolved entities based on incident patterns

**File:** `argus_module.py`

### 11b. CHRONOS — Temporal Change Detection

Time-series analysis engine for event patterns and thermal data.

- **Temporal aggregation:** groups events by hour, day, or week buckets
- **Change detection:** identifies spikes, trends, and anomalies in incident frequency
- **Pattern recognition:** flags emerging patterns across time windows

**File:** `chronos_module.py`

### 11c. SKYLINE — Weather Intelligence

Meteorological analysis layer for military operations planning.

- Covers 8 Gulf regions: Central Gulf, Northern Gulf, Gulf of Oman, Arabian Sea, Northern Red Sea, Southern Red Sea, Levant Coast, Mesopotamia
- Per-region weather data: temperature, wind, visibility, sea state
- Operational impact assessments for air, naval, and ground operations

**File:** `skyline_module.py`

### 11d. IGNITE — NASA FIRMS Heat Detection

Real-time fire and thermal anomaly detection using satellite data.

- Integrates with NASA FIRMS (Fire Information for Resource Management System) API
- **VIIRS I-Band** active fire detection for the Gulf bounding box (34°–60°E, 12°–35°N)
- Configurable time window (default: last 24 hours)
- Thermal anomaly classification and clustering

**File:** `ignite_module.py`

### 11e. CHATTER — Social Media & News Intelligence

Sentiment analysis and trend detection across social media and news sources.

- **Sentiment analysis:** classifies text as positive, negative, or neutral using keyword dictionaries
- **Critical word detection:** flags military/weapons terminology (nuclear, ballistic, missile, etc.)
- **Trend detection:** identifies emerging narratives and sentiment shifts

**File:** `chatter_module.py`

---

## 12. Data Export

Multi-format data export for integration with external tools:

| Format | Use Case |
|--------|----------|
| JSON | API integration, programmatic access |
| CSV | Spreadsheet analysis, data science |
| GeoJSON | GIS tools, mapping platforms |

Accessible via the "Data" tab with API endpoints, bulk export options, RSS feed URLs, and developer documentation.

---

## 13. User Reporting System

Community-driven verification workflow:

- Users can flag incidents as false information
- **Auto-hide threshold:** 5 reports automatically hide non-government sources
- Verification queue for disputed events
- Cross-source credibility assessments

---

## 14. Mobile Experience

Responsive design optimized for field use:

- Bottom navigation bar replaces top header
- Collapsible map preview above scrollable feed
- Filters triggered via bottom sheet modal
- Gestures: swipe-up feed expansion, tap-to-detail, pinch-to-zoom mapping

---

## 15. Navigation & Layout

Seven-tab navigation structure:

| Tab | Purpose |
|-----|---------|
| Monitor | Main dashboard — live incident feed + financial/tactical metrics |
| Map | Full-screen geospatial intelligence |
| Analysis | Six-chart analytics dashboard |
| Prediction | Scenario prediction engine |
| Missile Defense | Intercept tracking dashboard |
| Data | API endpoints, export, RSS feeds, developer docs |
| Reports | User reporting and verification workflow |

**Design system:** Deep navy backgrounds (#0a0e27), severity-coded colors, Inter font stack, 4px spacing grid, GPU-accelerated animations.

---

## Implementation Status

### Phase 1 — Complete

- 73-source RSS aggregation via GitHub Actions
- 92% threshold circuit breaker deduplication
- Cross-source verification badges (VERIFIED / LIKELY / PARTIAL)
- Government + keyword severity scoring
- Event type classification (missile, drone, airstrike, etc.)
- Leaflet map with dark CARTO tiles
- 50+ city coordinate extraction
- Finance panel with live oil and gold pricing
- Source credibility scoring
- RAGNAROK OODA loop engine
- AI modules (Argus, Chronos, Skyline, Ignite, Chatter)

### Phase 2 — In Progress

- AI summarization via GPT integration
- Historical timeline visualization
- Confidence scoring algorithm refinement

### Phase 3–4 — Future

- Ballistic trajectory visualization
- Troop movement monitoring
- Predictive analytics engine
- WebSocket real-time updates
- Multi-language support
- Premium API tier with authentication

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JS |
| Mapping | Leaflet.js + CARTO dark tiles |
| AI Modules | Python (Argus, Chronos, Skyline, Ignite, Chatter) |
| Data Pipeline | RSS aggregation, GitHub Actions, static JSON |
| Hosting | Vercel |
| Satellite Data | NASA FIRMS, CelesTrak, OpenSky API |
