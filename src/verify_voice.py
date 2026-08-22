#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证音色同步"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

def parse(r):
    return json.loads(r.get("content", [{}])[0].get("text", "{}"))

print("=" * 60)
print("tf_character_voices")
print("=" * 60)
r = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_character_voices"})
d = parse(r)
val = d.get("value", {})
print(f"  角色数量: {len(val)}")
for name, voice in val.items():
    print(f"  {name}:")
    print(f"    mode: {voice.get('mode')}")
    print(f"    prompt: {voice.get('prompt', '')[:40]}...")
    print(f"    audioRef: {voice.get('audioRef')}")