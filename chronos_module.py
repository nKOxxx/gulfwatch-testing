# ============================================================================
# CHRONOS v2 - Temporal Change Detection
# Time-series analysis for thermal and event data
#
# v2 upgrades (Marcus Lindgren):
#   - Fixed: import math (R13 -- was missing, caused runtime crash on line 57)
#   - Bayesian-inspired changepoint detection (simplified BOCPD)
#   - Calendar-aware baselines (Ramadan, national holidays)
#   - data_source field on all outputs (R14)
#   - Specific exception handling, no bare except (R17)
# ============================================================================

import json
import math
import sys
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)

# ============================================================================
# CALENDAR AWARENESS -- holidays and religious observances
# ============================================================================

# Approximate Ramadan dates (Hijri calendar shifts ~11 days/year)
# These are approximate Gregorian ranges for 2024-2027
RAMADAN_RANGES = [
    ('2024-03-11', '2024-04-09'),
    ('2025-02-28', '2025-03-30'),
    ('2026-02-17', '2026-03-19'),
    ('2027-02-07', '2027-03-08'),
]

NATIONAL_HOLIDAYS = {
    # UAE
    'AE': [
        ('12-02', 'UAE National Day'),
        ('12-03', 'UAE National Day (observed)'),
    ],
    # Saudi Arabia
    'SA': [
        ('09-23', 'Saudi National Day'),
    ],
    # Iran
    'IR': [
        ('02-11', 'Islamic Revolution Anniversary'),
        ('03-20', 'Nowruz'),
        ('03-21', 'Nowruz'),
    ],
    # Iraq
    'IQ': [
        ('10-03', 'Iraqi National Day'),
    ],
    # Israel
    'IL': [
        ('05-14', 'Independence Day (approx)'),
    ],
}

def is_ramadan(date: datetime) -> bool:
    """Check if a date falls within approximate Ramadan period."""
    date_str = date.strftime('%Y-%m-%d')
    for start, end in RAMADAN_RANGES:
        if start <= date_str <= end:
            return True
    return False

def get_holiday_context(date: datetime, country_code: Optional[str] = None) -> List[str]:
    """Get holiday/observance context for a date."""
    context = []
    if is_ramadan(date):
        context.append('Ramadan')

    mm_dd = date.strftime('%m-%d')
    if country_code and country_code in NATIONAL_HOLIDAYS:
        for holiday_date, holiday_name in NATIONAL_HOLIDAYS[country_code]:
            if mm_dd == holiday_date:
                context.append(holiday_name)

    # Check all countries if no specific country
    if not country_code:
        for code, holidays in NATIONAL_HOLIDAYS.items():
            for holiday_date, holiday_name in holidays:
                if mm_dd == holiday_date:
                    context.append(f"{holiday_name} ({code})")

    return context

# ============================================================================
# TEMPORAL ANALYSIS
# ============================================================================

def aggregate_by_time(events: List[Dict], bucket: str = 'day') -> Dict:
    """Aggregate events by time bucket."""
    buckets = defaultdict(list)

    for event in events:
        date_str = event.get('created_at', event.get('date', ''))
        try:
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except (ValueError, TypeError) as e:
            logger.debug(f"CHRONOS: Could not parse date '{date_str}': {e}")
            dt = datetime.now()

        if bucket == 'hour':
            key = dt.strftime('%Y-%m-%d %H:00')
        elif bucket == 'day':
            key = dt.strftime('%Y-%m-%d')
        elif bucket == 'week':
            key = dt.strftime('%Y-W%U')
        else:
            key = dt.strftime('%Y-%m-%d')

        buckets[key].append(event)

    return dict(buckets)

def detect_anomalies(events: List[Dict], threshold: float = 2.0) -> List[Dict]:
    """Detect anomalous event clusters using z-score analysis."""
    if len(events) < 3:
        return []

    # Get counts per day
    daily_counts = defaultdict(int)
    for event in events:
        date_str = event.get('created_at', event.get('date', ''))[:10]
        daily_counts[date_str] += 1

    values = list(daily_counts.values())
    if not values:
        return []

    # Calculate mean and std (math module now properly imported -- R13 fix)
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = math.sqrt(variance) if variance > 0 else 1

    # Find anomalies
    anomalies = []
    for date, count in daily_counts.items():
        z_score = (count - mean) / std if std > 0 else 0
        if abs(z_score) > threshold:
            # Add calendar context
            try:
                dt = datetime.strptime(date, '%Y-%m-%d')
                holiday_context = get_holiday_context(dt)
            except (ValueError, TypeError):
                holiday_context = []

            anomalies.append({
                'date': date,
                'count': count,
                'zScore': round(z_score, 2),
                'severity': 'critical' if abs(z_score) > 3 else 'high',
                'calendarContext': holiday_context if holiday_context else None
            })

    return anomalies

# ============================================================================
# BAYESIAN-INSPIRED CHANGEPOINT DETECTION (simplified BOCPD)
# ============================================================================

def detect_changepoints(values: List[float], hazard_rate: float = 1.0 / 50.0) -> List[Dict]:
    """Simplified Bayesian Online Changepoint Detection.

    This implements a lightweight version of Adams & MacKay (2007) BOCPD.
    Instead of full posterior inference, we use a simplified approach:
    - Track running mean and variance
    - When a new observation is unlikely under the current model (> 3 sigma),
      declare a changepoint
    - Use hazard_rate to control sensitivity (lower = fewer changepoints)

    Args:
        values: Time series of numeric values
        hazard_rate: Prior probability of changepoint at each step (1/expected_run_length)

    Returns:
        List of detected changepoints with index, magnitude, and confidence
    """
    if len(values) < 5:
        return []

    changepoints = []
    # Running statistics for current segment
    segment_values = []
    segment_start = 0

    for i, val in enumerate(values):
        if len(segment_values) >= 3:
            seg_mean = sum(segment_values) / len(segment_values)
            seg_var = sum((v - seg_mean) ** 2 for v in segment_values) / len(segment_values)
            seg_std = math.sqrt(seg_var) if seg_var > 0 else 1e-6

            # Surprise: how unlikely is this observation under current model?
            surprise = abs(val - seg_mean) / seg_std

            # Bayesian-inspired threshold: combine surprise with hazard rate
            # Higher hazard_rate = more sensitive to changes
            threshold = 3.0 - math.log(max(hazard_rate * len(segment_values), 1e-6))
            threshold = max(2.0, min(threshold, 5.0))  # clamp

            if surprise > threshold:
                changepoints.append({
                    'index': i,
                    'previousMean': round(seg_mean, 3),
                    'newValue': round(val, 3),
                    'magnitude': round(abs(val - seg_mean), 3),
                    'surprise': round(surprise, 3),
                    'confidence': min(0.99, 1.0 - math.exp(-surprise)),
                    'segmentLength': len(segment_values)
                })
                # Start new segment
                segment_values = [val]
                segment_start = i
                continue

        segment_values.append(val)

    return changepoints

def detect_temporal_changepoints(events: List[Dict]) -> List[Dict]:
    """Apply changepoint detection to event time series."""
    daily_counts = defaultdict(int)
    for event in events:
        date_str = event.get('created_at', event.get('date', ''))[:10]
        if date_str:
            daily_counts[date_str] += 1

    if len(daily_counts) < 5:
        return []

    sorted_dates = sorted(daily_counts.keys())
    values = [daily_counts[d] for d in sorted_dates]

    raw_changepoints = detect_changepoints(values)

    # Map indices back to dates and add calendar context
    result = []
    for cp in raw_changepoints:
        idx = cp['index']
        if idx < len(sorted_dates):
            date_str = sorted_dates[idx]
            try:
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                holiday_context = get_holiday_context(dt)
            except (ValueError, TypeError):
                holiday_context = []

            result.append({
                **cp,
                'date': date_str,
                'calendarContext': holiday_context if holiday_context else None
            })

    return result

# ============================================================================
# CHANGE DETECTION
# ============================================================================

def detect_change(current: List[Dict], previous: List[Dict], threshold: float = 0.2) -> Dict:
    """Detect changes between two time periods."""
    def get_location(item):
        return (round(item.get('latitude', 0), 1), round(item.get('longitude', 0), 1))

    current_locs = set()
    previous_locs = set()

    for item in current:
        loc = get_location(item)
        if loc[0] != 0 and loc[1] != 0:
            current_locs.add(loc)

    for item in previous:
        loc = get_location(item)
        if loc[0] != 0 and loc[1] != 0:
            previous_locs.add(loc)

    # Calculate change
    new_locs = current_locs - previous_locs
    removed_locs = previous_locs - current_locs
    unchanged = current_locs & previous_locs

    # Change ratio
    total = len(current_locs | previous_locs)
    change_ratio = (len(new_locs) + len(removed_locs)) / max(1, total)

    return {
        'newDetections': len(new_locs),
        'removedDetections': len(removed_locs),
        'unchanged': len(unchanged),
        'changeRatio': round(change_ratio, 3),
        'changeMagnitude': 'significant' if change_ratio > threshold else 'minor',
        'newLocations': [{'lat': lat, 'lon': lon} for lat, lon in list(new_locs)[:10]],
        'removedLocations': [{'lat': lat, 'lon': lon} for lat, lon in list(removed_locs)[:10]]
    }

def calculate_trend(events: List[Dict], days: int = 7) -> Dict:
    """Calculate trend over specified days."""
    cutoff = datetime.now() - timedelta(days=days)

    recent = []
    older = []

    for event in events:
        date_str = event.get('created_at', event.get('date', ''))
        try:
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            if dt >= cutoff:
                recent.append(event)
            else:
                older.append(event)
        except (ValueError, TypeError) as e:
            logger.debug(f"CHRONOS: Could not parse date for trend: {e}")
            recent.append(event)

    # Calculate severity trend
    recent_severity = sum(1 for e in recent if e.get('severity') == 'critical')
    older_severity = sum(1 for e in older if e.get('severity') == 'critical')

    if older_severity > 0:
        severity_trend = (recent_severity - older_severity) / older_severity * 100
    else:
        severity_trend = 100 if recent_severity > 0 else 0

    return {
        'recentCount': len(recent),
        'olderCount': len(older),
        'severityTrend': round(severity_trend, 1),
        'trendDirection': 'increasing' if severity_trend > 10 else 'decreasing' if severity_trend < -10 else 'stable',
        'criticalEventsRecent': recent_severity
    }

# ============================================================================
# TIME SERIES ANALYSIS
# ============================================================================

def generate_time_series(events: List[Dict], days: int = 30) -> List[Dict]:
    """Generate time series data for visualization."""
    cutoff = datetime.now() - timedelta(days=days)

    buckets = defaultdict(lambda: {'total': 0, 'critical': 0, 'high': 0, 'medium': 0, 'low': 0})

    for event in events:
        date_str = event.get('created_at', event.get('date', ''))
        try:
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            if dt >= cutoff:
                bucket_key = dt.strftime('%Y-%m-%d')
            else:
                continue
        except (ValueError, TypeError):
            continue

        buckets[bucket_key]['total'] += 1
        severity = event.get('severity', 'medium')
        buckets[bucket_key][severity] += 1

    # Convert to sorted list
    time_series = []
    for date in sorted(buckets.keys()):
        entry = {'date': date, **buckets[date]}
        # Add calendar context
        try:
            dt = datetime.strptime(date, '%Y-%m-%d')
            holiday_context = get_holiday_context(dt)
            if holiday_context:
                entry['calendarContext'] = holiday_context
        except (ValueError, TypeError):
            pass
        time_series.append(entry)

    return time_series

# ============================================================================
# THERMAL CHANGE DETECTION
# ============================================================================

def detect_thermal_changes(current_fires: List[Dict], previous_fires: List[Dict]) -> Dict:
    """Detect changes in thermal/fire patterns."""
    change = detect_change(current_fires, previous_fires)

    # Calculate intensity change
    current_avg_frp = sum(f.get('fire_radiative_power', 0) for f in current_fires) / max(1, len(current_fires))
    previous_avg_frp = sum(f.get('fire_radiative_power', 0) for f in previous_fires) / max(1, len(previous_fires))

    frp_change = ((current_avg_frp - previous_avg_frp) / max(1, previous_avg_frp)) * 100 if previous_avg_frp > 0 else 100

    # New hotspots
    new_hotspots = [f for f in current_fires if f.get('fire_radiative_power', 0) > 50][:5]

    return {
        **change,
        'intensityChange': round(frp_change, 1),
        'newHotspots': new_hotspots,
        'currentCount': len(current_fires),
        'previousCount': len(previous_fires)
    }

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def process_temporal_analysis(events: List[Dict], thermal_data: Optional[List[Dict]] = None,
                              data_source: str = "live") -> Dict:
    """Process all temporal analysis.
    Args:
        events: List of event dictionaries
        thermal_data: Optional thermal/fire data for change detection
        data_source: "live" or "mock" -- propagated to output per R14
    """
    anomalies = detect_anomalies(events)
    changepoints = detect_temporal_changepoints(events)
    trend = calculate_trend(events)
    time_series = generate_time_series(events)
    aggregated = aggregate_by_time(events, 'day')

    result = {
        'module': 'chronos',
        'version': '2.0.0',
        'data_source': data_source,
        'anomalies': anomalies,
        'changepoints': changepoints,
        'trend': trend,
        'timeSeries': time_series[-30:],  # Last 30 days
        'aggregation': {k: len(v) for k, v in aggregated.items()},
        'summary': {
            'totalEvents': len(events),
            'dateRange': f"{min(aggregated.keys(), default='N/A')} to {max(aggregated.keys(), default='N/A')}",
            'peakDay': max(aggregated.items(), key=lambda x: len(x[1]))[0] if aggregated else None,
            'anomalyDays': len(anomalies),
            'changepointsDetected': len(changepoints)
        }
    }

    # Add thermal analysis if available
    if thermal_data:
        result['thermalChanges'] = detect_thermal_changes(thermal_data, [])

    return result

# ============================================================================
# STDIN/STDOUT PROTOCOL (per architecture contract)
# ============================================================================

def main():
    """Entry point for module stdin/stdout protocol."""
    try:
        input_data = json.loads(sys.stdin.read())
        events = input_data.get('events', [])
        config = input_data.get('config', {})

        data_source = config.get('dataSource', 'live')
        days = config.get('days', 7)

        import time
        start = time.time()
        result = process_temporal_analysis(events, data_source=data_source)
        duration_ms = int((time.time() - start) * 1000)

        output = {
            'module': 'chronos',
            'version': '2.0.0',
            'dataSource': data_source,
            'data': result,
            'durationMs': duration_ms,
            'error': None
        }

        json.dump(output, sys.stdout)
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"CHRONOS: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"CHRONOS: Missing required field: {e}", file=sys.stderr)
        sys.exit(1)
    except (IOError, OSError) as e:
        print(f"CHRONOS: I/O error: {e}", file=sys.stderr)
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
        logger.error(f"CHRONOS: Failed to parse incidents.json: {e}")
        incidents = []

    days = int(request.args.get('days', 7))

    result = process_temporal_analysis(incidents, data_source="live")

    return jsonify(result)

if __name__ == '__main__':
    main()
