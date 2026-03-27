/**
 * HYDRA — Red Team / Wargaming Simulation Engine
 * Adversary modeling and defense gap analysis
 */

class HydraEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.adversaries = this.defineAdversaries();
        this.currentAdversary = 'iran_irgc';
        this.forcePosture = this.assessForcePosture();
    }

    // =====================================================================
    // ADVERSARY PROFILES
    // =====================================================================

    defineAdversaries() {
        return {
            iran_irgc: {
                id: 'iran_irgc',
                name: 'Iran / IRGC',
                shortName: 'IRGC',
                capabilities: { missile: 0.9, drone: 0.85, cyber: 0.7, naval: 0.75, proxy: 0.95 },
                objectives: [
                    'Regional hegemony via proxy network',
                    'Deterrence through escalation dominance',
                    'Strategic depth across Levant and Gulf',
                    'Nuclear threshold maintenance'
                ],
                constraints: [
                    'Economic sanctions limit sustained ops',
                    'Internal political fragility',
                    'Avoiding direct US military confrontation',
                    'Maintaining plausible deniability'
                ],
                doctrine: 'Asymmetric escalation through proxy forces with direct capability held in reserve. Favors swarm attacks, layered missile salvos, and cyber-enabled disruption to overwhelm point defenses.',
                color: '#ff2244'
            },
            houthi: {
                id: 'houthi',
                name: 'Houthi / Ansar Allah',
                shortName: 'Houthi',
                capabilities: { missile: 0.7, drone: 0.8, cyber: 0.2, naval: 0.6, proxy: 0.4 },
                objectives: [
                    'Disrupt Red Sea shipping lanes',
                    'Demonstrate reach against Israel',
                    'Force coalition resource expenditure',
                    'Domestic legitimacy through resistance narrative'
                ],
                constraints: [
                    'Limited precision guidance capability',
                    'Supply chain dependent on Iran',
                    'Air superiority deficit',
                    'Limited C2 infrastructure survivability'
                ],
                doctrine: 'Attrition through persistent low-cost drone and missile attacks on high-value maritime and fixed targets. Accepts high loss rates to force disproportionate defensive spending.',
                color: '#ff6633'
            },
            hezbollah: {
                id: 'hezbollah',
                name: 'Hezbollah',
                shortName: 'Hezb',
                capabilities: { missile: 0.85, drone: 0.65, cyber: 0.5, naval: 0.3, proxy: 0.7 },
                objectives: [
                    'Deter Israeli aggression on Lebanon',
                    'Maintain rocket/missile arsenal credibility',
                    'Support Iranian strategic depth',
                    'Political dominance in Lebanon'
                ],
                constraints: [
                    'Degraded post-2024 war capacity',
                    'Lebanese political backlash risk',
                    'Reconstruction competing with rearmament',
                    'Israeli intelligence penetration'
                ],
                doctrine: 'Precision strike capability with massive rocket arsenal for area denial. Underground infrastructure for survivability. Integrated air defense and anti-tank networks for ground denial.',
                color: '#ffaa00'
            },
            non_state_hybrid: {
                id: 'non_state_hybrid',
                name: 'Non-State Hybrid',
                shortName: 'Hybrid',
                capabilities: { missile: 0.3, drone: 0.6, cyber: 0.65, naval: 0.2, proxy: 0.8 },
                objectives: [
                    'Exploit seams between state defenses',
                    'Information warfare and narrative control',
                    'Critical infrastructure disruption',
                    'Force multiplication through technology'
                ],
                constraints: [
                    'No state-level military capability',
                    'Funding and logistics volatility',
                    'Operational security challenges',
                    'Limited escalation capacity'
                ],
                doctrine: 'Exploit COTS drone technology and cyber tools for asymmetric effect. Combine physical and information attacks. Target soft civilian infrastructure to maximize psychological impact.',
                color: '#cc44ff'
            }
        };
    }

    // =====================================================================
    // FORCE POSTURE ASSESSMENT
    // =====================================================================

    assessForcePosture() {
        const now = Date.now();
        const recentWindow = 7 * 24 * 60 * 60 * 1000;
        const recent = this.incidents.filter(inc => {
            const pub = new Date(inc.published).getTime();
            return (now - pub) < recentWindow;
        });

        const categories = {
            air_defense: 0, naval_patrol: 0, cyber_ops: 0,
            ground_forces: 0, intelligence: 0, coalition: 0
        };

        recent.forEach(inc => {
            const text = ((inc.title || '') + ' ' + (inc.type || '')).toLowerCase();
            if (/missile|intercept|iron dome|patriot|thaad|air defense|arrow|david/.test(text)) categories.air_defense++;
            if (/naval|ship|carrier|destroyer|frigate|maritime|red sea|strait/.test(text)) categories.naval_patrol++;
            if (/cyber|hack|digital|network|infrastructure attack/.test(text)) categories.cyber_ops++;
            if (/ground|troop|deploy|idf|brigade|battalion|infantry/.test(text)) categories.ground_forces++;
            if (/intelligence|surveillance|osint|recon|satellite|sigint/.test(text)) categories.intelligence++;
            if (/coalition|joint|nato|centcom|allied|us forces|uk forces/.test(text)) categories.coalition++;
        });

        const maxCount = Math.max(1, ...Object.values(categories));
        const normalized = {};
        for (const [k, v] of Object.entries(categories)) {
            normalized[k] = Math.min(1, (v / maxCount) * 0.8 + 0.2);
        }

        return {
            raw: categories,
            normalized,
            totalIncidents: recent.length,
            recentIncidents: recent
        };
    }

    // =====================================================================
    // SCENARIO GENERATION
    // =====================================================================

    generateScenarios(adversaryId) {
        const adv = this.adversaries[adversaryId];
        if (!adv) return [];

        const scenarioTemplates = {
            iran_irgc: [
                {
                    title: 'Ballistic Missile Salvo on Gulf Bases',
                    target: 'US/Coalition air bases in Qatar, UAE, Bahrain',
                    method: 'Simultaneous launch of 50+ medium-range ballistic missiles with decoys',
                    capUsed: 'missile',
                    impact: 'critical',
                    countermeasure: 'Patriot/THAAD intercept batteries, base hardening, dispersal of assets',
                    responseTime: '3-8 min detection, 15 min full response'
                },
                {
                    title: 'Swarm Drone Attack on Oil Infrastructure',
                    target: 'Saudi Aramco facilities, UAE oil terminals',
                    method: 'Multi-vector drone swarm (50-100 units) with cruise missile escorts',
                    capUsed: 'drone',
                    impact: 'high',
                    countermeasure: 'C-UAS systems, electronic warfare jamming, point defense CIWS',
                    responseTime: '5-12 min detection, 20 min engagement'
                },
                {
                    title: 'Cyber Attack on Desalination Plants',
                    target: 'Gulf state critical water infrastructure',
                    method: 'APT infiltration of SCADA systems, coordinated with kinetic diversion',
                    capUsed: 'cyber',
                    impact: 'high',
                    countermeasure: 'Network segmentation, OT security monitoring, backup systems',
                    responseTime: '2-48 hrs detection, days for remediation'
                },
                {
                    title: 'Strait of Hormuz Mining Operation',
                    target: 'Commercial shipping lanes, naval chokepoint',
                    method: 'IRGCN fast boats deploying mines under cover of exercises',
                    capUsed: 'naval',
                    impact: 'critical',
                    countermeasure: 'MCM vessels, persistent ISR, naval escort operations',
                    responseTime: '1-6 hrs detection, 24-72 hrs clearing'
                }
            ],
            houthi: [
                {
                    title: 'Anti-Ship Ballistic Missile on Container Vessel',
                    target: 'Commercial shipping in Bab el-Mandeb strait',
                    method: 'ASBM launch from concealed mobile TEL in western Yemen',
                    capUsed: 'missile',
                    impact: 'high',
                    countermeasure: 'Naval destroyer intercept, maritime patrol aircraft, convoy routing',
                    responseTime: '2-5 min flight time, 8 min engagement'
                },
                {
                    title: 'Long-Range Drone Strike on Eilat/Negev',
                    target: 'Israeli southern port and military installations',
                    method: 'Samad-type one-way attack drones, wave of 10-20',
                    capUsed: 'drone',
                    impact: 'medium',
                    countermeasure: 'Iron Dome, David\'s Sling, fighter intercept, C-UAS',
                    responseTime: '30-90 min flight, 5 min engagement'
                },
                {
                    title: 'Simultaneous Red Sea Shipping Harassment',
                    target: 'Multiple commercial vessels in Red Sea corridor',
                    method: 'Coordinated drone, missile, and USV attacks on 3-5 ships simultaneously',
                    capUsed: 'naval',
                    impact: 'high',
                    countermeasure: 'Multinational naval task force, Prosperity Guardian patrols',
                    responseTime: '5-15 min per engagement, hours for full response'
                },
                {
                    title: 'Proxy Cell Activation in Saudi Border Region',
                    target: 'Saudi critical infrastructure near Yemeni border',
                    method: 'Pre-positioned sleeper cells conduct sabotage with drone overwatch',
                    capUsed: 'proxy',
                    impact: 'medium',
                    countermeasure: 'Border security reinforcement, counter-intelligence, rapid reaction forces',
                    responseTime: '1-4 hrs detection, 6 hrs containment'
                }
            ],
            hezbollah: [
                {
                    title: 'Precision Guided Munition Strike on IDF HQ',
                    target: 'Northern Command installations, Kirya compound',
                    method: 'Fateh-110 derived PGMs from rebuilt underground launchers',
                    capUsed: 'missile',
                    impact: 'critical',
                    countermeasure: 'Arrow-3/David\'s Sling intercept, preemptive strike on launch sites',
                    responseTime: '1-3 min flight time, immediate engagement'
                },
                {
                    title: 'Cross-Border Tunnel/Infiltration Operation',
                    target: 'Northern Israeli border communities and military posts',
                    method: 'Radwan Force special operations with drone ISR support',
                    capUsed: 'proxy',
                    impact: 'high',
                    countermeasure: 'Border sensors, rapid QRF deployment, drone surveillance',
                    responseTime: '5-20 min detection, 30 min force response'
                },
                {
                    title: 'Rocket Saturation on Haifa Port',
                    target: 'Haifa port, industrial zone, naval facilities',
                    method: '500+ unguided rockets in concentrated salvo to overwhelm Iron Dome',
                    capUsed: 'missile',
                    impact: 'high',
                    countermeasure: 'Iron Dome saturation management, shelter protocols, dispersal',
                    responseTime: '30 sec flight, continuous engagement'
                },
                {
                    title: 'Anti-Ship Missile Strike on Eastern Med Vessel',
                    target: 'Israeli Navy corvette or commercial vessel off Lebanese coast',
                    method: 'C-802 derived anti-ship missile from concealed coastal position',
                    capUsed: 'naval',
                    impact: 'medium',
                    countermeasure: 'Naval EW, CIWS, standoff distance management',
                    responseTime: '30 sec-2 min detection, immediate countermeasures'
                }
            ],
            non_state_hybrid: [
                {
                    title: 'COTS Drone Swarm on Airport',
                    target: 'Gulf state international airport runway and terminals',
                    method: 'Modified commercial drones in coordinated swarm (20-50 units)',
                    capUsed: 'drone',
                    impact: 'high',
                    countermeasure: 'RF detection, GPS jamming, directed energy C-UAS',
                    responseTime: '2-10 min detection, 15 min neutralization'
                },
                {
                    title: 'Ransomware Attack on Port Management Systems',
                    target: 'Major Gulf port logistics and container management',
                    method: 'Supply chain compromise delivering ransomware to OT networks',
                    capUsed: 'cyber',
                    impact: 'high',
                    countermeasure: 'Network monitoring, incident response team, backup systems',
                    responseTime: '4-72 hrs detection, days for recovery'
                },
                {
                    title: 'Information Operation / Deepfake Escalation',
                    target: 'Public perception, diplomatic relationships',
                    method: 'AI-generated deepfake of military leader announcing false escalation',
                    capUsed: 'cyber',
                    impact: 'medium',
                    countermeasure: 'Media verification protocols, rapid public affairs response',
                    responseTime: '1-6 hrs detection, 12 hrs for counter-narrative'
                },
                {
                    title: 'IED/VBIED Attack on Coalition Logistics Convoy',
                    target: 'Military supply routes in Iraq/Syria',
                    method: 'Coordinated roadside IEDs with drone-recorded propaganda',
                    capUsed: 'proxy',
                    impact: 'medium',
                    countermeasure: 'Route clearance, counter-IED tech, convoy protection',
                    responseTime: '0 (attack at initiation), 15 min QRF'
                }
            ]
        };

        const templates = scenarioTemplates[adversaryId] || [];
        return templates.map((t, i) => {
            const capScore = adv.capabilities[t.capUsed] || 0.5;
            const defenseKey = this.mapCapToDefense(t.capUsed);
            const defenseScore = this.forcePosture.normalized[defenseKey] || 0.3;
            const successProb = Math.round(Math.min(95, Math.max(5,
                (capScore * 70) + ((1 - defenseScore) * 25) + (Math.random() * 10 - 5)
            )));

            return {
                ...t,
                id: `${adversaryId}-${i}`,
                successProbability: successProb,
                strategicValue: this.calcStrategicValue(t.impact, capScore),
                defenseReadiness: Math.round(defenseScore * 100)
            };
        });
    }

    mapCapToDefense(cap) {
        const map = {
            missile: 'air_defense', drone: 'air_defense', cyber: 'cyber_ops',
            naval: 'naval_patrol', proxy: 'ground_forces'
        };
        return map[cap] || 'intelligence';
    }

    calcStrategicValue(impact, capScore) {
        const impactMap = { critical: 0.95, high: 0.75, medium: 0.5, low: 0.25 };
        return Math.round(((impactMap[impact] || 0.5) * 0.6 + capScore * 0.4) * 100);
    }

    // =====================================================================
    // DEFENSE READINESS & GAP ANALYSIS
    // =====================================================================

    calculateDefenseReadiness(adversaryId) {
        const adv = this.adversaries[adversaryId];
        if (!adv) return 50;

        const caps = adv.capabilities;
        const fp = this.forcePosture.normalized;

        let weightedDefense = 0;
        let weightedThreat = 0;

        const defenseMapping = {
            missile: ['air_defense', 'coalition'],
            drone: ['air_defense', 'intelligence'],
            cyber: ['cyber_ops', 'intelligence'],
            naval: ['naval_patrol', 'coalition'],
            proxy: ['ground_forces', 'intelligence']
        };

        for (const [cap, score] of Object.entries(caps)) {
            const defKeys = defenseMapping[cap] || ['intelligence'];
            const avgDefense = defKeys.reduce((s, k) => s + (fp[k] || 0.2), 0) / defKeys.length;
            weightedThreat += score;
            weightedDefense += avgDefense;
        }

        return Math.round((weightedDefense / Math.max(0.01, weightedThreat)) * 50);
    }

    getGapAnalysis(adversaryId) {
        const adv = this.adversaries[adversaryId];
        if (!adv) return [];

        const gaps = [];
        const fp = this.forcePosture.normalized;
        const defenseMapping = {
            missile: 'air_defense', drone: 'air_defense', cyber: 'cyber_ops',
            naval: 'naval_patrol', proxy: 'ground_forces'
        };

        for (const [cap, threat] of Object.entries(adv.capabilities)) {
            const defKey = defenseMapping[cap] || 'intelligence';
            const defense = fp[defKey] || 0.2;
            const gap = threat - defense;
            gaps.push({
                capability: cap,
                threatLevel: Math.round(threat * 100),
                defenseLevel: Math.round(defense * 100),
                gap: Math.round(gap * 100),
                status: gap > 0.3 ? 'critical' : gap > 0.1 ? 'warning' : 'adequate',
                recommendation: this.getRecommendation(cap, gap)
            });
        }

        return gaps.sort((a, b) => b.gap - a.gap);
    }

    getRecommendation(cap, gap) {
        if (gap <= 0.1) return 'Current posture adequate. Maintain readiness.';
        const recs = {
            missile: 'Deploy additional BMD assets. Increase Patriot/THAAD coverage. Pre-position interceptor reloads.',
            drone: 'Expand C-UAS envelope. Deploy directed energy systems. Increase EW jamming capacity.',
            cyber: 'Harden critical OT networks. Activate hunt-forward teams. Segment SCADA systems.',
            naval: 'Increase maritime patrol frequency. Deploy additional MCM assets. Expand convoy escorts.',
            proxy: 'Reinforce border surveillance. Activate HUMINT networks. Pre-position QRF elements.'
        };
        return recs[cap] || 'Increase monitoring and readiness posture.';
    }

    // =====================================================================
    // ADVERSARY NARRATIVE
    // =====================================================================

    generateNarrative(adversaryId) {
        const adv = this.adversaries[adversaryId];
        if (!adv) return '';

        const scenarios = this.generateScenarios(adversaryId);
        const bestScenario = scenarios.reduce((best, s) =>
            s.successProbability > best.successProbability ? s : best, scenarios[0]);
        const gaps = this.getGapAnalysis(adversaryId);
        const worstGap = gaps[0];
        const readiness = this.calculateDefenseReadiness(adversaryId);

        const openers = {
            iran_irgc: `As IRGC Quds Force commander, I would exploit the current ${readiness < 50 ? 'degraded' : 'standard'} defensive posture.`,
            houthi: `Operating from Yemen's highlands with Iranian-supplied systems, I would continue the attrition campaign.`,
            hezbollah: `Despite operational setbacks, the remaining arsenal provides significant escalation options.`,
            non_state_hybrid: `Exploiting commercially available technology and network vulnerabilities, I would strike where state defenses have seams.`
        };

        return `${openers[adversaryId] || 'Analyzing current opportunities...'} ` +
            `My highest-probability operation would be "${bestScenario.title}" with an estimated ${bestScenario.successProbability}% chance of achieving objectives. ` +
            `The defender's greatest vulnerability is in ${worstGap.capability} coverage (gap: ${worstGap.gap > 0 ? '+' : ''}${worstGap.gap}%), ` +
            `which I would exploit through ${worstGap.capability === 'cyber' ? 'persistent network intrusion' : worstGap.capability === 'naval' ? 'maritime disruption operations' : 'layered kinetic strikes'}. ` +
            `Current defense readiness sits at ${readiness}% — ${readiness < 40 ? 'a significant opportunity window' : readiness < 60 ? 'manageable but with exploitable gaps' : 'challenging but not impenetrable'}. ` +
            `I would time operations during periods of reduced ISR coverage and coordinate across multiple domains to fracture the defensive response.`;
    }

    // =====================================================================
    // WARGAME SCORE
    // =====================================================================

    getWargameScore(adversaryId) {
        const adv = this.adversaries[adversaryId];
        if (!adv) return { adversary: 50, defender: 50 };

        const totalCap = Object.values(adv.capabilities).reduce((s, v) => s + v, 0) / 5;
        const totalDef = Object.values(this.forcePosture.normalized).reduce((s, v) => s + v, 0) / 6;

        const advScore = Math.round(totalCap * 100);
        const defScore = Math.round(totalDef * 100);
        const total = advScore + defScore;

        return {
            adversary: Math.round((advScore / total) * 100),
            defender: Math.round((defScore / total) * 100),
            rawAdversary: advScore,
            rawDefender: defScore
        };
    }
}

// =========================================================================
// RENDER FUNCTIONS
// =========================================================================

function renderHydra() {
    const incidents = (typeof state !== 'undefined' && state.incidents) ? state.incidents : [];
    const engine = new HydraEngine(incidents);
    const adversaryIds = Object.keys(engine.adversaries);
    const defaultAdv = adversaryIds[0];

    const tabsHtml = adversaryIds.map(id => {
        const adv = engine.adversaries[id];
        return `<button class="hydra-tab ${id === defaultAdv ? 'hydra-tab--active' : ''}"
                    data-adversary="${id}" onclick="window.hydraSelectAdversary('${id}')">
                    <span class="hydra-tab-dot" style="background:${adv.color}"></span>
                    ${adv.shortName}
                </button>`;
    }).join('');

    const panelsHtml = adversaryIds.map(id => {
        return `<div class="hydra-panel" id="hydra-panel-${id}"
                    style="display:${id === defaultAdv ? 'block' : 'none'}">
                    ${renderAdversaryPanel(engine, id)}
                </div>`;
    }).join('');

    return `
    <div class="hydra-container">
        <div class="hydra-header">
            <div class="hydra-header-title">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff2244" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                HYDRA — Red Team Wargaming
            </div>
            <div class="hydra-header-sub">Adversary simulation &amp; defense gap analysis</div>
        </div>
        <div class="hydra-tabs">${tabsHtml}</div>
        <div class="hydra-panels">${panelsHtml}</div>
    </div>`;
}

function renderAdversaryPanel(engine, adversaryId) {
    const adv = engine.adversaries[adversaryId];
    const scenarios = engine.generateScenarios(adversaryId);
    const gaps = engine.getGapAnalysis(adversaryId);
    const score = engine.getWargameScore(adversaryId);
    const readiness = engine.calculateDefenseReadiness(adversaryId);
    const narrative = engine.generateNarrative(adversaryId);
    const fp = engine.forcePosture;

    return `
        <div class="hydra-grid">
            <!-- Left column: Capability radar + doctrine -->
            <div class="hydra-col-left">
                ${renderCapabilityRadar(adv)}
                ${renderDoctrine(adv)}
                ${renderForcePosture(fp)}
            </div>
            <!-- Right column: Scenarios + gaps + score -->
            <div class="hydra-col-right">
                ${renderWargameScore(score, readiness, adv)}
                ${renderScenarios(scenarios, adv)}
                ${renderGapAnalysis(gaps)}
                ${renderNarrative(narrative, adv)}
            </div>
        </div>`;
}

function renderCapabilityRadar(adv) {
    const caps = [
        { key: 'missile', label: 'MISSILE', icon: '◆' },
        { key: 'drone', label: 'DRONE', icon: '◈' },
        { key: 'cyber', label: 'CYBER', icon: '◉' },
        { key: 'naval', label: 'NAVAL', icon: '◇' },
        { key: 'proxy', label: 'PROXY', icon: '◎' }
    ];

    const barsHtml = caps.map(c => {
        const val = Math.round((adv.capabilities[c.key] || 0) * 100);
        return `
        <div class="hydra-radar-bar">
            <div class="hydra-radar-label">${c.icon} ${c.label}</div>
            <div class="hydra-radar-track">
                <div class="hydra-radar-fill" style="width:${val}%;background:${adv.color}"></div>
            </div>
            <div class="hydra-radar-val">${val}%</div>
        </div>`;
    }).join('');

    return `
    <div class="hydra-card hydra-card--radar">
        <div class="hydra-card-title">Capability Assessment</div>
        <div class="hydra-radar-bars">${barsHtml}</div>
    </div>`;
}

function renderDoctrine(adv) {
    const objHtml = adv.objectives.map(o => `<li>${o}</li>`).join('');
    const conHtml = adv.constraints.map(c => `<li>${c}</li>`).join('');

    return `
    <div class="hydra-card hydra-card--doctrine">
        <div class="hydra-card-title">Doctrine & Intent</div>
        <p class="hydra-doctrine-text">${adv.doctrine}</p>
        <div class="hydra-doctrine-grid">
            <div>
                <div class="hydra-doctrine-heading">Objectives</div>
                <ul class="hydra-doctrine-list hydra-doctrine-list--obj">${objHtml}</ul>
            </div>
            <div>
                <div class="hydra-doctrine-heading">Constraints</div>
                <ul class="hydra-doctrine-list hydra-doctrine-list--con">${conHtml}</ul>
            </div>
        </div>
    </div>`;
}

function renderForcePosture(fp) {
    const labels = {
        air_defense: 'Air Defense', naval_patrol: 'Naval Patrol', cyber_ops: 'Cyber Ops',
        ground_forces: 'Ground Forces', intelligence: 'Intelligence', coalition: 'Coalition'
    };
    const barsHtml = Object.entries(fp.normalized).map(([k, v]) => {
        const pct = Math.round(v * 100);
        return `
        <div class="hydra-posture-bar">
            <span class="hydra-posture-label">${labels[k] || k}</span>
            <div class="hydra-posture-track">
                <div class="hydra-posture-fill" style="width:${pct}%"></div>
            </div>
            <span class="hydra-posture-val">${pct}%</span>
        </div>`;
    }).join('');

    return `
    <div class="hydra-card hydra-card--posture">
        <div class="hydra-card-title">Current Force Posture</div>
        <div class="hydra-posture-meta">${fp.totalIncidents} recent incidents analyzed</div>
        ${barsHtml}
    </div>`;
}

function renderWargameScore(score, readiness, adv) {
    return `
    <div class="hydra-card hydra-card--score">
        <div class="hydra-card-title">Wargame Score</div>
        <div class="hydra-score-bar-wrap">
            <div class="hydra-score-label-left">
                <span style="color:${adv.color}">▶ ${adv.shortName}</span>
                <span class="hydra-score-pct">${score.adversary}%</span>
            </div>
            <div class="hydra-score-bar">
                <div class="hydra-score-adv" style="width:${score.adversary}%;background:${adv.color}"></div>
                <div class="hydra-score-def" style="width:${score.defender}%"></div>
            </div>
            <div class="hydra-score-label-right">
                <span class="hydra-score-pct">${score.defender}%</span>
                <span style="color:#4488ff">Defender ◀</span>
            </div>
        </div>
        <div class="hydra-readiness">
            <span>Defense Readiness:</span>
            <span class="hydra-readiness-val ${readiness < 40 ? 'hydra-readiness--low' : readiness < 60 ? 'hydra-readiness--mid' : 'hydra-readiness--high'}">${readiness}%</span>
        </div>
    </div>`;
}

function renderScenarios(scenarios, adv) {
    const cardsHtml = scenarios.map(s => {
        const probClass = s.successProbability > 70 ? 'hydra-prob--high' :
                         s.successProbability > 40 ? 'hydra-prob--mid' : 'hydra-prob--low';
        const impactClass = `hydra-impact--${s.impact}`;

        return `
        <div class="hydra-scenario" style="border-left-color:${adv.color}">
            <div class="hydra-scenario-head">
                <div class="hydra-scenario-title">${s.title}</div>
                <div class="hydra-scenario-badges">
                    <span class="hydra-badge ${impactClass}">${s.impact.toUpperCase()}</span>
                    <span class="hydra-badge ${probClass}">${s.successProbability}% success</span>
                </div>
            </div>
            <div class="hydra-scenario-row">
                <span class="hydra-scenario-key">Target:</span>
                <span>${s.target}</span>
            </div>
            <div class="hydra-scenario-row">
                <span class="hydra-scenario-key">Method:</span>
                <span>${s.method}</span>
            </div>
            <div class="hydra-scenario-row">
                <span class="hydra-scenario-key">Response Time:</span>
                <span>${s.responseTime}</span>
            </div>
            <div class="hydra-scenario-row">
                <span class="hydra-scenario-key">Countermeasure:</span>
                <span>${s.countermeasure}</span>
            </div>
            <div class="hydra-scenario-footer">
                <div class="hydra-scenario-stat">
                    <span>Strategic Value</span><strong>${s.strategicValue}%</strong>
                </div>
                <div class="hydra-scenario-stat">
                    <span>Defense Ready</span><strong>${s.defenseReadiness}%</strong>
                </div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="hydra-card hydra-card--scenarios">
        <div class="hydra-card-title">Adversary's Playbook</div>
        <div class="hydra-scenarios-list">${cardsHtml}</div>
    </div>`;
}

function renderGapAnalysis(gaps) {
    const rowsHtml = gaps.map(g => {
        const statusClass = `hydra-gap--${g.status}`;
        return `
        <div class="hydra-gap-row ${statusClass}">
            <div class="hydra-gap-cap">${g.capability.toUpperCase()}</div>
            <div class="hydra-gap-bars">
                <div class="hydra-gap-pair">
                    <span class="hydra-gap-label">Threat</span>
                    <div class="hydra-gap-track">
                        <div class="hydra-gap-fill hydra-gap-fill--threat" style="width:${g.threatLevel}%"></div>
                    </div>
                    <span class="hydra-gap-num">${g.threatLevel}%</span>
                </div>
                <div class="hydra-gap-pair">
                    <span class="hydra-gap-label">Defense</span>
                    <div class="hydra-gap-track">
                        <div class="hydra-gap-fill hydra-gap-fill--defense" style="width:${g.defenseLevel}%"></div>
                    </div>
                    <span class="hydra-gap-num">${g.defenseLevel}%</span>
                </div>
            </div>
            <div class="hydra-gap-status-badge">${g.status.toUpperCase()}</div>
            <div class="hydra-gap-rec">${g.recommendation}</div>
        </div>`;
    }).join('');

    return `
    <div class="hydra-card hydra-card--gaps">
        <div class="hydra-card-title">Defense Gap Analysis</div>
        ${rowsHtml}
    </div>`;
}

function renderNarrative(narrative, adv) {
    return `
    <div class="hydra-card hydra-card--narrative" style="border-color:${adv.color}">
        <div class="hydra-card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${adv.color}" stroke-width="2">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            "If You Were the Adversary..."
        </div>
        <p class="hydra-narrative-text">${narrative}</p>
    </div>`;
}

// =========================================================================
// INTERACTION HANDLER
// =========================================================================

window.hydraSelectAdversary = function(adversaryId) {
    document.querySelectorAll('.hydra-tab').forEach(t => t.classList.remove('hydra-tab--active'));
    document.querySelectorAll('.hydra-panel').forEach(p => p.style.display = 'none');

    const tab = document.querySelector(`.hydra-tab[data-adversary="${adversaryId}"]`);
    const panel = document.getElementById(`hydra-panel-${adversaryId}`);
    if (tab) tab.classList.add('hydra-tab--active');
    if (panel) panel.style.display = 'block';
};

// =========================================================================
// EXPORTS
// =========================================================================

window.HydraEngine = HydraEngine;
window.renderHydra = renderHydra;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HydraEngine, renderHydra };
}
