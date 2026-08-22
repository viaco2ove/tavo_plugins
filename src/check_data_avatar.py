#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 data.avatar 字段"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

# 获取角色详情
print("=== 检查角色 data.avatar ===")
result = client.call("tavo_character_get", {"id": 293})
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
char_data = data.get("data", {})
avatar = char_data.get("avatar")
print(f"data.avatar: {avatar or '无'}")

print()
print("=== data 完整内容 ===")
for k, v in char_data.items():
    if isinstance(v, str) and len(v) > 80:
        print(f"  {k}: {v[:80]}...")
    else:
        print(f"  {k}: {v}")