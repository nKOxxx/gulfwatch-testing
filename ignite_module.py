# ============================================================================
# IGNITE v2 - NASA FIRMS Heat Detection
# Real-time fire/thermal anomaly detection in the Gulf region
#
# v2 upgrades (Marcus Lindgren):
#   - data_source: "live" | "mock" field on ALL outputs (R14)
#   - Mock data clearly flagged in response when falling back
#   - API key moved to environment variable (R1/R10)
#   - Specific exception handling, no bare except (R17)
# ============================================================================

import json
import math
import os
import sys
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# NASA FIRMS API CONFIG
# ============================================================================

NASA_FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
GULF_BOUNDING_BOX = [34, 12, 60, 35]  # [min_lon, min_lat, max_lon, max_lat]

# API key from environment variable (never hardcoded -- R1/R10)
def _get_api_key() -> Optional[str]:
    """Get NASA FIRMS API key from environment."""
    key = os.environ.get('NASA_FIRMS_API_KEY', os.environ.get('FIRMS_API_KEY'))
    if not key or key == 'DEMO_KEY':
        return None
    return key

# ============================================================================
# VIIRS I-BAND ACTIVE FIRE DETECTION
# ============================================================================

def fetch_viirs_fires(api_key: str, days: int = 1) -> tuple:
    """Fetch VIIRS I-band active fire data for Gulf region.
    Returns (fires_list, data_source) where data_source is "live" or "mock".
    """
    import urllib.request
    import csv
    import io

    url = f"{NASA_FIRMS_BASE}/{api_key}/VIIRS_I_BAND_NRT/{','.join(map(str, GULF_BOUNDING_BOX))}/{days}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read().decode('utf-8')

        fires = []
        reader = csv.DictReader(io.StringIO(data))
        for row in reader:
            fires.append({
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'bright_ti4': float(row.get('bright_ti4', 0)),
                'fire_radiative_power': float(row.get('fire_radiative_power', 0)),
                'acq_date': row.get('acq_date', ''),
                'acq_time': row.get('acq_time', ''),
                'satellite': 'VIIRS-NPP',
                'confidence': row.get('confidence', 'nominal'),
                'type': row.get('type', 0),
                'data_source': 'live'
            })
        return fires, 'live'
    except urllib.error.URLError as e:
        logger.warning(f"IGNITE: Network error fetching VIIRS data: {e}")
        return generate_mock_fires(), 'mock'
    except (ValueError, KeyError) as e:
        logger.warning(f"IGNITE: Data parsing error for VIIRS: {e}")
        return generate_mock_fires(), 'mock'
    except OSError as e:
        logger.warning(f"IGNITE: OS error fetching VIIRS data: {e}")
        return generate_mock_fires(), 'mock'

def fetch_modis_fires(api_key: str, days: int = 1) -> tuple:
    """Fetch MODIS active fire data for Gulf region.
    Returns (fires_list, data_source) where data_source is "live" or "mock".
    """
    import urllib.request
    import csv
    import io

    url = f"{NASA_FIRMS_BASE}/{api_key}/MODIS_NRT/{','.join(map(str, GULF_BOUNDING_BOX))}/{days}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read().decode('utf-8')

        fires = []
        reader = csv.DictReader(io.StringIO(data))
        for row in reader:
            fires.append({
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'brightness': float(row.get('brightness', 0)),
                'fire_radiative_power': float(row.get('frp', 0)),
                'acq_date': row.get('acq_date', ''),
                'acq_time': row.get('acq_time', ''),
                'satellite': 'MODIS-Aqua',
                'confidence': row.get('confidence', 'nominal'),
                'type': int(row.get('type', 0)),
                'data_source': 'live'
            })
        return fires, 'live'
    except urllib.error.URLError as e:
        logger.warning(f"IGNITE: Network error fetching MODIS data: {e}")
        return generate_mock_fires(), 'mock'
    except (ValueError, KeyError) as e:
        logger.warning(f"IGNITE: Data parsing error for MODIS: {e}")
        return generate_mock_fires(), 'mock'
    except OSError as e:
        logger.warning(f"IGNITE: OS error fetching MODIS data: {e}")
        return generate_mock_fires(), 'mock'

# ============================================================================
# MOCK DATA FOR TESTING
# NOTE: All mock data is clearly flagged with data_source: "mock"
# ============================================================================

def generate_mock_fires() -> List[Dict]:
    """Generate realistic mock fire data for testing.
    ALL mock entries are tagged with data_source: "mock" per R14.
    """
    import random

    mock_fires = []
    locations = [
        {'lat': 29.4, 'lon': 47.5, 'name': 'Kuwait'},
        {'lat': 23.7, 'lon': 58.5, 'name': 'Oman'},
        {'lat': 24.5, 'lon': 54.4, 'name': 'UAE'},
        {'lat': 26.9, 'lon': 50.6, 'name': 'Saudi Arabia East'},
        {'lat': 30.3, 'lon': 48.2, 'name': 'Iraq South'},
        {'lat': 15.2, 'lon': 44.0, 'name': 'Yemen'},
        {'lat': 32.0, 'lon': 44.3, 'name': 'Iraq Central'},
        {'lat': 34.3, 'lon': 36.3, 'name': 'Syria Coast'},
        {'lat': 31.5, 'lon': 35.0, 'name': 'Jordan'},
        {'lat': 33.3, 'lon': 44.4, 'name': 'Baghdad'},
        {'lat': 35.5, 'lon': 35.8, 'name': 'Latakia'},
        {'lat': 13.5, 'lon': 44.0, 'name': 'Yemen South'},
    ]

    for _ in range(random.randint(15, 40)):
        loc = random.choice(locations)
        lat = loc['lat'] + random.uniform(-0.5, 0.5)
        lon = loc['lon'] + random.uniform(-0.5, 0.5)

        fire = {
            'latitude': round(lat, 4),
            'longitude': round(lon, 4),
            'bright_ti4': random.uniform(280, 400),
            'fire_radiative_power': random.uniform(5, 150),
            'acq_date': datetime.now().strftime('%Y-%m-%d'),
            'acq_time': f"{random.randint(0,23):02d}{random.randint(0,59):02d}",
            'satellite': random.choice(['VIIRS-NPP', 'MODIS-Aqua']),
            'confidence': random.choice(['low', 'medium', 'high', 'nominal']),
            'type': random.choice([0, 1, 2, 3]),
            'location': loc['name'],
            'data_source': 'mock'  # R14: clearly flag mock data
        }
        mock_fires.append(fire)

    return mock_fires

# ============================================================================
# FIRE CLASSIFICATION
# ============================================================================

def classify_fire(fire: Dict) -> Dict:
    """Classify fire type and risk level."""
    frp = fire.get('fire_radiative_power', 0)
    confidence = fire.get('confidence', 'nominal')
    brightness = fire.get('bright_ti4', fire.get('brightness', 300))

    if frp > 100:
        fire_type = 'industrial_large'
        risk = 'high'
    elif frp > 50:
        fire_type = 'industrial_medium'
        risk = 'medium'
    elif brightness > 350:
        fire_type = 'gas_flare'
        risk = 'medium'
    elif frp > 20:
        fire_type = 'wildfire'
        risk = 'medium'
    else:
        fire_type = 'controlled_burn'
        risk = 'low'

    if confidence == 'high':
        risk = 'high' if risk != 'low' else 'medium'
    elif confidence == 'low':
        risk = 'low' if risk != 'high' else 'medium'

    return {
        **fire,
        'fireType': fire_type,
        'riskLevel': risk,
        'isThermalAnomaly': brightness > 320
    }

# ============================================================================
# ANALYSIS
# ============================================================================

def analyze_fires(fires: List[Dict], data_source: str = "live") -> Dict:
    """Analyze fire/thermal data for patterns.
    Args:
        fires: List of fire detection dictionaries
        data_source: "live" or "mock" -- propagated to output per R14
    """
    if not fires:
        return {
            'module': 'ignite',
            'version': '2.0.0',
            'data_source': data_source,
            'totalDetections': 0,
            'classified': [],
            'hotspots': [],
            'summary': {'industrial': 0, 'wildfire': 0, 'controlled': 0}
        }

    classified = [classify_fire(f) for f in fires]

    # Count by type
    fire_types = {}
    for f in classified:
        ft = f.get('fireType', 'unknown')
        fire_types[ft] = fire_types.get(ft, 0) + 1

    # Find hotspots (high FRP)
    hotspots = sorted(classified, key=lambda x: x.get('fire_radiative_power', 0), reverse=True)[:10]

    # Group by region
    regions = {}
    for f in classified:
        lat, lon = f['latitude'], f['longitude']
        if 34 <= lon <= 40 and 32 <= lat <= 36:
            region = 'Levant'
        elif 40 <= lon <= 50 and 28 <= lat <= 35:
            region = 'Iraq'
        elif 50 <= lon <= 56 and 24 <= lat <= 30:
            region = 'Gulf'
        elif 56 <= lon <= 60 and 20 <= lat <= 28:
            region = 'Gulf of Oman'
        elif 42 <= lon <= 54 and 12 <= lat <= 24:
            region = 'Arabian Sea'
        else:
            region = 'Other'

        if region not in regions:
            regions[region] = []
        regions[region].append(f)

    total_frp = sum(f.get('fire_radiative_power', 0) for f in classified)

    return {
        'module': 'ignite',
        'version': '2.0.0',
        'data_source': data_source,
        'totalDetections': len(classified),
        'classified': classified,
        'hotspots': hotspots,
        'byRegion': {k: len(v) for k, v in regions.items()},
        'byType': fire_types,
        'totalFirePower': round(total_frp, 1),
        'timestamp': datetime.now().isoformat(),
        'mockDataWarning': 'This output contains procedurally generated mock data. Real-time data requires a valid NASA FIRMS API key.' if data_source == 'mock' else None
    }

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def get_thermal_data(api_key: Optional[str] = None) -> Dict:
    """Get thermal/fire data from NASA FIRMS or mock.
    API key sourced from environment variable first, then parameter.
    """
    env_key = _get_api_key()
    effective_key = env_key or api_key

    if effective_key:
        viirs_fires, viirs_source = fetch_viirs_fires(effective_key)
        modis_fires, modis_source = fetch_modis_fires(effective_key)
        all_fires = viirs_fires + modis_fires
        # If any source is live, mark as live; if all mock, mark as mock
        data_source = 'live' if viirs_source == 'live' or modis_source == 'live' else 'mock'
    else:
        all_fires = generate_mock_fires()
        data_source = 'mock'

    return analyze_fires(all_fires, data_source=data_source)

# ============================================================================
# STDIN/STDOUT PROTOCOL (per architecture contract)
# ============================================================================

def main():
    """Entry point for module stdin/stdout protocol."""
    try:
        input_data = json.loads(sys.stdin.read())
        config = input_data.get('config', {})
        data_source_config = config.get('dataSource', 'live')

        import time
        start = time.time()
        result = get_thermal_data()
        duration_ms = int((time.time() - start) * 1000)

        output = {
            'module': 'ignite',
            'version': '2.0.0',
            'dataSource': result.get('data_source', data_source_config),
            'data': result,
            'durationMs': duration_ms,
            'error': None
        }

        json.dump(output, sys.stdout)
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"IGNITE: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"IGNITE: Missing required field: {e}", file=sys.stderr)
        sys.exit(1)
    except (IOError, OSError) as e:
        print(f"IGNITE: I/O error: {e}", file=sys.stderr)
        sys.exit(1)

# ============================================================================
# FLASK API (legacy compatibility)
# ============================================================================

def lambda_handler(event, context):
    """AWS Lambda / Vercel handler."""
    from flask import jsonify, request

    # API key from env (preferred) or query param (legacy fallback)
    api_key = _get_api_key() or request.args.get('api_key')
    source = request.args.get('source', 'all')

    if api_key and source == 'viirs':
        fires, data_source = fetch_viirs_fires(api_key)
    elif api_key and source == 'modis':
        fires, data_source = fetch_modis_fires(api_key)
    elif api_key:
        viirs, vs = fetch_viirs_fires(api_key)
        modis, ms = fetch_modis_fires(api_key)
        fires = viirs + modis
        data_source = 'live' if vs == 'live' or ms == 'live' else 'mock'
    else:
        fires = generate_mock_fires()
        data_source = 'mock'

    result = analyze_fires(fires, data_source=data_source)

    return jsonify(result)

if __name__ == '__main__':
    main()
