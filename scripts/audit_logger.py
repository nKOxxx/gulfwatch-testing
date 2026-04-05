#!/usr/bin/env python3
"""
Audit Logger for Gulf Watch v2
Append-only, tamper-evident audit log with hash chaining and SIEM-compatible output.

Priya Nakamura -- Backend Reliability
Writes to the audit_log PostgreSQL table (DELETE/UPDATE revoked per ARCHITECTURE.md).
"""

import hashlib
import json
import logging
import os
import socket
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("gulfwatch.audit")

# ---------------------------------------------------------------------------
# CEF (Common Event Format) mapping for SIEM integration
# ---------------------------------------------------------------------------

CEF_SEVERITY_MAP = {
    "login": 3,
    "logout": 3,
    "login_failed": 7,
    "view_incident": 1,
    "create_incident": 5,
    "update_incident": 5,
    "delete_incident": 8,
    "export": 6,
    "admin_action": 8,
    "role_change": 9,
    "mfa_enable": 5,
    "mfa_disable": 7,
    "session_revoke": 6,
    "api_key_create": 7,
    "api_key_revoke": 7,
    "system_start": 3,
    "system_stop": 3,
    "config_change": 8,
    "data_import": 5,
}

CEF_VENDOR = "GulfWatch"
CEF_PRODUCT = "GulfWatch-v2"
CEF_VERSION = "2.0"
CEF_FORMAT_VERSION = "0"


def _cef_escape(value: str) -> str:
    """Escape special characters for CEF format."""
    if not value:
        return ""
    return (
        value.replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def to_cef(entry: Dict[str, Any]) -> str:
    """
    Convert an audit log entry to CEF (Common Event Format) string.

    Format: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
    """
    action = entry.get("action", "unknown")
    severity = CEF_SEVERITY_MAP.get(action, 5)

    # Build extension key-value pairs
    extensions = []
    if entry.get("user_id"):
        extensions.append(f"suser={_cef_escape(str(entry['user_id']))}")
    if entry.get("ip_address"):
        extensions.append(f"src={_cef_escape(entry['ip_address'])}")
    if entry.get("resource_type"):
        extensions.append(f"cs1={_cef_escape(entry['resource_type'])}")
        extensions.append("cs1Label=ResourceType")
    if entry.get("resource_id"):
        extensions.append(f"cs2={_cef_escape(str(entry['resource_id']))}")
        extensions.append("cs2Label=ResourceID")
    if entry.get("user_agent"):
        extensions.append(f"requestClientApplication={_cef_escape(entry['user_agent'])}")
    if entry.get("timestamp"):
        extensions.append(f"rt={entry['timestamp']}")
    if entry.get("chain_hash"):
        extensions.append(f"cs3={entry['chain_hash']}")
        extensions.append("cs3Label=ChainHash")

    ext_str = " ".join(extensions)

    header = (
        f"CEF:{CEF_FORMAT_VERSION}"
        f"|{_cef_escape(CEF_VENDOR)}"
        f"|{_cef_escape(CEF_PRODUCT)}"
        f"|{_cef_escape(CEF_VERSION)}"
        f"|{_cef_escape(action)}"
        f"|{_cef_escape(action)}"
        f"|{severity}"
    )

    return f"{header}|{ext_str}"


# ---------------------------------------------------------------------------
# Hash chaining for tamper detection
# ---------------------------------------------------------------------------

GENESIS_HASH = hashlib.sha256(b"GULFWATCH_AUDIT_GENESIS_BLOCK").hexdigest()


def compute_chain_hash(previous_hash: str, entry_data: Dict[str, Any]) -> str:
    """
    Compute a chained SHA-256 hash for tamper detection.

    Hash = SHA-256(previous_hash + canonical_json(entry_data))
    """
    canonical = json.dumps(entry_data, sort_keys=True, separators=(",", ":"))
    payload = f"{previous_hash}{canonical}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_chain(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Verify the integrity of an audit log chain.

    Returns:
        {
            "valid": bool,
            "total_entries": int,
            "verified": int,
            "first_broken_index": int | None,
            "first_broken_id": str | None
        }
    """
    if not entries:
        return {
            "valid": True,
            "total_entries": 0,
            "verified": 0,
            "first_broken_index": None,
            "first_broken_id": None,
        }

    previous_hash = GENESIS_HASH
    verified = 0

    for i, entry in enumerate(entries):
        stored_hash = entry.get("chain_hash", "")
        # Rebuild entry data used for hashing (exclude chain_hash itself)
        entry_data = {
            "timestamp": entry.get("timestamp"),
            "user_id": entry.get("user_id"),
            "action": entry.get("action"),
            "resource_type": entry.get("resource_type"),
            "resource_id": entry.get("resource_id"),
            "ip_address": entry.get("ip_address"),
            "user_agent": entry.get("user_agent"),
            "details": entry.get("details", {}),
        }
        expected_hash = compute_chain_hash(previous_hash, entry_data)

        if expected_hash != stored_hash:
            return {
                "valid": False,
                "total_entries": len(entries),
                "verified": verified,
                "first_broken_index": i,
                "first_broken_id": entry.get("id"),
            }

        previous_hash = stored_hash
        verified += 1

    return {
        "valid": True,
        "total_entries": len(entries),
        "verified": verified,
        "first_broken_index": None,
        "first_broken_id": None,
    }


# ---------------------------------------------------------------------------
# AuditLogger class -- the primary interface
# ---------------------------------------------------------------------------

class AuditLogger:
    """
    Append-only, tamper-evident audit logger.

    Writes to PostgreSQL audit_log table. Maintains hash chain for tamper
    detection. Supports CEF output for SIEM integration.

    Usage:
        logger = AuditLogger(db_connection)
        logger.log(
            user_id="...",
            action="login",
            resource_type="session",
            resource_id="...",
            ip_address="1.2.3.4",
            user_agent="Mozilla/5.0...",
            metadata={"method": "password"}
        )
    """

    def __init__(self, db_connection=None, cef_output_path: Optional[str] = None):
        """
        Args:
            db_connection: A psycopg2/asyncpg connection to PostgreSQL.
                           If None, logs are buffered in memory (useful for testing).
            cef_output_path: Optional file path for CEF syslog output.
        """
        self._conn = db_connection
        self._cef_path = cef_output_path
        self._last_hash: Optional[str] = None
        self._buffer: List[Dict[str, Any]] = []  # In-memory buffer when no DB

        # Initialize chain hash
        if self._conn is not None:
            self._last_hash = self._fetch_last_hash()
        if self._last_hash is None:
            self._last_hash = GENESIS_HASH

    def _fetch_last_hash(self) -> Optional[str]:
        """Fetch the most recent chain_hash from the audit_log table."""
        try:
            cursor = self._conn.cursor()
            cursor.execute(
                "SELECT details->>'chain_hash' FROM audit_log "
                "ORDER BY timestamp DESC LIMIT 1"
            )
            row = cursor.fetchone()
            cursor.close()
            if row and row[0]:
                return row[0]
        except Exception as e:
            logger.warning("Could not fetch last audit hash: %s", e)
        return None

    def log(
        self,
        action: str,
        user_id: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Record an audit event.

        Args:
            action: The action being audited (e.g. 'login', 'view_incident').
            user_id: UUID of the user performing the action (None for system).
            resource_type: Type of resource being acted upon.
            resource_id: ID of the specific resource.
            ip_address: Client IP address.
            user_agent: Client user-agent string.
            metadata: Additional key-value data for the event.

        Returns:
            The complete audit entry dict (with chain_hash).
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        entry_data = {
            "timestamp": timestamp,
            "user_id": str(user_id) if user_id else None,
            "action": action,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id else None,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "details": metadata or {},
        }

        # Compute chained hash
        chain_hash = compute_chain_hash(self._last_hash, entry_data)
        self._last_hash = chain_hash

        # Build full entry
        entry = {
            **entry_data,
            "chain_hash": chain_hash,
        }

        # Persist
        if self._conn is not None:
            self._write_to_db(entry)
        else:
            self._buffer.append(entry)

        # CEF output
        if self._cef_path:
            self._write_cef(entry)

        logger.info(
            "AUDIT: action=%s user=%s resource=%s/%s",
            action,
            user_id or "system",
            resource_type or "-",
            resource_id or "-",
        )

        return entry

    def _write_to_db(self, entry: Dict[str, Any]) -> None:
        """Insert audit entry into PostgreSQL audit_log table."""
        details = {**(entry.get("details") or {}), "chain_hash": entry["chain_hash"]}
        try:
            cursor = self._conn.cursor()
            cursor.execute(
                """
                INSERT INTO audit_log
                    (user_id, action, resource_type, resource_id, ip_address, user_agent, details)
                VALUES
                    (%s, %s, %s, %s, %s::inet, %s, %s::jsonb)
                """,
                (
                    entry.get("user_id"),
                    entry["action"],
                    entry.get("resource_type"),
                    entry.get("resource_id"),
                    entry.get("ip_address"),
                    entry.get("user_agent"),
                    json.dumps(details),
                ),
            )
            self._conn.commit()
        except Exception as e:
            logger.error("Failed to write audit log to DB: %s", e)
            # Buffer entry so it is not lost
            self._buffer.append(entry)
            try:
                self._conn.rollback()
            except Exception:
                pass

    def _write_cef(self, entry: Dict[str, Any]) -> None:
        """Append CEF-formatted line to syslog file."""
        try:
            cef_line = to_cef(entry)
            with open(self._cef_path, "a") as f:
                f.write(cef_line + "\n")
        except Exception as e:
            logger.error("Failed to write CEF output: %s", e)

    def get_buffer(self) -> List[Dict[str, Any]]:
        """Return the in-memory buffer (useful for testing or when no DB)."""
        return list(self._buffer)

    def flush_buffer(self) -> int:
        """
        Flush buffered entries to the database.

        Returns:
            Number of entries flushed.
        """
        if not self._conn or not self._buffer:
            return 0

        flushed = 0
        remaining = []
        for entry in self._buffer:
            try:
                self._write_to_db(entry)
                flushed += 1
            except Exception:
                remaining.append(entry)

        self._buffer = remaining
        return flushed

    def verify_integrity(self, limit: int = 1000) -> Dict[str, Any]:
        """
        Verify the integrity of the last `limit` audit entries.

        Fetches entries from DB, rebuilds chain hashes, and checks for tampering.
        """
        if self._conn is not None:
            entries = self._fetch_entries(limit)
        else:
            entries = self._buffer[-limit:] if self._buffer else []

        return verify_chain(entries)

    def _fetch_entries(self, limit: int) -> List[Dict[str, Any]]:
        """Fetch recent audit entries from DB ordered by timestamp ASC."""
        try:
            cursor = self._conn.cursor()
            cursor.execute(
                """
                SELECT id, timestamp, user_id, action, resource_type,
                       resource_id, ip_address, user_agent, details
                FROM audit_log
                ORDER BY timestamp ASC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            cursor.close()

            entries = []
            for row in rows:
                details = row[8] if isinstance(row[8], dict) else json.loads(row[8] or "{}")
                entries.append(
                    {
                        "id": row[0],
                        "timestamp": row[1].isoformat() if hasattr(row[1], "isoformat") else str(row[1]),
                        "user_id": str(row[2]) if row[2] else None,
                        "action": row[3],
                        "resource_type": row[4],
                        "resource_id": str(row[5]) if row[5] else None,
                        "ip_address": str(row[6]) if row[6] else None,
                        "user_agent": row[7],
                        "details": {k: v for k, v in details.items() if k != "chain_hash"},
                        "chain_hash": details.get("chain_hash", ""),
                    }
                )
            return entries
        except Exception as e:
            logger.error("Failed to fetch audit entries: %s", e)
            return []

    def export_cef(self, entries: Optional[List[Dict]] = None) -> List[str]:
        """
        Export entries as CEF-formatted strings.

        Args:
            entries: Entries to export. If None, uses the in-memory buffer.

        Returns:
            List of CEF-formatted strings.
        """
        if entries is None:
            entries = self._buffer
        return [to_cef(e) for e in entries]


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------

_default_logger: Optional[AuditLogger] = None


def init_audit_logger(
    db_connection=None, cef_output_path: Optional[str] = None
) -> AuditLogger:
    """Initialize the module-level default audit logger."""
    global _default_logger
    _default_logger = AuditLogger(db_connection, cef_output_path)
    return _default_logger


def audit_log(
    action: str,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Log an audit event using the default logger."""
    global _default_logger
    if _default_logger is None:
        _default_logger = AuditLogger()  # In-memory fallback
    return _default_logger.log(
        action=action,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata=metadata,
    )
