#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import urllib.request, json, sys

url = 'http://127.0.0.1:7347/mcp'
token = '28pd43'

payload = json.dumps({
    'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
    'params': {'name': 'tavo_character_search', 'arguments': {'query': '红缥缈'}}
}).encode('utf-8')
req = urllib.request.Request(url, data=payload,
    headers={'Content-Type': 'application/json; charset=utf-8', 'Authorization': 'Bearer ' + token})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        body = json.loads(r.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTP error:', e.read().decode())
    sys.exit(1)

print('top-level keys:', list(body.keys()))
if 'error' in body:
    print('error:', json.dumps(body.get('error'), ensure_ascii=False))
elif 'result' in body:
    print('result keys:', list(body['result'].keys()) if isinstance(body['result'], dict) else type(body['result']))
    r = body['result']
    if isinstance(r, dict):
        content = r.get('content', [])
        print('content len:', len(content))
        if content:
            print('content[0] keys:', list(content[0].keys()) if isinstance(content[0], dict) else type(content[0]))
            if isinstance(content[0], dict):
                print('text[:300]:', content[0].get('text', '')[:300])
    elif isinstance(r, list):
        print('result is list len:', len(r))
        print('result[0]:', json.dumps(r[0], ensure_ascii=False)[:200] if r else 'empty')
else:
    print('body:', json.dumps(body, ensure_ascii=False)[:300])
