# -*- coding: utf-8 -*-
"""把 chat 的 tf_story.edit.orchestration 设为 plugin（角色编排插件接管），其余字段原样保留。"""
import io, json, os, sys, urllib.request

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
CHAT_ID = 2
MODE = sys.argv[1] if len(sys.argv) > 1 else 'plugin'


def call(name, args):
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                       'params': {'name': name, 'arguments': args}}).encode('utf-8')
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + TOKEN})
    raw = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
    payload = None
    for ln in raw.splitlines():
        ln = ln.strip()
        if ln.startswith('data:'):
            payload = ln[5:].strip()
            break
    obj = json.loads(payload if payload is not None else raw.strip())
    if 'result' not in obj:
        print('ERROR ENVELOPE:', json.dumps(obj, ensure_ascii=False)[:500])
        raise SystemExit(1)
    return json.loads(obj['result']['content'][0]['text'])


wrap = call('tavo_variable_get', {'name': 'tf_story.edit', 'scope': 'chat', 'chatId': CHAT_ID})
edit = wrap.get('value')
if not isinstance(edit, dict):
    print('tf_story.edit 读不到，放弃写入（避免覆盖）')
    raise SystemExit(1)
print('before: orchestration=%r chapters=%d lineCount=%r'
      % (edit.get('orchestration'), len(edit.get('chapters') or []), edit.get('lineCount')))

edit['orchestration'] = MODE
call('tavo_variable_set', {'name': 'tf_story.edit', 'scope': 'chat', 'chatId': CHAT_ID, 'value': edit})

chk = call('tavo_variable_get', {'name': 'tf_story.edit', 'scope': 'chat', 'chatId': CHAT_ID}).get('value') or {}
print('after : orchestration=%r chapters=%d lineCount=%r'
      % (chk.get('orchestration'), len(chk.get('chapters') or []), chk.get('lineCount')))
