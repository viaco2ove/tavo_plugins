#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""详细检查角色卡字段"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

env_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env"
client = McpClient(env_path=env_path)

# 获取角色详情，查看所有字段
print("=== 角色 id=224 完整字段 ===")
result = client.call("tavo_character_get", {"id": 224})
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
for k, v in data.items():
    if isinstance(v, str) and len(v) > 50:
        print(f"  {k}: {v[:50]}...")
    else:
        print(f"  {k}: {v}")

print()
print("=== 搜索所有可能的 avatar 字段 ===")
result2 = client.call("tavo_character_search", {"query": "红缥缈", "limit": 5})
data2 = json.loads(result2.get("content", [{}])[0].get("text", "{}"))
chars = data2.get("items", [])
if chars:
    char = chars[0]
    print(f"角色字段: {list(char.keys())}")
    for k, v in char.items():
        if isinstance(v, str) and 'avatar' in k.lower():
            print(f"  {k}: {v}")

print()
print("=== 检查 persona 删除 API ===")
# 先查 persona 数量
result3 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 50})
data3 = json.loads(result3.get("content", [{}])[0].get("text", "{}"))
personas = data3.get("items", [])
print(f"当前有 {len(personas)} 个 persona")

# 尝试删除一个
if personas:
    pid_to_delete = personas[0].get("id")
    print(f"尝试删除 persona id={pid_to_delete}")
    try:
        result4 = client.call("tavo_persona_delete", {"personaId": pid_to_delete})
        print(f"删除结果: {result4}")
    except Exception as e:
        print(f"删除失败: {e}")

    # 再查数量
    result5 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 50})
    data5 = json.loads(result5.get("content", [{}])[0].get("text", "{}"))
    personas5 = data5.get("items", [])
    print(f"删除后有 {len(personas5)} 个 persona")