#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
chapter_sync.py — 章节独立管理（chat 变量 tf_story.edit.chapters）

章节内容独立于世界书，存在群聊变量 tf_story.edit.chapters 里。
本脚本让 Workbuddy 等 MCP agent 能直接读写章节：
  python chapter_sync.py list --chat-id 2
  python chapter_sync.py get 0 --chat-id 2
  python chapter_sync.py upsert chapter.json --chat-id 2
  python chapter_sync.py push chapter.txt --chat-id 2   # 单章自动追加
  python chapter_sync.py pull --chat-id 2 --out edit.json

设计：只动 chapters；intro/globalBackground 由 entry.js 的 sidebar 同步。
依赖：仅 Python 标准库。
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


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
    url = args.url or env.get("tavo_mcp_url") or os.environ.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.stderr.write("缺少 MCP 连接配置：--url/--token 或 .env 的 tavo_mcp_url / tavo_mcp_toekn\n")
        sys.exit(2)
    return url.rstrip("/"), token


def rpc(url, token, method, arguments, timeout=120):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("MCP HTTP %s: %s" % (e.code, e.reason))
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败: %s" % e)
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
                return c.get("text")
    return {}


def get_edit(url, token, chat_id):
    r = rpc(url, token, "tavo_variable_get",
            {"scope": "chat", "chatId": chat_id, "name": "tf_story.edit"})
    parsed = content_text(r) or {}
    # 工具返回 {target, name, found, value: {...}}，剥到真正的编辑数据
    return parsed.get("value", parsed) if isinstance(parsed, dict) else {}


def set_chapters(url, token, chat_id, chapters):
    # 写整个 chapters 数组（覆盖）
    r = rpc(url, token, "tavo_variable_set",
            {"scope": "chat", "chatId": chat_id,
             "name": "tf_story.edit.chapters", "value": chapters})
    return content_text(r)


def update_chapter(url, token, chat_id, idx, chapter):
    # 增量更新单章
    cur = get_edit(url, token, chat_id)
    chapters = cur.get("chapters") or []
    if idx >= len(chapters):
        chapters.append(chapter)
    else:
        chapters[idx] = chapter
    return set_chapters(url, token, chat_id, chapters)


def cmd_list(args):
    e = get_edit(args.url, args.token, args.chat_id)
    chs = e.get("chapters") or []
    print(f"[chat {args.chat_id}] 共 {len(chs)} 章")
    for i, c in enumerate(chs):
        title = c.get("title") or f"第 {i + 1} 章"
        cond = (c.get("successCondition") or "").strip()[:30]
        content_len = len(c.get("content") or "")
        print(f"  [{i}] {title} | {content_len} 字 | 完成: {cond or '（无）'}")


def cmd_get(args):
    e = get_edit(args.url, args.token, args.chat_id)
    chs = e.get("chapters") or []
    if args.idx >= len(chs):
        sys.exit(f"索引 {args.idx} 越界（仅 {len(chs)} 章）")
    print(json.dumps(chs[args.idx], ensure_ascii=False, indent=2))


def cmd_pull(args):
    e = get_edit(args.url, args.token, args.chat_id)
    out = args.out or "edit.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False, indent=2)
    print(f"[chat {args.chat_id}] 已下载 → {out} (intro={len(e.get('intro',''))} 字, "
          f"global={len(e.get('globalBackground',''))} 字, chapters={len(e.get('chapters') or [])})")


def cmd_push(args):
    """覆盖模式：从文件读完整 edit 写到变量"""
    if not os.path.isfile(args.file):
        sys.exit(f"文件不存在: {args.file}")
    e = json.load(open(args.file, encoding="utf-8"))
    if not isinstance(e, dict) or "chapters" not in e:
        sys.exit("文件格式错：需包含 chapters 数组")
    r = set_chapters(args.url, args.token, args.chat_id, e["chapters"])
    # 顺便写 intro / globalBackground
    if e.get("intro"):
        rpc(args.url, args.token, "tavo_variable_set",
            {"scope": "chat", "chatId": args.chat_id,
             "name": "tf_story.edit.intro", "value": e["intro"]})
    if e.get("globalBackground"):
        rpc(args.url, args.token, "tavo_variable_set",
            {"scope": "chat", "chatId": args.chat_id,
             "name": "tf_story.edit.globalBackground", "value": e["globalBackground"]})
    print(f"[chat {args.chat_id}] 已上传：{len(e.get('chapters') or [])} 章")


def cmd_upsert(args):
    """从 JSON 文件读一章：name 自动定位或追加"""
    if not os.path.isfile(args.file):
        sys.exit(f"文件不存在: {args.file}")
    ch = json.load(open(args.file, encoding="utf-8"))
    if "title" not in ch:
        sys.exit("文件缺 title 字段")

    chapters = get_edit(args.url, args.token, args.chat_id).get("chapters") or []
    idx = next((i for i, c in enumerate(chapters) if c.get("title") == ch["title"]), -1)
    if idx < 0:
        chapters.append(ch)
        idx = len(chapters) - 1
        action = "追加"
    else:
        chapters[idx] = ch
        action = "更新"
    set_chapters(args.url, args.token, args.chat_id, chapters)
    print(f"[chat {args.chat_id}] {action} 第 {idx + 1} 章「{ch['title']}」")


def cmd_append(args):
    """从纯文本追加为新章（自动生成章节名）"""
    text = open(args.file, encoding="utf-8").read() if os.path.isfile(args.file) else args.file
    chapters = get_edit(args.url, args.token, args.chat_id).get("chapters") or []
    title = f"第 {len(chapters) + 1} 章"
    chapters.append({
        "title": title,
        "openingRole": "旁白",
        "openingLine": "",
        "background": "",
        "content": text,
        "successCondition": "",
        "conditionVisible": True,
        "entryCondition": "",
        "musicAutoPlay": False,
    })
    set_chapters(args.url, args.token, args.chat_id, chapters)
    print(f"[chat {args.chat_id}] 追加「{title}」({len(text)} 字)")


def main():
    ap = argparse.ArgumentParser(description="章节独立管理（chat 变量 tf_story.edit.chapters）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add(name, help, **kw):
        p = sub.add_parser(name, help=help, **kw)
        p.add_argument("chat_id", type=int, help="群聊 chatId（必填）")
        p.add_argument("--url", default='', help="MCP Server URL（覆盖 .env）")
        p.add_argument("--token", default='', help="MCP Bearer Token（覆盖 .env）")
        return p

    add("list", help="列出所有章节").set_defaults(func=cmd_list)

    p = add("get", help="读取单章")
    p.add_argument("idx", type=int, help="章节索引（0-based）")
    p.set_defaults(func=cmd_get)

    p = add("pull", help="拉取完整 edit 到本地 JSON")
    p.add_argument("--out", help="输出文件（默认 edit.json）")
    p.set_defaults(func=cmd_pull)

    p = add("push", help="推送完整 edit 到 chat（覆盖 chapters）")
    p.add_argument("file", help="本地 edit JSON 文件")
    p.set_defaults(func=cmd_push)

    p = add("upsert", help="按 title 追加或替换单章")
    p.add_argument("file", help="单章 JSON 文件（含 title 字段）")
    p.set_defaults(func=cmd_upsert)

    p = add("append", help="追加纯文本为一章（自动生成章节名）")
    p.add_argument("file", help="纯文本文件路径（也支持文件内容直接粘进 file 参数）")
    p.set_defaults(func=cmd_append)

    args = ap.parse_args()
    if not hasattr(args, "func"):
        ap.print_help()
        sys.exit(1)
    url, token = resolve_auth(args)
    args.url = url
    args.token = token
    args.func(args)


if __name__ == "__main__":
    main()