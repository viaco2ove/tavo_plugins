#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_memory_agent.py — 离线验证「记忆管理器」核心逻辑（对齐 entry.js 的 runMemoryAgent）。

它从已安装的插件 entry.js 抽取真实的 MEMORY_RULES 提示词，读取目标聊天的真实角色卡
(tmm_story_static) / 故事配置 (tf_story.edit) / 最近对话，组装与插件完全一致的 prompt，
调用 tavo_generate，解析 LLM 返回的 JSON，并写回 tmm 变量；最后报告是否生成了
role_key_information（【当前行为】）等关键字段。

用途：在能跑 LLM 的实例（手机 chat 8，或本地有 API 的 chat）上验证记忆生成确实生效。

用法:
  # 默认连 .env 的 simulator，自动找「山大王」聊天，跑一轮普通刷新
  python test_memory_agent.py

  # 指定连接 + 聊天 + 直接指令（等价于 @记忆管理 xxx）
  python test_memory_agent.py --url http://192.168.1.23:7347/mcp --token 3ts67a \
      --chat-id 8 --directive "我到达了宗门"

  # 只生成并打印结果，不写回 tmm（dry-run）
  python test_memory_agent.py --dry
"""
import os, re, sys, json, argparse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ENTRY = os.path.join(ROOT, "plugins", "toonflow_story_memory_manager", "entry.js")


def load_env_file(path):
    env = {}
    if not os.path.isfile(path): return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_rules():
    src = open(ENTRY, encoding="utf-8").read()
    m = re.search(r"const MEMORY_RULES = `(.*?)`;", src, re.S)
    if not m:
        raise RuntimeError("未能从 entry.js 抽取 MEMORY_RULES")
    return m.group(1)


class MCP:
    def __init__(self, url, token):
        self.url = url.rstrip("/"); self.token = token
    def call(self, name, args=None, timeout=180):
        payload = {"jsonrpc":"2.0","id":1,"method":"tools/call",
                   "params":{"name":name,"arguments":args or {}}}
        data = json.dumps(payload).encode()
        req = urllib.request.Request(self.url, data=data,
            headers={"Content-Type":"application/json","Authorization":"Bearer "+self.token}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read().decode())
        except urllib.error.URLError as e:
            raise RuntimeError("MCP 连接失败: %s" % e)
        if "error" in body and body["error"]:
            raise RuntimeError("MCP error: %s" % json.dumps(body["error"], ensure_ascii=False))
        return body.get("result", {})
    def text(self, res):
        for c in (res or {}).get("content", []):
            if isinstance(c, dict) and c.get("type") == "text":
                return c["text"]
        return ""
    def getvar(self, chat_id, name):
        res = self.call("tavo_variable_get", {"chatId": chat_id, "scope":"chat", "name":name})
        t = self.text(res)
        try: return json.loads(t)
        except Exception: return None
    def setvar(self, chat_id, name, value):
        return self.call("tavo_variable_set",
                         {"chatId": chat_id, "scope":"chat", "name":name, "value":value})
    def find_chat(self):
        for q in ["谁让这个山大王修仙的", "山大王", "谁让这个"]:
            res = self.call("tavo_chat_search", {"query": q, "limit": 10})
            try:
                obj = json.loads(self.text(res))
                items = obj.get("items") or obj.get("chats") or []
                if items:
                    return items[0].get("id")
            except Exception:
                pass
        return None


def unwrap(v):
    """对齐 entry.js 的 readChatVar：tavo 返回 {found,value}，多层解包。"""
    guard = 0
    while isinstance(v, dict) and "value" in v and "name" in v and guard < 5:
        if v.get("found") is False: return None
        v = v["value"]; guard += 1
    if isinstance(v, str) and v[:1] in "{[":
        try: return json.loads(v)
        except Exception: return v
    return v


def build_character_card_list(story):
    chars = (story or {}).get("characters", []) if isinstance(story, dict) else []
    if not chars: return "（无角色参数卡）"
    out = []
    for ch in chars:
        c = ch.get("card", {}) or {}
        parts = ["name: " + str(ch.get("name","?")), "role_type: " + str(ch.get("roleType","npc"))]
        for k in ["level","level_desc","hp","mp","gender","age"]:
            if c.get(k) not in (None,""): parts.append("%s: %s" % (k, c[k]))
        for k in ["raw_setting","personality","appearance","skills","items","equipment","other"]:
            val = c.get(k)
            if val:
                parts.append("%s: %s" % (k, "、".join(val) if isinstance(val,list) else val))
        if c.get("role_key_information"):
            parts.append("role_key_information(关键信息/当前行为): " + str(c["role_key_information"]))
        out.append("{ " + "; ".join(parts) + " }")
    return "\n".join(out)


def get_global_background(mcp, chat_id):
    edit = unwrap(mcp.getvar(chat_id, "tf_story.edit")) or {}
    bg = (edit.get("globalBackground") or "").strip()
    return bg or "（无）"


def get_event_state(mcp, chat_id):
    edit = unwrap(mcp.getvar(chat_id, "tf_story.edit")) or {}
    chapters = edit.get("chapters", []) or []
    prog = unwrap(mcp.getvar(chat_id, "tf_progress")) or {}
    idx = prog.get("currentChapterIndex", 0) if isinstance(prog, dict) else 0
    ch = chapters[idx] if idx < len(chapters) else None
    if not ch:
        return "（自由模式，无进行中章节）"
    s = "【当前章节】" + str(ch.get("title","")) + "\n"
    if ch.get("content"): s += str(ch["content"])[:1200] + "\n"
    if ch.get("successCondition"): s += "【本章完成条件】" + str(ch["successCondition"]) + "\n"
    return s


def get_recent_dialogue(mcp, chat_id, window=12):
    res = mcp.call("tavo_message_find", {"chatId": chat_id, "indexRange":[-window,-1]})
    t = mcp.text(res)
    try: obj = json.loads(t)
    except Exception: return []
    msgs = obj.get("items") if isinstance(obj, dict) else obj
    if not isinstance(msgs, list): return []
    out = []
    for m in msgs:
        if not isinstance(m, dict): continue
        role = m.get("speakerName") or ("用户" if m.get("role")=="user" else "NPC")
        out.append({"role":role, "content":(m.get("content") or "")[:400]})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url")
    ap.add_argument("--token")
    ap.add_argument("--chat-id", type=int)
    ap.add_argument("--directive", help="直接指令，等价于 @记忆管理 xxx")
    ap.add_argument("--window", type=int, default=12)
    ap.add_argument("--dry", action="store_true", help="只生成+打印，不写回 tmm")
    args = ap.parse_args()

    env = load_env_file(os.path.join(ROOT, ".env"))
    url = args.url or env.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少连接配置：--url/--token 或 .env 的 tavo_mcp_url/tavo_mcp_toekn")

    mcp = MCP(url, token)
    chat_id = args.chat_id
    if not chat_id:
        chat_id = mcp.find_chat()
    if not chat_id:
        sys.exit("找不到目标聊天，请用 --chat-id 指定")
    print("TARGET chat_id =", chat_id)

    rules = get_rules()
    print("MEMORY_RULES 长度:", len(rules))

    story = unwrap(mcp.getvar(chat_id, "tmm_story_static")) or unwrap(mcp.getvar(chat_id, "tmm_story"))
    if not story:
        print("[!] 目标聊天的 tmm_story_static / tmm_story 为空 —— 记忆管理器从未在该聊天构建角色卡。")
        print("    请先在手机上打开该故事聊天（触发 chat:opened 构建静态卡）后再测。")
        # 仍继续：用空角色列表跑，验证提示词本身可用
    card_list = build_character_card_list(story)
    global_bg = get_global_background(mcp, chat_id)
    event_state = get_event_state(mcp, chat_id)
    dialogue = get_recent_dialogue(mcp, chat_id, args.window)

    tmm = unwrap(mcp.getvar(chat_id, "tmm")) or {}
    prompt = ""
    prompt += "【历史记忆】\n"
    prompt += "摘要: " + (tmm.get("summary") or "（尚无）") + "\n"
    prompt += "事实: " + "; ".join(tmm.get("facts",[]) or []) + "\n"
    prompt += "标签: " + ", ".join(tmm.get("tags",[]) or []) + "\n"
    prompt += "动态全局背景: " + (tmm.get("dynamic_world_global_background") or "（尚无）") + "\n\n"
    prompt += "【全局原始背景】\n" + global_bg + "\n\n"
    prompt += "【当前事件状态】\n" + event_state + "\n\n"
    prompt += "【新增对话(JSON数组)】\n" + json.dumps(dialogue, ensure_ascii=False) + "\n\n"
    prompt += "【角色动态参数卡列表(JSON数组)】\n" + card_list + "\n\n"
    if args.directive:
        prompt += "\n【用户直接指令】\n" + args.directive + "\n（按「@记忆管理 特殊指令优先级规则」处理：直接同步更新对应角色卡与记忆，无需等待NPC/旁白回应）\n"
    prompt += "\n请基于以上上下文，输出唯一的 JSON 记忆更新结果。"

    full = rules + "\n\n" + prompt
    print("FULL prompt 长度:", len(full))
    print("角色卡列表预览:\n  " + card_list.replace("\n","\n  ")[:500])

    # 注意：MCP 的 tavo_generate 不接受 settings/context 字段（仅 chatId+prompt），
    # 而插件内 tavo.generate 的 in-app SDK 调用可以。测试走 MCP，故此处只传 chatId+prompt。
    res = mcp.call("tavo_generate", {"chatId": chat_id, "prompt": full})
    gen = mcp.text(res)
    if not gen:
        print("[!] 生成返回空。请确认该聊天已绑定可用 LLM API。raw:", json.dumps(res)[:300])
        sys.exit(1)
    print("\n=== RAW GENERATE (前 1800) ===\n" + gen[:1800])

    jm = re.search(r"\{[\s\S]*\}", gen)
    parsed = None
    if jm:
        try: parsed = json.loads(jm.group(0))
        except Exception as e: print("parse err:", e)
    if not parsed:
        print("[!] 未能解析出 JSON，记忆未更新")
        sys.exit(1)

    print("\n=== PARSED ===")
    print("summary:", (parsed.get("summary") or "")[:150])
    print("facts:", parsed.get("facts"))
    print("player_card_patch:", parsed.get("player_card_patch"))
    print("npc_card_patches:", parsed.get("npc_card_patches"))
    print("dynamic_world_global_background:", (parsed.get("dynamic_world_global_background") or "")[:120])

    # 校验：是否生成了 role_key_information / 【当前行为】
    ok = False
    for nm, patch in (parsed.get("npc_card_patches") or {}).items():
        rki = (patch or {}).get("role_key_information") or ""
        if "【当前行为】" in rki:
            ok = True
            print("  ✓ NPC[%s] 当前行为: %s" % (nm, rki[:60]))
    pp = parsed.get("player_card_patch") or {}
    if "【当前行为】" in (pp.get("role_key_information") or ""):
        ok = True
        print("  ✓ player 当前行为:", (pp.get("role_key_information") or "")[:60])
    print("\nKEYINFO_GENERATED:", ok)

    if args.dry or not ok:
        print("(dry / 未达标，未写回 tmm)")
        return

    # 写回 tmm（对齐 entry.js runMemoryAgent 的合并逻辑）
    state = tmm if isinstance(tmm, dict) else {}
    if parsed.get("summary"): state["summary"] = parsed["summary"][:800]
    if isinstance(parsed.get("facts"), list):
        state["facts"] = list(dict.fromkeys((state.get("facts") or []) + parsed["facts"]))[-12:]
    if isinstance(parsed.get("tags"), list):
        state["tags"] = list(dict.fromkeys((state.get("tags") or []) + parsed["tags"]))[-8:]
    if parsed.get("player_card_patch"):
        state.setdefault("cards", {}).setdefault("player", {}).update(parsed["player_card_patch"])
    if parsed.get("npc_card_patches"):
        npcs = state.setdefault("cards", {}).setdefault("npcs", {})
        for nm, patch in parsed["npc_card_patches"].items():
            if patch: npcs[nm] = {**npcs.get(nm, {}), **patch}
    if parsed.get("dynamic_world_global_background"):
        state["dynamic_world_global_background"] = parsed["dynamic_world_global_background"]
    state["updatedAt"] = 0
    mcp.setvar(chat_id, "tmm", state)
    print("\n[✓] 已写回 tmm（chatId=%s）" % chat_id)


if __name__ == "__main__":
    main()
