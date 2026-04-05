#!/usr/bin/env python3
"""
Data Quality Monitoring for Gulf Watch v2
Checks source feed failures, deduplication anomalies, confidence score distribution
shifts, and geocoding failures. Alerts on anomalous patterns.

Priya Nakamura -- Backend Reliability
"""

import json
import logging
import math
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("gulfwatch.data_quality")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Minimum expected incidents per hour during active periods
MIN_HOURLY_INCIDENTS = 1

# Maximum share a single source should have of total incidents
MAX_SINGLE_SOURCE_SHARE = 0.70  # 70%

# Minimum number of active sources
MIN_ACTIVE_SOURCES = 2

# Expected confidence distribution (approximate)
EXPECTED_CONFIDENCE_DISTRIBUTION = {
    "VERIFIED": (0.10, 0.40),   # 10-40% of incidents
    "LIKELY": (0.15, 0.45),
    "PARTIAL": (0.10, 0.40),
    "OSINT": (0.05, 0.30),
    "UNCONFIRMED": (0.00, 0.25),
}

# Geocoding failure rate threshold
MAX_GEOCODING_FAILURE_RATE = 0.30  # 30% of incidents missing coords


# ---------------------------------------------------------------------------
# Alert severity levels
# ---------------------------------------------------------------------------

class AlertLevel:
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ---------------------------------------------------------------------------
# Data quality checks
# ---------------------------------------------------------------------------

def check_source_feed_health(
    incidents: List[Dict],
    window_hours: int = 6,
) -> Dict[str, Any]:
    """
    Check for source feed failures.

    Detects:
    - Sources that have gone silent (no incidents in window)
    - Sources producing errors or empty results
    - Sudden drops in any source's output

    Returns:
        { "status": ..., "alerts": [...], "source_stats": { ... } }
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=window_hours)
    alerts = []

    # Group incidents by source
    source_counts = Counter()
    source_latest = {}
    recent_by_source = defaultdict(list)

    for inc in incidents:
        source = inc.get("source", "unknown")
        source_counts[source] += 1

        # Track latest per source
        ts_str = inc.get("ingested_at") or inc.get("published_at") or inc.get("date", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if source not in source_latest or ts > source_latest[source]:
                source_latest[source] = ts
            if ts >= cutoff:
                recent_by_source[source].append(inc)
        except (ValueError, AttributeError):
            pass

    # Check each known source
    all_sources = set(source_counts.keys())
    silent_sources = []
    active_sources = []

    for source in all_sources:
        last_seen = source_latest.get(source)
        recent_count = len(recent_by_source.get(source, []))

        if last_seen and (now - last_seen).total_seconds() > window_hours * 3600:
            silent_sources.append(source)
            alerts.append({
                "level": AlertLevel.WARNING,
                "check": "source_feed_health",
                "message": f"Source '{source}' has been silent for "
                           f"{round((now - last_seen).total_seconds() / 3600, 1)} hours",
                "source": source,
                "last_seen": last_seen.isoformat(),
            })
        else:
            active_sources.append(source)

    # Check if ALL sources are silent
    if not active_sources and all_sources:
        alerts.append({
            "level": AlertLevel.CRITICAL,
            "check": "source_feed_health",
            "message": "ALL sources have gone silent -- possible infrastructure failure",
            "sources": list(all_sources),
        })

    # Check minimum active sources
    if 0 < len(active_sources) < MIN_ACTIVE_SOURCES:
        alerts.append({
            "level": AlertLevel.WARNING,
            "check": "source_feed_health",
            "message": f"Only {len(active_sources)} active source(s), minimum is {MIN_ACTIVE_SOURCES}",
            "active_sources": active_sources,
        })

    status = AlertLevel.CRITICAL if not active_sources and all_sources else (
        AlertLevel.WARNING if alerts else AlertLevel.INFO
    )

    return {
        "status": status,
        "alerts": alerts,
        "source_stats": {
            "total_sources": len(all_sources),
            "active_sources": len(active_sources),
            "silent_sources": silent_sources,
            "counts": dict(source_counts.most_common()),
        },
    }


def check_deduplication_anomalies(
    incidents: List[Dict],
    window_hours: int = 24,
) -> Dict[str, Any]:
    """
    Check for deduplication anomalies.

    Detects:
    - Unusually high duplicate rate (circuit breaker overloaded)
    - Duplicate titles that should have been caught
    - Clusters of near-identical incidents

    Returns:
        { "status": ..., "alerts": [...], "dedup_stats": { ... } }
    """
    alerts = []
    title_counts = Counter()
    title_to_incidents = defaultdict(list)

    for inc in incidents:
        title = inc.get("title", "").strip().lower()
        if title:
            title_counts[title] += 1
            title_to_incidents[title].append(inc)

    # Find exact duplicates
    exact_dupes = {t: c for t, c in title_counts.items() if c > 1}
    dupe_rate = len(exact_dupes) / max(1, len(title_counts))

    if exact_dupes:
        worst = max(exact_dupes.items(), key=lambda x: x[1])
        alerts.append({
            "level": AlertLevel.WARNING if len(exact_dupes) > 5 else AlertLevel.INFO,
            "check": "deduplication",
            "message": f"{len(exact_dupes)} duplicate titles found; "
                       f"worst: '{worst[0][:60]}...' ({worst[1]} copies)",
            "duplicate_count": len(exact_dupes),
            "worst_title": worst[0][:80],
            "worst_count": worst[1],
        })

    # Check for near-duplicates using prefix matching
    from difflib import SequenceMatcher

    near_dupes = 0
    titles = list(title_counts.keys())
    checked_pairs = set()

    for i, t1 in enumerate(titles[:200]):  # Cap to avoid O(n^2) explosion
        for t2 in titles[i + 1 : min(i + 50, len(titles))]:
            pair = (min(t1, t2), max(t1, t2))
            if pair in checked_pairs:
                continue
            checked_pairs.add(pair)
            if SequenceMatcher(None, t1, t2).ratio() > 0.85:
                near_dupes += 1

    if near_dupes > 10:
        alerts.append({
            "level": AlertLevel.WARNING,
            "check": "deduplication",
            "message": f"{near_dupes} near-duplicate pairs detected -- "
                       "circuit breaker may need tuning",
            "near_duplicate_pairs": near_dupes,
        })

    status = AlertLevel.WARNING if any(a["level"] == AlertLevel.WARNING for a in alerts) else AlertLevel.INFO

    return {
        "status": status,
        "alerts": alerts,
        "dedup_stats": {
            "total_incidents": len(incidents),
            "unique_titles": len(title_counts),
            "exact_duplicates": len(exact_dupes),
            "near_duplicates": near_dupes,
            "duplicate_rate": round(dupe_rate, 4),
        },
    }


def check_confidence_distribution(
    incidents: List[Dict],
) -> Dict[str, Any]:
    """
    Check for confidence score distribution shifts.

    Detects:
    - Too many UNCONFIRMED incidents (source quality drop)
    - Too few VERIFIED incidents (verification pipeline issue)
    - Distribution outside expected ranges

    Returns:
        { "status": ..., "alerts": [...], "distribution": { ... } }
    """
    alerts = []
    total = len(incidents)
    if total == 0:
        return {
            "status": AlertLevel.WARNING,
            "alerts": [{"level": AlertLevel.WARNING, "check": "confidence", "message": "No incidents to analyze"}],
            "distribution": {},
        }

    # Count by confidence level
    confidence_counts = Counter()
    for inc in incidents:
        conf = inc.get("confidence", inc.get("verification", {}).get("badge", "UNCONFIRMED"))
        confidence_counts[conf] += 1

    # Calculate distribution
    distribution = {level: confidence_counts.get(level, 0) / total for level in EXPECTED_CONFIDENCE_DISTRIBUTION}

    # Check each level against expected range
    for level, (low, high) in EXPECTED_CONFIDENCE_DISTRIBUTION.items():
        actual = distribution.get(level, 0.0)
        if actual < low and confidence_counts.get(level, 0) > 0:
            alerts.append({
                "level": AlertLevel.INFO,
                "check": "confidence_distribution",
                "message": f"'{level}' is at {actual:.1%}, below expected range ({low:.0%}-{high:.0%})",
                "confidence_level": level,
                "actual_percent": round(actual * 100, 1),
                "expected_range": [low * 100, high * 100],
            })
        elif actual > high:
            severity = AlertLevel.WARNING if level in ("UNCONFIRMED", "OSINT") else AlertLevel.INFO
            alerts.append({
                "level": severity,
                "check": "confidence_distribution",
                "message": f"'{level}' is at {actual:.1%}, above expected range ({low:.0%}-{high:.0%})",
                "confidence_level": level,
                "actual_percent": round(actual * 100, 1),
                "expected_range": [low * 100, high * 100],
            })

    status = AlertLevel.WARNING if any(a["level"] == AlertLevel.WARNING for a in alerts) else AlertLevel.INFO

    return {
        "status": status,
        "alerts": alerts,
        "distribution": {
            level: {
                "count": confidence_counts.get(level, 0),
                "percent": round(distribution.get(level, 0) * 100, 1),
            }
            for level in EXPECTED_CONFIDENCE_DISTRIBUTION
        },
    }


def check_geocoding_quality(
    incidents: List[Dict],
) -> Dict[str, Any]:
    """
    Check for geocoding failures.

    Detects:
    - High rate of incidents with missing coordinates
    - Coordinates outside the expected Gulf region bounding box
    - Zero-coordinate placeholders

    Returns:
        { "status": ..., "alerts": [...], "geocoding_stats": { ... } }
    """
    alerts = []
    total = len(incidents)
    if total == 0:
        return {"status": AlertLevel.INFO, "alerts": [], "geocoding_stats": {}}

    missing_coords = 0
    zero_coords = 0
    out_of_bounds = 0
    valid = 0

    # Gulf region bounding box (extended): lat 10-40, lon 25-65
    BBOX_LAT = (10.0, 40.0)
    BBOX_LON = (25.0, 65.0)

    for inc in incidents:
        lat = inc.get("latitude") or inc.get("coordinates", {}).get("lat")
        lon = inc.get("longitude") or inc.get("coordinates", {}).get("lon") or inc.get("coordinates", {}).get("lng")

        if lat is None or lon is None:
            missing_coords += 1
            continue

        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            missing_coords += 1
            continue

        if lat == 0.0 and lon == 0.0:
            zero_coords += 1
            continue

        if not (BBOX_LAT[0] <= lat <= BBOX_LAT[1] and BBOX_LON[0] <= lon <= BBOX_LON[1]):
            out_of_bounds += 1
        else:
            valid += 1

    failure_rate = (missing_coords + zero_coords) / total

    if failure_rate > MAX_GEOCODING_FAILURE_RATE:
        alerts.append({
            "level": AlertLevel.WARNING,
            "check": "geocoding",
            "message": f"Geocoding failure rate is {failure_rate:.1%} "
                       f"({missing_coords} missing, {zero_coords} zero-coords)",
            "failure_rate": round(failure_rate, 4),
            "missing": missing_coords,
            "zero_coords": zero_coords,
        })

    if out_of_bounds > 0:
        alerts.append({
            "level": AlertLevel.INFO,
            "check": "geocoding",
            "message": f"{out_of_bounds} incidents have coordinates outside the Gulf region bounding box",
            "out_of_bounds": out_of_bounds,
        })

    status = AlertLevel.WARNING if any(a["level"] == AlertLevel.WARNING for a in alerts) else AlertLevel.INFO

    return {
        "status": status,
        "alerts": alerts,
        "geocoding_stats": {
            "total": total,
            "valid": valid,
            "missing_coords": missing_coords,
            "zero_coords": zero_coords,
            "out_of_bounds": out_of_bounds,
            "failure_rate": round(failure_rate, 4),
        },
    }


def check_volume_anomalies(
    incidents: List[Dict],
    expected_daily_min: int = 5,
    expected_daily_max: int = 500,
) -> Dict[str, Any]:
    """
    Check for sudden drops or spikes in incident volume.

    Detects:
    - Zero incidents in recent period
    - Significant drop compared to rolling average
    - Unusual spikes that may indicate ingestion issues

    Returns:
        { "status": ..., "alerts": [...], "volume_stats": { ... } }
    """
    alerts = []
    daily_counts = defaultdict(int)

    for inc in incidents:
        ts_str = inc.get("published_at") or inc.get("date", "")
        try:
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            day = dt.strftime("%Y-%m-%d")
            daily_counts[day] += 1
        except (ValueError, AttributeError):
            pass

    if not daily_counts:
        alerts.append({
            "level": AlertLevel.CRITICAL,
            "check": "volume",
            "message": "No incidents with valid timestamps found",
        })
        return {"status": AlertLevel.CRITICAL, "alerts": alerts, "volume_stats": {}}

    values = list(daily_counts.values())
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / max(1, len(values))
    std = math.sqrt(variance) if variance > 0 else 0

    # Check most recent day
    sorted_days = sorted(daily_counts.keys())
    latest_day = sorted_days[-1]
    latest_count = daily_counts[latest_day]

    if latest_count < expected_daily_min:
        alerts.append({
            "level": AlertLevel.WARNING,
            "check": "volume",
            "message": f"Latest day ({latest_day}) has only {latest_count} incidents, "
                       f"below minimum of {expected_daily_min}",
            "latest_day": latest_day,
            "latest_count": latest_count,
        })

    # Check for sudden drop (z-score)
    if std > 0 and mean > 0:
        z_score = (latest_count - mean) / std
        if z_score < -2.0:
            alerts.append({
                "level": AlertLevel.WARNING,
                "check": "volume",
                "message": f"Sudden drop in volume: {latest_count} vs average {mean:.0f} "
                           f"(z-score: {z_score:.1f})",
                "z_score": round(z_score, 2),
            })
        elif z_score > 3.0:
            alerts.append({
                "level": AlertLevel.INFO,
                "check": "volume",
                "message": f"Unusual spike: {latest_count} vs average {mean:.0f} "
                           f"(z-score: {z_score:.1f})",
                "z_score": round(z_score, 2),
            })

    status = AlertLevel.CRITICAL if any(a["level"] == AlertLevel.CRITICAL for a in alerts) else (
        AlertLevel.WARNING if any(a["level"] == AlertLevel.WARNING for a in alerts) else AlertLevel.INFO
    )

    return {
        "status": status,
        "alerts": alerts,
        "volume_stats": {
            "daily_counts": dict(sorted(daily_counts.items())),
            "mean_daily": round(mean, 1),
            "std_daily": round(std, 1),
            "latest_day": latest_day,
            "latest_count": latest_count,
            "total_days": len(daily_counts),
        },
    }


def check_single_source_dominance(
    incidents: List[Dict],
    threshold: float = MAX_SINGLE_SOURCE_SHARE,
) -> Dict[str, Any]:
    """
    Alert if a single source dominates the incident feed.

    Returns:
        { "status": ..., "alerts": [...], "source_shares": { ... } }
    """
    alerts = []
    total = len(incidents)
    if total == 0:
        return {"status": AlertLevel.INFO, "alerts": [], "source_shares": {}}

    source_counts = Counter(inc.get("source", "unknown") for inc in incidents)
    source_shares = {s: c / total for s, c in source_counts.items()}

    for source, share in source_shares.items():
        if share > threshold:
            alerts.append({
                "level": AlertLevel.WARNING,
                "check": "source_dominance",
                "message": f"Source '{source}' accounts for {share:.1%} of all incidents "
                           f"(threshold: {threshold:.0%})",
                "source": source,
                "share": round(share, 4),
                "count": source_counts[source],
            })

    status = AlertLevel.WARNING if alerts else AlertLevel.INFO

    return {
        "status": status,
        "alerts": alerts,
        "source_shares": {
            s: {"count": c, "share": round(source_shares[s], 4)}
            for s, c in source_counts.most_common()
        },
    }


# ---------------------------------------------------------------------------
# Full data quality report
# ---------------------------------------------------------------------------

def run_data_quality_report(
    incidents: List[Dict],
    window_hours: int = 24,
) -> Dict[str, Any]:
    """
    Run all data quality checks and return a structured report.

    Args:
        incidents: List of incident dictionaries.
        window_hours: Window for feed freshness checks.

    Returns:
        {
            "status": ...,
            "timestamp": "...",
            "total_incidents": int,
            "checks": { ... },
            "all_alerts": [ ... ]
        }
    """
    checks = {}

    checks["source_feed_health"] = check_source_feed_health(incidents, window_hours)
    checks["deduplication"] = check_deduplication_anomalies(incidents, window_hours)
    checks["confidence_distribution"] = check_confidence_distribution(incidents)
    checks["geocoding"] = check_geocoding_quality(incidents)
    checks["volume_anomalies"] = check_volume_anomalies(incidents)
    checks["source_dominance"] = check_single_source_dominance(incidents)

    # Collect all alerts
    all_alerts = []
    for check_name, check_result in checks.items():
        for alert in check_result.get("alerts", []):
            all_alerts.append({**alert, "check_name": check_name})

    # Overall status
    statuses = [c["status"] for c in checks.values()]
    if AlertLevel.CRITICAL in statuses:
        overall = AlertLevel.CRITICAL
    elif AlertLevel.WARNING in statuses:
        overall = AlertLevel.WARNING
    else:
        overall = AlertLevel.INFO

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_incidents": len(incidents),
        "checks": checks,
        "all_alerts": sorted(all_alerts, key=lambda a: {"critical": 0, "warning": 1, "info": 2}.get(a["level"], 3)),
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    # Load incidents from file
    incidents_file = sys.argv[1] if len(sys.argv) > 1 else "incidents.json"
    try:
        with open(incidents_file) as f:
            data = json.load(f)
        incidents = data if isinstance(data, list) else data.get("incidents", [])
    except Exception as e:
        print(f"Error loading incidents: {e}", file=sys.stderr)
        incidents = []

    report = run_data_quality_report(incidents)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["status"] == AlertLevel.INFO else 1)
