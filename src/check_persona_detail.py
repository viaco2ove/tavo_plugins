#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 persona 详情"""
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
print("1. Persona search 返回字段")
print("=" * 60)
r1 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 5})
d1 = parse(r1)
for p in d1.get("items", []):
    print(f"  [{p.get('id')}] 字段: {list(p.keys())}")
    print(f"  avatar: {p.get('avatar', '无')}")

print()
print("=" * 60)
print("2. 尝试 tavo_persona_get")
print("=" * 60)
# 获取 persona id
r2 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 1})
d2 = parse(r2)
items = d2.get("items", [])
if items:
    pid = items[0].get("id")
    print(f"  persona_id: {pid}")

    # 尝试 tavo_persona_get
    try:
        r3 = client.call("tavo_persona_get", {"id": pid})
        d3 = parse(r3)
        print(f"  tavo_persona_get 字段: {list(d3.keys())}")
        print(f"  avatar: {d3.get('avatar', '无')}")
        print(f"  name: {d3.get('name')}")
    except Exception as e:
        print(f"  tavo_persona_get 失败: {e}")

print()
print("=" * 60)
print("3. 直接查询 chat 的 personaId")
print("=" * 60)
r4 = client.call("tavo_chat_search", {"query": "谁让这个山大王修仙的", "limit": 5})
d4 = parse(r4)
for ch in d4.get("items", []):
    cid = ch.get("id") or ch.get("chatId")
    pid = ch.get("personaId")
    print(f"  chat_id={cid} personaId={pid}")
    if pid:
        # 查询这个 persona 的详情
        try:
            r5 = client.call("tavo_persona_get", {"id": pid})
            d5 = parse(r5)
            print(f"    persona 详情: name={d5.get('name')} avatar={d5.get('avatar', '无')}")
        except Exception as e:
            print(f"    查询失败: {e}")