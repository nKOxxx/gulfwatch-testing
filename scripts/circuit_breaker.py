#!/usr/bin/env python3
"""
Circuit Breaker Algorithm for Gulf Watch
Prevents duplicate events and filters historical recaps
"""

import hashlib
import re
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple
import json

class CircuitBreaker:
    """
    Prevents data bloat by:
    1. Deduplicating events (same incident from multiple sources)
    2. Filtering historical recaps (articles summarizing past events)
    3. Confidence scoring for each event
    """
    
    def __init__(self, existing_events: List[Dict] = None):
        # Store event signatures for deduplication
        self.event_signatures = {}
        self.existing_events = existing_events or []
        self._id_counter = 0  # Counter to prevent ID collisions
        
        # Build index of existing events
        for event in self.existing_events:
            sig = self._generate_signature(event)
            self.event_signatures[sig] = event
    
    def _generate_signature(self, event: Dict) -> str:
        """Generate unique signature for an event"""
        # Combine key fields for deduplication
        title = event.get('title', '').lower()
        location = event.get('location', '').lower()
        
        # Extract location keywords (city names, regions)
        location_keywords = self._extract_location_keywords(location)
        
        # Extract incident type (missile, strike, attack, etc.)
        incident_type = self._extract_incident_type(title)
        
        # Create signature from normalized components
        sig_data = f"{incident_type}:{location_keywords}:{event.get('date', '')}"
        return hashlib.md5(sig_data.encode()).hexdigest()[:16]
    
    def _extract_location_keywords(self, text: str) -> str:
        """Extract location keywords from text"""
        # Common Gulf region locations
        locations = [
            'tehran', 'iran', 'israel', 'gaza', 'lebanon', 'beirut',
            'baghdad', 'iraq', 'syria', 'damascus', 'yemen', 'saudi',
            'uae', 'dubai', 'qatar', 'bahrain', 'kuwait', 'oman',
            'gulf', 'red sea', 'mediterranean', 'strait of hormuz'
        ]
        
        text_lower = text.lower()
        found = [loc for loc in locations if loc in text_lower]
        return ','.join(sorted(found)) if found else 'unknown'
    
    def _extract_incident_type(self, title: str) -> str:
        """Extract incident type from title"""
        title_lower = title.lower()
        
        # Incident type patterns
        patterns = {
            'missile': ['missile', 'rocket', 'ballistic'],
            'airstrike': ['air strike', 'airstrike', 'bombing', 'bombed'],
            'drone': ['drone', 'uav', 'suicide drone'],
            'naval': ['ship', 'vessel', 'maritime', 'navy', 'houthi'],
            'cyber': ['cyber', 'hack', 'cyberattack'],
            'ground': ['ground', 'infantry', 'troop', 'clash'],
            'explosion': ['explosion', 'blast', 'exploded'],
            'raid': ['raid', 'operation', 'strike']
        }
        
        for incident_type, keywords in patterns.items():
            if any(kw in title_lower for kw in keywords):
                return incident_type
        
        return 'incident'
    
    def _calculate_confidence(self, article: Dict) -> str:
        """
        Calculate confidence level for an incident
        Returns: 'VERIFIED' | 'LIKELY' | 'PARTIAL' | 'OSINT'
        
        Scoring:
        - Government source: +40 pts
        - Major news outlet: +30 pts  
        - Cross-verification (multiple sources): +20 pts
        - Recent (< 6h): +10 pts
        """
        score = 0
        source = article.get('source', '').lower()
        
        # Government sources (highest credibility)
        gov_keywords = ['ministry', 'defence', 'defense', 'military', 'army', 'idf', 'forces', 'government']
        if any(kw in source for kw in gov_keywords):
            score += 40
        
        # Major news outlets
        major_news = ['reuters', 'bbc', 'associated press', 'al jazeera', 'france24', 'dw']
        if any(news in source for news in major_news):
            score += 30
        
        # Regional news
        regional_news = ['national', 'times of israel', 'jerusalem post', 'gulf news', 'arab news']
        if any(news in source for news in regional_news):
            score += 20
        
        # Check for cross-verification indicators in title
        title = article.get('title', '').lower()
        verification_indicators = [
            'confirmed', 'verify', 'officials say', 'authorities say',
            'according to', 'reported that', 'sources say'
        ]
        if any(ind in title for ind in verification_indicators):
            score += 15
        
        # Recency bonus
        try:
            date_str = article.get('date', '')
            if date_str:
                article_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                hours_ago = (datetime.now() - article_date).total_seconds() / 3600
                if hours_ago < 6:
                    score += 10
                elif hours_ago < 24:
                    score += 5
        except (ValueError, TypeError, KeyError):
            pass

        # Map score to confidence level
        if score >= 70:
            return 'VERIFIED'
        elif score >= 50:
            return 'LIKELY'
        elif score >= 30:
            return 'PARTIAL'
        else:
            return 'OSINT'
    
    def _is_historical_recap(self, article: Dict) -> Tuple[bool, float]:
        """
        Detect if article is a historical recap vs new event
        Returns: (is_recap, confidence_score)
        """
        title = article.get('title', '')
        content = article.get('content', '')
        text = f"{title} {content}".lower()
        
        # Historical recap indicators - strengthened
        recap_phrases = [
            # Strong indicators (score +2)
            ('weekly roundup', 2), ('weekly wrap', 2), ('weekly summary', 2),
            ('death toll rises', 2), ('casualties mount', 2), ('toll reaches', 2),
            ('total now stands', 2), ('cumulative total', 2),
            
            # Medium indicators (score +1.5)
            ('recap', 1.5), ('roundup', 1.5), ('wrap-up', 1.5), ('wrap up', 1.5),
            ('summary of', 1.5), ('this week', 1.5), ('last week', 1.5),
            
            # Standard indicators (score +1)
            ('update', 1), ('summary', 1), ('wrap', 1),
            ('over the past', 1), ('in the last', 1), ('week of', 1),
            ('since january', 1), ('since february', 1), ('since march', 1),
            ('latest count', 1), ('total now', 1), ('cumulative', 1),
            ('have died', 1), ('killed in', 1),  # often in casualty roundups
        ]
        
        # Calculate weighted recap score
        recap_score = 0
        for phrase, weight in recap_phrases:
            if phrase in text:
                recap_score += weight
        
        # Check for multiple locations mentioned (indicator of recap)
        locations_mentioned = len([loc for loc in self._extract_location_keywords(text).split(',') if loc])
        if locations_mentioned > 3:
            recap_score += 1.5
        
        # Check for time range indicators
        time_patterns = [
            r'\d+\s+(days?|weeks?|months?)',
            r'since\s+(january|february|march|april|may|june|july|august|september|october|november|december)',
            r'over\s+the\s+past',
            r'in\s+the\s+last\s+\d+'
        ]
        
        for pattern in time_patterns:
            if re.search(pattern, text):
                recap_score += 1
        
        # Determine if recap based on score - lowered threshold for better detection
        is_recap = recap_score >= 2.5
        confidence = min(recap_score / 5, 1.0)  # Normalize to 0-1
        
        return is_recap, confidence
    
    def _similarity_score(self, event1: Dict, event2: Dict) -> float:
        """Calculate similarity between two events"""
        # Title similarity
        title1 = event1.get('title', '').lower()
        title2 = event2.get('title', '').lower()
        title_sim = SequenceMatcher(None, title1, title2).ratio()
        
        # Location similarity
        loc1 = event1.get('location', '').lower()
        loc2 = event2.get('location', '').lower()
        loc_sim = SequenceMatcher(None, loc1, loc2).ratio()
        
        # Weighted average
        return (title_sim * 0.6) + (loc_sim * 0.4)
    
    def process_article(self, article: Dict) -> Optional[Dict]:
        """
        Process a new article through the circuit breaker
        Returns: Event dict if new, None if duplicate/recap
        """
        # Step 1: Check if historical recap
        is_recap, recap_confidence = self._is_historical_recap(article)
        
        if is_recap and recap_confidence > 0.6:
            print(f"[CIRCUIT BREAKER] Filtered RECAP: {article.get('title', '')[:60]}...")
            return None
        
        # Step 2: Create event structure
        event = {
            'id': self._generate_id(),
            'title': article.get('title', ''),
            'location': article.get('location', ''),
            'date': article.get('date', datetime.now().isoformat()),
            'source': article.get('source', ''),
            'url': article.get('url', ''),
            'incident_type': self._extract_incident_type(article.get('title', '')),
            'coordinates': article.get('coordinates', {}),
            'casualties': article.get('casualties', {}),
            'confidence': self._calculate_confidence(article),
            'is_recap': is_recap,
            'recap_confidence': recap_confidence,
            'added_at': datetime.now().isoformat()
        }
        
        # Step 3: Check for duplicates
        signature = self._generate_signature(event)
        
        if signature in self.event_signatures:
            existing = self.event_signatures[signature]
            similarity = self._similarity_score(event, existing)
            
            if similarity > 0.8:
                print(f"[CIRCUIT BREAKER] Filtered DUPLICATE: {event['title'][:60]}...")
                print(f"                    Matches existing: {existing['title'][:60]}...")
                return None
        
        # Step 4: Check for near-duplicates (high similarity)
        # Raised threshold from 0.85 to 0.92 to avoid filtering similar structured events
        for existing in self.existing_events:
            similarity = self._similarity_score(event, existing)
            if similarity > 0.92:
                print(f"[CIRCUIT BREAKER] Filtered NEAR-DUPLICATE: {event['title'][:60]}...")
                print(f"                    Similarity: {similarity:.2%}")
                return None
        
        # Step 5: Add to index
        self.event_signatures[signature] = event
        self.existing_events.append(event)
        
        print(f"[CIRCUIT BREAKER] ACCEPTED: {event['title'][:60]}...")
        print(f"                    Type: {event['incident_type']}, Location: {event['location'][:40]}")
        
        return event
    
    def _generate_id(self) -> str:
        """Generate unique event ID with counter to prevent collisions"""
        timestamp = int(datetime.now().timestamp() * 1000)
        self._id_counter += 1
        return f"GW-{timestamp}-{self._id_counter:04d}"
    
    def get_stats(self) -> Dict:
        """Get circuit breaker statistics"""
        return {
            'total_events': len(self.existing_events),
            'signatures': len(self.event_signatures),
            'unique_incident_types': len(set(e['incident_type'] for e in self.existing_events)),
            'recaps_filtered': len([e for e in self.existing_events if e.get('is_recap')])
        }


# Example usage and testing
if __name__ == "__main__":
    print("=" * 60)
    print("CIRCUIT BREAKER ALGORITHM - TEST")
    print("=" * 60)
    
    # Initialize with empty database
    cb = CircuitBreaker()
    
    # Test Case 1: New event (should be accepted)
    article1 = {
        'title': 'US missile strike targets military base in Tehran',
        'location': 'Tehran, Iran',
        'date': '2026-03-10T12:00:00Z',
        'source': 'Reuters',
        'content': 'A US Tomahawk missile struck a military installation in Tehran today.',
        'coordinates': {'lat': 35.6892, 'lng': 51.3890}
    }
    
    print("\nTest 1: NEW EVENT")
    result1 = cb.process_article(article1)
    assert result1 is not None, "New event should be accepted"
    print(f"✓ Event accepted with ID: {result1['id']}")
    
    # Test Case 2: Duplicate (should be rejected)
    article2 = {
        'title': 'US missile strike hits military base in Tehran',  # Similar title
        'location': 'Tehran, Iran',  # Same location
        'date': '2026-03-10T12:30:00Z',
        'source': 'BBC',
        'content': 'US forces launched a missile attack on a Tehran military base.'
    }
    
    print("\nTest 2: DUPLICATE EVENT")
    result2 = cb.process_article(article2)
    assert result2 is None, "Duplicate should be rejected"
    print("✓ Duplicate correctly filtered")
    
    # Test Case 3: Historical recap (should be rejected)
    article3 = {
        'title': 'Weekly Roundup: Death toll rises to 500 in ongoing conflict',
        'location': 'Multiple locations',
        'date': '2026-03-10T14:00:00Z',
        'source': 'Al Jazeera',
        'content': 'Over the past week, fighting has intensified across the region with casualties mounting.'
    }
    
    print("\nTest 3: HISTORICAL RECAP")
    result3 = cb.process_article(article3)
    assert result3 is None, "Recap should be rejected"
    print("✓ Historical recap correctly filtered")
    
    # Test Case 4: Different event (should be accepted)
    article4 = {
        'title': 'Israeli airstrike targets weapons depot in Gaza',
        'location': 'Gaza Strip',
        'date': '2026-03-10T15:00:00Z',
        'source': 'Times of Israel',
        'content': 'Israeli forces conducted an airstrike on a weapons storage facility.'
    }
    
    print("\nTest 4: DIFFERENT EVENT")
    result4 = cb.process_article(article4)
    assert result4 is not None, "Different event should be accepted"
    print(f"✓ Different event accepted with ID: {result4['id']}")
    
    # Show stats
    print("\n" + "=" * 60)
    print("CIRCUIT BREAKER STATS")
    print("=" * 60)
    stats = cb.get_stats()
    for key, value in stats.items():
        print(f"  {key}: {value}")
    
    print("\n✅ ALL TESTS PASSED")
