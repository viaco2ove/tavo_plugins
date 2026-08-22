#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""最终验证所有修复"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

print("=" * 60)
print("验证 1: Persona 删除")
print("=" * 60)
result = client.call("tavo_persona_search", {"query": "纯小白", "limit": 100})
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
items = data.get("items", [])
print(f"纯小白 persona 数量: {len(items)}")
if items:
    for p in items:
        print(f"  [{p.get('id')}] {p.get('name')}")
else:
    print("  (无重复 persona)")

print()
print("=" * 60)
print("验证 2: char_ids.json 保存")
print("=" * 60)
char_ids_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/avd/谁让这个山大王修仙的/char_ids.json"
if os.path.exists(char_ids_path):
    with open(char_ids_path, encoding="utf-8") as f:
        char_ids = json.load(f)
    print(f"char_ids.json 包含 {len(char_ids)} 个角色")
    for name, cid in list(char_ids.items())[:5]:
        print(f"  {name}: {cid}")
else:
    print("char_ids.json 不存在")

print()
print("=" * 60)
print("验证 3: 角色头像更新")
print("=" * 60)
result2 = client.call("tavo_character_search", {"query": "红缥缈", "limit": 5})
data2 = json.loads(result2.get("content", [{}])[0].get("text", "{}"))
chars2 = data2.get("items", [])
if chars2:
    c = chars2[0]
    avatar = c.get("avatar") or "无"
    print(f"红缥缈: id={c.get('id')} avatar={avatar}")

print()
print("=" * 60)
print("验证 4: 群聊绑定")
print("=" * 60)
result3 = client.call("tavo_chat_get", {"chatId": 12})
data3 = json.loads(result3.get("content", [{}])[0].get("text", "{}"))
print(f"chat_id=12 name={data3.get('name')}")
print(f"  characterIds: {data3.get('characterIds')}")
print(f"  lorebookIds: {data3.get('lorebookIds')}")
print(f"  personaId: {data3.get('personaId')}")