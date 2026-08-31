"""
Vercel Serverless Function for User Reports
Endpoint: /api/report
"""
import json
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import hashlib
import os

REPORTS_FILE = 'public/user_reports.json'

def load_reports():
    """Load reports from JSON"""
    try:
        with open(REPORTS_FILE, 'r') as f:
            return json.load(f)
    except:
        return {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'total_reports': 0,
            'reports': {},
            'hidden_incidents': [],
            'report_reasons': {
                'false_info': 'False or misleading information',
                'wrong_location': 'Wrong location',
                'outdated': 'Outdated (already resolved)',
                'duplicate': 'Duplicate of another incident',
                'wrong_title': 'Misleading headline'
            }
        }

def save_reports(data):
    """Save reports to JSON"""
    data['generated_at'] = datetime.now(timezone.utc).isoformat()
    with open(REPORTS_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    
    # Also update report_status.json for frontend
    status = {
        'generated_at': data['generated_at'],
        'hidden_incidents': data['hidden_incidents'],
        'report_counts': {k: len(v) for k, v in data['reports'].items()},
        'report_reasons': data['report_reasons']
    }
    with open('public/report_status.json', 'w') as f:
        json.dump(status, f, indent=2)

def handler(request):
    """Handle HTTP request"""
    # CORS headers
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    }
    
    if request.get('method') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'ok': True})}
    
    if request.get('method') != 'POST':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
    
    try:
        body = json.loads(request.get('body', '{}'))
        incident_id = body.get('incident_id')
        reason = body.get('reason')
        details = body.get('details', '')
        fingerprint = body.get('fingerprint', '')
        
        if not incident_id or not reason:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing incident_id or reason'})}
        
        reports = load_reports()
        
        # Validate reason
        if reason not in reports['report_reasons']:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Invalid reason'})}
        
        # Check if hidden
        if incident_id in reports['hidden_incidents']:
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                'success': False,
                'message': 'This incident is already under review',
                'total_reports': 5
            })}
        
        # Check for duplicate
        if incident_id not in reports['reports']:
            reports['reports'][incident_id] = []
        
        existing = [r.get('fingerprint') for r in reports['reports'][incident_id]]
        if fingerprint in existing:
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
                'success': False,
                'message': 'You have already reported this incident',
                'total_reports': len(reports['reports'][incident_id])
            })}
        
        # Add report
        report = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'reason': reason,
            'details': details,
            'fingerprint': fingerprint
        }
        reports['reports'][incident_id].append(report)
        reports['total_reports'] += 1
        
        total = len(reports['reports'][incident_id])
        is_hidden = total >= 5
        
        if is_hidden and incident_id not in reports['hidden_incidents']:
            reports['hidden_incidents'].append(incident_id)
            message = f'This incident has been flagged for review ({total} reports).'
        else:
            message = f'Thank you for helping keep Gulf Watch accurate. ({total}/5 reports)'
        
        save_reports(reports)
        
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({
            'success': True,
            'message': message,
            'total_reports': total,
            'is_hidden': is_hidden
        })}
        
    except Exception as e:
        print(f'Report handler error: {e}')
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': 'Could not process report'})}

# Vercel handler
class ReportHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        request = {
            'method': 'POST',
            'body': body
        }
        
        response = handler(request)
        
        self.send_response(response['statusCode'])
        for key, value in response.get('headers', {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(response['body'].encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

# For Vercel
from http.server import BaseHTTPRequestHandler

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        request = {'method': 'POST', 'body': body.decode('utf-8')}
        response = handler(request)
        
        self.send_response(response['statusCode'])
        for key, value in response['headers'].items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(response['body'].encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    from http.server import HTTPServer
    server = HTTPServer(('localhost', 8000), ReportHandler)
    print("Report server running on http://localhost:8000")
    server.serve_forever()
