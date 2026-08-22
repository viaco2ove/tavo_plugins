#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""详细检查同步数据"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

env_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env"
client = McpClient(env_path=env_path)

# 直接获取 lorebook id=2 的完整内容
print("=== 直接获取 lorebook id=2 ===")
result = client.call("tavo_lorebook_get", {"id": 2})
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
print("  name:", data.get("name"))
print("  entries count:", len(data.get("entries", [])))
if data.get("entries"):
    print("  first entry:", data["entries"][0].get("name"))
    print("  first entry content length:", len(data["entries"][0].get("content", "")))

# 检查角色详情
print()
print("=== 检查角色 id=200 详情 ===")
result2 = client.call("tavo_character_get", {"id": 200})
data2 = json.loads(result2.get("content", [{}])[0].get("text", "{}"))
print("  name:", data2.get("name"))
print("  avatar:", data2.get("avatar", "无"))

# 检查 tf_story.edit
print()
print("=== 检查 tf_story.edit ===")
result3 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
data3 = json.loads(result3.get("content", [{}])[0].get("text", "{}"))
print("  found:", data3.get("found"))
val = data3.get("value", {})
print("  chapters count:", len(val.get("chapters", [])))
print("  currentChapterIndex:", val.get("currentChapterIndex"))
if val.get("chapters"):
    ch = val["chapters"][0]
    print("  first chapter title:", ch.get("title"))
    print("  first chapter content length:", len(ch.get("content", "")))

# 检查 tf_sprites
print()
print("=== 检查 tf_sprites ===")
result4 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
data4 = json.loads(result4.get("content", [{}])[0].get("text", "{}"))
print("  found:", data4.get("found"))
val4 = data4.get("value", {})
print("  byName keys:", list(val4.get("byName", {}).keys()))
if val4.get("byName"):
    first = list(val4["byName"].values())[0]
    print("  first sprite:", first)