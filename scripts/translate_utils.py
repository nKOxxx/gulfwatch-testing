#!/usr/bin/env python3
"""Translate incident titles to English for display."""

import re
import time
from typing import Dict, Optional

_RTL_RE = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]')
_LATIN_RE = re.compile(r'[A-Za-z]')


def needs_translation(text: str) -> bool:
    if not text or not text.strip():
        return False

    rtl_chars = len(_RTL_RE.findall(text))
    latin_chars = len(_LATIN_RE.findall(text))

    if rtl_chars >= 8:
        return True
    if rtl_chars > 0 and rtl_chars >= latin_chars:
        return True
    return False


def translate_to_english(text: str, delay_seconds: float = 0.15) -> Optional[str]:
    if not text or not text.strip():
        return text

    try:
        from deep_translator import GoogleTranslator
    except ImportError:
        return None

    try:
        if delay_seconds:
            time.sleep(delay_seconds)
        translated = GoogleTranslator(source='auto', target='en').translate(text[:5000])
        return translated.strip() if translated else None
    except Exception:
        return None


def prepare_english_title(title: str) -> Dict[str, object]:
    """Return display title in English, preserving original when translated."""
    cleaned = (title or '').strip()
    if not cleaned:
        return {'title': cleaned, 'translated': False}

    if not needs_translation(cleaned):
        return {'title': cleaned, 'translated': False}

    translated = translate_to_english(cleaned)
    if not translated or translated.lower() == cleaned.lower():
        return {'title': cleaned, 'translated': False}

    return {
        'title': translated,
        'title_original': cleaned,
        'translated': True,
        'language': 'auto',
    }