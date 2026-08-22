#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查角色卡字段结构"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

print("=== 检查角色完整字段 ===")
# 搜索一个角色获取其 ID
result = client.call("tavo_character_search", {"query": "红缥缈", "limit": 5})
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
chars = data.get("items", [])
if chars:
    cid = chars[0].get("id")
    print(f"红缥缈 id={cid}")
    print(f"原始字段: {list(chars[0].keys())}")
    for k, v in chars[0].items():
        if isinstance(v, str) and len(v) > 50:
            print(f"  {k}: {v[:50]}...")
        else:
            print(f"  {k}: {v}")

print()
print("=== 尝试获取角色详情 ===")
if chars:
    cid = chars[0].get("id")
    try:
        result2 = client.call("tavo_character_get", {"id": cid})
        data2 = json.loads(result2.get("content", [{}])[0].get("text", "{}"))
        print(f"角色详情字段: {list(data2.keys())}")
        for k, v in data2.items():
            if isinstance(v, str) and len(v) > 50:
                print(f"  {k}: {v[:50]}...")
            elif isinstance(v, dict):
                print(f"  {k}: {{...}}")
            elif isinstance(v, list):
                print(f"  {k}: [...]")
            else:
                print(f"  {k}: {v}")
    except Exception as e:
        print(f"获取详情失败: {e}")

print()
print("=== 检查 search 返回的所有字段 ===")
if chars:
    print("所有字段和值:")
    for k, v in chars[0].items():
        if 'avatar' in k.lower() or 'image' in k.lower() or 'pic' in k.lower():
            print(f"  ** 可能的头像字段 ** {k}: {v}")
        else:
            print(f"  {k}: {v}")