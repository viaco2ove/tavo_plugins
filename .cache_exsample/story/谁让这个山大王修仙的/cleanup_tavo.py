# -*- coding: utf-8 -*-
"""
cleanup_tavo.py — tavo 侧污染修复脚本

用途：
1. 关闭 toonflow_story_event_manager 插件（这是制造「场景切换至XXX」自动消息、
   「进入章节」toast、「故事进度」浮窗的元凶）
2. 批量删除已被该插件硬插入的「场景切换至 XXX」「进入章节『XXX』」等垃圾消息
3. 可选：给 12 个角色补 avatar（用 --avatar-dir 指定本地图片目录）

前置：tavo 桌面端 MCP Server 已开启（设置 → MCP Server → 启用）
      .env 的 tavo_mcp_url / tavo_mcp_toekn 已配置

用法：
    python cleanup_tavo.py                       # 关插件 + 删垃圾消息
    python cleanup_tavo.py --dry                 # 预演，不实际修改
    python cleanup_tavo.py --avatar-dir <PATH>   # 额外按角色名补头像
"""
import os, sys, json, argparse, requests
from pathlib import Path

PLUGIN_ID = "com.toonflow.story-event-manager"
JUNK_PATTERNS = ("场景切换至", "进入章节")  # 用来识别被硬插的消息
ROLE_NAMES = [
    "纯小白", "红缥缈", "白锦儿", "李玄风", "陆青山", "云火月",
    "林月", "琳琅", "冷素心", "苍山道人", "某女子", "某男子",
]

BASE = os.path.dirname(os.path.abspath(__file__))
# cleanup_tavo.py 在 tavo_plugins/.cache/story/谁让这个山大王修仙的/，上溯 3 层到 tavo_plugins
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))


def load_env():
    cfg = {}
    for line in open(ENV, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    url = cfg.get("tavo_mcp_url")
    token = cfg.get("tavo_mcp_toekn") or cfg.get("tavo_mcp_token")
    if not url or not token:
        sys.exit(f".env 缺少 tavo_mcp_url / tavo_mcp_toekn：{list(cfg.keys())}")
    url = url.rstrip("/")
    if not url.endswith("/mcp"):
        url = url + "/mcp"
    return url, token


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry", action="store_true", help="预演，不实际修改")
    p.add_argument("--avatar-dir", help="本地头像目录，按 <角色名>.png|.jpg|.webp 匹配")
    p.add_argument("--chat-id", type=int, default=6, help="要清理的群聊 id（默认 6）")
    return p.parse_args()


def call(url, headers, name, args):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": name, "arguments": args}}
    r = requests.post(url, json=body, headers=headers, timeout=60)
    r.raise_for_status()
    res = r.json().get("result", {})
    # 解析 content[].text 中的 JSON 字符串
    if isinstance(res, dict) and "content" in res:
        for c in res["content"]:
            t = c.get("text")
            if isinstance(t, str):
                try:
                    return json.loads(t)
                except Exception:
                    pass
    return res


def step_disable_plugin(url, h, dry):
    print(f"\n[1/3] 关闭插件 {PLUGIN_ID}")
    cur = call(url, h, "tavo_plugin_get", {"pluginId": PLUGIN_ID})
    if not cur or not isinstance(cur, dict) or not cur.get("pluginId"):
        print(f"  ⚠️ 读不到插件 {PLUGIN_ID}（可能未安装），跳过")
        return False
    print(f"  当前 name={cur.get('name')} enabled={cur.get('enabled')} version={cur.get('version')}")
    if dry:
        print(f"  [dry] 跳过 set_enabled + set_config")
        return True
    # 一键禁用（最干净）
    r = call(url, h, "tavo_plugin_set_enabled",
             {"pluginId": PLUGIN_ID, "enabled": False})
    print(f"  ✓ set_enabled=false  →  {str(r)[:80]}")
    # 同时把自动推进/浮窗关掉（保险起见）
    for key, val in [("autoAdvance", False), ("showPanel", False)]:
        try:
            r = call(url, h, "tavo_plugin_set_config",
                     {"pluginId": PLUGIN_ID, "key": key, "value": val})
            print(f"  ✓ set {key}={val}  →  {str(r)[:60]}")
        except Exception as e:
            print(f"  ⚠️ set {key} 失败: {e}")
    return True


def step_delete_junk_messages(url, h, chat_id, dry):
    print(f"\n[2/3] 删除群聊 {chat_id} 中的垃圾消息")
    deleted_total = 0
    # 用 message_find.filter.query 精准查两种垃圾模式
    for pattern in JUNK_PATTERNS:
        msgs = call(url, h, "tavo_message_find",
                    {"chatId": chat_id, "filter": {"query": pattern}})
        if isinstance(msgs, dict):
            items = msgs.get("items") or msgs.get("messages") or []
        else:
            items = msgs or []
        # 二次过滤（query 是子串，包含原文括号/标点）
        items = [m for m in items if pattern in (m.get("content") or "")]
        print(f"  模式「{pattern}」命中: {len(items)}")
        if not items:
            continue
        if dry:
            for m in items[:3]:
                print(f"    [dry] 将删 id={m.get('id')} content={(m.get('content','') or '')[:50]}")
            deleted_total += len(items)
            continue
        for m in items:
            mid = m.get("id") or m.get("messageId")
            if not mid:
                continue
            try:
                call(url, h, "tavo_message_delete", {"chatId": chat_id, "id": mid})
                deleted_total += 1
            except Exception as e:
                print(f"    ✗ 删失败 id={mid}: {e}")
    print(f"  ✓ 共处理 {deleted_total} 条")
    return deleted_total


def step_set_avatars(url, h, avatar_dir, dry):
    print(f"\n[3/3] 给 12 个角色补 avatar（目录: {avatar_dir}）")
    if not avatar_dir:
        print("  未指定 --avatar-dir，跳过")
        return 0
    ap = Path(avatar_dir)
    if not ap.is_dir():
        print(f"  ✗ 目录不存在：{ap}")
        return 0
    found = 0
    for name in ROLE_NAMES:
        img = None
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            cand = ap / f"{name}{ext}"
            if cand.exists():
                img = cand; break
        if not img:
            print(f"  - {name}: 未找到本地头像，跳过")
            continue
        # 上传文件到 tavo 文件存储，返回 uri
        if dry:
            print(f"  [dry] {name}: 将上传 {img.name} 并写入 character avatar")
            found += 1; continue
        try:
            with open(img, "rb") as f:
                b64 = __import__("base64").b64encode(f.read()).decode("ascii")
            saved = call(url, h, "tavo_file_save",
                         {"scope": "global", "name": f"avatar_{name}", "contentBase64": b64,
                          "mimeType": "image/" + img.suffix.lstrip(".").replace("jpg", "jpeg")})
            uri = saved.get("uri") or saved.get("id") or saved.get("url")
            if not uri:
                print(f"  ✗ {name}: 文件保存返回无 uri：{str(saved)[:120]}")
                continue
            # 找到角色 id 并 update
            r = call(url, h, "tavo_character_search", {"query": name, "match": "exact", "limit": 1})
            cid = (r.get("items") or [{}])[0].get("id")
            if not cid:
                print(f"  ✗ {name}: 找不到角色 id")
                continue
            call(url, h, "tavo_character_update",
                 {"id": cid, "character": {"name": name, "avatar": uri}})
            print(f"  ✓ {name} → id={cid}, avatar={str(uri)[:60]}")
            found += 1
        except Exception as e:
            print(f"  ✗ {name}: {type(e).__name__}: {e}")
    print(f"  共补 {found} 个角色头像")
    return found


def main():
    args = parse_args()
    url, token = load_env()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    print(f"MCP: {url}")
    print(f"模式: {'DRY-RUN' if args.dry else '实际执行'}")

    # 先 tools/list 探活
    r = requests.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                      headers=h, timeout=15)
    r.raise_for_status()
    print(f"连通 OK，工具数 {len(r.json()['result']['tools'])}\n")

    step_disable_plugin(url, h, args.dry)
    step_delete_junk_messages(url, h, args.chat_id, args.dry)
    step_set_avatars(url, h, args.avatar_dir, args.dry)

    print("\n✅ 完成")


if __name__ == "__main__":
    main()