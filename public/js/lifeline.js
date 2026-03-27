/**
 * LIFELINE — Supply Chain & Logistics Vulnerability Prediction Engine
 * Models how regional conflict disrupts shipping, energy, minerals, food corridors
 */

class LifelineEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.routes = this.buildRoutes();
        this.impacts = this.calculateEconomicImpacts();
        this.scenarios = this.generateScenarios();
        this.matrix = this.buildVulnerabilityMatrix();
    }

    // =====================================================================
    // SUPPLY ROUTE DEFINITIONS
    // =====================================================================

    buildRoutes() {
        const routeDefs = [
            {
                id: 'hormuz',
                name: 'Strait of Hormuz',
                type: 'oil',
                description: 'Primary oil transit chokepoint — 21% of global petroleum',
                baselineThroughput: 20.5, // million barrels/day
                throughputUnit: 'M bbl/day',
                dailyValueUSD: 1.6e9,
                proximityCountries: ['iran', 'oman', 'uae', 'bahrain', 'qatar', 'kuwait', 'saudi'],
                proximityKeywords: ['hormuz', 'persian gulf', 'gulf', 'iran', 'iranian', 'irgc', 'tanker', 'naval'],
                vulnerabilities: ['mine warfare', 'anti-ship missile', 'drone swarm', 'naval blockade'],
                lat: 26.56, lng: 56.25
            },
            {
                id: 'bab-el-mandeb',
                name: 'Bab el-Mandeb',
                type: 'shipping',
                description: 'Red Sea southern chokepoint — connects Suez to Indian Ocean',
                baselineThroughput: 6.2, // million bbl/day equivalent
                throughputUnit: 'M bbl/day eq.',
                dailyValueUSD: 800e6,
                proximityCountries: ['yemen', 'djibouti', 'eritrea', 'somalia'],
                proximityKeywords: ['bab el-mandeb', 'bab al-mandab', 'houthi', 'yemen', 'red sea', 'aden', 'djibouti'],
                vulnerabilities: ['anti-ship missile', 'drone attack', 'sea mine', 'piracy'],
                lat: 12.58, lng: 43.33
            },
            {
                id: 'suez',
                name: 'Suez Canal',
                type: 'shipping',
                description: 'Critical Europe-Asia trade corridor — 12% of global trade',
                baselineThroughput: 82, // ships/day
                throughputUnit: 'ships/day',
                dailyValueUSD: 2.4e9,
                proximityCountries: ['egypt', 'israel'],
                proximityKeywords: ['suez', 'egypt', 'sinai', 'canal', 'port said', 'ismailia'],
                vulnerabilities: ['blockage', 'terror attack', 'political closure', 'military conflict'],
                lat: 30.46, lng: 32.34
            },
            {
                id: 'gulf-lng',
                name: 'Gulf LNG Exports',
                type: 'energy',
                description: 'Qatar & UAE LNG — 31% of global LNG trade',
                baselineThroughput: 140, // million tonnes/year
                throughputUnit: 'MT/year',
                dailyValueUSD: 420e6,
                proximityCountries: ['qatar', 'uae', 'oman', 'iran'],
                proximityKeywords: ['lng', 'gas', 'qatar', 'ras laffan', 'das island', 'natural gas', 'energy'],
                vulnerabilities: ['port disruption', 'pipeline sabotage', 'naval blockade', 'cyber attack'],
                lat: 25.92, lng: 51.53
            },
            {
                id: 'red-sea-commercial',
                name: 'Red Sea Commercial',
                type: 'trade',
                description: 'Container shipping lane — $1T+ annual trade value',
                baselineThroughput: 52, // ships/day
                throughputUnit: 'ships/day',
                dailyValueUSD: 2.7e9,
                proximityCountries: ['yemen', 'saudi', 'egypt', 'sudan', 'eritrea', 'djibouti'],
                proximityKeywords: ['red sea', 'houthi', 'shipping', 'commercial', 'container', 'cargo', 'merchant', 'vessel'],
                vulnerabilities: ['missile attack', 'drone strike', 'hijacking', 'rerouting costs'],
                lat: 18.0, lng: 39.5
            }
        ];

        return routeDefs.map(route => this.assessRoute(route));
    }

    // =====================================================================
    // THREAT ASSESSMENT
    // =====================================================================

    assessRoute(route) {
        const nearbyIncidents = this.findNearbyIncidents(route);
        const threatScore = this.calculateThreatScore(nearbyIncidents, route);
        const disruptionProb = this.calculateDisruptionProbability(threatScore, nearbyIncidents);
        const currentThroughput = route.baselineThroughput * (1 - disruptionProb * 0.6);

        return {
            ...route,
            nearbyIncidents,
            incidentCount: nearbyIncidents.length,
            threatScore,        // 0-100
            threatLevel: this.getThreatLevel(threatScore),
            disruptionProb,     // 0-1
            currentThroughput: Math.round(currentThroughput * 100) / 100,
            throughputDelta: Math.round((currentThroughput - route.baselineThroughput) * 100) / 100,
            estimatedDailyLoss: Math.round(route.dailyValueUSD * disruptionProb * 0.6)
        };
    }

    findNearbyIncidents(route) {
        return this.incidents.filter(inc => {
            const title = (inc.title || '').toLowerCase();
            const country = (inc.location?.country || inc.country || '').toLowerCase();
            const locName = (inc.location?.name || '').toLowerCase();
            const type = (inc.type || '').toLowerCase();
            const combined = `${title} ${country} ${locName} ${type}`;

            // Check country proximity
            if (route.proximityCountries.some(c => country.includes(c))) return true;

            // Check keyword proximity
            if (route.proximityKeywords.some(kw => combined.includes(kw))) return true;

            // Check geographic proximity (crude distance)
            if (inc.location?.lat && inc.location?.lng) {
                const dist = this.haversineApprox(route.lat, route.lng, inc.location.lat, inc.location.lng);
                if (dist < 500) return true; // within 500km
            }

            return false;
        });
    }

    haversineApprox(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    calculateThreatScore(incidents, route) {
        if (incidents.length === 0) return 5; // baseline ambient threat

        let score = 0;
        const now = Date.now();

        incidents.forEach(inc => {
            const severity = (inc.severity || 'medium').toLowerCase();
            const sevScore = { critical: 25, high: 18, medium: 10, low: 4 }[severity] || 8;

            // Recency decay — incidents older than 7 days lose potency
            const pubDate = new Date(inc.published).getTime();
            const ageHours = (now - pubDate) / (1000 * 60 * 60);
            const recencyFactor = Math.max(0.2, 1 - (ageHours / (7 * 24)));

            // Keyword boost — direct mention of route-relevant terms
            const title = (inc.title || '').toLowerCase();
            const keywordBoost = route.proximityKeywords.filter(kw => title.includes(kw)).length * 3;

            // Military action type boost
            const type = (inc.type || '').toLowerCase();
            const typeBoost = /attack|strike|missile|drone|naval|military/.test(type) ? 8 : 0;

            score += (sevScore + keywordBoost + typeBoost) * recencyFactor;
        });

        return Math.min(100, Math.round(score));
    }

    calculateDisruptionProbability(threatScore, incidents) {
        // Base probability from threat score (sigmoid curve)
        let prob = 1 / (1 + Math.exp(-0.08 * (threatScore - 50)));

        // Boost for high-severity incident clusters
        const criticalCount = incidents.filter(i =>
            (i.severity || '').toLowerCase() === 'critical' ||
            (i.severity || '').toLowerCase() === 'high'
        ).length;
        if (criticalCount >= 3) prob = Math.min(1, prob * 1.4);

        // Recent incident cluster boost
        const recentCount = incidents.filter(i => {
            const age = (Date.now() - new Date(i.published).getTime()) / (1000 * 60 * 60);
            return age < 24;
        }).length;
        if (recentCount >= 2) prob = Math.min(1, prob * 1.2);

        return Math.round(prob * 1000) / 1000;
    }

    getThreatLevel(score) {
        if (score >= 75) return { label: 'CRITICAL', color: '#ff2244', cssClass: 'critical' };
        if (score >= 50) return { label: 'HIGH', color: '#ff8800', cssClass: 'high' };
        if (score >= 25) return { label: 'ELEVATED', color: '#ffcc00', cssClass: 'elevated' };
        if (score >= 10) return { label: 'GUARDED', color: '#00bbff', cssClass: 'guarded' };
        return { label: 'LOW', color: '#00ff88', cssClass: 'low' };
    }

    // =====================================================================
    // ECONOMIC IMPACT MODEL
    // =====================================================================

    calculateEconomicImpacts() {
        const hormuz = this.routes.find(r => r.id === 'hormuz');
        const babElMandeb = this.routes.find(r => r.id === 'bab-el-mandeb');
        const suez = this.routes.find(r => r.id === 'suez');
        const redSea = this.routes.find(r => r.id === 'red-sea-commercial');
        const gulfLng = this.routes.find(r => r.id === 'gulf-lng');

        // Oil price impact model
        const hormuzDisruption = hormuz ? hormuz.disruptionProb : 0;
        const oilPriceDelta = hormuzDisruption * 35 + (babElMandeb ? babElMandeb.disruptionProb * 12 : 0);

        // Shipping cost multiplier
        const avgShippingThreat = this.routes
            .filter(r => r.type === 'shipping' || r.type === 'trade')
            .reduce((sum, r) => sum + r.disruptionProb, 0) / 3;
        const shippingCostMultiplier = 1 + avgShippingThreat * 2.8;

        // Insurance rate changes (war risk premium)
        const maxThreat = Math.max(...this.routes.map(r => r.threatScore));
        const insuranceRateMultiplier = 1 + (maxThreat / 100) * 4.5;

        // LNG spot price impact
        const lngPriceDelta = gulfLng ? gulfLng.disruptionProb * 8.5 : 0;

        // GDP impact estimates (annualized)
        const totalDailyLoss = this.routes.reduce((sum, r) => sum + r.estimatedDailyLoss, 0);
        const annualizedLoss = totalDailyLoss * 365;

        // Regional GDP impacts (as percentage)
        const gulfGDP = 1.8e12; // ~$1.8T combined Gulf states GDP
        const globalGDP = 105e12;

        return {
            oilPriceDelta: Math.round(oilPriceDelta * 100) / 100,
            shippingCostMultiplier: Math.round(shippingCostMultiplier * 100) / 100,
            insuranceRateMultiplier: Math.round(insuranceRateMultiplier * 100) / 100,
            lngPriceDelta: Math.round(lngPriceDelta * 100) / 100,
            totalDailyTradeAtRisk: this.routes.reduce((sum, r) => sum + r.dailyValueUSD * r.disruptionProb, 0),
            totalDailyLoss,
            annualizedLoss,
            gulfGDPImpact: Math.round((annualizedLoss / gulfGDP) * 10000) / 100,
            globalGDPImpact: Math.round((annualizedLoss / globalGDP) * 100000) / 1000,
            routesAtRisk: this.routes.filter(r => r.threatScore >= 25).length,
            routesMonitored: this.routes.length
        };
    }

    // =====================================================================
    // VULNERABILITY MATRIX
    // =====================================================================

    buildVulnerabilityMatrix() {
        const threatTypes = ['Missile', 'Drone/UAV', 'Naval', 'Mine', 'Cyber', 'Piracy'];
        const matrix = {};

        this.routes.forEach(route => {
            matrix[route.id] = {};
            const combined = route.nearbyIncidents.map(i =>
                `${i.title || ''} ${i.type || ''}`.toLowerCase()
            ).join(' ');

            threatTypes.forEach(threat => {
                const keywords = {
                    'Missile': ['missile', 'ballistic', 'rocket', 'projectile'],
                    'Drone/UAV': ['drone', 'uav', 'unmanned', 'uas'],
                    'Naval': ['naval', 'navy', 'warship', 'vessel', 'ship', 'maritime'],
                    'Mine': ['mine', 'mining', 'explosive', 'ied', 'limpet'],
                    'Cyber': ['cyber', 'hack', 'digital', 'electronic', 'gps', 'spoof'],
                    'Piracy': ['piracy', 'pirate', 'hijack', 'seize', 'board']
                };

                const matches = keywords[threat].filter(kw => combined.includes(kw)).length;
                const baseThreat = route.threatScore / 100;
                const specificThreat = Math.min(1, baseThreat * (0.3 + matches * 0.25));
                matrix[route.id][threat] = Math.round(specificThreat * 100);
            });
        });

        return { routes: this.routes, threatTypes, values: matrix };
    }

    // =====================================================================
    // DISRUPTION SCENARIOS
    // =====================================================================

    generateScenarios() {
        return [
            {
                id: 'hormuz-closure',
                name: 'Strait of Hormuz Closure',
                trigger: 'Iran closes Strait in response to escalation',
                probability: this.routes.find(r => r.id === 'hormuz')?.disruptionProb || 0.1,
                duration: '2-4 weeks',
                impacts: [
                    { metric: 'Oil Price Surge', value: '+$35-50/bbl', severity: 'critical' },
                    { metric: 'Global GDP Impact', value: '-0.5% to -1.2%', severity: 'critical' },
                    { metric: 'LNG Supply', value: '-31% global supply', severity: 'critical' },
                    { metric: 'Shipping Reroute', value: 'Cape of Good Hope (+10 days)', severity: 'high' }
                ]
            },
            {
                id: 'red-sea-escalation',
                name: 'Red Sea Total Denial',
                trigger: 'Houthi anti-ship campaign shuts Red Sea corridor',
                probability: this.routes.find(r => r.id === 'red-sea-commercial')?.disruptionProb || 0.15,
                duration: '1-6 months',
                impacts: [
                    { metric: 'Shipping Costs', value: '+280% container rates', severity: 'critical' },
                    { metric: 'Suez Revenue', value: '-$7B/year Egypt loss', severity: 'high' },
                    { metric: 'Delivery Times', value: '+12-15 days Europe-Asia', severity: 'high' },
                    { metric: 'Insurance Premiums', value: '+500% war risk', severity: 'critical' }
                ]
            },
            {
                id: 'cascading-multi',
                name: 'Multi-Chokepoint Cascade',
                trigger: 'Regional war disrupts Hormuz + Bab el-Mandeb simultaneously',
                probability: Math.min(1, (this.routes.find(r => r.id === 'hormuz')?.disruptionProb || 0) *
                    (this.routes.find(r => r.id === 'bab-el-mandeb')?.disruptionProb || 0) * 5),
                duration: '1-3 months',
                impacts: [
                    { metric: 'Oil Price', value: '+$60-80/bbl', severity: 'critical' },
                    { metric: 'Global Recession', value: 'Probability >75%', severity: 'critical' },
                    { metric: 'Energy Security', value: 'Strategic reserves activated', severity: 'critical' },
                    { metric: 'Food Prices', value: '+25-40% grain import costs', severity: 'high' }
                ]
            }
        ];
    }
}

// =====================================================================
// RENDER FUNCTION
// =====================================================================

function renderLifeline(incidents) {
    const engine = new LifelineEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));
    const { routes, impacts, scenarios, matrix } = engine;

    const formatUSD = (val) => {
        if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
        if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
        if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
        return `$${val}`;
    };

    // ── Key Statistics Bar ──────────────────────────────────────────
    const statsHtml = `
    <div class="lifeline-stats-bar">
        <div class="lifeline-stat">
            <div class="lifeline-stat-value">${impacts.routesMonitored}</div>
            <div class="lifeline-stat-label">Routes Monitored</div>
        </div>
        <div class="lifeline-stat lifeline-stat-warn">
            <div class="lifeline-stat-value">${impacts.routesAtRisk}</div>
            <div class="lifeline-stat-label">Routes at Risk</div>
        </div>
        <div class="lifeline-stat">
            <div class="lifeline-stat-value">${formatUSD(impacts.totalDailyTradeAtRisk)}</div>
            <div class="lifeline-stat-label">Daily Trade at Risk</div>
        </div>
        <div class="lifeline-stat">
            <div class="lifeline-stat-value">+${impacts.oilPriceDelta.toFixed(1)}</div>
            <div class="lifeline-stat-label">Oil Price Delta ($/bbl)</div>
        </div>
        <div class="lifeline-stat">
            <div class="lifeline-stat-value">${impacts.shippingCostMultiplier.toFixed(2)}x</div>
            <div class="lifeline-stat-label">Shipping Cost Mult.</div>
        </div>
        <div class="lifeline-stat">
            <div class="lifeline-stat-value">${impacts.insuranceRateMultiplier.toFixed(1)}x</div>
            <div class="lifeline-stat-label">War Risk Premium</div>
        </div>
    </div>`;

    // ── Supply Route Cards ──────────────────────────────────────────
    const routeCardsHtml = routes.map(route => {
        const threatPct = route.threatScore;
        const threatColor = route.threatLevel.color;
        const deltaSign = route.throughputDelta >= 0 ? '+' : '';
        const typeIcon = { oil: '🛢', shipping: '🚢', energy: '⚡', trade: '📦' }[route.type] || '📍';

        return `
        <div class="lifeline-route-card lifeline-route-${route.threatLevel.cssClass}">
            <div class="lifeline-route-header">
                <div class="lifeline-route-icon">${typeIcon}</div>
                <div class="lifeline-route-info">
                    <div class="lifeline-route-name">${route.name}</div>
                    <div class="lifeline-route-desc">${route.description}</div>
                </div>
                <div class="lifeline-route-badge" style="background: ${threatColor}20; color: ${threatColor}; border: 1px solid ${threatColor}40">
                    ${route.threatLevel.label}
                </div>
            </div>
            <div class="lifeline-route-metrics">
                <div class="lifeline-route-metric">
                    <span class="lifeline-metric-label">Throughput</span>
                    <span class="lifeline-metric-value">${route.currentThroughput} <small>${route.throughputUnit}</small></span>
                    <span class="lifeline-metric-delta" style="color: ${route.throughputDelta < 0 ? '#ff4444' : '#00ff88'}">${deltaSign}${route.throughputDelta}</span>
                </div>
                <div class="lifeline-route-metric">
                    <span class="lifeline-metric-label">Disruption Prob.</span>
                    <span class="lifeline-metric-value">${(route.disruptionProb * 100).toFixed(1)}%</span>
                </div>
                <div class="lifeline-route-metric">
                    <span class="lifeline-metric-label">Daily Value at Risk</span>
                    <span class="lifeline-metric-value">${formatUSD(route.estimatedDailyLoss)}</span>
                </div>
                <div class="lifeline-route-metric">
                    <span class="lifeline-metric-label">Incidents (nearby)</span>
                    <span class="lifeline-metric-value">${route.incidentCount}</span>
                </div>
            </div>
            <div class="lifeline-threat-bar-container">
                <div class="lifeline-threat-bar" style="width: ${threatPct}%; background: ${threatColor}"></div>
                <span class="lifeline-threat-bar-label">${threatPct}/100</span>
            </div>
        </div>`;
    }).join('');

    // ── Economic Impact Projections ─────────────────────────────────
    const impactHtml = `
    <div class="lifeline-impacts">
        <div class="lifeline-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            Economic Impact Projections
        </div>
        <div class="lifeline-impact-grid">
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">Oil Price Delta</div>
                <div class="lifeline-impact-value" style="color: ${impacts.oilPriceDelta > 5 ? '#ff4444' : impacts.oilPriceDelta > 2 ? '#ffcc00' : '#00ff88'}">
                    +$${impacts.oilPriceDelta.toFixed(2)}/bbl
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, impacts.oilPriceDelta / 50 * 100)}%; background: linear-gradient(90deg, #00ff88, #ffcc00, #ff2244)"></div>
                </div>
                <div class="lifeline-impact-note">Projected spot price increase from baseline</div>
            </div>
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">Shipping Cost Multiplier</div>
                <div class="lifeline-impact-value" style="color: ${impacts.shippingCostMultiplier > 2 ? '#ff4444' : impacts.shippingCostMultiplier > 1.5 ? '#ffcc00' : '#00ff88'}">
                    ${impacts.shippingCostMultiplier.toFixed(2)}x
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, (impacts.shippingCostMultiplier - 1) / 3 * 100)}%; background: linear-gradient(90deg, #00ff88, #ffcc00, #ff8800)"></div>
                </div>
                <div class="lifeline-impact-note">Container rate multiplier vs peacetime baseline</div>
            </div>
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">War Risk Insurance</div>
                <div class="lifeline-impact-value" style="color: ${impacts.insuranceRateMultiplier > 3 ? '#ff4444' : impacts.insuranceRateMultiplier > 2 ? '#ffcc00' : '#00ff88'}">
                    ${impacts.insuranceRateMultiplier.toFixed(1)}x
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, (impacts.insuranceRateMultiplier - 1) / 5 * 100)}%; background: linear-gradient(90deg, #00bbff, #ffcc00, #ff2244)"></div>
                </div>
                <div class="lifeline-impact-note">Maritime insurance premium multiplier</div>
            </div>
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">LNG Spot Delta</div>
                <div class="lifeline-impact-value" style="color: ${impacts.lngPriceDelta > 3 ? '#ff4444' : impacts.lngPriceDelta > 1 ? '#ffcc00' : '#00ff88'}">
                    +$${impacts.lngPriceDelta.toFixed(2)}/MMBtu
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, impacts.lngPriceDelta / 10 * 100)}%; background: linear-gradient(90deg, #00ff88, #ffcc00, #ff8800)"></div>
                </div>
                <div class="lifeline-impact-note">LNG spot price increase projection</div>
            </div>
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">Gulf GDP Impact</div>
                <div class="lifeline-impact-value" style="color: ${impacts.gulfGDPImpact > 1 ? '#ff4444' : impacts.gulfGDPImpact > 0.3 ? '#ffcc00' : '#00ff88'}">
                    -${impacts.gulfGDPImpact.toFixed(2)}%
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, impacts.gulfGDPImpact / 3 * 100)}%; background: linear-gradient(90deg, #00bbff, #ffcc00, #ff2244)"></div>
                </div>
                <div class="lifeline-impact-note">Annualized Gulf states combined GDP drag</div>
            </div>
            <div class="lifeline-impact-card">
                <div class="lifeline-impact-header">Global GDP Impact</div>
                <div class="lifeline-impact-value" style="color: ${impacts.globalGDPImpact > 0.1 ? '#ff4444' : impacts.globalGDPImpact > 0.03 ? '#ffcc00' : '#00ff88'}">
                    -${impacts.globalGDPImpact.toFixed(3)}%
                </div>
                <div class="lifeline-impact-meter">
                    <div class="lifeline-impact-fill" style="width: ${Math.min(100, impacts.globalGDPImpact / 0.5 * 100)}%; background: linear-gradient(90deg, #00ff88, #ff8800, #ff2244)"></div>
                </div>
                <div class="lifeline-impact-note">Estimated global GDP drag from trade disruption</div>
            </div>
        </div>
    </div>`;

    // ── Vulnerability Matrix (Heatmap) ──────────────────────────────
    const matrixHeaderCells = matrix.threatTypes.map(t => `<div class="lifeline-matrix-header-cell">${t}</div>`).join('');
    const matrixRows = matrix.routes.map(route => {
        const cells = matrix.threatTypes.map(threat => {
            const val = matrix.values[route.id][threat];
            const hue = val > 60 ? 0 : val > 30 ? 35 : 120;
            const sat = Math.max(30, val);
            const light = 20 + (100 - val) * 0.15;
            return `<div class="lifeline-matrix-cell" style="background: hsl(${hue}, ${sat}%, ${light}%)" title="${route.name} × ${threat}: ${val}%">
                <span>${val}</span>
            </div>`;
        }).join('');
        return `
        <div class="lifeline-matrix-row">
            <div class="lifeline-matrix-route-label">${route.name}</div>
            ${cells}
        </div>`;
    }).join('');

    const matrixHtml = `
    <div class="lifeline-matrix">
        <div class="lifeline-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Vulnerability Matrix
        </div>
        <div class="lifeline-matrix-subtitle">Route exposure by threat vector — values 0-100</div>
        <div class="lifeline-matrix-grid">
            <div class="lifeline-matrix-header">
                <div class="lifeline-matrix-corner"></div>
                ${matrixHeaderCells}
            </div>
            ${matrixRows}
        </div>
        <div class="lifeline-matrix-legend">
            <span class="lifeline-legend-item"><span class="lifeline-legend-swatch" style="background: hsl(120, 40%, 25%)"></span>Low (&lt;30)</span>
            <span class="lifeline-legend-item"><span class="lifeline-legend-swatch" style="background: hsl(35, 60%, 25%)"></span>Medium (30-60)</span>
            <span class="lifeline-legend-item"><span class="lifeline-legend-swatch" style="background: hsl(0, 70%, 25%)"></span>High (&gt;60)</span>
        </div>
    </div>`;

    // ── Disruption Scenarios ────────────────────────────────────────
    const scenariosHtml = `
    <div class="lifeline-scenarios">
        <div class="lifeline-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Disruption Scenarios
        </div>
        <div class="lifeline-scenarios-grid">
            ${scenarios.map(s => {
                const probColor = s.probability > 0.3 ? '#ff2244' : s.probability > 0.1 ? '#ff8800' : '#ffcc00';
                return `
                <div class="lifeline-scenario-card">
                    <div class="lifeline-scenario-header">
                        <div class="lifeline-scenario-name">${s.name}</div>
                        <div class="lifeline-scenario-prob" style="color: ${probColor}">
                            P = ${(s.probability * 100).toFixed(1)}%
                        </div>
                    </div>
                    <div class="lifeline-scenario-trigger">${s.trigger}</div>
                    <div class="lifeline-scenario-duration">Est. Duration: ${s.duration}</div>
                    <div class="lifeline-scenario-impacts">
                        ${s.impacts.map(imp => `
                            <div class="lifeline-scenario-impact lifeline-scenario-impact-${imp.severity}">
                                <span class="lifeline-scenario-impact-metric">${imp.metric}</span>
                                <span class="lifeline-scenario-impact-value">${imp.value}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    // ── Assemble Full HTML ──────────────────────────────────────────
    return `
    <div class="lifeline-container">
        <div class="lifeline-header">
            <div class="lifeline-title">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                </svg>
                LIFELINE — Supply Chain Vulnerability Analysis
            </div>
            <div class="lifeline-subtitle">Real-time logistics & economic disruption modeling from conflict zone intelligence</div>
            <div class="lifeline-timestamp">Analysis generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC | Sources: ${engine.incidents.length} incidents</div>
        </div>
        ${statsHtml}
        <div class="lifeline-section-title lifeline-routes-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>
            Supply Route Assessment
        </div>
        <div class="lifeline-routes-grid">
            ${routeCardsHtml}
        </div>
        ${impactHtml}
        ${matrixHtml}
        ${scenariosHtml}
    </div>`;
}

// =====================================================================
// EXPORTS
// =====================================================================

window.LifelineEngine = LifelineEngine;
window.renderLifeline = renderLifeline;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LifelineEngine, renderLifeline };
}
