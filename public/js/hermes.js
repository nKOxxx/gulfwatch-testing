/**
 * HERMES — Automated Intelligence Briefing Generator
 * Generates SALUTE, SITREP, Commander's Daily Brief, and Flash Reports
 * from live incident data in standard military intelligence formats.
 */

// =====================================================================
// BRIEFING ENGINE
// =====================================================================

class HermesEngine {
    constructor(incidents, options = {}) {
        this.incidents = incidents || [];
        this.options = {
            timeWindow: options.timeWindow || '24h',
            classification: options.classification || 'UNCLASSIFIED',
            region: options.region || 'all',
            format: options.format || 'cdb',
            ...options
        };
        this.filtered = this.filterIncidents();
        this.analysis = this.analyzeIncidents();
    }

    // =====================================================================
    // DATA FILTERING
    // =====================================================================

    filterIncidents() {
        const now = Date.now();
        const windowMs = {
            '6h': 6 * 3600000, '12h': 12 * 3600000, '24h': 24 * 3600000,
            '48h': 48 * 3600000, '7d': 7 * 86400000, '30d': 30 * 86400000
        }[this.options.timeWindow] || 86400000;

        let filtered = this.incidents.filter(inc => {
            const ts = new Date(inc.published || inc.timestamp).getTime();
            return (now - ts) < windowMs;
        });

        if (this.options.region !== 'all') {
            filtered = filtered.filter(inc => {
                const loc = (inc.location || inc.country || inc.title || '').toLowerCase();
                return loc.includes(this.options.region.toLowerCase());
            });
        }

        return filtered;
    }

    // =====================================================================
    // INCIDENT ANALYSIS
    // =====================================================================

    analyzeIncidents() {
        const incidents = this.filtered;
        const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        const typeCounts = {};
        const regionCounts = {};
        const actors = new Set();
        const timeline = [];

        incidents.forEach(inc => {
            const sev = (inc.severity || 'medium').toLowerCase();
            severityCounts[sev] = (severityCounts[sev] || 0) + 1;

            const type = inc.type || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;

            const region = inc.country || inc.location || 'Unknown';
            regionCounts[region] = (regionCounts[region] || 0) + 1;

            const title = (inc.title || '').toLowerCase();
            if (/houthi/.test(title)) actors.add('Houthi Forces');
            if (/iran|irgc/.test(title)) actors.add('Iranian Forces / IRGC');
            if (/hezbollah/.test(title)) actors.add('Hezbollah');
            if (/hamas/.test(title)) actors.add('Hamas');
            if (/israel|idf/.test(title)) actors.add('IDF / Israeli Forces');
            if (/us |usa|american|coalition/.test(title)) actors.add('US / Coalition Forces');
            if (/saudi/.test(title)) actors.add('Saudi Arabian Forces');
            if (/uae|emirati/.test(title)) actors.add('UAE Forces');

            timeline.push({
                time: new Date(inc.published || inc.timestamp),
                title: inc.title,
                severity: sev,
                type: type
            });
        });

        timeline.sort((a, b) => b.time - a.time);

        const threatLevel = severityCounts.critical > 2 ? 'CRITICAL' :
            severityCounts.critical > 0 || severityCounts.high > 3 ? 'ELEVATED' :
            severityCounts.high > 0 ? 'SUBSTANTIAL' : 'MODERATE';

        const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
        const dominantRegion = Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0];

        return {
            total: incidents.length,
            severityCounts,
            typeCounts,
            regionCounts,
            actors: [...actors],
            timeline: timeline.slice(0, 20),
            threatLevel,
            dominantType: dominantType ? dominantType[0] : 'N/A',
            dominantRegion: dominantRegion ? dominantRegion[0] : 'N/A',
            windowLabel: this.options.timeWindow.toUpperCase()
        };
    }

    // =====================================================================
    // THREAT ASSESSMENT
    // =====================================================================

    getThreatAssessment() {
        const a = this.analysis;
        const lines = [];

        if (a.total === 0) return 'No reportable incidents within the selected time window.';

        lines.push(`Overall threat level assessed as ${a.threatLevel} based on ${a.total} incidents in the past ${a.windowLabel}.`);

        if (a.severityCounts.critical > 0) {
            lines.push(`CRITICAL: ${a.severityCounts.critical} critical incident(s) requiring immediate command attention.`);
        }

        if (a.actors.length > 0) {
            lines.push(`Active threat actors: ${a.actors.join(', ')}.`);
        }

        if (a.dominantType !== 'N/A') {
            lines.push(`Primary threat vector: ${a.dominantType} (${a.typeCounts[a.dominantType]} incidents).`);
        }

        if (a.dominantRegion !== 'N/A') {
            lines.push(`Area of highest activity: ${a.dominantRegion} (${a.regionCounts[a.dominantRegion]} incidents).`);
        }

        return lines.join(' ');
    }

    // =====================================================================
    // RECOMMENDATIONS
    // =====================================================================

    getRecommendations() {
        const a = this.analysis;
        const recs = [];

        if (a.severityCounts.critical > 0) {
            recs.push({ priority: 'IMMEDIATE', text: 'Convene emergency threat assessment for critical incidents. Ensure force protection measures are at maximum readiness.' });
        }

        if (a.typeCounts['missile'] > 0 || a.typeCounts['ballistic'] > 0) {
            recs.push({ priority: 'HIGH', text: 'Verify air defense readiness across all sectors. Confirm interceptor inventory and engagement protocols.' });
        }

        if (a.typeCounts['drone'] > 0 || a.typeCounts['uav'] > 0) {
            recs.push({ priority: 'HIGH', text: 'Activate counter-UAS measures. Review electronic warfare posture and low-altitude radar coverage.' });
        }

        if (a.actors.includes('Houthi Forces')) {
            recs.push({ priority: 'MEDIUM', text: 'Monitor Red Sea shipping lanes. Issue NAVAREA warning updates to commercial maritime traffic.' });
        }

        if (a.typeCounts['maritime'] > 0 || a.typeCounts['naval'] > 0) {
            recs.push({ priority: 'MEDIUM', text: 'Increase maritime patrol frequency. Coordinate with naval assets for expanded surveillance coverage.' });
        }

        if (a.total > 10) {
            recs.push({ priority: 'MEDIUM', text: 'Increase ISR allocation to high-activity sectors. Consider surge intelligence collection posture.' });
        }

        if (recs.length === 0) {
            recs.push({ priority: 'ROUTINE', text: 'Maintain current force protection posture. Continue standard monitoring and reporting procedures.' });
        }

        return recs;
    }

    // =====================================================================
    // BRIEFING GENERATORS
    // =====================================================================

    generateBriefing() {
        switch (this.options.format) {
            case 'salute': return this.generateSALUTE();
            case 'sitrep': return this.generateSITREP();
            case 'flash': return this.generateFlash();
            case 'cdb':
            default: return this.generateCDB();
        }
    }

    // Commander's Daily Brief
    generateCDB() {
        const a = this.analysis;
        const now = new Date();
        const dtg = this.formatDTG(now);
        const recs = this.getRecommendations();
        const criticals = this.filtered.filter(i => i.severity === 'critical');
        const highs = this.filtered.filter(i => i.severity === 'high');

        return {
            type: 'COMMANDER\'S DAILY BRIEF',
            typeShort: 'CDB',
            dtg,
            classification: this.options.classification,
            sections: [
                {
                    title: 'EXECUTIVE SUMMARY',
                    icon: '📋',
                    content: this.getThreatAssessment(),
                    highlight: a.threatLevel === 'CRITICAL' || a.threatLevel === 'ELEVATED'
                },
                {
                    title: 'THREAT OVERVIEW',
                    icon: '⚠️',
                    content: null,
                    table: {
                        headers: ['Category', 'Count', 'Trend'],
                        rows: Object.entries(a.typeCounts).map(([type, count]) => [
                            type.charAt(0).toUpperCase() + type.slice(1),
                            count.toString(),
                            count > 3 ? '↑ Increasing' : count > 1 ? '→ Stable' : '↓ Isolated'
                        ])
                    }
                },
                {
                    title: 'CRITICAL INCIDENTS',
                    icon: '🔴',
                    content: criticals.length === 0 ? 'No critical incidents in reporting period.' : null,
                    items: criticals.map(inc => ({
                        time: this.formatDTG(new Date(inc.published || inc.timestamp)),
                        text: inc.title,
                        severity: 'critical'
                    }))
                },
                {
                    title: 'HIGH PRIORITY INCIDENTS',
                    icon: '🟠',
                    content: highs.length === 0 ? 'No high-priority incidents in reporting period.' : null,
                    items: highs.slice(0, 8).map(inc => ({
                        time: this.formatDTG(new Date(inc.published || inc.timestamp)),
                        text: inc.title,
                        severity: 'high'
                    }))
                },
                {
                    title: 'REGIONAL ACTIVITY',
                    icon: '🗺️',
                    content: null,
                    table: {
                        headers: ['Region', 'Incidents', 'Severity'],
                        rows: Object.entries(a.regionCounts)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 8)
                            .map(([region, count]) => {
                                const regInc = this.filtered.filter(i => (i.country || i.location || '') === region);
                                const maxSev = regInc.some(i => i.severity === 'critical') ? 'CRITICAL' :
                                    regInc.some(i => i.severity === 'high') ? 'HIGH' : 'MODERATE';
                                return [region, count.toString(), maxSev];
                            })
                    }
                },
                {
                    title: 'ACTIVE THREAT ACTORS',
                    icon: '🎯',
                    content: a.actors.length > 0 ? a.actors.join(' • ') : 'No attributed threat actors identified in reporting period.'
                },
                {
                    title: 'RECOMMENDATIONS',
                    icon: '📌',
                    content: null,
                    recommendations: recs
                },
                {
                    title: 'STATISTICS',
                    icon: '📊',
                    content: null,
                    stats: [
                        { label: 'Total Incidents', value: a.total },
                        { label: 'Critical', value: a.severityCounts.critical },
                        { label: 'High', value: a.severityCounts.high },
                        { label: 'Medium', value: a.severityCounts.medium },
                        { label: 'Low', value: a.severityCounts.low },
                        { label: 'Threat Level', value: a.threatLevel },
                        { label: 'Reporting Window', value: a.windowLabel },
                        { label: 'Active Actors', value: a.actors.length }
                    ]
                }
            ]
        };
    }

    // SALUTE Report
    generateSALUTE() {
        const a = this.analysis;
        const now = new Date();
        const topIncidents = this.filtered.slice(0, 5);

        return {
            type: 'SALUTE REPORT',
            typeShort: 'SALUTE',
            dtg: this.formatDTG(now),
            classification: this.options.classification,
            sections: [
                {
                    title: 'S — SIZE',
                    icon: '👥',
                    content: `${a.total} total incidents reported. ${a.severityCounts.critical} critical, ${a.severityCounts.high} high priority. ${a.actors.length} distinct threat actor group(s) identified.`
                },
                {
                    title: 'A — ACTIVITY',
                    icon: '⚡',
                    content: `Primary activity: ${a.dominantType} operations (${a.typeCounts[a.dominantType] || 0} incidents). ` +
                        Object.entries(a.typeCounts).filter(([k]) => k !== a.dominantType).map(([k, v]) => `${k}: ${v}`).join(', ') + '.',
                    items: topIncidents.map(inc => ({
                        time: this.formatDTG(new Date(inc.published || inc.timestamp)),
                        text: inc.title,
                        severity: inc.severity || 'medium'
                    }))
                },
                {
                    title: 'L — LOCATION',
                    icon: '📍',
                    content: `Primary area of operations: ${a.dominantRegion}.`,
                    table: {
                        headers: ['Location', 'Incidents', 'Primary Threat'],
                        rows: Object.entries(a.regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, c]) => {
                            const types = {};
                            this.filtered.filter(i => (i.country || i.location || '') === r).forEach(i => {
                                types[i.type || 'unknown'] = (types[i.type || 'unknown'] || 0) + 1;
                            });
                            const top = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
                            return [r, c.toString(), top ? top[0] : 'Mixed'];
                        })
                    }
                },
                {
                    title: 'U — UNIT / ATTRIBUTION',
                    icon: '🏴',
                    content: a.actors.length > 0
                        ? `Attributed actors: ${a.actors.join(', ')}. Attribution confidence varies by incident.`
                        : 'No definitive unit attribution in current reporting period. Further intelligence collection recommended.'
                },
                {
                    title: 'T — TIME',
                    icon: '🕐',
                    content: `Reporting window: Last ${a.windowLabel}. Report generated: ${this.formatDTG(now)}.`,
                    items: a.timeline.slice(0, 5).map(t => ({
                        time: this.formatDTG(t.time),
                        text: t.title,
                        severity: t.severity
                    }))
                },
                {
                    title: 'E — EQUIPMENT',
                    icon: '🛡️',
                    content: this.getEquipmentAssessment()
                },
                {
                    title: 'ASSESSMENT',
                    icon: '📋',
                    content: this.getThreatAssessment(),
                    highlight: a.threatLevel === 'CRITICAL' || a.threatLevel === 'ELEVATED'
                },
                {
                    title: 'RECOMMENDATIONS',
                    icon: '📌',
                    content: null,
                    recommendations: this.getRecommendations()
                }
            ]
        };
    }

    // SITREP
    generateSITREP() {
        const a = this.analysis;
        const now = new Date();

        return {
            type: 'SITUATION REPORT',
            typeShort: 'SITREP',
            dtg: this.formatDTG(now),
            classification: this.options.classification,
            sections: [
                {
                    title: '1. SITUATION',
                    icon: '🌐',
                    content: this.getThreatAssessment(),
                    highlight: a.threatLevel === 'CRITICAL' || a.threatLevel === 'ELEVATED'
                },
                {
                    title: '2. ENEMY FORCES',
                    icon: '🔴',
                    content: a.actors.length > 0
                        ? `Identified hostile actors: ${a.actors.join(', ')}. Assessed intent: continued ${a.dominantType} operations targeting regional infrastructure and military assets.`
                        : 'No confirmed enemy force identification in current reporting period.',
                    items: this.filtered.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 6).map(inc => ({
                        time: this.formatDTG(new Date(inc.published || inc.timestamp)),
                        text: inc.title,
                        severity: inc.severity
                    }))
                },
                {
                    title: '3. FRIENDLY FORCES',
                    icon: '🔵',
                    content: 'Coalition and allied forces maintaining defensive posture. Air defense systems operational across all sectors. Maritime patrol assets deployed to assigned stations.'
                },
                {
                    title: '4. OPERATIONS SUMMARY',
                    icon: '⚔️',
                    content: null,
                    table: {
                        headers: ['Category', 'Count', 'Status'],
                        rows: Object.entries(a.typeCounts).map(([type, count]) => [
                            type.charAt(0).toUpperCase() + type.slice(1),
                            count.toString(),
                            count > 5 ? 'ACTIVE THREAT' : count > 2 ? 'ELEVATED' : 'MONITORING'
                        ])
                    }
                },
                {
                    title: '5. LOGISTICS / SUPPORT',
                    icon: '🔧',
                    content: 'All critical systems operational. Interceptor reserves within acceptable parameters. Intelligence collection assets fully tasked.'
                },
                {
                    title: '6. COMMAND & SIGNAL',
                    icon: '📡',
                    content: `Report period: ${a.windowLabel}. Next scheduled update: ${this.formatDTG(new Date(now.getTime() + (this.options.timeWindow === '6h' ? 6 * 3600000 : 24 * 3600000)))}.`
                },
                {
                    title: 'COMMANDER\'S ASSESSMENT',
                    icon: '🎖️',
                    content: this.getCommanderAssessment(),
                    highlight: true
                },
                {
                    title: 'RECOMMENDATIONS',
                    icon: '📌',
                    content: null,
                    recommendations: this.getRecommendations()
                }
            ]
        };
    }

    // Flash Report
    generateFlash() {
        const a = this.analysis;
        const now = new Date();
        const top = this.filtered[0];

        return {
            type: 'FLASH REPORT',
            typeShort: 'FLASH',
            dtg: this.formatDTG(now),
            classification: this.options.classification,
            flash: true,
            sections: [
                {
                    title: 'FLASH — IMMEDIATE',
                    icon: '🚨',
                    content: top ? top.title : 'No incidents to report.',
                    highlight: true
                },
                {
                    title: 'INCIDENT DETAILS',
                    icon: '📋',
                    content: top ? `Type: ${top.type || 'Unknown'} | Severity: ${(top.severity || 'medium').toUpperCase()} | Location: ${top.country || top.location || 'Unknown'} | Time: ${this.formatDTG(new Date(top.published || top.timestamp))}` : 'N/A'
                },
                {
                    title: 'IMMEDIATE IMPACT',
                    icon: '💥',
                    content: top && (top.severity === 'critical' || top.severity === 'high')
                        ? 'Significant operational impact assessed. Force protection measures may require adjustment. Regional escalation risk elevated.'
                        : 'Limited immediate impact. Continued monitoring advised.'
                },
                {
                    title: 'RECOMMENDED ACTIONS',
                    icon: '📌',
                    content: null,
                    recommendations: this.getRecommendations().slice(0, 3)
                },
                {
                    title: 'CONTEXT',
                    icon: '🔗',
                    content: `This incident occurs amid ${a.total} total incidents in the past ${a.windowLabel}. Current theater threat level: ${a.threatLevel}. ${a.actors.length > 0 ? 'Active actors: ' + a.actors.join(', ') + '.' : ''}`
                }
            ]
        };
    }

    // =====================================================================
    // HELPER METHODS
    // =====================================================================

    getEquipmentAssessment() {
        const types = this.analysis.typeCounts;
        const lines = [];
        if (types['missile'] || types['ballistic']) lines.push('Ballistic missile systems (assessed short/medium range)');
        if (types['drone'] || types['uav']) lines.push('Unmanned aerial vehicles (kamikaze / ISR variants)');
        if (types['maritime'] || types['naval']) lines.push('Naval mines, explosive boats, anti-ship missiles');
        if (types['cyber']) lines.push('Cyber warfare capabilities targeting critical infrastructure');
        if (types['artillery'] || types['rocket']) lines.push('Rocket artillery / multiple launch rocket systems');
        if (lines.length === 0) lines.push('Equipment details pending further intelligence assessment.');
        return 'Observed/assessed equipment: ' + lines.join('; ') + '.';
    }

    getCommanderAssessment() {
        const a = this.analysis;
        if (a.threatLevel === 'CRITICAL') {
            return 'Situation assessed as CRITICAL. Multiple high-impact incidents indicate coordinated hostile activity. Recommend elevated force protection and expedited decision-making authority for theater commanders.';
        }
        if (a.threatLevel === 'ELEVATED') {
            return 'Situation assessed as ELEVATED. Increased hostile activity detected. Recommend heightened surveillance and pre-positioning of response assets.';
        }
        if (a.threatLevel === 'SUBSTANTIAL') {
            return 'Situation assessed as SUBSTANTIAL. Ongoing threat activity requires sustained monitoring. Current defensive posture adequate but should be reviewed.';
        }
        return 'Situation assessed as MODERATE. Normal threat environment with isolated incidents. Maintain standard operating procedures.';
    }

    formatDTG(date) {
        const d = date || new Date();
        const day = String(d.getUTCDate()).padStart(2, '0');
        const hour = String(d.getUTCHours()).padStart(2, '0');
        const min = String(d.getUTCMinutes()).padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const mon = months[d.getUTCMonth()];
        const year = d.getUTCFullYear();
        return `${day}${hour}${min}Z ${mon} ${year}`;
    }
}

// =====================================================================
// RENDERER
// =====================================================================

function renderHermesBriefing(briefing) {
    if (!briefing) return '<div class="hermes-empty">Generate a briefing to begin.</div>';

    const classColors = {
        'UNCLASSIFIED': '#4caf50',
        'CONFIDENTIAL': '#2196f3',
        'SECRET': '#ff9800',
        'TOP SECRET': '#f44336',
        'TOP SECRET//SCI': '#d50000'
    };

    const classColor = classColors[briefing.classification] || '#4caf50';

    let html = `
    <div class="hermes-briefing ${briefing.flash ? 'hermes-flash' : ''}" id="hermes-briefing-content">
        <div class="hermes-classification-bar" style="background:${classColor}">
            ${briefing.classification}
        </div>

        <div class="hermes-header">
            <div class="hermes-header-left">
                <div class="hermes-type-badge">${briefing.typeShort}</div>
                <div class="hermes-type-name">${briefing.type}</div>
            </div>
            <div class="hermes-header-right">
                <div class="hermes-dtg">${briefing.dtg}</div>
                <div class="hermes-origin">HERMES // GULFWATCH AUTO-GEN</div>
            </div>
        </div>

        <div class="hermes-sections">`;

    briefing.sections.forEach(section => {
        html += `
        <div class="hermes-section ${section.highlight ? 'hermes-highlight' : ''}">
            <div class="hermes-section-title">
                <span class="hermes-section-icon">${section.icon}</span>
                ${section.title}
            </div>`;

        if (section.content) {
            html += `<div class="hermes-section-content">${section.content}</div>`;
        }

        if (section.items && section.items.length > 0) {
            html += '<div class="hermes-items">';
            section.items.forEach(item => {
                html += `
                <div class="hermes-item severity-${item.severity}">
                    <span class="hermes-item-time">${item.time}</span>
                    <span class="hermes-item-text">${item.text}</span>
                </div>`;
            });
            html += '</div>';
        }

        if (section.table) {
            html += '<div class="hermes-table-wrap"><table class="hermes-table"><thead><tr>';
            section.table.headers.forEach(h => { html += `<th>${h}</th>`; });
            html += '</tr></thead><tbody>';
            section.table.rows.forEach(row => {
                html += '<tr>';
                row.forEach((cell, i) => {
                    let cls = '';
                    if (cell === 'CRITICAL' || cell === 'ACTIVE THREAT') cls = 'cell-critical';
                    else if (cell === 'HIGH' || cell === 'ELEVATED') cls = 'cell-high';
                    else if (cell === 'MODERATE' || cell === 'MONITORING') cls = 'cell-moderate';
                    html += `<td class="${cls}">${cell}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        if (section.recommendations) {
            html += '<div class="hermes-recommendations">';
            section.recommendations.forEach(rec => {
                const prioClass = rec.priority === 'IMMEDIATE' ? 'prio-immediate' :
                    rec.priority === 'HIGH' ? 'prio-high' : 'prio-medium';
                html += `
                <div class="hermes-rec ${prioClass}">
                    <span class="hermes-rec-prio">${rec.priority}</span>
                    <span class="hermes-rec-text">${rec.text}</span>
                </div>`;
            });
            html += '</div>';
        }

        if (section.stats) {
            html += '<div class="hermes-stats-grid">';
            section.stats.forEach(s => {
                let valClass = '';
                if (s.label === 'Threat Level') {
                    valClass = s.value === 'CRITICAL' ? 'stat-critical' :
                        s.value === 'ELEVATED' ? 'stat-elevated' : '';
                }
                html += `
                <div class="hermes-stat-card">
                    <div class="hermes-stat-value ${valClass}">${s.value}</div>
                    <div class="hermes-stat-label">${s.label}</div>
                </div>`;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    html += `
        </div>
        <div class="hermes-classification-bar" style="background:${classColor}">
            ${briefing.classification}
        </div>
    </div>`;

    return html;
}

// =====================================================================
// COPY TO CLIPBOARD (plain text export)
// =====================================================================

function hermesExportText(briefing) {
    if (!briefing) return '';
    let text = '';
    text += `${'='.repeat(60)}\n`;
    text += `${briefing.classification}\n`;
    text += `${briefing.type}\n`;
    text += `DTG: ${briefing.dtg}\n`;
    text += `ORIGIN: HERMES // GULFWATCH AUTO-GEN\n`;
    text += `${'='.repeat(60)}\n\n`;

    briefing.sections.forEach(section => {
        text += `--- ${section.title} ---\n`;
        if (section.content) text += `${section.content}\n`;
        if (section.items) {
            section.items.forEach(item => {
                text += `  [${item.time}] ${item.text}\n`;
            });
        }
        if (section.table) {
            section.table.rows.forEach(row => {
                text += `  ${row.join(' | ')}\n`;
            });
        }
        if (section.recommendations) {
            section.recommendations.forEach(rec => {
                text += `  [${rec.priority}] ${rec.text}\n`;
            });
        }
        text += '\n';
    });

    text += `${'='.repeat(60)}\n`;
    text += `${briefing.classification}\n`;
    return text;
}

// =====================================================================
// EXPORTS
// =====================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HermesEngine, renderHermesBriefing, hermesExportText };
}
