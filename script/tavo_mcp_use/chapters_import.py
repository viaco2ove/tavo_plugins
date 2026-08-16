#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
chapters_import.py - 从故事缓存目录导入章节到 tavo（静态数据同步）

读取 <story_dir>/chapters/*.json（Toonflow 章节格式），转成 tavo 插件的
tf_story.edit.chapters 结构并写入群聊变量。同时可发布 intro/globalBackground。

章节 JSON 格式（.cache/story/xxx/chapters/chapter_N.json）：
  title, sort, openingRole, openingText, completionCondition, backgroundPrompt, content

用法：
  python chapters_import.py 2 <story_dir>                # 仅导入章节
  python chapters_import.py 2 <story_dir> --with-intro   # 章节+简介+背景（来自 story_sync_config.json）
  python chapters_import.py 2 <story_dir> --dry          # 预览
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def load_env(path):
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
    env = load_env(os.path.join(ROOT, ".env"))
    url = args.url or env.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置（--url/--token 或 .env）")
    return url.rstrip("/"), token


def rpc(url, token, method, arguments, timeout=120):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + token},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("MCP HTTP %s" % e.code)
    if "error" in body:
        raise RuntimeError(body["error"].get("message", "MCP error"))
    content = body.get("result", {}).get("content", [])
    for c in content:
        if c.get("type") == "text":
            try:
                return json.loads(c["text"])
            except Exception:
                return {"raw": c.get("text")}
    return {}


def var_get(url, token, chat_id, name):
    # 优先 global（tavo_chat_reset 不影响），回退 chat scope
    try:
        r = rpc(url, token, "tavo_variable_get", {"scope": "global", "name": name})
        v = r.get("value", r) if isinstance(r, dict) else None
        if isinstance(v, dict) and v.get("chapters") is not None:
            return v
    except Exception:
        pass
    r = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": name})
    return r.get("value") if isinstance(r, dict) and "value" in r else (r or {})


def var_set(url, token, chat_id, name, value):
    """双写：global + chat scope。tavo_chat_reset 会清 chat，但 global 不受影响。"""
    r1 = r2 = None
    try:
        r1 = rpc(url, token, "tavo_variable_set", {"scope": "global", "name": name, "value": value})
    except Exception as e:
        r1 = {"__error": str(e)}
    try:
        r2 = rpc(url, token, "tavo_variable_set", {"scope": "chat", "chatId": chat_id, "name": name, "value": value})
    except Exception as e:
        r2 = {"__error": str(e)}
    return {"global": r1, "chat": r2}


def load_chapters(story_dir):
    """读取 chapters/*.json，按 sort 排序，转成插件 chapters 结构"""
    ch_dir = os.path.join(story_dir, "chapters")
    if not os.path.isdir(ch_dir):
        sys.exit("章节目录不存在: %s" % ch_dir)
    out = []
    for fn in sorted(os.listdir(ch_dir)):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(ch_dir, fn)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            print("  [跳过] %s 解析失败: %s" % (fn, e))
            continue
        out.append({
            "title": d.get("title") or fn,
            "sort": int(d.get("sort") or 0),
            "openingRole": d.get("openingRole") or "旁白",
            "openingLine": d.get("openingText") or "",
            "background": d.get("backgroundPrompt") or "",   # 背景图提示词暂存 background
            "backgroundPrompt": d.get("backgroundPrompt") or "",
            "content": d.get("content") or "",
            "successCondition": d.get("completionCondition") or "",
            "conditionVisible": True,
            "entryCondition": "",
            "musicAutoPlay": False,
            "events": [],   # 事件进度由插件从 content 的 ##/### 解析
        })
    out.sort(key=lambda c: c.get("sort", 0))
    return out


def main():
    ap = argparse.ArgumentParser(description="从故事缓存导入章节到 tavo")
    ap.add_argument("chat_id", type=int, help="群聊 chatId")
    ap.add_argument("story_dir", help="故事目录（含 chapters/）")
    ap.add_argument("--with-intro", action="store_true", help="同时写简介+全局背景（读 story_sync_config.json）")
    ap.add_argument("--reset-progress", action="store_true", help="同时重置 tf_progress（动态数据重构）")
    ap.add_argument("--dry", action="store_true", help="预览不写入")
    ap.add_argument("--url", default=None)
    ap.add_argument("--token", default=None)
    args = ap.parse_args()

    url, token = resolve_auth(args)
    story_dir = os.path.abspath(args.story_dir)
    if not os.path.isdir(story_dir):
        sys.exit("故事目录不存在: %s" % story_dir)

    chapters = load_chapters(story_dir)
    print("[导入] %s -> chat %s" % (story_dir, args.chat_id))
    print("  章节数: %d" % len(chapters))
    for c in chapters:
        print("    - %s (content %d 字, 完成条件: %s)" % (
            c["title"], len(c["content"]), (c["successCondition"] or "无")[:30]))

    if args.dry:
        print("[DRY] 未写入")
        return

    # 读现有 edit（保留 intro/globalBackground 等其他字段）
    edit = var_get(url, token, args.chat_id, "tf_story.edit")
    if not isinstance(edit, dict):
        edit = {}

    if args.with_intro:
        cfg_path = os.path.join(story_dir, "story_sync_config.json")
        if os.path.isfile(cfg_path):
            cfg = json.load(open(cfg_path, encoding="utf-8"))
            if cfg.get("persona", {}).get("description"):
                edit["intro"] = cfg["persona"]["description"][:300]
            wb = cfg.get("worldbook", {})
            if wb.get("intro"):
                # worldbook.intro 是完整世界观（含等级体系），更适合做全局背景
                edit["globalBackground"] = wb["intro"]
            print("  [简介/背景] 已从 story_sync_config.json 填充")
        else:
            print("  [警告] 无 story_sync_config.json，保留原 intro/globalBackground")

    edit["chapters"] = chapters
    var_set(url, token, args.chat_id, "tf_story.edit", edit)
    print("  [tf_story.edit] 已写入（%d 章）" % len(chapters))

    if args.reset_progress:
        progress = {
            "currentChapterIndex": 0, "completedChapters": [], "failedAttempts": 0,
            "sessionFreeMode": False, "storyCompleted": False,
            "currentPhase": 0, "currentEvent": 0, "phases": [],
            "startedAt": 0, "updatedAt": 0,
        }
        var_set(url, token, args.chat_id, "tf_progress", progress)
        print("  [tf_progress] 已重置（动态数据重构）")

    print("✅ 完成")


if __name__ == "__main__":
    main()