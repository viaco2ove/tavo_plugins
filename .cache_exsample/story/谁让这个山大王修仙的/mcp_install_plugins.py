import json, os, io, zipfile, base64, urllib.request

PLUGINS_DIR = r"D:\Users\viaco\tools\Toonflow-game\tavo_plugins\plugins"
PLUGIN_DIRS = [
    "toonflow_story_event_manager",
    "toonflow_story_memory_manager",
    "toonflow_story_multi_character_stage",
    "toonflow_story_speaker",
]

env = {}
with open(r"D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.env", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
url = env["tavo_mcp_url"]
token = env["tavo_mcp_toekn"]


def call(name, args):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def text_of(d):
    if "error" in d:
        return "ERR " + json.dumps(d["error"], ensure_ascii=False)
    c = d.get("result", {}).get("content")
    if isinstance(c, list):
        return "".join(x.get("text", "") for x in c if x.get("type") == "text")
    return str(c)


for d in PLUGIN_DIRS:
    pd = os.path.join(PLUGINS_DIR, d)
    with open(os.path.join(pd, "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    pid = man.get("id") or man.get("pluginId")
    # 把插件目录内容压到 zip 根（与 build.ps1 的 Compress-Archive 行为一致）
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(pd):
            for fn in files:
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, pd)
                z.write(fp, rel)
    b64 = base64.b64encode(buf.getvalue()).decode()
    print(f"=== {d} (id={pid}, zip={len(buf.getvalue())}B) ===")
    r = call("tavo_plugin_install", {"zipBase64": b64})
    t = text_of(r)
    print("install:", t[:300])
    if "error" in r and ("already" in t.lower() or "exist" in t.lower()):
        call("tavo_plugin_uninstall", {"pluginId": pid})
        r = call("tavo_plugin_install", {"zipBase64": b64})
        print("re-install:", text_of(r)[:300])
    r2 = call("tavo_plugin_set_enabled", {"pluginId": pid, "enabled": True})
    print("enable:", text_of(r2)[:120])
    r3 = call("tavo_plugin_get", {"pluginId": pid})
    # 只打印 enabled / version / name
    try:
        g = json.loads(text_of(r3))
        item = g.get("item") or g
        print("verify:", item.get("name"), "enabled=", item.get("enabled"), "version=", item.get("version"))
    except Exception:
        print("verify-raw:", text_of(r3)[:200])
    print()
