#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查同步结果"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient

env_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env"
client = McpClient(env_path=env_path)

print("=== 1. 检查角色 ===")
result = client.call("tavo_character_search", {"query": "", "limit": 100})
import json
data = json.loads(result.get("content", [{}])[0].get("text", "{}"))
chars = data.get("items", [])
for c in chars:
    avatar = c.get("avatar", "无")
    if avatar and len(avatar) > 50:
        avatar = avatar[:50] + "..."
    print(f"  [{c.get('id')}] {c.get('name')} | avatar: {avatar}")

print("\n=== 2. 检查 Persona ===")
result2 = client.call("tavo_persona_search", {"query": "", "limit": 100})
data2 = json.loads(result2.get("content", [{}])[0].get("text", "{}"))
personas = data2.get("items", [])
for p in personas:
    avatar = p.get("avatar", "无")
    if avatar and len(avatar) > 50:
        avatar = avatar[:50] + "..."
    print(f"  [{p.get('id')}] {p.get('name')} | avatar: {avatar}")

print("\n=== 3. 检查群聊 ===")
result3 = client.call("tavo_chat_search", {"query": "", "limit": 100})
data3 = json.loads(result3.get("content", [{}])[0].get("text", "{}"))
chats = data3.get("items", [])
for chat in chats:
    print(f"  [{chat.get('id')}] {chat.get('name')}")
    print(f"      characterIds: {chat.get('characterIds')}")
    print(f"      lorebookIds: {chat.get('lorebookIds')}")
    print(f"      personaId: {chat.get('personaId')}")

print("\n=== 4. 检查世界书 ===")
result4 = client.call("tavo_lorebook_search", {"query": "", "limit": 100})
data4 = json.loads(result4.get("content", [{}])[0].get("text", "{}"))
books = data4.get("items", [])
for book in books:
    print(f"  [{book.get('id')}] {book.get('name')} | entries: {len(book.get('entries', []))}")

print("\n=== 5. 检查群聊变量 (chat_id=12) ===")
result5 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
data5 = json.loads(result5.get("content", [{}])[0].get("text", "{}"))
if data5:
    chapters = data5.get("chapters", [])
    print(f"  tf_story.edit.chapters: {len(chapters)} 个")
    for i, ch in enumerate(chapters[:3]):
        print(f"    第{i+1}章: {ch.get('title')} | openingRole: {ch.get('openingRole')} | openingLine: {ch.get('openingLine', '')[:30]}...")
else:
    print("  无数据")

print("\n=== 6. 检查 tf_progress ===")
result6 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_progress"})
data6 = json.loads(result6.get("content", [{}])[0].get("text", "{}"))
print(f"  tf_progress: {data6}")

print("\n=== 7. 检查 tf_sprites ===")
result7 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
data7 = json.loads(result7.get("content", [{}])[0].get("text", "{}"))
if data7:
    by_name = data7.get("byName", {})
    print(f"  tf_sprites.byName: {len(by_name)} 个角色")
    for name, sprite in list(by_name.items())[:3]:
        print(f"    {name}: fg={sprite.get('fg', '无')[:40]}...")
else:
    print("  无数据")

print("\n=== 8. 检查 tf_chapter_backgrounds ===")
result8 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_chapter_backgrounds"})
data8 = json.loads(result8.get("content", [{}])[0].get("text", "{}"))
print(f"  tf_chapter_backgrounds: {data8}")

print("\n=== 9. 检查 tf_sprite_fallback_bg ===")
result9 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprite_fallback_bg"})
data9 = json.loads(result9.get("content", [{}])[0].get("text", "{}"))
print(f"  tf_sprite_fallback_bg: {data9}")