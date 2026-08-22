#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 persona 头像和立绘"""
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
print("1. Persona 头像")
print("=" * 60)
r1 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 5})
d1 = parse(r1)
for p in d1.get("items", []):
    print(f"  [{p.get('id')}] {p.get('name')} avatar={p.get('avatar', '无') or '无'}")

print()
print("=" * 60)
print("2. tf_sprites 立绘")
print("=" * 60)
r2 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
d2 = parse(r2)
val = d2.get("value", {})
byName = val.get("byName", {})
print(f"  byName: {len(byName)} 个角色")
p_sprite = byName.get("纯小白", {})
print(f"  纯小白: fg={p_sprite.get('fg', '无')} bg={p_sprite.get('bg', '无')}")

print()
print("=" * 60)
print("3. tf_story.edit 故事数据")
print("=" * 60)
r3 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
d3 = parse(r3)
val3 = d3.get("value", {})
print(f"  intro: {val3.get('intro', '无')[:50] if val3.get('intro') else '无'}...")
print(f"  global_bg: {val3.get('global_bg', '无')[:50] if val3.get('global_bg') else '无'}...")
print(f"  card_scenario: {val3.get('card_scenario', '无')[:50] if val3.get('card_scenario') else '无'}...")
print(f"  chapters: {len(val3.get('chapters', []))} 个")