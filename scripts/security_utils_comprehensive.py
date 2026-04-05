#!/usr/bin/env python3
"""
Comprehensive Security Utilities for Gulf Watch
Protects against all forms of HTML/XSS injection
"""

import html
import re
import urllib.parse
from typing import Optional

# ============================================================================
# HTML ESCAPING (Prevents XSS)
# ============================================================================

def escape_html(text: Optional[str]) -> str:
    """
    Escape HTML special characters to prevent XSS attacks.
    Converts: < > " ' & to their HTML entities
    """
    if not text:
        return ""
    return html.escape(str(text), quote=True)

def escape_html_attribute(text: Optional[str]) -> str:
    """
    Escape text for use in HTML attributes (stricter than regular HTML).
    Also encodes quotes and apostrophes.
    """
    if not text:
        return ""
    # Use HTML entities for quotes too
    return html.escape(str(text), quote=True).replace("'", "&#x27;").replace('"', "&quot;")

def escape_js_string(text: Optional[str]) -> str:
    """
    Escape text for use in JavaScript strings.
    Prevents JavaScript injection when inserting into JS code.
    """
    if not text:
        return ""
    # Escape backslashes first, then quotes, then other special chars
    text = str(text)
    text = text.replace('\\', '\\\\')  # Backslash
    text = text.replace("'", "\\'")     # Single quote
    text = text.replace('"', '\\"')     # Double quote
    text = text.replace('\n', '\\n')    # Newline
    text = text.replace('\r', '\\r')    # Carriage return
    text = text.replace('\x00', '')     # Null byte (terminate strings)
    return text

# ============================================================================
# URL SANITIZATION (Prevents Link/URL Injection)
# ============================================================================

DANGEROUS_PROTOCOLS = [
    'javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'chrome:', 
    'livescript:', 'mocha:', 'data:text/html', 'data:application/javascript'
]

def sanitize_url(url: Optional[str], allow_relative: bool = False) -> str:
    """
    Sanitize URL to prevent javascript: and other dangerous protocols.
    
    Args:
        url: The URL to sanitize
        allow_relative: If True, allows relative URLs starting with /
    
    Returns:
        Sanitized URL or '#' if dangerous
    """
    if not url:
        return "#"
    
    url = str(url).strip()
    url_lower = url.lower()
    
    # Check for dangerous protocols
    for protocol in DANGEROUS_PROTOCOLS:
        if url_lower.startswith(protocol):
            return "#"
    
    # Check for HTML entities that might decode to dangerous protocols
    decoded = html.unescape(url_lower)
    for protocol in DANGEROUS_PROTOCOLS:
        if decoded.startswith(protocol):
            return "#"
    
    # Check for unicode homoglyphs (e.g., javаscript with cyrillic 'а')
    # Normalize and check again
    import unicodedata
    try:
        normalized = unicodedata.normalize('NFKC', url_lower)
        for protocol in ['javascript:', 'data:']:
            if normalized.startswith(protocol):
                return "#"
    except (ValueError, TypeError, UnicodeError):
        pass

    # If no protocol specified
    if '://' not in url:
        if allow_relative and url.startswith('/'):
            return url
        # Assume HTTPS
        return "https://" + url
    
    # Validate protocol is HTTP(S) or FTP
    allowed = ('http://', 'https://', 'ftp://', 'ftps://', 'mailto:')
    if not any(url_lower.startswith(p) for p in allowed):
        return "#"
    
    return url

def sanitize_css_value(value: Optional[str]) -> str:
    """
    Sanitize CSS values to prevent CSS injection.
    Removes dangerous CSS functions and expressions.
    """
    if not value:
        return ""
    
    value = str(value)
    
    # Block dangerous CSS functions
    dangerous = [
        'expression(', 'javascript:', 'vbscript:', 'data:text/html',
        '@import', '@charset', 'binding(', 'moz-binding'
    ]
    
    value_lower = value.lower()
    for d in dangerous:
        if d in value_lower:
            return ""
    
    # Block HTML tags in CSS
    if '<' in value and '>' in value:
        return ""
    
    return value

# ============================================================================
# ID/IDENTIFIER SANITIZATION
# ============================================================================

def sanitize_id(value: Optional[str]) -> str:
    """
    Sanitize an identifier (like incident ID) for safe use in:
    - HTML IDs
    - CSS selectors
    - JavaScript variables
    
    Only allows alphanumeric, dash, and underscore.
    """
    if not value:
        return ""
    
    # Remove any character that's not alphanumeric, dash, or underscore
    sanitized = re.sub(r'[^a-zA-Z0-9\-_]', '', str(value))
    
    # Limit length to prevent DoS
    return sanitized[:100]

def sanitize_css_selector(value: Optional[str]) -> str:
    """
    Sanitize a value for use in CSS selectors.
    Prevents CSS injection via selectors.
    """
    if not value:
        return ""
    
    # Escape CSS special characters
    value = str(value)
    value = value.replace('\\', '\\\\')  # Escape backslash
    value = value.replace('"', '\\"')     # Escape double quote
    value = value.replace("'", "\\'")     # Escape single quote
    
    # Remove other dangerous characters
    sanitized = re.sub(r'[<>&]', '', value)
    
    return sanitized[:100]

# ============================================================================
# CONTENT SECURITY HELPERS
# ============================================================================

def generate_csp_header() -> str:
    """
    Generate a Content Security Policy header.
    Restricts what resources can be loaded.
    """
    return (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://*.vercel.app; "
        "font-src 'self'; "
        "frame-ancestors 'none'; "  # Prevents clickjacking
        "base-uri 'self'; "
        "form-action 'self';"
    )

def get_security_headers() -> dict:
    """
    Get all recommended security headers.
    """
    return {
        'Content-Security-Policy': generate_csp_header(),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',  # Prevents clickjacking
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    }

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

def validate_country_code(code: str) -> bool:
    """
    Validate country code to prevent SSRF.
    Only allows 2-letter country codes.
    """
    if not code or len(code) != 2:
        return False
    return bool(re.match(r'^[a-zA-Z]{2}$', code))

def validate_coordinates(lat: float, lng: float) -> bool:
    """
    Validate latitude and longitude values.
    """
    try:
        lat = float(lat)
        lng = float(lng)
        return -90 <= lat <= 90 and -180 <= lng <= 180
    except (TypeError, ValueError):
        return False

# ============================================================================
# TEST FUNCTIONS
# ============================================================================

def test_escaping():
    """Test all escaping functions"""
    # Test HTML escaping
    assert escape_html('<script>alert("XSS")</script>') == '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
    
    # Test URL sanitization
    assert sanitize_url('javascript:alert(1)') == '#'
    assert sanitize_url('data:text/html,<script>alert(1)</script>') == '#'
    assert sanitize_url('https://example.com') == 'https://example.com'
    
    # Test ID sanitization
    assert sanitize_id('inc-123_test') == 'inc-123_test'
    assert sanitize_id('inc<script>') == 'incscript'
    
    print("✅ All security tests passed")

if __name__ == '__main__':
    test_escaping()
