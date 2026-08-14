#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, urllib.request

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


def rpc(url, token, method, params):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    url, token = load_env()
    # 需要 initialize 才能 tools/list 吗？先试直接 list
    try:
        out = rpc(url, token, "tools/list", {})
    except Exception as e:
        print("tools/list 直连失败:", e)
        # 试 initialize
        init = rpc(url, token, "initialize", {"protocolVersion": "2024-11-05",
                                              "capabilities": {}, "clientInfo": {"name": "probe", "version": "1"}})
        print("initialize:", init)
        out = rpc(url, token, "tools/list", {})
    tools = out.get("result", {}).get("tools", [])
    want = ["tavo_character_import_card", "tavo_character_update", "tavo_character_create",
            "tavo_file_save", "tavo_file_load", "tavo_character_get"]
    for t in tools:
        if t.get("name") in want:
            print("\n==== ", t["name"], " ====")
            print(json.dumps(t.get("inputSchema", {}), ensure_ascii=False, indent=2)[:2500])


if __name__ == "__main__":
    main()
