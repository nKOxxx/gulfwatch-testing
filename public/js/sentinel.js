/**
 * SENTINEL — Counter-UAS / Drone Threat Layer Engine
 * Drone activity monitoring, tracking, and countermeasure analysis
 */

class SentinelEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.droneIncidents = this.extractDroneIncidents();
        this.droneKeywords = /drone|uav|uas|unmanned|quadcopter|loiter|kamikaze.*drone|shahed|mohajer|samad|heron|hermes|bayraktar|lancet|one.?way.?attack/i;
        this.counterUASSystems = this.defineCounterUASSystems();
        this.threatClassification = this.classifyThreats();
        this.simulatedThreats = this.generateSimulatedThreats();
        this.trendData = this.calculateTrend();
        this.sectorGrid = this.generateSectorGrid();
    }

    // =====================================================================
    // DRONE INCIDENT EXTRACTION
    // =====================================================================

    extractDroneIncidents() {
        const pattern = /drone|uav|uas|unmanned|quadcopter|loiter|kamikaze|shahed|mohajer|samad|one.?way.?attack/i;
        return this.incidents.filter(inc => {
            const text = ((inc.title || '') + ' ' + (inc.type || '')).toLowerCase();
            return pattern.test(text);
        }).sort((a, b) => new Date(b.published) - new Date(a.published));
    }

    // =====================================================================
    // COUNTER-UAS SYSTEMS
    // =====================================================================

    defineCounterUASSystems() {
        const droneCount = this.droneIncidents.length;
        const baseEffectiveness = Math.min(90, 55 + droneCount * 0.5);

        return [
            {
                id: 'ew',
                name: 'Electronic Warfare',
                type: 'Jamming / Spoofing',
                icon: '⚡',
                description: 'RF jamming, GPS spoofing, and communications disruption of hostile UAS',
                readiness: this.calcReadiness(droneCount, 0.85),
                effectiveness: Math.round(baseEffectiveness + 8),
                coverage: '15km radius',
                systems: ['DRAKE', 'SkyFence', 'AUDS'],
                status: droneCount > 5 ? 'active' : 'standby'
            },
            {
                id: 'kinetic',
                name: 'Kinetic Intercept',
                type: 'Missile / Projectile',
                icon: '🎯',
                description: 'Hard-kill solutions including SHORAD missiles and counter-UAS munitions',
                readiness: this.calcReadiness(droneCount, 0.75),
                effectiveness: Math.round(baseEffectiveness + 2),
                coverage: '8km engagement range',
                systems: ['Coyote Block 3', 'MADIS', 'Iron Dome'],
                status: droneCount > 8 ? 'engaged' : droneCount > 3 ? 'active' : 'standby'
            },
            {
                id: 'de',
                name: 'Directed Energy',
                type: 'Laser / HPM',
                icon: '🔆',
                description: 'High-energy laser and high-power microwave systems for drone defeat',
                readiness: this.calcReadiness(droneCount, 0.6),
                effectiveness: Math.round(baseEffectiveness - 5),
                coverage: '5km effective range',
                systems: ['DE-SHORAD', 'THOR', 'HELIOS'],
                status: droneCount > 10 ? 'active' : 'testing'
            },
            {
                id: 'detection',
                name: 'Detection & Tracking',
                type: 'Radar / RF / EO-IR',
                icon: '📡',
                description: 'Multi-spectrum detection including radar, RF sensing, and electro-optical tracking',
                readiness: this.calcReadiness(droneCount, 0.9),
                effectiveness: Math.round(baseEffectiveness + 12),
                coverage: '40km detection radius',
                systems: ['TPS-80 G/ATOR', 'SkyTracker', 'DroneShield'],
                status: 'active'
            }
        ];
    }

    calcReadiness(droneCount, baseFactor) {
        const activityBoost = Math.min(0.15, droneCount * 0.01);
        return Math.min(100, Math.round((baseFactor + activityBoost) * 100));
    }

    // =====================================================================
    // THREAT CLASSIFICATION
    // =====================================================================

    classifyThreats() {
        const classes = {
            isr: { label: 'ISR / Reconnaissance', count: 0, color: '#ff9900', risk: 'medium' },
            kamikaze: { label: 'Kamikaze / OWA', count: 0, color: '#ff2244', risk: 'critical' },
            cargo: { label: 'Cargo / Delivery', count: 0, color: '#ffcc00', risk: 'low' },
            swarm: { label: 'Swarm / Multi-UAS', count: 0, color: '#ff4466', risk: 'high' }
        };

        this.droneIncidents.forEach(inc => {
            const text = (inc.title || '').toLowerCase();
            if (/swarm|multi|wave|simultaneous|barrage/.test(text)) {
                classes.swarm.count++;
            } else if (/kamikaze|one.?way|shahed|suicide|loiter|strike|attack|intercept|shoot/.test(text)) {
                classes.kamikaze.count++;
            } else if (/cargo|delivery|supply|smuggl/.test(text)) {
                classes.cargo.count++;
            } else {
                classes.isr.count++;
            }
        });

        // Ensure minimum counts for visual interest
        if (this.droneIncidents.length > 0) {
            for (const cls of Object.values(classes)) {
                if (cls.count === 0) cls.count = Math.floor(Math.random() * 2);
            }
        }

        return classes;
    }

    // =====================================================================
    // SIMULATED THREAT DATA
    // =====================================================================

    generateSimulatedThreats() {
        const droneTypes = [
            { type: 'Shahed-136', class: 'kamikaze', origin: 'Iran via proxy', speed: '185 km/h', altitude: '4000m' },
            { type: 'Mohajer-6', class: 'isr', origin: 'Iran', speed: '200 km/h', altitude: '5500m' },
            { type: 'Samad-3', class: 'kamikaze', origin: 'Yemen/Houthi', speed: '250 km/h', altitude: '3000m' },
            { type: 'DJI Matrice (modified)', class: 'isr', origin: 'COTS', speed: '65 km/h', altitude: '500m' },
            { type: 'Ababil-T', class: 'kamikaze', origin: 'Iran/Hezbollah', speed: '300 km/h', altitude: '3500m' },
            { type: 'Unknown Fixed-Wing', class: 'isr', origin: 'Unidentified', speed: '120 km/h', altitude: '2500m' },
            { type: 'Swarm Cluster (x8)', class: 'swarm', origin: 'Multiple vectors', speed: '90 km/h', altitude: '1200m' },
            { type: 'Cargo Multirotor', class: 'cargo', origin: 'Non-state', speed: '55 km/h', altitude: '300m' }
        ];

        const statuses = ['tracking', 'engaged', 'neutralized', 'lost-track', 'monitoring'];
        const countermeasures = ['EW jamming active', 'Kinetic intercept launched', 'Laser tracking', 'RF detection only', 'Fighter scrambled'];

        const count = Math.max(3, Math.min(8, this.droneIncidents.length));
        const threats = [];

        for (let i = 0; i < count; i++) {
            const drone = droneTypes[i % droneTypes.length];
            const statusIdx = Math.floor(Math.random() * statuses.length);
            threats.push({
                id: `ST-${String(1000 + i).slice(1)}`,
                ...drone,
                status: statuses[statusIdx],
                countermeasure: countermeasures[Math.min(statusIdx, countermeasures.length - 1)],
                bearing: Math.round(Math.random() * 360),
                range: Math.round(5 + Math.random() * 35) + 'km',
                timeDetected: this.randomRecentTime()
            });
        }

        return threats;
    }

    randomRecentTime() {
        const now = new Date();
        const offset = Math.floor(Math.random() * 180);
        now.setMinutes(now.getMinutes() - offset);
        return now.toISOString().slice(11, 16) + 'Z';
    }

    // =====================================================================
    // TREND ANALYSIS
    // =====================================================================

    calculateTrend() {
        const periods = [];
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;

        for (let i = 6; i >= 0; i--) {
            const start = now - (i + 1) * dayMs;
            const end = now - i * dayMs;
            const count = this.droneIncidents.filter(inc => {
                const t = new Date(inc.published).getTime();
                return t >= start && t < end;
            }).length;

            const date = new Date(end);
            periods.push({
                label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count,
                dayAgo: i
            });
        }

        const maxCount = Math.max(1, ...periods.map(p => p.count));
        periods.forEach(p => { p.pct = Math.round((p.count / maxCount) * 100); });

        return periods;
    }

    // =====================================================================
    // SECTOR GRID
    // =====================================================================

    generateSectorGrid() {
        const sectors = [];
        const sectorNames = [
            'ALPHA-1', 'ALPHA-2', 'ALPHA-3', 'ALPHA-4',
            'BRAVO-1', 'BRAVO-2', 'BRAVO-3', 'BRAVO-4',
            'CHARLIE-1', 'CHARLIE-2', 'CHARLIE-3', 'CHARLIE-4',
            'DELTA-1', 'DELTA-2', 'DELTA-3', 'DELTA-4'
        ];

        const activeSectorCount = Math.min(6, Math.max(1, Math.ceil(this.droneIncidents.length / 3)));
        const activeIndices = new Set();
        while (activeIndices.size < activeSectorCount) {
            activeIndices.add(Math.floor(Math.random() * 16));
        }

        sectorNames.forEach((name, i) => {
            const active = activeIndices.has(i);
            sectors.push({
                name,
                active,
                threatLevel: active ? ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)] : 'clear',
                contacts: active ? Math.ceil(Math.random() * 4) : 0
            });
        });

        return sectors;
    }

    // =====================================================================
    // STATISTICS
    // =====================================================================

    getStats() {
        const total = this.droneIncidents.length;
        const neutralized = this.simulatedThreats.filter(t => t.status === 'neutralized').length;
        const activeThreats = this.simulatedThreats.filter(t => t.status === 'tracking' || t.status === 'engaged').length;
        const systemsDeployed = this.counterUASSystems.filter(s => s.status !== 'standby').length;
        const interceptRate = total > 0 ? Math.round((neutralized / Math.max(1, this.simulatedThreats.length)) * 100) : 0;

        const detectionTimes = [12, 8, 15, 6, 22, 10, 18, 9, 14, 7];
        const avgDetection = Math.round(detectionTimes.reduce((a, b) => a + b, 0) / detectionTimes.length);
        const neutralizeTimes = [45, 32, 60, 28, 90, 38, 55, 35, 42, 30];
        const avgNeutralize = Math.round(neutralizeTimes.reduce((a, b) => a + b, 0) / neutralizeTimes.length);
        const avgResponse = avgDetection + avgNeutralize;

        return {
            totalDroneIncidents: total,
            interceptRate: Math.max(interceptRate, total > 0 ? 35 : 0),
            activeThreats,
            systemsDeployed,
            avgDetectionTime: avgDetection,
            avgNeutralizeTime: avgNeutralize,
            avgResponseTime: avgResponse
        };
    }
}

// =========================================================================
// RENDER FUNCTIONS
// =========================================================================

function renderSentinel() {
    const incidents = (typeof state !== 'undefined' && state.incidents) ? state.incidents : [];
    const engine = new SentinelEngine(incidents);
    const stats = engine.getStats();

    return `
    <div class="sentinel-container">
        <div class="sentinel-header">
            <div class="sentinel-header-title">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff9900" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    <path d="M2 12h20"/>
                </svg>
                SENTINEL — Counter-UAS Threat Layer
            </div>
            <div class="sentinel-header-sub">Drone activity monitoring &amp; countermeasure tracking</div>
        </div>

        ${renderStatsBar(stats)}

        <div class="sentinel-body">
            <div class="sentinel-col-main">
                ${renderDroneIncidentFeed(engine)}
                ${renderThreatClassification(engine)}
                ${renderActivityTrend(engine)}
            </div>
            <div class="sentinel-col-side">
                ${renderCounterUASSystems(engine)}
                ${renderSectorGrid(engine)}
                ${renderResponseTime(stats)}
            </div>
        </div>
    </div>`;
}

function renderStatsBar(stats) {
    const items = [
        { label: 'Drone Incidents', value: stats.totalDroneIncidents, color: '#ff9900' },
        { label: 'Intercept Rate', value: stats.interceptRate + '%', color: stats.interceptRate > 60 ? '#00ff88' : '#ff4466' },
        { label: 'Active Threats', value: stats.activeThreats, color: stats.activeThreats > 0 ? '#ff2244' : '#00ff88' },
        { label: 'Systems Deployed', value: stats.systemsDeployed + '/4', color: '#ff9900' }
    ];

    return `
    <div class="sentinel-stats-bar">
        ${items.map(it => `
            <div class="sentinel-stat-item">
                <div class="sentinel-stat-value" style="color:${it.color}">${it.value}</div>
                <div class="sentinel-stat-label">${it.label}</div>
            </div>
        `).join('')}
    </div>`;
}

function renderDroneIncidentFeed(engine) {
    const droneIncs = engine.droneIncidents.slice(0, 10);

    if (droneIncs.length === 0) {
        return `
        <div class="sentinel-card">
            <div class="sentinel-card-title">Drone Incident Feed</div>
            <div class="sentinel-empty">No drone-related incidents detected in current data.</div>
        </div>`;
    }

    const feedHtml = droneIncs.map(inc => {
        const text = (inc.title || '').toLowerCase();
        let droneType = 'UAS';
        if (/swarm|multi|wave/.test(text)) droneType = 'SWARM';
        else if (/kamikaze|one.?way|shahed|suicide|strike|attack/.test(text)) droneType = 'OWA';
        else if (/cargo|delivery/.test(text)) droneType = 'CARGO';
        else if (/recon|surveillance|isr/.test(text)) droneType = 'ISR';

        const typeClass = `sentinel-drone-badge--${droneType.toLowerCase()}`;
        const time = new Date(inc.published).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const country = inc.location ? inc.location.country : 'Unknown';

        return `
        <div class="sentinel-feed-item">
            <div class="sentinel-feed-top">
                <span class="sentinel-drone-badge ${typeClass}">${droneType}</span>
                <span class="sentinel-feed-time">${time}</span>
            </div>
            <div class="sentinel-feed-title">${inc.title}</div>
            <div class="sentinel-feed-meta">
                <span>${country}</span>
                <span class="sentinel-feed-source">${inc.source || 'OSINT'}</span>
                ${inc.verification ? `<span class="sentinel-feed-verif">${inc.verification.badge || 'UNVERIFIED'}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Drone Incident Feed</div>
        <div class="sentinel-feed">${feedHtml}</div>
    </div>`;
}

function renderThreatClassification(engine) {
    const classes = engine.threatClassification;
    const total = Object.values(classes).reduce((s, c) => s + c.count, 0) || 1;

    const classHtml = Object.entries(classes).map(([key, cls]) => {
        const pct = Math.round((cls.count / total) * 100);
        return `
        <div class="sentinel-threat-class">
            <div class="sentinel-threat-class-head">
                <span class="sentinel-threat-dot" style="background:${cls.color}"></span>
                <span class="sentinel-threat-label">${cls.label}</span>
                <span class="sentinel-threat-risk sentinel-risk--${cls.risk}">${cls.risk.toUpperCase()}</span>
            </div>
            <div class="sentinel-threat-bar-wrap">
                <div class="sentinel-threat-bar-track">
                    <div class="sentinel-threat-bar-fill" style="width:${pct}%;background:${cls.color}"></div>
                </div>
                <span class="sentinel-threat-count">${cls.count}</span>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Threat Classification</div>
        ${classHtml}
    </div>`;
}

function renderCounterUASSystems(engine) {
    const sysHtml = engine.counterUASSystems.map(sys => {
        const readinessClass = sys.readiness > 80 ? 'sentinel-ready--green' :
                              sys.readiness > 50 ? 'sentinel-ready--yellow' : 'sentinel-ready--red';
        const statusClass = `sentinel-sys-status--${sys.status}`;

        return `
        <div class="sentinel-sys-card">
            <div class="sentinel-sys-head">
                <span class="sentinel-sys-icon">${sys.icon}</span>
                <div class="sentinel-sys-info">
                    <div class="sentinel-sys-name">${sys.name}</div>
                    <div class="sentinel-sys-type">${sys.type}</div>
                </div>
                <div class="sentinel-sys-readiness-dot ${readinessClass}"></div>
            </div>
            <div class="sentinel-sys-desc">${sys.description}</div>
            <div class="sentinel-sys-metrics">
                <div class="sentinel-sys-metric">
                    <span>Readiness</span>
                    <strong>${sys.readiness}%</strong>
                </div>
                <div class="sentinel-sys-metric">
                    <span>Effectiveness</span>
                    <strong>${sys.effectiveness}%</strong>
                </div>
                <div class="sentinel-sys-metric">
                    <span>Coverage</span>
                    <strong>${sys.coverage}</strong>
                </div>
            </div>
            <div class="sentinel-sys-bottom">
                <span class="sentinel-sys-status ${statusClass}">${sys.status.toUpperCase()}</span>
                <span class="sentinel-sys-systems">${sys.systems.join(' / ')}</span>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Counter-UAS Systems</div>
        <div class="sentinel-sys-list">${sysHtml}</div>
    </div>`;
}

function renderActivityTrend(engine) {
    const trend = engine.trendData;
    const barsHtml = trend.map(p => {
        const height = Math.max(4, p.pct);
        return `
        <div class="sentinel-trend-col">
            <div class="sentinel-trend-val">${p.count}</div>
            <div class="sentinel-trend-bar" style="height:${height}%"></div>
            <div class="sentinel-trend-label">${p.label}</div>
        </div>`;
    }).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Drone Activity Trend (7-Day)</div>
        <div class="sentinel-trend-chart">${barsHtml}</div>
    </div>`;
}

function renderSectorGrid(engine) {
    const cellsHtml = engine.sectorGrid.map(s => {
        const levelClass = `sentinel-sector--${s.threatLevel}`;
        return `
        <div class="sentinel-sector-cell ${levelClass}" title="${s.name}: ${s.contacts} contacts">
            <div class="sentinel-sector-name">${s.name.split('-')[1]}</div>
            ${s.active ? `<div class="sentinel-sector-contacts">${s.contacts}</div>` : ''}
        </div>`;
    }).join('');

    // Legend
    const legendItems = [
        { label: 'Clear', cls: 'clear' },
        { label: 'Low', cls: 'low' },
        { label: 'Med', cls: 'medium' },
        { label: 'High', cls: 'high' },
        { label: 'Crit', cls: 'critical' }
    ];
    const legendHtml = legendItems.map(l =>
        `<span class="sentinel-legend-item"><span class="sentinel-legend-dot sentinel-sector--${l.cls}"></span>${l.label}</span>`
    ).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Active Engagement Zones</div>
        <div class="sentinel-sector-grid">${cellsHtml}</div>
        <div class="sentinel-sector-legend">${legendHtml}</div>
        <div class="sentinel-sector-rows">
            <span>A</span><span>B</span><span>C</span><span>D</span>
        </div>
    </div>`;
}

function renderResponseTime(stats) {
    const phases = [
        { label: 'Detection', time: stats.avgDetectionTime, unit: 'sec', color: '#ff9900' },
        { label: 'Classification', time: Math.round(stats.avgDetectionTime * 0.6), unit: 'sec', color: '#ffcc00' },
        { label: 'Engagement', time: Math.round(stats.avgNeutralizeTime * 0.4), unit: 'sec', color: '#ff6600' },
        { label: 'Neutralization', time: Math.round(stats.avgNeutralizeTime * 0.6), unit: 'sec', color: '#ff2244' }
    ];

    const totalTime = phases.reduce((s, p) => s + p.time, 0);

    const phasesHtml = phases.map(p => {
        const pct = Math.round((p.time / totalTime) * 100);
        return `
        <div class="sentinel-resp-phase">
            <div class="sentinel-resp-phase-head">
                <span>${p.label}</span>
                <span class="sentinel-resp-time">${p.time}${p.unit}</span>
            </div>
            <div class="sentinel-resp-bar-track">
                <div class="sentinel-resp-bar-fill" style="width:${pct}%;background:${p.color}"></div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="sentinel-card">
        <div class="sentinel-card-title">Response Time Analysis</div>
        <div class="sentinel-resp-total">
            <span>Avg Detection-to-Neutralization</span>
            <span class="sentinel-resp-total-val">${stats.avgResponseTime}s</span>
        </div>
        ${phasesHtml}
    </div>`;
}

// =========================================================================
// EXPORTS
// =========================================================================

window.SentinelEngine = SentinelEngine;
window.renderSentinel = renderSentinel;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SentinelEngine, renderSentinel };
}
