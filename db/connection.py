#!/usr/bin/env python3
"""
Gulf Watch v2 -- Database Connection Module
Author: Rena Oduya, Backend Core

Provides:
- Connection pooling via psycopg2 (ThreadedConnectionPool)
- Automatic retry with exponential backoff on transient failures
- Health check endpoint
- Session-scoped RLS context injection
- Graceful shutdown

Environment variables:
    GW_DB_HOST          PostgreSQL host (default: localhost)
    GW_DB_PORT          PostgreSQL port (default: 5432)
    GW_DB_NAME          Database name (default: gulfwatch)
    GW_DB_USER          Application role (default: gw_app)
    GW_DB_PASSWORD      Password (from Vault/env, NEVER hardcoded)
    GW_DB_SSLMODE       SSL mode (default: require; use 'disable' for local dev)
    GW_DB_SSLROOTCERT   Path to CA cert for TLS verification
    GW_DB_POOL_MIN      Minimum pool connections (default: 2)
    GW_DB_POOL_MAX      Maximum pool connections (default: 20)
"""

import atexit
import hashlib
import logging
import os
import signal
import sys
import threading
import time
from contextlib import contextmanager
from functools import wraps
from typing import Any, Dict, Generator, List, Optional, Tuple

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger("gulfwatch.db")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class DBConfig:
    """Database configuration from environment."""

    def __init__(self):
        self.host = os.environ.get("GW_DB_HOST", "localhost")
        self.port = int(os.environ.get("GW_DB_PORT", "5432"))
        self.dbname = os.environ.get("GW_DB_NAME", "gulfwatch")
        self.user = os.environ.get("GW_DB_USER", "gw_app")
        self.password = os.environ.get("GW_DB_PASSWORD", "")
        self.sslmode = os.environ.get("GW_DB_SSLMODE", "require")
        self.sslrootcert = os.environ.get("GW_DB_SSLROOTCERT", "")
        self.pool_min = int(os.environ.get("GW_DB_POOL_MIN", "2"))
        self.pool_max = int(os.environ.get("GW_DB_POOL_MAX", "20"))

    @property
    def dsn(self) -> str:
        parts = (
            f"host={self.host} "
            f"port={self.port} "
            f"dbname={self.dbname} "
            f"user={self.user} "
            f"password={self.password} "
            f"sslmode={self.sslmode}"
        )
        if self.sslrootcert:
            parts += f" sslrootcert={self.sslrootcert}"
        return parts

    def dsn_dict(self) -> Dict[str, Any]:
        d = {
            "host": self.host,
            "port": self.port,
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "sslmode": self.sslmode,
        }
        if self.sslrootcert:
            d["sslrootcert"] = self.sslrootcert
        return d


# ---------------------------------------------------------------------------
# Retry decorator for transient DB errors
# ---------------------------------------------------------------------------

TRANSIENT_ERRORS = (
    psycopg2.OperationalError,
    psycopg2.InterfaceError,
)

def retry_on_transient(max_retries: int = 3, base_delay: float = 0.5):
    """Decorator: retry a function on transient PostgreSQL errors with
    exponential backoff + jitter."""

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except TRANSIENT_ERRORS as exc:
                    last_exc = exc
                    if attempt == max_retries:
                        logger.error(
                            "DB operation failed after %d retries: %s",
                            max_retries, exc,
                        )
                        raise
                    delay = base_delay * (2 ** attempt)
                    # Add jitter: 50-150% of computed delay
                    jitter = delay * (0.5 + (hash(str(exc)) % 100) / 100.0)
                    logger.warning(
                        "Transient DB error (attempt %d/%d), retrying in %.2fs: %s",
                        attempt + 1, max_retries, jitter, exc,
                    )
                    time.sleep(jitter)
            raise last_exc  # type: ignore[misc]
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Connection Pool Manager
# ---------------------------------------------------------------------------

class DatabasePool:
    """Thread-safe PostgreSQL connection pool with health checks and
    graceful shutdown."""

    def __init__(self, config: Optional[DBConfig] = None):
        self._config = config or DBConfig()
        self._pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
        self._lock = threading.Lock()
        self._closed = False
        self._health_check_interval = 30  # seconds
        self._health_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def initialize(self) -> None:
        """Create the connection pool. Must be called before use."""
        with self._lock:
            if self._pool is not None:
                return
            logger.info(
                "Initializing DB pool: %s@%s:%d/%s (min=%d, max=%d)",
                self._config.user, self._config.host, self._config.port,
                self._config.dbname, self._config.pool_min, self._config.pool_max,
            )
            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self._config.pool_min,
                maxconn=self._config.pool_max,
                **self._config.dsn_dict(),
            )
            self._closed = False
            # Start background health check thread
            self._stop_event.clear()
            self._health_thread = threading.Thread(
                target=self._health_check_loop, daemon=True,
                name="db-health-check",
            )
            self._health_thread.start()
            logger.info("DB pool initialized successfully.")

    def close(self) -> None:
        """Shut down the pool and close all connections."""
        with self._lock:
            if self._closed or self._pool is None:
                return
            self._closed = True
            self._stop_event.set()
            try:
                self._pool.closeall()
            except Exception as exc:
                logger.warning("Error closing pool: %s", exc)
            self._pool = None
            logger.info("DB pool closed.")

    @retry_on_transient(max_retries=3)
    def _get_conn(self) -> psycopg2.extensions.connection:
        """Get a connection from the pool with retry."""
        if self._closed or self._pool is None:
            raise RuntimeError("Database pool is not initialized or has been closed.")
        conn = self._pool.getconn()
        conn.autocommit = False
        return conn

    def _put_conn(self, conn: psycopg2.extensions.connection, close: bool = False) -> None:
        """Return a connection to the pool."""
        if self._pool is not None and not self._closed:
            try:
                self._pool.putconn(conn, close=close)
            except Exception as exc:
                logger.warning("Error returning connection to pool: %s", exc)

    @contextmanager
    def connection(
        self,
        user_id: Optional[str] = None,
        user_role: Optional[str] = None,
    ) -> Generator[psycopg2.extensions.connection, None, None]:
        """Context manager that yields a connection with RLS context set.

        Usage:
            with pool.connection(user_id="...", user_role="analyst") as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM incidents LIMIT 10")

        The connection is automatically committed on success or rolled back
        on exception, then returned to the pool.
        """
        conn = self._get_conn()
        close_conn = False
        try:
            # Inject RLS session variables so row-level security policies work
            with conn.cursor() as cur:
                if user_id:
                    cur.execute(
                        "SET LOCAL app.current_user_id = %s", (user_id,)
                    )
                if user_role:
                    cur.execute(
                        "SET LOCAL app.current_user_role = %s", (user_role,)
                    )
            yield conn
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception as rb_exc:
                logger.warning("Rollback failed: %s", rb_exc)
                close_conn = True
            raise
        finally:
            self._put_conn(conn, close=close_conn)

    @contextmanager
    def cursor(
        self,
        user_id: Optional[str] = None,
        user_role: Optional[str] = None,
        cursor_factory=None,
    ) -> Generator[psycopg2.extensions.cursor, None, None]:
        """Convenience: yields a cursor within a managed connection.

        Usage:
            with pool.cursor(user_role="admin") as cur:
                cur.execute("SELECT count(*) FROM users")
                count = cur.fetchone()[0]
        """
        factory = cursor_factory or psycopg2.extras.RealDictCursor
        with self.connection(user_id=user_id, user_role=user_role) as conn:
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur

    @contextmanager
    def transaction(
        self,
        user_id: Optional[str] = None,
        user_role: Optional[str] = None,
    ) -> Generator[psycopg2.extensions.cursor, None, None]:
        """Explicit transaction with auto-commit/rollback.
        Suitable for multi-statement writes.

        Usage:
            with pool.transaction(user_id="...", user_role="analyst") as cur:
                cur.execute("INSERT INTO incidents ...")
                cur.execute("INSERT INTO audit_log ...")
        """
        with self.connection(user_id=user_id, user_role=user_role) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur

    # -----------------------------------------------------------------------
    # Health checks
    # -----------------------------------------------------------------------

    def health_check(self) -> Dict[str, Any]:
        """Run a synchronous health check. Returns dict with status."""
        result = {
            "status": "unhealthy",
            "pool_closed": self._closed,
            "latency_ms": None,
            "error": None,
        }
        if self._closed or self._pool is None:
            result["error"] = "Pool not initialized"
            return result

        start = time.monotonic()
        try:
            conn = self._get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
                conn.commit()
                elapsed = (time.monotonic() - start) * 1000
                result["status"] = "healthy"
                result["latency_ms"] = round(elapsed, 2)
            finally:
                self._put_conn(conn)
        except Exception as exc:
            elapsed = (time.monotonic() - start) * 1000
            result["latency_ms"] = round(elapsed, 2)
            result["error"] = str(exc)
            logger.error("DB health check failed: %s", exc)

        return result

    def _health_check_loop(self) -> None:
        """Background thread that periodically checks DB connectivity."""
        while not self._stop_event.is_set():
            self._stop_event.wait(timeout=self._health_check_interval)
            if self._stop_event.is_set():
                break
            try:
                result = self.health_check()
                if result["status"] != "healthy":
                    logger.warning("Background health check: %s", result)
            except Exception as exc:
                logger.error("Health check loop error: %s", exc)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_pool: Optional[DatabasePool] = None
_pool_lock = threading.Lock()


def get_pool(config: Optional[DBConfig] = None) -> DatabasePool:
    """Get or create the module-level connection pool singleton."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = DatabasePool(config)
            _pool.initialize()
        return _pool


def close_pool() -> None:
    """Shut down the module-level pool."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


# Register shutdown hooks
atexit.register(close_pool)


def _signal_handler(signum, frame):
    logger.info("Received signal %d, closing DB pool.", signum)
    close_pool()
    sys.exit(0)


for sig in (signal.SIGTERM, signal.SIGINT):
    try:
        signal.signal(sig, _signal_handler)
    except (OSError, ValueError):
        pass  # Not all signals available on all platforms


# ---------------------------------------------------------------------------
# Utility: write to audit log (contract with Priya)
# ---------------------------------------------------------------------------

def write_audit_log(
    action: str,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    pool: Optional[DatabasePool] = None,
) -> None:
    """Insert a row into the append-only audit log.

    This function is part of the contract with Priya (Reliability).
    It runs outside RLS context (system-level insert).
    """
    db = pool or get_pool()
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO audit_log
                (user_id, action, resource_type, resource_id,
                 ip_address, user_agent, details)
            VALUES (%s, %s, %s, %s, %s::inet, %s, %s::jsonb)
            """,
            (
                user_id,
                action,
                resource_type,
                resource_id,
                ip_address,
                user_agent,
                psycopg2.extras.Json(details or {}),
            ),
        )
