#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
get_info.py - 检查故事同步状态（读取 .env 连接 MCP）

用法:
  python get_info.py                                    # 检查当前聊天
  python get_info.py <chat_id>                        # 检查指定 chat
  python get_info.py --list                           # 列出所有聊天
  python get_info.py <chat_id> --check                # 完整检查（聊天+角色+世界书+变量）
"""
import os, sys, json, argparse, urllib.request, urllib.error

# story_sync -> tavo_mcp_use -> script -> tavo_plugins
_SCRIPT = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_SCRIPT)))


def load_env():
    env = {}
    env_path = os.path.join(_ROOT, ".env")
    if not os.path.isfile(env_path):
        sys.exit("找不到 .env: " + env_path)
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve_auth(args):
    env = load_env()
    url = args.url or env.get("tavo_mcp_url") or os.environ.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置：--url/--token 或 .env")
    return url.rstrip("/"), token


def rpc_raw(url, token, method, arguments, timeout=30):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                               headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
                               method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return {"error": body}
    except Exception as e:
        return {"error": str(e)}


def parse(result):
    """从 MCP result 里提取实际数据（处理 content[0].text JSON 包裹）。"""
    if isinstance(result, dict) and "error" in result:
        return None, result["error"]
    r = result.get("result", result)
    content = r.get("content") if isinstance(r, dict) else None
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                t = c.get("text", "")
                try:
                    return json.loads(t), None
                except Exception:
                    return t, None
    return r if r else None, None


def rpc(url, token, method, args, timeout=30):
    body = rpc_raw(url, token, method, args, timeout)
    data, err = parse(body)
    if err:
        raise RuntimeError("MCP %s: %s" % (method, err))
    return data


# ---------------------------------------------------------------------------
# 检查项
# ---------------------------------------------------------------------------

def check_chat(url, token, chat_id):
    print("=" * 60)
    print("聊天 #%s" % chat_id)
    print("=" * 60)

    # 聊天基础信息
    chat = rpc(url, token, "tavo_chat_get", {"id": chat_id})
    if not chat:
        print("  ❌ 聊天不存在或无法访问")
        return

    settings = chat.get("settings") or {}
    char_ids = chat.get("characterIds") or []
    lore_ids = chat.get("lorebookIds") or []
    persona_id = chat.get("personaId")

    print("  名称:    %s" % (chat.get("name") or "?"))
    print("  模式:    responseMode=%s" % settings.get("responseMode", "?"))
    orch = settings.get("overrideScenario", "")
    print("  编排:    overrideScenario=%s字符" % len(orch))
    print("  角色数:  %d" % len(char_ids))
    print("  世界书:  %d 个" % len(lore_ids))
    print("  用户身份: %s" % (persona_id or "无"))

    # 世界书条目
    if lore_ids:
        lb_id = lore_ids[0]
        lb = rpc(url, token, "tavo_lorebook_get", {"id": lb_id})
        if lb:
            entries = lb.get("entries") or []
            const_entries = [e for e in entries if e.get("strategy") == "constant"]
            kw_entries = [e for e in entries if e.get("strategy") != "constant"]
            print("\n  世界书 #%s (%s)" % (lb_id, lb.get("name", "")))
            print("    总条目:  %d（constant=%d, keyword=%d）" % (len(entries), len(const_entries), len(kw_entries)))
            for e in const_entries[:5]:
                print("    [const] %s" % (e.get("name") or "")[:50])

    # 角色详情
    if char_ids:
        print("\n  角色列表:")
        RT = {"narrator": "旁白", "npc": "一般角色",
               "player": "用户", "system": "系统角色", "general": "万能角色"}
        for cid in char_ids:
            ch = rpc(url, token, "tavo_character_get", {"id": cid})
            if ch:
                d = ch.get("data", ch) if isinstance(ch, dict) else {}
                rt = d.get("roleType") or ""
                print("    [%s] %s  type=%s" % (cid, d.get("name", "?"), RT.get(rt, rt or "?")))

    # tf_story.edit
    print()
    try:
        edit = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": "tf_story.edit"})
    except Exception:
        edit = None
    if isinstance(edit, dict) and "value" in edit:
        edit = edit["value"]
    if isinstance(edit, dict) and edit:
        chs = edit.get("chapters") or []
        print("  tf_story.edit:")
        print("    意图识别: %s" % (edit.get("intentMode") or "（默认关键词）"))
        print("    编排模式: %s" % (edit.get("orchestration") or "plugin"))
        print("    台词数量: %s" % (edit.get("lineCount") or 20))
        print("    章节数:   %d" % len(chs))
        for i, ch in enumerate(chs):
            bg = ch.get("background") or ""
            bg_note = "✓" if bg else "✗ 无背景"
            print("    [%d] %s  content=%d字  bg=%s" % (
                i, (ch.get("title") or "?")[:30], len(ch.get("content") or ""), bg_note))
    elif edit:
        print("  tf_story.edit: %s" % str(edit)[:100])
    else:
        print("  tf_story.edit: ❌ 未找到")

    # tf_progress
    print()
    try:
        prog = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": "tf_progress"})
    except Exception:
        prog = None
    if isinstance(prog, dict) and "value" in prog:
        prog = prog["value"]
    if isinstance(prog, dict) and prog:
        print("  tf_progress:")
        print("    currentChapterIndex:  %s" % prog.get("currentChapterIndex", 0))
        print("    completedChapters:   %s" % prog.get("completedChapters", []))
        print("    sessionFreeMode:     %s" % prog.get("sessionFreeMode", False))
        print("    storyCompleted:       %s" % prog.get("storyCompleted", False))
    else:
        print("  tf_progress: ❌ 未找到")

    # tmm_story_static
    print()
    try:
        static = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": "tmm_story_static"})
    except Exception:
        static = None
    if isinstance(static, dict) and "value" in static:
        static = static["value"]
    if isinstance(static, dict) and static:
        chars = static.get("characters") or []
        print("  tmm_story_static: %d 个角色基准卡" % len(chars))
        for c in chars[:6]:
            card = c.get("card") or {}
            print("    %s  roleType=%s level=%s" % (
                c.get("name") or "?",
                c.get("roleType") or "?",
                card.get("level") or "?"))
    else:
        print("  tmm_story_static: ❌ 未找到")

    # tmm 记忆
    print()
    try:
        mem = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": "tmm"})
    except Exception:
        mem = None
    if isinstance(mem, dict) and "value" in mem:
        mem = mem["value"]
    if isinstance(mem, dict) and mem:
        meta = mem.get("meta") or {}
        cards = mem.get("cards") or {}
        summary = meta.get("summary") or ""
        facts = meta.get("facts") or []
        print("  tmm（记忆）:")
        print("    summary: %s" % (summary[:80] if summary else "（空）"))
        print("    facts:   %d 条" % len(facts))
        player_card = cards.get("player") or {}
        npcs = cards.get("npcs") or {}
        print("    player items: %s" % (player_card.get("items") or []))
        print("    npcs:       %d 个 %s" % (len(npcs), list(npcs.keys())[:4]))
    else:
        print("  tmm: ❌ 未找到")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="检查故事同步状态（读取 .env）")
    ap.add_argument("chat_id", nargs="?", type=int, help="聊天 ID（不填则查当前聊天）")
    ap.add_argument("--check", action="store_true", help="完整检查")
    ap.add_argument("--list", action="store_true", help="列出所有聊天")
    ap.add_argument("--url", help="MCP URL（覆盖 .env）")
    ap.add_argument("--token", help="MCP Token（覆盖 .env）")
    args = ap.parse_args()

    url, token = resolve_auth(args)

    # 连通性检查
    try:
        body = rpc_raw(url, token, "tavo_current_chat_get", {})
        curr, err = parse(body)
        if err:
            print("MCP 错误: %s" % err)
            return
    except Exception as e:
        print("MCP 连接失败: %s" % e)
        return

    if args.list:
        print("搜索聊天...")
        try:
            result = rpc(url, token, "tavo_chat_search", {"query": "", "limit": 20})
            items = result.get("items", []) if isinstance(result, dict) else []
            if not items:
                print("  （无结果）")
            for c in items:
                cid = c.get("id") or c.get("chatId")
                print("  [%s] %s" % (cid, c.get("name") or "?"))
        except Exception as e:
            print("  tavo_chat_search 不支持: %s" % e)
        return

    if args.chat_id:
        check_chat(url, token, args.chat_id)
        return

    # 默认：查当前聊天
    if isinstance(curr, dict) and curr:
        chat_id = curr.get("chat", {}).get("id") or curr.get("id")
        if not chat_id:
            print("当前无聊天，请指定: python get_info.py <chat_id>")
            return
        name = curr.get("chat", {}).get("name") or ""
        print("当前聊天: #%s (%s)" % (chat_id, name))
        check_chat(url, token, chat_id)
    else:
        print("当前无聊天，请指定: python get_info.py <chat_id>")


if __name__ == "__main__":
    main()
