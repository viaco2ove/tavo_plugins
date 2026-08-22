#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断：dump 关键变量与角色描述，确认序列化形态。"""
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
url = (env.get("tavo_mcp_url") or "").rstrip("/")
token = env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")

def rpc(method, args, timeout=60):
    if method == "tavo_variable_set":
        print(f"  [tavo_variable_set] args:{args.get('scope')} {args.get('name')}")
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": args}}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
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

def show_var_chat(name, chat_id):
    print("="*60)
    print("VARIABLE:", name, "(chatId=%s)" % chat_id)
    res = rpc("tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": name})
    t = text(res)
    print("  raw text type:", type(t).__name__, "len", len(t))
    try:
        obj = json.loads(t)
        print("  parsed JSON; top-level type:", type(obj).__name__)
        if isinstance(obj, dict):
            print("  keys:", list(obj.keys())[:20])
            print("  found:", obj.get("found"))
            val = obj.get("value")
            print("  value type:", type(val).__name__)
            if isinstance(val, dict):
                print("  value keys:", list(val.keys())[:20])
                if "chapters" in val:
                    print("  value.chapters count:", len(val["chapters"]))
                    for i, ch in enumerate(val["chapters"][:5]):
                        print("    ch%d title=%s bg=%s" % (i, ch.get("title"), (ch.get("background") or "")[:40]))
                if "lineCount" in val:
                    print("  value.lineCount:", val.get("lineCount"))
                if "orchestration" in val:
                    print("  value.orchestration:", val.get("orchestration"))
            else:
                print("  value (not dict):", repr(val)[:200])
    except Exception as e:
        print("  not JSON:", repr(t[:200]), "| err:", e)

def show_var(name):
    print("="*60)
    print("VARIABLE (no chatId):", name)
    res = rpc("tavo_variable_get", {"scope": "chat", "name": name})
    t = text(res)
    print("  len", len(t), "head:", repr(t[:120]))

def find_chat():
    print("="*60)
    print("CHAT SEARCH (exact full name):")
    names = ["谁让这个山大王修仙的！ · 第1章", "谁让这个山大王修仙的"]
    for nm in names:
        res = rpc("tavo_chat_search", {"query": nm, "match": "exact", "limit": 10})
        t = text(res)
        try:
            obj = json.loads(t)
            items = obj.get("items", []) if isinstance(obj, dict) else []
            if items:
                print("  matched name:", nm, "-> items:", [it.get("id") for it in items])
                return items[0].get("id")
        except Exception as e:
            print("  parse err for", nm, e)
    # 兜底：列出所有 chat
    print("  fallback: tavo_chat_list")
    res = rpc("tavo_chat_list", {})
    t = text(res)
    print("  list raw:", t[:500])
    try:
        obj = json.loads(t)
        items = obj.get("items", []) if isinstance(obj, dict) else []
        for it in items:
            print("  chat:", it.get("id"), it.get("name"))
        if items:
            return items[0].get("id")
    except Exception as e:
        print("  list parse err:", e)
    return None

def show_char(cid, idx=0):
    print("="*60)
    print("CHARACTER[0] of chat:")
    res = rpc("tavo_chat_get", {"id": cid})
    t = text(res)
    try:
        obj = json.loads(t)
        chars = obj.get("characterIds", [])
        if not chars:
            print("  no characters in chat")
            return
        print("  total chars:", len(chars))
        cid0 = chars[0]
        r2 = rpc("tavo_character_get", {"id": cid0})
        t2 = text(r2)
        obj2 = json.loads(t2)
        d = obj2.get("data", obj2)
        desc = d.get("description", "")
        print("  char0 name:", d.get("name"))
        print("  char0 roleType:", d.get("roleType"))
        print("  desc len:", len(desc))
        print("  desc head:", repr(desc[:120]))
        print("  has 角色参数卡:", "角色参数卡" in desc)
        print("  has **性别**:", "**性别**" in desc)
    except Exception as e:
        print("  parse err:", e, repr(t[:200]))

if __name__ == "__main__":
    cid = find_chat()
    if cid:
        show_var_chat("tf_story.edit", cid)
        show_var_chat("tmm_story_static", cid)
        show_var_chat("tmm_story", cid)
        show_char(cid)

