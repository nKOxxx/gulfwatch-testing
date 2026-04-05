#!/usr/bin/env python3
"""
Gulf Watch - Secrets Management & Environment Configuration

Replaces the original security_utils.py with:
  - Strict environment variable validation at startup
  - Encrypted configuration handling (Fernet / AES-128-CBC)
  - Centralized secrets access with lazy loading
  - Audit-safe logging (never prints secret values)

Usage:
    from scripts.security_config import config, require_env

    # Access validated config
    db_url = config.database_url
    opensky_user = config.opensky_username

    # Or require a one-off env var
    custom_key = require_env('MY_CUSTOM_KEY')
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger("gulfwatch.security")

# ---------------------------------------------------------------------------
# Environment variable helpers
# ---------------------------------------------------------------------------

def require_env(name: str, *, secret: bool = True) -> str:
    """
    Retrieve a required environment variable.
    Raises RuntimeError at startup if missing.
    When `secret=True`, the value is never included in error messages.
    """
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Required environment variable '{name}' is not set. "
            "Check your .env file or deployment secrets."
        )
    return value


def optional_env(name: str, default: str = "", *, secret: bool = False) -> str:
    """Retrieve an optional environment variable with a default."""
    return os.environ.get(name, default)


# ---------------------------------------------------------------------------
# Encrypted config file support
# ---------------------------------------------------------------------------

def _derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a 32-byte encryption key from a passphrase using PBKDF2."""
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode(), salt, iterations=100_000)


def decrypt_config_file(filepath: str, passphrase: str) -> Dict[str, Any]:
    """
    Decrypt a JSON configuration file that was encrypted with
    `encrypt_config_file`. Format:
      - Bytes 0-15:   random salt
      - Bytes 16-31:  random IV
      - Bytes 32-47:  HMAC-SHA256 tag (first 16 bytes)
      - Bytes 48+:    AES-256-CBC ciphertext (PKCS7 padded)

    Returns the parsed JSON dict.
    """
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.primitives import padding as sym_padding
    except ImportError:
        raise RuntimeError(
            "cryptography package is required for encrypted config. "
            "Install with: pip install cryptography"
        )

    data = Path(filepath).read_bytes()
    if len(data) < 48:
        raise ValueError("Encrypted config file is too short to be valid")

    salt = data[:16]
    iv = data[16:32]
    stored_tag = data[32:48]
    ciphertext = data[48:]

    key = _derive_key(passphrase, salt)

    # Verify HMAC before decrypting (encrypt-then-MAC)
    expected_tag = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(stored_tag, expected_tag):
        raise ValueError("Config file integrity check failed -- wrong passphrase or tampered file")

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()

    unpadder = sym_padding.PKCS7(128).unpadder()
    plaintext = unpadder.update(padded) + unpadder.finalize()

    return json.loads(plaintext.decode("utf-8"))


def encrypt_config_file(config_dict: Dict[str, Any], filepath: str, passphrase: str) -> None:
    """
    Encrypt a JSON dict and write it to `filepath`.
    Uses AES-256-CBC with PKCS7 padding, HMAC-SHA256 integrity tag.
    """
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.primitives import padding as sym_padding
    except ImportError:
        raise RuntimeError("cryptography package required: pip install cryptography")

    plaintext = json.dumps(config_dict, indent=2).encode("utf-8")

    salt = os.urandom(16)
    iv = os.urandom(16)
    key = _derive_key(passphrase, salt)

    padder = sym_padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    tag = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]

    Path(filepath).write_bytes(salt + iv + tag + ciphertext)
    logger.info("Encrypted config written to %s (%d bytes)", filepath, 48 + len(ciphertext))


# ---------------------------------------------------------------------------
# Input sanitization (carried over from security_utils.py, improved)
# ---------------------------------------------------------------------------

def escape_html_str(text: Optional[str]) -> str:
    """Escape HTML special characters to prevent XSS."""
    if not text:
        return ""
    return html.escape(str(text))


def sanitize_url(url: Optional[str]) -> str:
    """
    Sanitize a URL: allow only http(s), reject dangerous protocols.
    Returns '#' for anything unsafe.
    """
    if not url:
        return "#"
    url = str(url).strip()
    DANGEROUS = {"javascript:", "data:", "vbscript:", "file:", "about:", "chrome:"}
    url_lower = url.lower().lstrip()
    for d in DANGEROUS:
        if url_lower.startswith(d):
            return "#"
    ALLOWED = ("http://", "https://")
    if not any(url.startswith(p) for p in ALLOWED):
        if url.startswith("/"):
            return url
        return "https://" + url
    return url


def sanitize_id(value: Optional[str], max_length: int = 100) -> str:
    """Sanitize an identifier: alphanumeric, dash, underscore only."""
    if not value:
        return ""
    return re.sub(r"[^a-zA-Z0-9\-_]", "", str(value))[:max_length]


def validate_country_code(code: str) -> bool:
    """Validate an ISO-3166-1 alpha-2 country code."""
    if not code or len(code) != 2:
        return False
    return bool(re.match(r"^[a-zA-Z]{2}$", code))


# ---------------------------------------------------------------------------
# Security headers (for Python API responses)
# ---------------------------------------------------------------------------

ALLOWED_ORIGIN = os.environ.get("CORS_ALLOWED_ORIGINS", "https://gulfwatch.io").split(",")[0].strip()


def get_security_headers(*, cors: bool = True) -> Dict[str, str]:
    """Return a dict of security headers for API responses."""
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "0",
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
    }
    if cors:
        headers.update({
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
        })
    return headers


# ---------------------------------------------------------------------------
# Admin key verification (constant-time)
# ---------------------------------------------------------------------------

_ADMIN_KEY: Optional[str] = None


def verify_admin_key(key: str) -> bool:
    """Verify an admin key against the GULFWATCH_ADMIN_KEY env var."""
    global _ADMIN_KEY
    if _ADMIN_KEY is None:
        _ADMIN_KEY = os.environ.get("GULFWATCH_ADMIN_KEY", "")
    if not _ADMIN_KEY or not key:
        return False
    return hmac.compare_digest(key, _ADMIN_KEY)


# ---------------------------------------------------------------------------
# Centralized configuration dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class GulfWatchConfig:
    """
    Validated application configuration.
    All secrets are read from environment variables at construction time.
    Once created, the object is immutable.
    """

    # -- Database --
    database_url: str = ""
    database_ssl: bool = True

    # -- Redis --
    redis_url: str = ""

    # -- OpenSky --
    opensky_username: str = ""
    opensky_password: str = ""

    # -- NASA FIRMS --
    nasa_firms_api_key: str = ""

    # -- Twitter / X --
    twitter_bearer_token: str = ""

    # -- NewsData --
    newsdata_api_key: str = ""

    # -- JWT --
    jwt_secret: str = ""
    jwt_issuer: str = "https://gulfwatch.io"
    jwt_audience: str = "gulfwatch-api"

    # -- General --
    environment: str = "development"
    log_level: str = "INFO"
    cors_allowed_origins: str = "https://gulfwatch.io"
    admin_key: str = ""

    def __repr__(self) -> str:
        """Never leak secret values in logs or stack traces."""
        safe_fields: List[str] = ["environment", "log_level", "jwt_issuer", "jwt_audience"]
        parts = [f"{f}={getattr(self, f)!r}" for f in safe_fields]
        secret_count = sum(
            1 for f in [
                "database_url", "redis_url", "opensky_username", "opensky_password",
                "nasa_firms_api_key", "twitter_bearer_token", "newsdata_api_key",
                "jwt_secret", "admin_key",
            ]
            if getattr(self, f)
        )
        parts.append(f"secrets_loaded={secret_count}")
        return f"GulfWatchConfig({', '.join(parts)})"


def load_config(*, strict: bool = False) -> GulfWatchConfig:
    """
    Load configuration from environment variables.

    If `strict=True`, raises RuntimeError for any missing required secrets
    (use in production). In development mode (`strict=False`), missing
    secrets produce warnings but don't crash.
    """
    env = os.environ.get

    missing: List[str] = []

    def _get(name: str, required: bool = False, default: str = "") -> str:
        val = env(name, default)
        if required and not val:
            missing.append(name)
        return val or default

    cfg = GulfWatchConfig(
        database_url=_get("DATABASE_URL", required=strict),
        database_ssl=_get("DATABASE_SSL", default="true").lower() in ("true", "1", "yes"),
        redis_url=_get("REDIS_URL", required=strict),
        opensky_username=_get("OPENSKY_USERNAME"),
        opensky_password=_get("OPENSKY_PASSWORD"),
        nasa_firms_api_key=_get("NASA_FIRMS_API_KEY"),
        twitter_bearer_token=_get("TWITTER_BEARER_TOKEN"),
        newsdata_api_key=_get("NEWSDATA_API_KEY"),
        jwt_secret=_get("JWT_SECRET", required=strict),
        jwt_issuer=_get("JWT_ISSUER", default="https://gulfwatch.io"),
        jwt_audience=_get("JWT_AUDIENCE", default="gulfwatch-api"),
        environment=_get("NODE_ENV", default="development"),
        log_level=_get("LOG_LEVEL", default="INFO"),
        cors_allowed_origins=_get("CORS_ALLOWED_ORIGINS", default="https://gulfwatch.io"),
        admin_key=_get("GULFWATCH_ADMIN_KEY"),
    )

    if missing:
        msg = f"Missing required environment variables: {', '.join(missing)}"
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)

    logger.info("Configuration loaded: %s", cfg)
    return cfg


# ---------------------------------------------------------------------------
# Module-level singleton (lazy)
# ---------------------------------------------------------------------------

_config: Optional[GulfWatchConfig] = None


def get_config() -> GulfWatchConfig:
    """Return the singleton config, loading it on first access."""
    global _config
    if _config is None:
        strict = os.environ.get("NODE_ENV") == "production"
        _config = load_config(strict=strict)
    return _config


# Convenience alias
config = property(lambda self: get_config())


# ---------------------------------------------------------------------------
# Startup validation (call from entrypoint)
# ---------------------------------------------------------------------------

def validate_environment() -> bool:
    """
    Run at application startup to validate all environment variables.
    Returns True if valid, logs warnings/errors for issues.
    """
    issues: List[str] = []

    cfg = get_config()

    if cfg.environment == "production":
        if not cfg.database_url:
            issues.append("DATABASE_URL is required in production")
        if not cfg.jwt_secret:
            issues.append("JWT_SECRET is required in production")
        if not cfg.redis_url:
            issues.append("REDIS_URL is required in production")
        if cfg.cors_allowed_origins == "*":
            issues.append("CORS_ALLOWED_ORIGINS must not be '*' in production")

    if cfg.jwt_secret and len(cfg.jwt_secret) < 32:
        issues.append("JWT_SECRET should be at least 32 characters (256 bits)")

    if issues:
        for issue in issues:
            logger.error("Environment validation: %s", issue)
        return False

    logger.info("Environment validation passed")
    return True
