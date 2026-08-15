#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
story_sync.py — 通用「故事 → tavo」同步工具（创建 / 编辑均幂等可重跑）

设计目标
--------
- 故事数据不写死在脚本里：每个故事目录只需提供一份 `story_sync_config.json`
  （角色文本、用户身份、头像相对路径、世界书/章节源指向），本工具负责读取并同步到 tavo。
- 正确修复两类历史错误：
  1) 头像：必须用 `tavo_file_save` 落为 `files/global/<name>` 文件引用，再经
     `tavo_character_import_card` / `tavo_persona_create` 整卡/整身份导入；
     **绝不**内联 base64，也**绝不**依赖 `tavo_character_update`（它不持久化 avatar）。
  2) 用户身份：玩家角色 = persona 资产（`kind: persona`），经 `tavo_persona_create` 创建并
     `set_active`，再通过 `tavo_chat_update({personaId})` 绑定到群聊；
     玩家角色**不**作为 NPC 进群聊 characterIds（否则会出现「用户纯小白 + NPC纯小白」双实体）。

同步策略（幂等）
------------
- 世界书：按 name search，命中复用 id，缺失才 create（编辑世界书请用 --rebuild-worldbook）。
- 用户身份(persona)：按 name search，命中复用并 set_active，缺失才 create。
- 角色(NPC)：按 name search，命中则比对 avatar/文本；有差异(或 --force) 走 import_card 换新卡
  → 重绑群聊 → 删旧卡；无差异则复用。
- 群聊：按 name search，命中则 chat_update 重绑(characterIds+lorebookIds+personaId+responseMode)，
  缺失则 chat_create。

仅依赖 Python 标准库（urllib / json / base64 / argparse / os / sys）。

用法
----
  # 连通性自检
  python story_sync.py <故事目录> --check

  # 预演（不落库，create/import 加 dryRun，不重绑/不删）
  python story_sync.py <故事目录> --dry

  # 正式同步（幂等，可安全重跑）
  python story_sync.py <故事目录>

  # 强制把所有角色/身份重导一遍（换头像或大幅改文案时用）
  python story_sync.py <故事目录> --force

  # 重建世界书（删除旧世界书后重建；会新建一条 worldbook）
  python story_sync.py <故事目录> --rebuild-worldbook

  # 覆盖连接
  python story_sync.py <故事目录> --url http://127.0.0.1:7347/mcp --token YOUR_TOKEN
"""
import os
import sys
import io
import json
import base64
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
# HERE = script/tavo_mcp_use/story_sync  →  上三级 = tavo_plugins 根
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


# ---------------------------------------------------------------------------
# 配置加载（.env，与 plugin_install.py 一致）
# ---------------------------------------------------------------------------
def load_env_file(path):
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve_auth(args):
    env = load_env_file(os.path.join(ROOT, ".env"))
    url = args.url or env.get("tavo_mcp_url") or os.environ.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.stderr.write(
            "缺少 MCP 连接配置：请传 --url/--token，或在项目根 .env 配置 "
            "tavo_mcp_url / tavo_mcp_toekn\n"
        )
        sys.exit(2)
    return url.rstrip("/"), token


# ---------------------------------------------------------------------------
# MCP JSON-RPC
# ---------------------------------------------------------------------------
def rpc(url, token, method, arguments, timeout=120):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": method, "arguments": arguments},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("MCP HTTP %s: %s" % (e.code, e.reason))
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败（Server 是否启用？URL/IP 是否正确？）: %s" % e)
    if "error" in body:
        raise RuntimeError("MCP error: %s" % json.dumps(body["error"], ensure_ascii=False))
    return body.get("result", {})


def content_text(result):
    content = (result or {}).get("content") or []
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            try:
                return json.loads(c["text"])
            except Exception:
                return {"raw": c.get("text")}
    return {}


def call(url, token, method, args, dry=False, timeout=120):
    a = dict(args)
    if dry and ("create" in method or "import" in method or method == "tavo_chat_create"):
        a["dryRun"] = True
    res = rpc(url, token, method, a, timeout=timeout)
    return content_text(res)


def extract_id(inner, candidates=("id", "character_id", "characterId", "lorebook_id",
                                  "lorebookId", "chat_id", "chatId", "persona_id", "personaId")):
    if isinstance(inner, dict):
        for k in candidates:
            if inner.get(k):
                return inner[k]
    return None


def search_first_id(url, token, method, name):
    """通用 search：tavo_character_search / tavo_lorebook_search / tavo_persona_search / tavo_chat_search。"""
    res = call(url, token, method, {"query": name, "match": "exact", "limit": 10})
    items = res.get("items", []) if isinstance(res, dict) else []
    for it in items:
        if it.get("name") == name or it.get("id") is not None:
            return it.get("id")
    return None


# ---------------------------------------------------------------------------
# 资源 / 文件上传
# ---------------------------------------------------------------------------
def b64_of(abs_path):
    with open(abs_path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def file_save(url, token, chat_id, name, b64, scope="global", dry=False):
    """上传文件到 tavo，返回 files/global/<name> 引用路径。scope=global 仍需传 chatId。"""
    if dry:
        return "files/global/%s" % name
    res = call(url, token, "tavo_file_save",
               {"chatId": chat_id, "name": name,
                "content": b64, "options": {"scope": scope, "encoding": "base64"}},
               timeout=180)
    path = (res or {}).get("path")
    if not path:
        raise RuntimeError("tavo_file_save 未返回 path：%s" % json.dumps(res, ensure_ascii=False)[:200])
    return path


def avatar_path_for(url, token, chat_id, name, avatar_rel, story_dir, dry=False):
    """把头像图读成 base64、上传、返回 files/global 引用。"""
    if not avatar_rel:
        return None
    abs_p = os.path.join(story_dir, avatar_rel)
    if not os.path.isfile(abs_p):
        print("  [警告] 头像文件缺失，跳过: %s" % abs_p)
        return None
    ext = os.path.splitext(avatar_rel)[1].lstrip(".") or "png"
    fname = "%s.%s" % (name, ext)
    b64 = b64_of(abs_p)
    return file_save(url, token, chat_id, fname, b64, scope="global", dry=dry)


def chapter_bg_path_for(url, token, chat_id, base, story_dir, dry=False):
    """按命名约定 image/<base>_background.<ext> 找章节背景图，上传并返回 files/global 引用。"""
    for ext in ("png", "jpg", "jpeg", "webp"):
        rel = "image/%s_background.%s" % (base, ext)
        abs_p = os.path.join(story_dir, rel)
        if os.path.isfile(abs_p):
            b64 = b64_of(abs_p)
            return file_save(url, token, chat_id, "%s_background.%s" % (base, ext), b64, scope="global", dry=dry)
    return None


# ---------------------------------------------------------------------------
# 世界书
# ---------------------------------------------------------------------------
def build_worldbook_entries(cfg, story_dir):
    wb_cfg = cfg.get("worldbook", {})
    entries = []

    # 1) 故事简介（常驻 constant）
    intro = wb_cfg.get("intro")
    if intro:
        entries.append({"name": "故事简介", "content": "[故事简介]\n" + intro,
                        "strategy": "constant", "enabled": True})

    # 2) worldbook.json 源
    src = wb_cfg.get("source")
    if src:
        wb_path = os.path.join(story_dir, src)
        if os.path.isfile(wb_path):
            wb = json.load(open(wb_path, encoding="utf-8"))
            for e in wb.get("entries", []):
                is_const = bool(e.get("constant"))
                item = {
                    "name": e.get("title", ""),
                    "content": e.get("content", ""),
                    "strategy": "constant" if is_const else "keyword",
                    "enabled": True,
                }
                keys = [k for k in (e.get("keys") or []) if k]
                if not is_const and keys:
                    item["keywords"] = keys
                if e.get("probability") is not None:
                    item["probability"] = max(0, min(100, int(e["probability"])))
                entries.append(item)

    # 3) 章节 keyword 入口
    ch_cfg = cfg.get("chapters") or {}
    ch_dir = ch_cfg.get("dir")
    if ch_dir:
        ch_path = os.path.join(story_dir, ch_dir)
        if os.path.isdir(ch_path):
            files = sorted(f for f in os.listdir(ch_path) if f.endswith(".json"))
            enabled_first = bool(ch_cfg.get("enabled_first_only", True))
            for i, f in enumerate(files):
                c = json.load(open(os.path.join(ch_path, f), encoding="utf-8"))
                content = c.get("content", "")
                opening = c.get("openingText")
                if opening:
                    content = "【开场】%s\n\n%s" % (opening, content)
                title = c.get("title", f)
                kw = title.split("：")[-1] if "：" in title else title
                entries.append({
                    "name": title,
                    "content": content,
                    "strategy": "keyword",
                    "enabled": enabled_first and i == 0,
                    "keywords": [kw],
                })

    return entries


def ensure_worldbook(cfg, url, token, dry, rebuild, story_dir):
    wb_cfg = cfg.get("worldbook", {})
    name = wb_cfg.get("name") or cfg.get("story_name")
    existing = search_first_id(url, token, "tavo_lorebook_search", name)
    if existing and not rebuild:
        print("  [世界书] %s -> 复用 id=%s" % (name, existing))
        return existing
    if existing and rebuild:
        print("  [世界书] %s 存在(id=%s)，--rebuild 跳过自动删除（请手动删后重跑或换名）" % (name, existing))
        return existing
    entries = build_worldbook_entries(cfg, story_dir)
    n_const = sum(1 for e in entries if e["strategy"] == "constant")
    n_kw = sum(1 for e in entries if e["strategy"] == "keyword")
    inner = call(url, token, "tavo_lorebook_create",
                 {"lorebook": {"name": name,
                               "description": wb_cfg.get("description", ""),
                               "entries": entries}}, dry=dry)
    wid = extract_id(inner, ("id", "lorebook_id", "lorebookId"))
    print("  [世界书] %s -> 新建 id=%s (entries=%d, const=%d, kw=%d)%s"
          % (name, wid, len(entries), n_const, n_kw, " [DRY]" if dry else ""))
    return wid


# ---------------------------------------------------------------------------
# 用户身份 (persona)
# ---------------------------------------------------------------------------
def ensure_persona(cfg, url, token, chat_id, dry):
    p = cfg.get("persona")
    if not p:
        print("  [用户身份] 配置无 persona，跳过")
        return None
    name = p["name"]
    existing = search_first_id(url, token, "tavo_persona_search", name)
    if existing:
        # persona 无 update/delete MCP，命中即复用并激活
        if not dry:
            call(url, token, "tavo_persona_set_active", {"id": existing})
        print("  [用户身份] %s -> 复用 id=%s (已 set_active)%s" % (name, existing, " [DRY]" if dry else ""))
        return existing

    avatar = avatar_path_for(url, token, chat_id, name, p.get("avatar_file"),
                             cfg.get("_story_dir"), dry=dry)
    persona = {
        "name": name,
        "description": p.get("description", ""),
        "avatar": avatar,
        "active": True,
    }
    inner = call(url, token, "tavo_persona_create", {"persona": persona}, dry=dry)
    pid = extract_id(inner, ("id", "persona_id", "personaId"))
    print("  [用户身份] %s -> 新建 id=%s (avatar=%s)%s"
          % (name, pid, avatar, " [DRY]" if dry else ""))
    return pid


# ---------------------------------------------------------------------------
# 角色 (NPC)
# ---------------------------------------------------------------------------
def _norm(s):
    return (s or "").replace("\r", "").replace("\n", "").strip()


def ensure_characters(cfg, url, token, chat_id, dry, force, story_dir):
    chars = cfg.get("characters", [])
    ids = []
    replace_map = {}   # old_id -> new_id （被重导替换的旧卡，稍后删除）
    desired_names = [c["name"] for c in chars]

    for c in chars:
        name = c["name"]
        existing = search_first_id(url, token, "tavo_character_search", name)
        if not existing:
            avatar = avatar_path_for(url, token, chat_id, name, c.get("avatar_file"), story_dir, dry=dry)
            data = {
                "name": name,
                "description": c.get("description", ""),
                "first_mes": c.get("first_mes", "你好"),
                "personality": c.get("personality", ""),
                "avatar": avatar,
            }
            inner = call(url, token, "tavo_character_import_card",
                         {"card": {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}}, dry=dry)
            nid = extract_id(inner)
            print("  [角色] %s -> 新建 id=%s (avatar=%s)%s" % (name, nid, avatar, " [DRY]" if dry else ""))
            ids.append(nid)
            continue

        # 命中：比对 avatar + 文本
        d = call(url, token, "tavo_character_get", {"id": existing})
        old = d.get("data", d) if isinstance(d, dict) else {}
        desired_avatar = avatar_path_for(url, token, chat_id, name, c.get("avatar_file"), story_dir, dry=dry)
        text_changed = (
            _norm(old.get("description")) != _norm(c.get("description", ""))
            or _norm(old.get("first_mes")) != _norm(c.get("first_mes", ""))
            or _norm(old.get("personality")) != _norm(c.get("personality", ""))
        )
        avatar_changed = (old.get("avatar") or "") != (desired_avatar or "")
        if (avatar_changed or text_changed or force) and not dry:
            new_data = dict(old)
            new_data.update({
                "name": name,
                "description": c.get("description", old.get("description", "")),
                "first_mes": c.get("first_mes", old.get("first_mes", "你好")),
                "personality": c.get("personality", old.get("personality", "")),
                "avatar": desired_avatar,
            })
            inner = call(url, token, "tavo_character_import_card",
                         {"card": {"spec": "chara_card_v3", "spec_version": "3.0", "data": new_data}})
            nid = extract_id(inner)
            replace_map[existing] = nid
            print("  [角色] %s -> 重导 id=%s (旧=%s, avatar=%s)%s"
                  % (name, nid, existing, desired_avatar, " [text]" if text_changed else ""))
            ids.append(nid)
        else:
            if dry:
                flag = " [将重导]" if (avatar_changed or text_changed or force) else " [无变化]"
                print("  [角色] %s -> 命中 id=%s (dry%s)" % (name, existing, flag))
            else:
                print("  [角色] %s -> 复用 id=%s (无变化)" % (name, existing))
            ids.append(existing)

    return ids, replace_map, desired_names


# ---------------------------------------------------------------------------
# 群聊
# ---------------------------------------------------------------------------
def ensure_chat(cfg, url, token, char_ids, lorebook_id, persona_id, dry):
    chat_name = cfg.get("chat_name") or (cfg.get("story_name") + " · 第1章")
    existing = search_first_id(url, token, "tavo_chat_search", chat_name)
    chat_data = {
        "name": chat_name,
        "characterIds": [i for i in char_ids if i],
        "lorebookIds": [lorebook_id] if lorebook_id else [],
        "responseMode": cfg.get("response_mode", "scenario"),
    }
    if cfg.get("bind_persona", True) and persona_id:
        chat_data["personaId"] = persona_id

    if existing:
        inner = call(url, token, "tavo_chat_update", {"id": existing, "chat": chat_data}, dry=dry)
        cid = existing
        print("  [群聊] %s -> 更新 id=%s (char=%d, lore=%s, persona=%s)%s"
              % (chat_name, cid, len(chat_data["characterIds"]), lorebook_id, persona_id, " [DRY]" if dry else ""))
        return cid
    inner = call(url, token, "tavo_chat_create", {"chat": chat_data}, dry=dry)
    cid = extract_id(inner, ("id", "chat_id", "chatId"))
    print("  [群聊] %s -> 新建 id=%s (char=%d, lore=%s, persona=%s)%s"
          % (chat_name, cid, len(chat_data["characterIds"]), lorebook_id, persona_id, " [DRY]" if dry else ""))
    return cid


# ---------------------------------------------------------------------------
# 章节：读取 chapters/<x>.json，把开场脚本逐条生成成聊天消息（到第一个"用户发言"停下）
# ---------------------------------------------------------------------------
def parse_chapter_script(content, opening_text, opening_role):
    """把章节 content（markdown 脚本：@角色：台词 / ### 用户发言）解析成消息列表。

    返回 [(speaker_name, text, is_narration), ...]，遇到第一个 '### 用户发言' 即停止。
    这样开场剧情被"播放"成真实聊天消息，轮到真实用户时停下，保留交互性。
    """
    beats = []
    if opening_text:
        beats.append((opening_role or "旁白", opening_text, True))
    open_norm = (opening_text or "").replace(" ", "").replace("\n", "")
    for raw in (content or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("###") and "用户发言" in line:
            break  # 轮到真实用户，停止生成
        if line.startswith("@"):
            body = line[1:]
            if "：" in body:
                role, text = body.split("：", 1)
            elif ":" in body:
                role, text = body.split(":", 1)
            else:
                role, text = "旁白", body
            role = role.strip()
            text = text.strip()
            if not text:
                continue
            is_narration = (role == "旁白")
            # 去重：opening 已覆盖的开场旁白不再重复生成
            if is_narration and open_norm and text.replace(" ", "").replace("\n", "") in open_norm:
                continue
            beats.append((role, text, is_narration))
    return beats


def ensure_chapters(cfg, url, token, chat_id, name_to_id, dry, force_chapters):
    ch_cfg = cfg.get("chapters") or {}
    ch_dir = ch_cfg.get("dir")
    if not ch_dir:
        return
    story_dir = cfg.get("_story_dir")
    ch_path = os.path.join(story_dir, ch_dir)
    if not os.path.isdir(ch_path):
        print("  [章节] 目录不存在，跳过: %s" % ch_path)
        return

    files = sorted(f for f in os.listdir(ch_path) if f.endswith(".json"))
    if not files:
        return
    # 取 sort 最小（当前激活）的章节
    chapters = []
    for f in files:
        try:
            c = json.load(open(os.path.join(ch_path, f), encoding="utf-8"))
            chapters.append((c.get("sort", 999), f, c))
        except Exception as e:
            print("  [章节] 解析失败 %s: %s" % (f, e))
    chapters.sort(key=lambda x: x[0])
    _, fname, chapter = chapters[0]

    # 幂等：仅在群聊为空（或 --force-chapters）时生成，避免重复
    if not dry:
        try:
            cnt = call(url, token, "tavo_message_count", {"chatId": chat_id})
            cur = (cnt.get("count") if isinstance(cnt, dict) else cnt) or 0
        except Exception:
            cur = 0
        if cur > 0 and not force_chapters:
            print("  [章节] 群聊已有 %d 条消息，跳过开场生成（--force-chapters 可重生成）" % cur)
            return

    beats = parse_chapter_script(chapter.get("content", ""),
                                chapter.get("openingText"),
                                chapter.get("openingRole") or "旁白")
    if not beats:
        print("  [章节] %s 无可生成开场，跳过" % fname)
        return

    n = 0
    for speaker, text, is_narration in beats:
        cid = None if is_narration else name_to_id.get(speaker)
        msg = {
            "role": "assistant",
            "content": text.replace("用户", "你"),
            "speakerName": speaker,
            "characterId": cid,
        }
        if dry:
            print("  [章节][DRY] +%s: %s" % (speaker, text[:30]))
            n += 1
            continue
        call(url, token, "tavo_message_append", {"chatId": chat_id, "message": msg})
        n += 1
    print("  [章节] %s -> 生成开场 %d 条消息（到首个用户发言停止）%s"
          % (chapter.get("title", fname), n, " [DRY]" if dry else ""))


# ---------------------------------------------------------------------------
# 章节编辑变量：把 chapters/<x>.json 同步到 chat 变量 tf_story.edit
# 这样 toonflow_story_event_manager 的章节结局判定器 / 事件进度判定器才能读到。
# ---------------------------------------------------------------------------
def build_edit_from_chapters(cfg, story_dir, url, token, chat_id, dry):
    """读取 chapters 目录，返回 {intro, globalBackground, chapters}（插件格式）。

    章节背景图：按命名约定 image/<章节文件base>_background.<ext> 找本地图，
    上传到 tavo 并把 ch.background 设为 files/global/... 引用（面板可渲染）。
    找不到背景图则 background 留空（面板显示占位提示，不再把文字提示词当图）。
    """
    wb_cfg = cfg.get("worldbook") or {}
    edit = {
        "intro": cfg.get("story_name", ""),
        "globalBackground": wb_cfg.get("intro", ""),
        "chapters": [],
    }
    ch_cfg = cfg.get("chapters") or {}
    ch_dir = ch_cfg.get("dir")
    if not ch_dir:
        return edit
    ch_path = os.path.join(story_dir, ch_dir)
    if not os.path.isdir(ch_path):
        return edit
    files = sorted(f for f in os.listdir(ch_path) if f.endswith(".json"))
    chapters = []
    for f in files:
        try:
            c = json.load(open(os.path.join(ch_path, f), encoding="utf-8"))
            chapters.append((c.get("sort", 999), f, c))
        except Exception as e:
            print("  [章节变量] 解析失败 %s: %s" % (f, e))
    chapters.sort(key=lambda x: x[0])
    for _, f, c in chapters:
        base = os.path.splitext(f)[0]
        bg = chapter_bg_path_for(url, token, chat_id, base, story_dir, dry)
        if bg:
            print("  [章节变量] %s 背景图 -> %s%s" % (base, bg, " [DRY]" if dry else ""))
        edit["chapters"].append({
            "title": c.get("title", ""),
            "openingRole": c.get("openingRole") or "旁白",
            "openingLine": c.get("openingText") or "",
            "background": bg or "",
            "backgroundPrompt": c.get("backgroundPrompt") or "",
            "content": c.get("content", ""),
            "successCondition": c.get("completionCondition") or "",
            "conditionVisible": True,
            "entryCondition": "",
            "musicAutoPlay": False,
        })
    return edit


def ensure_chapter_edit_variable(cfg, url, token, chat_id, dry):
    """把章节数据写进 chat 变量 tf_story.edit，供 event_manager 判定器使用。"""
    story_dir = cfg.get("_story_dir")
    edit = build_edit_from_chapters(cfg, story_dir, url, token, chat_id, dry)
    if not edit["chapters"]:
        print("  [章节变量] 无章节数据，跳过")
        return
    if dry:
        print("  [章节变量][DRY] 将写入 tf_story.edit：%d 章" % len(edit["chapters"]))
        for i, ch in enumerate(edit["chapters"][:3]):
            print("    [%d] %s | bg=%s | content=%d 字 | success=%s"
                  % (i, ch["title"], ch["background"] or "（无）", len(ch["content"]),
                     ch["successCondition"][:30] if ch["successCondition"] else "（无）"))
        if len(edit["chapters"]) > 3:
            print("    ... 还有 %d 章" % (len(edit["chapters"]) - 3))
        return
    try:
        call(url, token, "tavo_variable_set",
             {"scope": "chat", "chatId": chat_id, "name": "tf_story.edit", "value": edit})
        print("  [章节变量] tf_story.edit 已写入 %d 章（含背景图引用）" % len(edit["chapters"]))
    except Exception as e:
        print("  [章节变量] 写入失败: %s" % e)


# ---------------------------------------------------------------------------
# 清理：删掉群聊里不再需要的角色卡（如旧的玩家角色 NPC 卡）
# ---------------------------------------------------------------------------
def cleanup(url, token, chat_id, desired_names, persona_name, replace_map, dry):
    if dry or not chat_id:
        return
    ch = call(url, token, "tavo_chat_get", {"id": chat_id})
    cur_ids = list(ch.get("characterIds", [])) if isinstance(ch, dict) else []
    keep_ids = set(x for x in cur_ids if x)  # 当前群聊绑定的目标卡（都应保留）
    to_delete = set(replace_map.keys())      # 被重导替换的旧卡

    # 玩家角色不应作为 NPC 存在：删除任何名为 persona_name 的残留角色卡
    if persona_name:
        pid = search_first_id(url, token, "tavo_character_search", persona_name)
        if pid and pid not in keep_ids:
            to_delete.add(pid)

    # 群聊里若出现非期望 / 玩家角色名的卡，也清掉
    for cid in list(cur_ids):
        d = call(url, token, "tavo_character_get", {"id": cid})
        nm = (d.get("data", d) if isinstance(d, dict) else {}).get("name", "")
        if nm == persona_name or (nm and nm not in desired_names):
            to_delete.add(cid)

    for cid in sorted(to_delete):
        if cid in cur_ids:
            new_ids = [x for x in cur_ids if x != cid]
            call(url, token, "tavo_chat_update", {"id": chat_id, "chat": {"characterIds": new_ids}})
            cur_ids = new_ids
        call(url, token, "tavo_character_delete", {"id": cid})
        print("  [清理] 删除旧角色卡 id=%s" % cid)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def load_config(story_dir):
    cfg_path = os.path.join(story_dir, "story_sync_config.json")
    if not os.path.isfile(cfg_path):
        sys.exit("找不到配置: %s" % cfg_path)
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    cfg["_story_dir"] = story_dir
    return cfg


def main():
    ap = argparse.ArgumentParser(description="通用 故事 → tavo 同步工具")
    ap.add_argument("story_dir", help="故事目录（含 story_sync_config.json）")
    ap.add_argument("--check", action="store_true", help="仅连通性自检")
    ap.add_argument("--dry", action="store_true", help="预演，不落库")
    ap.add_argument("--force", action="store_true", help="强制重导所有角色/身份")
    ap.add_argument("--rebuild-worldbook", action="store_true", help="重建世界书")
    ap.add_argument("--force-chapters", action="store_true",
                    help="强制重生成章节开场（群聊已有消息时也会追加，可能重复）")
    ap.add_argument("--url", help="MCP Server URL（覆盖 .env）")
    ap.add_argument("--token", help="MCP Bearer Token（覆盖 .env）")
    args = ap.parse_args()

    story_dir = os.path.abspath(args.story_dir)
    if not os.path.isdir(story_dir):
        sys.exit("故事目录不存在: %s" % story_dir)

    url, token = resolve_auth(args)

    if args.check:
        try:
            # tools/list 直接发（不走 tools/call 封装）
            payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url, data=data,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
                method="POST")
            with urllib.request.urlopen(req, timeout=20) as r:
                body = json.loads(r.read().decode("utf-8"))
            tools = body.get("result", {}).get("tools", [])
            print("✅ 连通! HTTP 工具数: %d" % len(tools))
        except Exception as e:
            print("❌ %s" % e)
            sys.exit(1)
        return

    cfg = load_config(story_dir)
    dry = args.dry
    print("==> %s连接 tavo MCP: %s" % ("[DRY] " if dry else "", url))
    print("==> 故事: %s" % cfg.get("story_name"))

    # 1. 群聊先建（拿 id 供头像上传用）
    chat_name = cfg.get("chat_name") or (cfg.get("story_name") + " · 第1章")
    chat_id = search_first_id(url, token, "tavo_chat_search", chat_name)
    if not chat_id:
        chat_id = ensure_chat(cfg, url, token, [], None, None, dry)
    else:
        print("  [群聊] %s -> 命中 id=%s（稍后重绑）" % (chat_name, chat_id))

    # 2. 世界书
    lorebook_id = ensure_worldbook(cfg, url, token, dry, args.rebuild_worldbook, story_dir)

    # 3. 用户身份
    persona_id = ensure_persona(cfg, url, token, chat_id, dry)

    # 4. 角色
    char_ids, replace_map, desired_names = ensure_characters(
        cfg, url, token, chat_id, dry, args.force, story_dir)

    # 5. 群聊绑定（重绑 characterIds + lorebook + persona）
    if not dry:
        chat_id = ensure_chat(cfg, url, token, char_ids, lorebook_id, persona_id, dry)

    # 5.5 章节开场生成（读取 chapters/，把开场脚本逐条生成成聊天消息）
    name_to_id = dict(zip(desired_names, char_ids))
    ensure_chapters(cfg, url, token, chat_id, name_to_id, dry, args.force_chapters)

    # 5.6 章节编辑变量同步（写入 tf_story.edit，含背景图上传，供 event_manager 判定器读取）
    ensure_chapter_edit_variable(cfg, url, token, chat_id, dry)

    # 6. 清理旧卡
    if not dry:
        cleanup(url, token, chat_id, desired_names,
                (cfg.get("persona") or {}).get("name"), replace_map, dry)

    if dry:
        print("\n✅ DRY 完成（未落库）。去掉 --dry 正式同步。")
        return

    print("\n✅ 同步完成")
    print("   chat_id=%s  lorebook_id=%s  persona_id=%s" % (chat_id, lorebook_id, persona_id))
    print("   character_ids=%s" % char_ids)


if __name__ == "__main__":
    main()
