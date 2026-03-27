/**
 * Gulf Watch - Main Application
 * Real-time geopolitical intelligence platform
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    incidents: [],
    filteredIncidents: [],
    selectedIncident: null,
    currentSection: 'monitor',
    filters: {
        country: 'all',
        severity: 'all',
        type: 'all',
        time: '24h'
    },
    map: null,
    markers: [],
    airspaceLayer: null,
    financeData: null
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function updateEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showError(message) {
    console.error('❌', message);
    // Could also show a toast/notification here
}

function updateLastUpdateTime() {
    const el = document.getElementById('last-update');
    if (el) {
        el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }
}

function updateCasualtyCounts() {
    // Calculate casualty statistics from incidents
    let total = 0, military = 0, civilian = 0;
    state.filteredIncidents.forEach(inc => {
        if (inc.casualties) {
            total += inc.casualties.total || 0;
            military += inc.casualties.military || 0;
            civilian += inc.casualties.civilian || 0;
        }
    });
    // Update both old and new element IDs for compatibility
    updateEl('casualty-total', total.toLocaleString());
    updateEl('casualty-military', military.toLocaleString());
    updateEl('casualty-civilian', civilian.toLocaleString());
    // Right rail IDs
    updateEl('total-casualties', total.toLocaleString());
    updateEl('military-casualties', military.toLocaleString());
    updateEl('civilian-casualties', civilian.toLocaleString());
}

function updateValidationStats() {
    const stats = { validated: 0, pending: 0, disputed: 0 };
    state.filteredIncidents.forEach(inc => {
        const status = inc.verification?.status || 'UNCONFIRMED';
        if (status === 'VERIFIED') stats.validated++;
        else if (status === 'DISPUTED') stats.disputed++;
        else stats.pending++;
    });
    updateEl('validated-count', stats.validated);
    updateEl('pending-count', stats.pending);
    updateEl('disputed-count', stats.disputed);
}

function initializeRailModules() {
    // Rail modules are the side widgets (casualties, validation stats, etc.)
    updateCasualtyCounts();
    updateValidationStats();
    updateFinancePanel();
    updateAirspaceSummary();
    updateSourceReliability();
    updateConflictIntensity();

    // Set up rail module toggles
    document.querySelectorAll('.rail-header').forEach(header => {
        header.addEventListener('click', () => {
            const module = header.closest('.rail-module');
            module.classList.toggle('collapsed');
        });
    });
}

function updateFinancePanel() {
    const prices = state.financeData || {};

    // Brent Crude
    const brent = prices.brent || {};
    updateEl('brent-price', brent.price ? `$${brent.price.toFixed(2)}` : '--');
    updateEl('brent-change', brent.change ? `${brent.change > 0 ? '+' : ''}${brent.change.toFixed(2)}%` : '--');

    // Gold
    const gold = prices.gold || {};
    updateEl('gold-price', gold.price ? `$${gold.price.toFixed(2)}` : '--');
    updateEl('gold-change', gold.change ? `${gold.change > 0 ? '+' : ''}${gold.change.toFixed(2)}%` : '--');

    // Bitcoin
    const bitcoin = prices.bitcoin || {};
    updateEl('bitcoin-price', bitcoin.price ? `$${bitcoin.price.toLocaleString()}` : '--');
    updateEl('bitcoin-change', bitcoin.change ? `${bitcoin.change > 0 ? '+' : ''}${bitcoin.change.toFixed(2)}%` : '--');

    // Natural Gas
    const gas = prices.gas || {};
    updateEl('gas-price', gas.price ? `$${gas.price.toFixed(2)}` : '--');
    updateEl('gas-change', gas.change ? `${gas.change > 0 ? '+' : ''}${gas.change.toFixed(2)}%` : '--');

    // Copper
    const copper = prices.copper || {};
    updateEl('copper-price', copper.price ? `$${copper.price.toFixed(2)}` : '--');
    updateEl('copper-change', copper.change ? `${copper.change > 0 ? '+' : ''}${copper.change.toFixed(2)}%` : '--');

    // Iron Ore
    const iron = prices.iron || {};
    updateEl('iron-price', iron.price ? `$${iron.price.toFixed(2)}` : '--');
    updateEl('iron-change', iron.change ? `${iron.change > 0 ? '+' : ''}${iron.change.toFixed(2)}%` : '--');
}

function updateAirspaceSummary() {
    // Count airspace alerts from incidents
    let alerts = 0;
    state.filteredIncidents.forEach(inc => {
        if (inc.type === 'air_defense' || inc.type === 'alert') {
            alerts++;
        }
    });

    // Update alerts count text
    const alertsEl = document.getElementById('airspace-alerts');
    if (alertsEl) {
        alertsEl.textContent = alerts > 0 ? `${alerts} Active Alerts` : 'Clear';
    }

    // Update status indicator
    const statusEl = document.getElementById('airspace-status');
    if (statusEl) {
        statusEl.className = 'airspace-status ' + (alerts > 0 ? 'warning' : 'normal');
    }
}

function updateSourceReliability() {
    // Calculate source statistics
    const sources = {};
    state.filteredIncidents.forEach(inc => {
        const source = inc.source || 'Unknown';
        if (!sources[source]) {
            sources[source] = { count: 0, verified: 0 };
        }
        sources[source].count++;
        if (inc.verification?.status === 'VERIFIED') {
            sources[source].verified++;
        }
    });

    // Get top 5 sources
    const topSources = Object.entries(sources)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

    // Update source list
    const container = document.getElementById('source-list');
    if (container) {
        if (topSources.length === 0) {
            container.innerHTML = '<div class="source-item"><span>No data</span></div>';
        } else {
            container.innerHTML = topSources.map(([name, stats]) => {
                const reliability = stats.count > 0 ? Math.round((stats.verified / stats.count) * 100) : 0;
                let color = '#ff4444';
                if (reliability > 80) color = '#44ff88';
                else if (reliability > 50) color = '#ffcc00';

                return `
                    <div class="source-item">
                        <span class="source-name">${escapeHtml(name)}</span>
                        <span class="source-score" style="color: ${color}">${reliability}%</span>
                    </div>
                `;
            }).join('');
        }
    }
}

function updateConflictIntensity() {
    // Calculate severity distribution
    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    state.filteredIncidents.forEach(inc => {
        const level = getSeverityLevel(inc);
        severity[level]++;
    });

    const total = state.filteredIncidents.length;

    // Update intensity bars
    updateIntensityBar('critical-bar', 'critical-count', severity.critical, total);
    updateIntensityBar('high-bar', 'high-count', severity.high, total);
    updateIntensityBar('medium-bar', 'medium-count', severity.medium, total);
    updateIntensityBar('low-bar', 'low-count', severity.low, total);
}

function updateIntensityBar(barId, countId, count, total) {
    const bar = document.getElementById(barId);
    const countEl = document.getElementById(countId);

    if (bar && total > 0) {
        const percentage = (count / total) * 100;
        bar.style.width = `${percentage}%`;
    }

    if (countEl) {
        countEl.textContent = count;
    }
}

// ============================================================================
// VISITOR TRACKING
// ============================================================================

function trackVisitor() {
    // Track unique visitor with localStorage
    const visitorKey = 'gulfwatch_visitor_id';
    const countKey = 'gulfwatch_visitor_count';
    const lastVisitKey = 'gulfwatch_last_visit';

    let visitorId = localStorage.getItem(visitorKey);
    const now = Date.now();
    const lastVisit = parseInt(localStorage.getItem(lastVisitKey) || '0');
    const isNewSession = (now - lastVisit) > (30 * 60 * 1000); // 30 min session timeout

    if (!visitorId || isNewSession) {
        // New visitor or new session
        visitorId = 'visitor_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(visitorKey, visitorId);

        // Increment count (in production this would be server-side)
        let count = parseInt(localStorage.getItem(countKey) || '0');
        count++;
        localStorage.setItem(countKey, count.toString());
    }

    localStorage.setItem(lastVisitKey, now.toString());

    // Display count
    const countEl = document.getElementById('visitor-count');
    const counterEl = document.getElementById('visitor-counter');
    if (countEl && counterEl) {
        const count = parseInt(localStorage.getItem(countKey) || '0');
        countEl.textContent = count.toLocaleString();
        counterEl.style.display = 'inline-flex';
    }

    return visitorId;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    trackVisitor();
    initializeApp();
});

async function initializeApp() {
    console.log('🌊 Gulf Watch initializing...');

    // Load data
    await loadIncidents();
    await loadFinanceData();

    // Initialize UI
    initializeNavigation();
    initializeFilters();
    initializeMap();
    initializeRailModules();

    // Render initial state
    renderIncidents();
    updateLastUpdateTime();

    // Start auto-refresh
    setInterval(refreshData, 60000); // Every minute

    console.log('✅ Gulf Watch ready');
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadIncidents() {
    try {
        const response = await fetch('incidents.json?t=' + Date.now());
        const data = await response.json();

        state.incidents = data.incidents || [];
        applyFilters();
        
        // Populate Ragnarok selectors if initialized
        if (ragnarokInitialized) {
            populateRagnarokSelectors();
        }

        console.log(`📊 Loaded ${state.incidents.length} incidents`);
    } catch (error) {
        console.error('❌ Failed to load incidents:', error);
        showError('Failed to load incident data');
    }
}

async function loadFinanceData() {
    try {
        const response = await fetch('prices.json?t=' + Date.now());
        const data = await response.json();
        state.financeData = data.prices || {}; // Extract prices object
        updateFinancePanel();
    } catch (error) {
        console.error('❌ Failed to load finance data:', error);
    }
}

async function refreshData() {
    await loadIncidents();
    updateLastUpdateTime();

    if (state.currentSection === 'map') {
        updateMapMarkers();
    }
}

// ============================================================================
// NAVIGATION
// ============================================================================

function initializeNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.section');

    console.log(`📑 Initializing navigation: ${tabs.length} tabs, ${sections.length} sections`);

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const section = tab.dataset.section;
            console.log(`🖱️ Tab clicked: ${section}`);

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show selected section
            sections.forEach(s => {
                const isMatch = s.dataset.section === section;
                s.style.display = isMatch ? 'block' : 'none';
                s.classList.toggle('active', isMatch);
                if (isMatch) {
                    s.style.visibility = 'visible';
                    s.style.opacity = '1';
                    s.style.height = 'auto';
                    console.log('Showing ' + s.id + ' display=' + s.style.display + ' computedHeight=' + getComputedStyle(s).height);
                }
                console.log(`  Section ${s.dataset.section}: ${isMatch ? 'SHOW' : 'hide'}`);
            });

            state.currentSection = section;

            // Section-specific initialization
            if (section === 'map') {
                setTimeout(() => {
                    if (state.map) state.map.invalidateSize();
                    updateMapMarkers();
                }, 100);
            } else if (section === 'missile-defense') {
                // Initialize missile defense dashboard
                initializeMissileDefense();
            } else if (section === 'analysis') {
                // Initialize analysis charts
                initializeAnalysis();
            } else if (section === 'prediction') {
                // Initialize prediction engine
                initializePrediction();
            } else if (section === 'reports') {
                // Initialize reports tab
                initializeReports();
            } else if (section === 'data') {
                // Initialize data tab
                initializeData();
            } else if (section === 'ragnarok') {
                // Initialize Ragnarok OODA engine
                initializeRagnarok();
                // Render immediately with first available incident
                const output = document.getElementById('ragnarok-output');
                const incidents = state.incidents || [];
                console.log('Ragnarok tab opened, incidents count:', incidents.length);
                if (output) {
                    if (incidents.length > 0) {
                        console.log('Rendering with incident:', incidents[0].title);
                        output.innerHTML = renderRagnarok(incidents[0]);
                    } else {
                        console.log('No incidents, rendering demo');
                        output.innerHTML = renderRagnarok({
                            id: 1,
                            title: 'Demo: Houthi ballistic missile intercepted over Red Sea',
                            type: 'missile',
                            severity: 'critical',
                            published: new Date().toISOString(),
                            verification: { status: 'VERIFIED' }
                        });
                    }
                }
            }
        });
    });
}

// ============================================================================
// MISSILE DEFENSE DASHBOARD
// ============================================================================

function initializeMissileDefense() {
    if (!missileDefenseInitialized) {
        // Set up country selector
        const countrySelect = document.getElementById('missile-defense-country');
        if (countrySelect) {
            countrySelect.addEventListener('change', (e) => {
                updateMissileDefenseDashboard(e.target.value);
            });
        }
        missileDefenseInitialized = true;
    }

    // Initial update with current selection
    const countrySelect = document.getElementById('missile-defense-country');
    if (countrySelect) {
        updateMissileDefenseDashboard(countrySelect.value);
    }
}

function updateMissileDefenseDashboard(selectedCountry) {
    const stats = calculateMissileDefenseStats(selectedCountry);

    // Update title
    const titleEl = document.getElementById('missile-defense-title');
    if (titleEl) {
        const countryName = selectedCountry === 'all' ? 'REGIONAL' : getCountryDisplayName(selectedCountry).toUpperCase();
        titleEl.textContent = `${countryName} MISSILE DEFENSE`;
    }

    // Update main metrics
    updateMetric('metric-detected', stats.total.detected);
    updateMetric('metric-intercepted', stats.total.intercepted);
    updateMetric('metric-impacted', stats.total.impacted);

    // Update ballistic missiles
    updateMetric('ballistic-detected', stats.ballistic.detected);
    updateMetric('ballistic-intercepted', stats.ballistic.intercepted);

    // Update drones
    updateMetric('drone-detected', stats.drone.detected);
    updateMetric('drone-intercepted', stats.drone.intercepted);

    // Update 24h stats
    updateMetric('24h-detected', stats.last24h.detected);
    updateMetric('24h-intercepted', stats.last24h.intercepted);

    // Update success rate
    const successRate = calculateSuccessRate(stats.total.intercepted, stats.total.impacted);
    updateSuccessRate(successRate);

    // Update country table
    updateCountryTable(stats.countryBreakdown, selectedCountry);

    // Update source attribution
    updateMissileDefenseSource(selectedCountry);

    // Update last updated time
    const lastUpdatedEl = document.getElementById('missile-last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleString()}`;
    }
}

function calculateMissileDefenseStats(selectedCountry) {
    const relevantTypes = ['missile', 'air_defense', 'drone', 'attack'];
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const stats = {
        total: { detected: 0, intercepted: 0, impacted: 0 },
        ballistic: { detected: 0, intercepted: 0 },
        drone: { detected: 0, intercepted: 0 },
        last24h: { detected: 0, intercepted: 0 },
        countryBreakdown: {}
    };

    // Initialize country breakdown
    const countries = ['uae', 'saudi', 'qatar', 'bahrain', 'kuwait', 'israel', 'iran'];
    countries.forEach(country => {
        stats.countryBreakdown[country] = {
            detected: 0,
            intercepted: 0,
            impacted: 0
        };
    });

    state.incidents.forEach(incident => {
        // Check if incident is relevant type
        const incidentType = (incident.type || '').toLowerCase();
        const isRelevantType = relevantTypes.includes(incidentType);

        // Check if it's a missile/drone related incident by title keywords
        const title = (incident.title || '').toLowerCase();
        const isMissileRelated = title.includes('missile') || title.includes('rocket') ||
                                 title.includes('ballistic') || title.includes('intercept') ||
                                 title.includes('air defense') || title.includes('shot down') ||
                                 title.includes('drone') || title.includes('uav');

        if (!isRelevantType && !isMissileRelated) return;

        // Determine country
        const countryCode = getCountryCode(incident.location?.country);
        if (countryCode === 'unknown') return;

        // Filter by selected country if not 'all'
        if (selectedCountry !== 'all' && countryCode !== selectedCountry) return;

        // Check if intercepted
        const isIntercepted = isIncidentIntercepted(incident);
        const isImpacted = !isIntercepted && (incidentType === 'missile' || incidentType === 'attack' ||
                          title.includes('impact') || title.includes('hit') || title.includes('strike'));

        // Update stats
        stats.total.detected++;
        if (isIntercepted) stats.total.intercepted++;
        if (isImpacted) stats.total.impacted++;

        // Update country breakdown
        if (stats.countryBreakdown[countryCode]) {
            stats.countryBreakdown[countryCode].detected++;
            if (isIntercepted) stats.countryBreakdown[countryCode].intercepted++;
            if (isImpacted) stats.countryBreakdown[countryCode].impacted++;
        }

        // Categorize by type
        if (incidentType === 'missile' || title.includes('missile') || title.includes('ballistic') || title.includes('rocket')) {
            stats.ballistic.detected++;
            if (isIntercepted) stats.ballistic.intercepted++;
        } else if (incidentType === 'drone' || title.includes('drone') || title.includes('uav')) {
            stats.drone.detected++;
            if (isIntercepted) stats.drone.intercepted++;
        }

        // Check if within last 24 hours
        const incidentDate = new Date(incident.published);
        if (incidentDate >= twentyFourHoursAgo) {
            stats.last24h.detected++;
            if (isIntercepted) stats.last24h.intercepted++;
        }
    });

    return stats;
}

function isIncidentIntercepted(incident) {
    const title = (incident.title || '').toLowerCase();
    const status = (incident.status || '').toLowerCase();
    const type = (incident.type || '').toLowerCase();

    // Check for interception keywords
    const interceptionKeywords = [
        'intercepted', 'shot down', 'downed', 'destroyed', 'neutralized',
        'air defense', 'patriot', 'thaad', 'iron dome', 'arrow',
        'successfully intercepted', 'defense system', 'intercept'
    ];

    // Check verification badge
    const verification = incident.verification || {};
    if (verification.badge === 'VERIFIED' && interceptionKeywords.some(kw => title.includes(kw))) {
        return true;
    }

    // Check title for interception keywords
    if (interceptionKeywords.some(kw => title.includes(kw))) {
        return true;
    }

    // Check if it's an air_defense type incident
    if (type === 'air_defense') {
        return true;
    }

    return false;
}

function calculateSuccessRate(intercepted, impacted) {
    const total = intercepted + impacted;
    if (total === 0) return 0;
    return Math.round((intercepted / total) * 100);
}

function updateMetric(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    }
}

function updateSuccessRate(percentage) {
    const circle = document.getElementById('success-rate-circle');
    const valueEl = document.getElementById('success-rate-value');

    if (circle) {
        const circumference = 100;
        const offset = circumference - (percentage / 100) * circumference;
        circle.style.strokeDasharray = `${percentage}, 100`;
    }

    if (valueEl) {
        valueEl.textContent = `${percentage}%`;
        // Color code based on success rate
        if (percentage >= 80) {
            valueEl.style.color = 'var(--severity-low)';
        } else if (percentage >= 50) {
            valueEl.style.color = 'var(--severity-medium)';
        } else {
            valueEl.style.color = 'var(--severity-critical)';
        }
    }
}

function updateCountryTable(breakdown, selectedCountry) {
    const tbody = document.getElementById('missile-country-tbody');
    if (!tbody) return;

    // If a specific country is selected, show detailed breakdown
    if (selectedCountry !== 'all') {
        const countryData = breakdown[selectedCountry];
        if (countryData) {
            const successRate = calculateSuccessRate(countryData.intercepted, countryData.impacted);
            tbody.innerHTML = `
                <tr>
                    <td>${getCountryDisplayName(selectedCountry)}</td>
                    <td class="value-detected">${countryData.detected}</td>
                    <td class="value-intercepted">${countryData.intercepted}</td>
                    <td class="value-impacted">${countryData.impacted}</td>
                    <td class="success-rate-${successRate >= 80 ? 'high' : successRate >= 50 ? 'medium' : 'low'}">${successRate}%</td>
                </tr>
            `;
        }
        return;
    }

    // Show all countries with data
    let html = '';
    const sortedCountries = Object.entries(breakdown)
        .filter(([_, data]) => data.detected > 0)
        .sort((a, b) => b[1].detected - a[1].detected);

    if (sortedCountries.length === 0) {
        html = '<tr><td colspan="5" class="no-data">No missile defense data available</td></tr>';
    } else {
        sortedCountries.forEach(([country, data]) => {
            const successRate = calculateSuccessRate(data.intercepted, data.impacted);
            html += `
                <tr>
                    <td>${getCountryDisplayName(country)}</td>
                    <td class="value-detected">${data.detected}</td>
                    <td class="value-intercepted">${data.intercepted}</td>
                    <td class="value-impacted">${data.impacted}</td>
                    <td class="success-rate-${successRate >= 80 ? 'high' : successRate >= 50 ? 'medium' : 'low'}">${successRate}%</td>
                </tr>
            `;
        });
    }

    tbody.innerHTML = html;
}

function getCountryDisplayName(countryCode) {
    const names = {
        'uae': '🇦🇪 United Arab Emirates',
        'saudi': '🇸🇦 Saudi Arabia',
        'qatar': '🇶🇦 Qatar',
        'bahrain': '🇧🇭 Bahrain',
        'kuwait': '🇰🇼 Kuwait',
        'oman': '🇴🇲 Oman',
        'israel': '🇮🇱 Israel',
        'iran': '🇮🇷 Iran'
    };
    return names[countryCode] || countryCode.toUpperCase();
}

function updateMissileDefenseSource(selectedCountry) {
    const sourceEl = document.getElementById('missile-defense-source');
    if (!sourceEl) return;

    const sources = {
        'uae': 'UAE Ministry of Interior & General Command of the Armed Forces',
        'saudi': 'Royal Saudi Air Defense Forces & Ministry of Defense',
        'qatar': 'Qatar Armed Forces & Ministry of Defense',
        'bahrain': 'Bahrain Defence Force & Ministry of Interior',
        'kuwait': 'Kuwait Armed Forces & Ministry of Defense',
        'israel': 'Israel Defense Forces (IDF) & Home Front Command',
        'iran': 'Islamic Republic News Agency (IRNA) & Military Sources',
        'all': 'Aggregated from Multiple Government & Defense Sources'
    };

    sourceEl.textContent = sources[selectedCountry] || sources['all'];
}

// ============================================================================
// FILTERS
// ============================================================================

function initializeFilters() {
    // Country filters (desktop)
    document.querySelectorAll('#country-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            toggleFilterChip(chip, 'country');
        });
    });

    // Severity filters (desktop)
    document.querySelectorAll('#severity-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            toggleFilterChip(chip, 'severity');
        });
    });

    // Type filters (desktop)
    document.querySelectorAll('#type-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            toggleFilterChip(chip, 'type');
        });
    });

    // Time filters (desktop)
    document.querySelectorAll('#time-filters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            toggleFilterChip(chip, 'time');
        });
    });

    // Mobile country filter
    const mobileCountryFilter = document.getElementById('mobile-country-filter');
    if (mobileCountryFilter) {
        mobileCountryFilter.addEventListener('change', (e) => {
            state.filters.country = e.target.value;
            applyFilters();
        });
    }

    // Mobile severity filter
    const mobileSeverityFilter = document.getElementById('mobile-severity-filter');
    if (mobileSeverityFilter) {
        mobileSeverityFilter.addEventListener('change', (e) => {
            state.filters.severity = e.target.value;
            applyFilters();
        });
    }

    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            state.filters.search = e.target.value.toLowerCase();
            applyFilters();
        }, 300));
    }
}

function toggleFilterChip(chip, filterType) {
    const container = chip.parentElement;

    // For country/severity/type: allow multiple selections or 'all'
    if (filterType === 'country' || filterType === 'severity' || filterType === 'type') {
        const isAll = chip.dataset[filterType] === 'all';

        if (isAll) {
            // Clicking 'all' clears others
            container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.filters[filterType] = 'all';
        } else {
            // Remove 'all' selection
            const allChip = container.querySelector(`[data-${filterType}="all"]`);
            if (allChip) allChip.classList.remove('active');

            // Toggle this chip
            chip.classList.toggle('active');

            // Update state
            const activeChips = container.querySelectorAll('.filter-chip.active');
            const values = Array.from(activeChips).map(c => c.dataset[filterType]);
            state.filters[filterType] = values.length > 0 ? values : 'all';
        }
    } else {
        // For time: single select
        container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filters[filterType] = chip.dataset[filterType];
    }

    // Sync mobile filters
    syncMobileFilters(filterType);

    applyFilters();
}

function syncMobileFilters(filterType) {
    // Sync mobile country filter
    if (filterType === 'country') {
        const mobileCountry = document.getElementById('mobile-country-filter');
        if (mobileCountry && typeof state.filters.country === 'string') {
            mobileCountry.value = state.filters.country;
        }
    }
    
    // Sync mobile severity filter
    if (filterType === 'severity') {
        const mobileSeverity = document.getElementById('mobile-severity-filter');
        if (mobileSeverity && typeof state.filters.severity === 'string') {
            mobileSeverity.value = state.filters.severity;
        }
    }
}

function applyFilters() {
    state.filteredIncidents = state.incidents.filter(incident => {
        // Country filter
        if (state.filters.country !== 'all') {
            const countries = Array.isArray(state.filters.country)
                ? state.filters.country
                : [state.filters.country];
            const incidentCountry = getCountryCode(incident.location?.country);
            if (!countries.includes(incidentCountry)) return false;
        }

        // Severity filter
        if (state.filters.severity !== 'all') {
            const severities = Array.isArray(state.filters.severity)
                ? state.filters.severity
                : [state.filters.severity];
            const incidentSeverity = getSeverityLevel(incident);
            if (!severities.includes(incidentSeverity)) return false;
        }

        // Type filter
        if (state.filters.type !== 'all') {
            const types = Array.isArray(state.filters.type)
                ? state.filters.type
                : [state.filters.type];
            const incidentType = incident.type?.toLowerCase() || 'unknown';
            if (!types.includes(incidentType)) return false;
        }

        // Time filter
        if (state.filters.time !== 'all') {
            const incidentDate = new Date(incident.published);
            const now = new Date();
            const hoursAgo = (now - incidentDate) / (1000 * 60 * 60);

            switch (state.filters.time) {
                case '24h':
                    if (hoursAgo > 24) return false;
                    break;
                case '7d':
                    if (hoursAgo > 168) return false;
                    break;
                case '30d':
                    if (hoursAgo > 720) return false;
                    break;
            }
        }

        // Search filter
        if (state.filters.search) {
            const searchText = state.filters.search;
            const title = incident.title?.toLowerCase() || '';
            const source = incident.source?.toLowerCase() || '';
            const country = incident.location?.country?.toLowerCase() || '';

            if (!title.includes(searchText) &&
                !source.includes(searchText) &&
                !country.includes(searchText)) {
                return false;
            }
        }

        return true;
    });

    renderIncidents();
    updateMapMarkers();
    updateCasualtyCounts();
    updateValidationStats();
}

function getCountryCode(country) {
    if (!country) return 'unknown';
    const map = {
        'uae': 'uae', 'united arab emirates': 'uae',
        'saudi': 'saudi', 'saudi arabia': 'saudi',
        'qatar': 'qatar',
        'bahrain': 'bahrain',
        'kuwait': 'kuwait',
        'oman': 'oman',
        'israel': 'israel',
        'iran': 'iran',
        'lebanon': 'lebanon'
    };
    return map[country.toLowerCase()] || 'unknown';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getSeverityLevel(incident) {
    // Use verification badge or derive from keywords
    const title = incident.title?.toLowerCase() || '';

    if (incident.verification?.badge === 'CRITICAL') return 'critical';
    if (title.includes('killed') || title.includes('death') || title.includes('attack')) {
        return 'high';
    }
    if (title.includes('intercept') || title.includes('defense')) {
        return 'medium';
    }
    return 'low';
}

// ============================================================================
// INCIDENT RENDERING
// ============================================================================

function getEventTypeIcon(type) {
    const icons = {
        'missile': '†',           // Dagger/cross
        'air_defense': '⌖',       // Target
        'attack': '⚔',            // Crossed swords
        'security': '⚑',          // Flag
        'alert': '⚠',             // Warning
        'drone': '✦',             // Star
        'airstrike': '✈',         // Aircraft
        'explosion': '❋',         // Explosion
        'naval': '⚓',             // Anchor
        'cyber': '⌘',             // Command
        'default': '●'            // Circle
    };
    return icons[type?.toLowerCase()] || icons['default'];
}

function getEventTypeClass(type) {
    return 'type-' + (type?.toLowerCase() || 'default');
}

function renderIncidents() {
    const container = document.getElementById('incident-feed');
    if (!container) return;

    if (state.filteredIncidents.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-title">No incidents found</div>
                <div class="empty-state-text">Try adjusting your filters or search criteria</div>
            </div>
        `;
        return;
    }

    container.innerHTML = state.filteredIncidents.map(incident => {
        const flag = getFlagEmoji(incident.location?.country);
        const severity = getSeverityLevel(incident);
        const timeAgo = getTimeAgo(incident.published);
        const verification = incident.verification || {};
        const badgeClass = verification.badge?.toLowerCase() || 'unconfirmed';
        const isGov = incident.is_government;

        const sourceUrl = incident.source_url || incident.url || '#';
        const hasCoords = incident.location?.lat && incident.location?.lng;

        // Determine badge: Government posts get green "VERIFIED", others get regular badge
        const govBadge = isGov ? `<span class="verification-badge verified" style="background: #22c55e; color: #fff; border-color: #22c55e;">VERIFIED</span>` : `<span class="verification-badge ${badgeClass}">${verification.badge || 'UNCONFIRMED'}</span>`;

        return `
            <div class="incident-card" data-id="${incident.id}" onclick="selectIncident(${incident.id})">
                <div class="incident-header">
                    <span class="incident-flag">${flag}</span>
                    <span class="incident-severity ${severity}"></span>
                    <span class="incident-time">${timeAgo}</span>
                    <span class="incident-type" title="${(incident.type || 'INCIDENT').toUpperCase().replace(/_/g, ' ')}">${(incident.type || 'INCIDENT').toUpperCase().replace(/_/g, ' ')}</span>
                    ${govBadge}
                </div>
                <div class="incident-title line-clamp-2">${escapeHtml(incident.title)}</div>
                <div class="incident-coords">
                    ${hasCoords ? `📍 ${incident.location.lat.toFixed(4)}, ${incident.location.lng.toFixed(4)}` : '📍 No coordinates'}
                </div>
                <div class="incident-source">
                    ${incident.source || 'Unknown'}
                    ${incident.num_sources ? `+ ${incident.num_sources - 1} sources` : ''}
                </div>
                <div class="incident-actions">
                    <button class="incident-action-btn" onclick="event.stopPropagation(); window.open('${escapeHtml(sourceUrl)}', '_blank')" title="View Source">
                        🔗 Source
                    </button>
                    <a class="incident-action-btn" href="https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(incident.title)}&op=translate" target="_blank" rel="noopener" title="Translate">
                        🌐 Translate
                    </a>
                    <button class="incident-action-btn report-btn" onclick="event.stopPropagation(); openReportModal(${incident.id})" title="Report False Claim">
                        🚩 Report
                    </button>
                    <button class="incident-action-btn ragnarok-action-btn" onclick="event.stopPropagation(); showRagnarokModal(state.incidents.find(i => i.id === ${incident.id}))" title="Ragnarok OODA">
                        ⚡ Ragnarok
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function selectIncident(id) {
    const card = document.querySelector(`.incident-card[data-id="${id}"]`);
    if (!card) return;

    // Toggle expanded state
    const isExpanded = card.classList.contains('expanded');

    // Collapse all others
    document.querySelectorAll('.incident-card').forEach(c => c.classList.remove('expanded', 'active'));

    if (!isExpanded) {
        card.classList.add('expanded', 'active');
        state.selectedIncident = state.incidents.find(i => i.id === id);

        // Center map on incident
        if (state.map && state.selectedIncident?.location) {
            const { lat, lng } = state.selectedIncident.location;
            state.map.setView([lat, lng], 8);
        }
    } else {
        state.selectedIncident = null;
    }
}

function getFlagEmoji(country) {
    const flags = {
        'uae': '🇦🇪', 'united arab emirates': '🇦🇪',
        'saudi': '🇸🇦', 'saudi arabia': '🇸🇦',
        'qatar': '🇶🇦',
        'bahrain': '🇧🇭',
        'kuwait': '🇰🇼',
        'oman': '🇴🇲',
        'israel': '🇮🇱',
        'iran': '🇮🇷',
        'lebanon': '🇱🇧'
    };
    return flags[country?.toLowerCase()] || '🌍';
}

function getTimeAgo(dateString) {
    if (!dateString) return 'Unknown';

    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================================================
// MAP
function initializeMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    // Initialize Leaflet
    state.map = L.map('map', {
        center: [29.0, 48.0],
        zoom: 6,
        minZoom: 4,
        maxZoom: 12,
        zoomControl: false
    });

    // Add zoom control to top right
    L.control.zoom({
        position: 'topright'
    }).addTo(state.map);

    // Add dark theme tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(state.map);

    // Layer toggles
    document.querySelectorAll('.layer-toggle input').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const layer = e.target.dataset.layer;
            const isActive = e.target.checked;

            if (layer === 'airspace') {
                toggleAirspaceLayer(isActive);
            } else if (layer === 'aircraft') {
                if (isActive) startAircraftTracking();
                else stopAircraftTracking();
            } else if (layer === 'satellites') {
                if (isActive) startSatelliteTracking();
                else stopSatelliteTracking();
            } else if (layer === 'maritime') {
                if (isActive) startMaritimeTracking();
                else stopMaritimeTracking();
            }

            e.target.parentElement.classList.toggle('active', isActive);
        });
    });

    updateMapMarkers();
}

function updateMapMarkers() {
    if (!state.map) return;

    // Clear existing markers
    state.markers.forEach(marker => state.map.removeLayer(marker));
    state.markers = [];

    // Add markers for filtered incidents
    state.filteredIncidents.forEach(incident => {
        if (!incident.location?.lat || !incident.location?.lng) return;

        const { lat, lng } = incident.location;
        const severity = getSeverityLevel(incident);
        const color = getSeverityColor(severity);

        // Create custom marker
        const marker = L.circleMarker([lat, lng], {
            radius: 8,
            fillColor: color,
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(state.map);

        // Add popup
        const popupContent = `
            <div style="font-family: var(--font-sans); min-width: 200px;">
                <div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(incident.title?.substring(0, 60))}...</div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    ${getFlagEmoji(incident.location?.country)} ${incident.source || 'Unknown'} • ${getTimeAgo(incident.published)}
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);

        // Click to select
        marker.on('click', () => {
            selectIncident(incident.id);
        });

        state.markers.push(marker);
    });
}

function getSeverityColor(severity) {
    const colors = {
        critical: '#ff4444',
        high: '#ff8800',
        medium: '#ffcc00',
        low: '#44ff88'
    };
    return colors[severity] || '#888';
}

function toggleAirspaceLayer(show) {
    if (!state.map) return;

    if (show) {
        // Create airspace layer showing air defense and alert incidents
        if (state.airspaceLayer) {
            state.map.removeLayer(state.airspaceLayer);
        }

        state.airspaceLayer = L.layerGroup().addTo(state.map);

        state.filteredIncidents.forEach(incident => {
            if (incident.type === 'air_defense' || incident.type === 'alert') {
                if (!incident.location?.lat || !incident.location?.lng) return;

                const { lat, lng } = incident.location;

                // Create airspace marker (circle with pulse effect)
                const marker = L.circleMarker([lat, lng], {
                    radius: 15,
                    fillColor: '#00d4ff',
                    color: '#fff',
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.3
                }).addTo(state.airspaceLayer);

                // Add popup
                const popupContent = `
                    <div style="font-family: var(--font-sans); min-width: 200px;">
                        <div style="font-weight: 600; color: #00d4ff; margin-bottom: 4px;">${getEventTypeIcon(incident.type)} ${incident.type.replace('_', ' ').toUpperCase()}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(incident.title?.substring(0, 60))}...</div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            ${getFlagEmoji(incident.location?.country)} ${incident.source || 'Unknown'} • ${getTimeAgo(incident.published)}
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent);
            }
        });

        console.log('✅ Airspace layer showing air defense/alert incidents');
    } else {
        // Hide airspace layer
        if (state.airspaceLayer) {
            state.map.removeLayer(state.airspaceLayer);
            state.airspaceLayer = null;
        }
        console.log('❌ Airspace layer hidden');
    }
}

// ============================================================================
// REAL-TIME TRACKING LAYERS (Aircraft, Satellites, Maritime)
// ============================================================================

let aircraftLayer = null;
let satelliteLayer = null;
let maritimeLayer = null;
let aircraftInterval = null;
let satelliteInterval = null;
let maritimeInterval = null;
let analysisInitialized = false;
let predictionInitialized = false;
let missileDefenseInitialized = false;

// Aircraft Tracking - OpenSky API (via proxy)
let aircraftCache = null;
let aircraftCacheTime = 0;
const AIRCRAFT_CACHE_TTL = 30000; // 30 seconds

async function fetchAircraftData() {
    try {
        // Check cache first
        const now = Date.now();
        if (aircraftCache && (now - aircraftCacheTime) < AIRCRAFT_CACHE_TTL) {
            console.log('✈️ Using cached aircraft data');
            return aircraftCache;
        }
        
        // Use local API proxy to avoid CORS
        const response = await fetch('/api/aircraft');
        
        if (!response.ok) {
            console.warn(`✈️ API error ${response.status}. Using cached data if available.`);
            return aircraftCache || [];
        }
        
        const data = await response.json();
        aircraftCache = data.states || [];
        aircraftCacheTime = now;
        console.log(`✈️ Fetched ${aircraftCache.length} aircraft from API`);
        return aircraftCache;
    } catch (error) {
        console.error('Failed to fetch aircraft data:', error);
        return aircraftCache || [];
    }
}

function updateAircraftLayer(aircraft) {
    if (!state.map) {
        console.log('❌ No map available');
        return;
    }

    console.log(`✈️ Processing ${aircraft?.length || 0} aircraft`);

    // Clear existing aircraft markers
    if (aircraftLayer) {
        state.map.removeLayer(aircraftLayer);
        aircraftLayer = null;
    }

    if (!aircraft || aircraft.length === 0) {
        console.log('❌ No aircraft data');
        return;
    }

    // Create layer group
    aircraftLayer = L.layerGroup();

    let added = 0;
    const center = state.map.getCenter();
    const zoom = state.map.getZoom();
    console.log(`✈️ Map center: [${center.lat}, ${center.lng}], zoom: ${zoom}`);

    // Sample some aircraft to see where they are
    const sampleAircraft = aircraft.slice(0, 10);
    console.log('✈️ Sample aircraft locations:', sampleAircraft.map(a => `${a[0]}: [${a[6]}, ${a[5]}]`));

    aircraft.forEach((state, index) => {
        const [icao24, callsign, originCountry, timePosition, lastContact, lon, lat, baroAltitude, onGround, velocity, trueTrack, verticalRate, sensors, geoAltitude, squawk, spi, positionSource] = state;

        if (lat != null && lon != null && !isNaN(lat) && !isNaN(lon)) {
            // Validate coordinates
            if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                // Create marker - BRIGHT RED for maximum visibility
                const marker = L.circleMarker([lat, lon], {
                    radius: 15,
                    fillColor: '#ff0000',
                    color: '#ffffff',
                    weight: 3,
                    opacity: 1,
                    fillOpacity: 1
                });

                const popupContent = `
                    <div style="font-family: sans-serif; min-width: 180px; padding: 8px;">
                        <div style="font-weight: bold; color: #00d4ff; margin-bottom: 4px;">✈️ ${(callsign || '').trim() || icao24}</div>
                        <div style="font-size: 11px; color: #666;">
                            Country: ${originCountry || 'Unknown'}<br>
                            Altitude: ${Math.round(baroAltitude || 0)}m<br>
                            Speed: ${Math.round((velocity || 0) * 3.6)} km/h
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent);
                aircraftLayer.addLayer(marker);
                added++;
            }
        }
    });

    // Add the layer to map
    aircraftLayer.addTo(state.map);

    console.log(`✈️ SUCCESS: ${added} aircraft displayed as RED circles`);
}

function startAircraftTracking() {
    // Don't start if already running
    if (aircraftInterval) return;
    
    // Initial fetch
    fetchAircraftData().then(updateAircraftLayer);

    // Update every 30 seconds to avoid rate limiting
    aircraftInterval = setInterval(() => {
        fetchAircraftData().then(updateAircraftLayer);
    }, 30000);
}

function stopAircraftTracking() {
    // Clear the interval
    if (aircraftInterval) {
        clearInterval(aircraftInterval);
        aircraftInterval = null;
    }
    // Remove the layer
    if (aircraftLayer) {
        state.map.removeLayer(aircraftLayer);
        aircraftLayer = null;
    }
}

// Satellite Tracking - Ground Station Integration (Satellite Position Data API)
let satellitePositionAPI = null;

function initSatellitePositionAPI() {
    if (!satellitePositionAPI && typeof SatellitePositionDataAPI !== 'undefined') {
        satellitePositionAPI = new SatellitePositionDataAPI();
        console.log('🛰️ Satellite Position Data API initialized (Ground Station Integration)');
    }
}

function updateSatelliteLayer() {
    if (!state.map) return;

    // Initialize API if needed
    initSatellitePositionAPI();

    // Clear existing satellite markers
    if (satelliteLayer) {
        state.map.removeLayer(satelliteLayer);
    }

    satelliteLayer = L.layerGroup().addTo(state.map);

    // Get real satellite positions from Satellite Position Data API
    if (satellitePositionAPI) {
        const positions = satellitePositionAPI.getAllPositions();
        
        positions.forEach(sat => {
            // Only show satellites in the Gulf region (roughly)
            // lat: 10-40, lon: 30-65
            if (sat.latitude < 10 || sat.latitude > 40 || sat.longitude < 30 || sat.longitude > 65) {
                return; // Skip satellites not over Gulf region
            }

            const satelliteIcon = L.divIcon({
                className: 'satellite-marker',
                html: `<div style="
                    width: 14px;
                    height: 14px;
                    background: #ffd700;
                    border: 2px solid #fff;
                    border-radius: 50%;
                    box-shadow: 0 0 12px #ffd700;
                "></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            const marker = L.marker([sat.latitude, sat.longitude], { icon: satelliteIcon });

            const popupContent = `
                <div style="font-family: var(--font-sans); min-width: 200px;">
                    <div style="font-weight: 600; color: #ffd700; margin-bottom: 4px;">🛰️ ${sat.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        Type: ${sat.type}<br>
                        NORAD ID: ${sat.noradId}<br>
                        Altitude: ${Math.round(sat.altitude)} km<br>
                        Velocity: ${sat.velocity.toFixed(1)} km/s<br>
                        Position: ${sat.latitude.toFixed(2)}°, ${sat.longitude.toFixed(2)}°<br>
                        <span style="color: #44ff88; font-size: 10px;">✓ Live (Satellite Position Data API)</span>
                    </div>
                </div>
            `;

            marker.bindPopup(popupContent);
            satelliteLayer.addLayer(marker);
        });

        console.log(`🛰️ Satellite Position Data API: ${positions.length} satellites tracked, displayed in Gulf region`);
    } else {
        console.warn('🛰️ Satellite Position Data API not available');
    }
}

function startSatelliteTracking() {
    // Don't start if already running
    if (satelliteInterval) return;
    
    updateSatelliteLayer();

    // Slow movement update every 30 seconds
    satelliteInterval = setInterval(updateSatelliteLayer, 30000);
}

function stopSatelliteTracking() {
    // Clear the interval
    if (satelliteInterval) {
        clearInterval(satelliteInterval);
        satelliteInterval = null;
    }
    // Remove the layer
    if (satelliteLayer) {
        state.map.removeLayer(satelliteLayer);
        satelliteLayer = null;
    }
}

// Maritime Tracking - Simulated AIS Data
const VESSELS = [
    { name: 'MSC GULSUN', type: 'Container Ship', lat: 25.2, lon: 55.3, speed: 18 },
    { name: 'EVER GIVEN', type: 'Container Ship', lat: 30.0, lon: 32.5, speed: 12 },
    { name: 'SAFmarine MERU', type: 'Cargo', lat: 24.5, lon: 54.0, speed: 15 },
    { name: 'OPEC Vessel', type: 'Tanker', lat: 26.8, lon: 50.2, speed: 10 },
    { name: 'Coast Guard', type: 'Patrol', lat: 25.9, lon: 56.5, speed: 22 }
];

function updateMaritimeLayer() {
    if (!state.map) return;

    // Clear existing vessel markers
    if (maritimeLayer) {
        state.map.removeLayer(maritimeLayer);
    }

    maritimeLayer = L.layerGroup().addTo(state.map);

    VESSELS.forEach(vessel => {
        // Add slight random movement
        const offsetLat = (Math.random() - 0.5) * 0.1;
        const offsetLon = (Math.random() - 0.5) * 0.1;

        const vesselIcon = L.divIcon({
            className: 'vessel-marker',
            html: `<div style="
                width: 16px;
                height: 16px;
                background: #ff6b35;
                border: 2px solid #fff;
                border-radius: 3px;
                box-shadow: 0 0 10px #ff6b35;
            "></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([vessel.lat + offsetLat, vessel.lon + offsetLon], { icon: vesselIcon });

        const popupContent = `
            <div style="font-family: var(--font-sans); min-width: 180px;">
                <div style="font-weight: 600; color: #ff6b35; margin-bottom: 4px;">🚢 ${vessel.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    Type: ${vessel.type}<br>
                    Speed: ${vessel.speed} knots<br>
                    Status: Underway
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        maritimeLayer.addLayer(marker);
    });

    console.log(`🚢 Added ${VESSELS.length} vessels to map`);
}

function startMaritimeTracking() {
    // Don't start if already running
    if (maritimeInterval) return;
    
    updateMaritimeLayer();

    // Update every 20 seconds
    maritimeInterval = setInterval(updateMaritimeLayer, 20000);
}

function stopMaritimeTracking() {
    // Clear the interval
    if (maritimeInterval) {
        clearInterval(maritimeInterval);
        maritimeInterval = null;
    }
    // Remove the layer
    if (maritimeLayer) {
        state.map.removeLayer(maritimeLayer);
        maritimeLayer = null;
    }
}

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});

function initializeAnalysis() {
    console.log('📊 Initializing Analysis tab...');
    if (!analysisInitialized) {
        analysisInitialized = true;
    }
    // Delay to ensure section is visible before rendering
    setTimeout(() => {
        console.log('📊 Rendering analysis charts...');
        renderAnalysisCharts();
    }, 50);
}

function renderAnalysisCharts() {
    renderTimelineChart();
    renderHeatmapChart();
    renderFinanceChart();
    renderCasualtyChart();
    renderReliabilityChart();
    renderIntensityChart();
}

function renderTimelineChart() {
    const container = document.getElementById('timeline-chart');
    if (!container) return;

    // Group incidents by date
    const incidentsByDate = {};
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    state.incidents.forEach(incident => {
        const date = new Date(incident.published || incident.timestamp);
        if (date >= last30Days) {
            const dateKey = date.toISOString().split('T')[0];
            incidentsByDate[dateKey] = (incidentsByDate[dateKey] || 0) + 1;
        }
    });

    // Sort dates and get last 14 days with data
    const sortedDates = Object.keys(incidentsByDate).sort().slice(-14);
    const maxCount = Math.max(...Object.values(incidentsByDate), 1);

    if (sortedDates.length === 0) {
        container.innerHTML = '<div class="chart-empty">No data available</div>';
        return;
    }

    // Build bar chart
    let html = '<div style="padding: 16px; height: 100%; display: flex; flex-direction: column;">';

    // Header with total
    const totalIncidents = Object.values(incidentsByDate).reduce((a, b) => a + b, 0);
    html += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Last 14 Days</span>
            <span style="font-size: 18px; font-weight: 700; color: var(--accent-cyan);">${totalIncidents} total</span>
        </div>
    `;

    // Chart container with Y-axis
    html += '<div style="display: flex; flex: 1; min-height: 0;">';

    // Y-axis labels
    const yAxisMax = Math.ceil(maxCount / 5) * 5; // Round up to nearest 5
    html += '<div style="display: flex; flex-direction: column; justify-content: space-between; padding-right: 8px; font-size: 10px; color: var(--text-muted);">';
    for (let i = 4; i >= 0; i--) {
        const value = Math.round((yAxisMax / 4) * i);
        html += `<span>${value}</span>`;
    }
    html += '</div>';

    // Bar chart area
    html += '<div style="flex: 1; display: flex; flex-direction: column;">';

    // Grid lines
    html += '<div style="position: relative; flex: 1;">';
    for (let i = 0; i < 5; i++) {
        html += `<div style="position: absolute; left: 0; right: 0; top: ${i * 25}%; border-top: 1px dashed var(--border-subtle); opacity: 0.5;"></div>`;
    }

    // Bars
    html += '<div style="display: flex; align-items: flex-end; justify-content: space-between; height: 100%; gap: 3px; padding-bottom: 32px; position: relative; z-index: 1;">';

    sortedDates.forEach((date, index) => {
        const count = incidentsByDate[date];
        const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
        const dateObj = new Date(date);
        const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' });
        const dateLabel = dateObj.getDate();

        let barColor = 'var(--accent-cyan)';
        if (count === maxCount && maxCount > 0) barColor = '#ff4444';
        else if (count >= maxCount * 0.7) barColor = '#ff8800';

        const isToday = index === sortedDates.length - 1;

        html += `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; position: relative; height: 100%; justify-content: flex-end;" title="${date}: ${count} incidents">
                <div style="width: 100%; height: ${height}%; background: ${barColor}; border-radius: 2px 2px 0 0; min-height: 2px; opacity: ${isToday ? 1 : 0.7}; transition: height 0.3s;"></div>
                <div style="position: absolute; bottom: -20px; font-size: 10px; color: ${isToday ? 'var(--accent-cyan)' : 'var(--text-muted)'}; font-weight: ${isToday ? '600' : '400'};">${dayLabel}</div>
                <div style="position: absolute; bottom: -32px; font-size: 9px; color: var(--text-muted);">${dateLabel}</div>
            </div>
        `;
    });

    html += '</div></div></div></div>';
    container.innerHTML = html;
}

function renderHeatmapChart() {
    const container = document.getElementById('heatmap-chart');
    if (!container) return;

    // All countries in the MENA region we track
    const allCountries = [
        'uae', 'saudi', 'qatar', 'bahrain', 'kuwait', 'oman',
        'israel', 'palestine', 'lebanon', 'syria', 'iraq', 'jordan',
        'egypt', 'yemen', 'iran'
    ];

    // Count incidents by country
    const countryCounts = {};
    allCountries.forEach(c => countryCounts[c] = 0);

    state.incidents.forEach(incident => {
        const countryCode = getCountryCode(incident.location?.country);
        if (countryCode && countryCounts[countryCode] !== undefined) {
            countryCounts[countryCode]++;
        }
    });

    // Sort by count (highest first)
    const sortedCountries = Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1]);

    const maxCount = Math.max(...sortedCountries.map(([_, count]) => count), 1);

    // Show top 10 countries visible, rest scrollable
    const visibleCount = 10;
    const topCountries = sortedCountries.slice(0, visibleCount);
    const remainingCountries = sortedCountries.slice(visibleCount);

    let html = '<div style="height: 100%; display: flex; flex-direction: column;">';

    // Header
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 4px;">';
    html += '<span style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Country</span>';
    html += '<span style="font-size: 11px; color: var(--text-muted);">Incidents</span>';
    html += '</div>';

    // Top countries (always visible)
    html += '<div style="flex-shrink: 0;">';
    topCountries.forEach(([country, count]) => {
        const intensity = count / maxCount;
        const flag = getFlagEmoji(getCountryDisplayName(country));
        const displayName = getCountryDisplayName(country);

        let barColor = '#44ff88';
        if (intensity > 0.75) barColor = '#ff4444';
        else if (intensity > 0.5) barColor = '#ff8800';
        else if (intensity > 0.25) barColor = '#ffcc00';

        html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 4px; background: var(--bg-secondary); border-radius: 4px;">
                <span style="font-size: 14px;">${flag}</span>
                <span style="flex: 0 0 70px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
                <div style="flex: 1; height: 16px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${intensity * 100}%; height: 100%; background: ${barColor};"></div>
                </div>
                <span style="flex: 0 0 24px; text-align: right; font-size: 11px; font-weight: 600; color: var(--text-primary);">${count}</span>
            </div>
        `;
    });
    html += '</div>';

    // Scrollable remaining countries
    if (remainingCountries.length > 0) {
        html += '<div style="flex: 1; overflow-y: auto; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-subtle);">';
        remainingCountries.forEach(([country, count]) => {
            const intensity = count / maxCount;
            const flag = getFlagEmoji(getCountryDisplayName(country));
            const displayName = getCountryDisplayName(country);

            let barColor = '#44ff88';
            if (intensity > 0.75) barColor = '#ff4444';
            else if (intensity > 0.5) barColor = '#ff8800';
            else if (intensity > 0.25) barColor = '#ffcc00';

            html += `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 4px; background: var(--bg-secondary); border-radius: 4px; opacity: 0.8;">
                    <span style="font-size: 14px;">${flag}</span>
                    <span style="flex: 0 0 70px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
                    <div style="flex: 1; height: 16px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${intensity * 100}%; height: 100%; background: ${barColor};"></div>
                    </div>
                    <span style="flex: 0 0 24px; text-align: right; font-size: 11px; font-weight: 600; color: var(--text-primary);">${count}</span>
                </div>
            `;
        });
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderFinanceChart() {
    const container = document.getElementById('finance-chart');
    if (!container) return;

    const prices = state.financeData || {};

    const commodities = [
        { key: 'brent', name: 'Brent Crude', icon: '🛢️' },
        { key: 'gold', name: 'Gold', icon: '🥇' },
        { key: 'bitcoin', name: 'Bitcoin', icon: '₿' },
        { key: 'gas', name: 'Natural Gas', icon: '🔥' }
    ];

    let html = '<div class="chart-finance">';
    commodities.forEach(({ key, name, icon }) => {
        const data = prices[key];
        if (data) {
            const changeClass = data.change >= 0 ? 'positive' : 'negative';
            const changeSymbol = data.change >= 0 ? '+' : '';
            html += `
                <div class="finance-metric">
                    <span class="finance-metric-icon">${icon}</span>
                    <div class="finance-metric-info">
                        <span class="finance-metric-name">${name}</span>
                        <span class="finance-metric-price">$${data.price?.toLocaleString() || '--'}</span>
                    </div>
                    <span class="finance-metric-change ${changeClass}">${changeSymbol}${data.change?.toFixed(2) || '--'}%</span>
                </div>
            `;
        }
    });
    html += '</div>';
    container.innerHTML = html;
}

function renderCasualtyChart() {
    const container = document.getElementById('casualty-chart');
    if (!container) return;

    let total = 0, military = 0, civilian = 0, injured = 0;

    state.incidents.forEach(incident => {
        const casualties = incident.casualties || {};
        total += casualties.total || 0;
        military += casualties.military || 0;
        civilian += casualties.civilian || 0;
        injured += casualties.injured || 0;
    });

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
            <div style="text-align: center; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid #ff4444;">
                <div style="font-size: 28px; font-weight: 700; color: #ff4444; margin-bottom: 4px;">${total.toLocaleString()}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Total Deaths</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid #ff8800;">
                <div style="font-size: 28px; font-weight: 700; color: #ff8800; margin-bottom: 4px;">${military.toLocaleString()}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Military</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid #ffcc00;">
                <div style="font-size: 28px; font-weight: 700; color: #ffcc00; margin-bottom: 4px;">${civilian.toLocaleString()}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Civilian</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid #44ff88;">
                <div style="font-size: 28px; font-weight: 700; color: #44ff88; margin-bottom: 4px;">${injured.toLocaleString()}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Injured</div>
            </div>
        </div>
    `;
}

function renderReliabilityChart() {
    const container = document.getElementById('reliability-chart');
    if (!container) return;

    // Group sources by type and calculate actual reliability
    const sourceGroups = {
        'Government': { sources: [], count: 0, verified: 0 },
        'Major News': { sources: [], count: 0, verified: 0 },
        'Regional News': { sources: [], count: 0, verified: 0 },
        'Other': { sources: [], count: 0, verified: 0 }
    };

    state.incidents.forEach(incident => {
        const source = incident.source || 'Unknown';
        const status = incident.verification?.status || 'UNCONFIRMED';

        let group = 'Other';
        const sourceLower = source.toLowerCase();

        if (sourceLower.includes('ministry') || sourceLower.includes('defense') ||
            sourceLower.includes('moi') || sourceLower.includes('idf') ||
            sourceLower.includes('government') || sourceLower.includes('official')) {
            group = 'Government';
        } else if (sourceLower.includes('reuters') || sourceLower.includes('bbc') ||
                   sourceLower.includes('ap') || sourceLower.includes('al jazeera') ||
                   sourceLower.includes('france24') || sourceLower.includes('dw')) {
            group = 'Major News';
        } else if (sourceLower.includes('news') || sourceLower.includes('times') ||
                   sourceLower.includes('post') || sourceLower.includes('agency')) {
            group = 'Regional News';
        }

        if (!sourceGroups[group].sources.includes(source)) {
            sourceGroups[group].sources.push(source);
        }
        sourceGroups[group].count++;
        if (status === 'VERIFIED') {
            sourceGroups[group].verified++;
        }
    });

    let html = '<div style="space-y: 12px;">';

    Object.entries(sourceGroups).forEach(([group, data]) => {
        if (data.count > 0) {
            const reliability = data.count > 0 ? Math.round((data.verified / data.count) * 100) : 0;
            const uniqueSources = data.sources.length;

            let color = '#ff4444';
            let label = 'Low';
            if (reliability >= 80) { color = '#44ff88'; label = 'High'; }
            else if (reliability >= 50) { color = '#ffcc00'; label = 'Medium'; }

            html += `
                <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid ${color};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; color: var(--text-primary);">${group}</span>
                        <span style="font-size: 12px; color: ${color}; font-weight: 600;">${reliability}% ${label}</span>
                    </div>
                    <div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-muted);">
                        <span>${data.count} reports</span>
                        <span>${uniqueSources} sources</span>
                        <span>${data.verified} verified</span>
                    </div>
                    <div style="margin-top: 8px; height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden;">
                        <div style="width: ${reliability}%; height: 100%; background: ${color}; border-radius: 2px;"></div>
                    </div>
                </div>
            `;
        }
    });

    html += '</div>';
    container.innerHTML = html || '<div class="chart-empty">No source data available</div>';
}

function renderIntensityChart() {
    const container = document.getElementById('intensity-chart');
    if (!container) return;

    // Calculate intensity based on event type AND severity
    // Bombing/strikes count more than alerts
    const eventWeights = {
        'missile': 4,
        'airstrike': 4,
        'attack': 4,
        'explosion': 3,
        'drone': 3,
        'air_defense': 2,
        'security': 1,
        'alert': 1
    };

    const severityMultipliers = {
        'critical': 3,
        'high': 2,
        'medium': 1.5,
        'low': 1
    };

    let totalIntensity = 0;
    let maxPossibleIntensity = 0;

    // Count incidents by weighted severity
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const eventTypeBreakdown = {};

    state.incidents.forEach(incident => {
        const type = (incident.type || 'unknown').toLowerCase();
        const severity = getSeverityLevel(incident);

        severityCounts[severity]++;

        const eventWeight = eventWeights[type] || 1;
        const severityMult = severityMultipliers[severity] || 1;
        const incidentIntensity = eventWeight * severityMult;

        totalIntensity += incidentIntensity;
        maxPossibleIntensity += 12; // max weight (4) * max severity (3)

        // Track event types
        const displayType = type.replace(/_/g, ' ').toUpperCase();
        eventTypeBreakdown[displayType] = (eventTypeBreakdown[displayType] || 0) + 1;
    });

    const total = state.incidents.length;
    if (total === 0) {
        container.innerHTML = '<div class="chart-empty">No intensity data available</div>';
        return;
    }

    // Calculate overall intensity score (0-100)
    const intensityScore = Math.min(100, Math.round((totalIntensity / Math.max(maxPossibleIntensity * 0.3, 1)) * 100));

    // Determine status
    let status = 'LOW';
    let color = '#44ff88';
    if (intensityScore >= 75) { status = 'CRITICAL'; color = '#ff4444'; }
    else if (intensityScore >= 50) { status = 'HIGH'; color = '#ff8800'; }
    else if (intensityScore >= 25) { status = 'ELEVATED'; color = '#ffcc00'; }

    let html = '<div style="text-align: center; padding: 16px;">';

    // Main intensity gauge
    html += `
        <div style="margin-bottom: 20px;">
            <div style="font-size: 48px; font-weight: 700; color: ${color}; margin-bottom: 4px;">${intensityScore}%</div>
            <div style="font-size: 14px; font-weight: 600; color: ${color}; letter-spacing: 1px;">${status}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Conflict Intensity Index</div>
        </div>
    `;

    // Intensity bar
    html += `
        <div style="height: 8px; background: var(--bg-secondary); border-radius: 4px; margin-bottom: 20px; overflow: hidden;">
            <div style="width: ${intensityScore}%; height: 100%; background: linear-gradient(90deg, #44ff88 0%, #ffcc00 50%, #ff4444 100%); border-radius: 4px; transition: width 0.5s ease;"></div>
        </div>
    `;

    // Top event types
    const topEvents = Object.entries(eventTypeBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    if (topEvents.length > 0) {
        html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; text-align: left;">';
        topEvents.forEach(([type, count]) => {
            html += `
                <div style="padding: 8px; background: var(--bg-secondary); border-radius: 6px;">
                    <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">${type}</div>
                    <div style="font-size: 16px; font-weight: 600; color: var(--text-primary);">${count}</div>
                </div>
            `;
        });
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// ============================================================================
// PREDICTION ENGINE
// ============================================================================

let predictor = null;

function initializePrediction() {
    if (!predictionInitialized) {
        // Initialize predictor with current incidents
        predictor = new GulfPredictor(state.incidents);

        // Populate dropdowns
        populatePredictionDropdowns();

        // Set up event listeners
        setupPredictionListeners();

        predictionInitialized = true;
    }
}

function populatePredictionDropdowns() {
    if (!predictor) return;

    // Populate actors
    const actorSelect = document.getElementById('predict-actor');
    if (actorSelect) {
        const actors = predictor.getActors();
        actors.forEach(actor => {
            const option = document.createElement('option');
            option.value = actor.id;
            option.textContent = actor.name;
            actorSelect.appendChild(option);
        });
    }

    // Populate actions
    const actionSelect = document.getElementById('predict-action');
    if (actionSelect) {
        const actions = predictor.getActions();
        actions.forEach(action => {
            const option = document.createElement('option');
            option.value = action.id;
            option.textContent = action.name;
            actionSelect.appendChild(option);
        });
    }

    // Populate targets
    const targetSelect = document.getElementById('predict-target');
    if (targetSelect) {
        const targets = predictor.getTargets();
        targets.forEach(target => {
            const option = document.createElement('option');
            option.value = target.id;
            option.textContent = target.name;
            targetSelect.appendChild(option);
        });
    }

    // Populate countries
    const countrySelect = document.getElementById('predict-country');
    if (countrySelect) {
        const countries = predictor.getCountries();
        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country.id;
            option.textContent = country.name;
            countrySelect.appendChild(option);
        });
    }
}

function setupPredictionListeners() {
    const runBtn = document.getElementById('run-prediction');
    if (runBtn) {
        runBtn.addEventListener('click', runPrediction);
    }
}

function runPrediction() {
    const actor = document.getElementById('predict-actor')?.value;
    const action = document.getElementById('predict-action')?.value;
    const target = document.getElementById('predict-target')?.value;
    const country = document.getElementById('predict-country')?.value;

    if (!actor || !action) {
        showError('Please select at least an actor and action');
        return;
    }

    // Run prediction
    const scenario = { actor, action, target, country };
    const predictions = predictor.predict(scenario);

    // Display results
    displayPredictions(predictions, scenario);
}

function displayPredictions(predictions, scenario) {
    const resultsContainer = document.getElementById('prediction-results');
    const emptyState = document.getElementById('prediction-empty');
    const grid = document.getElementById('predictions-grid');
    const context = document.getElementById('prediction-context');

    if (!resultsContainer || !grid) return;

    // Hide empty state, show results
    if (emptyState) emptyState.style.display = 'none';
    resultsContainer.style.display = 'block';

    // Update context
    if (context) {
        const actorName = predictor.getActors().find(a => a.id === scenario.actor)?.name || scenario.actor;
        const actionName = predictor.getActions().find(a => a.id === scenario.action)?.name || scenario.action;
        context.textContent = `${actorName} → ${actionName}${scenario.target ? ' → ' + predictor.getTargets().find(t => t.id === scenario.target)?.name : ''}`;
    }

    // Build predictions grid
    let html = '';
    predictions.forEach((pred, index) => {
        const probabilityClass = pred.probability >= 70 ? 'high' : pred.probability >= 40 ? 'medium' : 'low';
        const icon = getPredictionIcon(pred.category);

        html += `
            <div class="prediction-card ${probabilityClass}" style="animation-delay: ${index * 0.1}s">
                <div class="prediction-card-header">
                    <span class="prediction-icon">${icon}</span>
                    <span class="prediction-category">${pred.category}</span>
                </div>
                <div class="prediction-outcome">${pred.outcome}</div>
                <div class="prediction-meta">
                    <div class="prediction-probability">
                        <div class="probability-bar">
                            <div class="probability-fill ${probabilityClass}" style="width: ${pred.probability}%"></div>
                        </div>
                        <span class="probability-value">${pred.probability}%</span>
                    </div>
                    <div class="prediction-timeframe">${pred.timeframe}</div>
                </div>
                <div class="prediction-confidence">${pred.confidence}</div>
            </div>
        `;
    });

    grid.innerHTML = html;
}

function getPredictionIcon(category) {
    const icons = {
        'Military Response': '⚔️',
        'Regional Response': '🌍',
        'Market Impact': '📈',
        'Diplomatic Response': '🤝',
        'Follow-up Event': '➡️',
        'Maritime Security': '⚓',
        'Shipping Impact': '🚢',
        'Escalation Risk': '⚠️',
        'Defense Posture': '🛡️',
        'Monitoring': '👁️'
    };
    return icons[category] || '🔮';
}

// ============================================================================
// REPORTS TAB
// ============================================================================

function initializeReports() {
    console.log('📝 Initializing Reports tab...');
    loadIncomingReports();
    loadVerificationStats();
}

function loadIncomingReports() {
    const container = document.getElementById('incoming-reports');
    if (!container) return;

    const reports = JSON.parse(localStorage.getItem('gulfwatch_reports') || '[]');

    if (reports.length === 0) {
        container.innerHTML = '<p class="text-muted">No pending reports</p>';
        return;
    }

    // Sort by newest first
    reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let html = '<div class="reports-list">';
    reports.slice(0, 10).forEach(report => {
        const date = new Date(report.timestamp).toLocaleString();
        const reasonLabels = {
            'false': 'False information',
            'misleading': 'Misleading content',
            'outdated': 'Outdated/incorrect date',
            'duplicate': 'Duplicate incident',
            'location': 'Wrong location',
            'other': 'Other'
        };
        html += `
            <div class="report-item">
                <div class="report-header">
                    <span class="report-reason">${reasonLabels[report.reason] || report.reason}</span>
                    <span class="report-date">${date}</span>
                </div>
                <div class="report-details">${report.details || 'No details provided'}</div>
                <div class="report-incident">Incident #${report.incidentId}</div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

function loadVerificationStats() {
    // Calculate stats from incidents
    const stats = {
        validated: 0,
        pending: 0,
        disputed: 0
    };

    state.incidents.forEach(incident => {
        const verification = incident.verification || {};
        const badge = verification.badge || 'UNCONFIRMED';

        if (badge === 'VERIFIED') stats.validated++;
        else if (badge === 'DISPUTED') stats.disputed++;
        else stats.pending++;
    });

    const updateEl = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    updateEl('validated-count', stats.validated);
    updateEl('pending-count', stats.pending);
    updateEl('disputed-count', stats.disputed);
}

// ============================================================================
// DATA TAB - Exports and API
// ============================================================================

function initializeData() {
    console.log('💾 Initializing Data tab...');
    // Set up data tab switching
    document.querySelectorAll('.data-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = tab.dataset.tab;

            // Update active tab
            document.querySelectorAll('.data-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show selected panel
            document.querySelectorAll('.data-panel').forEach(p => {
                p.classList.toggle('active', p.dataset.panel === panelId);
            });
        });
    });
}

function downloadJSON() {
    const data = {
        generated_at: new Date().toISOString(),
        total_incidents: state.incidents.length,
        incidents: state.incidents
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gulfwatch-incidents-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadCSV() {
    const headers = ['ID', 'Title', 'Country', 'Type', 'Severity', 'Published', 'Source', 'Lat', 'Lng', 'Casualties'];
    const rows = state.incidents.map(inc => [
        inc.id,
        `"${(inc.title || '').replace(/"/g, '""')}"`,
        inc.location?.country || 'Unknown',
        inc.type || 'unknown',
        getSeverityLevel(inc),
        inc.published || '',
        inc.source || 'Unknown',
        inc.location?.lat || '',
        inc.location?.lng || '',
        inc.casualties?.total || 0
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gulfwatch-incidents-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadGeoJSON() {
    const geojson = {
        type: 'FeatureCollection',
        generated_at: new Date().toISOString(),
        total_incidents: state.incidents.length,
        features: state.incidents.filter(inc => inc.location?.lat && inc.location?.lng).map(inc => ({
            type: 'Feature',
            properties: {
                id: inc.id,
                title: inc.title,
                country: inc.location?.country,
                type: inc.type,
                severity: getSeverityLevel(inc),
                published: inc.published,
                source: inc.source
            },
            geometry: {
                type: 'Point',
                coordinates: [inc.location.lng, inc.location.lat]
            }
        }))
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gulfwatch-incidents-${new Date().toISOString().split('T')[0]}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
// ============================================================================
// REPORT MODAL FUNCTIONS
// ============================================================================

function openReportModal(incidentId) {
    const modal = document.getElementById('report-modal');
    const incidentIdInput = document.getElementById('report-incident-id');
    if (modal && incidentIdInput) {
        incidentIdInput.value = incidentId;
        modal.classList.add('active');
    }
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function openTranslateModal(incidentId) {
    const modal = document.getElementById('translate-modal');
    const incidentIdInput = document.getElementById('translate-incident-id');
    if (modal && incidentIdInput) {
        incidentIdInput.value = incidentId;
        modal.classList.add('active');
    }
}

function closeTranslateModal() {
    const modal = document.getElementById('translate-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ============================================================================
// RAGNAROK - OODA LOOP ESCALATION TIMELINE
// ============================================================================

let ragnarokInitialized = false;
let ragnarokMode = 'single';

function initializeRagnarok() {
    if (ragnarokInitialized) return;
    
    // Populate all selectors
    populateRagnarokSelectors();
    
    // Listen for single selector
    const select = document.getElementById('ragnarok-incident-select');
    if (select) {
        select.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value);
            console.log('Selector changed, idx:', idx, 'incidents:', state.incidents?.length);
            if (!isNaN(idx) && state.incidents && state.incidents[idx]) {
                console.log('Rendering incident:', state.incidents[idx].title);
                const output = document.getElementById('ragnarok-output');
                if (output) output.innerHTML = renderRagnarok(state.incidents[idx]);
            } else {
                console.log('No valid incident found for idx:', idx);
            }
        });
    }
    
    // Listen for comparative selectors
    const selectA = document.getElementById('ragnarok-compare-a');
    const selectB = document.getElementById('ragnarok-compare-b');
    if (selectA) {
        selectA.addEventListener('change', updateRagnarokCompare);
    }
    if (selectB) {
        selectB.addEventListener('change', updateRagnarokCompare);
    }
    
    ragnarokInitialized = true;
    console.log('⚡ Ragnarok initialized');
}

function populateRagnarokSelectors() {
    const incidents = state.incidents || [];
    const recentIncidents = incidents.slice(0, 25);
    
    console.log('⚡ Populating Ragnarok selectors, incidents count:', incidents.length, 'recent:', recentIncidents.length);
    
    const makeOptions = () => {
        let opts = '<option value="">-- Select incident --</option>';
        recentIncidents.forEach((inc, i) => {
            const date = new Date(inc.published || inc.timestamp).toLocaleDateString();
            const sev = inc.severity?.toUpperCase() || 'MED';
            const label = `${date} | ${(inc.title || inc.type || '').substring(0, 45)} | ${sev}`;
            const globalIdx = incidents.indexOf(inc);
            opts += `<option value="${globalIdx}">${label}</option>`;
        });
        return opts;
    };
    
    const singleSelect = document.getElementById('ragnarok-incident-select');
    const compareA = document.getElementById('ragnarok-compare-a');
    const compareB = document.getElementById('ragnarok-compare-b');
    
    console.log('⚡ Ragnarok selectors found:', { singleSelect: !!singleSelect, compareA: !!compareA, compareB: !!compareB });
    
    if (singleSelect) singleSelect.innerHTML = makeOptions();
    if (compareA) compareA.innerHTML = makeOptions();
    if (compareB) compareB.innerHTML = makeOptions();
}

function setRagnarokMode(mode) {
    ragnarokMode = mode;
    
    // Update button states
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Show/hide selectors
    const singleGroup = document.getElementById('selector-single');
    const compareA = document.getElementById('selector-compare-a');
    const compareB = document.getElementById('selector-compare-b');
    
    if (mode === 'single') {
        if (singleGroup) singleGroup.style.display = '';
        if (compareA) compareA.style.display = 'none';
        if (compareB) compareB.style.display = 'none';
    } else {
        if (singleGroup) singleGroup.style.display = 'none';
        if (compareA) compareA.style.display = '';
        if (compareB) compareB.style.display = '';
    }
    
    // Clear output
    const output = document.getElementById('ragnarok-output');
    if (output) output.innerHTML = '';
}

function updateRagnarokCompare() {
    const idxA = parseInt(document.getElementById('ragnarok-compare-a')?.value);
    const idxB = parseInt(document.getElementById('ragnarok-compare-b')?.value);
    
    const output = document.getElementById('ragnarok-output');
    if (!output) return;
    
    if (isNaN(idxA) || isNaN(idxB) || !state.incidents) {
        output.innerHTML = '<div class="ragnarok-empty">Select two incidents to compare</div>';
        return;
    }
    
    const incidentA = state.incidents[idxA];
    const incidentB = state.incidents[idxB];
    
    if (!incidentA || !incidentB) return;
    
    output.innerHTML = renderRagnarok(incidentA, incidentB, 'compare');
}

function containsArabic(text) {
    if (!text) return false;
    return /[\u0600-\u06FF]/.test(text);
}

// Make modal functions globally available
window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;
window.openTranslateModal = openTranslateModal;
window.closeTranslateModal = closeTranslateModal;
window.containsArabic = containsArabic;
window.setRagnarokMode = setRagnarokMode;
window.showRagnarokModal = showRagnarokModal;
window.renderRagnarok = renderRagnarok;

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});

// Cache bust: Sun Mar 15 22:01:28 +04 2026
