#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试音色上传和绑定"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json, base64

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")
STORY_DIR = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/avd/谁让这个山大王修仙的"
CHAT_ID = 12

def parse(r):
    return json.loads(r.get("content", [{}])[0].get("text", "{}"))

# ============================================================
# 1. 读取 role.json 获取音色配置
# ============================================================
print("=" * 60)
print("1. 读取音色配置")
print("=" * 60)
role_json_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "role.json")
with open(role_json_path, encoding="utf-8") as f:
    role_config = json.load(f)

voice_prompt = role_config.get("voicePromptText", "")
voice_mode = role_config.get("voiceMode", "")
print(f"  voiceMode: {voice_mode}")
print(f"  voicePromptText: {voice_prompt[:50]}...")

# ============================================================
# 2. 上传 voice.wav 文件
# ============================================================
print()
print("=" * 60)
print("2. 上传 voice.wav 文件")
print("=" * 60)
voice_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "voice.wav")
if os.path.isfile(voice_path):
    print(f"  文件存在: {voice_path}")
    with open(voice_path, "rb") as f:
        voice_b64 = base64.b64encode(f.read()).decode()

    # 尝试上传到 files/global/
    result = client.call("tavo_file_save", {
        "chatId": CHAT_ID,
        "name": "voice_pure_white.wav",
        "content": voice_b64,
        "options": {"scope": "global", "encoding": "base64"}
    })
    data = parse(result)
    voice_ref = data.get("path", "")
    print(f"  上传结果: {voice_ref}")
else:
    print(f"  voice.wav 不存在!")
    voice_ref = ""

# ============================================================
# 3. 查看可用的变量名来绑定音色
# ============================================================
print()
print("=" * 60)
print("3. 绑定音色信息到变量")
print("=" * 60)

# 创建音色配置
voice_config = {
    "mode": voice_mode or "prompt_voice",
    "prompt": voice_prompt,
    "audioRef": voice_ref,
    "enabled": True
}
print(f"  音色配置: mode={voice_config['mode']}, prompt={voice_config['prompt'][:30]}...")

print(f"  [tavo_variable_set] args:chat tf_voice_config")
# 绑定到 tf_voice_config
result2 = client.call("tavo_variable_set", {
    "scope": "chat",
    "chatId": CHAT_ID,
    "name": "tf_voice_config",
    "value": voice_config
})
print(f"  tf_voice_config 设置: {parse(result2)}")

print(f"  [tavo_variable_set] args:chat tf_character_voices")
# 同时绑定到角色音色
result3 = client.call("tavo_variable_set", {
    "scope": "chat",
    "chatId": CHAT_ID,
    "name": "tf_character_voices",
    "value": {
        "纯小白": voice_config
    }
})
print(f"  tf_character_voices 设置: {parse(result3)}")

# ============================================================
# 4. 验证
# ============================================================
print()
print("=" * 60)
print("4. 验证")
print("=" * 60)

r1 = client.call("tavo_variable_get", {"chatId": CHAT_ID, "scope": "chat", "name": "tf_voice_config"})
d1 = parse(r1)
print(f"  tf_voice_config: {d1.get('value', '无')}")

r2 = client.call("tavo_variable_get", {"chatId": CHAT_ID, "scope": "chat", "name": "tf_character_voices"})
d2 = parse(r2)
print(f"  tf_character_voices: {d2.get('value', '无')}")

print()
print("=" * 60)
print("5. 测试 MCP 是否有 tavo_voice 相关 API")
print("=" * 60)
# 列出可用的 tools
try:
    result_tools = client.call("tavo_tools_list", {})
    tools_data = parse(result_tools)
    voice_tools = [t for t in tools_data if 'voice' in str(t).lower()]
    print(f"  音色相关工具: {voice_tools[:10]}")
except Exception as e:
    print(f"  获取工具列表失败: {e}")