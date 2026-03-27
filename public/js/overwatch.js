/**
 * OVERWATCH — Autonomous Sensor Tasking & ISR Collection Priority Engine
 * Recommends ISR collection priorities based on intelligence gaps
 */

class OverwatchEngine {
    constructor(incidents) {
        this.incidents = incidents || [];

        this.sensorTypes = [
            { id: 'SAR_SAT', name: 'SAR Satellite', shortName: 'SAR/EO SAT', category: 'Space', icon: '⬡', revisitHrs: 12, coverageKm: 500, capabilities: ['All-weather imaging', 'Change detection', 'Wide-area search'], intTypes: ['GEOINT'] },
            { id: 'HALE_UAV', name: 'HALE UAV (RQ-4)', shortName: 'Global Hawk', category: 'Air', icon: '△', revisitHrs: 0.5, coverageKm: 200, capabilities: ['Persistent surveillance', 'EO/IR/SAR', 'SIGINT relay'], intTypes: ['GEOINT', 'SIGINT'] },
            { id: 'MALE_UAV', name: 'MALE UAV (MQ-9)', shortName: 'Reaper', category: 'Air', icon: '▽', revisitHrs: 0.25, coverageKm: 80, capabilities: ['FMV collection', 'Target tracking', 'Strike capable'], intTypes: ['GEOINT'] },
            { id: 'MPA', name: 'Maritime Patrol (P-8A)', shortName: 'P-8 Poseidon', category: 'Air', icon: '◇', revisitHrs: 4, coverageKm: 350, capabilities: ['Maritime surveillance', 'ASW', 'Surface search radar'], intTypes: ['GEOINT', 'SIGINT'] },
            { id: 'SIGINT_PLAT', name: 'SIGINT Platform (RC-135)', shortName: 'Rivet Joint', category: 'Air', icon: '◈', revisitHrs: 2, coverageKm: 400, capabilities: ['COMINT collection', 'ELINT mapping', 'Real-time relay'], intTypes: ['SIGINT'] },
            { id: 'GROUND_STA', name: 'Ground Station', shortName: 'Ground Stn', category: 'Ground', icon: '⬢', revisitHrs: 0, coverageKm: 150, capabilities: ['Persistent SIGINT', 'Direction finding', 'Network analysis'], intTypes: ['SIGINT'] }
        ];

        this.regions = this.buildRegions();
        this.sensorInventory = this.buildSensorInventory();
        this.coverageAnalysis = this.analyzeCoverage();
        this.taskingQueue = this.generateTaskingQueue();
        this.pirList = this.generatePIRs();
        this.autoTaskSummary = this.generateAutoTask();
    }

    // =========================================================================
    // REGION ANALYSIS
    // =========================================================================

    buildRegions() {
        const regionDefs = [
            { id: 'strait_hormuz', name: 'Strait of Hormuz', countries: ['Iran', 'Oman', 'UAE'], priority: 'critical', gridRow: 1, gridCol: 3 },
            { id: 'red_sea', name: 'Red Sea / Bab el-Mandeb', countries: ['Yemen', 'Djibouti', 'Eritrea', 'Saudi Arabia'], priority: 'critical', gridRow: 2, gridCol: 1 },
            { id: 'gaza_strip', name: 'Gaza Strip', countries: ['Israel', 'Palestine'], priority: 'critical', gridRow: 0, gridCol: 1 },
            { id: 'south_lebanon', name: 'South Lebanon', countries: ['Lebanon'], priority: 'high', gridRow: 0, gridCol: 0 },
            { id: 'west_iraq', name: 'Western Iraq', countries: ['Iraq'], priority: 'high', gridRow: 0, gridCol: 2 },
            { id: 'east_syria', name: 'Eastern Syria', countries: ['Syria'], priority: 'high', gridRow: 0, gridCol: 3 },
            { id: 'persian_gulf', name: 'Persian Gulf', countries: ['Iran', 'Kuwait', 'Bahrain', 'Qatar'], priority: 'medium', gridRow: 1, gridCol: 2 },
            { id: 'gulf_aden', name: 'Gulf of Aden', countries: ['Yemen', 'Somalia'], priority: 'high', gridRow: 2, gridCol: 2 },
            { id: 'sinai', name: 'Sinai Peninsula', countries: ['Egypt'], priority: 'medium', gridRow: 1, gridCol: 0 },
            { id: 'arabian_sea', name: 'Northern Arabian Sea', countries: ['Oman', 'Pakistan'], priority: 'medium', gridRow: 2, gridCol: 3 },
            { id: 'east_med', name: 'Eastern Mediterranean', countries: ['Cyprus', 'Turkey'], priority: 'low', gridRow: 1, gridCol: 1 },
            { id: 'central_saudi', name: 'Central Saudi Arabia', countries: ['Saudi Arabia'], priority: 'low', gridRow: 2, gridCol: 0 }
        ];

        return regionDefs.map(region => {
            const regionIncidents = this.incidents.filter(inc =>
                region.countries.some(c => (inc.location?.country || '').toLowerCase().includes(c.toLowerCase()))
            );

            const threatDensity = regionIncidents.length;
            const highSevCount = regionIncidents.filter(i => i.verification?.score >= 70 || /critical|high/.test(i.severity || '')).length;

            // Simulated current coverage (based on threat density and region priority)
            const baseCoverage = region.priority === 'critical' ? 65 : region.priority === 'high' ? 45 : region.priority === 'medium' ? 30 : 15;
            const coveragePct = Math.min(95, baseCoverage + Math.min(20, threatDensity * 2));
            const gapScore = Math.max(0, 100 - coveragePct);

            return {
                ...region,
                incidents: regionIncidents,
                threatDensity,
                highSevCount,
                coveragePct,
                gapScore,
                coverageLevel: coveragePct >= 70 ? 'covered' : coveragePct >= 40 ? 'partial' : 'gap'
            };
        });
    }

    // =========================================================================
    // SENSOR INVENTORY
    // =========================================================================

    buildSensorInventory() {
        const statuses = ['available', 'available', 'tasked', 'available', 'tasked', 'maintenance', 'available', 'tasked'];
        const taskingTargets = ['Red Sea patrol', 'Gaza FMV', 'Hormuz SIGINT', 'Yemen coast', 'Syria overwatch', 'Lebanon border'];

        return this.sensorTypes.map((sensor, idx) => {
            const totalAssets = sensor.category === 'Ground' ? 3 : sensor.category === 'Space' ? 4 : 2;
            const availableCount = Math.max(1, Math.floor(totalAssets * 0.6));
            const taskedCount = totalAssets - availableCount;

            return {
                ...sensor,
                totalAssets,
                availableCount,
                taskedCount,
                status: availableCount > 0 ? 'available' : 'tasked',
                currentTasking: taskedCount > 0 ? taskingTargets[idx % taskingTargets.length] : null,
                readyIn: availableCount > 0 ? 0 : Math.floor(Math.random() * 4 + 1)
            };
        });
    }

    // =========================================================================
    // COVERAGE ANALYSIS
    // =========================================================================

    analyzeCoverage() {
        const totalRegions = this.regions.length;
        const covered = this.regions.filter(r => r.coverageLevel === 'covered').length;
        const partial = this.regions.filter(r => r.coverageLevel === 'partial').length;
        const gaps = this.regions.filter(r => r.coverageLevel === 'gap').length;

        const overallCoverage = Math.round(
            this.regions.reduce((sum, r) => sum + r.coveragePct, 0) / totalRegions
        );

        return {
            totalRegions,
            covered,
            partial,
            gaps,
            overallCoverage,
            criticalGaps: this.regions.filter(r => r.coverageLevel === 'gap' && (r.priority === 'critical' || r.priority === 'high'))
        };
    }

    // =========================================================================
    // TASKING QUEUE GENERATION
    // =========================================================================

    generateTaskingQueue() {
        const queue = [];

        // Sort regions by gap score * priority weight
        const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
        const sortedRegions = [...this.regions].sort((a, b) => {
            const scoreA = a.gapScore * priorityWeight[a.priority];
            const scoreB = b.gapScore * priorityWeight[b.priority];
            return scoreB - scoreA;
        });

        sortedRegions.forEach((region, idx) => {
            if (region.gapScore < 15) return;

            // Select best sensor for this region
            const bestSensor = this.selectBestSensor(region);
            if (!bestSensor) return;

            const priorityLevel = region.gapScore > 60 ? 'CRITICAL' :
                                  region.gapScore > 35 ? 'HIGH' :
                                  region.gapScore > 20 ? 'ROUTINE' : 'LOW';

            const justifications = [];
            if (region.threatDensity > 5) justifications.push(`High threat density (${region.threatDensity} incidents)`);
            if (region.highSevCount > 0) justifications.push(`${region.highSevCount} high-severity events`);
            if (region.coveragePct < 40) justifications.push(`Coverage below threshold (${region.coveragePct}%)`);
            if (region.priority === 'critical') justifications.push('Critical AOR');
            if (justifications.length === 0) justifications.push('Routine collection requirement');

            queue.push({
                rank: queue.length + 1,
                region,
                sensor: bestSensor,
                priority: priorityLevel,
                gapScore: region.gapScore,
                justification: justifications.join('; '),
                estimatedDuration: `${Math.floor(Math.random() * 6 + 2)}h`,
                collectionType: bestSensor.intTypes.join('/'),
                windowOpen: this.getCollectionWindow()
            });
        });

        return queue.slice(0, 10);
    }

    selectBestSensor(region) {
        // Prioritize available sensors that match region needs
        const needsSIGINT = region.incidents.some(i => /missile|air_defense/.test(i.type || ''));
        const needsGEOINT = region.incidents.some(i => /drone|attack|explosion/.test(i.type || ''));
        const isMaritime = /sea|strait|gulf|aden|arabian|hormuz/i.test(region.name);

        const candidates = this.sensorInventory.filter(s => s.availableCount > 0);
        if (candidates.length === 0) return this.sensorInventory[0];

        if (isMaritime) {
            const mpa = candidates.find(s => s.id === 'MPA');
            if (mpa) return mpa;
        }
        if (needsSIGINT) {
            const sig = candidates.find(s => s.id === 'SIGINT_PLAT' || s.id === 'GROUND_STA');
            if (sig) return sig;
        }
        if (needsGEOINT) {
            const geo = candidates.find(s => s.id === 'MALE_UAV' || s.id === 'HALE_UAV');
            if (geo) return geo;
        }

        return candidates.find(s => s.id === 'SAR_SAT') || candidates[0];
    }

    getCollectionWindow() {
        const hours = Math.floor(Math.random() * 4);
        const mins = Math.floor(Math.random() * 60);
        return `+${hours}h${String(mins).padStart(2, '0')}m`;
    }

    // =========================================================================
    // PRIORITY INTELLIGENCE REQUIREMENTS
    // =========================================================================

    generatePIRs() {
        const pirTemplates = [
            { id: 'PIR-001', category: 'THREAT', text: 'Identify and track ballistic missile launch preparations in western Iran and Houthi-controlled Yemen', priority: 'CRITICAL' },
            { id: 'PIR-002', category: 'MARITIME', text: 'Monitor commercial shipping patterns and potential interdiction activity in Bab el-Mandeb strait', priority: 'CRITICAL' },
            { id: 'PIR-003', category: 'FORCE', text: 'Detect significant force movements or repositioning along Israel-Lebanon border', priority: 'HIGH' },
            { id: 'PIR-004', category: 'SIGINT', text: 'Collect communications intelligence on IRGC coordination with proxy forces', priority: 'HIGH' },
            { id: 'PIR-005', category: 'INFRA', text: 'Assess damage to critical infrastructure following confirmed strike events', priority: 'HIGH' },
            { id: 'PIR-006', category: 'WMD', text: 'Monitor nuclear-related facilities for unusual activity or security posture changes', priority: 'ROUTINE' },
            { id: 'PIR-007', category: 'LOG', text: 'Track weapons resupply routes from Iran through Iraq/Syria corridor', priority: 'HIGH' },
            { id: 'PIR-008', category: 'CIVIL', text: 'Assess humanitarian situation and population displacement in active conflict zones', priority: 'ROUTINE' }
        ];

        // Enrich PIRs with incident data
        return pirTemplates.map(pir => {
            const related = this.incidents.filter(inc => {
                const title = (inc.title || '').toLowerCase();
                if (pir.category === 'THREAT' && /missile|ballistic|launch|rocket/.test(title)) return true;
                if (pir.category === 'MARITIME' && /ship|maritime|vessel|sea|houthi/.test(title)) return true;
                if (pir.category === 'FORCE' && /troop|deploy|movement|border|force/.test(title)) return true;
                if (pir.category === 'SIGINT' && /irgc|iran|proxy|hezbollah|communication/.test(title)) return true;
                if (pir.category === 'INFRA' && /infrastructure|damage|strike|destroy/.test(title)) return true;
                if (pir.category === 'WMD' && /nuclear|enrichment|facility/.test(title)) return true;
                if (pir.category === 'LOG' && /weapon|supply|smuggl|corridor/.test(title)) return true;
                if (pir.category === 'CIVIL' && /humanitarian|civilian|displace|refugee/.test(title)) return true;
                return false;
            }).length;

            return {
                ...pir,
                relatedIncidents: related,
                lastCollected: related > 0 ? 'Recent' : 'Stale',
                satisfaction: related > 3 ? 'SATISFIED' : related > 0 ? 'PARTIAL' : 'UNSATISFIED'
            };
        });
    }

    // =========================================================================
    // AUTO-TASK SUMMARY
    // =========================================================================

    generateAutoTask() {
        const assignments = [];
        const usedSensors = new Set();

        this.taskingQueue.slice(0, 6).forEach(task => {
            if (usedSensors.has(task.sensor.id) && task.sensor.availableCount <= 1) return;
            usedSensors.add(task.sensor.id);
            assignments.push({
                sensor: task.sensor,
                target: task.region.name,
                priority: task.priority,
                collection: task.collectionType,
                window: task.windowOpen
            });
        });

        return {
            assignments,
            sensorsAssigned: assignments.length,
            estimatedCoverageGain: Math.min(25, assignments.length * 5),
            gapsAddressed: assignments.filter(a => a.priority === 'CRITICAL' || a.priority === 'HIGH').length
        };
    }
}

// =============================================================================
// RENDER FUNCTION
// =============================================================================

function renderOverwatch(incidents) {
    const engine = new OverwatchEngine(incidents);
    const ca = engine.coverageAnalysis;

    function truncate(str, len) {
        if (!str) return '--';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    const totalSensors = engine.sensorInventory.reduce((s, si) => s + si.totalAssets, 0);
    const availSensors = engine.sensorInventory.reduce((s, si) => s + si.availableCount, 0);
    const activeTasks = engine.taskingQueue.length;

    let html = `
    <div class="overwatch-container">
        <!-- Header -->
        <div class="overwatch-header">
            <div class="overwatch-header-title">
                <span class="overwatch-header-icon">&#9678;</span>
                <span>OVERWATCH</span>
                <span class="overwatch-header-subtitle">AUTONOMOUS SENSOR TASKING</span>
            </div>
            <div class="overwatch-stats-bar">
                <div class="overwatch-stat">
                    <span class="overwatch-stat-value">${availSensors}/${totalSensors}</span>
                    <span class="overwatch-stat-label">SENSORS AVAIL</span>
                </div>
                <div class="overwatch-stat">
                    <span class="overwatch-stat-value">${activeTasks}</span>
                    <span class="overwatch-stat-label">ACTIVE TASKS</span>
                </div>
                <div class="overwatch-stat">
                    <span class="overwatch-stat-value">${ca.overallCoverage}%</span>
                    <span class="overwatch-stat-label">COVERAGE</span>
                </div>
                <div class="overwatch-stat overwatch-stat-alert">
                    <span class="overwatch-stat-value">${ca.gaps}</span>
                    <span class="overwatch-stat-label">GAPS</span>
                </div>
            </div>
        </div>

        <!-- Sensor Inventory -->
        <div class="overwatch-section">
            <div class="overwatch-panel-header">SENSOR INVENTORY</div>
            <div class="overwatch-sensor-grid">
                ${engine.sensorInventory.map(sensor => `
                    <div class="overwatch-sensor-card">
                        <div class="overwatch-sensor-card-top">
                            <span class="overwatch-sensor-icon">${sensor.icon}</span>
                            <div class="overwatch-sensor-info">
                                <span class="overwatch-sensor-name">${sensor.shortName}</span>
                                <span class="overwatch-sensor-category">${sensor.category}</span>
                            </div>
                            <span class="overwatch-sensor-status overwatch-status-${sensor.status}">
                                <span class="overwatch-status-dot"></span>
                                ${sensor.status === 'available' ? 'READY' : sensor.status === 'tasked' ? 'TASKED' : 'MAINT'}
                            </span>
                        </div>
                        <div class="overwatch-sensor-details">
                            <div class="overwatch-sensor-detail">
                                <span class="overwatch-detail-label">ASSETS</span>
                                <span class="overwatch-detail-value">${sensor.availableCount}/${sensor.totalAssets}</span>
                            </div>
                            <div class="overwatch-sensor-detail">
                                <span class="overwatch-detail-label">COVERAGE</span>
                                <span class="overwatch-detail-value">${sensor.coverageKm}km</span>
                            </div>
                            <div class="overwatch-sensor-detail">
                                <span class="overwatch-detail-label">REVISIT</span>
                                <span class="overwatch-detail-value">${sensor.revisitHrs === 0 ? 'PERSIST' : sensor.revisitHrs + 'h'}</span>
                            </div>
                        </div>
                        ${sensor.currentTasking ? `<div class="overwatch-sensor-tasking">TASKED: ${sensor.currentTasking}</div>` : ''}
                        <div class="overwatch-sensor-caps">
                            ${sensor.capabilities.map(c => `<span class="overwatch-cap-tag">${c}</span>`).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Coverage Grid + Tasking Queue Row -->
        <div class="overwatch-main-row">
            <!-- Coverage Gap Map -->
            <div class="overwatch-coverage-panel">
                <div class="overwatch-panel-header">COVERAGE GAP MAP</div>
                <div class="overwatch-coverage-legend">
                    <span class="overwatch-legend-item"><span class="overwatch-legend-cell overwatch-cell-covered"></span>Covered</span>
                    <span class="overwatch-legend-item"><span class="overwatch-legend-cell overwatch-cell-partial"></span>Partial</span>
                    <span class="overwatch-legend-item"><span class="overwatch-legend-cell overwatch-cell-gap"></span>Gap</span>
                </div>
                <div class="overwatch-coverage-grid">
                    ${engine.regions.map(region => `
                        <div class="overwatch-grid-cell overwatch-cell-${region.coverageLevel}" title="${region.name}: ${region.coveragePct}% coverage">
                            <div class="overwatch-cell-name">${region.name.length > 16 ? region.name.substring(0, 14) + '..' : region.name}</div>
                            <div class="overwatch-cell-pct">${region.coveragePct}%</div>
                            <div class="overwatch-cell-threat">${region.threatDensity > 0 ? region.threatDensity + ' threats' : '--'}</div>
                            ${region.priority === 'critical' ? '<div class="overwatch-cell-priority">CRITICAL AOR</div>' : ''}
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Tasking Queue -->
            <div class="overwatch-tasking-panel">
                <div class="overwatch-panel-header">PRIORITIZED TASKING QUEUE</div>
                <div class="overwatch-tasking-list">
                    ${engine.taskingQueue.map(task => `
                        <div class="overwatch-task-item">
                            <div class="overwatch-task-rank">${String(task.rank).padStart(2, '0')}</div>
                            <div class="overwatch-task-body">
                                <div class="overwatch-task-top">
                                    <span class="overwatch-task-priority overwatch-priority-${task.priority.toLowerCase()}">${task.priority}</span>
                                    <span class="overwatch-task-region">${task.region.name}</span>
                                    <span class="overwatch-task-window">${task.windowOpen}</span>
                                </div>
                                <div class="overwatch-task-detail">
                                    <span class="overwatch-task-sensor">${task.sensor.icon} ${task.sensor.shortName}</span>
                                    <span class="overwatch-task-collection">${task.collectionType}</span>
                                    <span class="overwatch-task-duration">${task.estimatedDuration}</span>
                                </div>
                                <div class="overwatch-task-justification">${task.justification}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <!-- PIR List + Auto-Task Row -->
        <div class="overwatch-bottom-row">
            <!-- PIR List -->
            <div class="overwatch-pir-panel">
                <div class="overwatch-panel-header">PRIORITY INTELLIGENCE REQUIREMENTS</div>
                <div class="overwatch-pir-list">
                    ${engine.pirList.map(pir => `
                        <div class="overwatch-pir-item">
                            <div class="overwatch-pir-header">
                                <span class="overwatch-pir-id">${pir.id}</span>
                                <span class="overwatch-pir-category">${pir.category}</span>
                                <span class="overwatch-pir-priority overwatch-priority-${pir.priority.toLowerCase()}">${pir.priority}</span>
                                <span class="overwatch-pir-satisfaction overwatch-sat-${pir.satisfaction.toLowerCase()}">${pir.satisfaction}</span>
                            </div>
                            <div class="overwatch-pir-text">${pir.text}</div>
                            <div class="overwatch-pir-meta">
                                <span>Related: ${pir.relatedIncidents}</span>
                                <span>Last: ${pir.lastCollected}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Auto-Task Summary -->
            <div class="overwatch-autotask-panel">
                <div class="overwatch-panel-header">AUTO-TASK OPTIMIZATION</div>
                <div class="overwatch-autotask-summary">
                    <div class="overwatch-autotask-stats">
                        <div class="overwatch-autotask-stat">
                            <span class="overwatch-autotask-val">${engine.autoTaskSummary.sensorsAssigned}</span>
                            <span class="overwatch-autotask-lbl">SENSORS ASSIGNED</span>
                        </div>
                        <div class="overwatch-autotask-stat">
                            <span class="overwatch-autotask-val">+${engine.autoTaskSummary.estimatedCoverageGain}%</span>
                            <span class="overwatch-autotask-lbl">EST. COVERAGE GAIN</span>
                        </div>
                        <div class="overwatch-autotask-stat">
                            <span class="overwatch-autotask-val">${engine.autoTaskSummary.gapsAddressed}</span>
                            <span class="overwatch-autotask-lbl">GAPS ADDRESSED</span>
                        </div>
                    </div>
                    <div class="overwatch-autotask-assignments">
                        ${engine.autoTaskSummary.assignments.map((a, idx) => `
                            <div class="overwatch-autotask-row">
                                <span class="overwatch-autotask-idx">${idx + 1}</span>
                                <span class="overwatch-autotask-sensor">${a.sensor.icon} ${a.sensor.shortName}</span>
                                <span class="overwatch-autotask-arrow">&rarr;</span>
                                <span class="overwatch-autotask-target">${a.target}</span>
                                <span class="overwatch-autotask-pri overwatch-priority-${a.priority.toLowerCase()}">${a.priority}</span>
                                <span class="overwatch-autotask-win">${a.window}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="overwatch-footer">
            <span>OVERWATCH // ISR TASKING ENGINE // ${new Date().toISOString().replace('T', ' ').substring(0, 19)}Z</span>
            <span>SENSORS: ${availSensors}/${totalSensors} // COVERAGE: ${ca.overallCoverage}% // GAPS: ${ca.gaps}</span>
        </div>
    </div>`;

    return html;
}

// =============================================================================
// EXPORT
// =============================================================================

window.OverwatchEngine = OverwatchEngine;
window.renderOverwatch = renderOverwatch;
