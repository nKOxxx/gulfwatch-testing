/**
 * CITADEL — Collaborative Command Workspace Engine
 * Role-based operational picture: same data, different views for different roles.
 * Roles: Intelligence Analyst, Theater Commander, Diplomatic Advisor, Logistics Officer
 */

class CitadelEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.activeRole = 'analyst';
        this.roles = {
            analyst: {
                label: 'Intelligence Analyst',
                short: 'ANALYST',
                classification: 'SECRET',
                color: '#00e5ff',
                icon: '&#9737;'
            },
            commander: {
                label: 'Theater Commander',
                short: 'COMMANDER',
                classification: 'TOP SECRET // SCI',
                color: '#ff3d3d',
                icon: '&#9733;'
            },
            diplomat: {
                label: 'Diplomatic Advisor',
                short: 'DIPLOMAT',
                classification: 'SECRET // NOFORN',
                color: '#b388ff',
                icon: '&#9878;'
            },
            logistics: {
                label: 'Logistics Officer',
                short: 'LOGISTICS',
                classification: 'SECRET',
                color: '#ff9100',
                icon: '&#9881;'
            }
        };
        this.annotations = this._generateAnnotations();
        this.activityLog = this._generateActivityLog();
        this.cop = this._computeCOP();
    }

    // =========================================================================
    // COMMON OPERATING PICTURE
    // =========================================================================

    _deriveSeverity(inc) {
        const cas = inc.casualties?.total || 0;
        const title = (inc.title || '').toLowerCase();
        if (cas > 10 || /strike|attack|bomb|missile|killed|explosion/.test(title)) return 'critical';
        if (cas > 0 || /clash|fire|shoot|intercept|rocket/.test(title)) return 'high';
        if (/drone|weapon|military|force|deploy/.test(title)) return 'medium';
        return 'low';
    }

    _computeCOP() {
        const total = this.incidents.length;
        const critical = this.incidents.filter(i => this._deriveSeverity(i) === 'critical').length;
        const high = this.incidents.filter(i => this._deriveSeverity(i) === 'high').length;
        const verified = this.incidents.filter(i => i.verification?.status === 'VERIFIED').length;

        let threatLevel = 'LOW';
        if (critical > 5 || high > 15) threatLevel = 'CRITICAL';
        else if (critical > 2 || high > 8) threatLevel = 'HIGH';
        else if (critical > 0 || high > 3) threatLevel = 'ELEVATED';
        else if (high > 0) threatLevel = 'GUARDED';

        const readiness = Math.max(40, Math.min(98, 95 - critical * 5 - high * 2));

        return { total, critical, high, verified, threatLevel, readiness };
    }

    // =========================================================================
    // SIMULATED COLLABORATIVE DATA
    // =========================================================================

    _generateAnnotations() {
        const notes = [
            { role: 'analyst', author: 'CPT Rivera', time: '0847Z', text: 'Pattern detected: 3 correlated SIGINT hits on Strait of Hormuz shipping lanes. Recommend WATCHCON upgrade.' },
            { role: 'commander', author: 'BG Hawkins', time: '0912Z', text: 'Concur with WATCHCON upgrade. Directing CENTCOM J2 to validate with national-level assets.' },
            { role: 'diplomat', author: 'AMB Chen', time: '0935Z', text: 'GCC partners expressing concern over escalation. Recommend deconfliction channel activation with Muscat.' },
            { role: 'logistics', author: 'COL Petrov', time: '0948Z', text: 'Forward sustainment stocks at 72% capacity. Requesting priority resupply for PATRIOT interceptors.' },
            { role: 'analyst', author: 'MAJ Torres', time: '1023Z', text: 'HUMINT source reports pre-positioning activity consistent with previous escalation patterns.' },
            { role: 'commander', author: 'BG Hawkins', time: '1055Z', text: 'ROE modification authorized for maritime intercept operations. EXORD follows.' }
        ];
        return notes;
    }

    _generateActivityLog() {
        const actions = [
            { role: 'analyst', time: '1102Z', action: 'Updated threat assessment for Sector 7-Alpha' },
            { role: 'commander', time: '1058Z', action: 'Approved OPLAN modification for maritime patrol' },
            { role: 'logistics', time: '1045Z', action: 'Submitted LOGSTAT for forward operating base FALCON' },
            { role: 'diplomat', time: '1032Z', action: 'Opened deconfliction channel with Oman MOD' },
            { role: 'analyst', time: '1015Z', action: 'Flagged 2 incidents for cross-domain correlation' },
            { role: 'commander', time: '0955Z', action: 'Directed force posture change: WATCHCON 2' },
            { role: 'logistics', time: '0940Z', action: 'Confirmed ammo resupply convoy ETA 1400Z' },
            { role: 'diplomat', time: '0922Z', action: 'Distributed diplomatic cable to allied embassies' },
            { role: 'analyst', time: '0905Z', action: 'Published INTSUM #2026-087 to all stakeholders' },
            { role: 'commander', time: '0848Z', action: 'Set FPCON BRAVO for all CENTCOM installations' }
        ];
        return actions;
    }

    // =========================================================================
    // ROLE-SPECIFIC VIEW GENERATORS
    // =========================================================================

    _analystView() {
        const byType = {};
        const byCountry = {};
        const bySrc = {};
        const entities = {};
        const recentRaw = [];

        this.incidents.forEach(inc => {
            const t = inc.type || 'unknown';
            byType[t] = (byType[t] || 0) + 1;
            const c = inc.location?.country || 'Unknown';
            byCountry[c] = (byCountry[c] || 0) + 1;
            const s = inc.source || 'Unknown';
            bySrc[s] = (bySrc[s] || 0) + 1;

            // Entity extraction (simulated from titles)
            const title = inc.title || '';
            const entityPatterns = [/IDF/i, /Houthi/i, /Hezbollah/i, /Hamas/i, /Iran/i, /IRGC/i, /US Navy/i, /Pentagon/i, /Mossad/i, /CIA/i, /Netanyahu/i, /Saudi/i, /UAE/i, /Egypt/i];
            entityPatterns.forEach(p => {
                const m = title.match(p);
                if (m) entities[m[0]] = (entities[m[0]] || 0) + 1;
            });
        });

        const recentSlice = this.incidents.slice(0, 8);

        // Source reliability
        const srcEntries = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const srcReliability = srcEntries.map(([name, count]) => {
            const rel = count > 20 ? 'A' : count > 10 ? 'B' : count > 5 ? 'C' : 'D';
            return `<div class="citadel-src-row"><span class="citadel-src-name">${name}</span><span class="citadel-src-badge citadel-src-${rel}">${rel}</span><span class="citadel-src-count">${count} reports</span></div>`;
        }).join('');

        // Pattern detection
        const patterns = this._detectPatterns();

        // Entity tracker
        const entityRows = Object.entries(entities).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([e, c]) =>
            `<div class="citadel-entity-row"><span class="citadel-entity-name">${e}</span><span class="citadel-entity-mentions">${c} mentions</span></div>`
        ).join('');

        // Raw feed
        const rawRows = recentSlice.map(inc => {
            const sev = this._deriveSeverity(inc);
            const time = inc.published ? new Date(inc.published).toISOString().slice(11, 16) + 'Z' : '----Z';
            return `<div class="citadel-raw-row">
                <span class="citadel-raw-time">${time}</span>
                <span class="citadel-sev-dot citadel-sev-${sev}"></span>
                <span class="citadel-raw-title">${inc.title || 'Untitled'}</span>
                <span class="citadel-raw-src">${inc.source || ''}</span>
            </div>`;
        }).join('');

        // Type breakdown
        const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => {
            const pct = ((c / this.incidents.length) * 100).toFixed(1);
            return `<div class="citadel-type-row"><span class="citadel-type-label">${t}</span><div class="citadel-type-bar-track"><div class="citadel-type-bar-fill" style="width:${pct}%"></div></div><span class="citadel-type-val">${c}</span></div>`;
        }).join('');

        // Country distribution
        const countryRows = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) =>
            `<div class="citadel-country-row"><span class="citadel-country-name">${c}</span><span class="citadel-country-count">${n}</span></div>`
        ).join('');

        return `
            <div class="citadel-panels citadel-analyst-grid">
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9873;</span> RAW INTELLIGENCE FEED</div>
                    <div class="citadel-raw-feed">${rawRows || '<div class="citadel-empty">No recent data</div>'}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9878;</span> SOURCE RELIABILITY</div>
                    <div class="citadel-src-list">${srcReliability || '<div class="citadel-empty">No sources</div>'}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#8982;</span> PATTERN DETECTION</div>
                    <div class="citadel-pattern-list">${patterns}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9783;</span> ENTITY TRACKER</div>
                    <div class="citadel-entity-list">${entityRows || '<div class="citadel-empty">No entities</div>'}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9638;</span> INCIDENT TYPE BREAKDOWN</div>
                    <div class="citadel-type-list">${typeRows}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9672;</span> GEOGRAPHIC DISTRIBUTION</div>
                    <div class="citadel-country-list">${countryRows}</div>
                </div>
            </div>`;
    }

    _detectPatterns() {
        const now = Date.now();
        const last6h = this.incidents.filter(i => (now - new Date(i.published).getTime()) < 6 * 3600000);
        const last24h = this.incidents.filter(i => (now - new Date(i.published).getTime()) < 24 * 3600000);

        const patterns = [];

        // Clustering by country in last 6h
        const countryClusters = {};
        last6h.forEach(i => {
            const c = i.location?.country || 'Unknown';
            countryClusters[c] = (countryClusters[c] || 0) + 1;
        });
        Object.entries(countryClusters).forEach(([c, n]) => {
            if (n >= 3) patterns.push({ level: 'high', text: `Cluster: ${n} incidents in ${c} within 6h` });
        });

        // Escalation trend
        const first12 = this.incidents.filter(i => {
            const age = now - new Date(i.published).getTime();
            return age >= 12 * 3600000 && age < 24 * 3600000;
        }).length;
        const last12 = last6h.length + (last24h.length - last6h.length - first12);
        if (last6h.length > first12 * 1.5 && first12 > 0) {
            patterns.push({ level: 'critical', text: `Escalation: ${last6h.length} incidents in last 6h vs ${first12} prior 12h` });
        }

        // Multi-source verification gaps
        const unverified = last24h.filter(i => i.verification?.status !== 'VERIFIED').length;
        if (unverified > last24h.length * 0.7) {
            patterns.push({ level: 'medium', text: `${unverified}/${last24h.length} recent incidents lack multi-source verification` });
        }

        // High-casualty events
        const highCas = last24h.filter(i => (i.casualties?.total || 0) > 5);
        if (highCas.length > 0) {
            patterns.push({ level: 'critical', text: `${highCas.length} mass-casualty event(s) in last 24h` });
        }

        if (patterns.length === 0) {
            patterns.push({ level: 'low', text: 'No significant patterns detected in current reporting cycle' });
        }

        return patterns.map(p =>
            `<div class="citadel-pattern-item citadel-pattern-${p.level}"><span class="citadel-pattern-dot"></span>${p.text}</div>`
        ).join('');
    }

    _commanderView() {
        const cop = this.cop;
        const critical = this.incidents.filter(i => this._deriveSeverity(i) === 'critical');
        const high = this.incidents.filter(i => this._deriveSeverity(i) === 'high');

        // Decision brief
        const topThreats = [...critical, ...high].slice(0, 5).map(inc => {
            const sev = this._deriveSeverity(inc);
            const country = inc.location?.country || 'Unknown';
            return `<div class="citadel-threat-row">
                <span class="citadel-sev-badge citadel-sev-${sev}">${sev.toUpperCase()}</span>
                <span class="citadel-threat-title">${inc.title || 'Untitled'}</span>
                <span class="citadel-threat-loc">${country}</span>
            </div>`;
        }).join('');

        // Force readiness
        const readinessItems = [
            { unit: '5th Fleet', status: 'READY', pct: 92 },
            { unit: 'CENTCOM Air', status: 'READY', pct: 88 },
            { unit: 'Ground Forces', status: cop.threatLevel === 'CRITICAL' ? 'DEGRADED' : 'READY', pct: cop.threatLevel === 'CRITICAL' ? 67 : 85 },
            { unit: 'SOF Elements', status: 'READY', pct: 95 },
            { unit: 'ISR Assets', status: cop.critical > 3 ? 'STRAINED' : 'READY', pct: cop.critical > 3 ? 72 : 90 },
            { unit: 'Missile Defense', status: 'READY', pct: 94 }
        ].map(r => {
            const cls = r.status === 'READY' ? 'green' : r.status === 'DEGRADED' ? 'red' : 'yellow';
            return `<div class="citadel-readiness-row">
                <span class="citadel-readiness-unit">${r.unit}</span>
                <div class="citadel-readiness-bar-track"><div class="citadel-readiness-bar-fill citadel-bar-${cls}" style="width:${r.pct}%"></div></div>
                <span class="citadel-readiness-status citadel-status-${cls}">${r.status}</span>
            </div>`;
        }).join('');

        // Recommended actions
        const actions = [];
        if (cop.threatLevel === 'CRITICAL' || cop.threatLevel === 'HIGH') {
            actions.push({ priority: 'IMMEDIATE', text: 'Elevate WATCHCON to Level 2. Activate reserve ISR orbits.' });
            actions.push({ priority: 'IMMEDIATE', text: 'Direct maritime patrol reinforcement for Strait of Hormuz.' });
        }
        if (cop.critical > 0) {
            actions.push({ priority: 'PRIORITY', text: `${cop.critical} critical incident(s) require command decision within 2h.` });
        }
        actions.push({ priority: 'ROUTINE', text: 'Continue monitoring. Next SITREP due 1800Z.' });
        actions.push({ priority: 'ROUTINE', text: 'Coordinate with allied CAOC for shared airspace deconfliction.' });

        const actionRows = actions.map(a =>
            `<div class="citadel-action-row citadel-action-${a.priority.toLowerCase()}">
                <span class="citadel-action-pri">${a.priority}</span>
                <span class="citadel-action-text">${a.text}</span>
            </div>`
        ).join('');

        // Threat prioritization matrix
        const byCountry = {};
        this.incidents.forEach(i => {
            const c = i.location?.country || 'Unknown';
            if (!byCountry[c]) byCountry[c] = { critical: 0, high: 0, medium: 0, low: 0 };
            byCountry[c][this._deriveSeverity(i)]++;
        });
        const matrixRows = Object.entries(byCountry)
            .sort((a, b) => (b[1].critical * 10 + b[1].high * 3) - (a[1].critical * 10 + a[1].high * 3))
            .slice(0, 6)
            .map(([c, s]) =>
                `<div class="citadel-matrix-row">
                    <span class="citadel-matrix-country">${c}</span>
                    <span class="citadel-matrix-cell citadel-sev-critical">${s.critical}</span>
                    <span class="citadel-matrix-cell citadel-sev-high">${s.high}</span>
                    <span class="citadel-matrix-cell citadel-sev-medium">${s.medium}</span>
                    <span class="citadel-matrix-cell citadel-sev-low">${s.low}</span>
                </div>`
            ).join('');

        // Operational tempo
        const now = Date.now();
        const tempo6h = this.incidents.filter(i => (now - new Date(i.published).getTime()) < 6 * 3600000).length;
        const tempo12h = this.incidents.filter(i => (now - new Date(i.published).getTime()) < 12 * 3600000).length;
        const tempo24h = this.incidents.filter(i => (now - new Date(i.published).getTime()) < 24 * 3600000).length;

        return `
            <div class="citadel-panels citadel-commander-grid">
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon" style="color:#ff3d3d">&#9733;</span> DECISION BRIEF — TOP THREATS</div>
                    <div class="citadel-threat-list">${topThreats || '<div class="citadel-empty">No critical threats</div>'}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon" style="color:#00ff88">&#9655;</span> FORCE READINESS</div>
                    <div class="citadel-readiness-list">${readinessItems}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon" style="color:#ff3d3d">&#9888;</span> RECOMMENDED ACTIONS</div>
                    <div class="citadel-action-list">${actionRows}</div>
                </div>
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9638;</span> THREAT PRIORITIZATION MATRIX</div>
                    <div class="citadel-matrix-header">
                        <span class="citadel-matrix-country">SECTOR</span>
                        <span class="citadel-matrix-cell">CRIT</span>
                        <span class="citadel-matrix-cell">HIGH</span>
                        <span class="citadel-matrix-cell">MED</span>
                        <span class="citadel-matrix-cell">LOW</span>
                    </div>
                    <div class="citadel-matrix-list">${matrixRows}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#8986;</span> OPERATIONAL TEMPO</div>
                    <div class="citadel-tempo">
                        <div class="citadel-tempo-row"><span>Last 6h</span><span class="citadel-tempo-val">${tempo6h} events</span></div>
                        <div class="citadel-tempo-row"><span>Last 12h</span><span class="citadel-tempo-val">${tempo12h} events</span></div>
                        <div class="citadel-tempo-row"><span>Last 24h</span><span class="citadel-tempo-val">${tempo24h} events</span></div>
                        <div class="citadel-tempo-row citadel-tempo-highlight"><span>Trend</span><span class="citadel-tempo-val">${tempo6h > tempo12h - tempo6h ? '&#9650; INCREASING' : '&#9660; STABLE'}</span></div>
                    </div>
                </div>
            </div>`;
    }

    _diplomatView() {
        const byCountry = {};
        this.incidents.forEach(i => {
            const c = i.location?.country || 'Unknown';
            if (!byCountry[c]) byCountry[c] = [];
            byCountry[c].push(i);
        });

        // Political implications
        const implications = [];
        const countries = Object.keys(byCountry);
        if (byCountry['Israel']?.length > 10) implications.push({ level: 'high', text: `Israel: ${byCountry['Israel'].length} active incidents — bilateral tensions elevated. Monitor Knesset statements.` });
        if (byCountry['Iran']?.length > 5) implications.push({ level: 'critical', text: `Iran: ${byCountry['Iran'].length} incidents — JCPOA implications. P5+1 coordination required.` });
        if (byCountry['Yemen']?.length > 3) implications.push({ level: 'high', text: `Yemen/Houthi activity: ${byCountry['Yemen']?.length || 0} incidents — Red Sea shipping insurance rates rising.` });
        if (byCountry['Syria']?.length > 3) implications.push({ level: 'medium', text: `Syria: ${byCountry['Syria']?.length || 0} incidents — Monitor Russian and Turkish posture.` });
        if (byCountry['Lebanon']?.length > 2) implications.push({ level: 'high', text: `Lebanon: ${byCountry['Lebanon']?.length || 0} incidents — UNIFIL mandate under stress.` });
        if (implications.length === 0) implications.push({ level: 'low', text: 'No significant political escalation detected in current cycle.' });

        const implRows = implications.map(p =>
            `<div class="citadel-impl-row citadel-impl-${p.level}"><span class="citadel-impl-dot"></span>${p.text}</div>`
        ).join('');

        // Alliance impact
        const alliances = [
            { name: 'US-Israel', status: this.incidents.some(i => /settler|annexation|un vote/i.test(i.title)) ? 'STRAINED' : 'STRONG', detail: 'Strategic partnership intact; tactical friction on settlement policy' },
            { name: 'GCC Bloc', status: 'STABLE', detail: 'Abraham Accords framework holding; economic normalization ongoing' },
            { name: 'NATO-MENA', status: 'MONITORING', detail: 'Article 5 not invoked; partnership framework active' },
            { name: 'Iran-Russia Axis', status: 'CONCERNING', detail: 'Military cooperation deepening; drone technology transfer confirmed' },
            { name: 'China-Gulf', status: 'EXPANDING', detail: 'BRI infrastructure investment accelerating; dual-use concerns' }
        ].map(a => {
            const cls = a.status === 'STRONG' ? 'green' : a.status === 'STRAINED' ? 'red' : a.status === 'CONCERNING' ? 'red' : 'yellow';
            return `<div class="citadel-alliance-row">
                <span class="citadel-alliance-name">${a.name}</span>
                <span class="citadel-alliance-status citadel-status-${cls}">${a.status}</span>
                <span class="citadel-alliance-detail">${a.detail}</span>
            </div>`;
        }).join('');

        // Escalation risk gauge
        const critCount = this.incidents.filter(i => this._deriveSeverity(i) === 'critical').length;
        const escRisk = Math.min(100, critCount * 12 + this.incidents.length * 0.15);
        const riskLabel = escRisk > 70 ? 'SEVERE' : escRisk > 45 ? 'ELEVATED' : escRisk > 20 ? 'MODERATE' : 'LOW';

        // Diplomatic channels
        const channels = [
            { channel: 'UN Security Council', status: 'ACTIVE', lastComms: '0830Z' },
            { channel: 'GCC Ministerial Hotline', status: 'STANDBY', lastComms: '0600Z' },
            { channel: 'Oman Back-Channel', status: 'ACTIVE', lastComms: '0945Z' },
            { channel: 'Doha Mediation Office', status: 'ACTIVE', lastComms: '0715Z' },
            { channel: 'EU EEAS Contact Group', status: 'STANDBY', lastComms: '0500Z' },
            { channel: 'Cairo Ceasefire Track', status: critCount > 2 ? 'URGENT' : 'ACTIVE', lastComms: '1020Z' }
        ].map(ch => {
            const cls = ch.status === 'URGENT' ? 'red' : ch.status === 'ACTIVE' ? 'green' : 'yellow';
            return `<div class="citadel-channel-row">
                <span class="citadel-channel-name">${ch.channel}</span>
                <span class="citadel-channel-status citadel-status-${cls}">${ch.status}</span>
                <span class="citadel-channel-time">${ch.lastComms}</span>
            </div>`;
        }).join('');

        // Country incident summary for diplomat
        const countrySummary = Object.entries(byCountry).sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([c, incs]) =>
            `<div class="citadel-country-summary-row"><span class="citadel-country-name">${c}</span><span class="citadel-country-count">${incs.length} incidents</span></div>`
        ).join('');

        return `
            <div class="citadel-panels citadel-diplomat-grid">
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon" style="color:#b388ff">&#9878;</span> POLITICAL IMPLICATIONS</div>
                    <div class="citadel-impl-list">${implRows}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#127760;</span> ALLIANCE IMPACT ASSESSMENT</div>
                    <div class="citadel-alliance-list">${alliances}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9888;</span> ESCALATION RISK</div>
                    <div class="citadel-escalation-gauge">
                        <div class="citadel-gauge-ring" style="--risk-pct:${escRisk}; --risk-color:${escRisk > 70 ? '#ff3d3d' : escRisk > 45 ? '#ff9100' : '#00ff88'}">
                            <div class="citadel-gauge-inner">
                                <span class="citadel-gauge-value">${Math.round(escRisk)}</span>
                                <span class="citadel-gauge-label">${riskLabel}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#128225;</span> DIPLOMATIC CHANNELS</div>
                    <div class="citadel-channel-list">${channels}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9672;</span> REGIONAL SITUATION BY COUNTRY</div>
                    <div class="citadel-country-list">${countrySummary}</div>
                </div>
            </div>`;
    }

    _logisticsView() {
        const cop = this.cop;
        const totalCas = this.incidents.reduce((s, i) => s + (i.casualties?.total || 0), 0);

        // Supply chain status
        const supplies = [
            { item: 'PATRIOT Interceptors', stock: cop.threatLevel === 'CRITICAL' ? 43 : 78, min: 50, depot: 'Al Udeid AB' },
            { item: 'Jet Fuel (JP-8)', stock: 85, min: 60, depot: 'Bahrain Naval' },
            { item: 'Small Arms Ammunition', stock: 92, min: 70, depot: 'Camp Arifjan' },
            { item: 'Medical Supplies', stock: totalCas > 20 ? 55 : 88, min: 65, depot: 'Landstuhl LRMC' },
            { item: 'MRE Rations', stock: 91, min: 50, depot: 'Camp Buehring' },
            { item: 'Comms Equipment', stock: 82, min: 60, depot: 'Al Dhafra AB' },
            { item: 'Vehicle Parts', stock: 71, min: 55, depot: 'Camp Arifjan' },
            { item: 'UAV Components', stock: cop.critical > 3 ? 48 : 76, min: 50, depot: 'Al Udeid AB' }
        ].map(s => {
            const cls = s.stock < s.min ? 'red' : s.stock < s.min + 15 ? 'yellow' : 'green';
            return `<div class="citadel-supply-row">
                <span class="citadel-supply-item">${s.item}</span>
                <div class="citadel-supply-bar-track"><div class="citadel-supply-bar-fill citadel-bar-${cls}" style="width:${s.stock}%"></div></div>
                <span class="citadel-supply-pct citadel-status-${cls}">${s.stock}%</span>
                <span class="citadel-supply-depot">${s.depot}</span>
            </div>`;
        }).join('');

        // Force movement
        const movements = [
            { unit: 'CVN-77 Strike Group', from: 'Med Sea', to: 'Red Sea', eta: '1800Z', status: 'IN TRANSIT' },
            { unit: 'B-52H Sortie x2', from: 'Diego Garcia', to: 'AOR', eta: '1400Z', status: 'AIRBORNE' },
            { unit: 'MEDEVAC Flight', from: 'Kuwait', to: 'Landstuhl', eta: '2200Z', status: totalCas > 10 ? 'URGENT' : 'SCHEDULED' },
            { unit: 'Resupply Convoy C-17', from: 'Ramstein', to: 'Al Udeid', eta: '0600+1', status: 'SCHEDULED' },
            { unit: 'SOF Rotary Wing', from: 'Djibouti', to: 'Classified', eta: '----Z', status: 'CLASSIFIED' }
        ].map(m => {
            const cls = m.status === 'URGENT' ? 'red' : m.status === 'AIRBORNE' || m.status === 'IN TRANSIT' ? 'green' : 'yellow';
            return `<div class="citadel-movement-row">
                <span class="citadel-movement-unit">${m.unit}</span>
                <span class="citadel-movement-route">${m.from} &#10142; ${m.to}</span>
                <span class="citadel-movement-eta">${m.eta}</span>
                <span class="citadel-movement-status citadel-status-${cls}">${m.status}</span>
            </div>`;
        }).join('');

        // Resource allocation
        const budgetItems = [
            { category: 'Air Operations', allocated: 42, spent: 38 },
            { category: 'Maritime Patrol', allocated: 28, spent: 25 },
            { category: 'Ground Forces', allocated: 18, spent: 16 },
            { category: 'Intelligence', allocated: 12, spent: 11 }
        ].map(b => {
            const spentPct = ((b.spent / b.allocated) * 100).toFixed(0);
            return `<div class="citadel-budget-row">
                <span class="citadel-budget-cat">${b.category}</span>
                <div class="citadel-budget-bar-track">
                    <div class="citadel-budget-bar-alloc" style="width:${b.allocated}%"></div>
                    <div class="citadel-budget-bar-spent" style="width:${b.spent}%"></div>
                </div>
                <span class="citadel-budget-val">${spentPct}% utilized</span>
            </div>`;
        }).join('');

        // Sustainment risks
        const risks = [];
        if (cop.threatLevel === 'CRITICAL' || cop.threatLevel === 'HIGH') {
            risks.push({ level: 'critical', text: 'Interceptor stocks below minimum at current expenditure rate. Resupply critical within 48h.' });
        }
        if (totalCas > 10) {
            risks.push({ level: 'high', text: `${totalCas} casualties reported — MEDEVAC capacity may exceed surge threshold.` });
        }
        risks.push({ level: 'medium', text: 'Extended ops tempo degrading vehicle maintenance cycle by 15%.' });
        risks.push({ level: 'low', text: 'Fuel reserves adequate for 14-day sustained operations.' });

        const riskRows = risks.map(r =>
            `<div class="citadel-risk-row citadel-risk-${r.level}"><span class="citadel-risk-dot"></span>${r.text}</div>`
        ).join('');

        return `
            <div class="citadel-panels citadel-logistics-grid">
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon" style="color:#ff9100">&#9881;</span> SUPPLY CHAIN STATUS</div>
                    <div class="citadel-supply-list">${supplies}</div>
                </div>
                <div class="citadel-panel citadel-panel-wide">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9992;</span> FORCE MOVEMENT TRACKER</div>
                    <div class="citadel-movement-list">${movements}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#128176;</span> RESOURCE ALLOCATION</div>
                    <div class="citadel-budget-list">${budgetItems}</div>
                </div>
                <div class="citadel-panel">
                    <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9888;</span> SUSTAINMENT RISKS</div>
                    <div class="citadel-risk-list">${riskRows}</div>
                </div>
            </div>`;
    }

    // =========================================================================
    // RENDER
    // =========================================================================

    _renderCOP() {
        const cop = this.cop;
        const threatCls = cop.threatLevel === 'CRITICAL' ? 'critical' : cop.threatLevel === 'HIGH' ? 'high' : cop.threatLevel === 'ELEVATED' ? 'medium' : 'low';
        return `
            <div class="citadel-cop">
                <div class="citadel-cop-item">
                    <span class="citadel-cop-label">THREAT LEVEL</span>
                    <span class="citadel-cop-value citadel-threat-${threatCls}">${cop.threatLevel}</span>
                </div>
                <div class="citadel-cop-divider"></div>
                <div class="citadel-cop-item">
                    <span class="citadel-cop-label">ACTIVE INCIDENTS</span>
                    <span class="citadel-cop-value">${cop.total}</span>
                </div>
                <div class="citadel-cop-divider"></div>
                <div class="citadel-cop-item">
                    <span class="citadel-cop-label">CRITICAL</span>
                    <span class="citadel-cop-value citadel-threat-critical">${cop.critical}</span>
                </div>
                <div class="citadel-cop-divider"></div>
                <div class="citadel-cop-item">
                    <span class="citadel-cop-label">VERIFIED</span>
                    <span class="citadel-cop-value">${cop.verified}</span>
                </div>
                <div class="citadel-cop-divider"></div>
                <div class="citadel-cop-item">
                    <span class="citadel-cop-label">FORCE READINESS</span>
                    <span class="citadel-cop-value" style="color:${cop.readiness > 80 ? '#00ff88' : cop.readiness > 60 ? '#ff9100' : '#ff3d3d'}">${cop.readiness}%</span>
                </div>
            </div>`;
    }

    _renderRoleTabs() {
        return Object.entries(this.roles).map(([key, role]) =>
            `<button class="citadel-role-tab ${key === this.activeRole ? 'citadel-role-active' : ''}" data-role="${key}" style="--role-color:${role.color}" onclick="window._citadelSwitchRole && window._citadelSwitchRole('${key}')">
                <span class="citadel-role-icon">${role.icon}</span>
                <span class="citadel-role-label">${role.label}</span>
            </button>`
        ).join('');
    }

    _renderAccessBanner() {
        const role = this.roles[this.activeRole];
        return `
            <div class="citadel-access-banner" style="--role-color:${role.color}">
                <span class="citadel-access-role">${role.short}</span>
                <span class="citadel-access-class">${role.classification}</span>
                <span class="citadel-access-time">${new Date().toISOString().slice(11, 16)}Z</span>
            </div>`;
    }

    _renderActivityLog() {
        const rows = this.activityLog.map(a => {
            const role = this.roles[a.role];
            return `<div class="citadel-log-row">
                <span class="citadel-log-time">${a.time}</span>
                <span class="citadel-log-role" style="color:${role.color}">${role.short}</span>
                <span class="citadel-log-action">${a.action}</span>
            </div>`;
        }).join('');

        return `
            <div class="citadel-sidebar-panel">
                <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9776;</span> ACTIVITY LOG</div>
                <div class="citadel-log-list">${rows}</div>
            </div>`;
    }

    _renderAnnotations() {
        const rows = this.annotations.map(a => {
            const role = this.roles[a.role];
            return `<div class="citadel-annotation-row">
                <div class="citadel-annotation-meta">
                    <span class="citadel-annotation-author" style="color:${role.color}">${a.author}</span>
                    <span class="citadel-annotation-time">${a.time}</span>
                </div>
                <div class="citadel-annotation-text">${a.text}</div>
            </div>`;
        }).join('');

        return `
            <div class="citadel-sidebar-panel">
                <div class="citadel-panel-header"><span class="citadel-panel-icon">&#9998;</span> SHARED ANNOTATIONS</div>
                <div class="citadel-annotation-list">${rows}</div>
            </div>`;
    }

    render() {
        let roleView;
        switch (this.activeRole) {
            case 'analyst': roleView = this._analystView(); break;
            case 'commander': roleView = this._commanderView(); break;
            case 'diplomat': roleView = this._diplomatView(); break;
            case 'logistics': roleView = this._logisticsView(); break;
            default: roleView = this._analystView();
        }

        return `
            <div class="citadel-workspace">
                ${this._renderCOP()}
                <div class="citadel-role-selector">${this._renderRoleTabs()}</div>
                ${this._renderAccessBanner()}
                <div class="citadel-main-layout">
                    <div class="citadel-main-content">${roleView}</div>
                    <div class="citadel-sidebar">
                        ${this._renderActivityLog()}
                        ${this._renderAnnotations()}
                    </div>
                </div>
            </div>`;
    }
}

// =============================================================================
// RENDER FUNCTION
// =============================================================================

function renderCitadel(incidents, activeRole) {
    const engine = new CitadelEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));
    if (activeRole) engine.activeRole = activeRole;
    return engine.render();
}

// =============================================================================
// ROLE SWITCH HANDLER
// =============================================================================

window._citadelSwitchRole = function(role) {
    const container = document.querySelector('.citadel-workspace')?.parentElement;
    if (container) {
        const incidents = typeof state !== 'undefined' ? state.incidents : [];
        container.innerHTML = renderCitadel(incidents, role);
    }
};

// =============================================================================
// EXPORTS
// =============================================================================

window.CitadelEngine = CitadelEngine;
window.renderCitadel = renderCitadel;
