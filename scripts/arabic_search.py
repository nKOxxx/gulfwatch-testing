#!/usr/bin/env python3
"""
Arabic Search Index for Gulf Watch v2 (BABEL Module)
Author: Farah Al-Rashidi, Arabic NLP & Intelligence Linguist

Provides:
  - Root-based Arabic search (find morphological variants)
  - Mixed Arabic/English search support
  - Fuzzy matching for Arabic text (hamza, ta marbuta, alef variants)
  - In-memory inverted index for fast lookup
  - Integration with existing incidents.json

Standalone: no external dependencies beyond arabic_nlp.py
"""

import json
import math
import os
import re
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Tuple, Set, Any

# Sibling imports
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)

try:
    from arabic_nlp import (
        normalize_arabic, tokenize_arabic, extract_root,
        is_arabic, detect_language, get_entity_db, strip_prefix, strip_suffix
    )
    _HAS_NLP = True
except ImportError:
    _HAS_NLP = False

try:
    from arabic_transliteration import resolve_entity_ar, resolve_entity_en, transliterate_ar_to_lat
    _HAS_TRANSLIT = True
except ImportError:
    _HAS_TRANSLIT = False


# ===========================================================================
# ARABIC STOPWORDS
# ===========================================================================

ARABIC_STOPWORDS: Set[str] = {
    'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
    'التي', 'الذي', 'الذين', 'اللواتي', 'اللتان', 'اللذان',
    'كان', 'كانت', 'يكون', 'تكون', 'قد', 'لا', 'لم', 'لن', 'ما',
    'هو', 'هي', 'هم', 'هن', 'أنت', 'أنا', 'نحن',
    'أن', 'إن', 'أنّ', 'إنّ',
    'بين', 'حتى', 'بعد', 'قبل', 'خلال', 'منذ', 'عند', 'حول',
    'كل', 'بعض', 'أي', 'كلا', 'كلتا',
    'أو', 'ثم', 'لكن', 'لكنّ', 'لأن', 'كما', 'حيث', 'بينما',
    'أيضاً', 'أكثر', 'أقل', 'فقط', 'جداً', 'كثيراً',
    'وقد', 'ولا', 'ولم', 'فيما', 'مما', 'بما', 'مثل',
    'تم', 'يتم', 'كذلك', 'ذات', 'ذو', 'غير',
}


# ===========================================================================
# ARABIC FUZZY MATCHING
# ===========================================================================

# Character equivalence classes for fuzzy matching
_FUZZY_EQUIVALENCES = [
    # Alef variants
    {'\u0627', '\u0622', '\u0623', '\u0625', '\u0671'},  # alef, madda, hamza above, hamza below, wasla
    # Ha / Ta marbuta
    {'\u0647', '\u0629'},  # ha, ta marbuta
    # Ya / Alef maksura
    {'\u064A', '\u0649'},  # ya, alef maksura
    # Hamza variants
    {'\u0621', '\u0623', '\u0625', '\u0624', '\u0626'},  # standalone, on alef, on ya, on waw
    # Waw variants
    {'\u0648', '\u0624'},  # waw, waw+hamza
]

# Build equivalence lookup
_CHAR_EQUIV: Dict[str, str] = {}
for group in _FUZZY_EQUIVALENCES:
    canonical = min(group)  # Use the lowest codepoint as canonical
    for char in group:
        _CHAR_EQUIV[char] = canonical


def fuzzy_normalize(text: str) -> str:
    """
    Normalize text for fuzzy matching.
    Collapses hamza variants, alef variants, ta marbuta/ha, ya/alef maksura.
    """
    if not text:
        return text
    # Remove tashkeel first
    if _HAS_NLP:
        text = normalize_arabic(text, full=False)
    # Apply character equivalences
    result = []
    for char in text:
        result.append(_CHAR_EQUIV.get(char, char))
    return ''.join(result)


def arabic_fuzzy_match(query: str, target: str, threshold: float = 0.7) -> float:
    """
    Fuzzy match two Arabic strings.
    Returns similarity score 0.0-1.0.
    Handles hamza variants, ta marbuta, alef variants automatically.
    """
    q_fuzzy = fuzzy_normalize(query)
    t_fuzzy = fuzzy_normalize(target)

    if q_fuzzy == t_fuzzy:
        return 1.0

    # Check containment
    if q_fuzzy in t_fuzzy:
        return 0.9
    if t_fuzzy in q_fuzzy:
        return 0.85

    # Character-level Levenshtein-like similarity
    if not q_fuzzy or not t_fuzzy:
        return 0.0

    len_q = len(q_fuzzy)
    len_t = len(t_fuzzy)

    # Quick length check
    if abs(len_q - len_t) > max(len_q, len_t) * 0.4:
        return 0.0

    # Simple edit distance ratio
    matches = 0
    max_len = max(len_q, len_t)
    min_len = min(len_q, len_t)

    # Sliding window comparison for partial match
    for offset in range(max_len - min_len + 1):
        current_matches = sum(
            1 for i in range(min_len)
            if i + offset < max_len and (
                (i < len_q and i + offset < len_t and q_fuzzy[i] == t_fuzzy[i + offset]) or
                (i < len_t and i + offset < len_q and t_fuzzy[i] == q_fuzzy[i + offset])
            )
        )
        matches = max(matches, current_matches)

    return matches / max_len if max_len > 0 else 0.0


# ===========================================================================
# ROOT-BASED ARABIC SEARCH
# ===========================================================================

def get_root_variants(word: str) -> Set[str]:
    """
    Get morphological variants of an Arabic word by root extraction.
    Returns the root plus common derived forms.
    """
    variants = {word}
    if not _HAS_NLP:
        return variants

    # Get the root
    root = extract_root(word)
    if root:
        variants.add(root)

    # Also add the normalized form
    norm = normalize_arabic(word)
    variants.add(norm)

    # Strip prefix/suffix variants
    _, stem = strip_prefix(word)
    if stem != word:
        variants.add(stem)
    stem2, _ = strip_suffix(word)
    if stem2 != word:
        variants.add(stem2)

    # Fuzzy normalized form
    variants.add(fuzzy_normalize(word))

    return variants


# ===========================================================================
# INVERTED INDEX
# ===========================================================================

class ArabicSearchIndex:
    """
    In-memory inverted index for Arabic + English text search.
    Supports:
      - Root-based Arabic search
      - Mixed Arabic/English queries
      - Fuzzy matching
      - TF-IDF ranking
    """

    def __init__(self):
        # term -> set of document IDs
        self._index: Dict[str, Set[int]] = defaultdict(set)
        # root -> set of document IDs (for root-based search)
        self._root_index: Dict[str, Set[int]] = defaultdict(set)
        # fuzzy normalized term -> set of document IDs
        self._fuzzy_index: Dict[str, Set[int]] = defaultdict(set)
        # entity -> set of document IDs
        self._entity_index: Dict[str, Set[int]] = defaultdict(set)
        # doc ID -> document data
        self._documents: Dict[int, Dict] = {}
        # doc ID -> term frequency map
        self._doc_tf: Dict[int, Dict[str, int]] = {}
        # total number of documents
        self._doc_count: int = 0
        # term -> document frequency
        self._df: Dict[str, int] = defaultdict(int)

    def add_document(self, doc_id: int, doc: Dict):
        """
        Index a document (incident, article, etc.).
        Expects fields: title, title_ar, description, description_ar, entities, etc.
        """
        self._documents[doc_id] = doc
        self._doc_count += 1
        tf: Dict[str, int] = defaultdict(int)

        # Index Arabic content
        ar_text = ' '.join(filter(None, [
            doc.get('title_ar', ''),
            doc.get('description_ar', ''),
        ]))
        if ar_text and is_arabic(ar_text) if _HAS_NLP else False:
            tokens = tokenize_arabic(ar_text) if _HAS_NLP else ar_text.split()
            for token in tokens:
                if token in ARABIC_STOPWORDS:
                    continue
                norm = normalize_arabic(token) if _HAS_NLP else token
                if len(norm) < 2:
                    continue

                # Exact index
                self._index[norm].add(doc_id)
                tf[norm] = tf.get(norm, 0) + 1

                # Root index
                if _HAS_NLP:
                    root = extract_root(token)
                    if root and len(root) >= 2:
                        self._root_index[root].add(doc_id)

                # Fuzzy index
                fuzzy = fuzzy_normalize(norm)
                self._fuzzy_index[fuzzy].add(doc_id)

        # Index English content
        en_text = ' '.join(filter(None, [
            doc.get('title', ''),
            doc.get('description', ''),
        ]))
        if en_text:
            en_tokens = re.findall(r'\b\w+\b', en_text.lower())
            for token in en_tokens:
                if len(token) < 2:
                    continue
                self._index[token].add(doc_id)
                tf[token] = tf.get(token, 0) + 1

        # Index entities
        for entity in doc.get('entities', []):
            ent_name = entity.get('text_en', entity.get('name', '')).lower()
            if ent_name:
                self._entity_index[ent_name].add(doc_id)
            ent_name_ar = entity.get('text_ar', '')
            if ent_name_ar:
                norm_ar = normalize_arabic(ent_name_ar) if _HAS_NLP else ent_name_ar
                self._entity_index[norm_ar].add(doc_id)

        # Store TF and update DF
        self._doc_tf[doc_id] = dict(tf)
        for term in tf:
            self._df[term] += 1

    def search(self, query: str, limit: int = 20, fuzzy: bool = True) -> List[Dict]:
        """
        Search the index with a query string.
        Supports mixed Arabic/English queries.
        Returns ranked results.
        """
        lang = detect_language(query) if _HAS_NLP else ('ar' if is_arabic(query) else 'en')

        # Tokenize query
        if lang in ('ar', 'mixed') and _HAS_NLP:
            tokens = tokenize_arabic(query)
        else:
            tokens = re.findall(r'\b\w+\b', query.lower())

        # Remove stopwords
        tokens = [t for t in tokens if t not in ARABIC_STOPWORDS and len(t) >= 2]

        if not tokens:
            return []

        # Collect candidate documents with scores
        doc_scores: Dict[int, float] = defaultdict(float)

        for token in tokens:
            norm = normalize_arabic(token) if _HAS_NLP else token.lower()

            # 1. Exact match (highest weight)
            for doc_id in self._index.get(norm, set()):
                doc_scores[doc_id] += 3.0 * self._idf(norm)

            # 2. Root-based match (for Arabic)
            if _HAS_NLP and is_arabic(token):
                root = extract_root(token)
                if root:
                    for doc_id in self._root_index.get(root, set()):
                        doc_scores[doc_id] += 2.0 * self._idf(root)

            # 3. Fuzzy match
            if fuzzy:
                fuzzy_key = fuzzy_normalize(norm)
                for doc_id in self._fuzzy_index.get(fuzzy_key, set()):
                    doc_scores[doc_id] += 1.5

            # 4. Entity match (high weight)
            for doc_id in self._entity_index.get(norm, set()):
                doc_scores[doc_id] += 4.0

            # 5. Cross-language: if Arabic query, also try English entity lookup
            if _HAS_TRANSLIT and is_arabic(token):
                resolved = resolve_entity_ar(token)
                if resolved:
                    en_name = resolved['en'].lower()
                    for doc_id in self._entity_index.get(en_name, set()):
                        doc_scores[doc_id] += 3.5
                    for variant in resolved.get('variants', []):
                        for doc_id in self._entity_index.get(variant.lower(), set()):
                            doc_scores[doc_id] += 2.5

            # 6. Cross-language: if English query, try Arabic entity lookup
            if _HAS_TRANSLIT and not is_arabic(token):
                resolved = resolve_entity_en(token)
                if resolved:
                    ar_name = normalize_arabic(resolved['ar']) if _HAS_NLP else resolved['ar']
                    for doc_id in self._entity_index.get(ar_name, set()):
                        doc_scores[doc_id] += 3.5

        # Rank by score
        ranked = sorted(doc_scores.items(), key=lambda x: x[1], reverse=True)

        # Format results
        results = []
        for doc_id, score in ranked[:limit]:
            doc = self._documents.get(doc_id, {})
            results.append({
                'doc_id': doc_id,
                'score': round(score, 3),
                'title': doc.get('title', doc.get('title_ar', '')),
                'title_ar': doc.get('title_ar', ''),
                'source': doc.get('source', ''),
                'published_at': doc.get('published_at', doc.get('date', '')),
                'country': doc.get('country', doc.get('country_code', '')),
                'severity': doc.get('severity', ''),
            })

        return results

    def _idf(self, term: str) -> float:
        """Inverse document frequency."""
        df = self._df.get(term, 0)
        if df == 0 or self._doc_count == 0:
            return 1.0
        return math.log(self._doc_count / df) + 1.0

    def search_by_root(self, root: str, limit: int = 20) -> List[Dict]:
        """Search specifically by Arabic root."""
        if not root:
            return []

        norm_root = normalize_arabic(root) if _HAS_NLP else root
        doc_ids = self._root_index.get(norm_root, set())

        results = []
        for doc_id in list(doc_ids)[:limit]:
            doc = self._documents.get(doc_id, {})
            results.append({
                'doc_id': doc_id,
                'score': 1.0,
                'title': doc.get('title', doc.get('title_ar', '')),
                'title_ar': doc.get('title_ar', ''),
                'source': doc.get('source', ''),
            })
        return results

    def search_fuzzy(self, query: str, threshold: float = 0.7, limit: int = 20) -> List[Dict]:
        """
        Fuzzy search across the index.
        Handles hamza variants, ta marbuta, alef forms automatically.
        """
        fuzzy_q = fuzzy_normalize(query)
        doc_scores: Dict[int, float] = defaultdict(float)

        # Check all fuzzy index keys
        for key, doc_ids in self._fuzzy_index.items():
            sim = arabic_fuzzy_match(fuzzy_q, key, threshold)
            if sim >= threshold:
                for doc_id in doc_ids:
                    doc_scores[doc_id] = max(doc_scores[doc_id], sim)

        ranked = sorted(doc_scores.items(), key=lambda x: x[1], reverse=True)
        results = []
        for doc_id, score in ranked[:limit]:
            doc = self._documents.get(doc_id, {})
            results.append({
                'doc_id': doc_id,
                'score': round(score, 3),
                'title': doc.get('title', doc.get('title_ar', '')),
                'title_ar': doc.get('title_ar', ''),
            })
        return results

    @property
    def document_count(self) -> int:
        return self._doc_count

    @property
    def term_count(self) -> int:
        return len(self._index)


def build_index_from_incidents(incidents_path: str) -> ArabicSearchIndex:
    """
    Build search index from an incidents.json file.
    """
    index = ArabicSearchIndex()

    with open(incidents_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, dict):
        items = data.get('incidents', data.get('entries', data.get('events', [])))
    elif isinstance(data, list):
        items = data
    else:
        items = []

    for i, item in enumerate(items):
        index.add_document(i, item)

    return index


def build_index_from_feed(feed_ar_path: str, feed_en_path: Optional[str] = None) -> ArabicSearchIndex:
    """
    Build search index from Arabic (and optionally English) feed JSON files.
    """
    index = ArabicSearchIndex()
    doc_id = 0

    # Index Arabic feed
    with open(feed_ar_path, 'r', encoding='utf-8') as f:
        ar_data = json.load(f)
    ar_entries = ar_data.get('entries', []) if isinstance(ar_data, dict) else ar_data
    for entry in ar_entries:
        index.add_document(doc_id, entry)
        doc_id += 1

    # Index English feed if provided
    if feed_en_path and os.path.exists(feed_en_path):
        with open(feed_en_path, 'r', encoding='utf-8') as f:
            en_data = json.load(f)
        en_entries = en_data.get('entries', en_data.get('incidents', []))
        if isinstance(en_entries, list):
            for entry in en_entries:
                index.add_document(doc_id, entry)
                doc_id += 1

    return index


# ===========================================================================
# CLI INTERFACE
# ===========================================================================

def main():
    """
    CLI for Arabic search.
    Usage:
        echo '{"query": "حزب الله"}' | python arabic_search.py --index incidents.json
        echo '{"query": "Hezbollah", "fuzzy": true}' | python arabic_search.py --index incidents.json
        echo '{"root": "حرب"}' | python arabic_search.py --index incidents.json
    """
    import argparse
    parser = argparse.ArgumentParser(description='Arabic search for Gulf Watch')
    parser.add_argument('--index', type=str, required=True,
                        help='Path to incidents/feed JSON to index')
    parser.add_argument('--feed-en', type=str, default=None,
                        help='Path to English feed JSON for cross-language search')
    args = parser.parse_args()

    # Build index
    if args.feed_en:
        index = build_index_from_feed(args.index, args.feed_en)
    else:
        index = build_index_from_incidents(args.index)

    sys.stderr.write(f"[INFO] Indexed {index.document_count} documents, {index.term_count} terms\n")

    # Read query from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.stderr.write("[ERROR] Invalid JSON on stdin\n")
        sys.exit(1)

    query = input_data.get('query', '')
    root = input_data.get('root', '')
    fuzzy = input_data.get('fuzzy', False)
    limit = input_data.get('limit', 20)

    if root:
        results = index.search_by_root(root, limit=limit)
    elif fuzzy:
        results = index.search_fuzzy(query, limit=limit)
    else:
        results = index.search(query, limit=limit, fuzzy=True)

    output = {
        'query': query or root,
        'total_results': len(results),
        'results': results,
    }

    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write('\n')
    sys.exit(0)


if __name__ == '__main__':
    main()
