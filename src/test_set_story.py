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

# 读取配置
with open("/.cache/bak/avd/谁让这个山大王修仙的/story_sync_config.json", encoding="utf-8") as f:
    config = json.load(f)
with open("/.cache/bak/avd/谁让这个山大王修仙的/chapters/chapter_1.json", encoding="utf-8") as f:
    ch1 = json.load(f)

edit = {
    "intro": config.get("intro", ""),
    "globalBackground": config.get("global_bg", ""),
    "cardScenario": config.get("card_scenario", ""),
    "cardTags": config.get("card_tags", []),
    "chapters": [{
        "title": ch1.get("title", ""),
        "openingRole": ch1.get("openingRole", ""),
        "openingLine": ch1.get("openingText", ""),
        "content": ch1.get("content", ""),
        "successCondition": ch1.get("completionCondition", ""),
    }]
}

print("设置 tf_story.edit...")
r = client.call("tavo_variable_set", {
    "scope": "chat", "chatId": 12, "name": "tf_story.edit", "value": edit
})
result = p(r)
print("写入:", result.get("value", {}).get("intro", "")[:20] if result.get("value", {}).get("intro") else "OK")

print()
print("读取验证...")
r2 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
d = p(r2)
val = d.get("value", {})
print("intro len:", len(val.get("intro", "")))
print("globalBackground len:", len(val.get("globalBackground", "")))
print("cardScenario len:", len(val.get("cardScenario", "")))
print("chapters[0] openingLine len:", len(val.get("chapters", [{}])[0].get("openingLine", "")))
