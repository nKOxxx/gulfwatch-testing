# ============================================================================
# CHATTER v2 - Social Media & News Intelligence
# Sentiment analysis and trend detection
#
# v2 upgrades (Marcus Lindgren):
#   - Transformer-based sentiment analysis (multilingual model via transformers)
#   - Keyword-based kept as fallback when ML unavailable
#   - Stance detection framework (support/oppose/neutral on actors)
#   - data_source field on all outputs (R14)
#   - Specific exception handling, no bare except (R17)
# ============================================================================

import json
import re
import sys
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from collections import Counter

logger = logging.getLogger(__name__)

# ============================================================================
# ML SENTIMENT MODEL (graceful degradation)
# ============================================================================

_sentiment_pipeline = None
_ml_sentiment_available = False

def _load_sentiment_model():
    """Load transformer-based multilingual sentiment model.
    Uses nlptown/bert-base-multilingual-uncased-sentiment (5-star rating)
    which supports English, Arabic, and other languages.
    Falls back to keyword-based if unavailable.
    """
    global _sentiment_pipeline, _ml_sentiment_available
    try:
        from transformers import pipeline
        _sentiment_pipeline = pipeline(
            "sentiment-analysis",
            model="nlptown/bert-base-multilingual-uncased-sentiment",
            truncation=True,
            max_length=512
        )
        _ml_sentiment_available = True
        logger.info("CHATTER v2: ML sentiment model loaded (bert-base-multilingual)")
        return True
    except ImportError:
        logger.warning("CHATTER v2: transformers library not installed. Using keyword fallback.")
        _ml_sentiment_available = False
        return False
    except (OSError, RuntimeError) as e:
        logger.warning(f"CHATTER v2: Sentiment model load failed ({e}). Using keyword fallback.")
        _ml_sentiment_available = False
        return False

# Attempt to load on import
_load_sentiment_model()

# ============================================================================
# KEYWORD-BASED SENTIMENT (fallback)
# ============================================================================

POSITIVE_WORDS = {
    'victory', 'success', 'peace', 'deal', 'agreement', 'alliance', 'support',
    'strong', 'win', 'advance', 'achievement', 'celebration', 'historic',
    'cooperation', 'collaboration', 'partnership', 'stability', 'progress',
    'development', 'growth', 'prosperity', 'security', 'defense', 'protection',
    'triumph', 'liberation'
}
NEGATIVE_WORDS = {
    'attack', 'threat', 'war', 'crisis', 'conflict', 'death', 'killed',
    'destroyed', 'terrorism', 'explosion', 'missile', 'drone', 'strike',
    'violence', 'terror', 'warning', 'alert', 'emergency', 'disaster',
    'tragedy', 'casualties', 'injured', 'detained', 'arrested', 'sanctions',
    'condemn', 'rejected'
}
CRITICAL_WORDS = {
    'nuclear', 'ballistic', 'missile', 'launch', 'weapon', 'military', 'army',
    'navy', 'air force', 'corvette', 'frigate', 'destroyer', 'submarine',
    'aircraft carrier', 'drone', 'uav', 'rocket', 'artillery', 'tank',
    'soldier', 'troops', 'warfighter'
}

def analyze_sentiment_keyword(text: str) -> Dict[str, Any]:
    """Analyze sentiment using keyword matching (fallback method)."""
    text_lower = text.lower()
    words = set(text_lower.split())

    positive = len(words & POSITIVE_WORDS)
    negative = len(words & NEGATIVE_WORDS)
    critical = len(words & CRITICAL_WORDS)

    # Calculate scores
    sentiment_score = (positive - negative) / max(1, len(words)) * 100
    critical_score = critical * 10

    if sentiment_score > 10:
        sentiment = 'positive'
    elif sentiment_score < -10:
        sentiment = 'negative'
    else:
        sentiment = 'neutral'

    return {
        'sentiment': sentiment,
        'sentimentScore': round(sentiment_score, 1),
        'criticalScore': min(100, critical_score),
        'positiveTerms': list(words & POSITIVE_WORDS),
        'negativeTerms': list(words & NEGATIVE_WORDS),
        'criticalTerms': list(words & CRITICAL_WORDS),
        'method': 'keyword'
    }

# ============================================================================
# TRANSFORMER-BASED SENTIMENT
# ============================================================================

def analyze_sentiment_ml(text: str) -> Dict[str, Any]:
    """Analyze sentiment using transformer model.
    The nlptown model outputs 1-5 star ratings:
      1-2 stars = negative, 3 = neutral, 4-5 = positive
    """
    if not _ml_sentiment_available or _sentiment_pipeline is None:
        return analyze_sentiment_keyword(text)

    try:
        result = _sentiment_pipeline(text[:512])[0]
        label = result['label']  # e.g. "1 star", "5 stars"
        confidence = result['score']

        # Parse star rating
        stars = int(label.split()[0])

        # Map to sentiment
        if stars <= 2:
            sentiment = 'negative'
            sentiment_score = -((3 - stars) / 2) * 100  # -50 to -100
        elif stars >= 4:
            sentiment = 'positive'
            sentiment_score = ((stars - 3) / 2) * 100  # 50 to 100
        else:
            sentiment = 'neutral'
            sentiment_score = 0

        # Still compute critical terms (ML model doesn't detect these)
        text_lower = text.lower()
        words = set(text_lower.split())
        critical = len(words & CRITICAL_WORDS)
        critical_score = critical * 10

        return {
            'sentiment': sentiment,
            'sentimentScore': round(sentiment_score, 1),
            'confidence': round(confidence, 4),
            'stars': stars,
            'criticalScore': min(100, critical_score),
            'criticalTerms': list(words & CRITICAL_WORDS),
            'method': 'transformer'
        }
    except (RuntimeError, ValueError, IndexError) as e:
        logger.warning(f"CHATTER v2: ML sentiment failed for text, falling back: {e}")
        return analyze_sentiment_keyword(text)

def analyze_sentiment(text: str) -> Dict[str, Any]:
    """Analyze sentiment -- uses ML when available, keyword fallback otherwise."""
    if _ml_sentiment_available:
        return analyze_sentiment_ml(text)
    return analyze_sentiment_keyword(text)

# ============================================================================
# STANCE DETECTION FRAMEWORK
# ============================================================================

STANCE_ACTORS = {
    'iran': ['iran', 'iranian', 'irgc', 'tehran', 'khamenei', 'raisi'],
    'israel': ['israel', 'israeli', 'idf', 'netanyahu', 'tel aviv', 'jerusalem'],
    'saudi': ['saudi', 'arabia', 'ksa', 'riyadh', 'mbs', 'bin salman'],
    'us': ['us', 'usa', 'united states', 'american', 'washington', 'pentagon', 'biden'],
    'houthis': ['houthi', 'houthis', 'ansar allah'],
    'hezbollah': ['hezbollah', 'hizbullah', 'nasrallah'],
    'russia': ['russia', 'russian', 'moscow', 'putin', 'kremlin'],
    'uae': ['uae', 'emirates', 'emirati', 'abu dhabi'],
}

SUPPORT_INDICATORS = {
    'support', 'supports', 'backed', 'backs', 'aid', 'aids', 'ally', 'allies',
    'alliance', 'cooperation', 'cooperate', 'defend', 'defends', 'endorsed',
    'praise', 'praised', 'welcome', 'welcomed', 'approved', 'partnership'
}
OPPOSE_INDICATORS = {
    'condemn', 'condemns', 'condemned', 'oppose', 'opposes', 'opposed',
    'sanction', 'sanctions', 'sanctioned', 'attack', 'attacks', 'attacked',
    'strike', 'strikes', 'threaten', 'threatens', 'threatened', 'reject',
    'rejects', 'rejected', 'denounce', 'denounced', 'warn', 'warns', 'warned'
}

def detect_stance(text: str) -> List[Dict]:
    """Detect stance (support/oppose/neutral) toward actors mentioned in text."""
    text_lower = text.lower()
    words = set(text_lower.split())
    stances = []

    # Find which actors are mentioned
    mentioned_actors = []
    for actor_id, keywords in STANCE_ACTORS.items():
        for keyword in keywords:
            if keyword in text_lower:
                mentioned_actors.append(actor_id)
                break

    if len(mentioned_actors) < 1:
        return stances

    # Detect stance indicators
    support_count = len(words & SUPPORT_INDICATORS)
    oppose_count = len(words & OPPOSE_INDICATORS)

    for actor in mentioned_actors:
        if support_count > oppose_count:
            stance = 'support'
            confidence = min(0.9, 0.5 + (support_count - oppose_count) * 0.1)
        elif oppose_count > support_count:
            stance = 'oppose'
            confidence = min(0.9, 0.5 + (oppose_count - support_count) * 0.1)
        else:
            stance = 'neutral'
            confidence = 0.4

        stances.append({
            'actor': actor,
            'stance': stance,
            'confidence': round(confidence, 3),
            'supportIndicators': list(words & SUPPORT_INDICATORS),
            'opposeIndicators': list(words & OPPOSE_INDICATORS)
        })

    return stances

# ============================================================================
# TREND DETECTION
# ============================================================================

def detect_trends(events: List[Dict], window_days: int = 7) -> List[Dict]:
    """Detect trending topics from events."""
    all_keywords = []
    for event in events:
        title = event.get('title', '').lower()
        words = [w for w in title.split() if len(w) > 4]
        all_keywords.extend(words)

    keyword_counts = Counter(all_keywords)

    trends = []
    for keyword, count in keyword_counts.most_common(20):
        if count >= 2:
            trends.append({
                'keyword': keyword,
                'count': count,
                'velocity': 'accelerating' if count > 5 else 'stable'
            })

    return trends

# ============================================================================
# SOURCE RELIABILITY
# ============================================================================

OFFICIAL_SOURCES = {
    'IRNA': {'country': 'IR', 'reliability': 0.6, 'bias': 'pro-government'},
    'PressTV': {'country': 'IR', 'reliability': 0.5, 'bias': 'pro-government'},
    'Al Jazeera': {'country': 'QA', 'reliability': 0.8, 'bias': 'neutral'},
    'Al Arabiya': {'country': 'SA', 'reliability': 0.8, 'bias': 'pro-government'},
    'Reuters': {'country': 'GB', 'reliability': 0.95, 'bias': 'neutral'},
    'AP': {'country': 'US', 'reliability': 0.95, 'bias': 'neutral'},
    'AFP': {'country': 'FR', 'reliability': 0.9, 'bias': 'neutral'},
    'MEE': {'country': 'UK', 'reliability': 0.75, 'bias': 'neutral'},
    'Twitter': {'country': 'US', 'reliability': 0.4, 'bias': 'mixed'},
    'Telegram': {'country': 'RU', 'reliability': 0.5, 'bias': 'mixed'},
    'ISNA': {'country': 'IR', 'reliability': 0.6, 'bias': 'pro-government'},
}

def assess_source_reliability(source: str) -> Dict:
    """Assess reliability of a news source."""
    source_info = OFFICIAL_SOURCES.get(source, {'country': 'unknown', 'reliability': 0.5, 'bias': 'unknown'})
    return {
        'source': source,
        'reliability': source_info['reliability'],
        'bias': source_info['bias'],
        'country': source_info['country']
    }

# ============================================================================
# HASHTAG EXTRACTION
# ============================================================================

def extract_hashtags(text: str) -> List[str]:
    """Extract hashtags from text."""
    return re.findall(r'#(\w+)', text)

# ============================================================================
# MAIN PROCESSING
# ============================================================================

def process_social_intelligence(events: List[Dict], data_source: str = "live") -> Dict:
    """Process events for social media intelligence.
    Args:
        events: List of event dictionaries
        data_source: "live" or "mock" -- propagated to output per R14
    """
    sentiments = []
    sources = []
    all_hashtags = []
    all_stances = []

    for event in events:
        # Analyze sentiment
        title = event.get('title', '')
        sentiment = analyze_sentiment(title)
        sentiments.append({**event, 'sentiment': sentiment})

        # Detect stance
        stances = detect_stance(title)
        if stances:
            all_stances.extend(stances)

        # Assess source
        source = event.get('source', 'Unknown')
        source_info = assess_source_reliability(source)
        sources.append(source_info)

        # Extract hashtags
        hashtags = extract_hashtags(event.get('description', ''))
        all_hashtags.extend(hashtags)

    # Aggregate sentiment distribution
    sentiment_dist = {
        'positive': sum(1 for s in sentiments if s['sentiment']['sentiment'] == 'positive'),
        'negative': sum(1 for s in sentiments if s['sentiment']['sentiment'] == 'negative'),
        'neutral': sum(1 for s in sentiments if s['sentiment']['sentiment'] == 'neutral')
    }

    # Source distribution
    source_dist = Counter(s['source'] for s in sources)

    # Trending hashtags
    hashtag_counts = Counter(all_hashtags)
    trending_hashtags = [{'tag': tag, 'count': count} for tag, count in hashtag_counts.most_common(10)]

    # Detect trends
    trends = detect_trends(events)

    # Aggregate stance
    stance_summary = {}
    for stance in all_stances:
        actor = stance['actor']
        if actor not in stance_summary:
            stance_summary[actor] = {'support': 0, 'oppose': 0, 'neutral': 0}
        stance_summary[actor][stance['stance']] += 1

    return {
        'module': 'chatter',
        'version': '2.0.0',
        'data_source': data_source,
        'ml_sentiment_enabled': _ml_sentiment_available,
        'totalAnalyzed': len(events),
        'sentimentDistribution': sentiment_dist,
        'stanceSummary': stance_summary,
        'topSources': dict(source_dist.most_common(10)),
        'trendingHashtags': trending_hashtags,
        'trends': trends[:10],
        'criticalEvents': [e for e in events if e.get('severity') == 'critical'][:5],
        'alerts': [s for s in sentiments if s['sentiment']['criticalScore'] > 50][:10]
    }

# ============================================================================
# STDIN/STDOUT PROTOCOL (per architecture contract)
# ============================================================================

def main():
    """Entry point for module stdin/stdout protocol."""
    try:
        input_data = json.loads(sys.stdin.read())
        events = input_data.get('events', [])
        config = input_data.get('config', {})

        data_source = config.get('dataSource', 'live')
        limit = config.get('limit', 50)
        sentiment_filter = config.get('sentiment')

        filtered = events[:limit]

        import time
        start = time.time()
        result = process_social_intelligence(filtered, data_source=data_source)
        duration_ms = int((time.time() - start) * 1000)

        # Filter by sentiment if requested
        if sentiment_filter:
            result['filteredAlerts'] = [
                e for e in result.get('alerts', [])
                if e['sentiment']['sentiment'] == sentiment_filter
            ]

        output = {
            'module': 'chatter',
            'version': '2.0.0',
            'dataSource': data_source,
            'data': result,
            'durationMs': duration_ms,
            'error': None
        }

        json.dump(output, sys.stdout)
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"CHATTER: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"CHATTER: Missing required field: {e}", file=sys.stderr)
        sys.exit(1)
    except (IOError, OSError) as e:
        print(f"CHATTER: I/O error: {e}", file=sys.stderr)
        sys.exit(1)

# ============================================================================
# FLASK API (legacy compatibility)
# ============================================================================

def lambda_handler(event, context):
    """AWS Lambda / Vercel handler."""
    from flask import jsonify, request

    try:
        with open('incidents.json', 'r') as f:
            incidents = json.load(f)
    except FileNotFoundError:
        incidents = []
    except json.JSONDecodeError as e:
        logger.error(f"CHATTER: Failed to parse incidents.json: {e}")
        incidents = []

    limit = int(request.args.get('limit', 50))
    sentiment = request.args.get('sentiment', None)

    filtered = incidents[:limit]

    result = process_social_intelligence(filtered, data_source="live")

    if sentiment:
        filtered_events = [e for e in result.get('alerts', []) if e['sentiment']['sentiment'] == sentiment]
        result['filteredAlerts'] = filtered_events

    return jsonify(result)

if __name__ == '__main__':
    main()
