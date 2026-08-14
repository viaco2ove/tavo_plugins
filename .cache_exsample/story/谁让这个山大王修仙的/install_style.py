import json, urllib.request, zipfile, io, os, base64, time, sys

# 1) 生成本地 .tpg 包（不依赖网络）
src = r'D:\Users\viaco\tools\Toonflow-game\tavo_plugins\plugins\toonflow_story_style'
out = os.path.join(src, 'toonflow_story_style.tpg')
files = []
for root, _, fs in os.walk(src):
    for f in fs:
        if f.endswith('.tpg'):
            continue
        files.append(os.path.relpath(os.path.join(root, f), src).replace(os.sep, '/'))
files.sort()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for rel in files:
        zf.write(os.path.join(src, rel), rel)
print('本地 .tpg 已生成:', out, os.path.getsize(out), 'B')

# 2) 探测 MCP
env = {}
for line in open(r'D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.env', encoding='utf-8'):
    line = line.strip()
    if not line or '=' not in line or line.startswith('#'):
        continue
    k, v = line.split('=', 1)
    env[k.strip()] = v.strip()
url = env['tavo_mcp_url']
token = env['tavo_mcp_toekn']


def probe():
    req = urllib.request.Request(url,
        data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        return len(json.loads(r.read())['result']['tools'])


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


try:
    n = probe()
    print('MCP_OK tools=', n)
except Exception as e:
    print('MCP 不通:', type(e).__name__, str(e)[:60])
    print('==> 请重开 Tavo 桌面端 MCP Server，或手动安装 .tpg：', out)
    sys.exit(0)

# 3) 通了就安装
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, fs in os.walk(src):
        for f in fs:
            if f.endswith('.tpg'):
                continue
            fp = os.path.join(root, f)
            arc = os.path.relpath(fp, src).replace(os.sep, '/')
            zf.write(fp, arc)
zb = base64.b64encode(buf.getvalue()).decode()
print('zip:', len(buf.getvalue()), 'B')
for i in range(3):
    try:
        print('install:', call('tavo_plugin_install', {'pluginId': 'com.toonflow.story-style', 'zipBase64': zb, 'overwrite': True})[:280])
        break
    except Exception as e:
        print('attempt', i + 1, 'fail', type(e).__name__, str(e)[:50])
        time.sleep(2)
print('enable:', call('tavo_plugin_set_enabled', {'pluginId': 'com.toonflow.story-style', 'enabled': True})[:180])
print('verify:', call('tavo_plugin_get', {'pluginId': 'com.toonflow.story-style'})[:260])
