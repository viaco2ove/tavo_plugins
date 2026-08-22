#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""最终检查同步数据"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

env_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env"
client = McpClient(env_path=env_path)

print("=" * 60)
print("STEP 5: 上传角色头像")
print("=" * 60)
# 使用新的角色 ID（修复后）
for cid in [224, 225, 226]:
    result = client.call("tavo_character_get", {"id": cid})
    data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
    print(f"角色 id={cid} ({data.get('name')}): avatar={data.get('avatar', '无') or '无'}")

print()
print("=" * 60)
print("STEP 1: duplicate-delete 效果")
print("=" * 60)
# 检查是否有重复角色
result7 = client.call("tavo_character_search", {"query": "红缥缈", "limit": 10})
data7 = json.loads(result7.get("content", [{}])[0].get("text", "{}"))
chars7 = data7.get("items", [])
print("搜索'红缥缈'找到", len(chars7), "个角色:")
for c in chars7:
    print(f"  [{c.get('id')}] {c.get('name')} avatar={c.get('avatar', '无') or '无'}")

print()
# 检查 persona 重复
result8 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 50})
data8 = json.loads(result8.get("content", [{}])[0].get("text", "{}"))
personas8 = data8.get("items", [])
print("搜索'纯小白'找到", len(personas8), "个 persona:")
for p in personas8:
    print(f"  [{p.get('id')}] {p.get('name')}")

print()
print("=" * 60)
print("char_ids.json 检查")
print("=" * 60)
char_ids_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/avd/谁让这个山大王修仙的/char_ids.json"
if os.path.exists(char_ids_path):
    with open(char_ids_path, encoding="utf-8") as f:
        char_ids = json.load(f)
    print("char_ids.json 存在，包含", len(char_ids), "个角色")
    for name, cid in list(char_ids.items())[:5]:
        print(f"  {name}: {cid}")
else:
    print("char_ids.json 不存在")