# Gulf Watch 🌊

**Real-time geopolitical intelligence platform for the Middle East.**

🌐 **Live Demo**: https://gulfwatch-testing.vercel.app

---

## 🎯 What is Gulf Watch?

A regional intelligence dashboard monitoring security events across the Middle East. Think **Bloomberg Terminal for geopolitical risk** - designed for analysts, journalists, and decision-makers who need real-time intelligence.

**Inspired by:** [WorldMonitor](https://www.worldmonitor.app/)

---

## ✨ Complete Feature Set (25+ Features)

### 🚨 Intelligence Core

#### 1. Real-Time Incident Feed
- **212+ tracked incidents** from 48+ sources
- Auto-refresh every 60 seconds
- Cross-source verification (VERIFIED/LIKELY/PARTIAL/UNCONFIRMED badges)
- Severity scoring (Critical/High/Medium/Low)
- Event type classification (Missile, Drone, Airstrike, Security, Alert)
- **NEW:** Click cards to expand with full details
- **NEW:** Action buttons (🔗 Source, 🌐 Translate, 🚩 Report False Claims)
- **NEW:** Coordinates display on every incident card

#### 2. Circuit Breaker Algorithm 🛡️
Intelligent deduplication ensuring you see unique events only.

**Filters:**
- ✅ Duplicate events (same incident from Reuters, BBC, Al Jazeera = 1 entry)
- ✅ Historical recaps ("Weekly Roundup", "Death toll rises..." blocked)
- ✅ Near-duplicates (92% similarity threshold)

**Stats:**
- 251 events processed → 212 unique (39 duplicates filtered)
- 1 recap blocked
- 187 unique signatures

#### 3. Cross-Source Verification ✅
Multi-source confidence scoring:

| Badge | Confidence | Meaning |
|-------|------------|---------|
| 🟣 **Verified** | 90-100% | Multiple independent sources confirm |
| 🔵 **Likely** | 70-89% | Two sources agree OR official + news |
| 🟡 **Partial** | 50-69% | Single source OR minor discrepancies |
| ⚪ **Unconfirmed** | <50% | Single unverified source |

**Scoring:**
- Source Quality (40%): Official (50pts), Major news (40pts), Regional (30pts)
- Cross-Verification (35%): 3+ sources = 35pts
- Timeliness (15%)
- Detail Consistency (10%)

#### 4. Coordinate Extractor 🗺️
**Every event has coordinates - NO EXCEPTIONS.**

**Precision Levels:**
1. **Extracted from text** - Exact coordinates mentioned
2. **City database** - 50+ cities (Tehran, Dubai, Riyadh, etc.)
3. **Region centers** - Strait of Hormuz, Persian Gulf, Red Sea
4. **Country centers** - 15 countries
5. **Ultimate fallback** - Gulf region center (29.0, 48.0)

---

### 🗺️ Map & Geography

#### 5. Interactive 2D Map (Leaflet)
- **NEW:** Dark theme CARTO tiles
- 212 incident markers with severity colors
- Click markers for popups
- Zoom/pan controls
- Auto-center on incident selection

#### 6. Real-Time Tracking Layers ✈️🛰️🚢
**NEW:** Live tracking of aircraft, satellites, and maritime vessels.

| Layer | Data Source | Update Rate | Visual |
|-------|-------------|-------------|--------|
| ✈️ **Aircraft** | OpenSky API (authenticated) | 30 seconds | Bright red circles |
| 🛰️ **Satellites** | CelesTrak TLE | 30 seconds | Gold pulsing dots |
| 🚢 **Maritime** | AIS (simulated) | 20 seconds | Orange squares |

**Features:**
- Toggle layers on/off (properly clears intervals when hidden)
- Click for details (callsign, altitude, speed)
- CORS-safe API proxy for authenticated OpenSky access
- Bright red markers for maximum visibility
- Gulf region coverage (lat 12-35°, lon 34-60°)

#### 7. Airspace Tracking
- NOTAMs layer (toggle)
- Layer controls UI

---

### 📊 Analysis Dashboard

#### 8. Six Intelligence Charts
**NEW:** Complete analytics suite.

| Chart | Data | Visualization |
|-------|------|---------------|
| **Timeline** | Incidents/day (30 days) | Bar chart |
| **Country Heat Map** | Incident density by country | Choropleth |
| **Finance Impact** | Oil, Gold, Bitcoin, Gas | Sparklines |
| **Casualty Tracking** | Military vs Civilian | Stacked bars |
| **Source Reliability** | Trust scores by source type | Horizontal bars |
| **Conflict Intensity** | Severity distribution | Pie/bar chart |

#### 9. Finance & Commodities Panel 💰
- Brent Crude Oil
- Gold (safe haven indicator)
- Bitcoin
- Natural Gas
- Auto-refresh every 5 minutes

#### 10. Casualty Counter
- Total casualties
- Military vs Civilian breakdown
- Injured count
- Real-time updates

---

### 🎯 Prediction Engine

#### 11. Scenario Prediction (Phase 1 - Enhanced)
**NEW:** Rule-based scenario modeling trained on last 14 days of data.

**How it works:**
1. Select Actor (Iran, Israel, Houthis, etc.)
2. Select Action (Missile strike, Drone attack, etc.)
3. Select Target (Country/region)
4. **Output:** Probability outcomes based on recent 14-day incident patterns

**New Features:**
- **14-Day Focus:** Predictions based on most recent data only
- **Trend Analysis:** Detects escalation patterns (early vs late period comparison)
- **Escalation Alerts:** Warns if activity is trending up X% in last 3 days
- **Most Active Actor:** Identifies dominant actor from recent incidents
- **Most Targeted Country:** Shows which country faces most activity
- **Daily Frequency Tracking:** Monitors incident velocity over time

**Prediction Types:**
- **Escalation Alert:** Activity up X% in recent period
- **Regional Response:** Likelihood of spillover to neighboring countries
- **Follow-up Events:** Probable next event types based on patterns
- **Default Predictions:** Military, diplomatic, market impact scenarios

**Example:**
> Actor: Houthis → Action: Missile Launch → Target: Saudi Arabia  
> **Escalation Alert:** Activity up 35% in last 3 days  
> **Prediction:** 75% probability of retaliatory strikes, 60% oil price volatility  
> **Confidence:** Based on 47 recent incidents

---

### 🛡️ Missile Defense

#### 12. Missile Defense Dashboard
**NEW:** Comprehensive missile defense analytics.

**Metrics:**
- Detection rate
- Intercept success rate
- Impact count
- Per-country breakdown (UAE, Saudi, Israel, etc.)

**Visualizations:**
- Success rate gauge
- Country comparison table
- Recent intercepts list

---

### 💾 Data & Exports

#### 13. Data Export
**NEW:** Download data in multiple formats.

- **JSON** (`/incidents.json`) - Machine-readable
- **CSV** - Spreadsheet analysis
- **GeoJSON** - Mapping tools (QGIS, ArcGIS)

#### 14. API Access
```
GET /incidents.json
GET /prices.json
```

#### 15. llms.txt 🤖
Machine-readable documentation for AI crawlers at `/llms.txt`.

---

### 📱 UI/UX Features

#### 16. Seven Tab Navigation
- **Monitor** - Incident feed
- **Map** - 2D map with tracking layers
- **Analysis** - 6 charts
- **Prediction** - Scenario engine
- **Missile Defense** - Defense dashboard
- **Data** - Exports & API
- **Reports** - User reports & verification stats

#### 17. Filter System
- Country filter (UAE, Saudi, Israel, Iran, etc.)
- Severity filter (Critical/High/Medium/Low)
- Event type filter (Missile, Drone, Airstrike, etc.)
- Time range (24h, 7d, 30d)
- Search functionality

#### 18. Dark Tactical Interface
- OLED-optimized dark theme
- High contrast severity colors
- Operations-room styling
- Command center aesthetic

#### 19. Mobile-First Responsive
- Works on desktop, tablet, mobile
- Touch-friendly controls
- Bottom tabs on mobile

---

### 🛠️ Data Quality & Trust

#### 20. Severity Scoring
Automatic priority ranking:
- **Critical (90-130):** Mass casualties, government source + keywords
- **High (60-89):** Casualties reported, multiple sources
- **Medium (30-59):** Property damage, single source
- **Low (0-29):** Minor incidents, recaps

#### 21. Source Reliability
- 🏛️ **Official** - Government/military (100% credibility)
- 📰 **News** - Established outlets (70-95% credibility)
- 💬 **Social** - Telegram/social (40-60% credibility)

#### 22. User Reports
**NEW:** Report false/misleading information.
- 5 reports = auto-hide (non-government sources)
- Report reasons: False info, Outdated, Wrong location, Duplicate
- Modal form with details field

#### 23. Translate Feature
**NEW:** Google Translate integration.
- One-click translate incident titles
- Auto-detects Arabic/English

---

### 📡 Data Sources (48+)

**Tier 1 - Official:**
- UAE Ministry of Interior (@moiuae)
- Saudi Civil Defense (@SaudiDCD)
- IDF (@IDF)
- Qatar Ministry of Interior (@MOI_QatarEn)

**Tier 2 - International News:**
- Reuters, BBC, Associated Press
- Al Jazeera, France24, DW
- Times of Israel, Jerusalem Post
- The National (UAE), Arab News

**Tier 3 - Regional/Specialized:**
- Defense News, Jane's Defence
- Al-Monitor, Anadolu Agency
- Morocco World News, AMN News

**Coverage:**
🇦🇪 UAE | 🇸🇦 Saudi Arabia | 🇶🇦 Qatar | 🇧🇭 Bahrain | 🇰🇼 Kuwait | 🇴🇲 Oman | 🇮🇱 Israel | 🇵🇸 Palestine | 🇱🇧 Lebanon | 🇸🇾 Syria | 🇮🇶 Iraq | 🇯🇴 Jordan | 🇪🇬 Egypt | 🇾🇪 Yemen | 🇮🇷 Iran

---

## 🏗️ Architecture

```
Data Collection (48 sources)
    ↓
Circuit Breaker (Deduplication)
    ↓
Coordinate Extractor (100% geocoding)
    ↓
Verification Engine (Confidence scoring)
    ↓
API & UI (Vercel + GitHub Actions)
```

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JS
- Maps: Leaflet.js + CARTO Dark Matter
- Charts: Custom CSS/SVG
- Data: Static JSON (GitHub Actions)
- Hosting: Vercel (CDN)

---

## 📊 Stats

| Metric | Value |
|--------|-------|
| Total Incidents | 212 |
| Sources | 48+ |
| Countries Covered | 15 |
| Cities in DB | 50+ |
| API Endpoints | 3 (including /api/aircraft) |
| Charts | 6 |
| Tracking Layers | 3 |
| Prediction Training Window | 14 days |
| Pattern Recognition | Actor→Action→Target chains |

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/nKOxxx/gulfwatch-testing.git
cd gulfwatch-testing/public

# Serve locally
python -m http.server 8000

# Open http://localhost:8000
```

---

## 🔗 Links

- **Live Demo**: https://gulfwatch-testing.vercel.app
- **Production**: (Coming soon)
- **Issues**: https://github.com/nKOxxx/gulfwatch-testing/issues

---

## 📄 License

MIT

---

Built with ⚔️ by Ares for Nikola
Last Updated: 2026-03-16
