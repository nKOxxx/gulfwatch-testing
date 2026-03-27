/**
 * NEXUS — Entity Resolution & Link Analysis Engine
 * Relationship graph connecting people, orgs, vessels, events from incident intelligence
 */

class NexusEngine {
    constructor(incidents) {
        this.incidents = incidents || [];
        this.entities = new Map();   // id -> { id, name, type, mentions, incidents }
        this.edges = [];             // { source, target, relationship, weight, incidents }
        this.extractEntities();
        this.buildRelationships();
        this.computeMetrics();
    }

    // =====================================================================
    // ENTITY EXTRACTION
    // =====================================================================

    extractEntities() {
        // Pre-defined entity knowledge base
        const knownEntities = {
            actors: [
                { pattern: /houthi/i, name: 'Houthi Forces', subtype: 'militia' },
                { pattern: /irgc|islamic\s*revolutionary\s*guard/i, name: 'IRGC', subtype: 'state-military' },
                { pattern: /hamas/i, name: 'Hamas', subtype: 'militia' },
                { pattern: /hezbollah|hizbullah/i, name: 'Hezbollah', subtype: 'militia' },
                { pattern: /idf|israel\s*defense/i, name: 'IDF', subtype: 'state-military' },
                { pattern: /us\s*(?:navy|military|forces|central\s*command|centcom)|uscentcom|american\s*(?:forces|military)/i, name: 'US CENTCOM', subtype: 'state-military' },
                { pattern: /isis|isil|islamic\s*state|daesh/i, name: 'ISIS/Daesh', subtype: 'terrorist' },
                { pattern: /pmu|popular\s*mobilization/i, name: 'PMU/Hashd', subtype: 'militia' },
                { pattern: /iranian\s*(?:navy|forces|military)/i, name: 'Iranian Military', subtype: 'state-military' },
                { pattern: /saudi\s*(?:forces|military|coalition)/i, name: 'Saudi Coalition', subtype: 'state-military' },
                { pattern: /ansarallah/i, name: 'Ansarallah', subtype: 'militia' },
                { pattern: /al[- ]?qaeda|aqap/i, name: 'AQAP', subtype: 'terrorist' },
                { pattern: /pij|islamic\s*jihad/i, name: 'Palestinian Islamic Jihad', subtype: 'militia' },
                { pattern: /russia|russian/i, name: 'Russia', subtype: 'state-actor' },
                { pattern: /china|chinese|pla/i, name: 'China/PLA', subtype: 'state-actor' },
                { pattern: /turkey|turkish|taf/i, name: 'Turkey/TAF', subtype: 'state-actor' },
            ],
            weapons: [
                { pattern: /ballistic\s*missile/i, name: 'Ballistic Missile', subtype: 'missile' },
                { pattern: /cruise\s*missile/i, name: 'Cruise Missile', subtype: 'missile' },
                { pattern: /anti[- ]?ship\s*missile/i, name: 'Anti-Ship Missile', subtype: 'missile' },
                { pattern: /drone|uav|unmanned/i, name: 'Drone/UAV', subtype: 'drone' },
                { pattern: /rocket/i, name: 'Rocket Artillery', subtype: 'artillery' },
                { pattern: /mine|limpet|ied/i, name: 'Sea Mine/IED', subtype: 'explosive' },
                { pattern: /torpedo/i, name: 'Torpedo', subtype: 'naval-weapon' },
                { pattern: /iron\s*dome/i, name: 'Iron Dome', subtype: 'defense-system' },
                { pattern: /patriot/i, name: 'Patriot System', subtype: 'defense-system' },
                { pattern: /thaad/i, name: 'THAAD', subtype: 'defense-system' },
                { pattern: /sam|surface[- ]to[- ]air/i, name: 'SAM System', subtype: 'defense-system' },
                { pattern: /interceptor/i, name: 'Interceptor', subtype: 'defense-system' },
                { pattern: /loitering\s*munition|kamikaze\s*drone/i, name: 'Loitering Munition', subtype: 'drone' },
            ],
            locations: [
                { pattern: /strait\s*of\s*hormuz|hormuz/i, name: 'Strait of Hormuz', subtype: 'chokepoint' },
                { pattern: /bab\s*(?:el|al)[- ]mandeb/i, name: 'Bab el-Mandeb', subtype: 'chokepoint' },
                { pattern: /suez\s*canal/i, name: 'Suez Canal', subtype: 'chokepoint' },
                { pattern: /red\s*sea/i, name: 'Red Sea', subtype: 'waterway' },
                { pattern: /persian\s*gulf/i, name: 'Persian Gulf', subtype: 'waterway' },
                { pattern: /gulf\s*of\s*aden/i, name: 'Gulf of Aden', subtype: 'waterway' },
                { pattern: /gulf\s*of\s*oman/i, name: 'Gulf of Oman', subtype: 'waterway' },
                { pattern: /west\s*bank/i, name: 'West Bank', subtype: 'territory' },
                { pattern: /gaza/i, name: 'Gaza', subtype: 'territory' },
                { pattern: /golan\s*heights/i, name: 'Golan Heights', subtype: 'territory' },
                { pattern: /sinai/i, name: 'Sinai Peninsula', subtype: 'territory' },
                { pattern: /yemen/i, name: 'Yemen', subtype: 'country' },
                { pattern: /syria/i, name: 'Syria', subtype: 'country' },
                { pattern: /iraq/i, name: 'Iraq', subtype: 'country' },
                { pattern: /lebanon/i, name: 'Lebanon', subtype: 'country' },
                { pattern: /iran/i, name: 'Iran', subtype: 'country' },
                { pattern: /tel\s*aviv/i, name: 'Tel Aviv', subtype: 'city' },
                { pattern: /tehran/i, name: 'Tehran', subtype: 'city' },
                { pattern: /riyadh/i, name: 'Riyadh', subtype: 'city' },
                { pattern: /sanaa|sana\'a/i, name: "Sana'a", subtype: 'city' },
                { pattern: /beirut/i, name: 'Beirut', subtype: 'city' },
                { pattern: /damascus/i, name: 'Damascus', subtype: 'city' },
                { pattern: /baghdad/i, name: 'Baghdad', subtype: 'city' },
            ],
            vessels: [
                { pattern: /uss\s+\w+/i, name: null, subtype: 'warship', extract: true },
                { pattern: /hms\s+\w+/i, name: null, subtype: 'warship', extract: true },
                { pattern: /mv\s+\w+/i, name: null, subtype: 'merchant', extract: true },
                { pattern: /tanker/i, name: 'Oil Tanker (generic)', subtype: 'tanker' },
                { pattern: /cargo\s*(?:ship|vessel)/i, name: 'Cargo Vessel (generic)', subtype: 'cargo' },
                { pattern: /container\s*ship/i, name: 'Container Ship (generic)', subtype: 'container' },
                { pattern: /aircraft\s*carrier/i, name: 'Aircraft Carrier', subtype: 'warship' },
                { pattern: /destroyer/i, name: 'Destroyer', subtype: 'warship' },
                { pattern: /frigate/i, name: 'Frigate', subtype: 'warship' },
                { pattern: /submarine/i, name: 'Submarine', subtype: 'warship' },
            ],
            orgs: [
                { pattern: /pentagon|dept?\.*\s*of\s*defense/i, name: 'US DoD/Pentagon', subtype: 'gov' },
                { pattern: /nato/i, name: 'NATO', subtype: 'alliance' },
                { pattern: /united\s*nations|un\s*security/i, name: 'United Nations', subtype: 'international' },
                { pattern: /gcc/i, name: 'GCC', subtype: 'alliance' },
                { pattern: /mossad/i, name: 'Mossad', subtype: 'intelligence' },
                { pattern: /cia/i, name: 'CIA', subtype: 'intelligence' },
                { pattern: /mi6|sis/i, name: 'MI6/SIS', subtype: 'intelligence' },
                { pattern: /opec/i, name: 'OPEC', subtype: 'economic' },
                { pattern: /red\s*cross|icrc/i, name: 'ICRC', subtype: 'humanitarian' },
                { pattern: /iaea/i, name: 'IAEA', subtype: 'international' },
            ]
        };

        const typeMap = { actors: 'actor', weapons: 'weapon', locations: 'location', vessels: 'vessel', orgs: 'org' };

        this.incidents.forEach(inc => {
            const text = `${inc.title || ''} ${inc.type || ''} ${inc.location?.name || ''} ${inc.location?.country || ''}`;

            Object.entries(knownEntities).forEach(([category, patterns]) => {
                const entityType = typeMap[category];
                patterns.forEach(def => {
                    const match = text.match(def.pattern);
                    if (match) {
                        let name = def.name;
                        if (def.extract && !name) {
                            name = match[0].trim();
                        }
                        if (!name) return;

                        const id = `${entityType}:${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

                        if (!this.entities.has(id)) {
                            this.entities.set(id, {
                                id,
                                name,
                                type: entityType,
                                subtype: def.subtype,
                                mentions: 0,
                                incidents: [],
                                connections: 0
                            });
                        }

                        const entity = this.entities.get(id);
                        entity.mentions++;
                        if (!entity.incidents.includes(inc.id)) {
                            entity.incidents.push(inc.id);
                        }
                    }
                });
            });

            // Also extract country from location data as entity
            const country = inc.location?.country;
            if (country && country !== 'Unknown') {
                const id = `location:${country.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                if (!this.entities.has(id)) {
                    this.entities.set(id, {
                        id,
                        name: country,
                        type: 'location',
                        subtype: 'country',
                        mentions: 0,
                        incidents: [],
                        connections: 0
                    });
                }
                const entity = this.entities.get(id);
                entity.mentions++;
                if (!entity.incidents.includes(inc.id)) {
                    entity.incidents.push(inc.id);
                }
            }
        });
    }

    // =====================================================================
    // RELATIONSHIP BUILDING
    // =====================================================================

    buildRelationships() {
        const edgeMap = new Map();

        const addEdge = (sourceId, targetId, rel, incidentId) => {
            const key = `${sourceId}||${targetId}||${rel}`;
            if (!edgeMap.has(key)) {
                edgeMap.set(key, { source: sourceId, target: targetId, relationship: rel, weight: 0, incidents: [] });
            }
            const edge = edgeMap.get(key);
            edge.weight++;
            if (incidentId && !edge.incidents.includes(incidentId)) {
                edge.incidents.push(incidentId);
            }
        };

        this.incidents.forEach(inc => {
            const text = `${inc.title || ''} ${inc.type || ''}`.toLowerCase();

            // Find all entities mentioned in this incident
            const mentionedEntities = [];
            this.entities.forEach((entity, id) => {
                if (entity.incidents.includes(inc.id)) {
                    mentionedEntities.push(entity);
                }
            });

            // Build relationships between co-occurring entities
            for (let i = 0; i < mentionedEntities.length; i++) {
                for (let j = i + 1; j < mentionedEntities.length; j++) {
                    const a = mentionedEntities[i];
                    const b = mentionedEntities[j];

                    // Determine relationship type based on entity types
                    let rel = 'linked_to';

                    if (a.type === 'actor' && b.type === 'weapon') {
                        rel = /attack|strike|launch|fire/.test(text) ? 'used' : 'possesses';
                    } else if (a.type === 'weapon' && b.type === 'actor') {
                        rel = /attack|strike|launch|fire/.test(text) ? 'used_by' : 'possessed_by';
                    } else if (a.type === 'actor' && b.type === 'location') {
                        rel = /attack|strike|bomb|target/.test(text) ? 'targeted' : 'operates_in';
                    } else if (a.type === 'location' && b.type === 'actor') {
                        rel = /attack|strike|bomb|target/.test(text) ? 'targeted_by' : 'hosts';
                    } else if (a.type === 'actor' && b.type === 'org') {
                        rel = 'affiliated_with';
                    } else if (a.type === 'actor' && b.type === 'vessel') {
                        rel = /attack|target|seize|hijack/.test(text) ? 'attacked' : 'deployed';
                    } else if (a.type === 'actor' && b.type === 'actor') {
                        rel = /clash|fight|battle|confront|attack/.test(text) ? 'clashed_with' : 'associated_with';
                    } else if (a.type === 'weapon' && b.type === 'location') {
                        rel = 'deployed_at';
                    } else if (a.type === 'location' && b.type === 'weapon') {
                        rel = 'threatened_by';
                    }

                    addEdge(a.id, b.id, rel, inc.id);
                }
            }
        });

        this.edges = Array.from(edgeMap.values());

        // Update connection counts
        this.edges.forEach(edge => {
            const src = this.entities.get(edge.source);
            const tgt = this.entities.get(edge.target);
            if (src) src.connections++;
            if (tgt) tgt.connections++;
        });
    }

    // =====================================================================
    // METRICS
    // =====================================================================

    computeMetrics() {
        this.totalEntities = this.entities.size;
        this.totalConnections = this.edges.length;

        // Find most connected entity
        let maxConn = 0;
        let mostConnected = null;
        this.entities.forEach(entity => {
            if (entity.connections > maxConn) {
                maxConn = entity.connections;
                mostConnected = entity;
            }
        });
        this.mostConnected = mostConnected;

        // Entity type counts
        this.typeCounts = {};
        this.entities.forEach(entity => {
            this.typeCounts[entity.type] = (this.typeCounts[entity.type] || 0) + 1;
        });

        // Top entities by mentions
        this.topEntities = Array.from(this.entities.values())
            .sort((a, b) => b.mentions - a.mentions)
            .slice(0, 20);
    }

    // =====================================================================
    // GRAPH LAYOUT (concentric circles)
    // =====================================================================

    computeLayout(centerEntityId, width, height) {
        const cx = width / 2;
        const cy = height / 2;
        const positions = new Map();

        // If no center entity, pick most connected
        const center = centerEntityId
            ? this.entities.get(centerEntityId)
            : this.mostConnected;

        if (!center) return { positions, visibleEdges: [] };

        positions.set(center.id, { x: cx, y: cy, entity: center, ring: 0 });

        // Find direct connections
        const directIds = new Set();
        const relevantEdges = this.edges.filter(e =>
            e.source === center.id || e.target === center.id
        );
        relevantEdges.forEach(e => {
            const otherId = e.source === center.id ? e.target : e.source;
            directIds.add(otherId);
        });

        // Ring 1: direct connections
        const ring1 = Array.from(directIds).map(id => this.entities.get(id)).filter(Boolean);
        const r1 = Math.min(width, height) * 0.25;
        ring1.forEach((entity, i) => {
            const angle = (2 * Math.PI * i) / ring1.length - Math.PI / 2;
            positions.set(entity.id, {
                x: cx + r1 * Math.cos(angle),
                y: cy + r1 * Math.sin(angle),
                entity,
                ring: 1
            });
        });

        // Ring 2: secondary connections (connected to ring 1 but not center)
        const ring2Ids = new Set();
        ring1.forEach(r1Entity => {
            this.edges.forEach(e => {
                const otherId = e.source === r1Entity.id ? e.target : e.source === r1Entity.id ? e.source : null;
                if (otherId && !positions.has(otherId) && otherId !== center.id) {
                    ring2Ids.add(otherId);
                }
            });
        });

        const ring2 = Array.from(ring2Ids).map(id => this.entities.get(id)).filter(Boolean).slice(0, 24);
        const r2 = Math.min(width, height) * 0.42;
        ring2.forEach((entity, i) => {
            const angle = (2 * Math.PI * i) / ring2.length - Math.PI / 4;
            positions.set(entity.id, {
                x: cx + r2 * Math.cos(angle),
                y: cy + r2 * Math.sin(angle),
                entity,
                ring: 2
            });
        });

        // Visible edges: only those between visible nodes
        const visibleEdges = this.edges.filter(e =>
            positions.has(e.source) && positions.has(e.target)
        );

        return { positions, visibleEdges, center };
    }
}

// =====================================================================
// RENDER FUNCTION
// =====================================================================

function renderNexus(incidents) {
    const engine = new NexusEngine(incidents || (typeof state !== 'undefined' ? state.incidents : []));

    const graphWidth = 700;
    const graphHeight = 700;

    // Default center = most connected entity
    const defaultCenter = engine.mostConnected ? engine.mostConnected.id : null;
    const layout = engine.computeLayout(defaultCenter, graphWidth, graphHeight);

    const typeColors = {
        actor: '#ff2244',
        location: '#00aaff',
        weapon: '#ff8800',
        vessel: '#00ff88',
        org: '#aa44ff'
    };

    const typeLabels = {
        actor: 'Hostile Actor',
        location: 'Location',
        weapon: 'Weapon System',
        vessel: 'Vessel',
        org: 'Organization'
    };

    // ── Stats Bar ───────────────────────────────────────────────────
    const statsHtml = `
    <div class="nexus-stats-bar">
        <div class="nexus-stat">
            <div class="nexus-stat-value">${engine.totalEntities}</div>
            <div class="nexus-stat-label">Entities Resolved</div>
        </div>
        <div class="nexus-stat">
            <div class="nexus-stat-value">${engine.totalConnections}</div>
            <div class="nexus-stat-label">Connections</div>
        </div>
        <div class="nexus-stat nexus-stat-accent">
            <div class="nexus-stat-value">${engine.mostConnected ? engine.mostConnected.name : 'N/A'}</div>
            <div class="nexus-stat-label">Most Connected</div>
        </div>
        <div class="nexus-stat">
            <div class="nexus-stat-value">${engine.typeCounts.actor || 0}</div>
            <div class="nexus-stat-label">Actors</div>
        </div>
        <div class="nexus-stat">
            <div class="nexus-stat-value">${engine.typeCounts.location || 0}</div>
            <div class="nexus-stat-label">Locations</div>
        </div>
        <div class="nexus-stat">
            <div class="nexus-stat-value">${engine.typeCounts.weapon || 0}</div>
            <div class="nexus-stat-label">Weapons</div>
        </div>
    </div>`;

    // ── Filter Bar ──────────────────────────────────────────────────
    const filterHtml = `
    <div class="nexus-filters">
        <span class="nexus-filter-label">Filter by type:</span>
        <button class="nexus-filter-btn nexus-filter-active" data-nexus-filter="all">All</button>
        ${Object.entries(typeColors).map(([type, color]) => `
            <button class="nexus-filter-btn" data-nexus-filter="${type}" style="--filter-color: ${color}">
                <span class="nexus-filter-dot" style="background: ${color}"></span>${typeLabels[type]}
            </button>
        `).join('')}
    </div>`;

    // ── SVG Lines ───────────────────────────────────────────────────
    const svgLines = layout.visibleEdges.map(edge => {
        const src = layout.positions.get(edge.source);
        const tgt = layout.positions.get(edge.target);
        if (!src || !tgt) return '';
        const srcColor = typeColors[src.entity.type] || '#666';
        const opacity = Math.min(0.6, 0.15 + edge.weight * 0.08);
        const strokeWidth = Math.min(3, 0.5 + edge.weight * 0.4);
        return `<line x1="${src.x}" y1="${src.y}" x2="${tgt.x}" y2="${tgt.y}"
            stroke="${srcColor}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}"
            data-rel="${edge.relationship}" data-source="${edge.source}" data-target="${edge.target}"/>`;
    }).join('');

    // ── Nodes ───────────────────────────────────────────────────────
    const nodesHtml = Array.from(layout.positions.values()).map(pos => {
        const { entity, x, y, ring } = pos;
        const color = typeColors[entity.type] || '#666';
        const size = ring === 0 ? 52 : ring === 1 ? 36 : 28;
        const fontSize = ring === 0 ? 11 : ring === 1 ? 9 : 8;
        const truncName = entity.name.length > 14 ? entity.name.slice(0, 12) + '..' : entity.name;

        return `
        <div class="nexus-node nexus-node-${entity.type} nexus-node-ring-${ring}"
             style="left: ${x - size / 2}px; top: ${y - size / 2}px; width: ${size}px; height: ${size}px; --node-color: ${color}; --node-size: ${size}px"
             data-entity-id="${entity.id}" data-entity-type="${entity.type}"
             title="${entity.name} (${entity.type}) — ${entity.mentions} mentions, ${entity.connections} connections">
            <span class="nexus-node-label" style="font-size: ${fontSize}px">${truncName}</span>
        </div>`;
    }).join('');

    // ── Graph Container ─────────────────────────────────────────────
    const graphHtml = `
    <div class="nexus-graph-wrapper">
        <div class="nexus-graph-panel">
            <div class="nexus-graph-container" style="width: ${graphWidth}px; height: ${graphHeight}px">
                <svg class="nexus-graph-svg" width="${graphWidth}" height="${graphHeight}" xmlns="http://www.w3.org/2000/svg">
                    <!-- Concentric ring guides -->
                    <circle cx="${graphWidth / 2}" cy="${graphHeight / 2}" r="${Math.min(graphWidth, graphHeight) * 0.25}"
                        fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="4,4"/>
                    <circle cx="${graphWidth / 2}" cy="${graphHeight / 2}" r="${Math.min(graphWidth, graphHeight) * 0.42}"
                        fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" stroke-dasharray="4,4"/>
                    ${svgLines}
                </svg>
                ${nodesHtml}
            </div>
        </div>
        <div class="nexus-detail-panel" id="nexus-detail-panel">
            <div class="nexus-detail-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>Select an entity node to view details</div>
            </div>
        </div>
    </div>`;

    // ── Legend ───────────────────────────────────────────────────────
    const legendHtml = `
    <div class="nexus-legend">
        ${Object.entries(typeColors).map(([type, color]) => `
            <div class="nexus-legend-item">
                <span class="nexus-legend-dot" style="background: ${color}; box-shadow: 0 0 6px ${color}"></span>
                <span>${typeLabels[type]}</span>
            </div>
        `).join('')}
        <div class="nexus-legend-sep"></div>
        <div class="nexus-legend-item"><span class="nexus-legend-line"></span> Connection strength = line thickness</div>
    </div>`;

    // ── Relationship List ───────────────────────────────────────────
    const topEdges = engine.edges
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 30);

    const relListHtml = `
    <div class="nexus-relationships">
        <div class="nexus-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2">
                <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
            Top Relationships (${engine.totalConnections} total)
        </div>
        <div class="nexus-rel-grid">
            ${topEdges.map(edge => {
                const src = engine.entities.get(edge.source);
                const tgt = engine.entities.get(edge.target);
                if (!src || !tgt) return '';
                const srcColor = typeColors[src.type] || '#666';
                const tgtColor = typeColors[tgt.type] || '#666';
                const relLabel = edge.relationship.replace(/_/g, ' ');
                return `
                <div class="nexus-rel-row">
                    <span class="nexus-rel-entity" style="color: ${srcColor}">${src.name}</span>
                    <span class="nexus-rel-arrow">
                        <span class="nexus-rel-type">${relLabel}</span>
                        <svg width="20" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="rgba(255,255,255,0.3)" stroke-width="1" marker-end="url(#arrowhead)"/></svg>
                    </span>
                    <span class="nexus-rel-entity" style="color: ${tgtColor}">${tgt.name}</span>
                    <span class="nexus-rel-weight">${edge.weight}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    // ── Entity Table ────────────────────────────────────────────────
    const entityTableHtml = `
    <div class="nexus-entity-table">
        <div class="nexus-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
            </svg>
            Entity Registry (Top ${Math.min(20, engine.topEntities.length)})
        </div>
        <div class="nexus-table-header">
            <span class="nexus-table-col-name">Entity</span>
            <span class="nexus-table-col-type">Type</span>
            <span class="nexus-table-col-num">Mentions</span>
            <span class="nexus-table-col-num">Connections</span>
            <span class="nexus-table-col-num">Incidents</span>
        </div>
        ${engine.topEntities.map(entity => {
            const color = typeColors[entity.type] || '#666';
            return `
            <div class="nexus-table-row" data-entity-id="${entity.id}">
                <span class="nexus-table-col-name">
                    <span class="nexus-table-dot" style="background: ${color}"></span>
                    ${entity.name}
                </span>
                <span class="nexus-table-col-type" style="color: ${color}">${entity.type}</span>
                <span class="nexus-table-col-num">${entity.mentions}</span>
                <span class="nexus-table-col-num">${entity.connections}</span>
                <span class="nexus-table-col-num">${entity.incidents.length}</span>
            </div>`;
        }).join('')}
    </div>`;

    // ── Assemble Full HTML ──────────────────────────────────────────
    const fullHtml = `
    <div class="nexus-container" id="nexus-root">
        <div class="nexus-header">
            <div class="nexus-title">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00ff88" stroke-width="2">
                    <circle cx="12" cy="12" r="2"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
                    <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
                    <line x1="12" y1="12" x2="4" y2="6"/><line x1="12" y1="12" x2="20" y2="6"/>
                    <line x1="12" y1="12" x2="4" y2="18"/><line x1="12" y1="12" x2="20" y2="18"/>
                </svg>
                NEXUS — Entity Resolution & Link Analysis
            </div>
            <div class="nexus-subtitle">Intelligence graph: actors, weapons, locations, vessels, organizations extracted from ${engine.incidents.length} incidents</div>
        </div>
        ${statsHtml}
        ${filterHtml}
        ${legendHtml}
        ${graphHtml}
        ${relListHtml}
        ${entityTableHtml}
    </div>
    <script>
    (function() {
        const root = document.getElementById('nexus-root');
        if (!root) return;

        // Node click -> detail panel
        root.querySelectorAll('.nexus-node').forEach(node => {
            node.addEventListener('click', function() {
                const entityId = this.dataset.entityId;
                const panel = document.getElementById('nexus-detail-panel');
                if (!panel) return;

                // Highlight selected
                root.querySelectorAll('.nexus-node').forEach(n => n.classList.remove('nexus-node-selected'));
                this.classList.add('nexus-node-selected');

                // Find entity data embedded via JSON
                const name = this.title.split(' (')[0];
                const typePart = this.title.match(/\\(([^)]+)\\)/);
                const entityType = typePart ? typePart[1] : '';
                const metricsPart = this.title.split(' — ')[1] || '';

                const color = {
                    actor: '#ff2244', location: '#00aaff', weapon: '#ff8800',
                    vessel: '#00ff88', org: '#aa44ff'
                }[this.dataset.entityType] || '#888';

                panel.innerHTML = \`
                    <div class="nexus-detail-header" style="border-left: 3px solid \${color}">
                        <div class="nexus-detail-name" style="color: \${color}">\${name}</div>
                        <div class="nexus-detail-type">\${entityType}</div>
                    </div>
                    <div class="nexus-detail-metrics">\${metricsPart}</div>
                    <div class="nexus-detail-id" title="\${entityId}">ID: \${entityId}</div>
                \`;
            });
        });

        // Filter buttons
        root.querySelectorAll('.nexus-filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                root.querySelectorAll('.nexus-filter-btn').forEach(b => b.classList.remove('nexus-filter-active'));
                this.classList.add('nexus-filter-active');
                const filter = this.dataset.nexusFilter;
                root.querySelectorAll('.nexus-node').forEach(node => {
                    if (filter === 'all' || node.dataset.entityType === filter) {
                        node.style.opacity = '1';
                        node.style.pointerEvents = 'auto';
                    } else {
                        node.style.opacity = '0.12';
                        node.style.pointerEvents = 'none';
                    }
                });
            });
        });
    })();
    <\/script>`;

    return fullHtml;
}

// =====================================================================
// EXPORTS
// =====================================================================

window.NexusEngine = NexusEngine;
window.renderNexus = renderNexus;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NexusEngine, renderNexus };
}
