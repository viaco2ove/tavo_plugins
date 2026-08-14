import json, urllib.request, os

env = {}
for line in open(r'D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.env', encoding='utf-8'):
    line = line.strip()
    if not line or '=' not in line or line.startswith('#'):
        continue
    k, v = line.split('=', 1)
    env[k.strip()] = v.strip()
url = env['tavo_mcp_url']
token = env['tavo_mcp_toekn']


def call(name, args):
    req = urllib.request.Request(url,
        data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    if 'error' in d:
        return ('ERR', d['error'])
    c = d['result'].get('content')
    if isinstance(c, list):
        return ('OK', '\n'.join(x.get('text', '') for x in c if x.get('type') == 'text'))
    return ('OK', str(c))


# 1) 列出全部插件
print('=== tavo_plugin_search(空) ===')
r = call('tavo_plugin_search', {'query': ''})
print(r[0])
if r[0] == 'OK':
    try:
        items = json.loads(r[1]) if r[1].strip().startswith('{') or r[1].strip().startswith('[') else None
    except Exception:
        items = None
    if items is None:
        print('(无法解析，原文见上)')

# 2) 逐个查关键插件
for pid in ['com.toonflow.story-event-manager', 'com.toonflow.story-style', 'com.toonflow.story-memory-manager', 'com.toonflow.multi-character-stage', 'com.toonflow.story-speaker']:
    print('\n===', pid, '===')
    r = call('tavo_plugin_get', {'pluginId': pid})
    print(r[0])
    if r[0] == 'OK':
        try:
            d = json.loads(r[1])
            print('  name=', d.get('name'), 'version=', d.get('version'), 'enabled=', d.get('enabled'))
            mf = d.get('manifest', {})
            print('  features=', mf.get('features'), 'htmlFragments=', mf.get('htmlFragments'))
        except Exception as e:
            print('  (解析失败)', e, '| 原文:', r[1][:200])
    else:
        print('  ERR', r[1])
