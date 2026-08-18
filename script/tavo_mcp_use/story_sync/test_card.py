#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import urllib.request, json

url = 'http://127.0.0.1:7347/mcp'
token = '28pd43'

def call(method, arguments):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                          'params': {'name': method, 'arguments': arguments}}).encode()
    req = urllib.request.Request(url, data=payload,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read().decode())
    except urllib.request.HTTPError as e:
        return {'error': e.read().decode()[:200]}
    if 'error' in body:
        return {'error': body['error']}
    return body.get('result', {})

# Test character_import_card
r = call('tavo_character_import_card', {'card': '{"name":"测试"}'})
print('card:', json.dumps(r, ensure_ascii=False)[:300])
