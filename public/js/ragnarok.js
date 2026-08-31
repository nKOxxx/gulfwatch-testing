/**
 * RAGNAROK — OODA Loop Escalation Timeline Engine v2
 * Includes: Interactive Animation + Comparative View
 */

// Escape untrusted incident text before inserting into innerHTML.
function ragEscapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class RagnarokEngine {
    constructor(incident) {
        this.incident = incident;
        this.phaseDurations = this.calculatePhaseDurations();
        this.bottlenecks = this.identifyBottlenecks();
        this.totalDuration = this.getTotalDuration();
    }

    // =====================================================================
    // PHASE DURATION MODEL
    // =====================================================================

    calculatePhaseDurations() {
        const type = this.incident.type || '';
        const title = (this.incident.title || '').toLowerCase();
        const severity = this.incident.severity || 'medium';
        
        const bases = {
            observe: this.getBaseDuration('observe', severity),
            orient: this.getBaseDuration('orient', severity),
            decide: this.getBaseDuration('decide', severity),
            act: this.getBaseDuration('act', severity)
        };

        const actorModifier = this.getActorModifier();
        const threatModifier = this.getThreatModifier(type, title);

        return {
            observe: Math.round(bases.observe * actorModifier * threatModifier),
            orient: Math.round(bases.orient * actorModifier * threatModifier),
            decide: Math.round(bases.decide * actorModifier * threatModifier),
            act: Math.round(bases.act * actorModifier * threatModifier)
        };
    }

    getBaseDuration(phase, severity) {
        const highSeverity = { observe: 2, orient: 5, decide: 15, act: 5 };
        const mediumSeverity = { observe: 5, orient: 15, decide: 45, act: 15 };
        const lowSeverity = { observe: 15, orient: 30, decide: 120, act: 30 };

        const bases = severity === 'critical' || severity === 'high' ? highSeverity :
                      severity === 'low' ? lowSeverity : mediumSeverity;
        return bases[phase];
    }

    getActorModifier() {
        const title = (this.incident.title || '').toLowerCase();
        if (/israel|idf|us|usa|american|british|uk|french|france/i.test(title)) return 0.5;
        if (/houthi|hezbollah|hamas|isis|isil|iranian|irgc/i.test(title)) return 1.2;
        return 1.0;
    }

    getThreatModifier(type, title) {
        const combined = (type + ' ' + title).toLowerCase();
        if (/missile|ballistic|rocket/.test(combined)) return 0.3;
        if (/drone|uav/.test(combined)) return 0.5;
        if (/attack|strike|raid/.test(combined)) return 0.7;
        return 1.0;
    }

    getTotalDuration() {
        return Object.values(this.phaseDurations).reduce((a, b) => a + b, 0);
    }

    // =====================================================================
    // BOTTLENECK ANALYSIS
    // =====================================================================

    identifyBottlenecks() {
        const phases = this.phaseDurations;
        const bottlenecks = [];

        if (phases.decide > 30) bottlenecks.push({
            phase: 'decide', phaseName: 'Decision',
            severity: phases.decide > 60 ? 'critical' : 'high',
            issue: 'Command authority delay — multi-level approval required',
            recommendation: 'Pre-authorize response protocols for known threat signatures',
            time: phases.decide
        });
        if (phases.observe > 5) bottlenecks.push({
            phase: 'observe', phaseName: 'Detection',
            severity: 'medium',
            issue: 'Detection coverage gap — threat entered undetected',
            recommendation: 'Expand sensor network or ADS-B/雷达 coverage',
            time: phases.observe
        });
        if (phases.act > 20) bottlenecks.push({
            phase: 'act', phaseName: 'Action',
            severity: phases.act > 30 ? 'high' : 'medium',
            issue: 'Response force not optimally positioned',
            recommendation: 'Pre-position assets or establish faster deployment lanes',
            time: phases.act
        });
        if (phases.orient > 20) bottlenecks.push({
            phase: 'orient', phaseName: 'Classification',
            severity: 'medium',
            issue: 'Classification ambiguity — multiple threat vectors possible',
            recommendation: 'Improve AI-assisted threat classification for faster ID',
            time: phases.orient
        });

        const order = { critical: 0, high: 1, medium: 2 };
        return bottlenecks.sort((a, b) => order[a.severity] - order[b.severity]);
    }

    getBottleneckSummary() {
        return {
            totalDuration: this.totalDuration,
            criticalPath: Math.round((this.phaseDurations.decide / this.totalDuration) * 100) > 40 ? 'DECIDE_PHASE' : 'SEQUENTIAL',
            bottleneckCount: this.bottlenecks.length,
            worstBottleneck: this.bottlenecks[0] || null,
            efficiency: this.calculateEfficiency()
        };
    }

    calculateEfficiency() {
        const idealTotal = 27;
        return Math.min(100, Math.round((idealTotal / this.totalDuration) * 100));
    }

    // =====================================================================
    // ESCALATION STAGES
    // =====================================================================

    getEscalationStages() {
        return [
            {
                id: 'detection', name: 'Detection', phase: 'Observe',
                icon: '📡', duration: this.phaseDurations.observe,
                description: this.getDetectionDescription(),
                actors: this.getActorsInPhase('observe'),
                data: this.getDetectionData()
            },
            {
                id: 'classification', name: 'Classification', phase: 'Orient',
                icon: '🔍', duration: this.phaseDurations.orient,
                description: this.getClassificationDescription(),
                actors: this.getActorsInPhase('orient'),
                data: this.getClassificationData()
            },
            {
                id: 'decision', name: 'Decision', phase: 'Decide',
                icon: '⚖️', duration: this.phaseDurations.decide,
                description: this.getDecisionDescription(),
                actors: this.getActorsInPhase('decide'),
                data: this.getDecisionData()
            },
            {
                id: 'action', name: 'Action', phase: 'Act',
                icon: '🚀', duration: this.phaseDurations.act,
                description: this.getActionDescription(),
                actors: this.getActorsInPhase('act'),
                data: this.getActionData()
            }
        ];
    }

    getDetectionDescription() {
        const title = (this.incident.title || '').toLowerCase();
        const type = this.incident.type || '';
        if (/missile|ballistic|rocket/.test(title + type)) return 'IRST/雷达 detected ballistic trajectory. Trajectory analysis initiated.';
        if (/drone|uav/.test(title + type)) return 'Radar/光电 detection of unmanned aerial signature. Tracking established.';
        if (/attack|strike|raid/.test(title + type)) return 'Ground observer or SIGINT reported hostile action. Alert issued.';
        return 'Multi-source detection triggered. Cross-referencing sensor data.';
    }

    getClassificationDescription() {
        const title = (this.incident.title || '').toLowerCase();
        if (/houthi/.test(title)) return 'Attribution: Houthi-knownTTPs. Pattern matches previous Red Sea incidents.';
        if (/iran|irgc/.test(title)) return 'Attribution: Iranian-origin capability. Regional threat assessment initiated.';
        if (/israel|idf/.test(title)) return 'Attribution: State actor. Conventional warfare doctrine applies.';
        return 'Threat type identified. Running signature analysis against known threat profiles.';
    }

    getDecisionDescription() {
        const severity = this.incident.severity || 'medium';
        if (severity === 'critical') return 'Emergency authorization. Theater commander has pre-approved response protocols.';
        if (severity === 'high') return 'Rapid approval chain. Joint operations center coordinating response.';
        return 'Standard ROE evaluation. Legal and political considerations being assessed.';
    }

    getActionDescription() {
        const title = (this.incident.title || '').toLowerCase();
        const type = this.incident.type || '';
        if (/intercept|air.defense|missile/.test(title + type)) return 'Air defense assets engaged. Interceptor launched. Impact point calculated.';
        if (/drone|uav/.test(title + type)) return 'Counter-UAV systems activated. Electronic warfare measures deployed.';
        if (/attack|strike/.test(title + type)) return 'Response strike authorized. Aircraft/导弹 assets tasked. Mission planning complete.';
        return 'Coordinated response initiated. Multiple agencies on standby.';
    }

    getActorsInPhase(phase) {
        const title = (this.incident.title || '').toLowerCase();
        const actors = [];
        if (phase === 'observe') {
            actors.push({ name: 'Sensor Network', role: 'Detection', icon: '📡' });
            if (/radar|irst|ads-b/i.test(title)) actors.push({ name: 'Radar Systems', role: 'Tracking', icon: '📡' });
            if (/satellite/.test(title)) actors.push({ name: 'SATCOM', role: 'Overhead', icon: '🛰️' });
        }
        if (phase === 'orient') {
            actors.push({ name: 'AI Classification', role: 'Threat ID', icon: '🤖' });
            actors.push({ name: 'Intelligence Cell', role: 'Analysis', icon: '🧠' });
            actors.push({ name: 'Pattern Recognition', role: 'TTP Matching', icon: '🔍' });
        }
        if (phase === 'decide') {
            actors.push({ name: 'Tactical Commander', role: 'Approval', icon: '🎖️' });
            actors.push({ name: 'JOC', role: 'Coordination', icon: '🏛️' });
            if (/nuclear|radiological/.test(title)) actors.push({ name: 'National Command', role: 'Strategic', icon: '🔴' });
        }
        if (phase === 'act') {
            actors.push({ name: 'Air Defense', role: 'Interceptors', icon: '🛡️' });
            if (/strike|attack/.test(title)) actors.push({ name: 'Strike Aircraft', role: 'Attack', icon: '✈️' });
            actors.push({ name: 'Ground Forces', role: 'Support', icon: '🪖' });
        }
        return actors;
    }

    getDetectionData() {
        return {
            confidence: this.incident.verification?.status === 'VERIFIED' ? 95 : 72,
            sources: ['Radar', 'SATINT', 'HUMINT'].slice(0, Math.floor(Math.random() * 2) + 2),
            timeToDetect: `${this.phaseDurations.observe} min`,
            coverage: 'Regional'
        };
    }

    getClassificationData() {
        return {
            confidence: Math.floor(60 + Math.random() * 30),
            threatType: this.incident.type || 'unknown',
            ttpMatch: Math.floor(50 + Math.random() * 40) + '%',
            timeToClassify: `${this.phaseDurations.orient} min`
        };
    }

    getDecisionData() {
        return {
            roeStatus: 'Active',
            approvalLevel: this.incident.severity === 'critical' ? 'Immediate' : 'Standard',
            agencies: ['Military', 'Civil Defense'].slice(0, Math.floor(Math.random() * 2) + 1),
            timeToDecide: `${this.phaseDurations.decide} min`
        };
    }

    getActionData() {
        const title = (this.incident.title || '').toLowerCase();
        return {
            assets: ['Patriot', 'Iron Dome', 'David\'s Sling'].slice(0, 2),
            responseTime: `${this.phaseDurations.act} min`,
            interceptProbability: Math.floor(60 + Math.random() * 30) + '%',
            escalationRisk: ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)]
        };
    }

    /**
     * Get comparative delta vs another engine (for comparative view)
     */
    compareTo(other) {
        if (!(other instanceof RagnarokEngine)) return null;
        const delta = {};
        for (const key of ['observe', 'orient', 'decide', 'act']) {
            delta[key] = this.phaseDurations[key] - other.phaseDurations[key];
        }
        delta.total = this.totalDuration - other.totalDuration;
        delta.efficiency = this.calculateEfficiency() - other.calculateEfficiency();
        return delta;
    }
}

// =====================================================================
// RENDER FUNCTIONS
// =====================================================================

/**
 * Main render — handles both single and comparative mode
 */
function renderRagnarok(incidentA, incidentB, mode = 'single') {
    if (mode === 'compare' && incidentA && incidentB) {
        return renderComparative(incidentA, incidentB);
    }
    return renderSingle(incidentA);
}

function renderSingle(incident) {
    if (!incident) return '<div class="ragnarok-empty">Select an incident to analyze</div>';
    
    const engine = new RagnarokEngine(incident);
    const stages = engine.getEscalationStages();
    const summary = engine.getBottleneckSummary();

    return `
    <div class="ragnarok-container" data-mode="single">
        ${renderAnimatedLoop(engine)}
        ${renderSummaryStats(summary)}
        ${renderTimeline(stages, 'primary')}
        ${summary.bottleneckCount > 0 ? renderBottlenecks(engine.bottlenecks) : ''}
    </div>`;
}

function renderComparative(incidentA, incidentB) {
    const engineA = new RagnarokEngine(incidentA);
    const engineB = new RagnarokEngine(incidentB);
    const delta = engineA.compareTo(engineB);
    const stagesA = engineA.getEscalationStages();
    const stagesB = engineB.getEscalationStages();

    const labelA = ragEscapeHtml(incidentA.title?.substring(0, 40)) || 'Scenario A';
    const labelB = ragEscapeHtml(incidentB.title?.substring(0, 40)) || 'Scenario B';

    let html = `
    <div class="ragnarok-container" data-mode="compare">
        <div class="compare-header">
            <div class="compare-title">Comparative OODA Analysis</div>
            <div class="compare-subtitle">Side-by-side escalation timeline comparison</div>
        </div>

        <div class="compare-scenarios">
            <div class="compare-scenario scenario-a">
                <div class="compare-scenario-label">Scenario A</div>
                <div class="compare-scenario-name">${labelA}</div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Total OODA</span>
                    <span class="compare-stat-value">${engineA.totalDuration} min</span>
                </div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Efficiency</span>
                    <span class="compare-stat-value">${engineA.calculateEfficiency()}%</span>
                </div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Bottlenecks</span>
                    <span class="compare-stat-value">${engineA.bottlenecks.length}</span>
                </div>
            </div>
            <div class="compare-vs">VS</div>
            <div class="compare-scenario scenario-b">
                <div class="compare-scenario-label">Scenario B</div>
                <div class="compare-scenario-name">${labelB}</div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Total OODA</span>
                    <span class="compare-stat-value">${engineB.totalDuration} min</span>
                </div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Efficiency</span>
                    <span class="compare-stat-value">${engineB.calculateEfficiency()}%</span>
                </div>
                <div class="compare-stat-row">
                    <span class="compare-stat-label">Bottlenecks</span>
                    <span class="compare-stat-value">${engineB.bottlenecks.length}</span>
                </div>
            </div>
        </div>

        ${renderComparativeDelta(delta)}

        <div class="compare-timelines">
            ${renderComparativeTimelines(stagesA, stagesB, delta)}
        </div>

        ${renderBottleneckComparison(engineA.bottlenecks, engineB.bottlenecks)}
    </div>`;

    return html;
}

// =====================================================================
// ANIMATED OODA LOOP
// =====================================================================

function renderAnimatedLoop(engine) {
    const phases = [
        { key: 'observe', name: 'Observe', icon: '📡', color: '#00bcd4' },
        { key: 'orient', name: 'Orient', icon: '🔍', color: '#ff9800' },
        { key: 'decide', name: 'Decide', icon: '⚖️', color: '#e91e63' },
        { key: 'act', name: 'Act', icon: '🚀', color: '#4caf50' }
    ];

    const total = engine.totalDuration;

    return `
    <div class="ragnarok-animated" id="ragnarok-animated">
        <div class="animated-loop-container">
            <div class="loop-ring" id="loop-ring">
                ${phases.map((p, i) => {
                    const pct = Math.round((engine.phaseDurations[p.key] / total) * 100);
                    const angle = (i / phases.length) * 360;
                    return `
                    <div class="loop-segment" 
                         data-phase="${p.key}"
                         style="--pct: ${pct}%; --color: ${p.color}; --angle: ${angle}deg"
                         id="segment-${p.key}">
                        <div class="segment-fill"></div>
                        <div class="segment-label">
                            <span class="segment-icon">${p.icon}</span>
                            <span class="segment-name">${p.name}</span>
                            <span class="segment-time" id="time-${p.key}">${engine.phaseDurations[p.key]}m</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            <div class="loop-center">
                <div class="loop-total-time" id="loop-total">${total}</div>
                <div class="loop-total-label">min total</div>
                <button class="loop-play-btn" id="loop-play-btn" onclick="startRagnarokAnimation()">
                    <span id="play-icon">▶</span>
                    <span id="play-text">Animate</span>
                </button>
            </div>
        </div>
        <div class="animated-progress-bar">
            <div class="progress-track" id="progress-track">
                <div class="progress-fill" id="progress-fill"></div>
                <div class="progress-phases" id="progress-phases">
                    ${phases.map((p, i) => {
                        const prevSum = phases.slice(0, i).reduce((s, x) => s + engine.phaseDurations[x.key], 0);
                        const pct = Math.round((prevSum / total) * 100);
                        return `<div class="phase-marker" style="left: ${pct}%" data-phase="${p.key}">${p.name[0]}</div>`;
                    }).join('')}
                </div>
            </div>
            <div class="elapsed-display">
                <span id="elapsed-time">0</span> / ${total} min
            </div>
        </div>
        <div class="phase-indicator" id="phase-indicator">
            <span class="phase-indicator-text">Press animate to begin OODA loop simulation</span>
        </div>
    </div>`;
}

// =====================================================================
// INTERACTIVE ANIMATION ENGINE
// =====================================================================

let animationState = { running: false, elapsed: 0, raf: null, startTime: null };

function startRagnarokAnimation() {
    if (animationState.running) {
        stopAnimation();
        return;
    }

    const engine = getCurrentEngine();
    if (!engine) return;

    const phases = ['observe', 'orient', 'decide', 'act'];
    const durations = phases.map(k => engine.phaseDurations[k]);
    const total = engine.totalDuration;

    animationState = { running: true, elapsed: 0, raf: null, startTime: null };
    animationState.startTime = performance.now();

    document.getElementById('play-icon').textContent = '⏸';
    document.getElementById('play-text').textContent = 'Pause';

    function tick(now) {
        if (!animationState.running) return;

        const elapsed = (now - animationState.startTime) / 1000; // seconds
        animationState.elapsed = Math.min(elapsed, total * 60); // cap at total

        updateAnimationUI(animationState.elapsed, engine, phases, durations, total);

        if (animationState.elapsed >= total * 60) {
            stopAnimation();
            return;
        }

        animationState.raf = requestAnimationFrame(tick);
    }

    animationState.raf = requestAnimationFrame(tick);
}

function stopAnimation() {
    animationState.running = false;
    if (animationState.raf) {
        cancelAnimationFrame(animationState.raf);
        animationState.raf = null;
    }
    document.getElementById('play-icon').textContent = '▶';
    document.getElementById('play-text').textContent = 'Replay';
}

function updateAnimationUI(elapsedSeconds, engine, phases, durations, total) {
    const elapsedMin = elapsedSeconds / 60;
    const pct = Math.min(100, (elapsedMin / total) * 100);

    // Update progress bar
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = pct + '%';

    // Update elapsed time display
    const elapsedEl = document.getElementById('elapsed-time');
    if (elapsedEl) elapsedEl.textContent = Math.floor(elapsedMin);

    // Update segment highlights
    let cumulative = 0;
    let activePhase = null;
    for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        cumulative += durations[i];
        const segment = document.getElementById('segment-' + phase);
        if (segment) {
            if (elapsedMin >= (cumulative - durations[i]) / 1 && elapsedMin < cumulative) {
                segment.classList.add('active');
                segment.classList.remove('completed');
                activePhase = phase;
            } else if (elapsedMin >= cumulative) {
                segment.classList.remove('active');
                segment.classList.add('completed');
            } else {
                segment.classList.remove('active', 'completed');
            }
        }
    }

    // Update phase indicator
    const indicator = document.getElementById('phase-indicator');
    if (indicator) {
        const phaseNames = { observe: 'Observe — Detecting threat', orient: 'Orient — Classifying threat', decide: 'Decide — Command decision', act: 'Act — Executing response' };
        indicator.innerHTML = `<span class="phase-indicator-text">${phaseNames[activePhase] || 'Complete'}</span>`;
    }

    // Update loop center total to show remaining
    const centerTotal = document.getElementById('loop-total');
    if (centerTotal) centerTotal.textContent = Math.max(0, Math.ceil(total - elapsedMin));
}

function getCurrentEngine() {
    const select = document.getElementById('ragnarok-incident-select');
    if (!select) return null;
    const idx = parseInt(select.value);
    if (isNaN(idx) || !state.incidents) return null;
    return new RagnarokEngine(state.incidents[idx]);
}

// =====================================================================
// SUMMARY STATS
// =====================================================================

function renderSummaryStats(summary) {
    return `
    <div class="ragnarok-summary">
        <div class="summary-stat">
            <div class="stat-value">${summary.totalDuration} min</div>
            <div class="stat-label">Total OODA Loop</div>
        </div>
        <div class="summary-stat">
            <div class="stat-value">${summary.efficiency}%</div>
            <div class="stat-label">Efficiency</div>
        </div>
        <div class="summary-stat ${summary.bottleneckCount > 0 ? 'warning' : ''}">
            <div class="stat-value">${summary.bottleneckCount}</div>
            <div class="stat-label">Bottlenecks</div>
        </div>
        <div class="summary-stat">
            <div class="stat-value">${summary.criticalPath}</div>
            <div class="stat-label">Critical Path</div>
        </div>
    </div>`;
}

// =====================================================================
// TIMELINE
// =====================================================================

function renderTimeline(stages, cls = '') {
    return `
    <div class="ragnarok-timeline ${cls}">
        ${stages.map((stage, i) => `
        <div class="timeline-stage" data-phase="${stage.phase.toLowerCase()}">
            <div class="stage-connector ${i === 0 ? 'first' : ''}">
                ${i > 0 ? '<div class="connector-line"></div>' : ''}
                <div class="stage-node" id="node-${stage.id}">
                    <span class="stage-icon">${stage.icon}</span>
                    <span class="stage-time">${stage.duration}m</span>
                </div>
            </div>
            <div class="stage-content">
                <div class="stage-header">
                    <span class="stage-name">${stage.name}</span>
                    <span class="stage-phase">${stage.phase}</span>
                </div>
                <div class="stage-description">${stage.description}</div>
                <div class="stage-actors">
                    ${stage.actors.map(a => `<span class="actor-tag"><span class="actor-icon">${a.icon}</span>${a.name}</span>`).join('')}
                </div>
                <div class="stage-metrics">
                    ${Object.entries(stage.data).map(([k, v]) => `
                    <div class="metric-item">
                        <span class="metric-key">${k.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <span class="metric-value">${v}</span>
                    </div>`).join('')}
                </div>
            </div>
        </div>`).join('')}
    </div>`;
}

// =====================================================================
// COMPARATIVE DELTA
// =====================================================================

function renderComparativeDelta(delta) {
    if (!delta || delta.total === 0) return '';

    const totalSign = delta.total > 0 ? '+' : '';
    const totalClass = delta.total < 0 ? 'delta-positive' : delta.total > 0 ? 'delta-negative' : '';
    const effSign = delta.efficiency > 0 ? '+' : '';

    return `
    <div class="compare-delta">
        <div class="delta-title">Delta Analysis</div>
        <div class="delta-grid">
            <div class="delta-item">
                <span class="delta-phase">Total Time</span>
                <span class="delta-value ${totalClass}">${totalSign}${delta.total} min</span>
            </div>
            <div class="delta-item">
                <span class="delta-phase">Efficiency</span>
                <span class="delta-value ${delta.efficiency > 0 ? 'delta-positive' : 'delta-negative'}">${effSign}${delta.efficiency}%</span>
            </div>
            ${['observe', 'orient', 'decide', 'act'].map(k => {
                if (delta[k] === 0) return '';
                const sign = delta[k] > 0 ? '+' : '';
                const cls = delta[k] < 0 ? 'delta-positive' : 'delta-negative';
                const names = { observe: 'Detect', orient: 'Classify', decide: 'Decide', act: 'Act' };
                return `<div class="delta-item"><span class="delta-phase">${names[k]}</span><span class="delta-value ${cls}">${sign}${delta[k]}m</span></div>`;
            }).join('')}
        </div>
    </div>`;
}

function renderComparativeTimelines(stagesA, stagesB, delta) {
    return `
    <div class="compare-side-by-side">
        ${stagesA.map((sA, i) => {
            const sB = stagesB[i];
            const d = delta[Object.keys(delta)[i]];
            const dSign = d > 0 ? '+' : '';
            const dCls = d < 0 ? 'delta-positive' : d > 0 ? 'delta-negative' : '';
            return `
            <div class="compare-row">
                <div class="compare-cell cell-a">
                    <div class="cell-header">${sA.icon} ${sA.name}</div>
                    <div class="cell-duration">${sA.duration}m — ${sA.description.substring(0, 50)}...</div>
                </div>
                <div class="compare-cell delta">
                    <span class="delta-badge ${dCls}">${d === 0 ? '—' : dSign + d + 'm'}</span>
                </div>
                <div class="compare-cell cell-b">
                    <div class="cell-header">${sB.icon} ${sB.name}</div>
                    <div class="cell-duration">${sB.duration}m — ${sB.description.substring(0, 50)}...</div>
                </div>
            </div>`;
        }).join('')}
    </div>`;
}

function renderBottleneckComparison(bottlenecksA, bottlenecksB) {
    const all = [...bottlenecksA.map(b => ({...b, side: 'A'})), ...bottlenecksB.map(b => ({...b, side: 'B'}))];
    if (all.length === 0) return '';
    const order = { critical: 0, high: 1, medium: 2 };
    all.sort((a, b) => order[a.severity] - order[b.severity]);

    return `
    <div class="ragnarok-bottlenecks">
        <div class="bottleneck-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Bottleneck Analysis
        </div>
        <div class="bottleneck-list">
            ${all.map(b => `
            <div class="bottleneck-item severity-${b.severity}">
                <div class="bottleneck-phase">
                    <span class="phase-badge">${b.side === 'A' ? 'A' : 'B'} — ${b.phaseName}</span>
                    <span class="bottleneck-time">${b.time} min</span>
                </div>
                <div class="bottleneck-issue">${b.issue}</div>
                <div class="bottleneck-recommendation"><strong>Recommendation:</strong> ${b.recommendation}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

// =====================================================================
// BOTTLENECKS (single mode)
// =====================================================================

function renderBottlenecks(bottlenecks) {
    return `
    <div class="ragnarok-bottlenecks">
        <div class="bottleneck-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Bottleneck Analysis
        </div>
        <div class="bottleneck-list">
            ${bottlenecks.map(b => `
            <div class="bottleneck-item severity-${b.severity}">
                <div class="bottleneck-phase">
                    <span class="phase-badge">${b.phaseName}</span>
                    <span class="bottleneck-time">${b.time} min</span>
                </div>
                <div class="bottleneck-issue">${b.issue}</div>
                <div class="bottleneck-recommendation"><strong>Recommendation:</strong> ${b.recommendation}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

// =====================================================================
// MODAL
// =====================================================================

function showRagnarokModal(incident) {
    const existing = document.querySelector('.ragnarok-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'ragnarok-modal';
    modal.innerHTML = `
        <div class="ragnarok-modal-content">
            <button class="ragnarok-modal-close" onclick="this.closest('.ragnarok-modal').remove()">×</button>
            ${renderRagnarok(incident)}
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// =====================================================================
// EXPORTS
// =====================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RagnarokEngine, renderRagnarok, showRagnarokModal, renderComparative, renderSingle };
}
