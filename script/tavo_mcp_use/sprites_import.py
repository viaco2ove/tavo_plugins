#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上传角色立绘和章节背景到 tavo 并绑定"""
import os, sys, json, base64, argparse, urllib.request, urllib.error

# cwd = tavo_plugins/ 已验证（.env 在此），直接用 cwd 算 .env
_ROOT_cwd = os.getcwd()   # = tavo_plugins/


def load_env():
    env = {}
    env_path = os.path.join(os.getcwd(), ".env")
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
    url = args_ns.url or env.get("tavo_mcp_url") or env.get("tavo_mcp_url")  # typo-safe
    token = args_ns.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置（--url/--token 或 .env）")
    return url.rstrip("/"), token

def rpc(http_url, token, method, arguments, timeout=120):
    if method == "tavo_variable_set":
        print(f"  [tavo_variable_set] args:{arguments.get('scope')} {arguments.get('name')}")
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(http_url, data=data,
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
    # MCP 返回 {content: [{text: '{"path': 'files/chat/...', ...}] 包裹，解开
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
    rpc(http_url, token, "tavo_variable_set",
        {"scope": scope, "chatId": chat_id, "name": name, "value": value})

def search_character(http_url, token, name):
    """按名字搜索角色，返回 id 或 None"""
    res = rpc(http_url, token, "tavo_character_search", {"query": name, "match": "exact", "limit": 3})
    items = res.get("items") or res.get("characters") or []
    if isinstance(items, list):
        for it in items:
            if it.get("name") == name:
                return it.get("id")
    return None


def main(http_url, token, story_dir, chat_id, force):
    ex_avatars = os.path.join(story_dir, "ex", "avatars")
    old_avatars = os.path.join(story_dir, "avatars")
    image_dir = os.path.join(story_dir, "image")

    # 读取 story_sync_config.json
    config_path = os.path.join(story_dir, "story_sync_config.json")
    if not os.path.isfile(config_path):
        sys.exit("找不到 story_sync_config.json")
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    char_map = {}    # name -> tavo_id
    role_types = {}   # name -> roleType

    persona = config.get("persona", {})
    pname = persona.get("name", "")
    tid = persona.get("toonflow_id")
    if not tid and pname:
        tid = search_character(http_url, token, pname)
    if tid and pname:
        char_map[pname] = str(tid)
        role_types[pname] = "player"

    for c in config.get("characters", []):
        name = c.get("name", "")
        tid = c.get("toonflow_id")
        if not tid and name:
            tid = search_character(http_url, token, name)
        if tid and name:
            char_map[name] = str(tid)
            role_types[name] = c.get("roleType", "npc")

    print("=== 角色映射 ===")
    for n, i in char_map.items():
        print("  %s -> id=%s" % (n, i))

    sprites_by_name = {}
    sprites_by_id = {}
    chapter_bgs = {}
    fallback_bg = ""

    # 章节背景
    print("=== 章节背景 ===")
    if os.path.isdir(image_dir):
        for fname in os.listdir(image_dir):
            if not (fname.startswith("chapter_") and
                   (fname.endswith("_background.png") or fname.endswith("_cover.png"))):
                continue
            key = fname.replace(".png", "").replace("_bg", "").replace("_cover", "").replace("_background", "")
            dest = "chapter_bg_%s.png" % key
            saved = file_save(http_url, token, chat_id, dest, os.path.join(image_dir, fname), "chat")
            if saved:
                chapter_bgs[key] = saved
                print("  [%s] -> %s" % (fname, saved))

    # 兜底背景
    print("=== 兜底背景 ===")
    for cand in ["cover.jpg", "bg.jpg"]:
        p = os.path.join(image_dir, cand)
        if os.path.isfile(p):
            saved = file_save(http_url, token, chat_id, "fallback_bg.jpg", p, "chat")
            if saved:
                fallback_bg = saved
                print("  [fallback] %s -> %s" % (cand, saved))
            break
    if not fallback_bg:
        print("  无兜底背景")

    # 角色立绘
    print("=== 角色立绘 ===")
    for char_name, tavo_id in char_map.items():
        entry = {
            "id": tavo_id, "name": char_name,
            "roleType": role_types.get(char_name, "npc"),
            "fg": "", "bg": ""}

        ex_dir = os.path.join(ex_avatars, char_name)
        old_path = os.path.join(old_avatars, char_name + ".png")

        saved_fg = None
        # 三层 fallback: original.png > avatar.webp > old avatars/*.png
        for src, prefix, ext in [
            ("original.png", "sprite_fg", ".png"),
            ("avatar.webp",   "sprite_fg", ".webp"),
        ]:
            src_path = os.path.join(ex_dir, src) if os.path.isdir(ex_dir) else None
            if src_path and os.path.isfile(src_path):
                dest = "%s_%s%s" % (prefix, tavo_id, ext)
                s = file_save(http_url, token, chat_id, dest, src_path, "chat")
                if s:
                    entry["fg"] = s
                    saved_fg = s
                    print("  [%s] %s -> %s" % (char_name, src, s))
                    break

        # 第三兜底：旧版大头像
        if not saved_fg and os.path.isfile(old_path):
            dest = "sprite_fg_%s.png" % tavo_id
            s = file_save(http_url, token, chat_id, dest, old_path, "chat")
            if s:
                entry["fg"] = s
                print("  [%s] old_avatar.png (fallback) -> %s" % (char_name, s))

        # 氛围背景
        bg_src = os.path.join(ex_dir, "background.png") if os.path.isdir(ex_dir) else None
        if bg_src and os.path.isfile(bg_src):
            dest = "sprite_bg_%s.png" % tavo_id
            s = file_save(http_url, token, chat_id, dest, bg_src, "chat")
            if s:
                entry["bg"] = s
                print("  [%s] bg -> %s" % (char_name, s))

        if entry["fg"] or entry["bg"]:
            sprites_by_name[char_name] = entry
            sprites_by_id[str(tavo_id)] = {
                "name": char_name,
                "fg": entry.get("fg", ""),
                "bg": entry.get("bg", "")}

    # 写变量
    if sprites_by_name:
        sprites_payload = {"byName": sprites_by_name, "byId": sprites_by_id}
        # chat scope: tf_sprites（基础名）；global scope: tf_sprites_{chat_id}（带 chat_id）
        sprite_global_key = "tf_sprites_%s" % chat_id
        variable_set(http_url, token, chat_id, "tf_sprites", sprites_payload, "chat")
        variable_set(http_url, token, chat_id, sprite_global_key, sprites_payload, "global")
        print("tf_sprites + %s 写入 (%d 角色)" % (sprite_global_key, len(sprites_by_name)))
    if chapter_bgs:
        variable_set(http_url, token, chat_id, "tf_chapter_backgrounds", chapter_bgs, "chat")
        print("tf_chapter_backgrounds 写入 (%d)" % len(chapter_bgs))
    if fallback_bg:
        variable_set(http_url, token, chat_id, "tf_sprite_fallback_bg", fallback_bg, "chat")
        print("tf_sprite_fallback_bg 写入: " + fallback_bg)

    print("\n=== 完成 ===")
    print("角色立绘: %d 个" % len(sprites_by_name))
    print("章节背景: %d 个" % len(chapter_bgs))
    print("兜底背景: " + (fallback_bg or "无"))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("chat_id")
    p.add_argument("story_dir")
    p.add_argument("--url")
    p.add_argument("--token")
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry", action="store_true")
    args = p.parse_args()

    http_url, token = resolve(args)
    if args.dry:
        print("[dry mode]")
        sys.exit(0)

    main(http_url, token, args.story_dir, int(args.chat_id), args.force)
