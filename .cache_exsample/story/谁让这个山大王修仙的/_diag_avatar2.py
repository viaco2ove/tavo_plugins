#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json, urllib.request, urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))


def load_env():
    env = {}
    for line in open(ENV, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url = env["tavo_mcp_url"].rstrip("/")
    if not url.endswith("/mcp"):
        url += "/mcp"
    return url, env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")


def call(url, token, name, args, timeout=90):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": name, "arguments": args}}).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        res = json.loads(r.read().decode("utf-8"))
    result = res.get("result", {})
    for c in result.get("content", []):
        t = c.get("text")
        if isinstance(t, str):
            try:
                return json.loads(t), result
            except Exception:
                return t, result
    return result, result


def main():
    url, token = load_env()
    # 1) 群聊 6 绑定
    ch, _ = call(url, token, "tavo_chat_get", {"id": 6})
    print("[chat 6]")
    print("  characterIds =", ch.get("characterIds"))
    print("  lorebookIds  =", ch.get("lorebookIds"))
    print("  responseMode =", ch.get("responseMode"))
    print("  name         =", ch.get("name"))

    # 2) 参照角色（应有头像、UI 正常的）格式
    for ref in [3, 4, 5]:
        d, _ = call(url, token, "tavo_character_get", {"id": ref})
        if not isinstance(d, dict):
            print(f"\n[ref {ref}] 非 dict: {d}")
            continue
        dd = d.get("data", d)
        av = dd.get("avatar")
        print(f"\n[ref {ref}] name={d.get('name') or dd.get('name')}")
        print(f"   avatar {'有' if av else '空'} len={len(av) if isinstance(av,str) else 0}")
        if isinstance(av, str):
            print(f"   avatar 前缀 = {av[:60]}")
        print(f"   data 顶层键 = {list(dd.keys())[:20]}")
        # 顶层是否也有 avatar
        if "avatar" in d and d.get("avatar") is not None:
            print(f"   顶层 avatar 也有 (len={len(d['avatar'])})")


if __name__ == "__main__":
    main()
