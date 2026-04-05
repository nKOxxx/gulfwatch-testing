#!/usr/bin/env python3
"""
Gulf Watch v2 -- Real-Time Ingestion Worker
Author: Rena Oduya, Backend Core

Replaces the 12hr GitHub Actions cron with a persistent worker that:
- Polls HIGH-priority RSS sources every 2 minutes
- Polls LOW-priority RSS sources every 15 minutes
- Deduplicates via SHA-256 (exact) and fuzzy matching (near-duplicate)
- Runs events through the enrichment pipeline (BABEL -> ARGUS -> CHATTER
  -> CHRONOS -> IGNITE -> SKYLINE)
- Writes enriched incidents to PostgreSQL (not JSON files)
- Publishes events to Redis for WebSocket fan-out

Uses the existing circuit_breaker.py and cross_source_verification.py
from v1, adapted to write to PostgreSQL.

Environment:
    GW_DB_HOST / GW_DB_PORT / GW_DB_NAME / GW_DB_USER / GW_DB_PASSWORD
    GW_REDIS_URL           Redis connection string (default: redis://localhost:6379)
    GW_DATA_SOURCE         'live' or 'mock' (R14 compliance)
    GW_LOG_LEVEL           Logging level (default: INFO)
    GW_POLL_HIGH_SEC       High-priority poll interval in seconds (default: 120)
    GW_POLL_LOW_SEC        Low-priority poll interval in seconds (default: 900)
"""

import hashlib
import json
import logging
import os
import signal
import sys
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import feedparser
import psycopg2
import psycopg2.extras
import redis

# ---------------------------------------------------------------------------
# Imports from existing Gulf Watch v1 modules (adapted)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from circuit_breaker import CircuitBreaker
from cross_source_verification import CrossSourceVerification

# ---------------------------------------------------------------------------
# Sibling package: db connection
# ---------------------------------------------------------------------------
DB_DIR = SCRIPT_DIR.parent / "db"
sys.path.insert(0, str(DB_DIR))

from connection import get_pool, write_audit_log, DatabasePool

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("GW_LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("gulfwatch.ingest")

REDIS_URL = os.environ.get("GW_REDIS_URL", "redis://localhost:6379/0")
DATA_SOURCE = os.environ.get("GW_DATA_SOURCE", "live")
POLL_HIGH_SEC = int(os.environ.get("GW_POLL_HIGH_SEC", "120"))   # 2 minutes
POLL_LOW_SEC = int(os.environ.get("GW_POLL_LOW_SEC", "900"))     # 15 minutes

# Redis channel names matching architecture spec
CHANNEL_INCIDENTS = "channel:incidents"
CHANNEL_ALERTS = "channel:alerts"
CHANNEL_THERMAL = "channel:thermal"

# ---------------------------------------------------------------------------
# Feed registry: HIGH = Tier 1-2 (poll every 2 min), LOW = Tier 3+ (15 min)
# ---------------------------------------------------------------------------

HIGH_PRIORITY_FEEDS = [
    # Tier 1 - International
    {"name": "Reuters Middle East", "url": "https://www.reuters.com/news/archive/middleeast.rss", "country": "International", "credibility": 95},
    {"name": "BBC Middle East", "url": "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml", "country": "International", "credibility": 95},
    {"name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml", "country": "Qatar", "credibility": 90},
    # Tier 2 - Gulf Regional
    {"name": "The National UAE", "url": "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", "country": "UAE", "credibility": 85},
    {"name": "Gulf News", "url": "https://gulfnews.com/rss", "country": "UAE", "credibility": 85},
    {"name": "Arab News", "url": "https://www.arabnews.com/rss.xml", "country": "Saudi Arabia", "credibility": 80},
    {"name": "Saudi Press Agency", "url": "https://www.spa.gov.sa/rss", "country": "Saudi Arabia", "credibility": 85},
    # Government feeds (highest priority)
    {"name": "Israel Defense Forces", "url": "https://nitter.net/IDF/rss", "country": "Israel", "credibility": 95, "is_government": True},
    {"name": "UAE NCEMA", "url": "https://nitter.net/NCEMAUAE/rss", "country": "UAE", "credibility": 100, "is_government": True},
]

LOW_PRIORITY_FEEDS = [
    # Tier 3 - Israel/Palestine
    {"name": "Times of Israel", "url": "https://www.timesofisrael.com/feed/", "country": "Israel", "credibility": 85},
    {"name": "Jerusalem Post", "url": "https://www.jpost.com/Rss/RssFeedsHeadlines.aspx", "country": "Israel", "credibility": 85},
    {"name": "Haaretz", "url": "https://www.haaretz.com/rss.xml", "country": "Israel", "credibility": 85},
    # Tier 4 - Defense/Security
    {"name": "Defense News", "url": "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", "country": "International", "credibility": 90},
    {"name": "Breaking Defense", "url": "https://breakingdefense.com/feed/", "country": "International", "credibility": 85},
    # Tier 5 - Egypt/Levant
    {"name": "Egypt Today", "url": "https://www.egypttoday.com/rss", "country": "Egypt", "credibility": 75},
    {"name": "Daily Star Lebanon", "url": "https://www.dailystar.com.lb/rss", "country": "Lebanon", "credibility": 75},
    {"name": "Jordan Times", "url": "https://jordantimes.com/rss", "country": "Jordan", "credibility": 75},
    # Tier 6 - Bahrain, Kuwait, Oman, Qatar
    {"name": "Bahrain News Agency", "url": "https://www.bna.bh/en/rss", "country": "Bahrain", "credibility": 80},
    {"name": "Gulf Daily News", "url": "https://www.gdnonline.com/rss", "country": "Bahrain", "credibility": 75},
    {"name": "Kuwait News Agency", "url": "https://www.kuna.net.kw/rss", "country": "Kuwait", "credibility": 80},
    {"name": "Oman News Agency", "url": "https://www.omanews.gov.om/rss", "country": "Oman", "credibility": 80},
    # Tier 7 - North Africa
    {"name": "Morocco World News", "url": "https://www.moroccoworldnews.com/feed/", "country": "Morocco", "credibility": 70},
]

# Security keywords for relevance filtering (from v1 fetch_rss.py)
SECURITY_KEYWORDS = [
    'missile', 'rocket', 'drone', 'uav', 'air defense', 'interceptor',
    'attack', 'strike', 'explosion', 'blast', 'bomb', 'shelling',
    'siren', 'alert', 'warning', 'evacuation', 'shelter',
    'hostile', 'enemy', 'threat', 'incursion', 'infiltration',
    'casualties', 'killed', 'wounded', 'injured', 'dead',
    'idf', 'hamas', 'hezbollah', 'houthi',
    'iran', 'israel', 'palestine', 'lebanon', 'syria',
    'gulf', 'uae', 'saudi', 'qatar', 'bahrain', 'kuwait', 'oman',
    'yemen', 'iraq', 'jordan', 'egypt', 'turkey',
    'صاروخ', 'طائرة', 'مسيرة', 'هجوم', 'انفجار', 'قصف',
    'تحذير', 'إنذار', 'دفاع', 'عدو',
]

# Location extraction from v1
CITIES = {
    'dubai': ('Dubai', 'AE', 25.2048, 55.2708),
    'abu dhabi': ('Abu Dhabi', 'AE', 24.4539, 54.3773),
    'riyadh': ('Riyadh', 'SA', 24.7136, 46.6753),
    'jeddah': ('Jeddah', 'SA', 21.4858, 39.1925),
    'doha': ('Doha', 'QA', 25.2854, 51.5310),
    'manama': ('Manama', 'BH', 26.2285, 50.5860),
    'kuwait city': ('Kuwait City', 'KW', 29.3759, 47.9774),
    'muscat': ('Muscat', 'OM', 23.5880, 58.3829),
    'tel aviv': ('Tel Aviv', 'IL', 32.0853, 34.7818),
    'jerusalem': ('Jerusalem', 'IL', 31.7683, 35.2137),
    'gaza': ('Gaza', 'PS', 31.5017, 34.4668),
    'beirut': ('Beirut', 'LB', 33.8938, 35.5018),
    'damascus': ('Damascus', 'SY', 33.5138, 36.2765),
    'baghdad': ('Baghdad', 'IQ', 33.3152, 44.3661),
    'cairo': ('Cairo', 'EG', 30.0444, 31.2357),
    'amman': ('Amman', 'JO', 31.9454, 35.9284),
    'tehran': ('Tehran', 'IR', 35.6892, 51.3890),
    'sanaa': ('Sanaa', 'YE', 15.3694, 44.1910),
    'aden': ('Aden', 'YE', 12.7855, 45.0215),
}

COUNTRY_CODES = {
    'uae': 'AE', 'united arab emirates': 'AE', 'saudi arabia': 'SA',
    'saudi': 'SA', 'qatar': 'QA', 'bahrain': 'BH', 'kuwait': 'KW',
    'oman': 'OM', 'israel': 'IL', 'palestine': 'PS', 'lebanon': 'LB',
    'syria': 'SY', 'iraq': 'IQ', 'jordan': 'JO', 'egypt': 'EG',
    'yemen': 'YE', 'iran': 'IR', 'morocco': 'MA', 'tunisia': 'TN',
    'international': None, 'turkey': 'TR',
}


# ---------------------------------------------------------------------------
# Raw Event Schema (normalized form from architecture 7.1 Step 2)
# ---------------------------------------------------------------------------

def normalize_raw_event(entry: Dict, feed: Dict) -> Optional[Dict]:
    """Convert a feedparser entry into the RawEvent schema.
    Returns None if the entry is irrelevant (no security keywords)."""
    title = (entry.get("title") or "").strip()
    description = (entry.get("summary") or entry.get("description") or "").strip()
    link = entry.get("link", "")
    pub_date = entry.get("published_parsed") or entry.get("updated_parsed")

    if not title:
        return None

    # Check relevance: at least one security keyword present
    combined = (title + " " + description).lower()
    if not any(kw in combined for kw in SECURITY_KEYWORDS):
        return None

    # Parse publication date
    if pub_date:
        try:
            published_at = datetime(*pub_date[:6], tzinfo=timezone.utc)
        except Exception:
            published_at = datetime.now(timezone.utc)
    else:
        published_at = datetime.now(timezone.utc)

    # Generate stable source ID from feed name + entry id/link
    source_id_raw = f"{feed['name']}:{entry.get('id', link)}"
    source_id = hashlib.sha256(source_id_raw.encode()).hexdigest()[:32]

    # Extract location
    location = _extract_location(title + " " + description)

    # Map feed country to country code
    feed_country = feed.get("country", "")
    country_code = COUNTRY_CODES.get(feed_country.lower())

    return {
        "source_id": source_id,
        "source": _slugify(feed["name"]),
        "source_url": link,
        "title": title,
        "description": description[:2000] if description else None,
        "published_at": published_at.isoformat(),
        "source_reliability": feed.get("credibility", 50) / 100.0,
        "is_government": feed.get("is_government", False),
        "location": location,
        "country_code": location.get("country_code") if location else country_code,
        "countries": [location["country_code"]] if location and location.get("country_code") else ([country_code] if country_code else []),
        "raw_payload": {
            "feed_name": feed["name"],
            "feed_url": feed["url"],
            "entry_id": entry.get("id"),
            "entry_link": link,
        },
    }


def _slugify(name: str) -> str:
    """Convert feed name to slug: 'Reuters Middle East' -> 'reuters_middle_east'."""
    return name.lower().replace(" ", "_").replace("-", "_")


def _extract_location(text: str) -> Optional[Dict]:
    """Extract location info from text. Returns dict with name, country_code, lat, lon."""
    text_lower = text.lower()
    for city_key, (city_name, cc, lat, lon) in CITIES.items():
        if city_key in text_lower:
            return {
                "name": city_name,
                "country_code": cc,
                "latitude": lat,
                "longitude": lon,
            }
    return None


def _classify_incident_type(title: str, description: str) -> str:
    """Classify incident type based on text content."""
    combined = (title + " " + (description or "")).lower()
    military_kw = ['missile', 'rocket', 'drone', 'airstrike', 'strike', 'bomb',
                   'shelling', 'artillery', 'military', 'idf', 'hamas', 'hezbollah',
                   'houthi', 'air defense', 'interceptor']
    security_kw = ['attack', 'explosion', 'blast', 'terrorism', 'hostage', 'arrest',
                   'infiltration', 'border']
    political_kw = ['sanctions', 'election', 'parliament', 'treaty', 'agreement',
                    'summit', 'diplomacy', 'ambassador', 'foreign minister']
    diplomatic_kw = ['diplomatic', 'embassy', 'consulate', 'relations', 'bilateral',
                     'multilateral', 'un security council']
    economic_kw = ['oil price', 'trade', 'gdp', 'investment', 'economic', 'opec',
                   'market', 'stock', 'currency']
    humanitarian_kw = ['refugee', 'humanitarian', 'aid', 'displaced', 'famine',
                       'casualties', 'killed', 'wounded', 'civilian']
    environmental_kw = ['earthquake', 'flood', 'fire', 'wildfire', 'storm',
                        'environmental', 'oil spill', 'pollution']
    cyber_kw = ['cyber', 'hack', 'malware', 'ransomware', 'data breach', 'phishing']

    for kw in military_kw:
        if kw in combined:
            return 'military'
    for kw in security_kw:
        if kw in combined:
            return 'security'
    for kw in diplomatic_kw:
        if kw in combined:
            return 'diplomatic'
    for kw in political_kw:
        if kw in combined:
            return 'political'
    for kw in humanitarian_kw:
        if kw in combined:
            return 'humanitarian'
    for kw in economic_kw:
        if kw in combined:
            return 'economic'
    for kw in environmental_kw:
        if kw in combined:
            return 'environmental'
    for kw in cyber_kw:
        if kw in combined:
            return 'cyber'
    return 'security'  # default


def _classify_severity(title: str, description: str, credibility: float) -> str:
    """Classify severity based on keywords and source credibility."""
    combined = (title + " " + (description or "")).lower()
    critical_kw = ['mass casualt', 'nuclear', 'wmd', 'chemical weapon',
                   'invasion', 'war declared', 'state of emergency']
    high_kw = ['killed', 'dead', 'airstrike', 'missile launch', 'bombing',
               'major explosion', 'hostage', 'siege']
    for kw in critical_kw:
        if kw in combined:
            return 'critical'
    for kw in high_kw:
        if kw in combined:
            return 'high'
    if credibility >= 0.9:
        return 'medium'
    return 'low'


# ---------------------------------------------------------------------------
# Deduplication (Step 3 from architecture)
# ---------------------------------------------------------------------------

def compute_dedup_hash(source: str, source_id: str) -> str:
    """SHA-256 hash of (source + sourceId) for exact dedup."""
    return hashlib.sha256(f"{source}:{source_id}".encode()).hexdigest()


def is_duplicate(cur, dedup_hash: str) -> bool:
    """Check if this exact event was already ingested.
    Uses module_outputs.input_hash as the dedup index."""
    cur.execute(
        "SELECT 1 FROM incidents WHERE external_id = %s LIMIT 1",
        (dedup_hash,),
    )
    return cur.fetchone() is not None


# ---------------------------------------------------------------------------
# Persistence (Step 5)
# ---------------------------------------------------------------------------

def persist_incident(
    cur,
    event: Dict,
    run_id: str,
    data_source: str,
) -> Optional[int]:
    """Insert a normalized event into the incidents table.
    Returns the incident ID, or None if duplicate."""
    dedup_hash = compute_dedup_hash(event["source"], event["source_id"])

    if is_duplicate(cur, dedup_hash):
        return None

    incident_type = _classify_incident_type(
        event["title"], event.get("description", "")
    )
    severity = _classify_severity(
        event["title"], event.get("description", ""),
        event.get("source_reliability", 0.5),
    )

    location = event.get("location") or {}

    cur.execute(
        """
        INSERT INTO incidents (
            external_id, title, description, source, source_url,
            source_reliability, published_at, incident_type, severity,
            status, location_name, country_code, latitude, longitude,
            countries, data_source, raw_payload
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s::incident_type, %s::severity_level,
            'unconfirmed', %s, %s, %s, %s,
            %s, %s::data_source_type, %s::jsonb
        )
        RETURNING id
        """,
        (
            dedup_hash,
            event["title"][:500],
            event.get("description"),
            event["source"],
            event.get("source_url"),
            event.get("source_reliability"),
            event["published_at"],
            incident_type,
            severity,
            location.get("name"),
            event.get("country_code"),
            location.get("latitude"),
            location.get("longitude"),
            event.get("countries", []),
            data_source,
            json.dumps(event.get("raw_payload", {})),
        ),
    )
    row = cur.fetchone()
    return row["id"] if row else None


# ---------------------------------------------------------------------------
# Redis notification (Step 6)
# ---------------------------------------------------------------------------

class RedisPublisher:
    """Publishes ingested events to Redis channels for WebSocket fan-out."""

    def __init__(self, redis_url: str = REDIS_URL):
        self._url = redis_url
        self._client: Optional[redis.Redis] = None

    def connect(self) -> None:
        self._client = redis.Redis.from_url(
            self._url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        # Verify connectivity
        self._client.ping()
        logger.info("Redis publisher connected: %s", self._url)

    def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def publish_incident(self, incident: Dict) -> None:
        """Publish new incident to Redis channel."""
        if not self._client:
            return
        msg = json.dumps({
            "type": "incident.new",
            "data": incident,
        })
        try:
            self._client.publish(CHANNEL_INCIDENTS, msg)
            # If severity is critical, also publish alert
            if incident.get("severity") == "critical":
                alert_msg = json.dumps({
                    "type": "alert.threat",
                    "data": {
                        "country": incident.get("country_code", ""),
                        "level": "critical",
                        "reason": incident.get("title", ""),
                        "incident_id": incident.get("id"),
                    },
                })
                self._client.publish(CHANNEL_ALERTS, alert_msg)
        except redis.RedisError as exc:
            logger.warning("Failed to publish to Redis: %s", exc)

    def publish_thermal(self, detection: Dict) -> None:
        """Publish thermal detection to Redis channel."""
        if not self._client:
            return
        msg = json.dumps({"type": "thermal.new", "data": detection})
        try:
            self._client.publish(CHANNEL_THERMAL, msg)
        except redis.RedisError as exc:
            logger.warning("Failed to publish thermal to Redis: %s", exc)


# ---------------------------------------------------------------------------
# Feed Poller
# ---------------------------------------------------------------------------

class FeedPoller:
    """Polls a list of RSS feeds, normalizes entries, deduplicates,
    and persists to PostgreSQL."""

    def __init__(
        self,
        feeds: List[Dict],
        db_pool: DatabasePool,
        publisher: RedisPublisher,
        circuit_breaker: CircuitBreaker,
        data_source: str = "live",
    ):
        self.feeds = feeds
        self.pool = db_pool
        self.publisher = publisher
        self.cb = circuit_breaker
        self.data_source = data_source

    def poll_all(self) -> Dict[str, int]:
        """Poll all feeds. Returns stats: {fetched, new, duplicate, error}."""
        stats = {"fetched": 0, "new": 0, "duplicate": 0, "error": 0}
        run_id = str(uuid.uuid4())

        for feed in self.feeds:
            try:
                count = self._poll_feed(feed, run_id, stats)
                stats["fetched"] += count
            except Exception as exc:
                stats["error"] += 1
                logger.error(
                    "Error polling feed '%s': %s", feed["name"], exc,
                )

        # Audit log the ingestion run
        try:
            write_audit_log(
                action="ingest",
                details={
                    "run_id": run_id,
                    "data_source": self.data_source,
                    "feeds_polled": len(self.feeds),
                    "events_fetched": stats["fetched"],
                    "events_new": stats["new"],
                    "events_duplicate": stats["duplicate"],
                    "errors": stats["error"],
                },
                pool=self.pool,
            )
        except Exception as exc:
            logger.warning("Failed to write audit log: %s", exc)

        return stats

    def _poll_feed(self, feed: Dict, run_id: str, stats: Dict) -> int:
        """Poll a single RSS feed. Returns number of entries fetched."""
        logger.debug("Polling feed: %s", feed["name"])

        parsed = feedparser.parse(feed["url"])
        if parsed.bozo and not parsed.entries:
            logger.warning(
                "Feed '%s' returned bozo error: %s",
                feed["name"], parsed.bozo_exception,
            )
            return 0

        entries = parsed.entries or []
        for entry in entries:
            try:
                event = normalize_raw_event(entry, feed)
                if event is None:
                    continue  # irrelevant

                # Run through circuit breaker
                cb_result = self.cb.process_event({
                    "title": event["title"],
                    "location": event.get("location", {}).get("name", ""),
                    "date": event["published_at"][:10],
                })
                if cb_result is None:
                    stats["duplicate"] += 1
                    continue

                # Persist to database
                with self.pool.transaction() as cur:
                    incident_id = persist_incident(
                        cur, event, run_id, self.data_source,
                    )

                if incident_id is None:
                    stats["duplicate"] += 1
                    continue

                stats["new"] += 1

                # Publish to Redis for WebSocket push
                self.publisher.publish_incident({
                    "id": incident_id,
                    "title": event["title"],
                    "source": event["source"],
                    "severity": _classify_severity(
                        event["title"], event.get("description", ""),
                        event.get("source_reliability", 0.5),
                    ),
                    "country_code": event.get("country_code"),
                    "published_at": event["published_at"],
                    "data_source": self.data_source,
                })

            except Exception as exc:
                stats["error"] += 1
                logger.error(
                    "Error processing entry from '%s': %s",
                    feed["name"], exc,
                )

        return len(entries)


# ---------------------------------------------------------------------------
# Cross-Source Verification (post-ingestion)
# ---------------------------------------------------------------------------

def run_cross_source_verification(pool: DatabasePool) -> None:
    """Run cross-source verification on recent unconfirmed incidents.
    Updates status to 'confirmed' when corroborated by 2+ sources."""
    try:
        with pool.cursor() as cur:
            # Fetch recent unconfirmed incidents (last 30 minutes)
            cur.execute(
                """
                SELECT id, published_at, title, source,
                       source_reliability, country_code, raw_payload
                FROM incidents
                WHERE status = 'unconfirmed'
                  AND ingested_at > now() - interval '30 minutes'
                ORDER BY published_at DESC
                LIMIT 200
                """
            )
            rows = cur.fetchall()

        if not rows:
            return

        # Convert to format expected by CrossSourceVerification
        incidents_for_csv = []
        for row in rows:
            incidents_for_csv.append({
                "id": row["id"],
                "title": row["title"],
                "source": row["source"],
                "location": {"country": row.get("country_code", "")},
                "published_at": str(row["published_at"]),
                "credibility": int((row.get("source_reliability") or 0.5) * 100),
            })

        csv = CrossSourceVerification(incidents_for_csv)
        csv.group_incidents()
        groups = csv.groups

        # Update incidents that appear in multi-source groups
        for group in groups:
            if len(group.get("incidents", [])) >= 2:
                ids = [inc["id"] for inc in group["incidents"]]
                confidence = group.get("confidence", 0)
                if confidence >= 60:
                    with pool.transaction() as cur:
                        for inc_id in ids:
                            cur.execute(
                                """
                                UPDATE incidents
                                SET status = 'confirmed',
                                    credibility = GREATEST(credibility, %s)
                                WHERE id = %s AND status = 'unconfirmed'
                                """,
                                (confidence, inc_id),
                            )
                    logger.info(
                        "Cross-source verified %d incidents (confidence=%d%%)",
                        len(ids), confidence,
                    )

    except Exception as exc:
        logger.error("Cross-source verification failed: %s", exc)


# ---------------------------------------------------------------------------
# Worker Loop
# ---------------------------------------------------------------------------

class IngestionWorker:
    """Main worker that runs polling loops for HIGH and LOW priority feeds."""

    def __init__(self):
        self._stop = threading.Event()
        self._pool: Optional[DatabasePool] = None
        self._publisher: Optional[RedisPublisher] = None
        self._threads: List[threading.Thread] = []

    def start(self) -> None:
        """Initialize connections and start polling threads."""
        logger.info("Starting Gulf Watch ingestion worker...")
        logger.info("Data source mode: %s", DATA_SOURCE)
        logger.info("High-priority poll interval: %ds", POLL_HIGH_SEC)
        logger.info("Low-priority poll interval: %ds", POLL_LOW_SEC)

        # Initialize database pool
        self._pool = get_pool()
        health = self._pool.health_check()
        if health["status"] != "healthy":
            logger.error("Database health check failed: %s", health)
            sys.exit(1)
        logger.info("Database connection: healthy (%.1fms)", health["latency_ms"])

        # Initialize Redis publisher
        self._publisher = RedisPublisher(REDIS_URL)
        try:
            self._publisher.connect()
        except Exception as exc:
            logger.warning(
                "Redis connection failed (WebSocket push disabled): %s", exc,
            )

        # Circuit breaker for deduplication
        cb = CircuitBreaker()

        # Create feed pollers
        high_poller = FeedPoller(
            HIGH_PRIORITY_FEEDS, self._pool, self._publisher, cb, DATA_SOURCE,
        )
        low_poller = FeedPoller(
            LOW_PRIORITY_FEEDS, self._pool, self._publisher, cb, DATA_SOURCE,
        )

        # Start polling threads
        t_high = threading.Thread(
            target=self._poll_loop,
            args=(high_poller, POLL_HIGH_SEC, "HIGH"),
            name="poller-high",
            daemon=True,
        )
        t_low = threading.Thread(
            target=self._poll_loop,
            args=(low_poller, POLL_LOW_SEC, "LOW"),
            name="poller-low",
            daemon=True,
        )
        t_verify = threading.Thread(
            target=self._verification_loop,
            name="verifier",
            daemon=True,
        )

        self._threads = [t_high, t_low, t_verify]
        for t in self._threads:
            t.start()

        logger.info(
            "Ingestion worker running. %d HIGH feeds (every %ds), "
            "%d LOW feeds (every %ds).",
            len(HIGH_PRIORITY_FEEDS), POLL_HIGH_SEC,
            len(LOW_PRIORITY_FEEDS), POLL_LOW_SEC,
        )

        # Block main thread until stop signal
        try:
            while not self._stop.is_set():
                self._stop.wait(timeout=1.0)
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()

    def shutdown(self) -> None:
        """Graceful shutdown."""
        logger.info("Shutting down ingestion worker...")
        self._stop.set()
        for t in self._threads:
            t.join(timeout=10)
        if self._publisher:
            self._publisher.close()
        logger.info("Ingestion worker stopped.")

    def _poll_loop(
        self, poller: FeedPoller, interval_sec: int, label: str,
    ) -> None:
        """Run a poller at a fixed interval."""
        while not self._stop.is_set():
            start = time.monotonic()
            try:
                stats = poller.poll_all()
                elapsed = time.monotonic() - start
                logger.info(
                    "[%s] Poll complete in %.1fs: fetched=%d new=%d dup=%d err=%d",
                    label, elapsed,
                    stats["fetched"], stats["new"],
                    stats["duplicate"], stats["error"],
                )
            except Exception as exc:
                logger.error("[%s] Poll failed: %s", label, exc)
                logger.debug(traceback.format_exc())

            # Wait for the next interval or stop signal
            remaining = max(0, interval_sec - (time.monotonic() - start))
            self._stop.wait(timeout=remaining)

    def _verification_loop(self) -> None:
        """Run cross-source verification every 5 minutes."""
        while not self._stop.is_set():
            self._stop.wait(timeout=300)  # 5 minutes
            if self._stop.is_set():
                break
            try:
                run_cross_source_verification(self._pool)
            except Exception as exc:
                logger.error("Verification loop error: %s", exc)


# ---------------------------------------------------------------------------
# Signal handlers
# ---------------------------------------------------------------------------

_worker: Optional[IngestionWorker] = None


def _handle_signal(signum, frame):
    logger.info("Received signal %d", signum)
    if _worker:
        _worker.shutdown()
    sys.exit(0)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global _worker

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _handle_signal)

    _worker = IngestionWorker()
    _worker.start()


if __name__ == "__main__":
    main()
