#!/usr/bin/env python3
"""
Generate Regional Statistics for Gulf Watch Testing
Aggregates incident data into regional and per-country summaries
"""

import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict
import re

# Country codes and names
COUNTRIES = {
    'iran': {'name': 'Iran', 'flag': '🇮🇷'},
    'israel': {'name': 'Israel', 'flag': '🇮🇱'},
    'palestine': {'name': 'Palestine', 'flag': '🇵🇸'},
    'gaza': {'name': 'Gaza', 'flag': '🇵🇸'},
    'lebanon': {'name': 'Lebanon', 'flag': '🇱🇧'},
    'syria': {'name': 'Syria', 'flag': '🇸🇾'},
    'yemen': {'name': 'Yemen', 'flag': '🇾🇪'},
    'saudi': {'name': 'Saudi Arabia', 'flag': '🇸🇦'},
    'uae': {'name': 'UAE', 'flag': '🇦🇪'},
    'jordan': {'name': 'Jordan', 'flag': '🇯🇴'},
    'iraq': {'name': 'Iraq', 'flag': '🇮🇶'},
    'kuwait': {'name': 'Kuwait', 'flag': '🇰🇼'},
    'bahrain': {'name': 'Bahrain', 'flag': '🇧🇭'},
    'qatar': {'name': 'Qatar', 'flag': '🇶🇦'},
    'oman': {'name': 'Oman', 'flag': '🇴🇲'}
}

# Keywords for incident classification
CLASSIFICATION_KEYWORDS = {
    'missile': ['missile', 'rocket', 'ballistic', 'intercepted', 'iron dome', 'patriot'],
    'airstrike': ['airstrike', 'air strike', 'bombing', 'bombed', 'warplanes', 'jets'],
    'drone': ['drone', 'uav', 'suicide drone', 'loitering munition', 'quadcopter'],
    'casualty': ['killed', 'dead', 'death', 'casualties', 'wounded', 'injured', 'martyred'],
    'military': ['soldier', 'military', 'army', 'forces', 'troops', 'idf', 'irgc'],
    'civilian': ['civilian', 'women', 'children', 'family', 'residents', 'people']
}

def classify_incident(title, content=''):
    """Classify incident type from title/content"""
    text = (title + ' ' + content).lower()
    
    incident_type = 'general'
    confidence = 0.5
    
    # Check for missile keywords
    if any(kw in text for kw in CLASSIFICATION_KEYWORDS['missile']):
        incident_type = 'missile'
        confidence = 0.9
    # Check for airstrike
    elif any(kw in text for kw in CLASSIFICATION_KEYWORDS['airstrike']):
        incident_type = 'airstrike'
        confidence = 0.85
    # Check for drone
    elif any(kw in text for kw in CLASSIFICATION_KEYWORDS['drone']):
        incident_type = 'drone'
        confidence = 0.8
    
    return incident_type, confidence

def extract_casualties(text):
    """Extract casualty numbers from text"""
    text = text.lower()
    
    # Patterns like "5 killed", "12 dead", "3 wounded"
    patterns = [
        r'(\d+)\s+(?:killed|dead|martyred|died)',
        r'(\d+)\s+(?:wounded|injured|hurt)',
        r'(\d+)\s+(?:casualties|casualty)',
        r'(?:killed|dead|martyred)\s+(\d+)',
    ]
    
    total = 0
    military = 0
    civilian = 0
    
    for pattern in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            try:
                num = int(match)
                total += num
                
                # Try to classify as military or civilian
                context_start = max(0, text.find(match) - 100)
                context_end = min(len(text), text.find(match) + 100)
                context = text[context_start:context_end]
                
                if any(kw in context for kw in CLASSIFICATION_KEYWORDS['military']):
                    military += num
                elif any(kw in context for kw in CLASSIFICATION_KEYWORDS['civilian']):
                    civilian += num
                else:
                    # Default split if unclear
                    civilian += num
            except (ValueError, TypeError):
                pass

    return {
        'total': total,
        'military': military,
        'civilian': civilian
    }

def extract_country(text, coordinates=None):
    """Extract country from text or coordinates"""
    text = text.lower()
    
    # Country keywords
    country_keywords = {
        'iran': ['iran', 'tehran', 'iranian', 'irgc'],
        'israel': ['israel', 'tel aviv', 'jerusalem', 'israeli', 'idf'],
        'palestine': ['palestine', 'palestinian', 'west bank'],
        'gaza': ['gaza', 'gazan'],
        'lebanon': ['lebanon', 'lebanese', 'beirut'],
        'syria': ['syria', 'syrian', 'damascus'],
        'yemen': ['yemen', 'yemeni', 'sanaa', 'houthi', 'houthis'],
        'saudi': ['saudi', 'saudi arabia', 'riyadh', 'ksa'],
        'uae': ['uae', 'emirates', 'dubai', 'abu dhabi', 'emirati'],
        'jordan': ['jordan', 'jordanian', 'amman'],
        'iraq': ['iraq', 'iraqi', 'baghdad'],
        'kuwait': ['kuwait', 'kuwaiti'],
        'bahrain': ['bahrain', 'bahraini'],
        'qatar': ['qatar', 'qatari', 'doha'],
        'oman': ['oman', 'omani', 'muscat']
    }
    
    # Count mentions
    country_scores = {}
    for country, keywords in country_keywords.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            country_scores[country] = score
    
    # Return highest scoring country
    if country_scores:
        return max(country_scores.items(), key=lambda x: x[1])[0]
    
    # Fallback to coordinates if available
    if coordinates and 'lat' in coordinates:
        lat, lng = coordinates['lat'], coordinates['lng']
        # Rough bounding boxes
        if 24 < lat < 40 and 44 < lng < 63:
            return 'iran'
        elif 29 < lat < 34 and 34 < lng < 36:
            return 'israel'
        elif 31 < lat < 32 and 34 < lng < 35:
            return 'gaza'
    
    return 'unknown'

def generate_regional_stats(incidents_file, output_file):
    """Generate regional statistics from incidents"""
    
    # Load incidents
    try:
        with open(incidents_file, 'r') as f:
            data = json.load(f)
            incidents = data.get('incidents', data if isinstance(data, list) else [])
    except Exception as e:
        print(f"Error loading incidents: {e}")
        # Generate sample data for testing
        incidents = generate_sample_incidents()
    
    # Initialize stats structure
    stats = {
        'regional': {
            'casualties': {'military': 0, 'civilian': 0, 'total': 0, 'byCountry': defaultdict(int)},
            'missiles': {'launched': 0, 'intercepted': 0, 'landed': 0, 'byCountry': defaultdict(lambda: {'launched': 0, 'intercepted': 0, 'landed': 0})},
            'airstrikes': {'total': 0, 'byCountry': defaultdict(int)},
            'drones': {'total': 0, 'downed': 0, 'byCountry': defaultdict(lambda: {'total': 0, 'downed': 0})},
            'incidents': {'total': 0, 'byType': defaultdict(int), 'byCountry': defaultdict(int)}
        },
        'countries': {},
        'lastUpdated': datetime.now().isoformat(),
        'timeRange': {
            'from': (datetime.now() - timedelta(days=7)).isoformat(),
            'to': datetime.now().isoformat()
        }
    }
    
    # Initialize country stats
    for code, info in COUNTRIES.items():
        stats['countries'][code] = {
            'name': info['name'],
            'flag': info['flag'],
            'casualties': {'military': 0, 'civilian': 0, 'total': 0},
            'missiles': {'launched': 0, 'intercepted': 0, 'landed': 0},
            'airstrikes': {'total': 0},
            'drones': {'total': 0, 'downed': 0},
            'incidents': [],
            'trend': 'stable'
        }
    
    # Process incidents
    for incident in incidents:
        title = incident.get('title', '')
        content = incident.get('content', '')
        coordinates = incident.get('coordinates', {})
        
        # Classify incident
        incident_type, confidence = classify_incident(title, content)
        country = extract_country(title + ' ' + content, coordinates)
        casualties = extract_casualties(title + ' ' + content)
        
        # Update regional totals
        stats['regional']['incidents']['total'] += 1
        stats['regional']['incidents']['byType'][incident_type] += 1
        
        if country != 'unknown':
            stats['regional']['incidents']['byCountry'][country] += 1
        
        # Update casualties
        if casualties['total'] > 0:
            stats['regional']['casualties']['total'] += casualties['total']
            stats['regional']['casualties']['military'] += casualties['military']
            stats['regional']['casualties']['civilian'] += casualties['civilian']
            
            if country != 'unknown':
                stats['regional']['casualties']['byCountry'][country] += casualties['total']
                stats['countries'][country]['casualties']['total'] += casualties['total']
                stats['countries'][country]['casualties']['military'] += casualties['military']
                stats['countries'][country]['casualties']['civilian'] += casualties['civilian']
        
        # Update by incident type
        if incident_type == 'missile':
            stats['regional']['missiles']['launched'] += 1
            if 'intercept' in title.lower() or 'shot down' in title.lower():
                stats['regional']['missiles']['intercepted'] += 1
                if country != 'unknown':
                    stats['regional']['missiles']['byCountry'][country]['intercepted'] += 1
            else:
                stats['regional']['missiles']['landed'] += 1
                if country != 'unknown':
                    stats['regional']['missiles']['byCountry'][country]['landed'] += 1
            
            if country != 'unknown':
                stats['regional']['missiles']['byCountry'][country]['launched'] += 1
                stats['countries'][country]['missiles']['launched'] += 1
        
        elif incident_type == 'airstrike':
            stats['regional']['airstrikes']['total'] += 1
            if country != 'unknown':
                stats['regional']['airstrikes']['byCountry'][country] += 1
                stats['countries'][country]['airstrikes']['total'] += 1
        
        elif incident_type == 'drone':
            stats['regional']['drones']['total'] += 1
            if 'downed' in title.lower() or 'shot down' in title.lower():
                stats['regional']['drones']['downed'] += 1
                if country != 'unknown':
                    stats['regional']['drones']['byCountry'][country]['downed'] += 1
            
            if country != 'unknown':
                stats['regional']['drones']['byCountry'][country]['total'] += 1
                stats['countries'][country]['drones']['total'] += 1
        
        # Add to country's recent incidents (keep last 10)
        if country != 'unknown':
            stats['countries'][country]['incidents'].append({
                'id': incident.get('id', ''),
                'title': title[:100],
                'type': incident_type,
                'time': incident.get('timestamp', ''),
                'casualties': casualties['total']
            })
            stats['countries'][country]['incidents'] = stats['countries'][country]['incidents'][-10:]
    
    # Convert defaultdicts to regular dicts for JSON serialization
    stats['regional']['casualties']['byCountry'] = dict(stats['regional']['casualties']['byCountry'])
    stats['regional']['missiles']['byCountry'] = dict(stats['regional']['missiles']['byCountry'])
    stats['regional']['airstrikes']['byCountry'] = dict(stats['regional']['airstrikes']['byCountry'])
    stats['regional']['drones']['byCountry'] = dict(stats['regional']['drones']['byCountry'])
    stats['regional']['incidents']['byType'] = dict(stats['regional']['incidents']['byType'])
    stats['regional']['incidents']['byCountry'] = dict(stats['regional']['incidents']['byCountry'])
    
    # Calculate trends (simplified)
    for country_code in stats['countries']:
        incidents = stats['countries'][country_code]['incidents']
        if len(incidents) >= 3:
            # Compare first half vs second half of incidents
            mid = len(incidents) // 2
            first_count = sum(1 for i in incidents[:mid] if i['casualties'] > 0)
            second_count = sum(1 for i in incidents[mid:] if i['casualties'] > 0)
            
            if second_count > first_count * 1.2:
                stats['countries'][country_code]['trend'] = 'increasing'
            elif second_count < first_count * 0.8:
                stats['countries'][country_code]['trend'] = 'decreasing'
            else:
                stats['countries'][country_code]['trend'] = 'stable'
    
    # Write output
    with open(output_file, 'w') as f:
        json.dump(stats, f, indent=2)
    
    print(f"✅ Generated regional stats: {output_file}")
    print(f"   Incidents: {stats['regional']['incidents']['total']}")
    print(f"   Casualties: {stats['regional']['casualties']['total']}")
    print(f"   Countries: {len([c for c in stats['countries'] if stats['countries'][c]['incidents']])}")
    
    return stats

def generate_sample_incidents():
    """Generate sample incidents for testing"""
    return [
        {
            'id': '1',
            'title': 'Missile strike from Iran targets Israel, 3 killed',
            'content': 'Ballistic missiles launched from Iran struck targets in Israel. Iron Dome intercepted 8 missiles, 2 landed causing casualties.',
            'coordinates': {'lat': 32.0, 'lng': 34.8},
            'timestamp': datetime.now().isoformat()
        },
        {
            'id': '2',
            'title': 'Israeli airstrike on Gaza kills 12 civilians',
            'content': 'Warplanes bombed residential area in Gaza City. Women and children among the dead.',
            'coordinates': {'lat': 31.5, 'lng': 34.4},
            'timestamp': datetime.now().isoformat()
        },
        {
            'id': '3',
            'title': 'Hezbollah drone downed over Lebanon',
            'content': 'Israeli forces shot down UAV near border.',
            'coordinates': {'lat': 33.8, 'lng': 35.5},
            'timestamp': datetime.now().isoformat()
        },
        {
            'id': '4',
            'title': 'Iranian military facility hit in Syria',
            'content': 'Airstrike destroyed weapons depot. 5 soldiers killed.',
            'coordinates': {'lat': 33.5, 'lng': 36.3},
            'timestamp': datetime.now().isoformat()
        },
        {
            'id': '5',
            'title': 'Houthi missile intercepted over Saudi Arabia',
            'content': 'Patriot system shot down ballistic missile. No casualties.',
            'coordinates': {'lat': 24.7, 'lng': 46.7},
            'timestamp': datetime.now().isoformat()
        }
    ]

if __name__ == '__main__':
    incidents_file = sys.argv[1] if len(sys.argv) > 1 else 'data/feed.json'
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'data/regional_stats.json'
    
    generate_regional_stats(incidents_file, output_file)
