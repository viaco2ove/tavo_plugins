#!/usr/bin/env python3
import os, sys, json
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")
from tavo_plugins.lib.mcp_client import McpClient
client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

r = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
raw = json.loads(r.get("content", [{}])[0].get("text", "{}"))
val = raw.get("value", {})

out = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src/tf_story_edit_dump.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(val, f, ensure_ascii=False, indent=2)
print("dumped to", out)
print("keys:", list(val.keys()))
print("intro len:", len(val.get("intro", "")))
print("globalBackground len:", len(val.get("globalBackground", "")))
print("chapters:", len(val.get("chapters", [])))