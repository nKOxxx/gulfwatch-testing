#!/usr/bin/env python3
"""
Gulf Watch v2 -- Database Migration Runner
Author: Rena Oduya, Backend Core

Reads SQL migration files from db/ directory and executes them in order.
Tracks applied migrations in the schema_migrations table.

Usage:
    python db/migrate.py                  # Apply all pending migrations
    python db/migrate.py --status         # Show migration status
    python db/migrate.py --init           # Run only the initial schema
    python db/migrate.py --target V002    # Apply up to version V002

Migration files must follow the naming convention:
    V001__initial_schema.sql
    V002__add_embedding_index.sql
    V003__add_alerts_table.sql

The prefix (V001, V002, ...) determines execution order.
Each file is applied exactly once. The SHA-256 checksum is recorded
to detect tampering after deployment.

Environment:
    Reads DB credentials from the same env vars as connection.py.
    Runs as gw_admin role (schema migration privileges).
"""

import glob
import hashlib
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("gulfwatch.migrate")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MIGRATION_DIR = Path(__file__).parent  # db/
MIGRATION_PATTERN = re.compile(r"^(V\d{3})__(.+)\.sql$")

# schema.sql is always V000
SCHEMA_FILE = MIGRATION_DIR / "schema.sql"
SCHEMA_VERSION = "V000"


def get_dsn() -> str:
    """Build DSN from environment variables.
    Uses gw_admin role for migration privileges."""
    host = os.environ.get("GW_DB_HOST", "localhost")
    port = os.environ.get("GW_DB_PORT", "5432")
    dbname = os.environ.get("GW_DB_NAME", "gulfwatch")
    user = os.environ.get("GW_DB_MIGRATION_USER", os.environ.get("GW_DB_USER", "gw_admin"))
    password = os.environ.get("GW_DB_MIGRATION_PASSWORD", os.environ.get("GW_DB_PASSWORD", ""))
    sslmode = os.environ.get("GW_DB_SSLMODE", "require")
    return (
        f"host={host} port={port} dbname={dbname} "
        f"user={user} password={password} sslmode={sslmode}"
    )


def file_checksum(path: Path) -> str:
    """Compute SHA-256 hex digest of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Migration discovery
# ---------------------------------------------------------------------------

def discover_migrations() -> List[Tuple[str, Path]]:
    """Find all migration SQL files and return sorted (version, path) pairs.
    The initial schema.sql is included as V000."""
    migrations: List[Tuple[str, Path]] = []

    # Include the base schema as V000
    if SCHEMA_FILE.exists():
        migrations.append((SCHEMA_VERSION, SCHEMA_FILE))

    # Scan for numbered migration files
    for sql_file in sorted(MIGRATION_DIR.glob("V???__*.sql")):
        match = MIGRATION_PATTERN.match(sql_file.name)
        if match:
            version = match.group(1)
            migrations.append((version, sql_file))

    # Sort by version string
    migrations.sort(key=lambda m: m[0])
    return migrations


# ---------------------------------------------------------------------------
# Schema migrations table bootstrap
# ---------------------------------------------------------------------------

BOOTSTRAP_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    TEXT NOT NULL,
    duration_ms INTEGER
);
"""


def ensure_migrations_table(conn) -> None:
    """Create schema_migrations if it does not exist."""
    with conn.cursor() as cur:
        cur.execute(BOOTSTRAP_SQL)
    conn.commit()


def get_applied_migrations(conn) -> Dict[str, Dict]:
    """Return dict of version -> {filename, checksum, applied_at}."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT version, filename, checksum, applied_at "
            "FROM schema_migrations ORDER BY version"
        )
        return {row["version"]: dict(row) for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# Migration execution
# ---------------------------------------------------------------------------

def apply_migration(
    conn, version: str, path: Path, checksum: str
) -> float:
    """Execute a single migration file inside a transaction.
    Returns duration in milliseconds."""
    sql = path.read_text(encoding="utf-8")
    if not sql.strip():
        logger.warning("Migration %s (%s) is empty, skipping.", version, path.name)
        return 0.0

    start = time.monotonic()
    try:
        with conn.cursor() as cur:
            # Execute the migration SQL
            cur.execute(sql)
            # Record it in schema_migrations
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            cur.execute(
                """
                INSERT INTO schema_migrations (version, filename, checksum, duration_ms)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (version) DO NOTHING
                """,
                (version, path.name, checksum, int(duration_ms)),
            )
        conn.commit()
        return duration_ms
    except Exception as exc:
        conn.rollback()
        raise RuntimeError(
            f"Migration {version} ({path.name}) failed: {exc}"
        ) from exc


def run_migrations(
    target_version: Optional[str] = None,
    init_only: bool = False,
) -> None:
    """Apply all pending migrations up to target_version."""
    dsn = get_dsn()
    logger.info("Connecting to database for migrations...")

    conn = psycopg2.connect(dsn)
    conn.autocommit = False

    try:
        # Ensure the tracking table exists (autocommit for DDL)
        conn.autocommit = True
        ensure_migrations_table(conn)
        conn.autocommit = False

        applied = get_applied_migrations(conn)
        all_migrations = discover_migrations()

        if init_only:
            all_migrations = [(v, p) for v, p in all_migrations if v == SCHEMA_VERSION]

        pending = []
        for version, path in all_migrations:
            if target_version and version > target_version:
                break
            if version in applied:
                # Verify checksum integrity
                expected_checksum = file_checksum(path)
                if applied[version]["checksum"] != expected_checksum:
                    logger.error(
                        "CHECKSUM MISMATCH for %s (%s)! "
                        "Applied: %s, Current: %s. "
                        "Migration file was modified after deployment.",
                        version, path.name,
                        applied[version]["checksum"][:12],
                        expected_checksum[:12],
                    )
                    sys.exit(1)
                continue
            pending.append((version, path))

        if not pending:
            logger.info("No pending migrations. Database is up to date.")
            return

        logger.info(
            "Found %d pending migration(s): %s",
            len(pending),
            ", ".join(v for v, _ in pending),
        )

        # Use advisory lock to prevent concurrent migrations
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(42)")
            locked = cur.fetchone()[0]
            if not locked:
                logger.error(
                    "Another migration process is running. "
                    "Could not acquire advisory lock."
                )
                sys.exit(1)
        conn.autocommit = False

        try:
            for version, path in pending:
                checksum = file_checksum(path)
                logger.info("Applying %s (%s)...", version, path.name)
                duration = apply_migration(conn, version, path, checksum)
                logger.info(
                    "Applied %s in %.0f ms.", version, duration
                )
        finally:
            # Release advisory lock
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(42)")

        logger.info("All migrations applied successfully.")

    finally:
        conn.close()


def show_status() -> None:
    """Print the current migration status."""
    dsn = get_dsn()
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        ensure_migrations_table(conn)
        conn.autocommit = False

        applied = get_applied_migrations(conn)
        all_migrations = discover_migrations()

        print(f"\n{'Version':<10} {'Filename':<40} {'Status':<12} {'Applied At'}")
        print("-" * 90)

        for version, path in all_migrations:
            if version in applied:
                app = applied[version]
                status = "APPLIED"
                # Check checksum
                current_checksum = file_checksum(path)
                if app["checksum"] != current_checksum:
                    status = "MODIFIED!"
                at = str(app["applied_at"])[:19]
            else:
                status = "PENDING"
                at = ""
            print(f"{version:<10} {path.name:<40} {status:<12} {at}")

        print()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Gulf Watch database migration runner"
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Show migration status without applying anything",
    )
    parser.add_argument(
        "--init", action="store_true",
        help="Apply only the initial schema (V000)",
    )
    parser.add_argument(
        "--target", type=str, default=None,
        help="Apply migrations up to this version (e.g., V002)",
    )
    args = parser.parse_args()

    if args.status:
        show_status()
    else:
        run_migrations(
            target_version=args.target,
            init_only=args.init,
        )


if __name__ == "__main__":
    main()
