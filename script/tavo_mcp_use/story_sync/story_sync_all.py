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
    if method == "tavo_variable_set":
        print(f"  [tavo_variable_set] args:{arguments.get('scope')} {arguments.get('name')}")
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
    """上传 base64 文件，返回 files/<scope>/<name> 引用路径

    chat_id 无效（None/0/非正整数）= 群聊尚未创建（新故事），此时不调用
    tavo_file_save（服务端拒绝 chatId<=0），跳过上传返回空，
    由后续 upload_character_avatars 阶段在 chat 创建后再补传。
    """
    if chat_id is None or not str(chat_id).strip().lstrip("-").isdigit() or int(chat_id) <= 0:
        print("  [file_save_b64] chat_id=%r 无有效群聊（新故事），跳过上传: %s" % (chat_id, name))
        return ""
    r = rpc(http_url, token, "tavo_file_save", {
        "chatId": int(chat_id), "name": name, "content": b64_data,
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

def character_get(http_url, token, cid):
    """读取角色卡详情（search 返回不含 tags/extensions，需 get 二次确认）"""
    r = rpc(http_url, token, "tavo_character_get", {"id": int(cid)})
    rr = unwrap(r)
    # 兼容 tavo 返回结构：{data:{...}} 或直接 {...}
    if isinstance(rr, dict) and "data" in rr and isinstance(rr["data"], dict):
        return rr["data"]
    return rr

def character_import(http_url, token, name, description, first_mes, personality,
                     role_type, avatar_ref, dry=False, extensions=None):
    """导入角色卡。avatar_ref = files/global/xxx.png 引用路径（不是 base64）。

    extensions: 可选 dict，写入角色卡 extensions 字段（如群聊归属标记）。
    """
    data = {
        "name": name,
        "description": description or "",
        "first_mes": first_mes or "",
        "personality": personality or "NPC",
        "roleType": role_type or "npc",
    }
    if avatar_ref:
        data["avatar"] = avatar_ref
    if extensions:
        # 合并保留已有 extensions（import 时一般是新卡，直接赋值即可，兼容传 dict）
        data["extensions"] = extensions
    card = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
    if dry:
        print("  [char]    dry 创建 name=%s avatar=%s" % (name, avatar_ref or "无"))
        return "dry-run"
    r = rpc(http_url, token, "tavo_character_import_card", {"card": card})
    rr = unwrap(r)
    return rr.get("id") or rr.get("characterId")

def character_update_avatar(http_url, token, cid, name, description, first_mes, personality, avatar_ref, dry=False, extensions=None):
    """原地更新角色卡 avatar 字段（不删除/重导，保持 character id 不变）。

    此前 avatar 更新 = tavo_character_delete(旧id) + character_import(新id)，会产生新 id，
    且服务端删除角色时会把该角色从【其所在的所有群聊】级联移除成员；当两个故事
    共享同名 NPC 角色 id 时，重导一方会把另一故事的群聊成员清空。
    改用 tavo_character_update 直接更新 avatar 字段，id 稳定、不触发级联删成员。

    extensions: 可选 dict，随更新写入（合并到现有 extensions）。

    返回更新后的 character id（与入参 cid 相同）。
    """
    data = {
        "name": name,
        "description": description or "",
        "first_mes": first_mes or "",
        "personality": personality or "NPC",
        "avatar": avatar_ref,
    }
    if extensions:
        # 更新走 merge 语义：先取现有 extensions，合并新键，避免覆盖已有标记
        try:
            cur = character_get(http_url, token, int(cid))
            cur_ext = dict(cur.get("extensions") or {})
            cur_ext.update(extensions)
            data["extensions"] = cur_ext
        except Exception as e:
            print("  [char]    读取现有 extensions 失败（视为无），直接写新值: %s" % e)
            data["extensions"] = extensions
    if dry:
        print("  [char]    dry 原地更新 avatar name=%s avatar=%s" % (name, avatar_ref))
        return cid
    r = rpc(http_url, token, "tavo_character_update", {"id": int(cid), "character": data})
    rr = unwrap(r)
    print("  [char]    原地更新 avatar id=%s name=%s avatar=%s" % (cid, name, avatar_ref))
    return int(rr.get("id") or cid)

def character_replace_avatar(http_url, token, chat_id, old_cid, name, description, first_mes,
                             personality, avatar_ref, dry=False, extensions=None):
    """头像更新走 import 新卡 → chat 重绑 → 删旧卡，保证 avatar 真正落库。

    背景：tavo_character_update 写 avatar 字段被服务端静默忽略（返回 ok 但 get 回
    avatar 仍为 null，8/14 avatar_status.md 实测）。唯一能落库角色头像的 MCP 路径是
    tavo_character_import_card 整卡导入（带顶层 avatar 字段）。

    流程：
      1. character_import 建新卡（带 avatar_ref + extensions）→ new_cid
      2. chat_get 读当前 chat 的 characterIds，把 old_cid 原位替换为 new_cid → chat_update
      3. character_delete 删除旧卡（先重绑再删，避免旧卡被删时级联把角色移出群聊）
    返回新 character id（new_cid）；失败时抛异常，不吞。
    """
    if dry:
        print("  [char]    dry import新卡删旧卡 name=%s avatar=%s" % (name, avatar_ref or "无"))
        return old_cid

    # step 1: 导入新卡（带 avatar）
    new_cid = character_import(http_url, token, name, description or "",
                               first_mes or "", personality or "NPC",
                               "npc", avatar_ref, dry=False, extensions=extensions)
    if not new_cid:
        raise RuntimeError("替换头像失败：character_import 未返回新 id (name=%s)" % name)
    print("  [char]    import 新卡 id=%s name=%s avatar=%s" % (new_cid, name, avatar_ref or "无"))

    # step 2: chat 重绑（把旧 id 替换为新 id）
    if chat_id and str(chat_id).strip().lstrip("-").isdigit() and int(chat_id) > 0:
        try:
            cur = chat_current(http_url, token, int(chat_id))
            # 兼容返回结构：{data:{...}} / {chat:{...}} / 直接 dict
            chat_node = cur
            if isinstance(cur, dict):
                for key in ("data", "chat"):
                    if key in cur and isinstance(cur[key], dict):
                        chat_node = cur[key]
                        break
            member_ids = []
            if isinstance(chat_node, dict):
                member_ids = chat_node.get("characterIds") or []
            replaced = False
            new_list = []
            for m in member_ids:
                mid = m.get("id") if isinstance(m, dict) else m
                try:
                    mid = int(mid)
                except (TypeError, ValueError):
                    continue
                if mid == int(old_cid):
                    new_list.append(int(new_cid))
                    replaced = True
                else:
                    new_list.append(mid)
            if replaced:
                chat_update(http_url, token, int(chat_id), characterIds=new_list)
                print("  [char]    chat %s 成员已重绑 %s -> %s" % (chat_id, old_cid, new_cid))
            else:
                print("  [char]    chat %s 成员未找到旧 id=%s（无需重绑）" % (chat_id, old_cid))
        except Exception as e:
            # 重绑失败必须中止（新卡已建，旧卡未删，交给用户处理），
            # 而不是继续删旧卡导致角色从群聊消失。
            raise RuntimeError("替换头像失败：chat 重绑异常 (name=%s, error=%s)" % (name, e))

    # step 3: 删除旧卡（此时新卡已入群，删旧卡不再影响群聊成员）
    try:
        rpc(http_url, token, "tavo_character_delete", {"id": int(old_cid)})
        print("  [char]    删除旧卡 id=%s name=%s" % (old_cid, name))
    except Exception as e:
        print("  [char]    删除旧卡失败（保留旧卡，不影响新卡）: %s" % e)

    return int(new_cid)


def persona_create_minimal(http_url, token, name, description, dry=False, chat_id=None):
    """创建 persona（不传 avatar），用于在没有 chat_id 时拿到 persona_id 给 chat_create 用。

    优先复用现有 persona（避免创建多个副本），仅在没有任何同名 persona 时才创建。
    返回 persona id（int）或 None。
    """
    if not name:
        return None
    if not dry:
        found = persona_search(http_url, token, name)
        for it in found:
            if it.get("name") == name:
                pid = it.get("id")
                print("  [persona] 复用 id=%s name=%s" % (pid, name))
                return pid
    else:
        print("  [persona] dry 复用 name=%s" % name)
        return "dry-run"
    # 没有同名 persona 才创建（不传 avatar）
    args = {"persona": {"name": name, "description": description or "", "active": True}}
    if chat_id:
        args["chatId"] = chat_id
    r = rpc(http_url, token, "tavo_persona_create", args)
    rr = unwrap(r)
    pid = rr.get("id") or rr.get("personaId")
    if pid:
        try:
            set_active_args = {"id": int(pid)}
            if chat_id:
                set_active_args["chatId"] = chat_id
            rpc(http_url, token, "tavo_persona_set_active", set_active_args)
        except Exception:
            pass
        print("  [persona] 创建 id=%s name=%s (无 avatar，延后上传)" % (pid, name))
    return pid


def persona_create(http_url, token, name, description, first_mes, personality, avatar_ref, dry=False, chat_id=None):
    args = {"persona": {
        "name": name,
        "description": description or "",
        "active": True,
    }}
    if avatar_ref:
        args["persona"]["avatar"] = avatar_ref
    if chat_id:
        args["chatId"] = chat_id
    if dry:
        print("  [persona] dry create name=%s avatar=%s" % (name, avatar_ref or "none"))
        return "dry-run"
    r = rpc(http_url, token, "tavo_persona_create", args)
    rr = unwrap(r)
    pid = rr.get("id") or rr.get("personaId")
    if pid:
        try:
            set_active_args = {"id": int(pid)}
            if chat_id:
                set_active_args["chatId"] = chat_id
            rpc(http_url, token, "tavo_persona_set_active", set_active_args)
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
    # 合并: id + chat
    chat_dict = dict(kwargs)
    # 移除空值
    chat_dict = {k: v for k, v in chat_dict.items() if v is not None and v != ""}
    print("  [chat] chat_update:",chat_dict)
    r = rpc(http_url, token, "tavo_chat_update", {"id": chat_id, "chat": chat_dict})
    return unwrap(r)

def chat_search(http_url, token, query):
    r = rpc(http_url, token, "tavo_chat_search", {"query": query})
    return _parse_search_result(r)

def chat_current(http_url, token, chat_id):
    # 注意：tavo_chat_get 的校验参数名是 "id"（传 chatId 会报 -32602 Invalid params）
    r = rpc(http_url, token, "tavo_chat_get", {"id": chat_id})
    return unwrap(r)

def variable_set(http_url, token, chat_id, name, value, scope="chat"):
    args = {"scope": scope, "name": name, "value": value}
    print(f"  [tavo_variable_set] args:{args}")
    if scope == "chat":
        args["chatId"] = chat_id
    rpc(http_url, token, "tavo_variable_set", args)

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
        # 同步故事数据（intro, global_bg, card_scenario, card_tags）
        cfg["intro"] = story_data.get("intro", "")
        cfg["global_bg"] = story_data.get("global_bg", "")
        cfg["card_scenario"] = story_data.get("card_scenario", "")
        cfg["card_tags"] = story_data.get("card_tags", [])
        # 修 Bug #3: 差量更新 characters（按 name 为 key）
        # 新增的 npc 角色会被加进去，被移除的角色会被从 config 里删掉
        # （但手动编辑的 description/first_mes 不会被覆盖）
        existing_by_name = {c.get("name"): c for c in cfg.get("characters", []) if c.get("name")}
        new_characters = []
        for c in characters:
            name = c.get("name")
            if not name:
                continue
            existing = existing_by_name.get(name)
            if existing:
                # 保留现有的 description/first_mes/personality/avatar_file（手动编辑优先）
                # 只补上 roleType 等 story.json 强制的字段
                merged = dict(existing)
                for k, v in c.items():
                    if k not in merged or merged.get(k) in (None, "", "NPC"):
                        merged[k] = v
                new_characters.append(merged)
            else:
                new_characters.append(c)
        # 删除已经从 story.json 移除的角色（但永远保留「旁白」系统自带角色）
        removed = [name for name in existing_by_name
                   if name not in {c.get("name") for c in characters} and name != "旁白"]
        if removed:
            print("  [config] characters 移除: %s" % removed)
        # 兜底：把「旁白」放在最后（如果 story.json 仍然要求保留）
        if "旁白" not in {c.get("name") for c in new_characters}:
            narrator = next((c for c in cfg.get("characters", []) if c.get("name") == "旁白"), None)
            if narrator:
                new_characters.append(narrator)
        cfg["characters"] = new_characters
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        print("  [config] 差量同步 characters: 共 %d 个（新增 %d, 删除 %d）" % (
            len(new_characters),
            sum(1 for c in new_characters if c.get("name") not in existing_by_name),
            len(removed),
        ))
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
def sync_characters(http_url, token, config, story_dir, dry, force, chat_id_for_files=None, skip_avatar=False):
    """同步角色卡。

    skip_avatar=True 时只创建/复用 character 记录，不上传 avatar（用于在 sync_chat 之前先拿 id，
    解决 chat.characterIds 必填 + tavo_file_save 需要 chatId 的鸡生蛋问题）。
    之后用 upload_character_avatars 补 avatar。
    """
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
            if skip_avatar:
                # 第一阶段：只创建/复用 persona 记录（不上传 avatar）
                # 即使 --force，已存在的 persona 也可以直接复用（ID 不变，avatar 后面再更新）
                if existing:
                    results[name] = existing
                    print("  [persona] 复用(已存在) id=%s name=%s" % (existing, name))
                else:
                    pid = persona_create_minimal(http_url, token, name,
                                                 p.get("description", ""), dry=dry,
                                                 chat_id=chat_id_for_files or None)
                    results[name] = pid
                    print("  [persona] (no avatar yet) id=%s name=%s" % (results[name], name))
            else:
                av_ref = upload_avatar(http_url, token, chat_id_for_files, name, av_local, dry=dry)
                pid = persona_create(http_url, token, name,
                                     p.get("description", ""), p.get("first_mes", ""),
                                     p.get("personality", "玩家"), av_ref, dry=dry,
                                     chat_id=chat_id_for_files or None)
                if not dry:
                    print("  [persona] 创建 id=%s name=%s avatar=%s" % (pid, name, av_ref or "无"))
                results[name] = pid

    # NPCs（走 character_import_card，avatar 用 files/global 引用）
    # 群聊归属标记：写进角色卡 extensions.tavo_chat，作为「该角色属于哪个群聊」的唯一标识。
    # 查重从「仅按 name」升级为「name + 群聊归属」双匹配，同名但归属不同群聊的角色
    # 不视为可复用 —— 这是避免两故事共享同一批角色 id 的关键（共享 + delete+reimport
    # 是之前跨群聊级联清空 chat4 的根因，现 avatar 已改原地更新，归属隔离把共享也彻底切断）。
    chat_tag = (config.get("chat_name") or "").strip() or (config.get("story_name") or "").strip()
    if chat_tag:
        print("  [char]    群聊归属标记 extensions.tavo_chat = %s" % chat_tag)
    chat_ext = {"tavo_chat": chat_tag} if chat_tag else None

    for c in config.get("characters", []):
        name = c.get("name")
        if not name:
            continue
        av_local = avatar_abs(story_dir, c.get("avatar_file", ""))
        found_list = search_character(http_url, token, name)
        existing = None
        for it in found_list:
            if it.get("name") == name:
                # search 结果不含 tags/extensions 字段，需 get 详情读 extensions.tavo_chat。
                # 无 chat_tag 时退化为按 name 匹配（旧行为）；有 chat_tag 时要求归属一致才复用，
                # 读详情失败视为不匹配（保守：不误复用其它群聊的角色）。
                if not chat_tag:
                    existing = it.get("id")
                    break
                try:
                    detail = character_get(http_url, token, it.get("id"))
                    ext = detail.get("extensions") or {}
                    if ext.get("tavo_chat") == chat_tag:
                        existing = it.get("id")
                        break
                except Exception:
                    continue
        if existing:
            # 即使角色已存在，如果本地有新头像且 --force 模式，用 import 新卡 → 重绑 → 删旧卡
            # 更新头像（tavo_character_update 写 avatar 字段被服务端静默忽略，import 是唯一落库路径）。
            # skip_avatar=True（第一阶段，群聊未建、chat_id_for_files 无有效值）时不更新头像，
            # 统一延后到 upload_character_avatars（sync_chat 拿到 chat_id 后）补传，避免把空 chatId 传给 tavo_file_save。
            if force and av_local and os.path.isfile(av_local) and not skip_avatar:
                av_ref = upload_avatar(http_url, token, chat_id_for_files, name, av_local, dry=dry)
                if not dry:
                    cid = character_replace_avatar(http_url, token, chat_id_for_files, existing, name,
                                                   c.get("description", ""), c.get("first_mes", ""),
                                                   c.get("personality", "NPC"), av_ref, dry=dry,
                                                   extensions=chat_ext)
                    print("  [char]    更新头像 id=%s name=%s avatar=%s" % (cid, name, av_ref or "无"))
                    results[name] = cid
                else:
                    print("  [char]    (dry) 更新头像 name=%s avatar=%s" % (name, av_local))
                    results[name] = existing
            else:
                print("  [char]    复用 id=%s name=%s" % (existing, name))
                results[name] = existing
            continue
        # 不存在，需要 character_import_card 创建
        if skip_avatar:
            # 第一阶段：无 avatar 创建
            print("  [char]    (no avatar yet) 将创建 name=%s" % name)
            cid = character_import(http_url, token, name,
                                   c.get("description", ""), c.get("first_mes", ""),
                                   c.get("personality", "NPC"),
                                   c.get("roleType", "npc"), "", dry=dry,
                                   extensions=chat_ext)
            if not dry:
                print("  [char]    创建 (无 avatar) id=%s name=%s" % (cid, name))
            results[name] = cid
        else:
            av_ref = upload_avatar(http_url, token, chat_id_for_files, name, av_local, dry=dry)
            cid = character_import(http_url, token, name,
                                   c.get("description", ""), c.get("first_mes", ""),
                                   c.get("personality", "NPC"),
                                   c.get("roleType", "npc"), av_ref, dry=dry,
                                   extensions=chat_ext)
            if not dry:
                print("  [char]    创建 id=%s name=%s avatar=%s" % (cid, name, av_ref or "无"))
            results[name] = cid

    return results  # {name: id}


def upload_character_avatars(http_url, token, chat_id, char_ids, story_dir, config, dry):
    """第二阶段：给 char_ids 里的角色上传 avatar 并更新角色卡。

    用于 sync_chat 之后、chat_update 重绑之前。Persona 和 NPC 都会补 avatar。
    """
    print("\n=== 上传角色 avatar（chat_id=%s） ===" % chat_id)
    if not chat_id or dry:
        if dry:
            print("  [avatar] dry 模式，跳过")
        else:
            print("  [avatar] chat_id 无效，跳过")
        return

    # Persona avatar: 上传并更新
    p = config.get("persona", {})
    persona_name = p.get("name", "")
    persona_id = char_ids.get(persona_name)
    if persona_name and persona_id:
        av_local = avatar_abs(story_dir, p.get("avatar_file", ""))
        if av_local and os.path.isfile(av_local):
            av_ref = upload_avatar(http_url, token, chat_id, persona_name, av_local, dry=dry)
            if av_ref and not dry:
                try:
                    rpc(http_url, token, "tavo_persona_update", {
                        "id": int(persona_id),
                        "persona": {"avatar": av_ref}
                    })
                    print("  [persona avatar] 更新 id=%s avatar=%s" % (persona_id, av_ref))
                except Exception as e:
                    print("  [persona avatar] 更新失败: %s" % e)

    # NPC avatar: 上传后原地更新角色卡 avatar 字段
    # 之前用 delete+reimport（id 漂移）导致：服务端删角色会从其所有群聊级联移除成员，
    # 跨故事共享同名 NPC 时会把另一群聊清空。改用 tavo_character_update 原地更新，id 保持稳定。
    for c in config.get("characters", []):
        name = c.get("name")
        if not name or name not in char_ids:
            continue
        av_local = avatar_abs(story_dir, c.get("avatar_file", ""))
        if not av_local or not os.path.isfile(av_local):
            continue

        cid = char_ids.get(name)
        av_ref = upload_avatar(http_url, token, chat_id, name, av_local, dry=dry)
        if av_ref:
            if not dry:
                # avatar 唯一落库路径 = import 新卡 → chat 重绑 → 删旧卡
                # （tavo_character_update 写 avatar 字段被服务端静默忽略）
                try:
                    chat_tag = (config.get("chat_name") or "").strip() or (config.get("story_name") or "").strip()
                    chat_ext = {"tavo_chat": chat_tag} if chat_tag else None
                    new_cid = character_replace_avatar(
                        http_url, token, chat_id, cid, name,
                        c.get("description", ""), c.get("first_mes", ""),
                        c.get("personality", "NPC"), av_ref, dry=dry,
                        extensions=chat_ext)
                    # 角色 id 已替换，更新映射供后续 chat 重绑/立绘/音色使用
                    char_ids[name] = new_cid
                    print("  [char]    头像已替换 id %s -> %s name=%s avatar=%s" % (cid, new_cid, name, av_ref))
                except Exception as e:
                    print("  [char]    替换头像失败(保留旧卡): %s" % e)
            else:
                print("  [char avatar] %s -> %s (dry)" % (name, av_ref))

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

    print("  [chat] sync_chat char_ids:",char_ids)
    char_id_list = to_int_list((char_ids or {}).values())
    lorebook_ids = [int(lorebook_id)] if lorebook_id and str(lorebook_id).isdigit() else []
    persona_int = int(persona_id) if persona_id and str(persona_id).isdigit() else None
    # 过滤掉 persona id（MCP 的 characterIds 字段只接受 character 资源 id，不接受 persona id）
    if persona_int and persona_int in char_id_list:
        char_id_list = [x for x in char_id_list if x != persona_int]

    def do_update(cid):
        print("  [chat] do_update")
        if dry:
            print("  [chat] dry update id=%s name=%s" % (cid, chat_name))
            return
        if not char_id_list:
            # 没有角色 ID 时不做 update，让 main 流程后面再绑
            print("  [chat] skip update (no characters yet, will rebind later)")
            return
        print("  [chat] do_update  characterIds:", char_id_list)
        kwargs = {"name": chat_name, "responseMode": response_mode, "characterIds": char_id_list}
        if lorebook_ids:
            kwargs["lorebookIds"] = lorebook_ids
        if persona_int:
            kwargs["personaId"] = persona_int
        chat_update(http_url, token, cid, **kwargs)
        print("  [chat] update id=%s name=%s" % (cid, chat_name))

    def do_create():
        print("  [chat] do_create")
        if dry:
            print("  [chat] dry create name=%s" % chat_name)
            return "dry-run"
        if not char_id_list:
            # 第一次 sync_chat 调用时 char_ids 还是空。
            # 严格：绝不再用「别处故事的角色」/全局第一个角色/兜底 ID=3 凑数。
            # 友好：如果已经有 persona_id，用 [persona_id] 作为最小 characterIds 创建，
            #      main 流程的「重绑」步骤会用真实 NPC 替换它。
            # 最后兜底：MCP 严格不允许时 sys.exit，提示用 --chat-id。
            if persona_int:
                chat_dict = {"name": chat_name, "responseMode": response_mode,
                             "characterIds": [persona_int]}
                if lorebook_ids:
                    chat_dict["lorebookIds"] = lorebook_ids
                chat_dict["personaId"] = persona_int
                try:
                    r = chat_create(http_url, token, chat_dict)
                except Exception as e:
                    sys.exit(
                        "[FATAL] sync_chat 用 [persona_id=%d] 创建 chat 失败（%s）。\n"
                        "        请先用 --chat-id <id> 复用已有群聊。\n"
                        "        提示：当前 story_name=%r" % (persona_int, e, config.get("story_name"))
                    )
                cid = r.get("chatId") or r.get("id")
                if cid is None:
                    sys.exit("[FATAL] chat_create 失败，未返回 chatId：%r" % (r,))
                print("  [chat] create (minimal=[persona_id=%d], rebind later) id=%s name=%s" % (
                    persona_int, cid, chat_name))
                return cid
            # 没有 persona_int：MCP 强制要 characterIds 时只能 sys.exit
            sys.exit(
                "[FATAL] sync_chat 在 char_id_list 空且没有 persona_id 时无法创建 chat。\n"
                "        请先用 --chat-id <id> 复用已有群聊，或先单独跑 sync_persona 拿到 persona_id。\n"
                "        提示：当前 story_name=%r" % (config.get("story_name"),)
            )
        chat_dict = {"name": chat_name, "responseMode": response_mode, "characterIds": char_id_list}
        if lorebook_ids:
            chat_dict["lorebookIds"] = lorebook_ids
        if persona_int:
            chat_dict["personaId"] = persona_int
        r = chat_create(http_url, token, chat_dict)
        cid = r.get("chatId") or r.get("id")
        if cid is None:
            sys.exit("[FATAL] chat_create 失败，未返回 chatId：%r" % (r,))
        print("  [chat] create chat id=%s name=%s" % (cid, chat_name))
        return cid

    if existing_chat_id:
        # 复用指定 chat_id；char_id_list 为空时让 main 流程后面再 chat_update 绑
        if not char_id_list:
            print("  [chat] reuse id=%s (no characters yet, will rebind later)" % existing_chat_id)
            return existing_chat_id
        do_update(existing_chat_id)
        return existing_chat_id

    found = chat_search(http_url, token, chat_name) if not dry else []
    if found:
        cid = found[0].get("chatId") or found[0].get("id")
        print("  [chat] reuse id=%s name=%s" % (cid, chat_name))
        # 找到已存在的同名 chat：不传 characterIds 时不 update，让 main 流程后面再 chat_update 绑
        if not char_id_list:
            print("  [chat] skip update (no characters yet, will rebind later)")
            return cid
        do_update(cid)
        return cid
    # 没找到 chat：必须带 characterIds 创建（do_create 已严格处理空列表）
    print("  [chat] not found, will create")
    return do_create()

# ---------------------------------------------------------------------------
# 同步章节到 chat 变量
# ---------------------------------------------------------------------------
def parse_chapter_phases(content):
    """从 chapter.content 解析 phases（对齐 entry.js parseProgress 的逻辑）。
    - '## xxx' 行 = phase
    - '### xxx' 行 = event（属于上一个 phase）
    - 标记 [s]/[i]/[f] = state
    """
    import re
    lines = (content or '').split('\n')
    phases = []
    current = None
    for line in lines:
        m2 = re.match(r'^##\s+(.+)', line)
        if m2:
            current = {'name': m2.group(1).strip(), 'events': [], 'index': len(phases)}
            phases.append(current)
        elif re.match(r'^###\s+', line) and current is not None:
            m3 = re.match(r'^###\s+(?:\[[sif]\])?\s*(.+)', line, re.IGNORECASE)
            name = m3.group(1).strip() if m3 else line[4:].strip()
            current['events'].append({'name': name, 'state': ''})
    return phases


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
        # 预解析 phases → 存到 chapter.runtimeOutline（对齐 toonflow-game-app 的设计）
        # 运行时 entry.js 直接读 runtimeOutline.phases，不再重新解析 chapter.content
        content = ch.get("content", "")
        runtime_outline = {'phases': parse_chapter_phases(content)}
        chapters.append({
            "title": ch.get("title", fname.replace(".json","")),
            "content": content,
            "openingRole": ch.get("openingRole",""),
            "openingLine": ch.get("openingText") or ch.get("openingLine",""),
            "background": ch.get("background",""),
            "events": ch.get("events",[]),
            "successCondition": ch.get("completionCondition") or ch.get("successCondition",""),
            "enabled": enabled,
            "runtimeOutline": runtime_outline,
        })
        print("  [chapter] %s %s (enabled=%s, phases=%d)" % (
            fname, chapters[-1]["title"], enabled, len(runtime_outline['phases'])))

    if chapters and not dry:
        variable_key = 'tf_story_db_%s.edit' % chat_id
        # 读取已有数据（可能已有 intro/globalBackground 等）
        try:
            existing_edit = unwrap(rpc(http_url, token, 'tavo_variable_get',
                {'scope': 'global', 'name': variable_key}))
        except Exception:
            existing_edit = {}
        # 解包 {found, value} 包装
        if isinstance(existing_edit, dict) and 'value' in existing_edit:
            existing_edit = dict(existing_edit.get('value') or {})
        else:
            existing_edit = dict(existing_edit) if isinstance(existing_edit, dict) else {}
        # 构建 edit（直接作为顶层变量值）
        edit = existing_edit
        edit['chapters'] = chapters
        edit['currentChapterIndex'] = 0
        edit['intro'] = config.get('intro', '') or edit.get('intro', '')
        edit['globalBackground'] = config.get('global_bg', '') or edit.get('globalBackground', '')
        edit['cardScenario'] = config.get('card_scenario', '') or edit.get('cardScenario', '')
        edit['cardTags'] = config.get('card_tags', []) or edit.get('cardTags', [])
        if not edit.get('lineCount'):
            edit['lineCount'] = 20

        # 只写 global scope（chat scope 由 event_manager 写 tf_story.edit）
        print('  [tavo_variable_set] scope:%s variable_key:%s' % ('global', variable_key))
        rpc(http_url, token, 'tavo_variable_set', {
            'scope': 'global', 'name': variable_key, 'value': edit
        })
        print('  [chapter] Write %s (global only) chapters=%d intro=%d globalBg=%d' % (
            variable_key, len(chapters), len(edit.get('intro', '')), len(edit.get('globalBackground', ''))))

        # Init tf_progress（只写 global scope）
        progress_var = 'tf_progress_%s' % chat_id
        progress = {'currentChapterIndex': 0, 'currentEvent': 0, 'completedChapters': [], 'phases': [], 'currentPhase': 0, 'currentEventIndex': 0}
        print('  [tavo_variable_set] scope:%s variable_key:%s' % ('global', progress_var))
        variable_set(http_url, token, chat_id, progress_var, progress, scope='global')
        print('  [progress] Init %s (global only)' % progress_var)
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

    # 加载 roles.json，获取 files.avatar 路径
    roles_index = {}
    roles_json_path = os.path.join(story_dir, "ex", "roles.json")
    if os.path.isfile(roles_json_path):
        try:
            with open(roles_json_path, encoding="utf-8") as f:
                roles_data = json.load(f)
            for key in ("npc", "player", "narrator"):
                v = roles_data.get(key)
                if isinstance(v, list):
                    for role in v:
                        if role.get("name"):
                            roles_index[role["name"]] = role
                elif isinstance(v, dict) and v.get("name"):
                    roles_index[v["name"]] = v
        except Exception as e:
            print("  [WARN] roles.json 读取失败: %s" % e)

    def _resolve_avatar_from_roles(name):
        """从 roles.json 解析 avatar 路径"""
        role = roles_index.get(name, {})
        avatar_rel = (role.get("files") or {}).get("avatar", "")
        if avatar_rel:
            avatar_rel = avatar_rel.replace("\\", "/")
            candidates = [
                os.path.join(story_dir, avatar_rel),
                os.path.join(story_dir, "ex", avatar_rel),
                os.path.join(story_dir, "ex", "avatars", avatar_rel.split("/", 1)[-1] if "/" in avatar_rel else avatar_rel),
            ]
            for avatar_abs in candidates:
                if os.path.isfile(avatar_abs):
                    ext = os.path.splitext(avatar_abs)[1]
                    return avatar_abs, ext
        return None, ".png"

    # 先处理 persona 立绘
    p = config.get("persona", {})
    persona_name = p.get("name", "")
    persona_id = char_map.get(persona_name)
    if persona_name and persona_id:
        persona_entry = {"id": persona_id, "name": persona_name, "roleType": "persona", "fg": "", "bg": ""}
        persona_ex_dir = os.path.join(ex_avatars, persona_name)
        # 优先从 roles.json 读取 avatar 路径
        fg_path, fg_ext = _resolve_avatar_from_roles(persona_name)
        # 兜底：硬编码搜索
        if not fg_path:
            for src_fname, ext in [("original.png", ".png"), ("avatar.webp", ".webp")]:
                src = os.path.join(persona_ex_dir, src_fname) if os.path.isdir(persona_ex_dir) else None
                if src and os.path.isfile(src):
                    fg_path = src; fg_ext = ext; break
        # bg: background.png
        bg_src = None
        if os.path.isdir(persona_ex_dir):
            bg_path = os.path.join(persona_ex_dir, "background.png")
            if os.path.isfile(bg_path):
                bg_src = bg_path

        if fg_path:
            dest = "sprite_fg_%s%s" % (persona_id, fg_ext)
            if not dry:
                saved = file_save(http_url, token, chat_id, dest, fg_path)
                persona_entry["fg"] = saved
            else:
                persona_entry["fg"] = dest + " (dry)"
            print("  [sprite] %s fg -> %s" % (persona_name, persona_entry["fg"]))
        if bg_src:
            dest = "sprite_bg_%s.png" % persona_id
            if not dry:
                saved = file_save(http_url, token, chat_id, dest, bg_src)
                persona_entry["bg"] = saved
            else:
                persona_entry["bg"] = dest + " (dry)"
            print("  [sprite] %s bg -> %s" % (persona_name, persona_entry["bg"]))

        if persona_entry["fg"] or persona_entry["bg"]:
            sprites_by_name[persona_name] = persona_entry
            sprites_by_id[str(persona_id)] = {"name": persona_name, "fg": persona_entry.get("fg",""), "bg": persona_entry.get("bg","")}

    # NPC 立绘（跳过 persona，因为已处理过）
    for char_name, tavo_id in char_map.items():
        if char_name == persona_name:
            continue  # 跳过 persona
        entry = {"id": tavo_id, "name": char_name, "roleType": "npc", "fg": "", "bg": ""}

        # 优先从 roles.json 读取 avatar 路径
        fg_path, fg_ext = _resolve_avatar_from_roles(char_name)
        ex_dir = os.path.join(ex_avatars, char_name)
        # 兜底：硬编码搜索
        if not fg_path:
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
        sprites_payload = {"byName": sprites_by_name, "byId": sprites_by_id}
        # chat scope: tf_sprites（基础名）；global scope: tf_sprites_{chat_id}（带 chat_id）
        print('  [tavo_variable_set] scope:chat variable_key:tf_sprites')
        variable_set(http_url, token, chat_id, "tf_sprites", sprites_payload, scope="chat")
        sprites_global_key = 'tf_sprites_%s' % chat_id
        print('  [tavo_variable_set] scope:global variable_key:%s' % sprites_global_key)
        variable_set(http_url, token, chat_id, sprites_global_key, sprites_payload, scope="global")
        print("  [tf_sprites] -> %d 角色 (chat+global)" % len(sprites_by_name))
    if not dry and chapter_bgs:
        chapter_bgs_var = 'tf_chapter_backgrounds_%s' % chat_id
        print('  [tavo_variable_set] scope:%s variable_key:%s' % ('global', chapter_bgs_var))
        variable_set(http_url, token, chat_id, chapter_bgs_var, chapter_bgs, scope='global')
        print("  [%s] -> %d 章节 (global only)" % (chapter_bgs_var, len(chapter_bgs)))
    if not dry and fallback_bg:
        for scope in ['chat', 'global']:
            print('  [tavo_variable_set] scope:%s variable_key:%s' % (scope, 'tf_sprite_fallback_bg'))
            variable_set(http_url, token, chat_id, "tf_sprite_fallback_bg", fallback_bg, scope=scope)
        print("  [tf_sprite_fallback_bg] -> %s (chat+global)" % fallback_bg)

    return sprites_by_name, chapter_bgs, fallback_bg


# ---------------------------------------------------------------------------
# 同步音色文件
# ---------------------------------------------------------------------------
def sync_voices(http_url, token, chat_id, config, story_dir, char_ids, dry):
    """同步音色文件

    从 ex/avatars/<dir>/voice.wav 上传，并从 role.json 读取音色配置。
    绑定到 tf_character_voices 变量。
    关键：key 用角色名（不是目录名），旁白的 voice.wav 实际放在"某男子"目录，但 character_voices 的 key 必须是"旁白"。
    """
    print("\n=== 同步音色文件 ===")
    print("\n 同步音色文件 char_ids:",char_ids)
    ex_avatars = os.path.join(story_dir, "ex", "avatars")
    if not os.path.isdir(ex_avatars):
        print("  [voice] ex/avatars 目录不存在，跳过")
        return

    # 加载 roles.json 索引：role.json 里的 files.voice 路径 → name
    # roles.json 结构: {npc: [...], player: {...}, narrator: {...}}
    roles_index = {}
    roles_json_path = os.path.join(story_dir, "ex", "roles.json")
    if os.path.isfile(roles_json_path):
        try:
            with open(roles_json_path, encoding="utf-8") as f:
                roles_data = json.load(f)
            print("  [voice] roles_data:",roles_data)
            for key in ("npc", "player", "narrator"):
                v = roles_data.get(key)
                if isinstance(v, list):
                    for role in v:
                        if role.get("name"):
                            roles_index[role["name"]] = role
                elif isinstance(v, dict) and v.get("name"):
                    roles_index[v["name"]] = v
        except Exception as e:
            print("  [voice] roles.json 读取失败: %s" % e)

    character_voices = {}
    # 缓存已上传的文件路径：dir_name -> uploaded tavo path（同目录不重复上传）
    _uploaded_cache = {}

    def _resolve_voice_dir(role):
        """从角色 roles.json 条目解析 voice.wav 所在目录名"""
        fv = (role.get("files") or {}).get("voice", "") or ""
        if fv:
            fv_norm = fv.replace("\\", "/")
            for part in fv_norm.split("/"):
                pass
            # 从路径中提取目录名：.../<dir_name>/voice.wav
            parts = [p for p in fv_norm.split("/") if p]
            if len(parts) >= 2 and parts[-1] == "voice.wav":
                return parts[-2]
        return None

    # 1. 先处理 roles_index 里有 files.voice 指向的角色（每个角色独立绑定）
    for char_name, role in roles_index.items():
        voice_dir = _resolve_voice_dir(role)
        if not voice_dir:
            continue
        char_dir = os.path.join(ex_avatars, voice_dir)
        voice_path = os.path.join(char_dir, "voice.wav")
        if not os.path.isfile(voice_path):
            continue

        # 读取该目录的 role.json 拿 voiceMode / voicePromptText
        char_role_json = os.path.join(char_dir, "role.json")
        voice_config = {}
        if os.path.isfile(char_role_json):
            try:
                with open(char_role_json, encoding="utf-8") as f:
                    role_data = json.load(f)
                voice_config = {
                    "mode": role_data.get("voiceMode", "clone_voice"),
                    "prompt": role_data.get("voicePromptText", ""),
                    "audioRef": "",
                    "enabled": True,
                }
            except Exception:
                pass
        else:
            voice_config = {"mode": "clone_voice", "prompt": "", "audioRef": "", "enabled": True}

        # 上传 voice.wav（同目录复用已上传路径，不重复上传）
        if not dry:
            if voice_dir in _uploaded_cache:
                saved = _uploaded_cache[voice_dir]
                voice_config["audioRef"] = saved
                cid = char_ids.get(char_name, "")
                voice_config["charId"] = str(cid) if cid else ""
                print("  [voice] [reuse] %s (id=%s, dir=%s) -> %s" % (char_name, cid, voice_dir, saved))
            else:
                try:
                    with open(voice_path, "rb") as f:
                        voice_b64 = base64.b64encode(f.read()).decode()
                    cid = char_ids.get(char_name, "")
                    if cid and str(cid).isdigit():
                        dest = "voice_%d.wav" % int(cid)
                    else:
                        safe = "".join(c for c in char_name if c.isalnum() or c in ("_", "-")) or "narrator"
                        dest = "voice_%s.wav" % safe
                    result = rpc(http_url, token, "tavo_file_save", {
                        "chatId": chat_id,
                        "name": dest,
                        "content": voice_b64,
                        "options": {"scope": "global", "encoding": "base64"}
                    })
                    saved = unwrap(result).get("path", "")
                    if saved:
                        _uploaded_cache[voice_dir] = saved
                        voice_config["audioRef"] = saved
                        voice_config["charId"] = str(cid) if cid else ""
                        print("  [voice] [char] %s (id=%s, dir=%s) -> %s" % (char_name, cid, voice_dir, saved))
                except Exception as e:
                    print("  [voice] %s 上传失败: %s" % (char_name, e))

        if voice_config.get("audioRef") or voice_config.get("prompt"):
            character_voices[char_name] = voice_config

    # 2. 兜底：遍历目录，处理没有在 roles_index 中出现的角色（兼容无 roles.json）
    for dir_name in os.listdir(ex_avatars):
        char_dir = os.path.join(ex_avatars, dir_name)
        if not os.path.isdir(char_dir):
            continue
        voice_path = os.path.join(char_dir, "voice.wav")
        if not os.path.isfile(voice_path):
            continue
        # 跳过已在 roles_index 处理过的目录
        if any(_resolve_voice_dir(r) == dir_name for _, r in roles_index.items()):
            continue
        # 兜底角色名 = 目录名
        char_name = dir_name
        if char_name in character_voices:
            continue  # 已绑定，跳过

        voice_config = {"mode": "clone_voice", "prompt": "", "audioRef": "", "enabled": True}
        if not dry:
            if dir_name in _uploaded_cache:
                saved = _uploaded_cache[dir_name]
                voice_config["audioRef"] = saved
                cid = char_ids.get(char_name, "")
                voice_config["charId"] = str(cid) if cid else ""
                print("  [voice] [reuse-fallback] %s (dir=%s) -> %s" % (char_name, dir_name, saved))
            else:
                try:
                    with open(voice_path, "rb") as f:
                        voice_b64 = base64.b64encode(f.read()).decode()
                    cid = char_ids.get(char_name, "")
                    if cid and str(cid).isdigit():
                        dest = "voice_%d.wav" % int(cid)
                    else:
                        safe = "".join(c for c in char_name if c.isalnum() or c in ("_", "-")) or "narrator"
                        dest = "voice_%s.wav" % safe
                    result = rpc(http_url, token, "tavo_file_save", {
                        "chatId": chat_id,
                        "name": dest,
                        "content": voice_b64,
                        "options": {"scope": "global", "encoding": "base64"}
                    })
                    saved = unwrap(result).get("path", "")
                    if saved:
                        _uploaded_cache[dir_name] = saved
                        voice_config["audioRef"] = saved
                        voice_config["charId"] = str(cid) if cid else ""
                        print("  [voice] [fallback] %s (dir=%s) -> %s" % (char_name, dir_name, saved))
                except Exception as e:
                    print("  [voice] %s 上传失败: %s" % (char_name, e))

        if voice_config.get("audioRef") or voice_config.get("prompt"):
            character_voices[char_name] = voice_config

    if character_voices and not dry:
        # chat scope: tf_character_voices（不带 chat_id）
        print('  [tavo_variable_set] scope:chat variable_key:tf_character_voices')
        variable_set(http_url, token, chat_id, "tf_character_voices", character_voices, scope="chat")
        # global scope: tf_character_voices_{chat_id}（带 chat_id）
        voice_var_global = "tf_character_voices_%s" % chat_id
        print('  [tavo_variable_set] scope:global variable_key:%s' % voice_var_global)
        variable_set(http_url, token, chat_id, voice_var_global, character_voices, scope="global")
        print("  [voice] tf_character_voices: %d 个角色 (chat+global)" % len(character_voices))

    return character_voices


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
    p.add_argument("--skip-voice", action="store_true", help="skip voice")
    p.add_argument("--duplicate-delete", action="store_true", help="delete duplicates")
    p.add_argument("--clean-cache", action="store_true", help="clean cache")
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

    # Clean cache（必须先于 2.1 读缓存，保证 --clean-cache 语义"清干净再读"）
    if args.clean_cache:
        import shutil
        cache_dir = os.path.join(story_dir, 'story_cache')
        if os.path.exists(cache_dir):
            shutil.rmtree(cache_dir)
            print('  [cache] Cleaned cache=%s' % cache_dir)
        # char_ids.json 同样是 ID/chat_id 缓存，--clean-cache 语义下应一并清除；
        # 否则旧环境残留的 chat_id 会被 2.1 复用，对已删除的群聊 update → Resource not found
        cid_json = os.path.join(story_dir, 'char_ids.json')
        if os.path.isfile(cid_json):
            os.remove(cid_json)
            print('  [cache] Cleaned %s' % cid_json)

    # 2.1 读缓存 chat_id（避免重复创建群聊）。
    #     缓存可能来自旧环境/旧设备，先 chat_get 校验其真实存在，失效则忽略
    #     （视为新故事，走按名查找/新建），避免对已删除的群聊 update 报 Resource not found。
    if not args.chat_id:
        _cache_path = os.path.join(story_dir, "char_ids.json")
        if os.path.isfile(_cache_path):
            try:
                with open(_cache_path, encoding="utf-8") as f:
                    _cdata = json.load(f)
                _cached_cid = _cdata.get("chat_id") if isinstance(_cdata, dict) else None
                if _cached_cid and str(_cached_cid).isdigit():
                    _cached_cid = int(_cached_cid)
                    try:
                        chat_current(http_url, token, _cached_cid)
                    except Exception as _e:
                        print("  [cache] chat_id=%s 已失效（%s），忽略缓存，将按名查找/新建群聊" % (_cached_cid, _e))
                    else:
                        args.chat_id = _cached_cid
                        print("  [cache] 复用 chat_id=%s" % args.chat_id)
            except Exception:
                pass

    # Duplicate-delete: 删除同名角色和世界书（在 sync_characters 之前，否则会被复用）
    if getattr(args, 'duplicate_delete', False):
        print('\n=== duplicate-delete: 删除同名角色和世界书 ===')
        # 删除角色
        # 判定升级为 name + extensions.tavo_chat 双匹配：search 结果不含 extensions，
        # 需 get 详情读归属标记；归属不一致的（其它群聊的同名角色）不得删，防止误删。
        # 无 chat_tag 时退化为仅按 name 匹配（旧行为）。
        dd_chat_tag = (config.get("chat_name") or "").strip() or (config.get("story_name") or "").strip()
        for c in config.get('characters', []):
            name = c.get('name')
            if not name: continue
            try:
                result = search_character(http_url, token, name)
                for item in (result or []):
                    if item.get('name') != name:
                        continue
                    cid = item.get('id')
                    if not cid:
                        continue
                    if dd_chat_tag:
                        # 双匹配：归属一致才删，归属不一致/读不到归属都保留
                        try:
                            detail = character_get(http_url, token, cid)
                            ext = detail.get("extensions") or {}
                            if ext.get("tavo_chat") != dd_chat_tag:
                                print('  [char] 跳过 id=%s name=%s (tavo_chat=%r != %r, 属其他群聊)' % (
                                    cid, name, ext.get("tavo_chat"), dd_chat_tag))
                                continue
                        except Exception as e:
                            print('  [char] 跳过 id=%s name=%s (归属读取失败: %s)' % (cid, name, e))
                            continue
                    try:
                        rpc(http_url, token, 'tavo_character_delete', {'id': cid})
                        print('  [char] Deleted id=%s name=%s' % (cid, name))
                    except Exception as e:
                        print('  [char] Delete failed: ' + str(e))
            except Exception:
                pass
        # 删除 persona（搜索更多结果，确保删除所有重复）
        for cfg in [config.get('persona')]:
            if cfg and cfg.get('name'):
                try:
                    result2 = rpc(http_url, token, 'tavo_persona_search', {'query': cfg['name'], 'limit': 100})
                    # 解析 content[0].text 中的 JSON
                    content = result2.get('content', [{}])[0].get('text', '{}')
                    data2 = json.loads(content)
                    items = data2.get('items', []) if isinstance(data2, dict) else (data2 or [])
                    for item in items:
                        if item.get('name') == cfg['name']:
                            pid = item.get('id')
                            try:
                                # 注意：参数名是 id 不是 personaId
                                rpc(http_url, token, 'tavo_persona_delete', {'id': int(pid)})
                                print('  [persona] Deleted id=%s name=%s' % (pid, cfg['name']))
                            except Exception as e:
                                print('  [persona] Delete failed id=%s: %s' % (pid, e))
                except Exception as e:
                    print('  [persona] Search failed: %s' % e)
        # 删除世界书
        try:
            lb_result = rpc(http_url, token, 'tavo_lorebook_search', {'query': '', 'limit': 50})
            items = lb_result.get('items', []) if isinstance(lb_result, dict) else (lb_result or [])
            # 修 Bug #2: 原代码取 config.get('name', '') 永远空（config 只有 story_name/chat_name）
            lb_match_name = config.get('chat_name') or config.get('story_name', '')
            for lb in items:
                if lb.get('name') == lb_match_name:
                    lb_id = lb.get('id')
                    try:
                        rpc(http_url, token, 'tavo_lorebook_delete', {'id': lb_id})
                        print('  [lorebook] Deleted id=%s name=%s' % (lb_id, lb_match_name))
                    except Exception:
                        pass
        except Exception:
            pass
        print('')

    # 2.5. 预搜已有群聊（用于 persona_create 需要 chatId 的场景）
    chat_name = config.get("chat_name", config.get("story_name", "unnamed") + " - ch1")
    pre_existing_chat_id = args.chat_id or None
    if not pre_existing_chat_id and not args.dry:
        try:
            found_chats = chat_search(http_url, token, chat_name)
            if found_chats:
                pre_existing_chat_id = found_chats[0].get("chatId") or found_chats[0].get("id")
                print("  [预搜] 找到已有群聊 id=%s name=%s" % (pre_existing_chat_id, chat_name))
        except Exception:
            pass

    # 3. 同步角色卡（先 skip_avatar 拿 NPC character id 列表，给 sync_chat 用）
    #    解决循环依赖：MCP 要求 characterIds，但 tavo_file_save 又需要 chatId。
    #    第一阶段：只创建/复用 character 记录（不传 avatar），拿 char_ids
    # chat_id_for_files=None = 尚无已有群聊（新故事），不把 0/null 传给 tavo_file_save，
    # 头像全部延后到第 6 步 upload_character_avatars（拿到 chat_id 后）补传。
    char_ids = sync_characters(
        http_url, token, config, story_dir, args.dry, args.force,
        chat_id_for_files=pre_existing_chat_id or None, skip_avatar=True,
    )
    config["_char_id_map"] = char_ids

    # 4. 创建/复用 persona 拿 id（不依赖 chat_id）
    persona_name = config.get("persona", {}).get("name", "")
    persona_id = char_ids.get(persona_name)  # 已经在 step 3 拿到
    print("\n=== persona_id = %s ===" % (persona_id or "（无）"))

    # 5. 建/取群聊（用 char_ids 里的 NPC id 作为 characterIds）
    #    sync_chat 现在能拿到合法的 character id，能正常创建 chat
    chat_id = sync_chat(http_url, token, config, char_ids, None, persona_id,
                         args.chat_id or pre_existing_chat_id, args.dry)
    print("\n=== chat_id = %s ===" % chat_id)

    # 6. 第二阶段：给角色补 avatar（现在有 chat_id 了）
    if not args.dry and chat_id and not args.skip_sprite:
        upload_character_avatars(http_url, token, chat_id, char_ids, story_dir, config, args.dry)

    # 7. 同步世界书
    lorebook_id = sync_worldbook(http_url, token, config, args.dry) if not args.skip_voice else None

    # 8. 重绑群聊（角色卡 + 世界书 + persona 都到位后再 update）
    if not args.dry:
        # 过滤 narrator（旁白）和 persona：它们不是 chat 的"在场角色"
        # 与 src/tavo_plugins/commands/sync_story.py 的处理保持一致
        persona_name = config.get("persona", {}).get("name", "")
        char_id_list = [
            int(v) for k, v in char_ids.items()
            if  k != persona_name and v and str(v).isdigit()
        ]
        lorebook_ids = [int(lorebook_id)] if lorebook_id and str(lorebook_id).isdigit() else []
        persona_int = int(persona_id) if persona_id and str(persona_id).isdigit() else None
        if not char_id_list:
            sys.exit(
                "[FATAL] 重绑 chat 时没有可用角色 ID（过滤掉旁白/persona 后为空）。\n"
                "        story_name=%r persona=%r char_ids=%r" % (
                    config.get("story_name"), persona_name, char_ids)
            )
        try:
            chat_update(http_url, token, chat_id,
                characterIds=char_id_list,
                lorebookIds=lorebook_ids,
                personaId=persona_int,
                responseMode=config.get("response_mode", "natural"))
            print("  [chat] 重绑角色+世界书+persona OK (%d chars, persona=%s, lorebook=%s)" % (
                len(char_id_list), persona_int, lorebook_ids))
        except Exception as e:
            sys.exit(
                "[FATAL] 重绑 chat 失败（不能 swallow,必须终止）。\n"
                "        chat_id=%s characterIds=%s personaId=%s lorebookIds=%s\n"
                "        error=%s" % (chat_id, char_id_list, persona_int, lorebook_ids, e)
            )

    # 7. 同步章节
    if not args.skip_chapters:
        sync_chapters(http_url, token, chat_id, config, story_dir, args.dry)

    # 8. 同步立绘
    if not args.skip_sprite:
        sync_sprites(http_url, token, chat_id, config, story_dir, args.dry)

    # 9. 同步音色文件
    sync_voices(http_url, token, chat_id, config, story_dir, char_ids, args.dry)

    # 10. 同步插件
    if not args.skip_plugins:
        sync_plugins(http_url, token, args.dry)

    # 10. 保存 char_ids.json（ID 映射 + chat_id，供下次同步复用）
    if not args.dry:
        char_ids_path = os.path.join(story_dir, "char_ids.json")
        try:
            cache_data = {
                "char_ids": char_ids,
                "persona_id": persona_id or "",
                "chat_id": chat_id or "",
            }
            with open(char_ids_path, "w", encoding="utf-8") as f:
                json.dump(cache_data, f, ensure_ascii=False, indent=2)
            print("  [cache] char_ids.json saved: %s (chat_id=%s)" % (char_ids_path, chat_id))
        except Exception as e:
            print("  [cache] char_ids.json save failed: %s" % e)

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
