#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断：实测 tavo 上角色卡头像是否真落库（纯 stdlib，无 requests/PIL 依赖）。"""
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
    token = env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    return url, token


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
    out = None
    for c in result.get("content", []):
        t = c.get("text")
        if isinstance(t, str):
            try:
                out = json.loads(t)
            except Exception:
                out = t
            break
    return out, result


def main():
    url, token = load_env()
    print(f"[env] url={url} token={'set' if token else 'MISSING'}")

    # 1) 连通性 + 现有角色清单
    try:
        data, _ = call(url, token, "tavo_character_search", {"query": ""})
    except urllib.error.URLError as e:
        print(f"[FAIL] MCP 不可达: {e}")
        sys.exit(2)
    except Exception as e:
        print(f"[FAIL] search 异常: {e}")
        sys.exit(3)

    items = (data or {}).get("items", []) if isinstance(data, dict) else []
    print(f"[search] 返回 {len(items)} 个角色")
    for it in items:
        print(f"   id={it.get('id')}  name={it.get('name')}  keys={list(it.keys())}")

    # 2) 逐个查 data.avatar（覆盖已知区间 7..31）
    print("\n[avatar 实测]")
    for cid in list(range(7, 32)):
        try:
            d, _ = call(url, token, "tavo_character_get", {"id": cid})
        except Exception as e:
            print(f"   id={cid}: 获取失败 {str(e)[:60]}")
            continue
        if not isinstance(d, dict):
            print(f"   id={cid}: 非 dict 返回 -> {str(d)[:60]}")
            continue
        dd = d.get("data", d)
        av = dd.get("avatar")
        name = dd.get("name") or d.get("name")
        sz = len(av) if isinstance(av, str) else 0
        print(f"   id={cid} {name}: avatar={'有' if av else '空'} (len={sz})")


if __name__ == "__main__":
    main()
