import json, urllib.request, zipfile, io, os, base64, time

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


def zipb64(src):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, fs in os.walk(src):
            for f in fs:
                if f.endswith('.tpg'):
                    continue
                fp = os.path.join(root, f)
                arc = os.path.relpath(fp, src).replace(os.sep, '/')
                zf.write(fp, arc)
    return base64.b64encode(buf.getvalue()).decode()


# 探测
try:
    req = urllib.request.Request(url,
        data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        n = len(json.loads(r.read())['result']['tools'])
    print('MCP_OK tools=', n)
except Exception as e:
    print('MCP 不通:', e)
    raise SystemExit

targets = {
    'com.toonflow.story-memory-manager': r'D:\Users\viaco\tools\Toonflow-game\tavo_plugins\plugins\toonflow_story_memory_manager',
    'com.toonflow.story-style': r'D:\Users\viaco\tools\Toonflow-game\tavo_plugins\plugins\toonflow_story_style',
}

for pid, src in targets.items():
    zb = zipb64(src)
    print('\n=== install', pid, '(zip', len(zb), 'B base64) ===')
    for i in range(3):
        try:
            r = call('tavo_plugin_install', {'pluginId': pid, 'zipBase64': zb, 'overwrite': True})
            print('install:', r[0], (r[1][:160] if r[0] == 'OK' else r[1]))
            break
        except Exception as e:
            print('attempt', i + 1, 'fail', e)
            time.sleep(2)
    print('enable:', call('tavo_plugin_set_enabled', {'pluginId': pid, 'enabled': True})[:160])
    print('verify:', call('tavo_plugin_get', {'pluginId': pid})[:240])
