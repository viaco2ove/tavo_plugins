#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tavo sync --story-json

从 story.json 读取完整配置，自动生成 story_sync_config.json，然后调用 sync_story 同步。
"""
import os
import json
import shutil


def _load_story_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _avatar_abs_from_story(story_root, avatar_file, subdir):
    """在 story_root 下查找头像文件"""
    if not avatar_file:
        return ""
    for base in ["", "avatars/", "ex/avatars/", "image/"]:
        p = os.path.join(story_root, base, avatar_file)
        if os.path.isfile(p):
            return p
    # avatar_file 可能只是 basename
    for base in ["", "avatars/", "ex/avatars/"]:
        for ext in [".png", ".webp", ".jpg", ".jpeg"]:
            p = os.path.join(story_root, base, avatar_file + ext)
            if os.path.isfile(p):
                return p
    return ""


def _resolve_md(story_root, md_file):
    """读 md 角色文件内容（toonflow 格式）"""
    if not md_file:
        return ""
    for sub in ["", "avatars/", "roles/"]:
        p = os.path.join(story_root, sub, md_file)
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                return f.read()
    return md_file


def _read_chapters(story_root, story_dir):
    """从 chapters/*.json 读章节"""
    chapters = []
    ch_dir = os.path.join(story_root, story_dir, "")
    if not os.path.isdir(ch_dir):
        return chapters
    import glob as _glob
    for fp in sorted(_glob.glob(ch_dir + "*.json")):
        with open(fp, encoding="utf-8") as f:
            ch = json.load(f)
        chapters.append({
            "title": ch.get("title", ""),
            "content": ch.get("content", ""),
            "openingRole": ch.get("openingRole", "") or "旁白",
            "openingLine": ch.get("openingLine", "") or ch.get("openingText", ""),
            "background": ch.get("background", "") or ch.get("backgroundPath", ""),
            "successCondition": ch.get("successCondition", "") or ch.get("completionCondition", ""),
            "conditionVisible": ch.get("conditionVisible", ch.get("showCompletionCondition", True)),
            "events": ch.get("events", []),
            "enabled": True,
        })
    return chapters


def _resolve_worldbook(story_root, story_name):
    """从 worldbook/worldbook.json 读取（如果存在）"""
    wb_path = os.path.join(story_root, "worldbook", "worldbook.json")
    if not os.path.isfile(wb_path):
        return None
    try:
        with open(wb_path, encoding="utf-8") as f:
            wb = json.load(f)
        entries = []
        for e in wb.get("entries", []):
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
        return {"name": wb.get("name", story_name), "source_entries": entries,
                "intro": wb.get("description", "")}
    except Exception:
        return None


def _generate_sync_config(story_json_path, story_root):
    """从 story.json 自动生成 story_sync_config.json

    复用现有 config 时（手动编辑优先），不会覆盖。
    """
    story = _load_story_json(story_json_path)
    story_name = story.get("story_name", "未命名")
    config_path = os.path.join(story_root, "story_sync_config.json")

    # 复用现有配置
    if os.path.isfile(config_path):
        try:
            with open(config_path, encoding="utf-8") as f:
                existing = json.load(f)
            # 合并 worldbook（如果现有 config 没 source_entries，从 story.json 生成）
            if not existing.get("worldbook", {}).get("source_entries"):
                wb = _resolve_worldbook(story_root, story_name)
                if wb:
                    existing.setdefault("worldbook", {})
                    existing["worldbook"]["source_entries"] = wb["source_entries"]
                    if wb.get("intro") and not existing["worldbook"].get("intro"):
                        existing["worldbook"]["intro"] = wb["intro"]
                    with open(config_path, "w", encoding="utf-8") as f:
                        json.dump(existing, f, ensure_ascii=False, indent=2)
            return config_path
        except Exception:
            pass

    # 自动生成 config
    pr = story.get("player_role", {})
    persona_avatar = _avatar_abs_from_story(story_root, pr.get("avatar_file", ""), "")
    persona = {
        "name": pr.get("name", "纯小白"),
        "description": story.get("card_scenario", ""),
        "first_mes": story.get("intro", ""),
        "personality": "玩家",
        "avatar_file": persona_avatar,
    }

    characters = []
    for npc in story.get("npc_roles", []):
        avatar = _avatar_abs_from_story(story_root, npc.get("avatar_file", ""), "")
        desc = _resolve_md(story_root, npc.get("md_file", ""))
        characters.append({
            "name": npc.get("name", ""),
            "description": desc or npc.get("name", ""),
            "first_mes": "",
            "personality": "NPC",
            "avatar_file": avatar,
            "roleType": "npc",
        })

    # 世界书
    wb = _resolve_worldbook(story_root, story_name) or {
        "name": story_name,
        "intro": story.get("intro", ""),
    }

    chapters = _read_chapters(story_root, "chapters")

    config = {
        "story_name": story_name,
        "chat_name": story_name + "！",
        "response_mode": "scenario",
        "bind_persona": True,
        "persona": persona,
        "characters": characters,
        "worldbook": wb,
        "chapters": {"dir": "chapters", "enabled_first_only": True},
        "_chapters_cache": chapters,
    }

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return config_path


def _clean_cache(story_root):
    """清空 sync_cache（char_ids.json 等）"""
    cache_path = os.path.join(story_root, "story_sync_cache.json")
    if os.path.isfile(cache_path):
        try:
            os.remove(cache_path)
        except Exception:
            pass


def sync_from_story_json(client, story_json_path, force=False,
                         duplicate_delete=False, clean_cache=False,
                         skip_sprite=False, skip_chapters=False,
                         skip_plugins=False, chat_id=None, echo=print):
    """从 story.json 同步完整故事"""
    story_json_path = os.path.abspath(story_json_path)
    story_root = os.path.dirname(story_json_path)  # story.json 在 story_dir/story.json

    # 1. 清理缓存（如指定）
    if clean_cache:
        _clean_cache(story_root)
        echo("[CLEAN] 已清空 sync_cache")

    # 2. 生成 / 复用 story_sync_config.json
    config_path = _generate_sync_config(story_json_path, story_root)
    echo(f"[CONFIG] 使用配置: {config_path}")

    # 3. 复用 sync_story 主流程
    from tavo_plugins.commands.sync_story import sync_story
    reuse_ids_path = os.path.join(story_root, "char_ids.json")
    reuse_map = None
    if os.path.isfile(reuse_ids_path):
        try:
            with open(reuse_ids_path, encoding="utf-8") as f:
                reuse_map = json.load(f)
            echo(f"  reuse IDs from: {reuse_ids_path}")
        except Exception:
            pass

    sync_story(client, story_root, force=force,
               skip_sprite=skip_sprite, skip_chapters=skip_chapters,
               skip_plugins=skip_plugins, chat_id=chat_id,
               reuse_ids=reuse_map, echo=echo)

    # 4. duplicate-delete：删除同名重复角色 + 世界书条目
    if duplicate_delete:
        echo("[DEDUP] 删除重复项...")
        # 角色
        try:
            items = client.unwrap(client.call("tavo_character_search", {"query": "", "limit": 100}))
            items = items.get("items", []) if isinstance(items, dict) else items
            seen = {}
            for it in items:
                nm = it.get("name")
                cid = it.get("id")
                if nm and cid is not None:
                    seen.setdefault(nm, []).append(cid)
            deleted = 0
            for nm, ids in seen.items():
                if len(ids) > 1:
                    keep = sorted(ids)[0]
                    for d in sorted(ids)[1:]:
                        try:
                            client.call("tavo_character_delete", {"id": d})
                            deleted += 1
                        except Exception as e:
                            echo(f"  [ERR] 角色 {nm} id={d}: {e}")
            echo(f"  [OK] 角色去重: 删除 {deleted} 个")
        except Exception as e:
            echo(f"  [ERR] 角色去重失败: {e}")

        # 世界书条目
        try:
            wb = client.unwrap(client.call("tavo_lorebook_get", {"id": 1}))
            entries = wb.get("entries", []) if isinstance(wb, dict) else []
            by_name = {}
            for e in entries:
                nm = e.get("name")
                if nm:
                    by_name.setdefault(nm, []).append(e.get("identifier"))
            deleted = 0
            for nm, ids in by_name.items():
                if len(ids) > 1:
                    keep = ids[0]
                    for d in ids[1:]:
                        try:
                            client.call("tavo_lorebook_entry_delete", {"lorebookId": 1, "identifier": d})
                            deleted += 1
                        except Exception as e:
                            echo(f"  [ERR] worldbook {nm} id={d}: {e}")
            echo(f"  [OK] 世界书去重: 删除 {deleted} 个")
        except Exception as e:
            echo(f"  [ERR] 世界书去重失败: {e}")