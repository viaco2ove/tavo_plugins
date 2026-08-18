#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tavo sync story - 同步故事到 Tavo"""
import os
import json
import base64
import glob as _glob
import zipfile
import io


def sync_story(client, story_dir, force=False, skip_sprite=False,
               skip_chapters=False, skip_plugins=False,
               chat_id=None, reuse_ids=None, echo=print):
    """同步故事全套流程"""
    story_dir = os.path.abspath(story_dir)
    config_path = os.path.join(story_dir, "story_sync_config.json")
    if not os.path.isfile(config_path):
        echo("[ERR] 未找到 story_sync_config.json，请先生成或创建")
        return

    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    # ---- 0. 连通性检查 ----
    echo("[OK] 检查 MCP 连通性...")
    try:
        client.call("tavo_plugin_search", {"query": "", "limit": 1})
        echo("  MCP OK")
    except Exception as e:
        echo(f"  [ERR] MCP 失败: {e}")
        return

    # ---- 1. 找/建群聊 ----
    echo("[CHAT] 第1步: 群聊")
    chat_name = config.get("chat_name", config.get("story_name", "unnamed") + " - ch1")
    response_mode = config.get("response_mode", "natural")
    cid = chat_id

    if not cid:
        found = client.chat_search(chat_name)
        items = found if isinstance(found, list) else found.get("items", [])
        if items:
            cid = items[0].get("chatId") or items[0].get("id")
            echo(f"  找到群聊 id={cid}: {chat_name}")

    if not cid:
        r = client.chat_create({"name": chat_name, "responseMode": response_mode})
        cid = r.get("chatId") or r.get("id")
        echo(f"  [OK] 新建群聊 id={cid}: {chat_name}")
    else:
        client.chat_update(cid, name=chat_name, responseMode=response_mode)
        echo(f"  使用现有群聊 id={cid}")

    # ---- 2. 同步角色卡 ----
    echo("[CHAR] 第2步: 角色卡")
    char_ids = {}  # name -> tavo id

    def _search_list(found):
        """统一解析 search 返回: dict 或 list"""
        if isinstance(found, list):
            return found
        return found.get("items", [])

    def _verify_character_exists(client, cid):
        """验证角色 ID 是否仍然存在于 tavo"""
        try:
            r = client.get("tavo_character_get", {"id": cid})
            return r is not None and not (isinstance(r, dict) and r.get("error"))
        except Exception:
            return False

    # persona
    p = config.get("persona", {})
    if p.get("name"):
        name = p["name"]
        av_local = _avatar_abs(story_dir, p.get("avatar_file", ""))
        # reuse_ids 优先
        pid = None
        if reuse_ids and name in reuse_ids:
            pid = reuse_ids[name]
            # 验证 persona 是否仍存在
            try:
                r = client.persona_search(name)
                items = _search_list(r)
                existing = next((it.get("id") for it in items if str(it.get("id")) == str(pid)), None)
                if existing:
                    echo(f"  persona reuse id={pid}: {name}")
                else:
                    echo(f"  persona id={pid} 不存在，将重新创建: {name}")
                    pid = None
            except Exception:
                pid = None
        if not pid:
            found = client.persona_search(name)
            items = _search_list(found)
            existing = next((it.get("id") for it in items if it.get("name") == name), None)
            if existing and not force:
                pid = existing
                echo(f"  persona 复用 id={existing}: {name}")
            else:
                av_ref = _upload_avatar(client, cid, name, av_local)
                r = client.persona_create({
                    "name": name,
                    "description": p.get("description", ""),
                    "active": True,
                })
                pid = r.get("id") or r.get("personaId")
                if pid:
                    try:
                        client.persona_set_active(int(pid))
                    except Exception:
                        pass
                echo(f"  persona {'OK' if pid else 'ERR'} id={pid}: {name} avatar={av_ref or 'none'}")
        char_ids[name] = pid

    # NPCs
    for c in config.get("characters", []):
        name = c.get("name")
        if not name:
            continue
        av_local = _avatar_abs(story_dir, c.get("avatar_file", ""))
        # reuse_ids 优先（强制使用指定 ID，不再搜索/创建）
        if reuse_ids and name in reuse_ids:
            nid = reuse_ids[name]
            # 验证角色是否仍存在
            if _verify_character_exists(client, nid):
                echo(f"  char reuse id={nid}: {name}")
                char_ids[name] = nid
                continue
            else:
                echo(f"  char id={nid} 不存在，将重新创建: {name}")

        # 角色不存在，搜索是否有同名
        found = client.character_search(name)
        items = _search_list(found)
        existing = next((it.get('id') for it in items if it.get('name') == name), None)
        if existing and not force:
            echo(f'  char 复用 id={existing}: {name}')
            char_ids[name] = existing
        else:
            av_ref = _upload_avatar(client, cid, name, av_local)
            card = {
                'spec': 'chara_card_v3',
                'spec_version': '3.0',
                'data': {
                    'name': name,
                    'description': c.get('description', ''),
                    'firstMes': c.get('first_mes', ''),
                    'personality': c.get('personality', 'NPC'),
                },
            }
            if av_ref:
                card['data']['avatar'] = av_ref
            r = client.character_import_card(card)
            cid_new = r.get('id') or r.get('characterId')
            echo(f'  char {"OK" if cid_new else "ERR"} id={cid_new}: {name} avatar={av_ref or "none"}')
            char_ids[name] = cid_new


    persona_id = char_ids.get(config.get("persona", {}).get("name", ""))

    # ---- 3. 同步世界书 ----
    echo("[LORE] 第3步: 世界书")
    wb = config.get("worldbook", {})
    wb_name = wb.get("name", config.get("story_name", "unnamed"))
    entries = wb.get("source_entries", [])

    # 优先读 story_dir/worldbook/worldbook.json（SillyTavern 格式：含 keys/probability/order）
    wb_json = os.path.join(story_dir, "worldbook", "worldbook.json")
    if os.path.isfile(wb_json):
        try:
            with open(wb_json, encoding="utf-8") as f:
                wb_data = json.load(f)
            for e in wb_data.get("entries", []):
                entries.append({
                    "name": e.get("title") or e.get("name", ""),
                    "keys": e.get("keys") or [],
                    "content": e.get("content", ""),
                    "probability": e.get("probability", 100),
                    "constant": e.get("constant", False),
                    "order": e.get("order", 100),
                    "selectiveLogic": e.get("selectiveLogic"),
                    "selectiveKeys": e.get("selectiveKeys"),
                    "strategy": "constant" if e.get("constant") else "keyword",
                    "enabled": not e.get("disabled", False),
                })
            echo(f"  从 worldbook.json 加载 {len(wb_data.get('entries', []))} 条 SillyTavern 格式条目")
        except Exception as e:
            echo(f"  [WARN] 读取 worldbook.json 失败: {e}")

    if not entries:
        for fp in sorted(_glob.glob(os.path.join(story_dir, wb.get("dir", "chapters"), "*.json"))):
            with open(fp, encoding="utf-8") as f:
                ch = json.load(f)
            entries.append({
                "name": ch.get("title", os.path.basename(fp).replace(".json", "")),
                "content": ch.get("content", ""),
                "strategy": "keyword",
                "enabled": False,
            })
    if entries:
        found = client.lorebook_search(wb_name)
        items = _search_list(found)
        if items:
            lid = items[0].get("lorebookId") or items[0].get("id")
            # 先读出当前条目，按 name 去重
            existing = client.unwrap(client.call("tavo_lorebook_get", {"id": int(lid)}))
            existing_entries = (existing or {}).get("entries", []) if isinstance(existing, dict) else []
            existing_names = {e.get("name") for e in existing_entries if e.get("name")}
            added = 0; skipped = 0
            for e in entries:
                ename = e.get("name")
                if not ename:
                    continue
                if ename in existing_names:
                    skipped += 1
                    continue
                client.call("tavo_lorebook_entry_upsert", {
                    "lorebookId": int(lid),
                    "entry": e,
                })
                existing_names.add(ename)
                added += 1
            echo(f"  [OK] 世界书 id={lid}: {wb_name} | 追加 {added} 条 / 已存在 {skipped} 条")
            lorebook_id = lid
        else:
            r = client.lorebook_create(wb_name, entries)
            lorebook_id = r.get("lorebookId") or r.get("id")
            echo(f"  [OK] 新建世界书 id={lorebook_id}: {wb_name} ({len(entries)} 条)")
    else:
        echo("  无世界书条目，跳过")
        lorebook_id = None

    # ---- 4. 重绑群聊 ----
    echo("[OK] 第4步: 重绑群聊(角色+世界书+persona)")
    # 过滤 narrator 和 persona，只保留普通角色
    persona_name = config.get("persona", {}).get("name", "纯小白")
    char_id_list = [
        int(v) for k, v in char_ids.items()
        if k not in ("旁白", persona_name) and v and str(v).isdigit()
    ]
    lorebook_ids = [int(lorebook_id)] if lorebook_id and str(lorebook_id).isdigit() else []
    persona_int = int(persona_id) if persona_id and str(persona_id).isdigit() else None
    client.chat_update(
        cid,
        characterIds=char_id_list,
        lorebookIds=lorebook_ids,
        personaId=persona_int,
        responseMode=response_mode,
    )
    echo(f"  [OK] 群聊 id={cid}: {len(char_id_list)} chars, persona={persona_int}, lorebook={lorebook_ids}")

    # ---- 5. 同步立绘 ----
    if not skip_sprite:
        echo("[SPRITE] 第5步: 立绘资源")
        _sync_sprites(client, cid, char_ids, story_dir, config, echo, sprite_ids=reuse_ids)
    else:
        echo("[SPRITE] 第5步: 立绘 [SKIP]")

    # ---- 6. 同步章节 ----
    if not skip_chapters:
        echo("[CHAPTER] 第6步: 章节")
        _sync_chapters(client, cid, story_dir, config, echo)
    else:
        echo("[CHAPTER] 第6步: 章节 [SKIP]")

    # ---- 7. 同步插件 ----
    if not skip_plugins:
        echo("[PLUGIN] 第7步: 插件")
        _sync_plugins(client, story_dir, echo)
    else:
        echo("[PLUGIN] 第7步: 插件 [SKIP]")

    echo(f"[DONE] 同步完成! chat_id={cid}")


# ---- 辅助函数 ----

def _avatar_abs(story_dir, rel_path):
    if not rel_path:
        return ""
    for sub in ["", "avatars/", "image/", "ex/avatars/"]:
        p = os.path.join(story_dir, sub, rel_path)
        if os.path.isfile(p):
            return p
    return os.path.join(story_dir, rel_path) if os.path.isfile(os.path.join(story_dir, rel_path)) else ""


def _upload_avatar(client, chat_id, name, local_path):
    if not local_path or not os.path.isfile(local_path):
        return ""
    ext = os.path.splitext(local_path)[1].lstrip(".") or "png"
    fname = f"{name}.{ext}"
    with open(local_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    r = client.file_save(chat_id, fname, b64, scope="global")
    return r.get("path", "")


def _sync_sprites(client, chat_id, char_ids, story_dir, config, echo, sprite_ids=None):
    """同步立绘: 上传文件 + 写 tf_sprites 等变量"""
    # sprite_ids: name -> sprite绑定ID（reuse_ids 的正确ID，优先）
    # char_ids: 兜底，存新建的角色（含旁白）
    use_ids = sprite_ids if sprite_ids else char_ids

    sprites_by_name = {}

    # NPC 角色（非 narrator，非 persona）
    persona_name = config.get("persona", {}).get("name", "纯小白")

    for name, cid in use_ids.items():
        # 跳过 narrator 和 persona
        if name == persona_name:
            continue
        if not cid or not str(cid).isdigit():
            continue
        cid = int(cid)
        entry = {"id": cid, "name": name, "roleType": "npc", "fg": "", "bg": ""}
        ex_dir = os.path.join(story_dir, "ex", "avatars", name)

        fg_path = None; fg_ext = ".png"
        if os.path.isdir(ex_dir):
            for fn, ext in [("original.png", ".png"), ("avatar.webp", ".webp")]:
                p = os.path.join(ex_dir, fn)
                if os.path.isfile(p):
                    fg_path = p; fg_ext = ext; break
        if not fg_path:
            old = os.path.join(story_dir, "avatars", name + ".png")
            if os.path.isfile(old):
                fg_path = old; fg_ext = ".png"

        bg_path = None
        if os.path.isdir(ex_dir):
            bp = os.path.join(ex_dir, "background.png")
            if os.path.isfile(bp):
                bg_path = bp

        if fg_path:
            dest = f"sprite_fg_{cid}{fg_ext}"
            with open(fg_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            r = client.file_save(chat_id, dest, b64, scope="chat")
            entry["fg"] = r.get("path", "")
            echo(f"  fg {name} -> {entry['fg']}")
        if bg_path:
            dest = f"sprite_bg_{cid}.png"
            with open(bg_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            r = client.file_save(chat_id, dest, b64, scope="chat")
            entry["bg"] = r.get("path", "")
            echo(f"  bg {name} -> {entry['bg']}")

        if entry["fg"] or entry["bg"]:
            sprites_by_name[name] = entry

    # persona（固定 sprite_fg_1.{ext}）
    p_entry = {"id": "", "name": persona_name, "roleType": "npc", "fg": "", "bg": ""}
    ex_dir = os.path.join(story_dir, "ex", "avatars", persona_name)
    if os.path.isdir(ex_dir):
        for fn, ext in [("avatar.webp", ".webp"), ("original.png", ".png")]:
            p = os.path.join(ex_dir, fn)
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                dest = f"sprite_fg_1{ext}"
                r = client.file_save(chat_id, dest, b64, scope="chat")
                p_entry["fg"] = r.get("path", "")
                echo(f"  persona fg -> {p_entry['fg']}")
                break
        bp = os.path.join(ex_dir, "background.png")
        if os.path.isfile(bp):
            with open(bp, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            r = client.file_save(chat_id, "sprite_bg_1.png", b64, scope="chat")
            p_entry["bg"] = r.get("path", "")
            echo(f"  persona bg -> {p_entry['bg']}")
    # 追加 persona（如果已存在则覆盖）
    sprites_by_name[persona_name] = p_entry

    for scope in ["chat", "global"]:
        client.variable_set(chat_id, "tf_sprites", {"byName": sprites_by_name}, scope=scope)
    echo(f"  [OK] tf_sprites -> {len(sprites_by_name)} chars")

    for scope in ["chat", "global"]:
        client.variable_set(chat_id, "tf_sprite_persona_name", persona_name, scope=scope)
    echo(f"  [OK] tf_sprite_persona_name -> {persona_name}")

    # 章节背景
    img_dir = os.path.join(story_dir, "image")
    chapter_bgs = {}
    if os.path.isdir(img_dir):
        for fname in sorted(os.listdir(img_dir)):
            if not fname.startswith("chapter_"):
                continue
            if not any(fname.endswith(e) for e in ["_background.png", "_cover.png"]):
                continue
            key = fname.replace(".png", "").replace("_background", "").replace("_cover", "")
            dest = f"chapter_bg_{key}.png"
            with open(os.path.join(img_dir, fname), "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            r = client.file_save(chat_id, dest, b64, scope="chat")
            chapter_bgs[key] = r.get("path", "")
            echo(f"  章节背景 {key} -> {chapter_bgs[key]}")
    for scope in ["chat", "global"]:
        client.variable_set(chat_id, "tf_chapter_backgrounds", chapter_bgs, scope=scope)
    echo(f"  [OK] tf_chapter_backgrounds -> {len(chapter_bgs)}")

    # 兜底背景
    fb = ""
    for cand in ["cover.jpg", "bg.jpg"]:
        if os.path.isdir(img_dir):
            p = os.path.join(img_dir, cand)
            if os.path.isfile(p):
                fb = p; break
    if fb:
        with open(fb, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        r = client.file_save(chat_id, "fallback_bg.jpg", b64, scope="chat")
        fb_path = r.get("path", "")
        for scope in ["chat", "global"]:
            client.variable_set(chat_id, "tf_sprite_fallback_bg", fb_path, scope=scope)
        echo(f"  [OK] tf_sprite_fallback_bg -> {fb_path}")


def _sync_chapters(client, chat_id, story_dir, config, echo):
    """同步章节到 tf_story.edit"""
    ch_cfg = config.get("chapters", {})
    ch_dir = os.path.join(story_dir, ch_cfg.get("dir", "chapters"), "")
    chapters = []

    for fp in sorted(_glob.glob(os.path.join(ch_dir, "*.json"))):
        with open(fp, encoding="utf-8") as f:
            ch = json.load(f)
        chapters.append({
            "title": ch.get("title", ""),
            "content": ch.get("content", ""),
            "openingRole": ch.get("openingRole", "") or "旁白",
            "openingLine": ch.get("openingLine", "") or ch.get("openingText", ""),
            "events": ch.get("events", []),
            "successCondition": ch.get("successCondition", "") or ch.get("completionCondition", ""),
            "background": ch.get("background", "") or ch.get("backgroundPath", ""),
            "conditionVisible": ch.get("conditionVisible", ch.get("showCompletionCondition", True)),
            "enabled": True,
        })
        echo(f"  {chapters[-1]['title']} ({len(chapters[-1]['events'])} events)")

    if chapters:
        existing = client.variable_get(chat_id, "tf_story.edit")
        edit = dict(existing) if isinstance(existing, dict) else {}
        edit["chapters"] = chapters
        edit["currentChapterIndex"] = 0
        for scope in ["chat", "global"]:
            client.variable_set(chat_id, "tf_story.edit", edit, scope=scope)
        echo(f"  [OK] tf_story.edit -> {len(chapters)} chapters")

        progress = {
            "currentChapterIndex": 0,
            "currentPhase": 0,
            "currentEvent": 0,
            "phases": [],
            "sessionFreeMode": False,
        }
        for scope in ["chat", "global"]:
            client.variable_set(chat_id, "tf_progress", progress, scope=scope)
        echo("  [OK] tf_progress -> initialized")


def _sync_plugins(client, story_dir, echo):
    """同步 plugins/ 目录下的插件"""
    plugins_root = os.path.join(os.path.dirname(os.path.dirname(story_dir)), "plugins")
    if not os.path.isdir(plugins_root):
        echo("  [SKIP] plugins/ 目录不存在")
        return

    manifest_id_map = {}
    for name in os.listdir(plugins_root):
        pdir = os.path.join(plugins_root, name)
        if not os.path.isdir(pdir):
            continue
        mp = os.path.join(pdir, "manifest.json")
        if not os.path.isfile(mp):
            continue
        with open(mp, encoding="utf-8") as f:
            manifest = json.load(f)
        pid = manifest.get("id")
        if pid:
            manifest_id_map[pid] = pdir

    installed = 0
    for pid, pdir in manifest_id_map.items():
        buf = io.BytesIO()
        skip = {".git", "__pycache__", "node_modules"}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for base, dirs, files in os.walk(pdir):
                dirs[:] = [d for d in dirs if d not in skip]
                for fn in files:
                    if fn.endswith(".pyc") or fn == ".DS_Store":
                        continue
                    fp = os.path.join(base, fn)
                    rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                    z.write(fp, rel)
        zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        try:
            r = client.plugin_install(pid, zip_b64)
            ok = r.get("ok", False)
            if ok in (True, "true"):
                client.plugin_set_enabled(pid, True)
                echo(f"  [OK] {pid} v{r.get('version','?')} -> installed & enabled")
                installed += 1
            else:
                echo(f"  [ERR] {pid} install failed: {r}")
        except Exception as e:
            echo(f"  [ERR] {pid}: {e}")
    echo(f"  共 {installed}/{len(manifest_id_map)} plugins installed")