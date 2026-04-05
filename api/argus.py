# api/argus.py - Vercel Python Function
from flask import Flask, jsonify
import json

app = Flask(__name__)

# Inline minimal implementation to avoid import issues
def process_events(incidents):
    return {
        'entities': [],
        'countryThreats': [],
        'summary': {'totalEntities': len(incidents), 'totalCountries': 0, 'criticalThreats': 0}
    }

@app.route('/api/argus')
def handler():
    try:
        with open('incidents.json', 'r') as f:
            incidents = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        incidents = []
    result = process_events(incidents)
    return jsonify(result)
