# ============================================================================
# ARGUS v2 - Entity Resolution & Threat Scoring Engine
# ML-upgraded intelligence layer for Gulf Watch
#
# v2 upgrades (Marcus Lindgren):
#   - Embedding-based entity resolution (all-MiniLM-L6-v2 via sentence-transformers)
#   - Cosine similarity for entity matching (threshold 0.85)
#   - data_source field on all outputs
#   - Specific exception handling (no bare except)
#   - Rule-based fallback when ML model unavailable
# ============================================================================

import re
import json
import sys
import os
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)

# ============================================================================
# ML MODEL LOADING (graceful degradation)
# ============================================================================

_embedding_model = None
_ml_available = False

def _load_embedding_model():
    """Load sentence-transformers model for entity resolution.
    Returns True if ML is available, False otherwise (falls back to rule-based).
    """
    global _embedding_model, _ml_available
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
        _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
        _ml_available = True
        logger.info("ARGUS v2: ML model loaded (all-MiniLM-L6-v2, 384-dim embeddings)")
        return True
    except ImportError:
        logger.warning("ARGUS v2: sentence-transformers not installed. Using rule-based fallback.")
        _ml_available = False
        return False
    except (OSError, RuntimeError) as e:
        logger.warning(f"ARGUS v2: Model load failed ({e}). Using rule-based fallback.")
        _ml_available = False
        return False

# Attempt to load on import
_load_embedding_model()

# ============================================================================
# EMBEDDING-BASED ENTITY RESOLUTION
# ============================================================================

def compute_embedding(text: str) -> Optional[Any]:
    """Compute 384-dim embedding for a text string.
    Returns numpy array or None if ML unavailable.
    """
    if not _ml_available or _embedding_model is None:
        return None
    try:
        import numpy as np
        embedding = _embedding_model.encode(text, normalize_embeddings=True)
        return embedding
    except (RuntimeError, ValueError) as e:
        logger.warning(f"ARGUS v2: Embedding computation failed for '{text}': {e}")
        return None

def cosine_similarity_ml(embedding_a, embedding_b) -> float:
    """Compute cosine similarity between two embeddings.
    Both embeddings should already be L2-normalized from sentence-transformers.
    """
    try:
        import numpy as np
        sim = float(np.dot(embedding_a, embedding_b))
        return max(0.0, min(1.0, sim))  # clamp to [0, 1]
    except (TypeError, ValueError) as e:
        logger.warning(f"ARGUS v2: Cosine similarity computation failed: {e}")
        return 0.0

ENTITY_MATCH_THRESHOLD = 0.85

def resolve_entity_ml(name: str, known_entities: Dict[str, Any]) -> Optional[Tuple[str, float]]:
    """Resolve an entity name against known entities using embeddings.
    Returns (matched_entity_id, similarity_score) or None if no match above threshold.
    """
    if not _ml_available:
        return None

    query_embedding = compute_embedding(name)
    if query_embedding is None:
        return None

    best_match = None
    best_score = 0.0

    for entity_id, entity_data in known_entities.items():
        # Compute embedding for canonical name and all aliases
        names_to_check = [entity_data.get('canonicalName', '')]
        names_to_check.extend(entity_data.get('aliases', []))

        for candidate_name in names_to_check:
            if not candidate_name:
                continue
            candidate_embedding = compute_embedding(candidate_name)
            if candidate_embedding is None:
                continue
            score = cosine_similarity_ml(query_embedding, candidate_embedding)
            if score > best_score:
                best_score = score
                best_match = entity_id

    if best_match and best_score >= ENTITY_MATCH_THRESHOLD:
        return (best_match, best_score)

    return None

# ============================================================================
# ENTITY CANONICALIZATION (rule-based, kept as fallback)
# ============================================================================

def normalize_name(name: str) -> str:
    """Normalize entity name for comparison."""
    return re.sub(r'[^a-z0-9\s]', '', name.lower()).replace('  ', ' ').strip()

def similarity(a: str, b: str) -> float:
    """Calculate similarity between two names (rule-based fallback).
    Fixed: replaced .includes() (JavaScript) with Python `in` operator.
    """
    na = normalize_name(a)
    nb = normalize_name(b)
    if na == nb:
        return 1.0
    # FIX (R13): was `na.includes(nb)` -- JS syntax. Now uses Python `in`.
    if nb in na or na in nb:
        return 0.8
    # Levenshtein approximation
    longer = na if len(na) > len(nb) else nb
    shorter = nb if len(na) > len(nb) else na
    if len(longer) == 0:
        return 1.0
    diff = len(longer) - len(shorter)
    return max(0, 1 - diff / len(longer) * 0.5)

# ============================================================================
# COUNTRY DATA
# ============================================================================

COUNTRY_NAMES = {
    'IR': 'Iran', 'IQ': 'Iraq', 'SA': 'Saudi Arabia', 'AE': 'UAE',
    'YE': 'Yemen', 'SY': 'Syria', 'IL': 'Israel', 'JO': 'Jordan',
    'LB': 'Lebanon', 'KW': 'Kuwait', 'QA': 'Qatar', 'BH': 'Bahrain',
    'OM': 'Oman', 'EG': 'Egypt', 'TR': 'Turkey', 'US': 'United States',
    'RU': 'Russia', 'CN': 'China', 'GB': 'United Kingdom', 'FR': 'France',
    'DE': 'Germany', 'PK': 'Pakistan', 'AF': 'Afghanistan'
}

REGIONAL_THREATS = {
    'IR': {'score': 85, 'level': 'critical', 'factors': ['Nuclear program', 'Ballistic missiles', 'Proxy forces']},
    'YE': {'score': 78, 'level': 'high', 'factors': ['Houthi attacks', 'Civil war', 'Humanitarian crisis']},
    'SY': {'score': 72, 'level': 'high', 'factors': ['Civil war', 'ISIS remnants', 'Foreign occupation']},
    'IQ': {'score': 65, 'level': 'high', 'factors': ['Political instability', 'ISIS cells', 'Iranian influence']},
    'LB': {'score': 58, 'level': 'medium', 'factors': ['Economic collapse', 'Hezbollah', 'Political deadlock']},
    'IL': {'score': 90, 'level': 'critical', 'factors': ['Gaza conflict', 'Iranian threats', 'Regional isolation']},
    'SA': {'score': 45, 'level': 'medium', 'factors': ['Yemen war', 'Regional rivalry', 'Economic reforms']},
    'AE': {'score': 35, 'level': 'low', 'factors': ['Regional diplomacy', 'Economic hub', 'Stable']},
}

# ============================================================================
# ORGANIZATION DATABASE
# ============================================================================

KNOWN_ORGANIZATIONS = {
    'IRGC': 'Islamic Revolutionary Guard Corps', 'Quds': 'Quds Force',
    'Houthis': 'Ansar Allah (Houthis)', 'Hezbollah': 'Hezbollah',
    'ISIS': 'Islamic State', 'Al-Qaeda': 'Al-Qaeda',
    'ISIS-K': 'ISIS-Khorasan', 'Taliban': 'Taliban',
    'PLO': 'Palestine Liberation Organization', 'PA': 'Palestinian Authority',
    'Mosad': 'Mossad', 'CIA': 'CIA', 'MI6': 'MI6',
    'GID': 'General Intelligence Directorate', 'Mukhabarat': 'Mukhabarat',
    'Coalition': 'Coalition Forces', 'US Navy': 'US Navy',
    'IRAF': 'Islamic Republic Air Force', 'SyAAF': 'Syrian Arab Air Force',
    'RSAF': 'Royal Saudi Air Force', 'UAE Air Force': 'UAE Air Force',
}

# ============================================================================
# ENTITY EXTRACTION
# ============================================================================

def extract_entities_from_event(event: Dict, known_entities: Optional[Dict] = None) -> List[Dict]:
    """Extract entities from an event.
    Uses ML embedding resolution when available, rule-based otherwise.
    """
    entities = []

    # Extract country
    countries = event.get('countries', [])
    for code in countries:
        name = COUNTRY_NAMES.get(code, code)
        entities.append({
            'id': f'country_{code}',
            'canonicalName': name,
            'type': 'nation',
            'country': code,
            'aliases': [name, code],
            'resolvedBy': 'rule'
        })

    # Extract organizations from title
    title = event.get('title', '')
    for org_code, org_name in KNOWN_ORGANIZATIONS.items():
        if org_code.lower() in title.lower():
            entity = {
                'id': f'org_{org_code.lower()}',
                'canonicalName': org_name,
                'type': 'organization',
                'aliases': [org_code, org_name],
                'resolvedBy': 'rule'
            }

            # Attempt ML-based resolution against known entities
            if known_entities and _ml_available:
                ml_match = resolve_entity_ml(org_name, known_entities)
                if ml_match:
                    matched_id, score = ml_match
                    entity['id'] = matched_id
                    entity['resolvedBy'] = 'ml_embedding'
                    entity['matchScore'] = round(score, 4)

            entities.append(entity)

    return entities

def canonicalize_entities(entities: List[Dict]) -> List[Dict]:
    """Group similar entities into canonical forms.
    Uses ML embedding similarity when available, rule-based otherwise.
    """
    canonical = {}

    for entity in entities:
        canonical_id = entity['id']

        # ML-based duplicate detection
        if _ml_available and canonical:
            for existing_id, existing_entity in canonical.items():
                ml_match = resolve_entity_ml(
                    entity['canonicalName'],
                    {existing_id: existing_entity}
                )
                if ml_match:
                    canonical_id = existing_id
                    break

        if canonical_id not in canonical:
            canonical[canonical_id] = {
                **entity,
                'aliases': set(entity.get('aliases', [entity['canonicalName']])),
                'eventCount': 0,
                'linkedEntities': []
            }
        canonical[canonical_id]['eventCount'] += 1
        canonical[canonical_id]['aliases'].update(entity.get('aliases', []))

    # Convert sets to lists
    for eid in canonical:
        canonical[eid]['aliases'] = list(canonical[eid]['aliases'])

    return list(canonical.values())

# ============================================================================
# THREAT SCORING
# ============================================================================

def calculate_country_threat(country_code: str, events: List[Dict]) -> Dict:
    """Calculate threat score for a country."""
    base = REGIONAL_THREATS.get(country_code, {'score': 30, 'level': 'low', 'factors': []})

    # Adjust based on recent events
    recent_events = [e for e in events if country_code in e.get('countries', [])]

    # Count high-severity events
    critical_count = sum(1 for e in recent_events if e.get('severity') == 'critical')
    high_count = sum(1 for e in recent_events if e.get('severity') == 'high')

    score = base['score'] + (critical_count * 5) + (high_count * 2)
    score = min(100, score)

    if score >= 80:
        level = 'critical'
    elif score >= 60:
        level = 'high'
    elif score >= 40:
        level = 'medium'
    else:
        level = 'low'

    return {
        'code': country_code,
        'name': COUNTRY_NAMES.get(country_code, country_code),
        'threat': {
            'overall': score,
            'level': level,
            'factors': base['factors'],
            'trend': 'increasing' if critical_count > 2 else 'stable'
        }
    }

def get_country_threats(events: List[Dict], limit: int = 10) -> List[Dict]:
    """Get threat scores for all countries in events."""
    country_codes = set()
    for event in events:
        country_codes.update(event.get('countries', []))

    threats = []
    for code in country_codes:
        threat = calculate_country_threat(code, events)
        threats.append(threat)

    # Sort by threat score
    threats.sort(key=lambda x: x['threat']['overall'], reverse=True)
    return threats[:limit]

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def process_events(events: List[Dict], data_source: str = "live") -> Dict:
    """Process events through Argus v2 engine.
    Args:
        events: List of event dictionaries
        data_source: "live" or "mock" -- propagated to output per R14
    """
    all_entities = []
    for event in events:
        all_entities.extend(extract_entities_from_event(event))

    canonical_entities = canonicalize_entities(all_entities)
    country_threats = get_country_threats(events)

    return {
        'module': 'argus',
        'version': '2.0.0',
        'data_source': data_source,
        'ml_enabled': _ml_available,
        'entities': canonical_entities,
        'countryThreats': country_threats,
        'summary': {
            'totalEntities': len(canonical_entities),
            'totalCountries': len(country_threats),
            'criticalThreats': sum(1 for t in country_threats if t['threat']['level'] == 'critical'),
            'resolutionMethod': 'ml_embedding' if _ml_available else 'rule_based'
        }
    }

# ============================================================================
# STDIN/STDOUT PROTOCOL (per architecture contract)
# ============================================================================

def main():
    """Entry point for module stdin/stdout protocol.
    Reads JSON from stdin, processes, writes JSON to stdout.
    Exit 0 on success, 1 on failure (stderr for errors).
    """
    try:
        input_data = json.loads(sys.stdin.read())
        events = input_data.get('events', [])
        config = input_data.get('config', {})

        data_source = config.get('dataSource', 'live')
        limit = config.get('limit', 50)
        country = config.get('country')

        filtered = events[:limit]
        if country:
            filtered = [e for e in filtered if country in e.get('countries', [])]

        import time
        start = time.time()
        result = process_events(filtered, data_source=data_source)
        duration_ms = int((time.time() - start) * 1000)

        output = {
            'module': 'argus',
            'version': '2.0.0',
            'dataSource': data_source,
            'data': result,
            'durationMs': duration_ms,
            'error': None
        }

        json.dump(output, sys.stdout)
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"ARGUS: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"ARGUS: Missing required field: {e}", file=sys.stderr)
        sys.exit(1)
    except (IOError, OSError) as e:
        print(f"ARGUS: I/O error: {e}", file=sys.stderr)
        sys.exit(1)

# ============================================================================
# FLASK API (legacy compatibility)
# ============================================================================

def lambda_handler(event, context):
    """AWS Lambda / Vercel handler."""
    from flask import jsonify, request

    try:
        with open('incidents.json', 'r') as f:
            incidents = json.load(f)
    except FileNotFoundError:
        incidents = []
    except json.JSONDecodeError as e:
        logger.error(f"ARGUS: Failed to parse incidents.json: {e}")
        incidents = []

    # Get query params
    limit = int(request.args.get('limit', 50))
    country = request.args.get('country', None)

    # Filter
    filtered = incidents[:limit]
    if country:
        filtered = [i for i in filtered if country in i.get('countries', [])]

    # Process
    result = process_events(filtered, data_source="live")

    return jsonify(result)

if __name__ == '__main__':
    main()
