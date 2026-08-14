#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_to_tavo.py
读取 .env 中的 tavo MCP 连接配置，把 tavo_story_payload.json 推送到 tavo：
  1. 每个角色先 tavo_character_search 按名查找，命中复用 id，否则 tavo_character_create
  2. 世界书先 tavo_lorebook_search 查找，命中复用 id，否则 tavo_lorebook_create（Tavo-native entry 形状）
  3. tavo_chat_create 创建群聊，绑定 characterIds + lorebookIds，responseMode=scenario

依赖：pip install requests
用法：
  python push_to_tavo.py --check      仅连通性自检
  python push_to_tavo.py --dry        用 dryRun 预演 create（search 仍真实，chat 因无 id 会跳过绑定校验）
  python push_to_tavo.py              正式推送（带去重，可安全重跑）
"""
import json, os, sys

try:
    import requests
except ImportError:
    sys.exit("缺少依赖，请先运行：pip install requests")

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(os.path.dirname(BASE), "..", "..", ".env"))  # tavo_plugins/.env
PAYLOAD = os.path.join(BASE, "tavo_story_payload.json")
RESULT = os.path.join(BASE, "push_result.json")


def load_env(path):
    cfg = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    return cfg


def normalize_entries(entries):
    """规整为世界书 Tavo-native entry 形状：identifier + content + strategy 必填。"""
    out = []
    for e in entries:
        strategy = e.get("strategy", "keyword")
        if strategy not in ("constant", "keyword"):
            strategy = "keyword"
        ne = {
            "name": e.get("name", ""),
            "content": e.get("content", ""),
            "strategy": strategy,
            "identifier": e.get("name", "") or f"entry_{len(out)}",
            "enabled": bool(e.get("enabled", True)),
        }
        if e.get("keywords"):
            ne["keywords"] = e["keywords"]
        if "probability" in e:
            ne["probability"] = max(0, min(100, int(e["probability"])))
        if e.get("comment"):
            ne["comment"] = e["comment"]
        out.append(ne)
    return out


def parse_result(res):
    """从 tools/call 返回里取出内层 JSON（content[].text 可能是 JSON 字符串）。"""
    if isinstance(res, dict):
        for c in res.get("content", []) or []:
            t = c.get("text") if isinstance(c, dict) else None
            if t and isinstance(t, str):
                try:
                    return json.loads(t)
                except Exception:
                    pass
    return res


def extract_id(inner, candidates):
    if isinstance(inner, dict):
        for k in candidates:
            if inner.get(k):
                return inner[k]
    return None


def main():
    if not os.path.exists(ENV):
        sys.exit(f"找不到 .env: {ENV}")
    cfg = load_env(ENV)
    url = cfg.get("tavo_mcp_url")
    token = cfg.get("tavo_mcp_toekn") or cfg.get("tavo_mcp_token")
    if not url or not token:
        sys.exit(f".env 缺少 tavo_mcp_url / tavo_mcp_toekn：{list(cfg.keys())}")
    url = url.rstrip("/")
    if not url.endswith("/mcp"):
        url = url + "/mcp"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if "--check" in sys.argv:
        try:
            r = requests.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                               headers=headers, timeout=15)
            print(f"✅ 连通! HTTP {r.status_code}, 工具数: {len(r.json().get('result', {}).get('tools', []))}")
        except Exception as e:
            print(f"❌ 无法连接 {url}: {type(e).__name__}: {str(e)[:200]}")
            sys.exit(1)
        return

    dry = "--dry" in sys.argv
    with open(PAYLOAD, "r", encoding="utf-8") as f:
        payload = json.load(f)

    rid = 1

    def call(method_name, arguments, allow_dry=True):
        args = dict(arguments)
        if dry and allow_dry and "create" in method_name:
            args["dryRun"] = True
        body = {"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                "params": {"name": method_name, "arguments": args}}
        r = requests.post(url, json=body, headers=headers, timeout=90)
        r.raise_for_status()
        res = r.json()
        if "error" in res:
            raise RuntimeError(f"MCP Error: {res['error']}")
        return parse_result(res.get("result", {}))

    print(f"==> {'[DRY-RUN] ' if dry else ''}连接 tavo MCP: {url}")

    # 1. 角色：先 search 复用，否则 create
    character_ids = []
    char_name_map = {}
    for c in payload["characters"]:
        existing = call("tavo_character_search", {"query": c["name"], "match": "exact", "limit": 5}, allow_dry=False)
        items = existing.get("items", []) if isinstance(existing, dict) else []
        cid = items[0].get("id") if items else None
        if cid:
            print(f"  [角色] {c['name']} -> 复用 id={cid}")
        else:
            character = {
                "name": c["name"],
                "description": c.get("description", ""),
                "first_mes": c.get("first_mes", "你好"),
                "personality": c.get("personality", ""),
            }
            if c.get("roleType"):
                character["roleType"] = c["roleType"]
            if c.get("scenario"):
                character["scenario"] = c["scenario"]
            inner = call("tavo_character_create", {"character": character})
            cid = extract_id(inner, ["id", "character_id", "characterId"])
            print(f"  [角色] {c['name']} -> 新建 id={cid}")
        character_ids.append(cid)
        char_name_map[c["name"]] = cid

    # 2. 世界书：先 search 复用，否则 create（Tavo-native entry 形状）
    entries = normalize_entries(payload["worldbook"]["entries"])
    lb_name = payload["worldbook"]["name"]
    existing_lb = call("tavo_lorebook_search", {"query": lb_name, "match": "contains", "limit": 5}, allow_dry=False)
    items = existing_lb.get("items", []) if isinstance(existing_lb, dict) else []
    lorebook_id = items[0].get("id") if items else None
    if lorebook_id:
        print(f"  [世界书] {lb_name} -> 复用 id={lorebook_id}")
    else:
        inner = call("tavo_lorebook_create",
                     {"lorebook": {"name": lb_name,
                                   "description": payload["worldbook"].get("description", ""),
                                   "entries": entries}})
        lorebook_id = extract_id(inner, ["id", "lorebook_id", "lorebookId"])
        print(f"  [世界书] {lb_name} -> 新建 id={lorebook_id} (entries={len(entries)})")

    # 3. 群聊并绑定
    if None in character_ids or not lorebook_id:
        print("⚠️ 存在 null 的 id（dryRun 模式无 id 属正常），跳过 chat 创建。")
    else:
        chat_data = {
            "name": payload["chat_name"],
            "characterIds": character_ids,
            "lorebookIds": [lorebook_id],
            "responseMode": payload.get("response_mode", "scenario"),
        }
        inner = call("tavo_chat_create", {"chat": chat_data})
        chat_id = extract_id(inner, ["id", "chat_id", "chatId"])
        print(f"  [群聊] {payload['chat_name']} -> id={chat_id}")

    if dry:
        print("\n✅ DRY-RUN 完成（create 未落库；search 为真实）。如需正式落库，去掉 --dry 重跑。")
        return

    result = {
        "chat_id": chat_id if 'chat_id' in dir() else None,
        "lorebook_id": lorebook_id,
        "character_ids": character_ids,
        "character_name_map": char_name_map,
    }
    with open(RESULT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 推送完成，结果已写入 {RESULT}")


if __name__ == "__main__":
    main()
