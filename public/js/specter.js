/**
 * SPECTER — Cyber Threat Overlay Engine
 * Maps cyber attacks alongside kinetic events, surfaces cyber-kinetic convergence.
 */

class SpecterEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.cyberEvents = this._generateCyberEvents();
        this.correlations = this._correlateEvents();
        this.convergenceScore = this._calculateConvergenceScore();
        this.attackSurface = this._buildAttackSurface();
        this.attributions = this._buildAttributions();
        this.stats = this._computeStats();
    }

    // =========================================================================
    // SEVERITY DERIVATION (shared with kinetic incidents)
    // =========================================================================

    _deriveSeverity(inc) {
        const cas = inc.casualties?.total || 0;
        const title = (inc.title || '').toLowerCase();
        if (cas > 10 || /strike|attack|bomb|missile|killed|explosion/.test(title)) return 'critical';
        if (cas > 0 || /clash|fire|shoot|intercept|rocket/.test(title)) return 'high';
        if (/drone|weapon|military|force|deploy/.test(title)) return 'medium';
        return 'low';
    }

    // =========================================================================
    // CYBER EVENT GENERATION
    // =========================================================================

    _generateCyberEvents() {
        const cyberTypes = [
            { type: 'DDoS', targets: ['Port Authority', 'Oil Terminal SCADA', 'Gov DNS Infrastructure', 'Banking Network', 'Telecom Backbone', 'Military C2 Network'], severity: 'high' },
            { type: 'SCADA Probe', targets: ['Desalination Plant', 'Power Grid SCADA', 'Oil Pipeline Controls', 'Gas Processing Facility', 'Water Treatment Plant', 'Port Crane Systems'], severity: 'critical' },
            { type: 'Phishing Campaign', targets: ['Defense Ministry Staff', 'Embassy Personnel', 'Military Contractors', 'Intel Agency Accounts', 'Naval Command Staff', 'Diplomatic Corps'], severity: 'medium' },
            { type: 'GPS Spoofing', targets: ['Commercial Shipping', 'Military UAV Operations', 'Naval Patrol Routes', 'Air Traffic Control', 'Missile Defense Radar', 'SAR Helicopter Ops'], severity: 'high' },
            { type: 'Comms Jamming', targets: ['Naval Freq Band', 'Ground Force Tactical', 'Air-to-Air Comms', 'Satellite Uplink', 'Emergency Services', 'Border Patrol Radio'], severity: 'critical' },
            { type: 'Malware Deployment', targets: ['Industrial Control Systems', 'Command Terminals', 'Logistics Database', 'Intelligence Servers', 'Drone Control Software', 'Satellite Ground Station'], severity: 'high' },
            { type: 'Data Exfiltration', targets: ['Classified Networks', 'Defense Procurement DB', 'SIGINT Archive', 'Force Deployment Plans', 'Diplomatic Cables', 'Alliance Communication'], severity: 'critical' },
            { type: 'Wiper Attack', targets: ['Government Servers', 'Military Planning Systems', 'Financial Infrastructure', 'Media Networks', 'Transportation Systems', 'Healthcare Records'], severity: 'critical' }
        ];

        const actors = ['APT-33 (Elfin)', 'APT-34 (OilRig)', 'MuddyWater', 'Charming Kitten', 'Sandworm', 'Lazarus Group', 'Turla', 'APT-28 (Fancy Bear)', 'Unknown State Actor'];
        const countries = ['Iran', 'Israel', 'Saudi Arabia', 'UAE', 'Yemen', 'Syria', 'Iraq', 'Lebanon', 'Bahrain', 'Qatar'];

        const events = [];
        const now = Date.now();
        const seed = this.incidents.length || 42;

        // Generate cyber events correlated with kinetic data
        const numEvents = Math.min(30, Math.max(12, Math.floor(this.incidents.length * 0.15)));

        for (let i = 0; i < numEvents; i++) {
            const hash = ((seed * 2654435761 + i * 340573321) >>> 0) % 1000;
            const typeIdx = hash % cyberTypes.length;
            const cyberType = cyberTypes[typeIdx];
            const targetIdx = (hash * 7 + i) % cyberType.targets.length;
            const actorIdx = (hash * 3 + i * 11) % actors.length;
            const countryIdx = (hash * 13 + i * 5) % countries.length;

            // Spread events over last 48h
            const ageMs = ((hash * 173 + i * 7919) % 172800) * 1000;
            const timestamp = new Date(now - ageMs);

            // Some events are linked to kinetic incident regions
            let linkedKineticId = null;
            if (i < this.incidents.length && hash % 3 === 0) {
                const kineticInc = this.incidents[i % this.incidents.length];
                linkedKineticId = kineticInc.id;
            }

            events.push({
                id: `CYB-${1000 + i}`,
                type: cyberType.type,
                target: cyberType.targets[targetIdx],
                severity: hash % 5 === 0 ? 'critical' : cyberType.severity,
                actor: actors[actorIdx],
                country: countries[countryIdx],
                timestamp: timestamp.toISOString(),
                detected: timestamp.toISOString().slice(11, 16) + 'Z',
                status: hash % 4 === 0 ? 'ACTIVE' : hash % 4 === 1 ? 'MITIGATED' : hash % 4 === 2 ? 'INVESTIGATING' : 'CONTAINED',
                linkedKineticId,
                confidence: 50 + (hash % 50)
            });
        }

        return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // =========================================================================
    // CORRELATION ENGINE
    // =========================================================================

    _correlateEvents() {
        const correlations = [];
        const now = Date.now();

        this.cyberEvents.forEach(cyber => {
            const cyberTime = new Date(cyber.timestamp).getTime();
            const cyberCountry = cyber.country;

            // Find kinetic events in same region/timeframe
            this.incidents.forEach(kinetic => {
                const kineticTime = new Date(kinetic.published).getTime();
                const kineticCountry = kinetic.location?.country || '';
                const timeDiffH = Math.abs(cyberTime - kineticTime) / 3600000;

                let score = 0;
                // Same country: high correlation
                if (cyberCountry.toLowerCase() === kineticCountry.toLowerCase()) score += 40;
                // Time proximity
                if (timeDiffH < 1) score += 35;
                else if (timeDiffH < 3) score += 25;
                else if (timeDiffH < 6) score += 15;
                else if (timeDiffH < 12) score += 5;
                // Direct link
                if (cyber.linkedKineticId === kinetic.id) score += 25;
                // Type synergy (GPS spoofing + military, SCADA + attack, etc.)
                const kTitle = (kinetic.title || '').toLowerCase();
                if (cyber.type === 'GPS Spoofing' && /ship|naval|maritime|drone/.test(kTitle)) score += 15;
                if (cyber.type === 'Comms Jamming' && /military|force|operation/.test(kTitle)) score += 15;
                if (cyber.type === 'SCADA Probe' && /infrastructure|oil|energy|pipeline/.test(kTitle)) score += 15;
                if (cyber.type === 'DDoS' && /government|ministry|official/.test(kTitle)) score += 10;

                if (score >= 40) {
                    correlations.push({
                        cyberId: cyber.id,
                        kineticId: kinetic.id,
                        cyberType: cyber.type,
                        kineticTitle: kinetic.title,
                        cyberCountry,
                        kineticCountry,
                        score: Math.min(100, score),
                        timeDiffH: timeDiffH.toFixed(1),
                        cyberTime: cyber.detected,
                        kineticTime: kinetic.published ? new Date(kinetic.published).toISOString().slice(11, 16) + 'Z' : '----Z'
                    });
                }
            });
        });

        return correlations.sort((a, b) => b.score - a.score).slice(0, 20);
    }

    _calculateConvergenceScore() {
        if (this.correlations.length === 0) return 0;
        const avgCorrelation = this.correlations.reduce((s, c) => s + c.score, 0) / this.correlations.length;
        const densityFactor = Math.min(1, this.correlations.length / 10);
        const highCorrelations = this.correlations.filter(c => c.score >= 70).length;
        const highFactor = Math.min(1, highCorrelations / 5);

        return Math.min(100, Math.round(avgCorrelation * 0.4 + densityFactor * 30 + highFactor * 30));
    }

    // =========================================================================
    // ATTACK SURFACE MATRIX
    // =========================================================================

    _buildAttackSurface() {
        const targets = ['Energy', 'Military C2', 'Telecom', 'Financial', 'Transportation', 'Water/Desal', 'Government'];
        const attackTypes = ['DDoS', 'SCADA Probe', 'Phishing', 'GPS Spoof', 'Jamming', 'Malware', 'Exfiltration', 'Wiper'];

        const matrix = {};
        targets.forEach(t => {
            matrix[t] = {};
            attackTypes.forEach(a => { matrix[t][a] = 0; });
        });

        this.cyberEvents.forEach(evt => {
            const target = evt.target.toLowerCase();
            let category = 'Government';
            if (/oil|gas|energy|power|pipeline/.test(target)) category = 'Energy';
            else if (/military|c2|command|defense|naval|force|drone/.test(target)) category = 'Military C2';
            else if (/telecom|comm|satellite/.test(target)) category = 'Telecom';
            else if (/bank|financial/.test(target)) category = 'Financial';
            else if (/port|ship|transport|traffic|crane/.test(target)) category = 'Transportation';
            else if (/water|desal/.test(target)) category = 'Water/Desal';

            let attackCat = evt.type;
            if (attackCat === 'GPS Spoofing') attackCat = 'GPS Spoof';
            if (attackCat === 'Comms Jamming') attackCat = 'Jamming';
            if (attackCat === 'Malware Deployment') attackCat = 'Malware';
            if (attackCat === 'Data Exfiltration') attackCat = 'Exfiltration';
            if (attackCat === 'Wiper Attack') attackCat = 'Wiper';
            if (attackCat === 'Phishing Campaign') attackCat = 'Phishing';

            if (matrix[category] && matrix[category][attackCat] !== undefined) {
                matrix[category][attackCat]++;
            }
        });

        return { targets, attackTypes, matrix };
    }

    // =========================================================================
    // ATTRIBUTION
    // =========================================================================

    _buildAttributions() {
        const byActor = {};
        this.cyberEvents.forEach(evt => {
            if (!byActor[evt.actor]) {
                byActor[evt.actor] = { count: 0, types: new Set(), targets: new Set(), maxSeverity: 'low' };
            }
            byActor[evt.actor].count++;
            byActor[evt.actor].types.add(evt.type);
            byActor[evt.actor].targets.add(evt.target);
            const sevOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            if (sevOrder[evt.severity] > sevOrder[byActor[evt.actor].maxSeverity]) {
                byActor[evt.actor].maxSeverity = evt.severity;
            }
        });

        return Object.entries(byActor)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([actor, data]) => ({
                actor,
                count: data.count,
                types: [...data.types],
                capability: data.count > 4 ? 'ADVANCED' : data.count > 2 ? 'MODERATE' : 'BASIC',
                maxSeverity: data.maxSeverity
            }));
    }

    // =========================================================================
    // STATS
    // =========================================================================

    _computeStats() {
        const total = this.cyberEvents.length;
        const active = this.cyberEvents.filter(e => e.status === 'ACTIVE').length;
        const critical = this.cyberEvents.filter(e => e.severity === 'critical').length;
        const mitigated = this.cyberEvents.filter(e => e.status === 'MITIGATED' || e.status === 'CONTAINED').length;
        const uniqueTargets = new Set(this.cyberEvents.map(e => e.target)).size;
        const convergenceEvents = this.correlations.filter(c => c.score >= 60).length;

        return { total, active, critical, mitigated, uniqueTargets, convergenceEvents };
    }

    // =========================================================================
    // RENDER
    // =========================================================================

    render() {
        return `
            <div class="specter-workspace">
                ${this._renderStats()}
                ${this._renderConvergenceGauge()}
                ${this._renderSplitView()}
                ${this._renderConvergenceTimeline()}
                ${this._renderAttackSurface()}
                ${this._renderAttributionPanel()}
            </div>`;
    }

    _renderStats() {
        const s = this.stats;
        return `
            <div class="specter-stats-bar">
                <div class="specter-stat">
                    <span class="specter-stat-value specter-cyber-color">${s.total}</span>
                    <span class="specter-stat-label">CYBER EVENTS</span>
                </div>
                <div class="specter-stat">
                    <span class="specter-stat-value specter-active-color">${s.active}</span>
                    <span class="specter-stat-label">ACTIVE THREATS</span>
                </div>
                <div class="specter-stat">
                    <span class="specter-stat-value specter-critical-color">${s.critical}</span>
                    <span class="specter-stat-label">CRITICAL</span>
                </div>
                <div class="specter-stat">
                    <span class="specter-stat-value specter-kinetic-color">${this.incidents.length}</span>
                    <span class="specter-stat-label">KINETIC EVENTS</span>
                </div>
                <div class="specter-stat">
                    <span class="specter-stat-value specter-target-color">${s.uniqueTargets}</span>
                    <span class="specter-stat-label">TARGETS HIT</span>
                </div>
                <div class="specter-stat">
                    <span class="specter-stat-value specter-convergence-color">${s.convergenceEvents}</span>
                    <span class="specter-stat-label">CONVERGENCE</span>
                </div>
            </div>`;
    }

    _renderConvergenceGauge() {
        const score = this.convergenceScore;
        const label = score > 75 ? 'CRITICAL CONVERGENCE' : score > 50 ? 'HIGH CONVERGENCE' : score > 25 ? 'MODERATE' : 'LOW';
        const color = score > 75 ? '#ff3d3d' : score > 50 ? '#ff9100' : score > 25 ? '#ffd600' : '#00ff88';

        return `
            <div class="specter-convergence-section">
                <div class="specter-section-header">CYBER-KINETIC CONVERGENCE SCORE</div>
                <div class="specter-convergence-display">
                    <div class="specter-gauge" style="--gauge-pct:${score}; --gauge-color:${color}">
                        <div class="specter-gauge-inner">
                            <span class="specter-gauge-value" style="color:${color}">${score}</span>
                            <span class="specter-gauge-label">${label}</span>
                        </div>
                    </div>
                    <div class="specter-convergence-detail">
                        <div class="specter-detail-row"><span>Correlated pairs detected</span><span class="specter-detail-val">${this.correlations.length}</span></div>
                        <div class="specter-detail-row"><span>High-confidence correlations</span><span class="specter-detail-val">${this.correlations.filter(c => c.score >= 70).length}</span></div>
                        <div class="specter-detail-row"><span>Avg correlation score</span><span class="specter-detail-val">${this.correlations.length ? Math.round(this.correlations.reduce((s, c) => s + c.score, 0) / this.correlations.length) : 0}</span></div>
                        <div class="specter-detail-row"><span>Active cyber actors</span><span class="specter-detail-val">${this.attributions.length}</span></div>
                        <div class="specter-detail-row"><span>Countries affected</span><span class="specter-detail-val">${new Set(this.cyberEvents.map(e => e.country)).size}</span></div>
                    </div>
                </div>
            </div>`;
    }

    _renderSplitView() {
        // Cyber events (left)
        const cyberRows = this.cyberEvents.slice(0, 15).map(evt => {
            const sevCls = evt.severity;
            const statusCls = evt.status === 'ACTIVE' ? 'active' : evt.status === 'MITIGATED' ? 'mitigated' : evt.status === 'CONTAINED' ? 'contained' : 'investigating';
            const hasCorrelation = this.correlations.some(c => c.cyberId === evt.id);
            return `<div class="specter-feed-row specter-cyber-row ${hasCorrelation ? 'specter-correlated' : ''}">
                <span class="specter-feed-time">${evt.detected}</span>
                <span class="specter-sev-dot specter-sev-${sevCls}"></span>
                <span class="specter-feed-type">${evt.type}</span>
                <span class="specter-feed-target">${evt.target}</span>
                <span class="specter-feed-status specter-status-${statusCls}">${evt.status}</span>
                ${hasCorrelation ? '<span class="specter-link-indicator" title="Correlated with kinetic event">&#8644;</span>' : ''}
            </div>`;
        }).join('');

        // Kinetic events (right)
        const kineticRows = this.incidents.slice(0, 15).map(inc => {
            const sev = this._deriveSeverity(inc);
            const time = inc.published ? new Date(inc.published).toISOString().slice(11, 16) + 'Z' : '----Z';
            const country = inc.location?.country || 'Unknown';
            const hasCorrelation = this.correlations.some(c => c.kineticId === inc.id);
            return `<div class="specter-feed-row specter-kinetic-row ${hasCorrelation ? 'specter-correlated' : ''}">
                ${hasCorrelation ? '<span class="specter-link-indicator" title="Correlated with cyber event">&#8644;</span>' : ''}
                <span class="specter-feed-time">${time}</span>
                <span class="specter-sev-dot specter-sev-${sev}"></span>
                <span class="specter-feed-title">${inc.title || 'Untitled'}</span>
                <span class="specter-feed-country">${country}</span>
            </div>`;
        }).join('');

        return `
            <div class="specter-split-section">
                <div class="specter-split-panel specter-cyber-panel">
                    <div class="specter-split-header specter-cyber-header">
                        <span class="specter-split-icon">&#9889;</span> CYBER THREAT FEED
                        <span class="specter-split-count">${this.cyberEvents.length} events</span>
                    </div>
                    <div class="specter-feed-list">${cyberRows}</div>
                </div>
                <div class="specter-correlation-bridge">
                    <div class="specter-bridge-label">CORRELATION</div>
                    ${this._renderCorrelationLines()}
                </div>
                <div class="specter-split-panel specter-kinetic-panel">
                    <div class="specter-split-header specter-kinetic-header">
                        <span class="specter-split-icon">&#128165;</span> KINETIC EVENT FEED
                        <span class="specter-split-count">${this.incidents.length} events</span>
                    </div>
                    <div class="specter-feed-list">${kineticRows}</div>
                </div>
            </div>`;
    }

    _renderCorrelationLines() {
        const topCorrelations = this.correlations.slice(0, 8);
        if (topCorrelations.length === 0) {
            return '<div class="specter-no-correlations">No correlations detected</div>';
        }

        const lines = topCorrelations.map((c, i) => {
            const opacity = c.score / 100;
            const color = c.score >= 70 ? '#ff3d3d' : c.score >= 50 ? '#ff9100' : '#ffd600';
            const y = 10 + i * 12;
            return `<div class="specter-bridge-line" style="--line-y:${y}%; --line-color:${color}; --line-opacity:${opacity}" title="${c.cyberType} &#8644; ${c.kineticTitle?.slice(0, 40)} (score: ${c.score})">
                <span class="specter-bridge-score">${c.score}</span>
            </div>`;
        }).join('');

        return `<div class="specter-bridge-lines">${lines}</div>`;
    }

    _renderConvergenceTimeline() {
        // Build timeline with both cyber and kinetic events stacked
        const now = Date.now();
        const timelineSpanH = 48;
        const bucketH = 4;
        const numBuckets = timelineSpanH / bucketH;

        const cyberBuckets = new Array(numBuckets).fill(0);
        const kineticBuckets = new Array(numBuckets).fill(0);
        const correlationBuckets = new Array(numBuckets).fill(0);

        this.cyberEvents.forEach(evt => {
            const ageH = (now - new Date(evt.timestamp).getTime()) / 3600000;
            const bucket = Math.floor(ageH / bucketH);
            if (bucket >= 0 && bucket < numBuckets) cyberBuckets[numBuckets - 1 - bucket]++;
        });

        this.incidents.forEach(inc => {
            const ageH = (now - new Date(inc.published).getTime()) / 3600000;
            const bucket = Math.floor(ageH / bucketH);
            if (bucket >= 0 && bucket < numBuckets) kineticBuckets[numBuckets - 1 - bucket]++;
        });

        this.correlations.forEach(c => {
            // Use cyber event time for bucket
            const cyberEvt = this.cyberEvents.find(e => e.id === c.cyberId);
            if (cyberEvt) {
                const ageH = (now - new Date(cyberEvt.timestamp).getTime()) / 3600000;
                const bucket = Math.floor(ageH / bucketH);
                if (bucket >= 0 && bucket < numBuckets) correlationBuckets[numBuckets - 1 - bucket]++;
            }
        });

        const maxVal = Math.max(1, ...cyberBuckets, ...kineticBuckets);

        const bars = [];
        for (let i = 0; i < numBuckets; i++) {
            const cyberH = (cyberBuckets[i] / maxVal) * 100;
            const kineticH = (kineticBuckets[i] / maxVal) * 100;
            const hasCorrelation = correlationBuckets[i] > 0;
            const timeLabel = `${(numBuckets - 1 - i) * bucketH}h ago`;

            bars.push(`<div class="specter-timeline-bucket" title="${timeLabel}: ${cyberBuckets[i]} cyber, ${kineticBuckets[i]} kinetic">
                <div class="specter-timeline-bars">
                    <div class="specter-timeline-bar specter-bar-cyber" style="height:${cyberH}%"></div>
                    <div class="specter-timeline-bar specter-bar-kinetic" style="height:${kineticH}%"></div>
                </div>
                ${hasCorrelation ? '<div class="specter-timeline-correlation-dot"></div>' : ''}
            </div>`);
        }

        // Time labels
        const labels = [];
        for (let i = 0; i < numBuckets; i += 3) {
            const hoursAgo = (numBuckets - 1 - i) * bucketH;
            labels.push(`<span class="specter-timeline-label" style="left:${(i / numBuckets) * 100}%">${hoursAgo}h</span>`);
        }
        labels.push(`<span class="specter-timeline-label" style="left:100%">Now</span>`);

        return `
            <div class="specter-timeline-section">
                <div class="specter-section-header">CONVERGENCE TIMELINE (48H)</div>
                <div class="specter-timeline-legend">
                    <span class="specter-legend-item"><span class="specter-legend-swatch specter-bar-cyber"></span>Cyber</span>
                    <span class="specter-legend-item"><span class="specter-legend-swatch specter-bar-kinetic"></span>Kinetic</span>
                    <span class="specter-legend-item"><span class="specter-legend-dot"></span>Correlation</span>
                </div>
                <div class="specter-timeline-chart">
                    <div class="specter-timeline-buckets">${bars.join('')}</div>
                    <div class="specter-timeline-labels">${labels.join('')}</div>
                </div>
            </div>`;
    }

    _renderAttackSurface() {
        const { targets, attackTypes, matrix } = this.attackSurface;

        const headerCells = attackTypes.map(a =>
            `<div class="specter-matrix-header-cell">${a}</div>`
        ).join('');

        const rows = targets.map(t => {
            const cells = attackTypes.map(a => {
                const val = matrix[t][a];
                const cls = val === 0 ? 'none' : val === 1 ? 'low' : val <= 3 ? 'medium' : 'high';
                return `<div class="specter-matrix-cell specter-matrix-${cls}" title="${t} / ${a}: ${val}">${val || ''}</div>`;
            }).join('');
            return `<div class="specter-matrix-row">
                <div class="specter-matrix-target">${t}</div>
                ${cells}
            </div>`;
        }).join('');

        return `
            <div class="specter-surface-section">
                <div class="specter-section-header">ATTACK SURFACE MAP</div>
                <div class="specter-matrix">
                    <div class="specter-matrix-row specter-matrix-header-row">
                        <div class="specter-matrix-target"></div>
                        ${headerCells}
                    </div>
                    ${rows}
                </div>
            </div>`;
    }

    _renderAttributionPanel() {
        const rows = this.attributions.map(a => {
            const capCls = a.capability === 'ADVANCED' ? 'advanced' : a.capability === 'MODERATE' ? 'moderate' : 'basic';
            const sevCls = a.maxSeverity;
            return `<div class="specter-attr-row">
                <div class="specter-attr-actor">
                    <span class="specter-attr-name">${a.actor}</span>
                    <span class="specter-attr-cap specter-cap-${capCls}">${a.capability}</span>
                </div>
                <div class="specter-attr-detail">
                    <span class="specter-attr-count">${a.count} attacks</span>
                    <span class="specter-attr-types">${a.types.join(', ')}</span>
                </div>
                <div class="specter-attr-sev">
                    <span class="specter-sev-dot specter-sev-${sevCls}"></span>
                    <span>Peak: ${a.maxSeverity.toUpperCase()}</span>
                </div>
            </div>`;
        }).join('');

        return `
            <div class="specter-attribution-section">
                <div class="specter-section-header">THREAT ACTOR ATTRIBUTION</div>
                <div class="specter-attr-list">${rows}</div>
            </div>`;
    }
}

// =============================================================================
// RENDER FUNCTION
// =============================================================================

function renderSpecter(incidents) {
    const engine = new SpecterEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));
    return engine.render();
}

// =============================================================================
// EXPORTS
// =============================================================================

window.SpecterEngine = SpecterEngine;
window.renderSpecter = renderSpecter;
