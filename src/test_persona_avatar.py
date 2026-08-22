#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试 persona 头像上传 + 立绘绑定"""
import os
import sys

os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

from tavo_plugins.lib.mcp_client import McpClient
import json, base64

client = McpClient(env_path="D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.env")
STORY_DIR = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/avd/谁让这个山大王修仙的"
CHAT_ID = 12

def parse(result):
    return json.loads(result.get("content", [{}])[0].get("text", "{}"))

# ============================================================
# 1. 查找 persona "纯小白"
# ============================================================
print("=" * 60)
print("1. 查找 persona")
print("=" * 60)
result = client.call("tavo_persona_search", {"query": "纯小白", "limit": 10})
data = parse(result)
items = data.get("items", [])
print(f"找到 {len(items)} 个 persona")
for p in items:
    print(f"  [{p.get('id')}] {p.get('name')}")

persona_id = items[0].get("id") if items else None
print(f"使用 persona_id: {persona_id}")

# ============================================================
# 2. 上传头像文件到 files/global/
# ============================================================
print()
print("=" * 60)
print("2. 上传头像文件")
print("=" * 60)
avatar_path = os.path.join(STORY_DIR, "avatars", "纯小白.png")
if not os.path.isfile(avatar_path):
    avatar_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "original.png")
if not os.path.isfile(avatar_path):
    avatar_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "avatar.webp")

print(f"头像路径: {avatar_path}")
print(f"文件存在: {os.path.isfile(avatar_path)}")

avatar_ref = ""
if os.path.isfile(avatar_path):
    ext = os.path.splitext(avatar_path)[1].lstrip(".") or "png"
    fname = "persona_avatar_纯小白." + ext
    with open(avatar_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    # 用 tavo_file_save 上传到 files/global/
    result2 = client.call("tavo_file_save", {
        "chatId": CHAT_ID,
        "name": fname,
        "content": b64,
        "options": {"scope": "global", "encoding": "base64"}
    })
    data2 = parse(result2)
    avatar_ref = data2.get("path") or ""
    print(f"上传成功: avatar_ref={avatar_ref}")
else:
    print("找不到头像文件!")

# ============================================================
# 3. 尝试更新 persona 头像
# ============================================================
print()
print("=" * 60)
print("3. 更新 persona 头像")
print("=" * 60)
if avatar_ref and persona_id:
    # 尝试 tavo_persona_update
    print(f"尝试 tavo_persona_update id={persona_id} avatar={avatar_ref}")
    try:
        result3 = client.call("tavo_persona_update", {
            "id": int(persona_id),
            "persona": {"avatar": avatar_ref}
        })
        data3 = parse(result3)
        print(f"更新成功: {data3}")
    except Exception as e:
        print(f"tavo_persona_update 失败: {e}")

    # 尝试 tavo_persona_create 带 avatar（覆盖）
    print()
    print("尝试 tavo_persona_create 带 avatar（覆盖模式）")
    try:
        result4 = client.call("tavo_persona_create", {
            "persona": {
                "name": "纯小白",
                "avatar": avatar_ref,
                "active": True
            }
        })
        data4 = parse(result4)
        print(f"创建成功: {data4}")
    except Exception as e:
        print(f"tavo_persona_create 失败: {e}")
else:
    print("没有 avatar_ref 或 persona_id，跳过")

# ============================================================
# 4. 上传立绘文件
# ============================================================
print()
print("=" * 60)
print("4. 上传立绘文件")
print("=" * 60)

# fg: 前景立绘
fg_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "original.png")
if not os.path.isfile(fg_path):
    fg_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "avatar.webp")

# bg: 氛围背景
bg_path = os.path.join(STORY_DIR, "ex", "avatars", "纯小白", "background.png")

sprite_ref_fg = ""
sprite_ref_bg = ""

if os.path.isfile(fg_path):
    ext = os.path.splitext(fg_path)[1].lstrip(".") or "png"
    fname_fg = "sprite_persona_纯小白_fg." + ext
    with open(fg_path, "rb") as f:
        b64_fg = base64.b64encode(f.read()).decode()
    result_fg = client.call("tavo_file_save", {
        "chatId": CHAT_ID,
        "name": fname_fg,
        "content": b64_fg,
        "options": {"scope": "chat", "encoding": "base64"}
    })
    data_fg = parse(result_fg)
    sprite_ref_fg = data_fg.get("path") or ""
    print(f"fg 上传成功: {sprite_ref_fg}")
else:
    print(f"fg 文件不存在: {fg_path}")

if os.path.isfile(bg_path):
    fname_bg = "sprite_persona_纯小白_bg.png"
    with open(bg_path, "rb") as f:
        b64_bg = base64.b64encode(f.read()).decode()
    result_bg = client.call("tavo_file_save", {
        "chatId": CHAT_ID,
        "name": fname_bg,
        "content": b64_bg,
        "options": {"scope": "chat", "encoding": "base64"}
    })
    data_bg = parse(result_bg)
    sprite_ref_bg = data_bg.get("path") or ""
    print(f"bg 上传成功: {sprite_ref_bg}")
else:
    print(f"bg 文件不存在: {bg_path}")

# ============================================================
# 5. 绑定立绘信息到全局变量
# ============================================================
print()
print("=" * 60)
print("5. 绑定立绘信息到 tf_sprites")
print("=" * 60)

# 先读取现有的 tf_sprites
result5 = client.call("tavo_variable_get", {"chatId": CHAT_ID, "scope": "chat", "name": "tf_sprites"})
data5 = parse(result5)
val5 = data5.get("value", {})
by_name = val5.get("byName", {})
by_id = val5.get("byId", {})

# 添加 persona 立绘
by_name["纯小白"] = {
    "id": persona_id,
    "name": "纯小白",
    "roleType": "persona",
    "fg": sprite_ref_fg,
    "bg": sprite_ref_bg
}
by_id[str(persona_id)] = {
    "name": "纯小白",
    "fg": sprite_ref_fg,
    "bg": sprite_ref_bg
}

print(f"byName 数量: {len(by_name)}")
print(f"纯小白: fg={sprite_ref_fg} bg={sprite_ref_bg}")

print(f"  [tavo_variable_set] args:chat tf_sprites")
# 写入 tf_sprites
result6 = client.call("tavo_variable_set", {
    "scope": "chat",
    "chatId": CHAT_ID,
    "name": "tf_sprites",
    "value": {"byName": by_name, "byId": by_id}
})
print(f"写入 tf_sprites: {parse(result6)}")

# ============================================================
# 6. 验证
# ============================================================
print()
print("=" * 60)
print("6. 验证")
print("=" * 60)

# 验证 persona 头像
result7 = client.call("tavo_persona_search", {"query": "纯小白", "limit": 5})
data7 = parse(result7)
for p in data7.get("items", []):
    print(f"Persona [{p.get('id')}] {p.get('name')}: avatar={p.get('avatar', '无') or '无'}")

# 验证 tf_sprites
result8 = client.call("tavo_variable_get", {"chatId": CHAT_ID, "scope": "chat", "name": "tf_sprites"})
data8 = parse(result8)
val8 = data8.get("value", {})
persona_sprite = val8.get("byName", {}).get("纯小白", {})
print(f"tf_sprites 纯小白: fg={persona_sprite.get('fg', '无')} bg={persona_sprite.get('bg', '无')}")