/**
 * Gulf Watch Scenario Modeling Engine v2
 * Renamed from "Prediction Engine" per R9 review finding.
 *
 * This engine generates scenario trees with probability-weighted branches
 * based on historical incident patterns. It does NOT make predictions --
 * it models possible scenarios (escalation, de-escalation, status quo)
 * with weighted indicators derived from observed patterns.
 *
 * Key terminology changes (R9):
 *   "prediction" -> "scenario indicator"
 *   "predict"    -> "model scenarios"
 *   "probability"-> "weight" (these are pattern-derived weights, not probabilities)
 *   "Prediction Engine" -> "Scenario Modeling"
 */

class ScenarioModeler {
  constructor(incidents) {
    // Filter to last 14 days for focused analysis
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14);

    this.incidents = (incidents || []).filter(inc => {
      const incDate = new Date(inc.published || inc.timestamp);
      return incDate >= cutoffDate;
    });

    console.log(`Scenario Modeler initialized with ${this.incidents.length} incidents from last 14 days`);

    this.patterns = this.extractPatterns();
    this.outcomes = this.calculateOutcomes();
    this.trends = this.analyzeTrends();
  }

  /**
   * Extract patterns from historical incidents
   */
  extractPatterns() {
    const patterns = {
      actorActions: {},
      typeSequences: {},
      countryPatterns: {},
      escalationPatterns: []
    };

    this.incidents.forEach(incident => {
      const { type, country, severity = 'low', title = '' } = incident;
      const timestamp = new Date(incident.published).getTime();

      if (!patterns.typeSequences[country]) {
        patterns.typeSequences[country] = [];
      }
      patterns.typeSequences[country].push({ type, severity, timestamp, title });

      if (!patterns.countryPatterns[country]) {
        patterns.countryPatterns[country] = {
          types: {},
          severities: {},
          total: 0
        };
      }
      patterns.countryPatterns[country].types[type] =
        (patterns.countryPatterns[country].types[type] || 0) + 1;
      patterns.countryPatterns[country].severities[severity] =
        (patterns.countryPatterns[country].severities[severity] || 0) + 1;
      patterns.countryPatterns[country].total++;

      const extracted = this.extractActorAction(title);
      if (extracted) {
        const key = `${extracted.actor}_${extracted.action}`;
        if (!patterns.actorActions[key]) {
          patterns.actorActions[key] = { count: 0, targets: {}, countries: {} };
        }
        patterns.actorActions[key].count++;
        patterns.actorActions[key].countries[country] =
          (patterns.actorActions[key].countries[country] || 0) + 1;
      }
    });

    return patterns;
  }

  /**
   * Extract actor and action from incident title
   */
  extractActorAction(title) {
    if (!title) return null;
    const lower = title.toLowerCase();

    const actors = {
      'houthi': ['houthi', 'houthis'],
      'israel': ['israel', 'israeli', 'idf'],
      'iran': ['iran', 'iranian', 'irgc'],
      'saudi': ['saudi', 'arabia', 'ksa'],
      'uae': ['uae', 'emirates', 'emirati'],
      'us': ['us', 'usa', 'american', 'pentagon'],
      'uk': ['uk', 'british', 'britain'],
      'yemen': ['yemen', 'yemeni'],
      'hezbollah': ['hezbollah', 'hizbullah'],
      'hamas': ['hamas'],
      'isis': ['isis', 'islamic state', 'daesh']
    };

    const actions = {
      'strike': ['strike', 'strikes', 'struck', 'attack', 'attacks', 'attacked'],
      'drone': ['drone', 'drones', 'uav'],
      'missile': ['missile', 'missiles', 'rocket', 'rockets', 'ballistic'],
      'intercept': ['intercept', 'intercepted', 'shot down', 'destroyed'],
      'bomb': ['bomb', 'bombing', 'explosion', 'explosive'],
      'naval': ['naval', 'ship', 'ships', 'vessel', 'houthi ship'],
      'sanction': ['sanction', 'sanctions', 'embargo'],
      'deploy': ['deploy', 'deployment', 'deployed', 'troops', 'forces']
    };

    let detectedActor = null;
    let detectedAction = null;

    for (const [actor, keywords] of Object.entries(actors)) {
      if (keywords.some(k => lower.includes(k))) {
        detectedActor = actor;
        break;
      }
    }

    for (const [action, keywords] of Object.entries(actions)) {
      if (keywords.some(k => lower.includes(k))) {
        detectedAction = action;
        break;
      }
    }

    if (detectedActor && detectedAction) {
      return { actor: detectedActor, action: detectedAction, raw: title };
    }

    return null;
  }

  /**
   * Calculate what typically follows certain events (historical pattern analysis)
   */
  calculateOutcomes() {
    const outcomes = {
      timeframes: {
        '24h': 24 * 60 * 60 * 1000,
        '72h': 72 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
      },
      patterns: {}
    };

    const sequences = this.patterns.typeSequences;

    for (const [country, events] of Object.entries(sequences)) {
      events.sort((a, b) => a.timestamp - b.timestamp);

      for (let i = 0; i < events.length; i++) {
        const current = events[i];
        const key = `${current.type}_${country}`;

        if (!outcomes.patterns[key]) {
          outcomes.patterns[key] = {
            '24h': {},
            '72h': {},
            '7d': {},
            total: 0
          };
        }

        outcomes.patterns[key].total++;

        for (let j = i + 1; j < events.length; j++) {
          const next = events[j];
          const timeDiff = next.timestamp - current.timestamp;

          for (const [frame, ms] of Object.entries(outcomes.timeframes)) {
            if (timeDiff <= ms) {
              outcomes.patterns[key][frame][next.type] =
                (outcomes.patterns[key][frame][next.type] || 0) + 1;
            }
          }
        }
      }
    }

    return outcomes;
  }

  /**
   * Analyze recent trends from last 14 days
   */
  analyzeTrends() {
    const trends = {
      escalationRate: 0,
      mostActiveActor: null,
      mostTargetedCountry: null,
      dominantEventType: null,
      dailyFrequency: [],
      hotspots: []
    };

    if (this.incidents.length === 0) return trends;

    const byDay = {};
    const byActor = {};
    const byCountry = {};
    const byType = {};

    this.incidents.forEach(inc => {
      const day = new Date(inc.published).toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;

      const extracted = this.extractActorAction(inc.title);
      if (extracted) {
        byActor[extracted.actor] = (byActor[extracted.actor] || 0) + 1;
      }

      const country = inc.location?.country || inc.country || 'Unknown';
      byCountry[country] = (byCountry[country] || 0) + 1;
      byType[inc.type] = (byType[inc.type] || 0) + 1;
    });

    const days = Object.keys(byDay).length || 1;
    trends.dailyFrequency = Object.entries(byDay).map(([date, count]) => ({ date, count }));

    trends.mostActiveActor = Object.entries(byActor)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    trends.mostTargetedCountry = Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    trends.dominantEventType = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    const sortedDays = trends.dailyFrequency.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sortedDays.length >= 6) {
      const earlyCount = sortedDays.slice(0, 3).reduce((sum, d) => sum + d.count, 0);
      const lateCount = sortedDays.slice(-3).reduce((sum, d) => sum + d.count, 0);
      trends.escalationRate = earlyCount > 0 ? ((lateCount - earlyCount) / earlyCount * 100).toFixed(1) : 0;
    }

    return trends;
  }

  /**
   * Get trend summary for display
   */
  getTrendSummary() {
    const { mostActiveActor, mostTargetedCountry, dominantEventType, escalationRate } = this.trends;
    const total = this.incidents.length;

    return {
      summary: `Last 14 days: ${total} incidents. ${mostActiveActor ? mostActiveActor.toUpperCase() + ' most active' : 'No clear actor pattern'}. ${escalationRate > 0 ? escalationRate + '% activity increase trend' : 'Stable activity'}.`,
      hotspots: this.trends.hotspots,
      dailyAvg: (total / 14).toFixed(1)
    };
  }

  /**
   * Main scenario modeling method (renamed from predict() per R9)
   * Generates scenario trees with weighted branches, not predictions.
   */
  modelScenarios(scenario) {
    const { actor, action, target, country } = scenario;
    const indicators = [];

    // 0. Trend-based scenario indicator
    if (this.trends.escalationRate > 10) {
      indicators.push({
        category: 'Escalation Indicator',
        scenario: `Activity up ${this.trends.escalationRate}% in last 3 days`,
        weight: Math.min(50 + parseFloat(this.trends.escalationRate), 90),
        timeframe: 'Next 48-72 hours',
        basis: `Based on ${this.incidents.length} recent incidents`,
        type: 'trend_analysis'
      });
    }

    // 1. Pattern-based scenario indicator
    const patternKey = `${actor}_${action}`;
    const actorPattern = this.patterns.actorActions[patternKey];

    if (actorPattern) {
      const countries = Object.entries(actorPattern.countries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (countries.length > 0) {
        indicators.push({
          category: 'Regional Response Scenario',
          scenario: `Escalation indicators in ${countries.map(c => c[0].toUpperCase()).join(', ')}`,
          weight: Math.min(60 + (countries[0][1] * 5), 95),
          timeframe: '24-72 hours',
          basis: 'Historical pattern analysis',
          type: 'pattern_derived'
        });
      }
    }

    // 2. Type-based scenario indicator
    if (country) {
      const typeKey = `${action}_${country}`;
      const typeOutcomes = this.outcomes.patterns[typeKey];

      if (typeOutcomes) {
        for (const [timeframe, types] of Object.entries(typeOutcomes)) {
          if (timeframe === 'total') continue;

          const sorted = Object.entries(types)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2);

          sorted.forEach(([type, count]) => {
            const weight = Math.round((count / typeOutcomes.total) * 100);
            indicators.push({
              category: 'Follow-up Scenario',
              scenario: `${this.formatType(type)} activity`,
              weight: weight,
              timeframe: this.formatTimeframe(timeframe),
              basis: `${count} of ${typeOutcomes.total} similar historical events`,
              type: 'sequence_analysis'
            });
          });
        }
      }
    }

    // 3. Default scenario indicators based on action type
    const defaultIndicators = this.getDefaultIndicators(actor, action, target);
    indicators.push(...defaultIndicators);

    // Sort by weight
    indicators.sort((a, b) => b.weight - a.weight);

    // Remove duplicates and limit
    const seen = new Set();
    return indicators.filter(p => {
      const key = `${p.category}_${p.scenario}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }

  /**
   * Default scenario indicators when no historical data available
   */
  getDefaultIndicators(actor, action, target) {
    const defaults = [];

    if (['missile', 'drone', 'strike'].includes(action)) {
      defaults.push(
        {
          category: 'Military Response Scenario',
          scenario: 'Retaliatory strikes or defense activation',
          weight: 75,
          timeframe: 'Within 48 hours',
          basis: 'Standard military doctrine patterns',
          type: 'doctrine_based'
        },
        {
          category: 'Market Impact Scenario',
          scenario: 'Oil price volatility (+2-5%)',
          weight: 60,
          timeframe: '24 hours',
          basis: 'Historical commodity response patterns',
          type: 'market_analysis'
        },
        {
          category: 'Diplomatic Response Scenario',
          scenario: 'Emergency consultations or condemnations',
          weight: 45,
          timeframe: '24-72 hours',
          basis: 'Standard diplomatic protocol patterns',
          type: 'diplomatic_analysis'
        }
      );
    }

    if (['naval', 'ship'].includes(action)) {
      defaults.push(
        {
          category: 'Maritime Security Scenario',
          scenario: 'Increased naval patrols in region',
          weight: 70,
          timeframe: '48-96 hours',
          basis: 'Standard naval response patterns',
          type: 'doctrine_based'
        },
        {
          category: 'Shipping Impact Scenario',
          scenario: 'Insurance premiums rise, route changes',
          weight: 55,
          timeframe: '1-2 weeks',
          basis: 'Market response patterns',
          type: 'market_analysis'
        }
      );
    }

    if (['intercept'].includes(action)) {
      defaults.push(
        {
          category: 'Escalation Risk Scenario',
          scenario: 'Attacker may attempt follow-up strikes',
          weight: 65,
          timeframe: '24-48 hours',
          basis: 'Post-interception historical patterns',
          type: 'pattern_derived'
        },
        {
          category: 'Defense Posture Scenario',
          scenario: 'Heightened alert status maintained',
          weight: 80,
          timeframe: '7+ days',
          basis: 'Standard defense protocol patterns',
          type: 'doctrine_based'
        }
      );
    }

    if (defaults.length === 0) {
      defaults.push(
        {
          category: 'Monitoring Scenario',
          scenario: 'Continued surveillance and analysis',
          weight: 90,
          timeframe: 'Ongoing',
          basis: 'Standard procedure',
          type: 'baseline'
        },
        {
          category: 'Diplomatic Scenario',
          scenario: 'Official statements from involved parties',
          weight: 70,
          timeframe: '24 hours',
          basis: 'Standard protocol patterns',
          type: 'diplomatic_analysis'
        }
      );
    }

    return defaults;
  }

  /**
   * Generate a full scenario tree (new in v2)
   * Produces 3-5 branches: escalation, de-escalation, status_quo
   */
  generateScenarioTree(scenario) {
    const indicators = this.modelScenarios(scenario);

    const tree = {
      input: scenario,
      timestamp: new Date().toISOString(),
      incidentCount: this.incidents.length,
      branches: [
        {
          id: 'escalation',
          label: 'Escalation',
          weight: 0,
          indicators: []
        },
        {
          id: 'status_quo',
          label: 'Status Quo',
          weight: 0,
          indicators: []
        },
        {
          id: 'de_escalation',
          label: 'De-escalation',
          weight: 0,
          indicators: []
        }
      ]
    };

    // Distribute indicators into branches
    indicators.forEach(ind => {
      if (ind.category.includes('Escalation') || ind.category.includes('Military') || ind.category.includes('Strike')) {
        tree.branches[0].indicators.push(ind);
        tree.branches[0].weight += ind.weight;
      } else if (ind.category.includes('Diplomatic') || ind.category.includes('Monitoring')) {
        tree.branches[2].indicators.push(ind);
        tree.branches[2].weight += ind.weight;
      } else {
        tree.branches[1].indicators.push(ind);
        tree.branches[1].weight += ind.weight;
      }
    });

    // Normalize weights
    const totalWeight = tree.branches.reduce((sum, b) => sum + b.weight, 0) || 1;
    tree.branches.forEach(b => {
      b.weight = Math.round((b.weight / totalWeight) * 100);
    });

    return tree;
  }

  /**
   * Get available actors for dropdown
   */
  getActors() {
    return [
      { id: 'houthi', name: 'Houthis (Yemen)', region: 'Yemen' },
      { id: 'israel', name: 'Israel / IDF', region: 'Israel' },
      { id: 'iran', name: 'Iran / IRGC', region: 'Iran' },
      { id: 'saudi', name: 'Saudi Arabia', region: 'Saudi Arabia' },
      { id: 'uae', name: 'UAE', region: 'UAE' },
      { id: 'us', name: 'United States', region: 'US' },
      { id: 'uk', name: 'United Kingdom', region: 'UK' },
      { id: 'hezbollah', name: 'Hezbollah', region: 'Lebanon' },
      { id: 'hamas', name: 'Hamas', region: 'Palestine' },
      { id: 'isis', name: 'ISIS/ISIL', region: 'Regional' }
    ];
  }

  /**
   * Get available actions for dropdown
   */
  getActions() {
    return [
      { id: 'strike', name: 'Airstrike / Attack' },
      { id: 'missile', name: 'Missile Launch' },
      { id: 'drone', name: 'Drone Attack' },
      { id: 'naval', name: 'Naval Action' },
      { id: 'intercept', name: 'Intercept / Defense' },
      { id: 'bomb', name: 'Bombing / Explosion' },
      { id: 'deploy', name: 'Troop Deployment' },
      { id: 'sanction', name: 'Sanctions' }
    ];
  }

  /**
   * Get available targets for dropdown
   */
  getTargets() {
    return [
      { id: 'oil_facility', name: 'Oil Facility' },
      { id: 'military_base', name: 'Military Base' },
      { id: 'civilian_area', name: 'Civilian Area' },
      { id: 'shipping', name: 'Commercial Shipping' },
      { id: 'naval_vessel', name: 'Naval Vessel' },
      { id: 'infrastructure', name: 'Infrastructure' },
      { id: 'airport', name: 'Airport' },
      { id: 'port', name: 'Port' }
    ];
  }

  /**
   * Get available countries
   */
  getCountries() {
    return [
      { id: 'uae', name: 'UAE' },
      { id: 'saudi', name: 'Saudi Arabia' },
      { id: 'qatar', name: 'Qatar' },
      { id: 'bahrain', name: 'Bahrain' },
      { id: 'kuwait', name: 'Kuwait' },
      { id: 'oman', name: 'Oman' },
      { id: 'israel', name: 'Israel' },
      { id: 'iran', name: 'Iran' },
      { id: 'yemen', name: 'Yemen' },
      { id: 'iraq', name: 'Iraq' },
      { id: 'lebanon', name: 'Lebanon' }
    ];
  }

  formatType(type) {
    const formats = {
      'air_defense': 'Air Defense',
      'attack': 'Attack',
      'alert': 'Alert',
      'security': 'Security',
      'missile': 'Missile',
      'drone': 'Drone'
    };
    return formats[type] || type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  formatTimeframe(frame) {
    const formats = {
      '24h': 'Within 24 hours',
      '72h': 'Within 72 hours',
      '7d': 'Within 7 days'
    };
    return formats[frame] || frame;
  }
}

// Export for use in app.js
// NOTE: This replaces the old GulfPredictor class (predictor.js)
// API change: predict() -> modelScenarios(), new generateScenarioTree()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScenarioModeler;
}
