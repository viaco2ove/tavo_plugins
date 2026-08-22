#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")
from tavo_plugins.lib.mcp_client import McpClient
client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

def p(r):
    txt = r.get("content", [{}])[0].get("text", "{}")
    try:
        return json.loads(txt)
    except:
        return txt

print("=" * 60)
print("群聊信息")
print("=" * 60)

# 搜索群聊
r = client.call("tavo_chat_search", {"query": "谁让这个山大王修仙的", "limit": 5})
d = p(r)
chats = d.get("items", [])
print("找到 %d 个群聊\n" % len(chats))

for chat in chats:
    cid = chat.get("id") or chat.get("chatId")
    print("[%s] %s:" % (cid, chat.get("name", "")))
    for k, v in chat.items():
        if k in ("id", "chatId"):
            continue
        if isinstance(v, dict):
            print("  %s: %s" % (k, json.dumps(v, ensure_ascii=False)[:80]))
        elif isinstance(v, list):
            print("  %s: [%d items]" % (k, len(v)))
        elif isinstance(v, str) and len(v) > 80:
            print("  %s: %s..." % (k, v[:80]))
        else:
            print("  %s: %s" % (k, v))

print()
print("=" * 60)
print("tf_story.edit 内容")
print("=" * 60)
r2 = client.call("tavo_variable_get", {"chatId": cid, "scope": "chat", "name": "tf_story.edit"})
d2 = p(r2)
val = d2.get("value", {})
print("found: %s" % d2.get("found"))
print("intro len: %d" % len(val.get("intro", "")))
print("globalBackground len: %d" % len(val.get("globalBackground", "")))
print("cardScenario len: %d" % len(val.get("cardScenario", "")))
chs = val.get("chapters", [])
print("chapters: %d" % len(chs))
if chs:
    ch = chs[0]
    print("  chapter[0] title: %s" % ch.get("title", ""))
    print("  chapter[0] openingLine len: %d" % len(ch.get("openingLine", "")))
    print("  chapter[0] content len: %d" % len(ch.get("content", "")))