/**
 * CASCADE — Escalation Probability Modeling Engine
 * Branching decision trees showing cascading effects of geopolitical events
 */

class CascadeEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.scenarios = this.buildScenarioTemplates();
        this.incidentKeywords = this.extractKeywords();
    }

    // =====================================================================
    // KEYWORD EXTRACTION FROM INCIDENT DATA
    // =====================================================================

    extractKeywords() {
        const keywords = { actors: {}, locations: {}, types: {}, weapons: {} };
        this.incidents.forEach(inc => {
            const title = (inc.title || '').toLowerCase();
            // Actors
            const actorPatterns = [
                { re: /houthi/i, name: 'Houthi' },
                { re: /iran|irgc|iranian/i, name: 'Iran/IRGC' },
                { re: /hezbollah/i, name: 'Hezbollah' },
                { re: /hamas/i, name: 'Hamas' },
                { re: /idf|israel/i, name: 'Israel/IDF' },
                { re: /us navy|us military|american|centcom/i, name: 'US Military' },
                { re: /russian|russia/i, name: 'Russia' },
                { re: /saudi/i, name: 'Saudi Arabia' }
            ];
            actorPatterns.forEach(ap => {
                if (ap.re.test(title)) {
                    keywords.actors[ap.name] = (keywords.actors[ap.name] || 0) + 1;
                }
            });
            // Types
            if (inc.type) {
                keywords.types[inc.type] = (keywords.types[inc.type] || 0) + 1;
            }
            // Locations
            if (inc.country) {
                keywords.locations[inc.country] = (keywords.locations[inc.country] || 0) + 1;
            }
        });
        return keywords;
    }

    // =====================================================================
    // SCENARIO TEMPLATES
    // =====================================================================

    buildScenarioTemplates() {
        return [
            {
                id: 'hormuz-closure',
                trigger: 'Strait of Hormuz Closure',
                category: 'maritime',
                icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20L6 14L10 18L14 10L18 14L22 4"/></svg>',
                baseRisk: 92,
                tree: {
                    event: 'Iran closes Strait of Hormuz to commercial shipping',
                    probability: 100,
                    timeHorizon: '0h',
                    children: [
                        {
                            event: 'Global oil prices spike 40-60%',
                            probability: 95,
                            timeHorizon: '24h',
                            children: [
                                { event: 'US deploys additional carrier group to Gulf', probability: 88, timeHorizon: '48h', children: [
                                    { event: 'Direct US-Iran naval confrontation', probability: 45, timeHorizon: '7d', children: [] },
                                    { event: 'Diplomatic back-channel negotiations via Oman', probability: 62, timeHorizon: '7d', children: [] }
                                ]},
                                { event: 'IRGC mines key shipping lanes', probability: 72, timeHorizon: '48h', children: [
                                    { event: 'Coalition minesweeping operation', probability: 80, timeHorizon: '72h', children: [] },
                                    { event: 'Commercial vessel struck by mine', probability: 35, timeHorizon: '72h', children: [] }
                                ]}
                            ]
                        },
                        {
                            event: 'Houthi intensifies Red Sea attacks in coordination',
                            probability: 78,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Suez Canal traffic drops below 30%', probability: 65, timeHorizon: '48h', children: [
                                    { event: 'Global supply chain disruption — container rates triple', probability: 82, timeHorizon: '7d', children: [] }
                                ]},
                                { event: 'Saudi Arabia activates air defense umbrella', probability: 70, timeHorizon: '48h', children: [
                                    { event: 'GCC joint military response authorized', probability: 55, timeHorizon: '72h', children: [] }
                                ]}
                            ]
                        },
                        {
                            event: 'Iran activates Hezbollah deterrent posture',
                            probability: 60,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Hezbollah rocket barrage on northern Israel', probability: 40, timeHorizon: '72h', children: [
                                    { event: 'Full-scale Israel-Lebanon conflict', probability: 30, timeHorizon: '7d', children: [] }
                                ]},
                                { event: 'Israel pre-emptive strikes on Lebanese infrastructure', probability: 35, timeHorizon: '72h', children: [] }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'tanker-attack',
                trigger: 'Major Tanker Attack in Gulf of Oman',
                category: 'maritime',
                icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>',
                baseRisk: 76,
                tree: {
                    event: 'IRGC-linked forces attack oil tanker in Gulf of Oman',
                    probability: 100,
                    timeHorizon: '0h',
                    children: [
                        {
                            event: 'US Navy escorts deployed for commercial vessels',
                            probability: 85,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Insurance premiums for Gulf shipping surge 300%', probability: 90, timeHorizon: '48h', children: [
                                    { event: 'Shipping companies reroute via Cape of Good Hope', probability: 60, timeHorizon: '7d', children: [] }
                                ]},
                                { event: 'IRGC fast-boat harassment of escort vessels', probability: 55, timeHorizon: '72h', children: [
                                    { event: 'Warning shots fired — escalation risk spikes', probability: 40, timeHorizon: '7d', children: [] }
                                ]}
                            ]
                        },
                        {
                            event: 'UN Security Council emergency session convened',
                            probability: 72,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Russia/China veto sanctions resolution', probability: 80, timeHorizon: '72h', children: [] },
                                { event: 'Bilateral US-Iran negotiations resume', probability: 35, timeHorizon: '7d', children: [] }
                            ]
                        },
                        {
                            event: 'Retaliatory cyber attacks on Gulf infrastructure',
                            probability: 50,
                            timeHorizon: '48h',
                            children: [
                                { event: 'Saudi Aramco systems targeted', probability: 45, timeHorizon: '72h', children: [] },
                                { event: 'UAE port systems disrupted', probability: 38, timeHorizon: '72h', children: [] }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'houthi-escalation',
                trigger: 'Houthi Anti-Ship Missile Hits US Warship',
                category: 'missile',
                icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
                baseRisk: 88,
                tree: {
                    event: 'Houthi anti-ship ballistic missile strikes US Navy destroyer',
                    probability: 100,
                    timeHorizon: '0h',
                    children: [
                        {
                            event: 'US conducts massive retaliatory strikes on Houthi positions',
                            probability: 95,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Houthi launches coordinated drone swarm retaliation', probability: 82, timeHorizon: '48h', children: [
                                    { event: 'Red Sea shipping completely halted', probability: 70, timeHorizon: '72h', children: [] }
                                ]},
                                { event: 'Iran publicly backs Houthi — threatens US bases', probability: 55, timeHorizon: '48h', children: [
                                    { event: 'IRGC proxy attacks on US bases in Iraq/Syria', probability: 65, timeHorizon: '7d', children: [] }
                                ]}
                            ]
                        },
                        {
                            event: 'US invokes Article 5 / coalition response',
                            probability: 40,
                            timeHorizon: '48h',
                            children: [
                                { event: 'NATO naval task force deployed to Red Sea', probability: 60, timeHorizon: '72h', children: [] },
                                { event: 'Sustained air campaign against Yemen', probability: 45, timeHorizon: '7d', children: [] }
                            ]
                        },
                        {
                            event: 'Oil markets enter crisis mode — Brent above $120',
                            probability: 75,
                            timeHorizon: '24h',
                            children: [
                                { event: 'SPR releases authorized by G7', probability: 68, timeHorizon: '72h', children: [] },
                                { event: 'Recession fears trigger global market selloff', probability: 55, timeHorizon: '7d', children: [] }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'iran-nuclear',
                trigger: 'Iran Nuclear Breakout Detected',
                category: 'military',
                icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="4 2"/><circle cx="12" cy="12" r="11" stroke-dasharray="2 3"/></svg>',
                baseRisk: 96,
                tree: {
                    event: 'IAEA confirms Iran enrichment above 90% — weapons grade',
                    probability: 100,
                    timeHorizon: '0h',
                    children: [
                        {
                            event: 'Israel activates "Begin Doctrine" — pre-emptive strike planning',
                            probability: 90,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Israeli air strikes on Natanz/Fordow facilities', probability: 65, timeHorizon: '72h', children: [
                                    { event: 'Iran retaliates with ballistic missile barrage on Israel', probability: 85, timeHorizon: '7d', children: [] }
                                ]},
                                { event: 'US-Israel joint cyber operation (Stuxnet 2.0)', probability: 50, timeHorizon: '48h', children: [] }
                            ]
                        },
                        {
                            event: 'Emergency UNSC session — maximum pressure sanctions',
                            probability: 80,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Complete Iranian oil embargo', probability: 55, timeHorizon: '7d', children: [] },
                                { event: 'China/India negotiate exemptions — sanctions weakened', probability: 70, timeHorizon: '7d', children: [] }
                            ]
                        },
                        {
                            event: 'Saudi Arabia announces own nuclear program acceleration',
                            probability: 60,
                            timeHorizon: '48h',
                            children: [
                                { event: 'Middle East nuclear arms race begins', probability: 45, timeHorizon: '7d', children: [] },
                                { event: 'Turkey and Egypt signal nuclear ambitions', probability: 35, timeHorizon: '7d', children: [] }
                            ]
                        }
                    ]
                }
            },
            {
                id: 'cyber-infrastructure',
                trigger: 'Major Cyber Attack on Gulf Infrastructure',
                category: 'cyber',
                icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
                baseRisk: 68,
                tree: {
                    event: 'State-sponsored cyber attack disables Gulf port operations',
                    probability: 100,
                    timeHorizon: '0h',
                    children: [
                        {
                            event: 'Oil export terminals offline — 5M bbl/day disrupted',
                            probability: 75,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Emergency manual operations restore 40% capacity', probability: 60, timeHorizon: '48h', children: [] },
                                { event: 'Secondary attacks target backup systems', probability: 35, timeHorizon: '48h', children: [] }
                            ]
                        },
                        {
                            event: 'Attribution to Iran — retaliatory cyber operations authorized',
                            probability: 65,
                            timeHorizon: '48h',
                            children: [
                                { event: 'US Cyber Command disables Iranian C2 networks', probability: 55, timeHorizon: '72h', children: [] },
                                { event: 'Escalation to kinetic response debated', probability: 30, timeHorizon: '7d', children: [] }
                            ]
                        },
                        {
                            event: 'Financial markets: energy sector volatility spikes',
                            probability: 85,
                            timeHorizon: '24h',
                            children: [
                                { event: 'Cyber insurance rates for Gulf operations triple', probability: 70, timeHorizon: '7d', children: [] }
                            ]
                        }
                    ]
                }
            }
        ];
    }

    // =====================================================================
    // DYNAMIC SCENARIO GENERATION FROM INCIDENTS
    // =====================================================================

    generateFromIncident(incident) {
        const title = (incident.title || '').toLowerCase();
        const type = incident.type || 'military';
        const severity = incident.severity || 'medium';

        // Determine escalation templates based on incident characteristics
        const branches = [];
        const sevMultiplier = severity === 'critical' ? 1.2 : severity === 'high' ? 1.0 : severity === 'medium' ? 0.8 : 0.6;

        // Military response branch
        if (/missile|drone|attack|strike|bomb/i.test(title) || type === 'missile' || type === 'drone') {
            branches.push({
                event: 'Military retaliatory action initiated',
                probability: Math.min(95, Math.round(75 * sevMultiplier)),
                timeHorizon: '24h',
                children: [
                    {
                        event: 'Escalation to regional conflict',
                        probability: Math.min(90, Math.round(40 * sevMultiplier)),
                        timeHorizon: '72h',
                        children: [
                            { event: 'Third-party intervention / coalition formation', probability: Math.round(35 * sevMultiplier), timeHorizon: '7d', children: [] }
                        ]
                    },
                    {
                        event: 'Defensive posture — DEFCON elevation',
                        probability: Math.min(95, Math.round(60 * sevMultiplier)),
                        timeHorizon: '48h',
                        children: []
                    }
                ]
            });
        }

        // Diplomatic branch
        branches.push({
            event: 'Emergency diplomatic consultations',
            probability: Math.min(95, Math.round(70 * sevMultiplier)),
            timeHorizon: '24h',
            children: [
                { event: 'UN Security Council session requested', probability: Math.round(55 * sevMultiplier), timeHorizon: '48h', children: [
                    { event: 'Sanctions package proposed', probability: Math.round(40 * sevMultiplier), timeHorizon: '7d', children: [] }
                ]},
                { event: 'Back-channel de-escalation attempts', probability: Math.round(50 * sevMultiplier), timeHorizon: '48h', children: [] }
            ]
        });

        // Economic branch
        if (/oil|tanker|maritime|shipping|strait|port/i.test(title) || type === 'maritime') {
            branches.push({
                event: 'Energy markets disrupted — shipping rerouted',
                probability: Math.min(95, Math.round(80 * sevMultiplier)),
                timeHorizon: '24h',
                children: [
                    { event: 'Insurance premiums surge for region', probability: Math.round(70 * sevMultiplier), timeHorizon: '48h', children: [] },
                    { event: 'Alternative supply routes activated', probability: Math.round(60 * sevMultiplier), timeHorizon: '72h', children: [] }
                ]
            });
        }

        // Cyber branch
        if (/cyber|hack|infrastructure/i.test(title) || type === 'cyber') {
            branches.push({
                event: 'Retaliatory cyber operations launched',
                probability: Math.min(90, Math.round(55 * sevMultiplier)),
                timeHorizon: '48h',
                children: [
                    { event: 'Critical infrastructure targeted in response', probability: Math.round(40 * sevMultiplier), timeHorizon: '72h', children: [] }
                ]
            });
        }

        // Proxy activation branch
        if (/iran|irgc|houthi|hezbollah|hamas|proxy/i.test(title)) {
            branches.push({
                event: 'Proxy forces activated across region',
                probability: Math.min(90, Math.round(65 * sevMultiplier)),
                timeHorizon: '24h',
                children: [
                    { event: 'Multi-front escalation scenario', probability: Math.round(35 * sevMultiplier), timeHorizon: '72h', children: [] },
                    { event: 'Asymmetric attacks on soft targets', probability: Math.round(45 * sevMultiplier), timeHorizon: '48h', children: [] }
                ]
            });
        }

        // Ensure at least 3 branches
        if (branches.length < 3) {
            branches.push({
                event: 'Regional security posture elevated',
                probability: Math.min(90, Math.round(60 * sevMultiplier)),
                timeHorizon: '24h',
                children: [
                    { event: 'Allied forces repositioned', probability: Math.round(45 * sevMultiplier), timeHorizon: '72h', children: [] }
                ]
            });
        }

        const riskScore = this.computeRiskScore({ event: incident.title, probability: 100, timeHorizon: '0h', children: branches });

        return {
            id: 'incident-' + (incident.id || Date.now()),
            trigger: incident.title,
            category: type,
            baseRisk: riskScore,
            tree: {
                event: incident.title,
                probability: 100,
                timeHorizon: '0h',
                children: branches
            }
        };
    }

    // =====================================================================
    // RISK SCORE COMPUTATION
    // =====================================================================

    computeRiskScore(node, depth = 0) {
        if (!node.children || node.children.length === 0) {
            return node.probability * (1 / (depth + 1));
        }
        const childScores = node.children.map(c => this.computeRiskScore(c, depth + 1));
        const maxChildRisk = Math.max(...childScores);
        const avgChildRisk = childScores.reduce((a, b) => a + b, 0) / childScores.length;
        // Weighted: 60% max path, 40% average
        return Math.min(100, Math.round((maxChildRisk * 0.6 + avgChildRisk * 0.4) * (node.probability / 100)));
    }

    getOverallRisk(scenario) {
        return scenario.baseRisk || this.computeRiskScore(scenario.tree);
    }

    // =====================================================================
    // SCENARIO MATCHING
    // =====================================================================

    matchScenarios() {
        // Match pre-built scenarios that are relevant to current incident data
        const matched = [];
        const types = Object.keys(this.incidentKeywords.types);
        const actors = Object.keys(this.incidentKeywords.actors);

        this.scenarios.forEach(s => {
            let relevance = 0;
            if (types.includes(s.category)) relevance += 2;
            const triggerLower = s.trigger.toLowerCase();
            actors.forEach(a => {
                if (triggerLower.includes(a.toLowerCase())) relevance += 3;
            });
            if (relevance > 0 || this.incidents.length === 0) {
                matched.push({ ...s, relevance });
            }
        });

        // Always include all scenarios, sorted by relevance
        const remaining = this.scenarios.filter(s => !matched.find(m => m.id === s.id));
        return [...matched.sort((a, b) => b.relevance - a.relevance), ...remaining];
    }

    getAllScenarios() {
        const prebuilt = this.scenarios;
        const dynamic = this.incidents.slice(0, 10).map(inc => this.generateFromIncident(inc));
        return [...prebuilt, ...dynamic];
    }
}

// =====================================================================
// RENDER FUNCTIONS
// =====================================================================

function renderCascadeNode(node, depth = 0) {
    const probClass = node.probability >= 70 ? 'cascade-prob-high' :
                      node.probability >= 40 ? 'cascade-prob-medium' : 'cascade-prob-low';
    const probColor = node.probability >= 70 ? '#00ff88' :
                      node.probability >= 40 ? '#ffcc00' : '#ff4444';

    const horizonClass = `cascade-horizon-${node.timeHorizon.replace(/\s/g, '')}`;
    const isRoot = depth === 0;
    const hasChildren = node.children && node.children.length > 0;

    return `
        <div class="cascade-node cascade-depth-${depth} ${isRoot ? 'cascade-node-root' : ''}" data-probability="${node.probability}">
            ${!isRoot ? '<div class="cascade-connector"></div>' : ''}
            <div class="cascade-node-card">
                <div class="cascade-node-header">
                    <span class="cascade-time-badge ${horizonClass}">${node.timeHorizon === '0h' ? 'TRIGGER' : node.timeHorizon}</span>
                    <span class="cascade-prob-badge ${probClass}" style="--prob-color: ${probColor}">
                        <span class="cascade-prob-bar" style="width: ${node.probability}%; background: ${probColor}"></span>
                        <span class="cascade-prob-text">${node.probability}%</span>
                    </span>
                </div>
                <div class="cascade-node-event">${node.event}</div>
                ${isRoot ? '<div class="cascade-node-label">TRIGGER EVENT</div>' : ''}
            </div>
            ${hasChildren ? `
                <div class="cascade-children">
                    ${node.children.map(child => renderCascadeNode(child, depth + 1)).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function renderRiskGauge(score) {
    const color = score >= 80 ? '#ff4444' : score >= 60 ? '#ff8800' : score >= 40 ? '#ffcc00' : '#00ff88';
    const label = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'ELEVATED' : 'MODERATE';
    const angle = (score / 100) * 180;

    return `
        <div class="cascade-risk-gauge">
            <div class="cascade-gauge-visual">
                <div class="cascade-gauge-arc" style="--gauge-angle: ${angle}deg; --gauge-color: ${color}"></div>
                <div class="cascade-gauge-needle" style="--needle-angle: ${angle - 90}deg"></div>
                <div class="cascade-gauge-center">
                    <span class="cascade-gauge-value" style="color: ${color}">${score}</span>
                </div>
            </div>
            <div class="cascade-gauge-label" style="color: ${color}">${label}</div>
            <div class="cascade-gauge-sublabel">Escalation Risk Score</div>
        </div>
    `;
}

function renderTimeHorizonLegend() {
    return `
        <div class="cascade-time-legend">
            <div class="cascade-legend-title">TIME HORIZONS</div>
            <div class="cascade-legend-items">
                <span class="cascade-legend-item cascade-horizon-24h">24h</span>
                <span class="cascade-legend-item cascade-horizon-48h">48h</span>
                <span class="cascade-legend-item cascade-horizon-72h">72h</span>
                <span class="cascade-legend-item cascade-horizon-7d">7d</span>
            </div>
        </div>
    `;
}

function renderProbabilityLegend() {
    return `
        <div class="cascade-prob-legend">
            <div class="cascade-legend-title">PROBABILITY</div>
            <div class="cascade-legend-items">
                <span class="cascade-legend-item"><span class="cascade-dot" style="background:#00ff88"></span> &gt;70% High</span>
                <span class="cascade-legend-item"><span class="cascade-dot" style="background:#ffcc00"></span> 40-70% Medium</span>
                <span class="cascade-legend-item"><span class="cascade-dot" style="background:#ff4444"></span> &lt;40% Low</span>
            </div>
        </div>
    `;
}

function renderCascade(incidents) {
    const engine = new CascadeEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));
    const allScenarios = engine.getAllScenarios();
    const prebuiltScenarios = engine.scenarios;

    // Build scenario options
    const prebuiltOptions = prebuiltScenarios.map((s, i) =>
        `<option value="preset-${i}" ${i === 0 ? 'selected' : ''}>${s.trigger}</option>`
    ).join('');

    const incidentOptions = (incidents || []).slice(0, 15).map((inc, i) =>
        `<option value="incident-${i}">[${(inc.type || 'unknown').toUpperCase()}] ${inc.title}</option>`
    ).join('');

    // Default: render first scenario
    const defaultScenario = prebuiltScenarios[0];
    const risk = engine.getOverallRisk(defaultScenario);

    return `
        <div class="cascade-container" id="cascade-root">
            <div class="cascade-header">
                <div class="cascade-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #00ff88)" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                    </svg>
                    CASCADE
                    <span class="cascade-subtitle">Escalation Probability Model</span>
                </div>
            </div>

            <div class="cascade-controls">
                <div class="cascade-selector-group">
                    <label class="cascade-label">SCENARIO</label>
                    <select class="cascade-select" id="cascade-scenario-select" onchange="cascadeSelectScenario(this.value)">
                        <optgroup label="Pre-built Scenarios">
                            ${prebuiltOptions}
                        </optgroup>
                        ${incidentOptions ? `<optgroup label="From Incident Feed">${incidentOptions}</optgroup>` : ''}
                    </select>
                </div>
                <div class="cascade-legends">
                    ${renderTimeHorizonLegend()}
                    ${renderProbabilityLegend()}
                </div>
            </div>

            <div class="cascade-main">
                <div class="cascade-sidebar">
                    ${renderRiskGauge(risk)}
                    <div class="cascade-meta">
                        <div class="cascade-meta-row">
                            <span class="cascade-meta-label">Category</span>
                            <span class="cascade-meta-value cascade-tag">${(defaultScenario.category || 'general').toUpperCase()}</span>
                        </div>
                        <div class="cascade-meta-row">
                            <span class="cascade-meta-label">Branch Nodes</span>
                            <span class="cascade-meta-value" id="cascade-node-count">${countNodes(defaultScenario.tree)}</span>
                        </div>
                        <div class="cascade-meta-row">
                            <span class="cascade-meta-label">Max Depth</span>
                            <span class="cascade-meta-value" id="cascade-depth-count">${getMaxDepth(defaultScenario.tree)}</span>
                        </div>
                        <div class="cascade-meta-row">
                            <span class="cascade-meta-label">Highest Single-Path Risk</span>
                            <span class="cascade-meta-value" id="cascade-max-path">${getHighestPath(defaultScenario.tree)}%</span>
                        </div>
                    </div>
                    <div class="cascade-scenario-list">
                        <div class="cascade-legend-title">ALL SCENARIOS</div>
                        ${prebuiltScenarios.map((s, i) => `
                            <div class="cascade-scenario-item ${i === 0 ? 'active' : ''}" onclick="cascadeSelectScenario('preset-${i}')">
                                <span class="cascade-scenario-risk" style="color: ${s.baseRisk >= 80 ? '#ff4444' : s.baseRisk >= 60 ? '#ff8800' : '#ffcc00'}">${s.baseRisk}</span>
                                <span class="cascade-scenario-name">${s.trigger}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="cascade-tree-viewport">
                    <div class="cascade-tree" id="cascade-tree">
                        ${renderCascadeNode(defaultScenario.tree)}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    if (node.children) node.children.forEach(c => { count += countNodes(c); });
    return count;
}

function getMaxDepth(node, depth = 0) {
    if (!node.children || node.children.length === 0) return depth;
    return Math.max(...node.children.map(c => getMaxDepth(c, depth + 1)));
}

function getHighestPath(node) {
    if (!node.children || node.children.length === 0) return node.probability;
    const childMax = Math.max(...node.children.map(c => getHighestPath(c)));
    return Math.round((node.probability / 100) * childMax);
}

// =====================================================================
// INTERACTIVE SCENARIO SELECTION
// =====================================================================

function cascadeSelectScenario(value) {
    const incidents = typeof state !== 'undefined' ? state.incidents : [];
    const engine = new CascadeEngine(incidents);

    let scenario;
    if (value.startsWith('preset-')) {
        const idx = parseInt(value.replace('preset-', ''));
        scenario = engine.scenarios[idx];
    } else if (value.startsWith('incident-')) {
        const idx = parseInt(value.replace('incident-', ''));
        const inc = incidents[idx];
        if (inc) {
            scenario = engine.generateFromIncident(inc);
        }
    }

    if (!scenario) return;

    const risk = engine.getOverallRisk(scenario);

    // Update tree
    const treeEl = document.getElementById('cascade-tree');
    if (treeEl) treeEl.innerHTML = renderCascadeNode(scenario.tree);

    // Update gauge
    const gaugeContainer = document.querySelector('.cascade-risk-gauge');
    if (gaugeContainer) {
        gaugeContainer.outerHTML = renderRiskGauge(risk);
    }

    // Update meta
    const nodeCount = document.getElementById('cascade-node-count');
    if (nodeCount) nodeCount.textContent = countNodes(scenario.tree);
    const depthCount = document.getElementById('cascade-depth-count');
    if (depthCount) depthCount.textContent = getMaxDepth(scenario.tree);
    const maxPath = document.getElementById('cascade-max-path');
    if (maxPath) maxPath.textContent = getHighestPath(scenario.tree) + '%';

    // Update category tag
    const tag = document.querySelector('.cascade-tag');
    if (tag) tag.textContent = (scenario.category || 'general').toUpperCase();

    // Update select
    const select = document.getElementById('cascade-scenario-select');
    if (select) select.value = value;

    // Update active scenario in list
    document.querySelectorAll('.cascade-scenario-item').forEach((el, i) => {
        el.classList.toggle('active', value === `preset-${i}`);
    });
}

// =====================================================================
// EXPORTS
// =====================================================================

window.CascadeEngine = CascadeEngine;
window.renderCascade = renderCascade;
window.cascadeSelectScenario = cascadeSelectScenario;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CascadeEngine, renderCascade, cascadeSelectScenario };
}
