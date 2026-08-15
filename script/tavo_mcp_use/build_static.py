#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预建 tmm_story_static：把当前群聊角色描述解析成参数卡写入 chat 变量。
作为面板参数卡的兜底来源（即使 webview character.get 拿不到描述也能显示参数）。
解析逻辑对齐 memory_manager/entry.js 的 normalizeCard。"""
import os, json, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

def load_env(path):
    env = {}
    if not os.path.isfile(path):
        return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env(os.path.join(ROOT, ".env"))
URL = (env.get("tavo_mcp_url") or "").rstrip("/")
TOKEN = env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
CHAT_ID = "2"

def rpc(method, args, timeout=60):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": args}}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(URL, data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode("utf-8"))
    if "error" in body:
        return {"__error__": body["error"]}
    return body.get("result", {})

def text(res):
    for c in (res or {}).get("content", []):
        if isinstance(c, dict) and c.get("type") == "text":
            return c["text"]
    return ""

def get_obj(method, args):
    t = text(rpc(method, args))
    try:
        obj = json.loads(t)
        return obj.get("data", obj) if isinstance(obj, dict) else {}
    except Exception:
        return {}

def scalar(v):
    t = "" if v is None else str(v)
    t = t.strip()
    return "" if t in ("null", "undefined") else t

import re
def num_or(v, fb):
    n = re.search(r"-?\d+", scalar(v))
    return int(n.group()) if n else fb

# 中文标签 -> 英文 key
ZH = {"性别":"gender","年龄":"age","等级":"level","等级称号":"level_desc","经验值":"exp",
      "下一级所需经验":"next_level_exp","性格":"personality","外貌":"appearance","音色":"voice",
      "音色特点":"voice","技能":"skills","物品":"items","装备":"equipment","血量":"hp","蓝量":"mp",
      "金钱":"money","货币":"money","当前行为":"role_key_information","关键信息":"role_key_information",
      "角色关键信息":"role_key_information","其他":"other","原设定":"raw_setting","角色名":"name"}

def parse_fields(desc):
    fm = {}
    for line in scalar(desc).split("\n"):
        m = re.match(r"^\s*\*\*([^*]+?)\*\*\s*[:：]\s*(.+?)\s*$", line)
        if m:
            fm[m.group(1).strip().lower()] = m.group(2).strip()
    return fm

def detect_role_type(desc, hint):
    rt = scalar(hint)
    if rt == "旁白":
        return "narrator"
    if rt in ("npc","narrator","player","system","general"):
        return rt
    if re.search(r"角色类型\s*[:：]\s*万能角色", desc): return "general"
    if re.search(r"角色类型\s*[:：]\s*系统角色", desc): return "system"
    if re.search(r"角色类型\s*[:：]\s*旁白|系统旁白|系统叙事者?", desc): return "narrator"
    return "npc"

def build_card(name, desc, avatar="", role_type_hint=""):
    fm = parse_fields(desc)
    def read_zh(*labels):
        for lb in labels:
            v = fm.get(lb.lower())
            if v: return v
        return ""
    d = scalar(desc)
    role_type = detect_role_type(d, role_type_hint)
    age = num_or(fm.get("年龄"), None)
    level = num_or(fm.get("等级"), None)
    level_desc = read_zh("level_desc","等级称号")
    if level is None:
        m = re.search(r"炼气\s*(\d+)\s*层", d)
        if m: level = int(m.group(1))
        else:
            m2 = re.search(r"(\d+)\s*级", d)
            if m2: level = int(m2.group(1))
    if not level_desc:
        m = re.search(r"炼气\s*\d+\s*层", d)
        if m: level_desc = m.group(0)
    hp = num_or(fm.get("血量"), None)
    mp = num_or(fm.get("蓝量"), None)
    money = num_or(fm.get("金钱"), None)
    gender = read_zh("gender","性别")
    if not gender:
        if "男" in d: gender = "男"
        elif "女" in d: gender = "女"
    def lst(k):
        v = fm.get(k.lower())
        if not v: return []
        return [x.strip() for x in re.split(r"[；;、,，]", v) if x.strip()][:24]
    return {
        "name": name,
        "raw_setting": d[:1200],
        "gender": gender,
        "age": age,
        "level": level if level is not None else 1,
        "level_desc": level_desc,
        "personality": read_zh("personality"),
        "appearance": read_zh("appearance"),
        "voice": read_zh("voice"),
        "skills": lst("skills"),
        "items": lst("items"),
        "equipment": lst("equipment"),
        "hp": hp if hp is not None else 100,
        "mp": mp if mp is not None else 0,
        "money": money if money is not None else 0,
        "exp": num_or(fm.get("经验值"), 0),
        "next_level_exp": num_or(fm.get("下一级所需经验"), 0),
        "role_key_information": read_zh("role_key_information"),
        "other": [],
        "roleType": role_type,
    }

# 角色 id 列表（来自 dry 输出）：玩家 persona=2，NPC 25..36（MCP 要求整数 id）
PERSONA_ID = 2
CHAR_IDS = [25,26,27,28,29,30,31,32,33,34,35,36]
CHAT_ID = 2  # 群聊 id 必须是整型，字符串 "2" 会被当成不同作用域导致写入丢失

def main():
    characters = []
    # 玩家
    pf = get_obj("tavo_persona_get", {"id": PERSONA_ID})
    pname = pf.get("name") or "用户"
    pcard = build_card(pname, pf.get("description",""), pf.get("avatar",""), "player")
    pcard["roleType"] = "player"
    characters.append({"id": PERSONA_ID, "name": pname, "roleType": "player",
                       "avatar": pf.get("avatar",""), "card": pcard})
    # NPC
    for cid in CHAR_IDS:
        c = get_obj("tavo_character_get", {"id": int(cid)})
        if not c:
            print("  skip char", cid)
            continue
        name = c.get("name") or "未命名"
        card = build_card(name, c.get("description",""), c.get("avatar",""), c.get("roleType",""))
        characters.append({"id": cid, "name": name, "roleType": card["roleType"],
                           "avatar": c.get("avatar",""), "card": card})
        print("  built %s (%s) lv=%s hp=%s mp=%s" % (name, card["roleType"], card["level"], card["hp"], card["mp"]))

    static = {"name": "谁让这个山大王修仙的！ · 第1章", "synopsis": "", "characters": characters}
    # 写变量（chatId 必须整型）
    rpc("tavo_variable_set", {"scope":"chat","chatId":int(CHAT_ID),"name":"tmm_story_static","value":static})
    # 写后回填校验：确认 found=true
    chk = rpc("tavo_variable_get", {"scope":"chat","chatId":int(CHAT_ID),"name":"tmm_story_static"})
    chk_text = text(chk)
    try:
        found = json.loads(chk_text).get("found")
    except Exception:
        found = None
    print("  tmm_story_static written: found=%s | chars=%d" % (found, len(characters)))

if __name__ == "__main__":
    main()
