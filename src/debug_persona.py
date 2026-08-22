#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""调试 persona 删除问题 - 尝试正确的参数名"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

env_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env"
client = McpClient(env_path=env_path)

def parse_result(result):
    """正确解析 MCP 返回结果"""
    raw = result.get("content", [{}])[0].get("text", "{}")
    return json.loads(raw)

print("=== 1. 搜索 persona ===")
result = client.call("tavo_persona_search", {"query": "纯小白", "limit": 100})
data = parse_result(result)
items = data.get("items", [])
print(f"找到 {len(items)} 个 persona")

print("\n=== 2. 尝试用 id 参数删除第一个 persona ===")
if items:
    pid = items[0].get("id")
    print(f"尝试删除 id={pid} (类型: {type(pid).__name__})")

    # 尝试不同的参数名
    for param_name in ["id", "personaId"]:
        print(f"\n  尝试参数名: {param_name}")
        try:
            if param_name == "id":
                result2 = client.call("tavo_persona_delete", {"id": int(pid)})
            else:
                result2 = client.call("tavo_persona_delete", {"personaId": pid})
            raw2 = result2.get("content", [{}])[0].get("text", "{}")
            print(f"    结果: {raw2[:200]}")
        except Exception as e:
            print(f"    失败: {e}")

print("\n=== 3. 重新搜索确认 ===")
result3 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 100})
data3 = parse_result(result3)
items3 = data3.get("items", [])
print(f"删除后: {len(items3)} 个 persona")

print("\n=== 4. 用正确参数批量删除 ===")
if items3:
    # 用 id 参数
    for p in items3:
        pid = p.get("id")
        try:
            result4 = client.call("tavo_persona_delete", {"id": int(pid)})
            raw4 = result4.get("content", [{}])[0].get("text", "{}")
            print(f"  删除 id={pid}: {raw4[:100]}")
        except Exception as e:
            print(f"  删除 id={pid} 失败: {e}")

print("\n=== 5. 最终确认 ===")
result5 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 100})
data5 = parse_result(result5)
items5 = data5.get("items", [])
print(f"最终: {len(items5)} 个 persona")