#!/usr/bin/env python3
"""
Cross-Source Verification Engine for Gulf Watch
Groups incidents from multiple sources and calculates verification confidence
"""

import json
import hashlib
import re
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

class CrossSourceVerification:
    """
    Identifies the same incident reported by multiple sources,
    groups them, and calculates verification confidence.
    """
    
    def __init__(self, incidents: List[Dict] = None):
        self.incidents = incidents or []
        self.groups = []  # List of incident groups
        self.source_weights = {
            'government': 50,
            'major_news': 40,
            'regional_news': 30,
            'social': 10
        }
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        return re.sub(r'[^\w\s]', '', text.lower()).strip()
    
    def _extract_location_key(self, incident: Dict) -> str:
        """Extract location key for grouping"""
        location = incident.get('location', {})
        country = location.get('country', '').lower()
        city = location.get('city', '').lower() if location.get('city') else ''
        
        # Extract location from title as fallback
        if not country:
            title = incident.get('title', '').lower()
            locations = ['tehran', 'iran', 'israel', 'gaza', 'lebanon', 'beirut',
                        'baghdad', 'iraq', 'syria', 'damascus', 'yemen', 'saudi',
                        'uae', 'dubai', 'abu dhabi', 'qatar', 'doha', 'bahrain', 
                        'kuwait', 'oman', 'muscat', 'jordan', 'amman']
            for loc in locations:
                if loc in title:
                    return loc
        
        return f"{city}_{country}" if city else country
    
    def _extract_incident_type(self, incident: Dict) -> str:
        """Extract incident type from title"""
        title = incident.get('title', '').lower()
        
        patterns = {
            'missile': ['missile', 'rocket', 'ballistic', 'projectile'],
            'airstrike': ['air strike', 'airstrike', 'bombing', 'bombed'],
            'drone': ['drone', 'uav', 'suicide drone'],
            'naval': ['ship', 'vessel', 'maritime', 'navy', 'houthi'],
            'cyber': ['cyber', 'hack', 'cyberattack'],
            'ground': ['ground', 'infantry', 'troop', 'clash'],
            'explosion': ['explosion', 'blast', 'exploded'],
            'raid': ['raid', 'operation', 'strike']
        }
        
        for incident_type, keywords in patterns.items():
            if any(kw in title for kw in keywords):
                return incident_type
        
        return 'incident'
    
    def _calculate_similarity(self, inc1: Dict, inc2: Dict) -> float:
        """Calculate similarity between two incidents"""
        # Title similarity
        title1 = self._normalize_text(inc1.get('title', ''))
        title2 = self._normalize_text(inc2.get('title', ''))
        title_sim = SequenceMatcher(None, title1, title2).ratio()
        
        # Location similarity
        loc1 = self._extract_location_key(inc1)
        loc2 = self._extract_location_key(inc2)
        loc_sim = 1.0 if loc1 == loc2 and loc1 else 0.5 if loc1 and loc2 else 0.0
        
        # Type similarity
        type1 = self._extract_incident_type(inc1)
        type2 = self._extract_incident_type(inc2)
        type_sim = 1.0 if type1 == type2 else 0.0
        
        # Time proximity (within 6 hours = high similarity)
        try:
            t1 = datetime.fromisoformat(inc1.get('published', '').replace('Z', '+00:00'))
            t2 = datetime.fromisoformat(inc2.get('published', '').replace('Z', '+00:00'))
            time_diff = abs((t1 - t2).total_seconds()) / 3600  # hours
            time_sim = max(0, 1 - (time_diff / 6))  # 0-1 scale, 6h = 0
        except (ValueError, TypeError, KeyError):
            time_sim = 0.5  # unknown time
        
        # Weighted average
        similarity = (title_sim * 0.5) + (loc_sim * 0.3) + (type_sim * 0.1) + (time_sim * 0.1)
        return similarity
    
    def _get_source_tier(self, incident: Dict) -> str:
        """Get source tier for weighting"""
        if incident.get('is_government'):
            return 'government'
        
        source = incident.get('source', '').lower()
        major_news = ['reuters', 'bbc', 'associated press', 'ap', 'al jazeera', 
                     'france24', 'dw', 'times of israel', 'jerusalem post']
        
        if any(mn in source for mn in major_news):
            return 'major_news'
        
        regional = ['the national', 'gulf news', 'khaleej times', 'arab news',
                   'egypt today', 'jordan times', 'defense news']
        if any(rn in source for rn in regional):
            return 'regional_news'
        
        return 'social'
    
    def _calculate_verification_score(self, group: List[Dict]) -> Tuple[str, int]:
        """
        Calculate verification score for a group of incidents
        Returns: (badge, score)
        """
        if not group:
            return 'UNCONFIRMED', 0
        
        # Source quality (max 50 pts)
        source_score = 0
        tiers = set()
        for inc in group:
            tier = self._get_source_tier(inc)
            tiers.add(tier)
            source_score = max(source_score, self.source_weights.get(tier, 10))
        
        # Cross-verification (max 35 pts)
        num_sources = len(set(inc.get('source') for inc in group))
        if num_sources >= 3:
            verification_score = 35
        elif num_sources == 2:
            verification_score = 25
        else:
            verification_score = 10
        
        # Government bonus (max 15 pts)
        gov_count = sum(1 for inc in group if inc.get('is_government'))
        gov_score = min(15, gov_count * 10)
        
        # Total score
        total_score = source_score + verification_score + gov_score
        
        # Determine badge
        if total_score >= 90:
            badge = 'VERIFIED'
        elif total_score >= 70:
            badge = 'LIKELY'
        elif total_score >= 50:
            badge = 'PARTIAL'
        else:
            badge = 'UNCONFIRMED'
        
        return badge, total_score
    
    def group_incidents(self, similarity_threshold: float = 0.75) -> List[Dict]:
        """
        Group incidents by similarity
        Returns list of groups with verification data
        """
        if not self.incidents:
            return []
        
        # Sort by timestamp (newest first)
        sorted_incidents = sorted(
            self.incidents,
            key=lambda x: x.get('published', ''),
            reverse=True
        )
        
        used = set()
        groups = []
        
        for i, incident in enumerate(sorted_incidents):
            if i in used:
                continue
            
            # Start new group
            group = [incident]
            used.add(i)
            
            # Find similar incidents
            for j, other in enumerate(sorted_incidents[i+1:], start=i+1):
                if j in used:
                    continue
                
                similarity = self._calculate_similarity(incident, other)
                if similarity >= similarity_threshold:
                    group.append(other)
                    used.add(j)
            
            # Calculate verification for group
            badge, score = self._calculate_verification_score(group)
            
            # Create group object
            group_obj = {
                'id': f"grp_{i:04d}",
                'primary_incident': group[0],
                'source_variants': group,
                'num_sources': len(set(inc.get('source') for inc in group)),
                'verification_badge': badge,
                'verification_score': score,
                'government_sources': [inc for inc in group if inc.get('is_government')],
                'news_sources': [inc for inc in group if not inc.get('is_government')],
                'location': self._extract_location_key(incident),
                'type': self._extract_incident_type(incident),
                'timestamp_range': {
                    'earliest': min(inc.get('published') for inc in group),
                    'latest': max(inc.get('published') for inc in group)
                }
            }
            
            groups.append(group_obj)
        
        self.groups = groups
        return groups
    
    def export_verified_incidents(self, output_file: str = 'public/verified_incidents.json'):
        """Export verified incidents with cross-source data"""
        if not self.groups:
            self.group_incidents()
        
        output = {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'total_groups': len(self.groups),
            'verification_summary': {
                'VERIFIED': len([g for g in self.groups if g['verification_badge'] == 'VERIFIED']),
                'LIKELY': len([g for g in self.groups if g['verification_badge'] == 'LIKELY']),
                'PARTIAL': len([g for g in self.groups if g['verification_badge'] == 'PARTIAL']),
                'UNCONFIRMED': len([g for g in self.groups if g['verification_badge'] == 'UNCONFIRMED'])
            },
            'groups': self.groups
        }
        
        with open(output_file, 'w') as f:
            json.dump(output, f, indent=2)
        
        print(f"Exported {len(self.groups)} verified groups to {output_file}")
        print(f"  VERIFIED: {output['verification_summary']['VERIFIED']}")
        print(f"  LIKELY: {output['verification_summary']['LIKELY']}")
        print(f"  PARTIAL: {output['verification_summary']['PARTIAL']}")
        print(f"  UNCONFIRMED: {output['verification_summary']['UNCONFIRMED']}")
        
        return output
    
    def update_incidents_with_verification(self, incidents_file: str = 'public/incidents.json'):
        """Add verification data to each incident in incidents.json"""
        if not self.groups:
            self.group_incidents()
        
        # Load current incidents
        with open(incidents_file, 'r') as f:
            data = json.load(f)
        
        incidents = data.get('incidents', [])
        
        # Create lookup from incident ID to verification data
        verification_map = {}
        for group in self.groups:
            verification_data = {
                'badge': group['verification_badge'],
                'score': group['verification_score'],
                'num_sources': group['num_sources'],
                'status': group['verification_badge']
            }
            # Map all incidents in this group to the same verification
            for variant in group['source_variants']:
                incident_id = variant.get('id')
                if incident_id:
                    verification_map[incident_id] = verification_data
        
        # Add verification to each incident
        updated_count = 0
        for incident in incidents:
            incident_id = incident.get('id')
            if incident_id in verification_map:
                incident['verification'] = verification_map[incident_id]
                updated_count += 1
        
        # Save updated incidents
        data['generated_at'] = datetime.now(timezone.utc).isoformat()
        with open(incidents_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\nUpdated {updated_count}/{len(incidents)} incidents with verification data")
        return data


def main():
    """Run cross-source verification on current incidents"""
    # Load incidents
    with open('public/incidents.json', 'r') as f:
        data = json.load(f)
    
    incidents = data.get('incidents', [])
    print(f"Processing {len(incidents)} incidents for cross-source verification...")
    
    # Create verifier
    verifier = CrossSourceVerification(incidents)
    
    # Group and verify
    groups = verifier.group_incidents(similarity_threshold=0.75)
    
    # Export
    verifier.export_verified_incidents()
    
    # Update incidents.json with verification data
    verifier.update_incidents_with_verification()
    
    # Show sample
    if groups:
        print("\nSample verified group:")
        sample = groups[0]
        print(f"  Badge: {sample['verification_badge']} ({sample['verification_score']} pts)")
        print(f"  Sources: {sample['num_sources']}")
        print(f"  Government: {len(sample['government_sources'])}")
        print(f"  Type: {sample['type']}")
        print(f"  Location: {sample['location']}")
        print(f"  Title: {sample['primary_incident']['title'][:60]}...")


if __name__ == '__main__':
    main()
