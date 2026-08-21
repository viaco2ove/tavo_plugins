#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
story_sync_all.py — 故事完整安装：story.json → tavo 全套

流程（按顺序）：
  1. 读取 .env 连接配置
  2. 读取 story.json（Toonflow 数据）
  3. 从 story.json 自动生成 story_sync_config.json（幂等，不覆盖手动编辑）
  4. 同步角色卡（persona + NPCs）→ tavo_character_import_card
  5. 同步世界书（worldbook）→ tavo_lorebook_create / update
  6. 同步/创建群聊 → tavo_chat_create / update
  7. 同步章节到 tf_story.edit.chapters（chat 变量）
  8. 同步立绘资源（sprite）→ tavo_file_save + tavo_variable_set
  9. 同步语音配置（如有 voice_config）

用法:
  python story_sync_all.py                          # 全部流程
  python story_sync_all.py --check                   # 仅连通性检查
  python story_sync_all.py --dry                     # 预演
  python story_sync_all.py --force                   # 强制重传
  python story_sync_all.py --skip-sprite            # 跳过立绘
  python story_sync_all.py --skip-voice             # 跳过语音
  python story_sync_all.py --chat-id 5             # 指定群聊 ID（已有群聊时）
  python story_sync_all.py --url http://... --token XXX  # 覆盖 .env
  python story_sync_all.py --story-dir "path"        # 指定故事目录

story.json 字段（来自 Toonflow-game）:
  story_name, intro, global_bg, card_scenario, card_tags
  player_role { name, md_file, avatar_file }
  npc_roles [{ name, md_file, avatar_file }]
  chapter_covers { "1": { cover, background }, ... }

story_sync_config.json 字段（tavo 格式）:
  story_name, chat_name, response_mode
  persona { name, description, first_mes, personality, avatar_file }
  characters [{ name, description, first_mes, personality, avatar_file }]
  worldbook { name, intro, source }
  chapters { dir, enabled_first_only }
"""
import os
import sys
import io
import json
import base64
import argparse
import urllib.request
import urllib.error
import glob as _glob

SCRIPT = os.path.dirname(os.path.abspath(__file__))
# script/tavo_mcp_use/story_sync/ → 上三级 = tavo_plugins/
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT)))

# ---------------------------------------------------------------------------
# .env 加载
# ---------------------------------------------------------------------------
def load_env():
    env = {}
    for path in [os.path.join(ROOT, ".env"), ".env"]:
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def resolve(args):
    env = load_env()
    url = args.url or env.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置：--url/--token 或 .env")
    return url.rstrip("/"), token

# ---------------------------------------------------------------------------
# MCP JSON-RPC
# ---------------------------------------------------------------------------
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
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败: %s" % e)
    if "error" in body:
        raise RuntimeError("MCP Error: %s" % json.dumps(body["error"], ensure_ascii=False))
    return body.get("result", {})

def unwrap(result):
    """MCP 返回 {content: [{text: '...'}]} → dict/str"""
    raw = result or {}
    try:
        content = raw.get("content", [])
        if content and isinstance(content, list):
            return json.loads(content[0].get("text", "{}"))
    except Exception:
        pass
    return raw

# ---------------------------------------------------------------------------
# MCP 工具封装
# ---------------------------------------------------------------------------
def _parse_search_result(result):
    """统一解析 search 系列 MCP 返回：返回 list（每项是 dict）"""
    r = unwrap(result) if isinstance(result, dict) else result
    if isinstance(r, dict):
        return r.get("items", r.get("lorebooks", []))
    if isinstance(r, list):
        return r
    return []

def search_character(http_url, token, query):
    r = rpc(http_url, token, "tavo_character_search", {"query": query, "limit": 5})
    return _parse_search_result(r)

def file_save_b64(http_url, token, chat_id, name, b64_data, scope="global"):
    """上传 base64 文件，返回 files/<scope>/<name> 引用路径"""
    r = rpc(http_url, token, "tavo_file_save", {
        "chatId": chat_id, "name": name, "content": b64_data,
        "options": {"scope": scope, "encoding": "base64"}})
    rr = unwrap(r)
    return rr.get("path") or ""

def upload_avatar(http_url, token, chat_id, name, local_path, dry=False):
    """上传头像图 -> files/global/<name>.<ext>，返回引用路径"""
    if not local_path or not os.path.isfile(local_path):
        return ""
    if dry:
        ext = os.path.splitext(local_path)[1].lstrip(".") or "png"
        return "files/global/%s.%s" % (name, ext)
    ext = os.path.splitext(local_path)[1].lstrip(".") or "png"
    fname = "%s.%s" % (name, ext)
    with open(local_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return file_save_b64(http_url, token, chat_id, fname, b64, scope="global")

def character_import(http_url, token, name, description, first_mes, personality,
                     role_type, avatar_ref, dry=False):
    """导入角色卡。avatar_ref = files/global/xxx.png 引用路径（不是 base64）"""
    data = {
        "name": name,
        "description": description or "",
        "first_mes": first_mes or "",
        "personality": personality or "NPC",
        "roleType": role_type or "npc",
    }
    if avatar_ref:
        data["avatar"] = avatar_ref
    card = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
    if dry:
        print("  [char]    dry 创建 name=%s avatar=%s" % (name, avatar_ref or "无"))
        return "dry-run"
    r = rpc(http_url, token, "tavo_character_import_card", {"card": card})
    rr = unwrap(r)
    return rr.get("id") or rr.get("characterId")

def persona_create(http_url, token, name, description, first_mes, personality, avatar_ref, dry=False):
    args = {"persona": {
        "name": name,
        "description": description or "",
        "active": True,
    }}
    if avatar_ref:
        args["persona"]["avatar"] = avatar_ref
    if dry:
        print("  [persona] dry create name=%s avatar=%s" % (name, avatar_ref or "none"))
        return "dry-run"
    r = rpc(http_url, token, "tavo_persona_create", args)
    rr = unwrap(r)
    pid = rr.get("id") or rr.get("personaId")
    if pid:
        try:
            rpc(http_url, token, "tavo_persona_set_active", {"id": int(pid)})
        except Exception:
            pass
    return pid

def persona_search(http_url, token, query):
    r = rpc(http_url, token, "tavo_persona_search", {"query": query})
    return _parse_search_result(r)

def plugin_install(http_url, token, plugin_id, zip_b64, overwrite=True):
    r = rpc(http_url, token, "tavo_plugin_install",
            {"pluginId": plugin_id, "zipBase64": zip_b64, "overwrite": overwrite})
    return unwrap(r)

def plugin_set_enabled(http_url, token, plugin_id, enabled=True):
    r = rpc(http_url, token, "tavo_plugin_set_enabled",
            {"pluginId": plugin_id, "enabled": enabled})
    return unwrap(r)

def lorebook_create(http_url, token, name, entries):
    r = rpc(http_url, token, "tavo_lorebook_create", {"lorebook": {"name": name, "entries": entries}})
    return unwrap(r)

def lorebook_update(http_url, token, lorebook_id, entries):
    # id 必须是整数
    try:
        lid_int = int(lorebook_id)
    except (ValueError, TypeError):
        lid_int = lorebook_id
    r = rpc(http_url, token, "tavo_lorebook_update",
            {"id": lid_int, "lorebook": {"entries": entries}})
    return unwrap(r)

def lorebook_search(http_url, token, query):
    r = rpc(http_url, token, "tavo_lorebook_search", {"query": query, "limit": 5})
    return _parse_search_result(r)

def chat_create(http_url, token, chat_dict):
    r = rpc(http_url, token, "tavo_chat_create", {"chat": chat_dict})
    return unwrap(r)

def chat_update(http_url, token, chat_id, **kwargs):
    r = rpc(http_url, token, "tavo_chat_update", {"id": chat_id, "chat": kwargs})
    return unwrap(r)

def chat_search(http_url, token, query):
    r = rpc(http_url, token, "tavo_chat_search", {"query": query})
    return _parse_search_result(r)

def chat_current(http_url, token, chat_id):
    r = rpc(http_url, token, "tavo_chat_get", {"chatId": chat_id})
    return unwrap(r)

def variable_set(http_url, token, chat_id, name, value, scope="chat"):
    rpc(http_url, token, "tavo_variable_set",
        {"scope": scope, "chatId": chat_id, "name": name, "value": value})
    if scope == "chat":
        rpc(http_url, token, "tavo_variable_set",
            {"scope": "global", "name": name, "value": value})

def file_save(http_url, token, chat_id, name, local_path, scope="chat"):
    """上传本地文件 -> files/<scope>/<name>，返回引用路径（scope=chat 传 chatId）"""
    if not local_path or not os.path.isfile(local_path):
        return ""
    with open(local_path, "rb") as f:
        data_b64 = base64.b64encode(f.read()).decode()
    return file_save_b64(http_url, token, chat_id, name, data_b64, scope=scope)

# ---------------------------------------------------------------------------
# 读取 story.json
# ---------------------------------------------------------------------------
def read_story_json(story_dir):
    path = os.path.join(story_dir, "story.json")
    if not os.path.isfile(path):
        sys.exit("找不到 story.json: " + path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# 生成 story_sync_config.json（自动从 story.json 转换）
# ---------------------------------------------------------------------------
def auto_generate_sync_config(story_dir, story_data):
    """自动从 story.json 生成 story_sync_config.json"""
    config_path = os.path.join(story_dir, "story_sync_config.json")
    story_name = story_data.get("story_name", "未命名故事")

    def resolve_file(fname):
        """返回文件的绝对路径（相对 story_dir 多层查找）"""
        if not fname:
            return ""
        for sub in ["", "avatars/", "image/", "ex/avatars/"]:
            p = os.path.join(story_dir, sub, fname)
            if os.path.isfile(p):
                return p
        p = os.path.join(story_dir, fname)
        return p if os.path.isfile(p) else ""

    def resolve_md(md_fname):
        """读取 md 文件内容"""
        if not md_fname:
            return ""
        for sub in ["", "avatars/", "roles/"]:
            p = os.path.join(story_dir, sub, md_fname)
            if os.path.isfile(p):
                with open(p, encoding="utf-8") as f:
                    return f.read()
        return ""

    # persona
    player = story_data.get("player_role", {})
    persona_avatar = resolve_file(player.get("avatar_file", ""))

    persona = {
        "name": player.get("name", "纯小白"),
        "description": story_data.get("card_scenario", ""),
        "first_mes": story_data.get("intro", ""),
        "personality": "玩家",
        "avatar_file": persona_avatar,
    }

    # characters
    characters = []
    for npc in story_data.get("npc_roles", []):
        av = resolve_file(npc.get("avatar_file", ""))
        desc = resolve_md(npc.get("md_file", ""))
        characters.append({
            "name": npc.get("name", ""),
            "description": desc or npc.get("name", ""),
            "first_mes": "",
            "personality": "NPC",
            "avatar_file": av,
            "roleType": "npc",
        })

    # 世界书 entries（从 story.json 的字段构建）
    entries = []
    for label, content in [
        ("世界观背景", story_data.get("global_bg", "")),
        ("角色与关系", story_data.get("card_scenario", "")),
        ("故事简介", story_data.get("intro", "")),
    ]:
        if content:
            entries.append({"name": label, "content": content,
                             "strategy": "constant", "enabled": True})

    worldbook = {
        "name": story_name,
        "intro": story_data.get("intro", ""),
        "source_entries": entries,
        "dir": "chapters",
    }

    chapters = {"dir": "chapters", "enabled_first_only": True}

    config = {
        "story_name": story_name,
        "chat_name": story_name + " · 第1章",
        "response_mode": "natural",
        "bind_persona": True,
        "persona": persona,
        "characters": characters,
        "worldbook": worldbook,
        "chapters": chapters,
    }

    if os.path.isfile(config_path):
        print("  [config] story_sync_config.json 已存在，跳过（手动编辑优先）")
        cfg = json.load(open(config_path, encoding="utf-8"))
        # 同步 source_entries（story.json 更新时同步）
        if "source_entries" not in cfg.get("worldbook", {}):
            cfg["worldbook"]["source_entries"] = entries
        return cfg

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print("  [config] 自动生成 story_sync_config.json")
    return config

# ---------------------------------------------------------------------------
# 读取 md 文件
# ---------------------------------------------------------------------------
def read_md(story_dir, md_file):
    if not md_file:
        return ""
    for subdir in ["", "avatars/", "roles/"]:
        path = os.path.join(story_dir, subdir, md_file)
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                return f.read()
    return md_file  # fallback: 用文件名本身

def avatar_abs(story_dir, rel_path):
    if not rel_path:
        return ""
    for sub in ["", "avatars/", "image/", "ex/avatars/"]:
        p = os.path.join(story_dir, sub, rel_path)
        if os.path.isfile(p):
            return p
    return os.path.join(story_dir, rel_path) if os.path.isfile(os.path.join(story_dir, rel_path)) else ""

# ---------------------------------------------------------------------------
# 构建角色卡 JSON
# ---------------------------------------------------------------------------
def build_character_card(name, description, first_mes, personality, avatar_rel, story_dir):
    card = {
        "name": name,
        "description": description,
        "firstMes": first_mes or "",
        "personality": personality or "NPC",
    }
    avatar_path = avatar_abs(story_dir, avatar_rel)
    return card, avatar_path  # 返回 dict 和绝对路径

# ---------------------------------------------------------------------------
# 同步角色卡
# ---------------------------------------------------------------------------
def sync_characters(http_url, token, config, story_dir, dry, force, chat_id_for_files):
    print("\n=== 同步角色卡 ===")
    results = {}  # name -> tavo_id

    # persona（玩家身份，走 persona_create，不是 character_import_card）
    p = config.get("persona", {})
    if p.get("name"):
        name = p["name"]
        av_local = avatar_abs(story_dir, p.get("avatar_file", ""))
        found_list = persona_search(http_url, token, name)
        existing = None
        for it in found_list:
            if it.get("name") == name:
                existing = it.get("id")
                break
        if existing and not force:
            print("  [persona] 复用 id=%s name=%s" % (existing, name))
            results[name] = existing
        else:
            av_ref = upload_avatar(http_url, token, chat_id_for_files, name, av_local, dry=dry)
            pid = persona_create(http_url, token, name,
                                 p.get("description", ""), p.get("first_mes", ""),
                                 p.get("personality", "玩家"), av_ref, dry=dry)
            if not dry:
                print("  [persona] 创建 id=%s name=%s avatar=%s" % (pid, name, av_ref or "无"))
            results[name] = pid

    # NPCs（走 character_import_card，avatar 用 files/global 引用）
    for c in config.get("characters", []):
        name = c.get("name")
        if not name:
            continue
        av_local = avatar_abs(story_dir, c.get("avatar_file", ""))
        found_list = search_character(http_url, token, name)
        existing = None
        for it in found_list:
            if it.get("name") == name:
                existing = it.get("id")
                break
        if existing:
            print("  [char]    复用 id=%s name=%s" % (existing, name))
            results[name] = existing
        else:
            print("  [char]    未找到，将创建 id=%s name=%s" % ("?", name))
            av_ref = upload_avatar(http_url, token, chat_id_for_files, name, av_local, dry=dry)
            cid = character_import(http_url, token, name,
                                   c.get("description", ""), c.get("first_mes", ""),
                                   c.get("personality", "NPC"),
                                   c.get("roleType", "npc"), av_ref, dry=dry)
            if not dry:
                print("  [char]    创建 id=%s name=%s avatar=%s" % (cid, name, av_ref or "无"))
            results[name] = cid

    return results  # {name: id}

# ---------------------------------------------------------------------------
# 同步世界书
# ---------------------------------------------------------------------------
def sync_worldbook(http_url, token, config, dry):
    print("\n=== 同步世界书 ===")
    wb = config.get("worldbook", {})
    name = wb.get("name", config.get("story_name", "未命名"))
    entries = wb.get("source_entries", [])

    # 如果没有预生成 entries，从 chapters/ 目录构建
    if not entries:
        story_dir = getattr(dry, 'story_dir', '.')
        ch_dir = os.path.join(story_dir, wb.get("dir", "chapters"), "")
        for fpath in sorted(_glob.glob(ch_dir + "*.json")):
            fname = os.path.basename(fpath)
            with open(fpath, encoding="utf-8") as f:
                ch = json.load(f)
            entries.append({
                "name": ch.get("title", fname.replace(".json","")),
                "content": ch.get("content",""),
                "strategy": "keyword",
                "enabled": False,
                "keywords": [ch.get("title","")],
            })

    if not entries:
        print("  [worldbook] 无 entries，跳过")
        return None

    found = lorebook_search(http_url, token, name) if not dry else []
    if found:
        lb = found[0]
        lid = lb.get("lorebookId") or lb.get("id")
        print("  [worldbook] 复用 id=%s name=%s" % (lid, name))
        if not dry:
            lorebook_update(http_url, token, lid, entries)
            print("  [worldbook] 更新 entries=%d" % len(entries))
        return lid
    else:
        if not dry:
            r = lorebook_create(http_url, token, name, entries)
            lid = r.get("lorebookId") or r.get("id")
            print("  [worldbook] 创建 id=%s name=%s entries=%d" % (lid, name, len(entries)))
            return lid
        else:
            print("  [worldbook] dry 创建 name=%s entries=%d" % (name, len(entries)))
            return "（dry-run: 将创建世界书）"

# ---------------------------------------------------------------------------
# 同步/创建群聊
# ---------------------------------------------------------------------------
def sync_chat(http_url, token, config, char_ids, lorebook_id, persona_id, existing_chat_id, dry):
    print("\n=== sync chat ===")
    chat_name = config.get("chat_name", config.get("story_name","unnamed") + " - ch1")
    response_mode = config.get("response_mode", "natural")

    def to_int_list(values):
        out = []
        for v in values:
            if v in (None, "", "dry-run"):
                continue
            try:
                out.append(int(v))
            except (ValueError, TypeError):
                pass
        return out
    char_id_list = to_int_list((char_ids or {}).values())
    lorebook_ids = [int(lorebook_id)] if lorebook_id and str(lorebook_id).isdigit() else []
    persona_int = int(persona_id) if persona_id and str(persona_id).isdigit() else None

    def do_update(cid):
        if dry:
            print("  [chat] dry update id=%s name=%s" % (cid, chat_name))
            return
        kwargs = {"name": chat_name, "responseMode": response_mode}
        if char_id_list:
            kwargs["characterIds"] = char_id_list
        if lorebook_ids:
            kwargs["lorebookIds"] = lorebook_ids
        if persona_int:
            kwargs["personaId"] = persona_int
        chat_update(http_url, token, cid, **kwargs)
        print("  [chat] update id=%s name=%s" % (cid, chat_name))

    def do_create():
        if dry:
            print("  [chat] dry create name=%s" % chat_name)
            return "dry-run"
        chat_dict = {"name": chat_name, "responseMode": response_mode}
        if char_id_list:
            chat_dict["characterIds"] = char_id_list
        if lorebook_ids:
            chat_dict["lorebookIds"] = lorebook_ids
        if persona_int:
            chat_dict["personaId"] = persona_int
        r = chat_create(http_url, token, chat_dict)
        cid = r.get("chatId") or r.get("id")
        print("  [chat] create id=%s name=%s" % (cid, chat_name))
        return cid

    if existing_chat_id:
        do_update(existing_chat_id)
        return existing_chat_id

    found = chat_search(http_url, token, chat_name) if not dry else []
    if found:
        cid = found[0].get("chatId") or found[0].get("id")
        print("  [chat] reuse id=%s name=%s" % (cid, chat_name))
        do_update(cid)
        return cid
    return do_create()

# ---------------------------------------------------------------------------
# 同步章节到 chat 变量
# ---------------------------------------------------------------------------
def sync_chapters(http_url, token, chat_id, config, story_dir, dry):
    print("\n=== 同步章节 ===")
    ch_cfg = config.get("chapters", {})
    ch_dir = os.path.join(story_dir, ch_cfg.get("dir", "chapters"), "")
    enabled_first = ch_cfg.get("enabled_first_only", True)
    chapters = []

    for fpath in sorted(_glob.glob(ch_dir + "*.json")):
        fname = os.path.basename(fpath)
        with open(fpath, encoding="utf-8") as f:
            ch = json.load(f)
        enabled = False
        if fname.startswith("1") or fname == sorted(_glob.glob(ch_dir + "*.json"))[0]:
            enabled = True
        chapters.append({
            "title": ch.get("title", fname.replace(".json","")),
            "content": ch.get("content",""),
            "openingRole": ch.get("openingRole",""),
            "openingLine": ch.get("openingLine",""),
            "events": ch.get("events",[]),
            "successCondition": ch.get("successCondition",""),
            "enabled": enabled,
        })
        print("  [chapter] %s %s (enabled=%s)" % (
            fname, chapters[-1]["title"], enabled))

    if chapters and not dry:
        # Clear global scope to avoid reading stale data
        for var_name in ['tf_story.edit', 'tf_progress']:
            try:
                rpc(http_url, token, 'tavo_variable_set',
                    {'scope': 'global', 'name': var_name, 'value': {}})
            except:
                pass
        # Read existing from chat scope
        try:
            existing = unwrap(rpc(http_url, token, 'tavo_variable_get',
                {'chatId': chat_id, 'scope': 'chat', 'name': 'tf_story.edit'}))
        except Exception:
            existing = {}
        edit = dict(existing) if isinstance(existing, dict) else {}
        edit['chapters'] = chapters
        edit['currentChapterIndex'] = 0
        variable_set(http_url, token, chat_id, 'tf_story.edit', edit)
        print('  [chapter] Write tf_story.edit.chapters=%d chapters' % len(chapters))
        # Init tf_progress
        progress = {'currentChapterIndex': 0, 'currentEvent': 0, 'completedChapters': [], 'phases': [], 'currentPhase': 0, 'currentEventIndex': 0}
        variable_set(http_url, token, chat_id, 'tf_progress', progress)
        print('  [progress] Init tf_progress')
    return chapters


# ---------------------------------------------------------------------------
# 同步立绘资源
# ---------------------------------------------------------------------------
def sync_sprites(http_url, token, chat_id, config, story_dir, dry):
    print("\n=== 同步立绘资源 ===")
    # ex/avatars/<角色>/  前景
    # image/chapter_*_bg.png       章节背景
    # image/cover.jpg | bg.jpg    兜底背景
    sprites_by_name = {}
    sprites_by_id = {}
    chapter_bgs = {}
    fallback_bg = ""

    # 角色立绘
    ex_avatars = os.path.join(story_dir, "ex", "avatars")
    old_avatars = os.path.join(story_dir, "avatars")
    img_dir = os.path.join(story_dir, "image")
    char_map = config.get("_char_id_map", {})  # {name: tavo_id}

    for char_name, tavo_id in char_map.items():
        entry = {"id": tavo_id, "name": char_name, "roleType": "npc", "fg": "", "bg": ""}

        # 三层 fallback
        fg_path = None; fg_ext = ".png"
        ex_dir = os.path.join(ex_avatars, char_name)
        for src_fname, ext in [("original.png", ".png"), ("avatar.webp", ".webp")]:
            src = os.path.join(ex_dir, src_fname) if os.path.isdir(ex_dir) else None
            if src and os.path.isfile(src):
                fg_path = src; fg_ext = ext; break
        if not fg_path:
            old = os.path.join(old_avatars, char_name + ".png")
            if os.path.isfile(old):
                fg_path = old; fg_ext = ".png"
        # 氛围背景
        bg_src = None
        if os.path.isdir(ex_dir):
            bg_src = os.path.join(ex_dir, "background.png")

        if fg_path:
            dest = "sprite_fg_%s%s" % (tavo_id, fg_ext)
            if not dry:
                saved = file_save(http_url, token, chat_id, dest, fg_path)
                entry["fg"] = saved
            else:
                entry["fg"] = dest + " (dry)"
            print("  [sprite] %s fg -> %s" % (char_name, entry["fg"]))
        if bg_src and os.path.isfile(bg_src):
            dest = "sprite_bg_%s.png" % tavo_id
            if not dry:
                saved = file_save(http_url, token, chat_id, dest, bg_src)
                entry["bg"] = saved
            else:
                entry["bg"] = dest + " (dry)"
            print("  [sprite] %s bg -> %s" % (char_name, entry["bg"]))

        if entry["fg"] or entry["bg"]:
            sprites_by_name[char_name] = entry
            sprites_by_id[str(tavo_id)] = {"name": char_name,
                "fg": entry.get("fg",""), "bg": entry.get("bg","")}

    # 章节背景
    if os.path.isdir(img_dir):
        for fname in sorted(os.listdir(img_dir)):
            if not fname.startswith("chapter_") or not any(fname.endswith(e) for e in ["_background.png","_cover.png","_bg.png"]):
                continue
            key = fname.replace(".png","").replace("_background","").replace("_cover","").replace("_bg","")
            dest = "chapter_bg_%s.png" % key
            if not dry:
                saved = file_save(http_url, token, chat_id, dest, os.path.join(img_dir, fname))
                chapter_bgs[key] = saved
            else:
                chapter_bgs[key] = dest + " (dry)"
            print("  [chapter_bg] %s -> %s" % (fname, chapter_bgs[key]))

    # 兜底背景
    for cand in ["cover.jpg", "bg.jpg"]:
        cand_path = os.path.join(img_dir, cand)
        if os.path.isfile(cand_path):
            if not dry:
                fallback_bg = file_save(http_url, token, chat_id, "fallback_bg.jpg", cand_path)
            else:
                fallback_bg = "fallback_bg.jpg (dry)"
            print("  [fallback_bg] %s -> %s" % (cand, fallback_bg))
            break

    if not dry and sprites_by_name:
        variable_set(http_url, token, chat_id, "tf_sprites",
            {"byName": sprites_by_name, "byId": sprites_by_id})
        print("  [tf_sprites] -> %d 角色" % len(sprites_by_name))
    if not dry and chapter_bgs:
        variable_set(http_url, token, chat_id, "tf_chapter_backgrounds", chapter_bgs)
        print("  [tf_chapter_backgrounds] -> %d 章节" % len(chapter_bgs))
    if not dry and fallback_bg:
        variable_set(http_url, token, chat_id, "tf_sprite_fallback_bg", fallback_bg)
        print("  [tf_sprite_fallback_bg] -> %s" % fallback_bg)

    return sprites_by_name, chapter_bgs, fallback_bg

# ---------------------------------------------------------------------------
# 同步插件（打包 plugins/ 目录安装）
# ---------------------------------------------------------------------------
_PLUGINS_TO_INSTALL = [
    "toonflow_story_event_manager",
    "toonflow_story_memory_manager",
    "toonflow_story_multi_character_stage",
    "toonflow_story_speaker",
    "toonflow_story_sprite_background",
    "toonflow_story_style",
    "toonflow_story_debug_eruda",
]

def _build_plugin_zip(plugin_dir):
    """把插件目录打成内存 zip，返回 base64"""
    import zipfile, io as _io
    _SKIP = {".git", "__pycache__", "node_modules"}
    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in _SKIP]
            for f in files:
                if f.endswith(".pyc") or f == ".DS_Store":
                    continue
                p = os.path.join(base, f)
                rel = os.path.relpath(p, plugin_dir).replace(os.sep, "/")
                z.write(p, rel)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def _read_manifest_id(plugin_dir):
    mp = os.path.join(plugin_dir, "manifest.json")
    if not os.path.isfile(mp):
        return None
    with open(mp, encoding="utf-8") as f:
        m = json.load(f)
    return m.get("id")

def sync_plugins(http_url, token, dry):
    print("\n=== 同步插件 ===")
    plugins_root = os.path.join(ROOT, "plugins")
    if not os.path.isdir(plugins_root):
        print("  [plugins] plugins/ 目录不存在，跳过")
        return
    installed = 0
    for name in _PLUGINS_TO_INSTALL:
        pdir = os.path.join(plugins_root, name)
        if not os.path.isdir(pdir):
            print("  [plugin] 跳过（不存在）: " + name)
            continue
        pid = _read_manifest_id(pdir)
        if not pid:
            print("  [plugin] 跳过（无 id）: " + name)
            continue
        if dry:
            print("  [plugin] dry 安装: %s (%s)" % (pid, name))
            continue
        try:
            b64 = _build_plugin_zip(pdir)
            r = plugin_install(http_url, token, pid, b64, overwrite=True)
            ok = r.get("ok")
            print("  [plugin] %s -> ok=%s version=%s" % (pid, ok, r.get("version")))
            if ok in (True, "true"):
                plugin_set_enabled(http_url, token, pid, True)
                installed += 1
        except Exception as e:
            print("  [plugin] %s 失败: %s" % (pid, e))
    print("  已安装 %d 个插件" % installed)
def main():
    p = argparse.ArgumentParser(
        description="故事完整安装到 tavo（角色卡+世界书+群聊+章节+立绘+插件）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例:
  story_sync_all.py "/path/to/story" --dry-run
  story_sync_all.py "/path/to/story" --force --chat-id 1
  story_sync_all.py --check
""")
    p.add_argument("story_dir", nargs="?", default=".cache/story",
                   help="故事目录（默认 .cache/story）")
    # 标准短选项
    p.add_argument("-n", "--dry-run", dest="dry", action="store_true",
                   help="预演模式，不实际写入")
    p.add_argument("-f", "--force", action="store_true",
                   help="强制重导角色卡")
    p.add_argument("-c", "--check", action="store_true",
                   help="仅连通性检查")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="详细输出")
    # 跳过步骤
    p.add_argument("--skip-sprite", action="store_true", help="跳过立绘同步")
    p.add_argument("--skip-chapters", action="store_true", help="跳过章节同步")
    p.add_argument("--skip-plugins", action="store_true", help="跳过插件安装")
    p.add_argument("--skip-voice", action="store_true", help="跳过世界书（历史名，实际跳 lorebook）")
    # 连接/重绑
    p.add_argument("--chat-id", type=int, help="指定已有群聊 ID（跳过创建）")
    p.add_argument("--url", help="MCP URL（覆盖 .env）")
    p.add_argument("--token", help="MCP Token（覆盖 .env）")
    args = p.parse_args()

    if args.dry and args.force:
        print("警告: --dry-run 与 --force 同时设置，--force 不会执行任何写操作", file=sys.stderr)

    http_url, token = resolve(args)

    # 连通性检查
    print("=== 连通性检查 ===")
    try:
        rpc(http_url, token, "tavo_plugin_search", {})
        print("  MCP OK\n")
    except Exception as e:
        print("  MCP 连接失败: " + str(e), file=sys.stderr)
        sys.exit(1)

    if args.check:
        print("  check OK")
        return

    # 找故事目录
    story_dir = args.story_dir
    if not os.path.isdir(story_dir):
        # 尝试 .cache/story/<name>
        name = os.path.basename(story_dir)
        alt = os.path.join(".cache/story", name)
        if os.path.isdir(alt):
            story_dir = alt
        else:
            # 列出可用故事
            cache = ".cache/story"
            if os.path.isdir(cache):
                print("可用故事目录:")
                for d in sorted(os.listdir(cache)):
                    print("  -", d)
            sys.exit("故事目录不存在: " + story_dir)

    print("故事目录:", story_dir)

    # 1. 读取 story.json
    story_data = read_story_json(story_dir)
    print("故事:", story_data.get("story_name","未命名"))

    # 2. 生成 story_sync_config.json
    config = auto_generate_sync_config(story_dir, story_data)
    config["_story_dir"] = story_dir  # 透传给后续步骤

    # 3. 先建/取群聊拿 chat_id（avatar 上传需要 chatId）
    chat_id = sync_chat(http_url, token, config, {}, None, None, args.chat_id, args.dry)
    print("\n=== chat_id = %s ===" % chat_id)

    # 4. 同步角色卡（avatar 先 file_save 成 files/global 引用，再写进 card）
    char_ids = sync_characters(http_url, token, config, story_dir, args.dry, args.force, chat_id)
    config["_char_id_map"] = char_ids

    # 5. 同步世界书
    lorebook_id = sync_worldbook(http_url, token, config, args.dry) if not args.skip_voice else None

    # 6. persona_id
    persona_id = char_ids.get(config.get("persona", {}).get("name", ""))
    print("\n=== persona_id = %s ===" % (persona_id or "无"))

    # 7. 重绑群聊（角色卡 + 世界书 + persona 都到位后再 update）
    if not args.dry:
        try:
            chat_update(http_url, token, chat_id,
                characterIds=[int(v) for v in char_ids.values() if v and str(v).isdigit()],
                lorebookIds=[int(lorebook_id)] if lorebook_id and str(lorebook_id).isdigit() else [],
                personaId=int(persona_id) if persona_id and str(persona_id).isdigit() else None,
                responseMode=config.get("response_mode", "natural"))
            print("  [chat] 重绑角色+世界书+persona OK")
        except Exception as e:
            print("  [chat] 重绑失败: %s" % e)

    # 7. 同步章节
    if not args.skip_chapters:
        sync_chapters(http_url, token, chat_id, config, story_dir, args.dry)

    # 8. 同步立绘
    if not args.skip_sprite:
        sync_sprites(http_url, token, chat_id, config, story_dir, args.dry)

    # 9. 同步插件
    if not args.skip_plugins:
        sync_plugins(http_url, token, args.dry)

    print("\n=== 完成 ===")
    if args.dry:
        print("dry-run 模式，未实际写入任何数据")
    else:
        print("chat_id:", chat_id)
        print("lorebook_id:", lorebook_id)
        print("角色数量:", len(char_ids))

def _exit(rc, msg=None):
    if msg:
        print(msg, file=sys.stderr)
    sys.exit(rc)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        _exit(130, "Interrupted")
    except SystemExit:
        raise
    except Exception as e:
        print("Fatal: %s" % e, file=sys.stderr)
        _exit(1)
