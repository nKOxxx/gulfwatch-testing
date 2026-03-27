/**
 * PRISM — Multi-INT Fusion Dashboard Engine
 * Fuses SIGINT, HUMINT, GEOINT, OSINT, FININT into unified intelligence picture
 */

class PrismEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.intSources = ['SIGINT', 'HUMINT', 'GEOINT', 'OSINT', 'FININT'];
        this.intConfig = {
            SIGINT: { icon: '⦿', label: 'Signals Intelligence', color: '#00d4ff', keywords: ['missile', 'air_defense', 'radar', 'electronic', 'communications', 'intercept'] },
            HUMINT: { icon: '⧖', label: 'Human Intelligence', color: '#b44dff', keywords: ['political', 'diplomatic', 'negotiation', 'official', 'statement', 'government', 'cabinet'] },
            GEOINT: { icon: '◉', label: 'Geospatial Intelligence', color: '#00ff88', keywords: ['satellite', 'drone', 'uav', 'imagery', 'surveillance', 'movement', 'deployment'] },
            OSINT: { icon: '◈', label: 'Open Source Intelligence', color: '#ff8800', keywords: ['media', 'report', 'security', 'alert', 'news', 'social', 'broadcast'] },
            FININT: { icon: '◆', label: 'Financial Intelligence', color: '#ffd700', keywords: ['sanctions', 'trade', 'economic', 'financial', 'funding', 'smuggling', 'oil'] }
        };
        this.categorized = this.categorizeIncidents();
        this.metrics = this.calculateMetrics();
        this.correlations = this.findCorrelations();
        this.gaps = this.identifyGaps();
        this.confidenceScore = this.calculateOverallConfidence();
    }

    // =========================================================================
    // INCIDENT CATEGORIZATION
    // =========================================================================

    categorizeIncidents() {
        const buckets = {};
        this.intSources.forEach(s => { buckets[s] = []; });

        this.incidents.forEach(inc => {
            const type = (inc.type || '').toLowerCase();
            const title = (inc.title || '').toLowerCase();
            const combined = type + ' ' + title;
            const assigned = new Set();

            // Primary mapping by type
            if (/missile|air_defense|ballistic|radar/.test(type)) assigned.add('SIGINT');
            if (/political|diplomatic/.test(type)) assigned.add('HUMINT');
            if (/drone|satellite|uav/.test(type)) assigned.add('GEOINT');
            if (/security|alert|media|report|explosion|attack/.test(type)) assigned.add('OSINT');
            if (/sanctions|trade|economic|financial/.test(type)) assigned.add('FININT');

            // Secondary mapping by title keywords
            if (/intercept|signal|radar|electronic|missile|air.defense|ballistic|launch/.test(combined)) assigned.add('SIGINT');
            if (/official|diplomat|minister|cabinet|negotiat|political|ambassador|envoy|warn|leader/.test(combined)) assigned.add('HUMINT');
            if (/satellite|drone|uav|imagery|aerial|movement|deploy|troop|position|border/.test(combined)) assigned.add('GEOINT');
            if (/report|media|claim|video|footage|social|news|confirm|source/.test(combined)) assigned.add('OSINT');
            if (/sanction|trade|oil|fund|financ|smug|weapon.shipment|embargo|economic/.test(combined)) assigned.add('FININT');

            // Default to OSINT if nothing matched
            if (assigned.size === 0) assigned.add('OSINT');

            assigned.forEach(src => {
                buckets[src].push(inc);
            });
        });

        return buckets;
    }

    // =========================================================================
    // METRICS CALCULATION
    // =========================================================================

    calculateMetrics() {
        const now = Date.now();
        const metrics = {};

        this.intSources.forEach(src => {
            const items = this.categorized[src];
            const count = items.length;

            // Reliability score based on verification scores
            const avgVerification = count > 0
                ? items.reduce((sum, i) => sum + (i.verification?.score || 40), 0) / count
                : 0;
            const reliability = Math.min(98, Math.round(avgVerification * 1.1 + (count > 5 ? 10 : 0)));

            // Freshness: % of items from last 12 hours
            const recentCutoff = now - 12 * 3600 * 1000;
            const recentCount = items.filter(i => new Date(i.published).getTime() > recentCutoff).length;
            const freshness = count > 0 ? Math.round((recentCount / count) * 100) : 0;

            // Coverage: unique countries
            const countries = new Set(items.map(i => i.location?.country).filter(Boolean));

            // Top recent item
            const sorted = [...items].sort((a, b) => new Date(b.published) - new Date(a.published));

            metrics[src] = {
                count,
                reliability,
                freshness,
                coverageAreas: [...countries],
                coverageCount: countries.size,
                topRecent: sorted[0] || null,
                recentItems: sorted.slice(0, 3)
            };
        });

        return metrics;
    }

    // =========================================================================
    // CORRELATION ENGINE
    // =========================================================================

    findCorrelations() {
        const correlations = [];
        const incidentMap = new Map();

        // Map each incident to its INT sources
        this.incidents.forEach(inc => {
            const sources = [];
            this.intSources.forEach(src => {
                if (this.categorized[src].some(i => i.id === inc.id)) {
                    sources.push(src);
                }
            });
            incidentMap.set(inc.id, sources);
        });

        // Find incidents with multi-INT convergence
        this.incidents.forEach(inc => {
            const sources = incidentMap.get(inc.id) || [];
            if (sources.length >= 2) {
                correlations.push({
                    incident: inc,
                    sources,
                    convergenceScore: Math.min(100, sources.length * 25 + (inc.verification?.score || 30)),
                    fusedConfidence: sources.length >= 3 ? 'HIGH' : 'MODERATE'
                });
            }
        });

        // Also find geographic correlations: different incidents in same country within 24h
        const byCountry = {};
        this.incidents.forEach(inc => {
            const country = inc.location?.country || 'Unknown';
            if (!byCountry[country]) byCountry[country] = [];
            byCountry[country].push(inc);
        });

        Object.entries(byCountry).forEach(([country, items]) => {
            if (items.length < 3) return;
            const sources = new Set();
            items.forEach(inc => {
                const s = incidentMap.get(inc.id) || [];
                s.forEach(src => sources.add(src));
            });
            if (sources.size >= 3) {
                const existing = correlations.find(c => c.incident.location?.country === country && c.clusterType);
                if (!existing) {
                    correlations.push({
                        incident: { title: `Multi-INT cluster: ${country}`, location: { country }, published: new Date().toISOString() },
                        sources: [...sources],
                        convergenceScore: Math.min(100, sources.size * 20 + items.length * 3),
                        fusedConfidence: sources.size >= 4 ? 'HIGH' : 'MODERATE',
                        clusterType: true,
                        clusterSize: items.length
                    });
                }
            }
        });

        return correlations.sort((a, b) => b.convergenceScore - a.convergenceScore).slice(0, 12);
    }

    // =========================================================================
    // COLLECTION GAPS
    // =========================================================================

    identifyGaps() {
        const gaps = [];
        const allCountries = new Set(this.incidents.map(i => i.location?.country).filter(Boolean));

        // Check each INT source for thin coverage
        this.intSources.forEach(src => {
            const m = this.metrics[src];
            if (m.count < 3) {
                gaps.push({
                    type: 'LOW_VOLUME',
                    source: src,
                    severity: m.count === 0 ? 'critical' : 'warning',
                    description: `${src} collection volume critically low (${m.count} items)`,
                    recommendation: `Increase ${this.intConfig[src].label} collection assets`
                });
            }
            if (m.freshness < 30 && m.count > 0) {
                gaps.push({
                    type: 'STALE',
                    source: src,
                    severity: 'warning',
                    description: `${src} data freshness degraded (${m.freshness}% recent)`,
                    recommendation: `Prioritize real-time ${src} feeds`
                });
            }
        });

        // Geographic gaps: countries with only one INT source
        allCountries.forEach(country => {
            const sourcesPresent = this.intSources.filter(src =>
                this.categorized[src].some(i => i.location?.country === country)
            );
            if (sourcesPresent.length === 1) {
                gaps.push({
                    type: 'SINGLE_SOURCE',
                    source: sourcesPresent[0],
                    severity: 'warning',
                    description: `${country}: single-source coverage (${sourcesPresent[0]} only)`,
                    recommendation: `Task additional INT assets to ${country}`
                });
            }
        });

        return gaps.sort((a, b) => (a.severity === 'critical' ? -1 : 1));
    }

    // =========================================================================
    // OVERALL CONFIDENCE
    // =========================================================================

    calculateOverallConfidence() {
        const sourceScores = this.intSources.map(src => {
            const m = this.metrics[src];
            return (m.reliability * 0.4) + (m.freshness * 0.3) + (Math.min(m.count, 30) / 30 * 100 * 0.3);
        });
        const avg = sourceScores.reduce((a, b) => a + b, 0) / sourceScores.length;
        const correlationBonus = Math.min(15, this.correlations.filter(c => c.fusedConfidence === 'HIGH').length * 3);
        const gapPenalty = Math.min(20, this.gaps.filter(g => g.severity === 'critical').length * 10 + this.gaps.filter(g => g.severity === 'warning').length * 3);
        return Math.max(10, Math.min(98, Math.round(avg + correlationBonus - gapPenalty)));
    }

    // =========================================================================
    // TIMELINE DATA
    // =========================================================================

    getTimelineData() {
        const hours = [];
        const now = Date.now();
        for (let h = 23; h >= 0; h--) {
            const start = now - (h + 1) * 3600000;
            const end = now - h * 3600000;
            const hourData = { label: `${h}h ago` };
            this.intSources.forEach(src => {
                hourData[src] = this.categorized[src].filter(i => {
                    const t = new Date(i.published).getTime();
                    return t >= start && t < end;
                }).length;
            });
            hours.push(hourData);
        }
        return hours;
    }

    // =========================================================================
    // RELIABILITY MATRIX
    // =========================================================================

    getReliabilityMatrix() {
        const categories = ['Confirmed', 'Probable', 'Possible', 'Doubtful'];
        const matrix = {};
        this.intSources.forEach(src => {
            const items = this.categorized[src];
            matrix[src] = {
                confirmed: items.filter(i => (i.verification?.score || 0) >= 80).length,
                probable: items.filter(i => { const s = i.verification?.score || 0; return s >= 60 && s < 80; }).length,
                possible: items.filter(i => { const s = i.verification?.score || 0; return s >= 40 && s < 60; }).length,
                doubtful: items.filter(i => (i.verification?.score || 0) < 40).length
            };
        });
        return { categories, matrix };
    }
}

// =============================================================================
// RENDER FUNCTION
// =============================================================================

function renderPrism(incidents) {
    const engine = new PrismEngine(incidents);
    const config = engine.intConfig;
    const metrics = engine.metrics;
    const timeline = engine.getTimelineData();
    const reliabilityMatrix = engine.getReliabilityMatrix();

    // Compute radar bar heights (percentage of max count)
    const maxCount = Math.max(1, ...engine.intSources.map(s => metrics[s].count));

    function formatTime(dateStr) {
        if (!dateStr) return '--';
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now - d;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    }

    function truncate(str, len) {
        if (!str) return '--';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    // ---- Stats bar ----
    const totalItems = engine.incidents.length;
    const multiIntCount = engine.correlations.length;
    const gapCount = engine.gaps.length;

    let html = `
    <div class="prism-container">
        <!-- Header -->
        <div class="prism-header">
            <div class="prism-header-title">
                <span class="prism-header-icon">◇</span>
                <span>PRISM</span>
                <span class="prism-header-subtitle">MULTI-INT FUSION DASHBOARD</span>
            </div>
            <div class="prism-header-stats">
                <div class="prism-stat">
                    <span class="prism-stat-value">${totalItems}</span>
                    <span class="prism-stat-label">TOTAL INT</span>
                </div>
                <div class="prism-stat">
                    <span class="prism-stat-value">${multiIntCount}</span>
                    <span class="prism-stat-label">FUSED</span>
                </div>
                <div class="prism-stat">
                    <span class="prism-stat-value">${gapCount}</span>
                    <span class="prism-stat-label">GAPS</span>
                </div>
                <div class="prism-stat prism-stat-confidence ${engine.confidenceScore >= 70 ? 'prism-conf-high' : engine.confidenceScore >= 45 ? 'prism-conf-med' : 'prism-conf-low'}">
                    <span class="prism-stat-value">${engine.confidenceScore}%</span>
                    <span class="prism-stat-label">CONFIDENCE</span>
                </div>
            </div>
        </div>

        <!-- Radar + Source Cards Row -->
        <div class="prism-top-row">
            <!-- Pentagon Radar Approximation -->
            <div class="prism-radar-panel">
                <div class="prism-panel-header">INT SOURCE BALANCE</div>
                <div class="prism-radar-chart">
                    ${engine.intSources.map((src, idx) => {
                        const pct = Math.round((metrics[src].count / maxCount) * 100);
                        const angle = (idx * 72) - 90;
                        const rad = angle * Math.PI / 180;
                        const radius = 42;
                        const barLen = pct * 0.38;
                        const cx = 50, cy = 50;
                        const x2 = cx + Math.cos(rad) * radius;
                        const y2 = cy + Math.sin(rad) * radius;
                        const xBar = cx + Math.cos(rad) * barLen;
                        const yBar = cy + Math.sin(rad) * barLen;
                        const labelX = cx + Math.cos(rad) * (radius + 7);
                        const labelY = cy + Math.sin(rad) * (radius + 7);
                        return `
                            <div class="prism-radar-axis" style="
                                position:absolute;
                                left:${cx}%;top:${cy}%;
                                width:${radius}%;height:1px;
                                transform-origin:0 0;
                                transform:rotate(${angle}deg);
                                background:rgba(255,255,255,0.1);
                            "></div>
                            <div class="prism-radar-bar" style="
                                position:absolute;
                                left:${cx}%;top:${cy}%;
                                width:${barLen}%;height:3px;
                                transform-origin:0 0;
                                transform:rotate(${angle}deg);
                                background:${config[src].color};
                                box-shadow:0 0 8px ${config[src].color}80;
                                border-radius:2px;
                            "></div>
                            <div class="prism-radar-dot" style="
                                position:absolute;
                                left:calc(${xBar}% - 4px);top:calc(${yBar}% - 4px);
                                width:8px;height:8px;border-radius:50%;
                                background:${config[src].color};
                                box-shadow:0 0 6px ${config[src].color};
                            "></div>
                            <div class="prism-radar-label" style="
                                position:absolute;
                                left:${labelX}%;top:${labelY}%;
                                transform:translate(-50%,-50%);
                                color:${config[src].color};
                                font-size:10px;font-family:var(--font-mono,'JetBrains Mono',monospace);
                                white-space:nowrap;
                            ">${src}<br><span style="color:rgba(255,255,255,0.5);font-size:9px;">${metrics[src].count}</span></div>
                        `;
                    }).join('')}
                    <div class="prism-radar-center" style="
                        position:absolute;left:50%;top:50%;
                        transform:translate(-50%,-50%);
                        width:6px;height:6px;border-radius:50%;
                        background:#fff;opacity:0.3;
                    "></div>
                </div>
            </div>

            <!-- INT Source Cards -->
            <div class="prism-source-cards">
                ${engine.intSources.map(src => {
                    const m = metrics[src];
                    const c = config[src];
                    const topTitle = m.topRecent ? truncate(m.topRecent.title, 55) : 'No data';
                    const topTime = m.topRecent ? formatTime(m.topRecent.published) : '--';
                    return `
                    <div class="prism-source-card prism-source-${src.toLowerCase()}">
                        <div class="prism-source-card-header">
                            <span class="prism-source-icon" style="color:${c.color}">${c.icon}</span>
                            <span class="prism-source-name">${src}</span>
                            <span class="prism-source-count" style="color:${c.color}">${m.count}</span>
                        </div>
                        <div class="prism-source-label">${c.label}</div>
                        <div class="prism-source-metrics">
                            <div class="prism-source-metric">
                                <span class="prism-metric-label">RELIABILITY</span>
                                <div class="prism-metric-bar-bg">
                                    <div class="prism-metric-bar-fill" style="width:${m.reliability}%;background:${c.color}"></div>
                                </div>
                                <span class="prism-metric-value">${m.reliability}%</span>
                            </div>
                            <div class="prism-source-metric">
                                <span class="prism-metric-label">FRESHNESS</span>
                                <div class="prism-metric-bar-bg">
                                    <div class="prism-metric-bar-fill" style="width:${m.freshness}%;background:${m.freshness > 50 ? c.color : '#ff8800'}"></div>
                                </div>
                                <span class="prism-metric-value">${m.freshness}%</span>
                            </div>
                            <div class="prism-source-metric">
                                <span class="prism-metric-label">COVERAGE</span>
                                <span class="prism-metric-value">${m.coverageCount} region${m.coverageCount !== 1 ? 's' : ''}</span>
                            </div>
                        </div>
                        <div class="prism-source-recent">
                            <span class="prism-recent-time">${topTime}</span>
                            <span class="prism-recent-title">${topTitle}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>

        <!-- Fused Correlations -->
        <div class="prism-section">
            <div class="prism-panel-header">FUSED CORRELATIONS <span class="prism-badge">${engine.correlations.length}</span></div>
            <div class="prism-correlations-grid">
                ${engine.correlations.slice(0, 8).map((corr, idx) => `
                    <div class="prism-correlation-card">
                        <div class="prism-correlation-header">
                            <span class="prism-correlation-rank">#${idx + 1}</span>
                            <span class="prism-correlation-confidence prism-conf-${corr.fusedConfidence.toLowerCase()}">${corr.fusedConfidence}</span>
                            <span class="prism-correlation-score">${corr.convergenceScore}%</span>
                        </div>
                        <div class="prism-correlation-title">${truncate(corr.incident.title, 70)}</div>
                        <div class="prism-correlation-sources">
                            ${corr.sources.map(s => `<span class="prism-source-badge" style="background:${config[s].color}20;color:${config[s].color};border:1px solid ${config[s].color}40">${s}</span>`).join('')}
                        </div>
                        ${corr.clusterType ? `<div class="prism-correlation-cluster">${corr.clusterSize} incidents in cluster</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Reliability Matrix + Collection Gaps Row -->
        <div class="prism-bottom-row">
            <!-- Reliability Matrix -->
            <div class="prism-matrix-panel">
                <div class="prism-panel-header">SOURCE RELIABILITY MATRIX</div>
                <table class="prism-matrix-table">
                    <thead>
                        <tr>
                            <th>SOURCE</th>
                            <th>CONFIRMED</th>
                            <th>PROBABLE</th>
                            <th>POSSIBLE</th>
                            <th>DOUBTFUL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${engine.intSources.map(src => {
                            const rm = reliabilityMatrix.matrix[src];
                            return `<tr>
                                <td><span style="color:${config[src].color}">${config[src].icon}</span> ${src}</td>
                                <td class="prism-matrix-confirmed">${rm.confirmed}</td>
                                <td class="prism-matrix-probable">${rm.probable}</td>
                                <td class="prism-matrix-possible">${rm.possible}</td>
                                <td class="prism-matrix-doubtful">${rm.doubtful}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Collection Gaps -->
            <div class="prism-gaps-panel">
                <div class="prism-panel-header">COLLECTION GAPS <span class="prism-badge prism-badge-amber">${engine.gaps.length}</span></div>
                <div class="prism-gaps-list">
                    ${engine.gaps.length === 0 ? '<div class="prism-no-gaps">No significant gaps identified</div>' :
                    engine.gaps.slice(0, 8).map(gap => `
                        <div class="prism-gap-item prism-gap-${gap.severity}">
                            <div class="prism-gap-header">
                                <span class="prism-gap-severity">${gap.severity === 'critical' ? 'CRIT' : 'WARN'}</span>
                                <span class="prism-gap-source" style="color:${config[gap.source].color}">${gap.source}</span>
                                <span class="prism-gap-type">${gap.type.replace('_', ' ')}</span>
                            </div>
                            <div class="prism-gap-desc">${gap.description}</div>
                            <div class="prism-gap-rec">${gap.recommendation}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <!-- INT Timeline -->
        <div class="prism-section">
            <div class="prism-panel-header">INT CONTRIBUTION TIMELINE (24H)</div>
            <div class="prism-timeline">
                <div class="prism-timeline-legend">
                    ${engine.intSources.map(s => `<span class="prism-legend-item"><span class="prism-legend-dot" style="background:${config[s].color}"></span>${s}</span>`).join('')}
                </div>
                <div class="prism-timeline-bars">
                    ${timeline.map((hour, idx) => {
                        const total = engine.intSources.reduce((sum, s) => sum + hour[s], 0);
                        if (idx % 2 !== 0 && timeline.length > 16) return '';
                        return `
                        <div class="prism-timeline-col">
                            <div class="prism-timeline-stack" style="height:100%">
                                ${engine.intSources.map(src => {
                                    const h = total > 0 ? Math.max(2, (hour[src] / Math.max(1, total)) * 100) : 0;
                                    return hour[src] > 0 ? `<div class="prism-timeline-segment" style="height:${h}%;background:${config[src].color}" title="${src}: ${hour[src]}"></div>` : '';
                                }).join('')}
                            </div>
                            <div class="prism-timeline-label">${hour.label}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>

        <!-- Classification Footer -->
        <div class="prism-footer">
            <span>PRISM // MULTI-INT FUSION // ${new Date().toISOString().replace('T', ' ').substring(0, 19)}Z</span>
            <span>CONFIDENCE: ${engine.confidenceScore}% // SOURCES: ${engine.intSources.length} // CORRELATIONS: ${engine.correlations.length}</span>
        </div>
    </div>`;

    return html;
}

// =============================================================================
// EXPORT
// =============================================================================

window.PrismEngine = PrismEngine;
window.renderPrism = renderPrism;
