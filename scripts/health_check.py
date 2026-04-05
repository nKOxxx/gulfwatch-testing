#!/usr/bin/env python3
"""
Health Check System for Gulf Watch v2
Checks database connectivity, feed freshness, API health, and resource utilization.

Priya Nakamura -- Backend Reliability
"""

import json
import logging
import os
import platform
import socket
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger("gulfwatch.health")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_DB_HOST = os.environ.get("GW_DB_HOST", "localhost")
DEFAULT_DB_PORT = int(os.environ.get("GW_DB_PORT", "5432"))
DEFAULT_DB_NAME = os.environ.get("GW_DB_NAME", "gulfwatch")
DEFAULT_API_BASE = os.environ.get("GW_API_BASE", "http://localhost:3001")
DEFAULT_REDIS_HOST = os.environ.get("GW_REDIS_HOST", "localhost")
DEFAULT_REDIS_PORT = int(os.environ.get("GW_REDIS_PORT", "6379"))

# Feed staleness threshold (seconds)
FEED_STALENESS_THRESHOLD = 30 * 60  # 30 minutes per architecture spec

# Resource utilization thresholds
MEMORY_WARNING_PERCENT = 80
MEMORY_CRITICAL_PERCENT = 95
CPU_WARNING_PERCENT = 80
CPU_CRITICAL_PERCENT = 95
DISK_WARNING_PERCENT = 85
DISK_CRITICAL_PERCENT = 95


# ---------------------------------------------------------------------------
# Individual health checks
# ---------------------------------------------------------------------------

class HealthStatus:
    """Constants for health check status."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


def check_database(
    host: str = DEFAULT_DB_HOST,
    port: int = DEFAULT_DB_PORT,
    db_name: str = DEFAULT_DB_NAME,
    db_connection=None,
    timeout: float = 5.0,
) -> Dict[str, Any]:
    """
    Check PostgreSQL database connectivity and basic health.

    Returns:
        {
            "status": "healthy" | "degraded" | "unhealthy",
            "latency_ms": float,
            "details": { ... }
        }
    """
    start = time.monotonic()

    # If a live connection is provided, use it
    if db_connection is not None:
        try:
            cursor = db_connection.cursor()
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            cursor.close()
            latency = (time.monotonic() - start) * 1000

            # Check table counts
            details = {"connection": "live", "query_result": result[0] if result else None}
            try:
                cursor = db_connection.cursor()
                cursor.execute(
                    "SELECT relname, n_live_tup FROM pg_stat_user_tables "
                    "WHERE schemaname = 'public' ORDER BY n_live_tup DESC LIMIT 10"
                )
                tables = [{"table": r[0], "rows": r[1]} for r in cursor.fetchall()]
                cursor.close()
                details["tables"] = tables
            except Exception:
                details["tables"] = []

            status = HealthStatus.HEALTHY if latency < 500 else HealthStatus.DEGRADED
            return {"status": status, "latency_ms": round(latency, 2), "details": details}
        except Exception as e:
            latency = (time.monotonic() - start) * 1000
            return {
                "status": HealthStatus.UNHEALTHY,
                "latency_ms": round(latency, 2),
                "details": {"error": str(e)},
            }

    # TCP connectivity check (no psycopg2 required)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.close()
        latency = (time.monotonic() - start) * 1000

        status = HealthStatus.HEALTHY if latency < 200 else HealthStatus.DEGRADED
        return {
            "status": status,
            "latency_ms": round(latency, 2),
            "details": {"host": host, "port": port, "db_name": db_name, "method": "tcp"},
        }
    except socket.timeout:
        return {
            "status": HealthStatus.UNHEALTHY,
            "latency_ms": timeout * 1000,
            "details": {"error": "Connection timeout", "host": host, "port": port},
        }
    except Exception as e:
        latency = (time.monotonic() - start) * 1000
        return {
            "status": HealthStatus.UNHEALTHY,
            "latency_ms": round(latency, 2),
            "details": {"error": str(e), "host": host, "port": port},
        }


def check_redis(
    host: str = DEFAULT_REDIS_HOST,
    port: int = DEFAULT_REDIS_PORT,
    timeout: float = 3.0,
) -> Dict[str, Any]:
    """
    Check Redis connectivity.

    Returns:
        { "status": ..., "latency_ms": ..., "details": { ... } }
    """
    start = time.monotonic()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        # Send PING command
        sock.sendall(b"*1\r\n$4\r\nPING\r\n")
        response = sock.recv(64)
        sock.close()
        latency = (time.monotonic() - start) * 1000

        is_pong = b"PONG" in response
        status = HealthStatus.HEALTHY if is_pong and latency < 100 else HealthStatus.DEGRADED
        return {
            "status": status,
            "latency_ms": round(latency, 2),
            "details": {"host": host, "port": port, "pong": is_pong},
        }
    except Exception as e:
        latency = (time.monotonic() - start) * 1000
        return {
            "status": HealthStatus.UNHEALTHY,
            "latency_ms": round(latency, 2),
            "details": {"error": str(e), "host": host, "port": port},
        }


def check_feed_freshness(
    db_connection=None,
    staleness_threshold: int = FEED_STALENESS_THRESHOLD,
    last_ingested_at: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Check RSS/data feed freshness. Alert if data is older than threshold.

    Args:
        db_connection: Optional database connection.
        staleness_threshold: Seconds after which data is considered stale (default 30 min).
        last_ingested_at: ISO timestamp of the last ingested event (fallback if no DB).

    Returns:
        { "status": ..., "staleness_seconds": ..., "details": { ... } }
    """
    now = datetime.now(timezone.utc)

    # Try DB first
    if db_connection is not None:
        try:
            cursor = db_connection.cursor()
            cursor.execute("SELECT MAX(ingested_at) FROM incidents")
            row = cursor.fetchone()
            cursor.close()
            if row and row[0]:
                last_ts = row[0]
                if not hasattr(last_ts, "tzinfo") or last_ts.tzinfo is None:
                    last_ts = last_ts.replace(tzinfo=timezone.utc)
                staleness = (now - last_ts).total_seconds()
                return _build_feed_result(staleness, staleness_threshold, str(last_ts))
        except Exception as e:
            logger.warning("Could not query feed freshness from DB: %s", e)

    # Fallback to provided timestamp
    if last_ingested_at:
        try:
            last_ts = datetime.fromisoformat(last_ingested_at.replace("Z", "+00:00"))
            staleness = (now - last_ts).total_seconds()
            return _build_feed_result(staleness, staleness_threshold, last_ingested_at)
        except Exception as e:
            return {
                "status": HealthStatus.UNHEALTHY,
                "staleness_seconds": None,
                "details": {"error": f"Invalid timestamp: {e}"},
            }

    # No data available
    return {
        "status": HealthStatus.UNHEALTHY,
        "staleness_seconds": None,
        "details": {"error": "No feed data available", "threshold_seconds": staleness_threshold},
    }


def _build_feed_result(
    staleness: float, threshold: int, last_timestamp: str
) -> Dict[str, Any]:
    """Build feed freshness result."""
    if staleness <= threshold:
        status = HealthStatus.HEALTHY
    elif staleness <= threshold * 2:
        status = HealthStatus.DEGRADED
    else:
        status = HealthStatus.UNHEALTHY

    return {
        "status": status,
        "staleness_seconds": round(staleness),
        "details": {
            "last_ingested_at": last_timestamp,
            "threshold_seconds": threshold,
            "is_stale": staleness > threshold,
        },
    }


def check_api_health(
    base_url: str = DEFAULT_API_BASE,
    timeout: float = 5.0,
) -> Dict[str, Any]:
    """
    Check API endpoint health by hitting the health endpoint.

    Returns:
        { "status": ..., "latency_ms": ..., "details": { ... } }
    """
    import urllib.request
    import urllib.error

    url = f"{base_url}/v1/admin/system/health"
    start = time.monotonic()

    try:
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "GulfWatch-HealthCheck/2.0")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            latency = (time.monotonic() - start) * 1000
            status_code = resp.status
            body = resp.read().decode("utf-8", errors="replace")

            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                data = {"raw": body[:500]}

            status = HealthStatus.HEALTHY if 200 <= status_code < 300 else HealthStatus.DEGRADED
            return {
                "status": status,
                "latency_ms": round(latency, 2),
                "details": {"status_code": status_code, "response": data},
            }
    except urllib.error.HTTPError as e:
        latency = (time.monotonic() - start) * 1000
        return {
            "status": HealthStatus.DEGRADED if e.code < 500 else HealthStatus.UNHEALTHY,
            "latency_ms": round(latency, 2),
            "details": {"status_code": e.code, "error": str(e)},
        }
    except Exception as e:
        latency = (time.monotonic() - start) * 1000
        return {
            "status": HealthStatus.UNHEALTHY,
            "latency_ms": round(latency, 2),
            "details": {"error": str(e), "url": url},
        }


def check_resource_utilization() -> Dict[str, Any]:
    """
    Check system resource utilization (memory, CPU, disk).

    Returns:
        {
            "status": ...,
            "memory": { "percent": ..., "status": ... },
            "cpu": { "percent": ..., "status": ... },
            "disk": { "percent": ..., "status": ... }
        }
    """
    result = {
        "status": HealthStatus.HEALTHY,
        "memory": {"percent": None, "status": HealthStatus.HEALTHY},
        "cpu": {"percent": None, "status": HealthStatus.HEALTHY},
        "disk": {"percent": None, "status": HealthStatus.HEALTHY},
    }

    # Memory
    try:
        import psutil

        mem = psutil.virtual_memory()
        result["memory"]["percent"] = mem.percent
        result["memory"]["total_gb"] = round(mem.total / (1024**3), 2)
        result["memory"]["available_gb"] = round(mem.available / (1024**3), 2)

        if mem.percent >= MEMORY_CRITICAL_PERCENT:
            result["memory"]["status"] = HealthStatus.UNHEALTHY
        elif mem.percent >= MEMORY_WARNING_PERCENT:
            result["memory"]["status"] = HealthStatus.DEGRADED
    except ImportError:
        # psutil not available -- try /proc/meminfo on Linux
        try:
            with open("/proc/meminfo") as f:
                lines = f.readlines()
            meminfo = {}
            for line in lines:
                parts = line.split(":")
                if len(parts) == 2:
                    meminfo[parts[0].strip()] = int(parts[1].strip().split()[0])
            total = meminfo.get("MemTotal", 1)
            available = meminfo.get("MemAvailable", total)
            pct = round((1 - available / total) * 100, 1)
            result["memory"]["percent"] = pct
            if pct >= MEMORY_CRITICAL_PERCENT:
                result["memory"]["status"] = HealthStatus.UNHEALTHY
            elif pct >= MEMORY_WARNING_PERCENT:
                result["memory"]["status"] = HealthStatus.DEGRADED
        except Exception:
            result["memory"]["status"] = HealthStatus.DEGRADED
            result["memory"]["error"] = "Cannot read memory info (psutil not installed)"

    # CPU
    try:
        import psutil

        cpu_pct = psutil.cpu_percent(interval=0.5)
        result["cpu"]["percent"] = cpu_pct
        result["cpu"]["count"] = psutil.cpu_count()

        if cpu_pct >= CPU_CRITICAL_PERCENT:
            result["cpu"]["status"] = HealthStatus.UNHEALTHY
        elif cpu_pct >= CPU_WARNING_PERCENT:
            result["cpu"]["status"] = HealthStatus.DEGRADED
    except ImportError:
        # Fallback: use os.getloadavg on Unix
        try:
            load1, load5, load15 = os.getloadavg()
            cpu_count = os.cpu_count() or 1
            load_pct = round((load1 / cpu_count) * 100, 1)
            result["cpu"]["percent"] = load_pct
            result["cpu"]["load_avg_1m"] = load1
            if load_pct >= CPU_CRITICAL_PERCENT:
                result["cpu"]["status"] = HealthStatus.UNHEALTHY
            elif load_pct >= CPU_WARNING_PERCENT:
                result["cpu"]["status"] = HealthStatus.DEGRADED
        except Exception:
            result["cpu"]["status"] = HealthStatus.DEGRADED
            result["cpu"]["error"] = "Cannot read CPU info"

    # Disk
    try:
        import shutil

        usage = shutil.disk_usage("/")
        pct = round((usage.used / usage.total) * 100, 1)
        result["disk"]["percent"] = pct
        result["disk"]["total_gb"] = round(usage.total / (1024**3), 2)
        result["disk"]["free_gb"] = round(usage.free / (1024**3), 2)

        if pct >= DISK_CRITICAL_PERCENT:
            result["disk"]["status"] = HealthStatus.UNHEALTHY
        elif pct >= DISK_WARNING_PERCENT:
            result["disk"]["status"] = HealthStatus.DEGRADED
    except Exception:
        result["disk"]["status"] = HealthStatus.DEGRADED
        result["disk"]["error"] = "Cannot read disk info"

    # Overall status
    statuses = [
        result["memory"]["status"],
        result["cpu"]["status"],
        result["disk"]["status"],
    ]
    if HealthStatus.UNHEALTHY in statuses:
        result["status"] = HealthStatus.UNHEALTHY
    elif HealthStatus.DEGRADED in statuses:
        result["status"] = HealthStatus.DEGRADED

    return result


# ---------------------------------------------------------------------------
# Full health report
# ---------------------------------------------------------------------------

def run_health_check(
    db_connection=None,
    api_base: str = DEFAULT_API_BASE,
    redis_host: str = DEFAULT_REDIS_HOST,
    redis_port: int = DEFAULT_REDIS_PORT,
    last_ingested_at: Optional[str] = None,
    check_api: bool = True,
    check_redis_flag: bool = True,
) -> Dict[str, Any]:
    """
    Run all health checks and return a structured JSON report.

    Returns:
        {
            "status": "healthy" | "degraded" | "unhealthy",
            "timestamp": "...",
            "hostname": "...",
            "checks": {
                "database": { ... },
                "redis": { ... },
                "feed_freshness": { ... },
                "api": { ... },
                "resources": { ... }
            }
        }
    """
    checks = {}

    # Database
    checks["database"] = check_database(db_connection=db_connection)

    # Redis
    if check_redis_flag:
        checks["redis"] = check_redis(host=redis_host, port=redis_port)

    # Feed freshness
    checks["feed_freshness"] = check_feed_freshness(
        db_connection=db_connection,
        last_ingested_at=last_ingested_at,
    )

    # API
    if check_api:
        checks["api"] = check_api_health(base_url=api_base)

    # Resources
    checks["resources"] = check_resource_utilization()

    # Overall status
    all_statuses = [c["status"] for c in checks.values()]
    if HealthStatus.UNHEALTHY in all_statuses:
        overall = HealthStatus.UNHEALTHY
    elif HealthStatus.DEGRADED in all_statuses:
        overall = HealthStatus.DEGRADED
    else:
        overall = HealthStatus.HEALTHY

    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "checks": checks,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    report = run_health_check(
        check_api=False,       # Skip API check in standalone mode
        check_redis_flag=False, # Skip Redis check in standalone mode
    )
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["status"] == HealthStatus.HEALTHY else 1)
