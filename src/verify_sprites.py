#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 tf_sprites"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

def parse(r):
    return json.loads(r.get("content", [{}])[0].get("text", "{}"))

r = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
d = parse(r)
val = d.get("value", {})
byName = val.get("byName", {})
byId = val.get("byId", {})

print(f"byName: {len(byName)} 个")
for name, sprite in byName.items():
    print(f"  {name}: id={sprite.get('id')} fg={sprite.get('fg', '无')[:30]}")

print()
print(f"byId: {len(byId)} 个")
for id_str, sprite in byId.items():
    print(f"  {id_str}: {sprite.get('name')} fg={sprite.get('fg', '无')[:30]}")