/**
 * PHANTOM — Adversary Intent Modeling Engine
 * Historical pattern analysis to predict likely next moves by threat actors
 */

class PhantomEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.actorPatterns = [
            { re: /houthi/i, name: 'Houthi Forces', faction: 'non-state' },
            { re: /iran|irgc|iranian/i, name: 'Iran / IRGC', faction: 'state' },
            { re: /hezbollah/i, name: 'Hezbollah', faction: 'non-state' },
            { re: /hamas/i, name: 'Hamas', faction: 'non-state' },
            { re: /idf|israel(?!.*hezbollah)/i, name: 'Israel / IDF', faction: 'state' },
            { re: /us navy|us military|american|centcom|pentagon/i, name: 'US Military', faction: 'state' },
            { re: /russian?|kremlin/i, name: 'Russia', faction: 'state' },
            { re: /saudi|mbs/i, name: 'Saudi Arabia', faction: 'state' },
            { re: /isis|isil|islamic state|daesh/i, name: 'ISIS / ISIL', faction: 'non-state' },
            { re: /turkish|turkey|ankara/i, name: 'Turkey', faction: 'state' },
            { re: /pmu|shia milit/i, name: 'Iraqi PMU', faction: 'non-state' },
            { re: /uae|emirati/i, name: 'UAE', faction: 'state' }
        ];
        this.profiles = this.buildProfiles();
    }

    // =====================================================================
    // ACTOR PROFILE CONSTRUCTION
    // =====================================================================

    buildProfiles() {
        const profiles = {};

        this.incidents.forEach(inc => {
            const title = (inc.title || '').toLowerCase();
            const matchedActors = [];

            this.actorPatterns.forEach(ap => {
                if (ap.re.test(title)) {
                    matchedActors.push(ap);
                }
            });

            if (matchedActors.length === 0) return;

            matchedActors.forEach(actor => {
                if (!profiles[actor.name]) {
                    profiles[actor.name] = {
                        name: actor.name,
                        faction: actor.faction,
                        incidents: [],
                        typeCounts: {},
                        severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
                        countries: {},
                        timeline: [],
                        firstSeen: null,
                        lastSeen: null
                    };
                }

                const p = profiles[actor.name];
                p.incidents.push(inc);

                // Type counts
                const type = inc.type || 'unknown';
                p.typeCounts[type] = (p.typeCounts[type] || 0) + 1;

                // Severity
                const sev = inc.severity || 'medium';
                p.severityCounts[sev] = (p.severityCounts[sev] || 0) + 1;

                // Countries
                if (inc.country) {
                    p.countries[inc.country] = (p.countries[inc.country] || 0) + 1;
                }

                // Timeline
                const date = inc.published ? new Date(inc.published) : null;
                if (date && !isNaN(date.getTime())) {
                    p.timeline.push({ date, incident: inc });
                    if (!p.firstSeen || date < p.firstSeen) p.firstSeen = date;
                    if (!p.lastSeen || date > p.lastSeen) p.lastSeen = date;
                }
            });
        });

        // Sort timelines and compute derived metrics
        Object.values(profiles).forEach(p => {
            p.timeline.sort((a, b) => a.date - b.date);
            p.aggressionScore = this.computeAggressionScore(p);
            p.primaryTactics = this.getPrimaryTactics(p);
            p.predictions = this.generatePredictions(p);
            p.patternMatches = this.findPatternMatches(p);
            p.threatLevel = p.aggressionScore >= 75 ? 'critical' :
                           p.aggressionScore >= 55 ? 'high' :
                           p.aggressionScore >= 35 ? 'medium' : 'low';
        });

        return profiles;
    }

    // =====================================================================
    // AGGRESSION SCORE (0-100)
    // =====================================================================

    computeAggressionScore(profile) {
        let score = 0;
        const total = profile.incidents.length;
        if (total === 0) return 0;

        // Volume component (0-25)
        score += Math.min(25, total * 2.5);

        // Severity component (0-30)
        const sevWeight = (profile.severityCounts.critical * 4 + profile.severityCounts.high * 3 +
                          profile.severityCounts.medium * 1.5 + profile.severityCounts.low * 0.5);
        score += Math.min(30, (sevWeight / total) * 8);

        // Kinetic type component (0-25)
        const kineticTypes = ['missile', 'drone', 'military', 'maritime'];
        const kineticCount = kineticTypes.reduce((sum, t) => sum + (profile.typeCounts[t] || 0), 0);
        score += Math.min(25, (kineticCount / total) * 30);

        // Recency component (0-20)
        if (profile.lastSeen) {
            const daysSinceLast = (Date.now() - profile.lastSeen.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLast < 7) score += 20;
            else if (daysSinceLast < 30) score += 14;
            else if (daysSinceLast < 90) score += 8;
            else score += 3;
        }

        return Math.min(100, Math.round(score));
    }

    // =====================================================================
    // PRIMARY TACTICS
    // =====================================================================

    getPrimaryTactics(profile) {
        return Object.entries(profile.typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([type, count]) => ({
                type,
                count,
                percentage: Math.round((count / profile.incidents.length) * 100)
            }));
    }

    // =====================================================================
    // PREDICTION GENERATION
    // =====================================================================

    generatePredictions(profile) {
        if (profile.incidents.length === 0) return [];

        const predictions = [];
        const tactics = this.getPrimaryTactics(profile);
        const total = profile.incidents.length;

        // Prediction based on most common tactic
        if (tactics.length > 0) {
            const primary = tactics[0];
            const confidence = Math.min(90, Math.round(50 + (primary.count / total) * 35));
            predictions.push({
                action: this.getTacticDescription(primary.type, profile.name),
                confidence,
                reasoning: `${primary.type.toUpperCase()} operations constitute ${primary.percentage}% of ${profile.name}'s recorded activity (${primary.count} of ${total} incidents). Historical consistency suggests continued reliance on this capability.`,
                precedent: this.getRecentPrecedent(profile, primary.type),
                timeframe: '7-14 days'
            });
        }

        // Prediction based on escalation pattern
        if (profile.severityCounts.critical + profile.severityCounts.high > total * 0.3) {
            const escalationConf = Math.min(80, Math.round(40 + (profile.aggressionScore * 0.4)));
            predictions.push({
                action: this.getEscalationPrediction(profile),
                confidence: escalationConf,
                reasoning: `${Math.round(((profile.severityCounts.critical + profile.severityCounts.high) / total) * 100)}% of ${profile.name}'s incidents rated HIGH/CRITICAL severity. Aggression score of ${profile.aggressionScore} indicates sustained high-tempo operations.`,
                precedent: this.getSeverityPrecedent(profile),
                timeframe: '3-7 days'
            });
        }

        // Prediction based on geographic pattern
        const topCountry = Object.entries(profile.countries).sort((a, b) => b[1] - a[1])[0];
        if (topCountry) {
            const geoConf = Math.min(75, Math.round(35 + (topCountry[1] / total) * 40));
            predictions.push({
                action: `Continued operations in ${topCountry[0]} region`,
                confidence: geoConf,
                reasoning: `${topCountry[1]} of ${total} incidents (${Math.round((topCountry[1] / total) * 100)}%) occurred in ${topCountry[0]}. Geographic concentration suggests established operational infrastructure and targeting preferences.`,
                precedent: `${topCountry[1]} operations recorded in ${topCountry[0]}`,
                timeframe: '7-30 days'
            });
        }

        // Prediction based on secondary tactic (diversification)
        if (tactics.length >= 2) {
            const secondary = tactics[1];
            const divConf = Math.min(65, Math.round(30 + (secondary.count / total) * 30));
            predictions.push({
                action: this.getTacticDescription(secondary.type, profile.name),
                confidence: divConf,
                reasoning: `Secondary capability in ${secondary.type.toUpperCase()} operations (${secondary.percentage}% of activity). Actors frequently alternate between primary and secondary tactics to maintain operational unpredictability.`,
                precedent: this.getRecentPrecedent(profile, secondary.type),
                timeframe: '14-30 days'
            });
        }

        return predictions.slice(0, 4);
    }

    getTacticDescription(type, actor) {
        const descriptions = {
            missile: `${actor} likely to conduct missile strike operations`,
            drone: `${actor} probable drone/UAV deployment for ISR or strike`,
            maritime: `${actor} anticipated maritime interdiction or harassment`,
            cyber: `${actor} expected to launch cyber operations against infrastructure`,
            military: `${actor} conventional military operations anticipated`,
            political: `${actor} political signaling or diplomatic maneuvering expected`,
            terror: `${actor} asymmetric / terror-style attack probable`,
            humanitarian: `${actor} humanitarian corridor disruption likely`
        };
        return descriptions[type] || `${actor} likely to conduct ${type} operations`;
    }

    getEscalationPrediction(profile) {
        const kineticTypes = ['missile', 'drone', 'military'];
        const hasKinetic = kineticTypes.some(t => profile.typeCounts[t]);
        if (hasKinetic) {
            return `${profile.name} escalation to higher-intensity kinetic operations`;
        }
        return `${profile.name} escalation in operational tempo and severity`;
    }

    getRecentPrecedent(profile, type) {
        const matching = profile.timeline
            .filter(t => (t.incident.type || '') === type)
            .slice(-3);
        if (matching.length === 0) return 'No recent precedent in data';
        return `Last ${matching.length} ${type} incident(s): ${matching.map(m =>
            m.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        ).join(', ')}`;
    }

    getSeverityPrecedent(profile) {
        const highSev = profile.timeline
            .filter(t => t.incident.severity === 'critical' || t.incident.severity === 'high')
            .slice(-3);
        if (highSev.length === 0) return 'No high-severity precedent';
        return `Last ${highSev.length} high-severity events: ${highSev.map(h =>
            h.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        ).join(', ')}`;
    }

    // =====================================================================
    // PATTERN MATCHING
    // =====================================================================

    findPatternMatches(profile) {
        const matches = [];
        const types = Object.keys(profile.typeCounts);

        types.forEach(type => {
            const typeIncidents = profile.timeline.filter(t => (t.incident.type || '') === type);
            if (typeIncidents.length < 2) return;

            // Check for follow-up patterns
            const followUps = {};
            for (let i = 0; i < typeIncidents.length - 1; i++) {
                const current = typeIncidents[i];
                const dayAfter = current.date.getTime() + (7 * 24 * 60 * 60 * 1000);
                const nextEvents = profile.timeline.filter(t =>
                    t.date > current.date && t.date.getTime() <= dayAfter && (t.incident.type || '') !== type
                );
                nextEvents.forEach(ne => {
                    const followType = ne.incident.type || 'unknown';
                    followUps[followType] = (followUps[followType] || 0) + 1;
                });
            }

            Object.entries(followUps).forEach(([followType, count]) => {
                if (count >= 2) {
                    matches.push({
                        pattern: `When ${profile.name} conducts ${type} operations, ${followType} activity follows within 7 days`,
                        occurrences: count,
                        total: typeIncidents.length,
                        confidence: Math.round((count / typeIncidents.length) * 100)
                    });
                }
            });
        });

        return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    }

    // =====================================================================
    // THREAT MATRIX DATA
    // =====================================================================

    getThreatMatrix() {
        const actors = Object.keys(this.profiles);
        const allTypes = new Set();
        actors.forEach(a => {
            Object.keys(this.profiles[a].typeCounts).forEach(t => allTypes.add(t));
        });
        const types = Array.from(allTypes).sort();

        const matrix = actors.map(actor => {
            const row = { actor };
            types.forEach(type => {
                row[type] = this.profiles[actor].typeCounts[type] || 0;
            });
            row._total = this.profiles[actor].incidents.length;
            return row;
        });

        return { actors, types, matrix };
    }

    getActorNames() {
        return Object.keys(this.profiles).sort((a, b) =>
            (this.profiles[b].aggressionScore || 0) - (this.profiles[a].aggressionScore || 0)
        );
    }
}

// =====================================================================
// RENDER FUNCTIONS
// =====================================================================

function renderPhantomAggressionGauge(score) {
    const color = score >= 75 ? '#ff4444' : score >= 55 ? '#ff8800' : score >= 35 ? '#ffcc00' : '#00ff88';
    const label = score >= 75 ? 'EXTREME' : score >= 55 ? 'HIGH' : score >= 35 ? 'ELEVATED' : 'LOW';

    return `
        <div class="phantom-gauge-container">
            <div class="phantom-gauge" style="--gauge-pct: ${score}%; --gauge-color: ${color}">
                <div class="phantom-gauge-fill"></div>
                <div class="phantom-gauge-cover">
                    <span class="phantom-gauge-value" style="color: ${color}">${score}</span>
                    <span class="phantom-gauge-unit">/ 100</span>
                </div>
            </div>
            <div class="phantom-gauge-label" style="color: ${color}">${label}</div>
            <div class="phantom-gauge-sublabel">Aggression Index</div>
        </div>
    `;
}

function renderPhantomTimeline(profile) {
    if (!profile.timeline || profile.timeline.length === 0) {
        return '<div class="phantom-timeline-empty">No timeline data available</div>';
    }

    // Group by month
    const months = {};
    profile.timeline.forEach(t => {
        const key = t.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (!months[key]) months[key] = { count: 0, types: {} };
        months[key].count++;
        const type = t.incident.type || 'unknown';
        months[key].types[type] = (months[key].types[type] || 0) + 1;
    });

    const monthEntries = Object.entries(months);
    const maxCount = Math.max(...monthEntries.map(m => m[1].count), 1);

    return `
        <div class="phantom-timeline">
            <div class="phantom-timeline-header">
                <span class="phantom-section-label">ACTIVITY TIMELINE</span>
                <span class="phantom-timeline-range">${monthEntries.length} months of data</span>
            </div>
            <div class="phantom-timeline-bars">
                ${monthEntries.map(([month, data]) => {
                    const pct = (data.count / maxCount) * 100;
                    const topType = Object.entries(data.types).sort((a, b) => b[1] - a[1])[0];
                    return `
                        <div class="phantom-timeline-bar-group" title="${month}: ${data.count} incidents">
                            <div class="phantom-timeline-bar" style="width: ${pct}%">
                                <span class="phantom-timeline-bar-count">${data.count}</span>
                            </div>
                            <span class="phantom-timeline-month">${month}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderPhantomTactics(profile) {
    const tactics = profile.primaryTactics || [];
    if (tactics.length === 0) return '';

    return `
        <div class="phantom-tactics">
            <div class="phantom-section-label">PRIMARY TACTICS</div>
            <div class="phantom-tactics-list">
                ${tactics.map(t => `
                    <div class="phantom-tactic-row">
                        <span class="phantom-tactic-type">${t.type.toUpperCase()}</span>
                        <div class="phantom-tactic-bar-bg">
                            <div class="phantom-tactic-bar" style="width: ${t.percentage}%"></div>
                        </div>
                        <span class="phantom-tactic-pct">${t.percentage}%</span>
                        <span class="phantom-tactic-count">(${t.count})</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderPhantomPredictions(profile) {
    const predictions = profile.predictions || [];
    if (predictions.length === 0) {
        return '<div class="phantom-predictions-empty">Insufficient data for prediction modeling</div>';
    }

    return `
        <div class="phantom-predictions">
            <div class="phantom-section-label">PREDICTED NEXT MOVES</div>
            <div class="phantom-predictions-list">
                ${predictions.map((pred, i) => {
                    const confColor = pred.confidence >= 70 ? '#00ff88' :
                                     pred.confidence >= 45 ? '#ffcc00' : '#ff8800';
                    return `
                        <div class="phantom-prediction-card">
                            <div class="phantom-prediction-header">
                                <span class="phantom-prediction-index">P${i + 1}</span>
                                <div class="phantom-prediction-conf" style="--conf-color: ${confColor}">
                                    <div class="phantom-conf-fill" style="width: ${pred.confidence}%; background: ${confColor}"></div>
                                    <span class="phantom-conf-text" style="color: ${confColor}">${pred.confidence}% CONFIDENCE</span>
                                </div>
                                <span class="phantom-prediction-timeframe">${pred.timeframe}</span>
                            </div>
                            <div class="phantom-prediction-action">${pred.action}</div>
                            <div class="phantom-prediction-reasoning">${pred.reasoning}</div>
                            <div class="phantom-prediction-precedent">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                                ${pred.precedent}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderPhantomPatterns(profile) {
    const patterns = profile.patternMatches || [];
    if (patterns.length === 0) {
        return `
            <div class="phantom-patterns">
                <div class="phantom-section-label">HISTORICAL PATTERN MATCHES</div>
                <div class="phantom-patterns-empty">No recurring patterns identified with sufficient confidence</div>
            </div>
        `;
    }

    return `
        <div class="phantom-patterns">
            <div class="phantom-section-label">HISTORICAL PATTERN MATCHES</div>
            <div class="phantom-patterns-list">
                ${patterns.map(p => `
                    <div class="phantom-pattern-card">
                        <div class="phantom-pattern-text">${p.pattern}</div>
                        <div class="phantom-pattern-stats">
                            <span class="phantom-pattern-occur">${p.occurrences} of ${p.total} times</span>
                            <span class="phantom-pattern-conf" style="color: ${p.confidence >= 60 ? '#00ff88' : p.confidence >= 40 ? '#ffcc00' : '#ff8800'}">${p.confidence}% correlation</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderPhantomThreatMatrix(engine) {
    const { actors, types, matrix } = engine.getThreatMatrix();

    if (actors.length === 0 || types.length === 0) {
        return `
            <div class="phantom-matrix">
                <div class="phantom-section-label">THREAT MATRIX</div>
                <div class="phantom-matrix-empty">No data available for threat matrix</div>
            </div>
        `;
    }

    const maxVal = Math.max(...matrix.flatMap(row => types.map(t => row[t] || 0)), 1);

    return `
        <div class="phantom-matrix">
            <div class="phantom-section-label">THREAT MATRIX — ACTOR vs INCIDENT TYPE</div>
            <div class="phantom-matrix-scroll">
                <div class="phantom-matrix-grid" style="grid-template-columns: 140px repeat(${types.length}, 1fr)">
                    <div class="phantom-matrix-corner"></div>
                    ${types.map(t => `<div class="phantom-matrix-col-header">${t.toUpperCase()}</div>`).join('')}
                    ${matrix.map(row => {
                        const profile = engine.profiles[row.actor];
                        const borderColor = profile.threatLevel === 'critical' ? '#ff4444' :
                                           profile.threatLevel === 'high' ? '#ff8800' :
                                           profile.threatLevel === 'medium' ? '#ffcc00' : '#00ff88';
                        return `
                            <div class="phantom-matrix-row-header" style="border-left: 3px solid ${borderColor}">
                                ${row.actor}
                            </div>
                            ${types.map(t => {
                                const val = row[t] || 0;
                                const opacity = val > 0 ? Math.max(0.15, val / maxVal) : 0;
                                const cellColor = val > 0 ? `rgba(0, 212, 255, ${opacity})` : 'transparent';
                                return `<div class="phantom-matrix-cell" style="background: ${cellColor}" title="${row.actor}: ${val} ${t} incidents">${val > 0 ? val : ''}</div>`;
                            }).join('')}
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderPhantomActorProfile(profile) {
    if (!profile) return '<div class="phantom-empty">Select an actor to view their profile</div>';

    const borderColor = profile.threatLevel === 'critical' ? '#ff4444' :
                       profile.threatLevel === 'high' ? '#ff8800' :
                       profile.threatLevel === 'medium' ? '#ffcc00' : '#00ff88';
    const threatLabel = (profile.threatLevel || 'unknown').toUpperCase();
    const factionIcon = profile.faction === 'state'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    return `
        <div class="phantom-actor-card" style="--actor-color: ${borderColor}">
            <div class="phantom-actor-header">
                <div class="phantom-actor-name-group">
                    <span class="phantom-actor-name">${profile.name}</span>
                    <span class="phantom-actor-faction">${factionIcon} ${profile.faction === 'state' ? 'State Actor' : 'Non-State Actor'}</span>
                </div>
                <div class="phantom-actor-threat" style="color: ${borderColor}; border-color: ${borderColor}">
                    ${threatLabel}
                </div>
            </div>
            <div class="phantom-actor-stats">
                <div class="phantom-stat">
                    <span class="phantom-stat-value">${profile.incidents.length}</span>
                    <span class="phantom-stat-label">INCIDENTS</span>
                </div>
                <div class="phantom-stat">
                    <span class="phantom-stat-value">${Object.keys(profile.typeCounts).length}</span>
                    <span class="phantom-stat-label">TACTIC TYPES</span>
                </div>
                <div class="phantom-stat">
                    <span class="phantom-stat-value">${Object.keys(profile.countries).length}</span>
                    <span class="phantom-stat-label">COUNTRIES</span>
                </div>
                <div class="phantom-stat">
                    <span class="phantom-stat-value">${profile.severityCounts.critical + profile.severityCounts.high}</span>
                    <span class="phantom-stat-label">HIGH+ SEV</span>
                </div>
            </div>
            <div class="phantom-actor-body">
                <div class="phantom-actor-left">
                    ${renderPhantomAggressionGauge(profile.aggressionScore)}
                    ${renderPhantomTactics(profile)}
                </div>
                <div class="phantom-actor-right">
                    ${renderPhantomTimeline(profile)}
                </div>
            </div>
        </div>
    `;
}

function renderPhantom(incidents) {
    const engine = new PhantomEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));
    const actorNames = engine.getActorNames();
    const defaultActor = actorNames[0] || null;
    const defaultProfile = defaultActor ? engine.profiles[defaultActor] : null;

    // Store engine reference for interactivity
    if (typeof window !== 'undefined') {
        window._phantomEngine = engine;
    }

    const actorOptions = actorNames.map((name, i) => {
        const p = engine.profiles[name];
        return `<option value="${name}" ${i === 0 ? 'selected' : ''}>${name} (${p.incidents.length} incidents, Score: ${p.aggressionScore})</option>`;
    }).join('');

    return `
        <div class="phantom-container" id="phantom-root">
            <div class="phantom-header">
                <div class="phantom-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #00ff88)" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        <path d="M12 8v4M12 16h.01"/>
                    </svg>
                    PHANTOM
                    <span class="phantom-subtitle">Adversary Intent Model</span>
                </div>
            </div>

            <div class="phantom-controls">
                <div class="phantom-selector-group">
                    <label class="phantom-label">THREAT ACTOR</label>
                    <select class="phantom-select" id="phantom-actor-select" onchange="phantomSelectActor(this.value)">
                        ${actorOptions || '<option value="">No actors identified in data</option>'}
                    </select>
                </div>
                <div class="phantom-actor-count">
                    <span class="phantom-count-value">${actorNames.length}</span>
                    <span class="phantom-count-label">actors identified</span>
                </div>
            </div>

            <div class="phantom-main">
                <div id="phantom-profile-area">
                    ${renderPhantomActorProfile(defaultProfile)}
                </div>

                <div id="phantom-predictions-area">
                    ${defaultProfile ? renderPhantomPredictions(defaultProfile) : ''}
                </div>

                <div id="phantom-patterns-area">
                    ${defaultProfile ? renderPhantomPatterns(defaultProfile) : ''}
                </div>

                <div id="phantom-matrix-area">
                    ${renderPhantomThreatMatrix(engine)}
                </div>
            </div>
        </div>
    `;
}

// =====================================================================
// INTERACTIVE ACTOR SELECTION
// =====================================================================

function phantomSelectActor(actorName) {
    const engine = typeof window !== 'undefined' ? window._phantomEngine : null;
    if (!engine || !engine.profiles[actorName]) return;

    const profile = engine.profiles[actorName];

    const profileArea = document.getElementById('phantom-profile-area');
    if (profileArea) profileArea.innerHTML = renderPhantomActorProfile(profile);

    const predictionsArea = document.getElementById('phantom-predictions-area');
    if (predictionsArea) predictionsArea.innerHTML = renderPhantomPredictions(profile);

    const patternsArea = document.getElementById('phantom-patterns-area');
    if (patternsArea) patternsArea.innerHTML = renderPhantomPatterns(profile);
}

// =====================================================================
// EXPORTS
// =====================================================================

window.PhantomEngine = PhantomEngine;
window.renderPhantom = renderPhantom;
window.phantomSelectActor = phantomSelectActor;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PhantomEngine, renderPhantom, phantomSelectActor };
}
