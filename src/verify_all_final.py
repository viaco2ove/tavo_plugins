#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")
from tavo_plugins.lib.mcp_client import McpClient
client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")

def p(r): return json.loads(r.get("content", [{}])[0].get("text", "{}"))

print("=" * 60)
# Get persona id
r0 = client.call("tavo_chat_get", {"chatId": 12})
d0 = p(r0)
pid = d0.get("personaId")
print("chat personaId:", pid)

# Persona avatar
r1 = client.call("tavo_persona_get", {"id": pid})
d1 = p(r1)
print("1. Persona avatar:", d1.get("avatar", "无"))

# tf_sprites
r2 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_sprites"})
d2 = p(r2)
byName = d2.get("value", {}).get("byName", {})
pname = d1.get("name", "纯小白")
print("2. tf_sprites", pname, "fg:", byName.get(pname, {}).get("fg", "无"))
print("   tf_sprites 总数:", len(byName))

# tf_character_voices
r3 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_character_voices"})
d3 = p(r3)
voices = d3.get("value", {})
print("3. tf_character_voices", pname, "audio:", voices.get(pname, {}).get("audioRef", "无"))
print("   tf_character_voices 总数:", len(voices))

# tf_story.edit
r4 = client.call("tavo_variable_get", {"chatId": 12, "scope": "chat", "name": "tf_story.edit"})
d4 = p(r4)
edit = d4.get("value", {})
chs = edit.get("chapters", [])
print("4. tf_story.edit chapters:", len(chs))
print("   intro len:", len(edit.get("intro", "")))
if chs:
    print("   openingLine:", chs[0].get("openingLine", "无")[:40])
    print("   successCondition:", chs[0].get("successCondition", "无")[:40])

print("=" * 60)
print("验证完成!")
print("=" * 60)