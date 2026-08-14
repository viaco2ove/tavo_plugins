#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 tavo 的 12 个角色补头像（v2，正确机制）。

已实测确认的机制（见 md 日志）：
- `tavo_character_update` 任何形式都不持久化 `avatar`（update 只同步文本字段）。
- `tavo_character_import_card` 是唯一能存头像的路径，且为「整卡替换」：
  必须传「完整 data 对象 + avatar」，否则会丢性格/对白等字段。
- 但它按 name 新建而非覆盖，故流程 = 导入新卡 → 重绑群聊 → 删旧卡。

步骤：
  for cid 7..18: get(data) → 压缩头像 → import_card({card: data+avatar}) → 新 id
  重绑 chat(6).characterIds = [新 ids]
  删旧 ids 7..18（及探测误建的 19）

用法：
  python upload_avatars_v2.py            # 正式执行
  python upload_avatars_v2.py --dry      # 仅压缩+import dryRun 预览，不落库、不删
"""
import os, sys, json, base64, io, requests
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))
AV_DIR = os.path.join(BASE, "avatars")
CHAT_ID = 6
TARGET_KB = 250
OLD_IDS = list(range(7, 19))            # 7..18
STRAY_IDS = [19]                         # 探测时误建
NAME_MAP = {7: "纯小白", 8: "红缥缈", 9: "白锦儿", 10: "李玄风", 11: "陆青山",
            12: "云火月", 13: "林月", 14: "琳琅", 15: "冷素心", 16: "苍山道人",
            17: "某女子", 18: "某男子"}


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


def call(url, h, name, args, timeout=90):
    r = requests.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": name, "arguments": args}},
                      headers=h, timeout=timeout)
    r.raise_for_status()
    res = r.json().get("result", {})
    for c in res.get("content", []):
        t = c.get("text")
        if isinstance(t, str):
            try:
                return json.loads(t)
            except Exception:
                pass
    return res


def compress(path, target_kb):
    img = Image.open(path)
    # 先试 PNG 无损优化
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    if buf.tell() <= target_kb * 1024:
        return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}", buf.tell()
    # 否则转 JPEG 有损
    q = 88
    while q > 25:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=q)
        if buf.tell() <= target_kb * 1024:
            break
        q -= 8
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}", buf.tell()


def main():
    dry = "--dry" in sys.argv
    url, token = load_env()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    mapping = {}        # old -> new
    prepared = {}
    for cid in OLD_IDS:
        name = NAME_MAP[cid]
        p = os.path.join(AV_DIR, name + ".png")
        if not os.path.exists(p):
            print(f"  ⚠️ 缺素材 {name}.png，跳过")
            continue
        dur, sz = compress(p, TARGET_KB)
        prepared[cid] = (name, dur, sz)
        print(f"  压缩 {name}: {sz//1024}KB ({'JPEG' if dur.startswith('data:image/jpeg') else 'PNG'})")

    if dry:
        print("\n[dry] 预览 import 差异（不落库）：")
        for cid, (name, dur, sz) in prepared.items():
            ch = call(url, h, "tavo_character_get", {"id": cid})
            data = dict(ch.get("data", {}))
            data["avatar"] = dur
            res = call(url, h, "tavo_character_import_card", {"card": data, "dryRun": True})
            nid = res.get("id") or res.get("characterId")
            print(f"  {name}: dryRun ok={res.get('ok')} diff有avatar={'avatar' in str(res.get('diff',''))}")
        return

    # 1) 导入新卡（完整 data + avatar）
    for cid, (name, dur, sz) in prepared.items():
        ch = call(url, h, "tavo_character_get", {"id": cid})
        data = dict(ch.get("data", {}))
        data["avatar"] = dur
        res = call(url, h, "tavo_character_import_card", {"card": data})
        nid = res.get("id") or res.get("characterId")
        mapping[cid] = nid
        print(f"  ✓ 导入 {name}: 旧id={cid} → 新id={nid}（{sz//1024}KB）")

    # 2) 验证新卡头像 + 字段保留
    print("\n[校验] 新卡头像与字段：")
    ok = 0
    for cid, nid in mapping.items():
        ch = call(url, h, "tavo_character_get", {"id": nid})
        d = ch.get("data", {})
        has_av = bool(d.get("avatar"))
        keep = bool(d.get("personality") or d.get("first_mes"))
        print(f"  id={nid} {NAME_MAP[cid]}: 头像={'✓' if has_av else '✗'} 字段保留={'✓' if keep else '✗'}")
        ok += 1 if has_av and keep else 0
    print(f"  通过 {ok}/{len(mapping)}")

    # 3) 重绑群聊
    new_ids = [mapping[c] for c in OLD_IDS if c in mapping]
    call(url, h, "tavo_chat_update", {"id": CHAT_ID, "chat": {"characterIds": new_ids}})
    ch = call(url, h, "tavo_chat_get", {"id": CHAT_ID})
    print(f"\n[重绑] chat {CHAT_ID} characterIds = {ch.get('characterIds')}（lorebookIds={ch.get('lorebookIds')}）")

    # 4) 删旧卡（旧 7..18 + 误建 19）
    to_delete = OLD_IDS + STRAY_IDS
    print("\n[清理] 删除旧卡：")
    for cid in to_delete:
        if cid in mapping.values():
            continue
        try:
            call(url, h, "tavo_character_delete", {"id": cid})
            print(f"  ✓ 删 id={cid}")
        except Exception as e:
            print(f"  ✗ 删 id={cid} 失败: {str(e)[:80]}")

    print("\n完成。新角色 id 映射：", mapping)


if __name__ == "__main__":
    main()
