#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 重新打包并安装三个 UI 插件（修复：触发器固定到屏幕视口 + 挂到 document.body）
# 使用 MCP tools/call 形式：工具名 tavo_plugin_install，参数 zipBase64
import os, sys, json, base64, io, zipfile, time, urllib.request

ROOT = r"D:\Users\viaco\tools\Toonflow-game\tavo_plugins"
ENV = os.path.join(ROOT, ".env")

env = {}
for line in open(ENV, encoding="utf-8"):
    line = line.strip()
    if not line or "=" not in line or line.startswith("#"):
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip()
URL = env["tavo_mcp_url"]
TOKEN = env["tavo_mcp_toekn"]
print("MCP:", URL)

def call(name, args):
    req = urllib.request.Request(URL,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": name, "arguments": args}}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    if "error" in d:
        return ("ERR", d["error"])
    c = d["result"].get("content")
    if isinstance(c, list):
        return ("OK", "\n".join(x.get("text", "") for x in c if x.get("type") == "text"))
    return ("OK", str(c))

def zipb64(src):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, fs in os.walk(src):
            for f in fs:
                if f.endswith(".tpg"):
                    continue
                fp = os.path.join(root, f)
                arc = os.path.relpath(fp, src).replace(os.sep, "/")
                zf.write(fp, arc)
    return base64.b64encode(buf.getvalue()).decode()

PLUGINS = [
    "com.toonflow.story-event-manager",
    "com.toonflow.story-style",
    "com.toonflow.story-memory-manager",
]
DIRS = {
    "com.toonflow.story-event-manager": os.path.join(ROOT, "plugins", "toonflow_story_event_manager"),
    "com.toonflow.story-style": os.path.join(ROOT, "plugins", "toonflow_story_style"),
    "com.toonflow.story-memory-manager": os.path.join(ROOT, "plugins", "toonflow_story_memory_manager"),
}

for pid in PLUGINS:
    src = DIRS[pid]
    zb = zipb64(src)
    print("\n=== install", pid, "(zip", len(zb), "B base64) ===")
    for i in range(3):
        try:
            r = call("tavo_plugin_install", {"pluginId": pid, "zipBase64": zb, "overwrite": True})
            print("install:", r[0], (r[1][:160] if r[0] == "OK" else r[1]))
            break
        except Exception as e:
            print("attempt", i + 1, "fail", e)
            time.sleep(2)
    print("enable:", call("tavo_plugin_set_enabled", {"pluginId": pid, "enabled": True})[:160])
    print("verify:", call("tavo_plugin_get", {"pluginId": pid})[:260])
