# ============================================================================
# SKYLINE v2 - Weather Intelligence
# Meteorological analysis for military operations
#
# IMPORTANT: All weather data in this module is PROCEDURALLY GENERATED
# (simulated). It does not come from real weather stations or forecasts.
# Integration point for real OpenWeatherMap API is provided but not active.
#
# v2 upgrades (Marcus Lindgren):
#   - data_source: "simulated" on ALL outputs (R14)
#   - Integration point for real weather API (OpenWeatherMap) when available
#   - Clear documentation that all data is procedurally generated
#   - Specific exception handling, no bare except (R17)
# ============================================================================

import json
import math
import os
import random
import sys
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# REAL WEATHER API INTEGRATION POINT
# When OPENWEATHERMAP_API_KEY is set, SKYLINE will attempt to fetch real data.
# Otherwise, all data is procedurally generated (simulated).
# ============================================================================

_real_weather_available = False

def _get_owm_api_key() -> Optional[str]:
    """Get OpenWeatherMap API key from environment."""
    key = os.environ.get('OPENWEATHERMAP_API_KEY', os.environ.get('OWM_API_KEY'))
    return key if key else None

def fetch_real_weather(lat: float, lon: float) -> Optional[Dict]:
    """Fetch real weather from OpenWeatherMap API.
    Returns weather dict if available, None if API unavailable or fails.
    This is the integration point for real weather data.
    """
    api_key = _get_owm_api_key()
    if not api_key:
        return None

    try:
        import urllib.request
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={api_key}&units=metric"
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        return {
            'temperature': data['main']['temp'],
            'humidity': data['main']['humidity'],
            'windSpeed': data['wind']['speed'] * 3.6,  # m/s to km/h
            'windDirection': _degrees_to_compass(data['wind'].get('deg', 0)),
            'visibility': data.get('visibility', 10000) / 1000,  # m to km
            'condition': _owm_condition_map(data['weather'][0]['main']),
            'data_source': 'live'
        }
    except ImportError:
        return None
    except (urllib.error.URLError, KeyError, ValueError, OSError) as e:
        logger.warning(f"SKYLINE: Real weather fetch failed: {e}")
        return None

def _degrees_to_compass(degrees: float) -> str:
    """Convert wind degrees to compass direction."""
    dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = round(degrees / 45) % 8
    return dirs[idx]

def _owm_condition_map(owm_main: str) -> str:
    """Map OpenWeatherMap condition to our condition set."""
    mapping = {
        'Clear': 'clear',
        'Clouds': 'partly_cloudy',
        'Rain': 'cloudy',
        'Drizzle': 'cloudy',
        'Thunderstorm': 'cloudy',
        'Snow': 'cloudy',
        'Mist': 'fog',
        'Fog': 'fog',
        'Haze': 'dust',
        'Dust': 'dust',
        'Sand': 'sandstorm',
        'Squall': 'sandstorm',
    }
    return mapping.get(owm_main, 'partly_cloudy')

# ============================================================================
# WEATHER DATA (SIMULATED -- procedurally generated)
# All data below is NOT from real weather sources.
# ============================================================================

GULF_REGIONS = {
    'gulf_central': {'lat': 26.5, 'lon': 52.0, 'name': 'Central Gulf'},
    'gulf_north': {'lat': 29.5, 'lon': 48.0, 'name': 'Northern Gulf'},
    'gulf_south': {'lat': 23.0, 'lon': 56.0, 'name': 'Gulf of Oman'},
    'arabian_sea': {'lat': 15.0, 'lon': 58.0, 'name': 'Arabian Sea'},
    'red_sea_north': {'lat': 28.0, 'lon': 34.0, 'name': 'Northern Red Sea'},
    'red_sea_south': {'lat': 18.0, 'lon': 40.0, 'name': 'Southern Red Sea'},
    'levant': {'lat': 33.0, 'lon': 36.0, 'name': 'Levant Coast'},
    'mesopotamia': {'lat': 31.0, 'lon': 47.0, 'name': 'Mesopotamia'},
}

def get_region_weather(region_id: str) -> Dict:
    """Get weather for a specific region.
    Attempts real API first (if key available), falls back to simulation.
    NOTE: Without OPENWEATHERMAP_API_KEY, all data is SIMULATED.
    """
    region = GULF_REGIONS.get(region_id, GULF_REGIONS['gulf_central'])

    # Try real weather first
    real = fetch_real_weather(region['lat'], region['lon'])
    if real:
        return {
            'region': region_id,
            'name': region['name'],
            'coordinates': {'lat': region['lat'], 'lon': region['lon']},
            **real,
            'timestamp': datetime.now().isoformat(),
            'data_source': 'live'
        }

    # Simulated weather (procedurally generated)
    base_temp = 35 - (region['lat'] - 15) * 0.5
    temp = base_temp + random.uniform(-5, 5)
    humidity = random.uniform(40, 90)
    wind_speed = random.uniform(5, 35)
    visibility = random.uniform(5, 20) if humidity < 70 else random.uniform(2, 10)

    wind_dirs = ['NW', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W']
    wind_dir = random.choice(wind_dirs)

    conditions = ['clear', 'partly_cloudy', 'cloudy', 'dust', 'sandstorm', 'fog']
    if humidity > 80:
        weights = [0.1, 0.2, 0.3, 0.1, 0.05, 0.25]
    elif humidity < 50:
        weights = [0.4, 0.3, 0.15, 0.1, 0.05, 0.0]
    else:
        weights = [0.3, 0.3, 0.2, 0.1, 0.1, 0.0]

    condition = random.choices(conditions, weights=weights)[0]

    return {
        'region': region_id,
        'name': region['name'],
        'coordinates': {'lat': region['lat'], 'lon': region['lon']},
        'temperature': round(temp, 1),
        'humidity': round(humidity, 1),
        'windSpeed': round(wind_speed, 1),
        'windDirection': wind_dir,
        'visibility': round(visibility, 1),
        'condition': condition,
        'timestamp': datetime.now().isoformat(),
        'data_source': 'simulated'  # R14: clearly mark as simulated
    }

def get_all_weather() -> Dict:
    """Get weather for all Gulf regions.
    NOTE: Without real API key, all data is SIMULATED (procedurally generated).
    """
    regions = {}
    for region_id in GULF_REGIONS:
        regions[region_id] = get_region_weather(region_id)
    return regions

# ============================================================================
# IMPACT ASSESSMENT
# ============================================================================

def assess_impact(weather: Dict) -> Dict:
    """Assess weather impact on operations."""
    score = 0
    factors = []

    vis = weather.get('visibility', 20)
    if vis < 2:
        score += 40
        factors.append('Very low visibility - UAV/satellite operations severely impacted')
    elif vis < 5:
        score += 25
        factors.append('Low visibility - limited drone operations')
    elif vis < 10:
        score += 10
        factors.append('Moderate visibility - some restrictions')

    wind = weather.get('windSpeed', 10)
    if wind > 30:
        score += 30
        factors.append('High winds - aircraft instability risk')
    elif wind > 20:
        score += 15
        factors.append('Moderate winds - drone operations affected')
    elif wind > 15:
        score += 5
        factors.append('Light winds - minor impact')

    cond = weather.get('condition', 'clear')
    if cond == 'sandstorm':
        score += 50
        factors.append('Sandstorm - all operations impacted, equipment at risk')
    elif cond == 'dust':
        score += 25
        factors.append('Dust - reduced visibility, equipment wear')

    temp = weather.get('temperature', 30)
    if temp > 45:
        score += 15
        factors.append('Extreme heat - equipment overheating, personnel risk')
    elif temp > 40:
        score += 5
        factors.append('High temperature - reduced equipment efficiency')

    if score >= 80:
        impact = 'severe'
    elif score >= 50:
        impact = 'high'
    elif score >= 25:
        impact = 'moderate'
    else:
        impact = 'minimal'

    return {
        'overallScore': min(100, score),
        'impactLevel': impact,
        'factors': factors,
        'recommendation': get_recommendation(impact)
    }

def get_recommendation(impact: str) -> str:
    """Get operational recommendation based on impact level."""
    recommendations = {
        'severe': 'Suspend all UAV, satellite, and airborne operations. Ground all aircraft. Secure equipment.',
        'high': 'Limit UAV operations to essential only. Increase maintenance checks. Consider postponing non-critical missions.',
        'moderate': 'UAV operations possible with caution. Monitor equipment closely. Plan for reduced endurance.',
        'minimal': 'All operations nominal. Standard monitoring protocols.'
    }
    return recommendations.get(impact, 'No recommendation available.')

# ============================================================================
# FORECAST (SIMULATED -- procedurally generated)
# ============================================================================

def generate_forecast(region_id: str, hours: int = 24) -> List[Dict]:
    """Generate weather forecast for region.
    NOTE: This is SIMULATED data, not a real weather forecast.
    """
    region = GULF_REGIONS.get(region_id, GULF_REGIONS['gulf_central'])
    base_temp = 35 - (region['lat'] - 15) * 0.5

    forecast = []
    now = datetime.now()

    for h in range(hours):
        hour_factor = math.sin((h - 6) * math.pi / 12) * 5
        temp = base_temp + hour_factor + random.uniform(-3, 3)
        humidity = 70 - (temp - 30) * 1.5 + random.uniform(-10, 10)
        humidity = max(20, min(95, humidity))
        wind = 15 + abs(hour_factor) * 2 + random.uniform(-5, 5)

        cond = 'clear' if humidity < 60 else 'partly_cloudy' if humidity < 75 else 'cloudy'
        if random.random() < 0.05:
            cond = random.choice(['dust', 'fog'])

        forecast.append({
            'hour': h,
            'timestamp': (now + timedelta(hours=h)).isoformat(),
            'temperature': round(temp, 1),
            'humidity': round(humidity, 1),
            'windSpeed': round(wind, 1),
            'windDirection': random.choice(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
            'condition': cond,
            'visibility': round(20 - humidity / 10 + random.uniform(-2, 2), 1),
            'data_source': 'simulated'  # R14
        })

    return forecast

# ============================================================================
# MARITIME WEATHER (SIMULATED -- procedurally generated)
# ============================================================================

def get_maritime_weather() -> Dict:
    """Get specialized maritime weather for naval operations.
    NOTE: This is SIMULATED data, not real maritime weather.
    """
    areas = {
        'persian_gulf': {'lat': 26.5, 'lon': 52.0, 'name': 'Persian Gulf'},
        'gulf_of_oman': {'lat': 24.0, 'lon': 58.0, 'name': 'Gulf of Oman'},
        'arabian_sea': {'lat': 15.0, 'lon': 58.0, 'name': 'Arabian Sea'},
        'red_sea': {'lat': 22.0, 'lon': 38.0, 'name': 'Red Sea'},
    }

    maritime = {}
    for area_id, area in areas.items():
        wind = random.uniform(2, 8)
        if wind < 3:
            sea_state = 1
        elif wind < 5:
            sea_state = 2
        elif wind < 7:
            sea_state = 3
        else:
            sea_state = 4

        maritime[area_id] = {
            'name': area['name'],
            'coordinates': area,
            'seaState': sea_state,
            'waveHeight': round(sea_state * 0.5 + random.uniform(0, 0.5), 1),
            'swell': round(random.uniform(0.5, 2), 1),
            'swellDirection': random.choice(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
            'windSpeed': round(wind, 1),
            'windDirection': random.choice(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
            'precipitation': random.choice(['none', 'light', 'moderate']) if random.random() > 0.7 else 'none',
            'seaTemperature': round(28 + random.uniform(-3, 3), 1),
            'tidalRange': round(random.uniform(1, 4), 1),
            'timestamp': datetime.now().isoformat(),
            'data_source': 'simulated'  # R14
        }

    return maritime

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def get_weather_intelligence() -> Dict:
    """Get complete weather intelligence.
    NOTE: Without real API key, ALL data is SIMULATED (procedurally generated).
    """
    weather = get_all_weather()

    # Determine overall data source
    sources = set(w.get('data_source', 'simulated') for w in weather.values())
    overall_source = 'live' if 'live' in sources else 'simulated'

    # Assess impacts
    impacts = {}
    for region_id, data in weather.items():
        impacts[region_id] = assess_impact(data)

    maritime = get_maritime_weather()

    avg_score = sum(i['overallScore'] for i in impacts.values()) / max(1, len(impacts))
    severe_count = sum(1 for i in impacts.values() if i['impactLevel'] == 'severe')
    high_count = sum(1 for i in impacts.values() if i['impactLevel'] == 'high')

    return {
        'module': 'skyline',
        'version': '2.0.0',
        'data_source': overall_source,
        'regions': weather,
        'impacts': impacts,
        'maritime': maritime,
        'summary': {
            'overallRiskScore': round(avg_score, 1),
            'severeRegions': severe_count,
            'highRiskRegions': high_count,
            'operationalReadiness': 'degraded' if severe_count > 2 else 'normal',
            'timestamp': datetime.now().isoformat()
        },
        'simulatedDataNotice': 'All weather data is procedurally generated (simulated). Set OPENWEATHERMAP_API_KEY environment variable for real weather data.' if overall_source == 'simulated' else None
    }

# ============================================================================
# STDIN/STDOUT PROTOCOL (per architecture contract)
# ============================================================================

def main():
    """Entry point for module stdin/stdout protocol."""
    try:
        input_data = json.loads(sys.stdin.read())
        config = input_data.get('config', {})

        region = config.get('region')
        forecast_hours = config.get('forecastHours', 24)

        import time
        start = time.time()

        if region:
            if forecast_hours > 0:
                result = generate_forecast(region, forecast_hours)
            else:
                result = get_region_weather(region)
        else:
            result = get_weather_intelligence()

        duration_ms = int((time.time() - start) * 1000)

        data_source = 'simulated'
        if isinstance(result, dict):
            data_source = result.get('data_source', 'simulated')
        elif isinstance(result, list) and result:
            data_source = result[0].get('data_source', 'simulated')

        output = {
            'module': 'skyline',
            'version': '2.0.0',
            'dataSource': data_source,
            'data': result,
            'durationMs': duration_ms,
            'error': None
        }

        json.dump(output, sys.stdout)
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"SKYLINE: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"SKYLINE: Missing required field: {e}", file=sys.stderr)
        sys.exit(1)
    except (IOError, OSError) as e:
        print(f"SKYLINE: I/O error: {e}", file=sys.stderr)
        sys.exit(1)

# ============================================================================
# FLASK API (legacy compatibility)
# ============================================================================

def lambda_handler(event, context):
    """AWS Lambda / Vercel handler."""
    from flask import jsonify, request

    region = request.args.get('region', None)
    forecast_hours = int(request.args.get('hours', 24))

    if region:
        if forecast_hours > 0:
            result = generate_forecast(region, forecast_hours)
        else:
            result = get_region_weather(region)
    else:
        result = get_weather_intelligence()

    return jsonify(result)

if __name__ == '__main__':
    main()
