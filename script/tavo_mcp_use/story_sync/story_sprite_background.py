#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
story_sprite_background.py — 同步故事目录里的立绘资源到 tavo

用法:
  python story_sprite_background.py <chat_id> <story_dir>                 # 上传 + 绑定（默认 idempotent）
  python story_sprite_background.py <chat_id> <story_dir> --force       # 强制重传
  python story_sprite_background.py <chat_id> <story_dir> --dry         # 预览
  python story_sprite_background.py <chat_id> <story_dir> --skip-bg     # 只传立绘不传章节背景

资源结构（Toonflow-game ex/ 标准）:
  <story_dir>/ex/avatars/<角色>/
    original.png      → sprite_fg_<id>.png        前景立绘
    background.png    → sprite_bg_<id>.png        立绘氛围背景
    avatar.webp       → sprite_fg_<id>.webp       第二 fallback）
  <story_dir>/avatars/<角色>.png   → sprite_fg_<id>.png（第三 fallback，老版大头像）
  <story_dir>/image/chapter_*_background.png → chapter_bg_<key>.png
  <story_dir>/image/cover.jpg | bg.jpg → fallback_bg.jpg

三层 fallback（前到后）:
  1. ex/avatars/<角色>/original.png
  2. ex/avatars/<角色>/avatar.webp
  3. avatars/<角色>.png（老版 1024×1024）

角色 → tavo_id 解析：通过 MCP tavo_character_search 按名字搜（若 story_sync_config.json
里没有 toonflow_id 字段）。这样手机/模拟器 AVD 之间切不同 id 也能正常工作。

变量写入 chat scope:
  tf_sprites            {byName, byId}
  tf_chapter_backgrounds {key
  tf_sprite_fallback_bg string
"""
import os, sys, json, base64, argparse, urllib.request

_SCRIPT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_SCRIPT)))   # tavo_plugins/


def load_env():
    env = {}
    env_path = os.path.join(os.getcwd(), ".env")
    if not os.path.isfile(env_path):
        env_path = os.path.join(ROOT, ".env")
    if not os.path.isfile(env_path):
        return env
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve(args_ns):
    env = load_env()
    url = args_ns.url or env.get("tavo_mcp_url")
    token = args_ns.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置（--url/--token 或 .env）")
    return url.rstrip("/"), token


def rpc(http_url, token, method, arguments, timeout=120):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        http_url, data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        sys.exit("MCP 连接失败: %s" % e)
    if "error" in body:
        sys.exit("MCP Error: %s" % body["error"])
    raw = body.get("result", {})
    try:
        content = raw.get("content", [])
        if content and isinstance(content, list):
            inner = json.loads(content[0].get("text", "{}"))
            return inner
    except Exception:
        pass
    return raw


def file_save(http_url, token, chat_id, name, local_path, scope="chat"):
    if not os.path.isfile(local_path):
        return None
    with open(local_path, "rb") as f:
        data_b64 = base64.b64encode(f.read()).decode()
    res = rpc(http_url, token, "tavo_file_save", {
        "chatId": chat_id, "name": name, "content": data_b64,
        "options": {"scope": scope, "encoding": "base64"}})
    return res.get("path") or res.get("name") or ""


def variable_set(http_url, token, chat_id, name, value, scope="chat"):
    # 双写：chat + global（防 tavo_chat_reset 清除）
    rpc(http_url, token, "tavo_variable_set",
        {"scope": scope, "chatId": chat_id, "name": name, "value": value})
    rpc(http_url, token, "tavo_variable_set",
        {"scope": "global", "name": name, "value": value})


def search_character(http_url, token, name):
    res = rpc(http_url, token, "tavo_character_search",
               {"query": name, "match": "exact", "limit": 5})
    items = res.get("items") or res.get("characters") or []
    if isinstance(items, list):
        for it in items:
            if it.get("name") == name:
                return it.get("id")
    return None


def collect_roles(http_url, token, story_dir):
    """从 story_sync_config.json + MCP 名字搜索，得到所有角色 + tavo_id。"""
    config_path = os.path.join(story_dir, "story_sync_config.json")
    if not os.path.isfile(config_path):
        sys.exit("找不到 story_sync_config.json")

    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    char_map = {}
    role_types = {}

    # persona
    persona = config.get("persona", {})
    pname = persona.get("name", "")
    if pname:
        tid = persona.get("toonflow_id") or search_character(http_url, token, pname)
        if tid:
            char_map[pname] = str(tid)
            role_types[pname] = "player"
            print("  [persona] %s -> id=%s" % (pname, tid))

    # characters
    for c in config.get("characters", []):
        name = c.get("name", "")
        if not name:
            continue
        tid = c.get("toonflow_id") or search_character(http_url, token, name)
        if tid:
            char_map[name] = str(tid)
            role_types[name] = c.get("roleType", "npc")
            print("  [char]    %s -> id=%s (%s)" % (name, tid, c.get("roleType", "npc")))
    return char_map, role_types


def main():
    p = argparse.ArgumentParser()
    p.add_argument("chat_id", help="群聊 chatId")
    p.add_argument("story_dir", help="故事缓存目录")
    p.add_argument("--url")
    p.add_argument("--token")
    p.add_argument("--force", action="store_true", help="强制重传所有图片")
    p.add_argument("--dry", action="store_true")
    p.add_argument("--skip-bg", action="store_true", help="跳过章节背景")
    p.add_argument("--skip-sprite", action="store_true", help="跳过立绘")
    p.add_argument("--scope", default="chat")
    args = p.parse_args()

    http_url, token = resolve(args)
    story_dir = args.story_dir
    chat_id = int(args.chat_id)

    ex_avatars = os.path.join(story_dir, "ex", "avatars")
    old_avatars = os.path.join(story_dir, "avatars")
    image_dir = os.path.join(story_dir, "image")

    print("=== 角色解析 ===")
    char_map, role_types = collect_roles(http_url, token, story_dir)

    sprites_by_name = {}
    sprites_by_id = {}
    chapter_bgs = {}
    fallback_bg = ""

    # ===== 章节背景 =====
    if not args.skip_bg and os.path.isdir(image_dir):
        print("=== 章节背景 ===")
        for fname in sorted(os.listdir(image_dir)):
            if not (fname.startswith("chapter_") and
                    (fname.endswith("_background.png") or fname.endswith("_cover.png") or fname.endswith("_bg.png"))):
                continue
            # chapter_1_background.png / chapter_1_cover.png -> key="chapter_1"
            key = (fname.replace(".png", "")
                          .replace("_background", "")
                          .replace("_cover", "")
                          .replace("_bg", ""))
            dest = "chapter_bg_%s.png" % key
            saved = file_save(http_url, token, chat_id, dest, os.path.join(image_dir, fname), args.scope)
            if saved:
                chapter_bgs[key] = saved
                print("  [%s] -> %s" % (fname, saved))

    # ===== 兜底背景 =====
    if not args.skip_bg:
        print("=== 兜底背景 ===")
        for cand in ["cover.jpg", "bg.jpg"]:
            path = os.path.join(image_dir, cand)
            if os.path.isfile(path):
                saved = file_save(http_url, token, chat_id, "fallback_bg.jpg", path, args.scope)
                if saved:
                    fallback_bg = saved
                    print("  [fallback] %s -> %s" % (cand, saved))
                break

    # ===== 角色立绘 =====
    if not args.skip_sprite:
        print("=== 角色立绘 ===")
        for char_name, tavo_id in char_map.items():
            entry = {
                "id": tavo_id,
                "name": char_name,
                "roleType": role_types.get(char_name, "npc"),
                "fg": "",
                "bg": "",
            }

            ex_dir = os.path.join(ex_avatars, char_name)
            old_path = os.path.join(old_avatars, char_name + ".png")

            # 三层 fallback：original.png > avatar.webp > old avatars/*.png
            fg_path = None
            fg_ext = ".png"
            for src_fname, ext in [("original.png", ".png"), ("avatar.webp", ".webp")]:
                src_path = os.path.join(ex_dir, src_fname) if os.path.isdir(ex_dir) else None
                if src_path and os.path.isfile(src_path):
                    fg_path = src_path
                    fg_ext = ext
                    break

            # 第三兜底：老版大头像
            if not fg_path and os.path.isfile(old_path):
                fg_path = old_path
                fg_ext = ".png"

            if fg_path:
                dest = "sprite_fg_%s%s" % (tavo_id, fg_ext)
                saved = file_save(http_url, token, chat_id, dest, fg_path, args.scope)
                if saved:
                    entry["fg"] = saved
                    print("  [%s] fg (%s) -> %s" % (char_name, os.path.basename(fg_path), saved))

            # 氛围背景
            bg_src = os.path.join(ex_dir, "background.png") if os.path.isdir(ex_dir) else None
            if bg_src and os.path.isfile(bg_src):
                dest = "sprite_bg_%s.png" % tavo_id
                saved = file_save(http_url, token, chat_id, dest, bg_src, args.scope)
                if saved:
                    entry["bg"] = saved
                    print("  [%s] bg -> %s" % (char_name, saved))

            if entry["fg"] or entry["bg"]:
                sprites_by_name[char_name] = entry
                sprites_by_id[str(tavo_id)] = {
                    "name": char_name,
                    "fg": entry.get("fg", ""),
                    "bg": entry.get("bg", ""),
                }

    # ===== 写变量 =====
    if not args.dry:
        print("=== 写入变量 ===")
        if sprites_by_name:
            variable_set(http_url, token, chat_id, "tf_sprites",
                {"byName": sprites_by_name, "byId": sprites_by_id}, args.scope)
            print("  tf_sprites -> %d 角色" % len(sprites_by_name))
        if chapter_bgs:
            variable_set(http_url, token, chat_id, "tf_chapter_backgrounds",
                chapter_bgs, args.scope)
            print("  tf_chapter_backgrounds -> %d 章节" % len(chapter_bgs))
        if fallback_bg:
            variable_set(http_url, token, chat_id, "tf_sprite_fallback_bg",
                fallback_bg, args.scope)
            print("  tf_sprite_fallback_bg -> %s" % fallback_bg)

    print("\n=== 汇总 ===")
    print("  角色立绘: %d" % len(sprites_by_name))
    print("  章节背景: %d" % len(chapter_bgs))
    print("  兜底背景: %s" % (fallback_bg or "无"))
    print("  scope: %s" % args.scope)


if __name__ == "__main__":
    main()