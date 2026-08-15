# -*- coding: utf-8 -*-
"""打印 tmm_story_static 里每个角色的参数卡摘要，确认静态基准未被清空。"""
import io, json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = {}
with io.open(os.path.join(ROOT, '.env'), encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

URL = env['tavo_mcp_url']
TOKEN = env.get('tavo_mcp_toekn') or env.get('tavo_mcp_token')


def call(name, args):
    body = json.dumps({
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
        'params': {'name': name, 'arguments': args},
    }).encode('utf-8')
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + TOKEN,
    })
    raw = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
    payload = None
    for ln in raw.splitlines():
        ln = ln.strip()
        if ln.startswith('data:'):
            payload = ln[5:].strip()
            break
    if payload is None:
        payload = raw.strip()
    obj = json.loads(payload)
    if 'result' not in obj:
        print('RAW ENVELOPE:', json.dumps(obj, ensure_ascii=False)[:600])
        raise SystemExit(1)
    return json.loads(obj['result']['content'][0]['text'])


import sys
VAR = sys.argv[1] if len(sys.argv) > 1 else 'tmm_story_static'
print('=== variable:', VAR, '===')
wrap = call('tavo_variable_get', {'name': VAR, 'scope': 'chat', 'chatId': 2})
val = wrap.get('value') or {}
chars = val.get('characters') or []
print('found:', wrap.get('found'), '| story name:', val.get('name'))
print('角色数:', len(chars))
for c in chars:
    card = c.get('card') or {}
    print('  %-10s %-9s Lv=%-5s HP=%-6s MP=%-6s 字段数=%d' % (
        c.get('name'), c.get('roleType'), card.get('level'),
        card.get('hp'), card.get('mp'), len(card)))
