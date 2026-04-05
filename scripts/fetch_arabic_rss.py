#!/usr/bin/env python3
"""
Arabic RSS Feed Fetcher for Gulf Watch v2 (BABEL Module)
Author: Farah Al-Rashidi, Arabic NLP & Intelligence Linguist

Fetches Arabic-language RSS feeds from 15+ Middle East sources:
  - Official state news agencies (WAM, SPA, QNA, KUNA, BNA, ONA, SANA, IRNA)
  - Major Arabic-language outlets (Al Jazeera, Al Arabiya, Asharq Al-Awsat, etc.)
  - Proper UTF-8 Arabic encoding
  - Integration with circuit_breaker.py for deduplication
  - Cross-language dedup: matches Arabic incidents to English equivalents

Protocol: standalone script, outputs JSON to stdout or writes to public/feed_ar.json
"""

import feedparser
import hashlib
import json
import re
import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher

# Add scripts directory to path for sibling imports
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)

try:
    from circuit_breaker import CircuitBreaker
except ImportError:
    CircuitBreaker = None

try:
    from arabic_nlp import (
        normalize_arabic, extract_entities, analyze_sentiment,
        detect_language, is_arabic, get_entity_db
    )
    _HAS_NLP = True
except ImportError:
    _HAS_NLP = False

try:
    from arabic_transliteration import resolve_entity_ar, transliterate_ar_to_lat
    _HAS_TRANSLIT = True
except ImportError:
    _HAS_TRANSLIT = False


# ===========================================================================
# ARABIC RSS FEED SOURCES (15+ sources)
# ===========================================================================

ARABIC_FEEDS = [
    # ===== Tier 1: Official State News Agencies =====
    {
        "name": "وكالة أنباء الإمارات",
        "name_en": "WAM (Emirates News Agency)",
        "url": "https://www.wam.ae/ar/rss/all",
        "country": "AE",
        "country_ar": "الإمارات",
        "credibility": 85,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة الأنباء السعودية",
        "name_en": "SPA (Saudi Press Agency)",
        "url": "https://www.spa.gov.sa/rss/ar",
        "country": "SA",
        "country_ar": "السعودية",
        "credibility": 85,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة الأنباء القطرية",
        "name_en": "QNA (Qatar News Agency)",
        "url": "https://www.qna.org.qa/ar/rss",
        "country": "QA",
        "country_ar": "قطر",
        "credibility": 80,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة الأنباء الكويتية",
        "name_en": "KUNA (Kuwait News Agency)",
        "url": "https://www.kuna.net.kw/RSS/ar",
        "country": "KW",
        "country_ar": "الكويت",
        "credibility": 80,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة أنباء البحرين",
        "name_en": "BNA (Bahrain News Agency)",
        "url": "https://www.bna.bh/ar/rss",
        "country": "BH",
        "country_ar": "البحرين",
        "credibility": 80,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة الأنباء العمانية",
        "name_en": "ONA (Oman News Agency)",
        "url": "https://www.omanews.gov.om/ar/rss",
        "country": "OM",
        "country_ar": "عمان",
        "credibility": 80,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "الوكالة العربية السورية للأنباء",
        "name_en": "SANA (Syrian Arab News Agency)",
        "url": "https://www.sana.sy/ar/rss",
        "country": "SY",
        "country_ar": "سوريا",
        "credibility": 60,
        "language": "ar",
        "tier": 1,
    },
    {
        "name": "وكالة الجمهورية الإسلامية للأنباء",
        "name_en": "IRNA (Islamic Republic News Agency)",
        "url": "https://www.irna.ir/ar/rss",
        "country": "IR",
        "country_ar": "إيران",
        "credibility": 55,
        "language": "ar",
        "tier": 1,
    },

    # ===== Tier 2: Major Arabic-language News Outlets =====
    {
        "name": "الجزيرة نت",
        "name_en": "Al Jazeera Arabic",
        "url": "https://www.aljazeera.net/aljazeerarss/all.xml",
        "country": "QA",
        "country_ar": "قطر",
        "credibility": 85,
        "language": "ar",
        "tier": 2,
    },
    {
        "name": "العربية نت",
        "name_en": "Al Arabiya Arabic",
        "url": "https://www.alarabiya.net/.mrss/ar.xml",
        "country": "SA",
        "country_ar": "السعودية",
        "credibility": 80,
        "language": "ar",
        "tier": 2,
    },
    {
        "name": "الشرق الأوسط",
        "name_en": "Asharq Al-Awsat",
        "url": "https://aawsat.com/feed/rss2",
        "country": "SA",
        "country_ar": "السعودية",
        "credibility": 80,
        "language": "ar",
        "tier": 2,
    },
    {
        "name": "سكاي نيوز عربية",
        "name_en": "Sky News Arabia",
        "url": "https://www.skynewsarabia.com/web/rss",
        "country": "AE",
        "country_ar": "الإمارات",
        "credibility": 80,
        "language": "ar",
        "tier": 2,
    },
    {
        "name": "رويترز بالعربية",
        "name_en": "Reuters Arabic",
        "url": "https://www.reuters.com/news/archive/arabicNews.rss",
        "country": "International",
        "country_ar": "دولي",
        "credibility": 95,
        "language": "ar",
        "tier": 2,
    },
    {
        "name": "فرانس 24 عربي",
        "name_en": "France 24 Arabic",
        "url": "https://www.france24.com/ar/rss",
        "country": "International",
        "country_ar": "دولي",
        "credibility": 85,
        "language": "ar",
        "tier": 2,
    },

    # ===== Tier 3: Regional/Specialized Arabic Sources =====
    {
        "name": "الميادين",
        "name_en": "Al Mayadeen",
        "url": "https://www.almayadeen.net/rss/latest",
        "country": "LB",
        "country_ar": "لبنان",
        "credibility": 60,
        "language": "ar",
        "tier": 3,
    },
    {
        "name": "المنار",
        "name_en": "Al Manar",
        "url": "https://www.almanar.com.lb/rss",
        "country": "LB",
        "country_ar": "لبنان",
        "credibility": 50,
        "language": "ar",
        "tier": 3,
    },
    {
        "name": "وكالة المسيرة",
        "name_en": "Al Masirah",
        "url": "https://www.almasirah.net/rss",
        "country": "YE",
        "country_ar": "اليمن",
        "credibility": 40,
        "language": "ar",
        "tier": 3,
    },
    {
        "name": "الأهرام",
        "name_en": "Al-Ahram",
        "url": "https://gate.ahram.org.eg/rss",
        "country": "EG",
        "country_ar": "مصر",
        "credibility": 75,
        "language": "ar",
        "tier": 3,
    },
]


# ===========================================================================
# FEED FETCHING
# ===========================================================================

def fetch_feed(feed_config: Dict, timeout: int = 15) -> List[Dict]:
    """
    Fetch and parse a single Arabic RSS feed.
    Returns list of parsed entries with Arabic content preserved.
    """
    url = feed_config['url']
    try:
        parsed = feedparser.parse(url, request_headers={
            'Accept-Charset': 'utf-8',
            'Accept-Language': 'ar',
        })

        if parsed.bozo and not parsed.entries:
            sys.stderr.write(f"[WARN] Feed error for {feed_config['name_en']}: {parsed.bozo_exception}\n")
            return []

        entries = []
        for entry in parsed.entries[:50]:  # Cap at 50 per feed
            # Extract publication date
            pub_date = None
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
            elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                pub_date = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc).isoformat()
            else:
                pub_date = datetime.now(timezone.utc).isoformat()

            # Extract title and description (Arabic content)
            title = entry.get('title', '').strip()
            description = entry.get('summary', entry.get('description', '')).strip()

            # Clean HTML from description
            description = re.sub(r'<[^>]+>', '', description)
            description = re.sub(r'&[a-z]+;', ' ', description)
            description = re.sub(r'\s+', ' ', description).strip()

            # Extract link
            link = entry.get('link', '')

            # Build entry
            parsed_entry = {
                'title_ar': title,
                'description_ar': description,
                'source': feed_config['name_en'],
                'source_ar': feed_config['name'],
                'source_url': link,
                'published_at': pub_date,
                'country': feed_config['country'],
                'country_ar': feed_config.get('country_ar', ''),
                'credibility': feed_config['credibility'],
                'language': 'ar',
                'tier': feed_config['tier'],
                'guid': entry.get('id', entry.get('link', '')),
            }

            # Run NLP pipeline if available
            if _HAS_NLP and title:
                try:
                    entities = extract_entities(title + ' ' + description[:200])
                    sentiment = analyze_sentiment(title + ' ' + description[:200])
                    parsed_entry['entities'] = entities
                    parsed_entry['sentiment'] = sentiment
                except Exception:
                    pass

            entries.append(parsed_entry)

        return entries

    except Exception as e:
        sys.stderr.write(f"[ERROR] Failed to fetch {feed_config['name_en']}: {str(e)}\n")
        return []


def fetch_all_arabic_feeds(tiers: Optional[List[int]] = None) -> List[Dict]:
    """
    Fetch all Arabic RSS feeds (or filtered by tier).
    Returns combined list of entries sorted by publication date.
    """
    all_entries = []
    feeds = ARABIC_FEEDS
    if tiers:
        feeds = [f for f in ARABIC_FEEDS if f['tier'] in tiers]

    for feed_config in feeds:
        sys.stderr.write(f"[INFO] Fetching: {feed_config['name_en']}...\n")
        entries = fetch_feed(feed_config)
        sys.stderr.write(f"[INFO]   -> {len(entries)} entries\n")
        all_entries.extend(entries)

    # Sort by publication date (newest first)
    all_entries.sort(key=lambda x: x.get('published_at', ''), reverse=True)
    return all_entries


# ===========================================================================
# CROSS-LANGUAGE DEDUPLICATION
# ===========================================================================

def _generate_arabic_signature(entry: Dict) -> str:
    """Generate a dedup signature for an Arabic entry."""
    title = entry.get('title_ar', '')
    if _HAS_NLP:
        title = normalize_arabic(title)

    # Extract key terms for hashing
    # Remove common Arabic stopwords
    stopwords = {
        'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
        'التي', 'الذي', 'كان', 'قد', 'لا', 'ما', 'هو', 'هي', 'أن', 'إن',
        'بين', 'حتى', 'بعد', 'قبل', 'خلال', 'منذ', 'عند', 'كل', 'بعض',
        'أو', 'ثم', 'لكن', 'لأن', 'كما', 'أيضاً', 'أكثر',
    }
    tokens = title.split()
    content_tokens = [t for t in tokens if t not in stopwords and len(t) > 2]
    content_str = ' '.join(content_tokens[:8])  # Use first 8 content words

    sig_data = f"{content_str}:{entry.get('published_at', '')[:10]}"
    return hashlib.md5(sig_data.encode('utf-8')).hexdigest()[:16]


def _match_arabic_to_english(ar_entry: Dict, en_entry: Dict) -> float:
    """
    Score how likely an Arabic entry matches an English entry (same incident).
    Returns similarity score 0.0-1.0.
    """
    score = 0.0

    # 1. Date proximity (must be within 24 hours)
    ar_date = ar_entry.get('published_at', '')[:10]
    en_date = en_entry.get('published_at', en_entry.get('date', ''))[:10]
    if ar_date and en_date and ar_date == en_date:
        score += 0.3
    elif ar_date and en_date:
        # Different dates -- penalize but don't disqualify within 1 day
        try:
            d1 = datetime.fromisoformat(ar_date)
            d2 = datetime.fromisoformat(en_date)
            if abs((d1 - d2).days) <= 1:
                score += 0.15
            else:
                return 0.0  # Too far apart
        except (ValueError, TypeError):
            pass

    # 2. Entity overlap (strongest signal)
    ar_entities_text = set()
    if _HAS_NLP:
        for ent in ar_entry.get('entities', []):
            if ent.get('text_en'):
                ar_entities_text.add(ent['text_en'].lower())
            if _HAS_TRANSLIT and ent.get('text_ar'):
                resolved = resolve_entity_ar(ent['text_ar'])
                if resolved:
                    ar_entities_text.add(resolved['en'].lower())
                    for v in resolved.get('variants', []):
                        ar_entities_text.add(v.lower())

    en_title = en_entry.get('title', '').lower()
    en_desc = en_entry.get('description', '').lower()
    en_text = en_title + ' ' + en_desc

    entity_matches = sum(1 for e in ar_entities_text if e in en_text)
    if entity_matches >= 2:
        score += 0.5
    elif entity_matches == 1:
        score += 0.25

    # 3. Country match
    ar_country = ar_entry.get('country', '')
    en_countries = en_entry.get('countries', [])
    if not isinstance(en_countries, list):
        en_countries = [en_countries] if en_countries else []
    en_country = en_entry.get('country', '')
    if en_country:
        en_countries.append(en_country)

    if ar_country and ar_country in en_countries:
        score += 0.15

    # 4. Transliterated title similarity
    if _HAS_TRANSLIT:
        ar_title = ar_entry.get('title_ar', '')
        transliterated = transliterate_ar_to_lat(ar_title).lower()
        title_sim = SequenceMatcher(None, transliterated, en_title).ratio()
        score += title_sim * 0.1

    return min(1.0, score)


def deduplicate_arabic(arabic_entries: List[Dict]) -> List[Dict]:
    """
    Deduplicate Arabic entries among themselves.
    """
    seen_sigs = set()
    unique = []

    for entry in arabic_entries:
        sig = _generate_arabic_signature(entry)
        if sig not in seen_sigs:
            seen_sigs.add(sig)
            unique.append(entry)

    return unique


def cross_language_dedup(arabic_entries: List[Dict],
                         english_entries: List[Dict],
                         threshold: float = 0.6) -> Tuple[List[Dict], List[Dict]]:
    """
    Cross-language deduplication: match Arabic entries to English equivalents.

    Returns:
        (unique_arabic, matched_pairs)
        - unique_arabic: Arabic entries with no English match
        - matched_pairs: list of {'arabic': ..., 'english': ..., 'score': ...}
    """
    unique_arabic = []
    matched_pairs = []
    used_english = set()

    for ar_entry in arabic_entries:
        best_match = None
        best_score = 0.0

        for j, en_entry in enumerate(english_entries):
            if j in used_english:
                continue
            score = _match_arabic_to_english(ar_entry, en_entry)
            if score > best_score:
                best_score = score
                best_match = j

        if best_match is not None and best_score >= threshold:
            used_english.add(best_match)
            matched_pairs.append({
                'arabic': ar_entry,
                'english': english_entries[best_match],
                'score': round(best_score, 3),
            })
        else:
            unique_arabic.append(ar_entry)

    return unique_arabic, matched_pairs


# ===========================================================================
# CIRCUIT BREAKER INTEGRATION
# ===========================================================================

def integrate_with_circuit_breaker(arabic_entries: List[Dict],
                                    existing_incidents: Optional[List[Dict]] = None) -> List[Dict]:
    """
    Run Arabic entries through the circuit breaker for dedup against existing incidents.
    Uses the same CircuitBreaker class as the English RSS fetcher.
    """
    if CircuitBreaker is None:
        sys.stderr.write("[WARN] circuit_breaker.py not available, skipping dedup\n")
        return arabic_entries

    # Convert Arabic entries to circuit breaker format
    cb_events = []
    for entry in arabic_entries:
        cb_events.append({
            'title': entry.get('title_ar', ''),
            'description': entry.get('description_ar', ''),
            'source': entry.get('source', ''),
            'date': entry.get('published_at', ''),
            'location': entry.get('country_ar', ''),
        })

    cb = CircuitBreaker(existing_events=existing_incidents or [])
    filtered = []
    for i, event in enumerate(cb_events):
        # Use circuit breaker's dedup logic
        sig = cb._generate_signature(event)
        if sig not in cb.event_signatures:
            cb.event_signatures[sig] = event
            filtered.append(arabic_entries[i])

    return filtered


# ===========================================================================
# MAIN / OUTPUT
# ===========================================================================

def format_output(entries: List[Dict], matched_pairs: Optional[List[Dict]] = None) -> Dict:
    """Format the output JSON for Gulf Watch consumption."""
    return {
        'module': 'babel_rss',
        'version': '1.0.0',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_entries': len(entries),
        'sources_count': len(set(e.get('source', '') for e in entries)),
        'matched_cross_language': len(matched_pairs) if matched_pairs else 0,
        'entries': entries,
        'cross_language_matches': matched_pairs or [],
    }


def main():
    """
    Main entry point.
    Usage:
        python fetch_arabic_rss.py                    # Fetch all, output JSON to stdout
        python fetch_arabic_rss.py --tier 1           # Fetch tier 1 only
        python fetch_arabic_rss.py --tier 1,2         # Fetch tiers 1 and 2
        python fetch_arabic_rss.py --write             # Write to public/feed_ar.json
        python fetch_arabic_rss.py --dedup existing.json  # Dedup against existing
    """
    import argparse
    parser = argparse.ArgumentParser(description='Fetch Arabic RSS feeds for Gulf Watch')
    parser.add_argument('--tier', type=str, default=None,
                        help='Comma-separated tier numbers to fetch (e.g., "1,2")')
    parser.add_argument('--write', action='store_true',
                        help='Write output to public/feed_ar.json')
    parser.add_argument('--dedup', type=str, default=None,
                        help='Path to existing incidents JSON for cross-language dedup')
    args = parser.parse_args()

    # Parse tiers
    tiers = None
    if args.tier:
        tiers = [int(t.strip()) for t in args.tier.split(',')]

    # Fetch Arabic feeds
    entries = fetch_all_arabic_feeds(tiers=tiers)
    sys.stderr.write(f"[INFO] Total raw entries: {len(entries)}\n")

    # Deduplicate Arabic entries among themselves
    entries = deduplicate_arabic(entries)
    sys.stderr.write(f"[INFO] After Arabic dedup: {len(entries)}\n")

    # Cross-language dedup if English incidents provided
    matched_pairs = None
    if args.dedup:
        try:
            with open(args.dedup, 'r', encoding='utf-8') as f:
                english_incidents = json.load(f)
            if isinstance(english_incidents, dict):
                english_incidents = english_incidents.get('incidents', english_incidents.get('entries', []))
            entries, matched_pairs = cross_language_dedup(entries, english_incidents)
            sys.stderr.write(f"[INFO] After cross-language dedup: {len(entries)} unique, {len(matched_pairs)} matched\n")
        except Exception as e:
            sys.stderr.write(f"[WARN] Could not load dedup file: {e}\n")

    # Integrate with circuit breaker
    entries = integrate_with_circuit_breaker(entries)
    sys.stderr.write(f"[INFO] After circuit breaker: {len(entries)}\n")

    # Format output
    output = format_output(entries, matched_pairs)

    if args.write:
        out_path = os.path.join(os.path.dirname(_SCRIPT_DIR), 'public', 'feed_ar.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        sys.stderr.write(f"[INFO] Written to {out_path}\n")
    else:
        json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')

    sys.exit(0)


if __name__ == '__main__':
    main()
