#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全面验证同步结果"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

def parse(result):
    return json.loads(result.get("content", [{}])[0].get("text", "{}"))

print("=" * 60)
print("1. 角色头像")
print("=" * 60)
result = client.call("tavo_character_search", {"query": "红缥缈", "limit": 5})
data = parse(result)
for c in data.get("items", []):
    cid = c.get("id")
    detail = parse(client.call("tavo_character_get", {"id": cid}))
    avatar = detail.get("data", {}).get("avatar", "无")
    print(f"  [{cid}] {c.get('name')} avatar={avatar}")

print()
print("=" * 60)
print("2. Persona 头像")
print("=" * 60)
result2 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 10})
data2 = parse(result2)
for p in data2.get("items", []):
    pid = p.get("id")
    print(f"  [{pid}] {p.get('name')} avatar={p.get('avatar', '无') or '无'}")

print()
print("=" * 60)
print("3. 群聊详情")
print("=" * 60)
result3 = client.call("tavo_chat_search", {"query": "谁让这个山大王修仙的", "limit": 5})
data3 = parse(result3)
for ch in data3.get("items", []):
    cid = ch.get("id") or ch.get("chatId")
    print(f"  [{cid}] {ch.get('name')}")
    print(f"    characterIds: {ch.get('characterIds')}")
    print(f"    lorebookIds: {ch.get('lorebookIds')}")
    print(f"    personaId: {ch.get('personaId')}")

print()
print("=" * 60)
print("4. tf_story.edit (章节+开场白)")
print("=" * 60)
result4 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
data4 = parse(result4)
val4 = data4.get("value", {})
chapters = val4.get("chapters", [])
print(f"  chapters 数量: {len(chapters)}")
for i, ch in enumerate(chapters[:3]):
    print(f"    第{i+1}章: title={ch.get('title')}")
    print(f"      openingRole: {ch.get('openingRole')}")
    print(f"      openingLine: {ch.get('openingLine', '')[:50]}")
    print(f"      content len: {len(ch.get('content', ''))}")
    print(f"      successCondition: {ch.get('successCondition', '')[:30]}")
print(f"  currentChapterIndex: {val4.get('currentChapterIndex')}")
print(f"  intro: {val4.get('intro', '无')[:50]}")
print(f"  global_bg: {val4.get('global_bg', '无')[:50]}")
print(f"  card_scenario: {val4.get('card_scenario', '无')[:50]}")

print()
print("=" * 60)
print("5. tf_progress")
print("=" * 60)
result5 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_progress"})
data5 = parse(result5)
val5 = data5.get("value", {})
print(f"  currentChapterIndex: {val5.get('currentChapterIndex')}")
print(f"  currentEvent: {val5.get('currentEvent')}")
print(f"  completedChapters: {val5.get('completedChapters')}")

print()
print("=" * 60)
print("6. tf_sprites (立绘)")
print("=" * 60)
result6 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
data6 = parse(result6)
val6 = data6.get("value", {})
by_name = val6.get("byName", {})
print(f"  byName 数量: {len(by_name)}")
# 检查 persona 的立绘
persona_sprites = by_name.get("纯小白", {})
print(f"  纯小白立绘: fg={persona_sprites.get('fg', '无')} bg={persona_sprites.get('bg', '无')}")
for name, sprite in list(by_name.items())[:2]:
    print(f"  {name}: fg={sprite.get('fg', '无')} bg={sprite.get('bg', '无')}")

print()
print("=" * 60)
print("7. 世界书 entries")
print("=" * 60)
result7 = client.call("tavo_lorebook_search", {"query": "谁让这个山大王修仙的", "limit": 5})
data7 = parse(result7)
for lb in data7.get("items", []):
    lid = lb.get("id") or lb.get("lorebookId")
    print(f"  [{lid}] {lb.get('name')} entries={len(lb.get('entries', []))}")

print()
print("=" * 60)
print("8. 群聊变量 - 故事数据绑定")
print("=" * 60)
# 检查是否有 intro/global_bg/card_scenario 绑定到群聊
for var_name in ["tf_story_intro", "tf_global_bg", "tf_card_scenario", "tf_card_tags"]:
    result_v = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": var_name})
    data_v = parse(result_v)
    found = data_v.get("found", False)
    val = data_v.get("value")
    print(f"  {var_name}: found={found} value={str(val)[:50] if val else '无'}")