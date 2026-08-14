#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 tavo 的 12 个角色补上传头像。

依据 md/tavo_help/plugin_help/MCP Server.md：
- 角色写入工具支持 裸 CC 兼容 data / CCv2 / CCv3 wrapper / SillyTavern wrapper，
  头像字段在 CCv3 data.avatar（data URI 形式）。
- 文件工具必须传 chatId（即使 global scope）。
- 导入冲突默认报错，可用 conflict:"overwrite" 重试。

策略：
1. 先把 >300KB 的 PNG 压缩到目标大小（避免被体积上限静默丢弃）。
2. 运行时拉 tavo://schemas/character 与 tools/list，确认 avatar 字段真实路径。
3. 优先用 tavo_character_update 写 data.avatar；若验证后仍为空，回退
   tavo_character_import（CCv3 wrapper + conflict:overwrite）。

用法：
  python upload_avatars.py            # 正式上传
  python upload_avatars.py --dry      # 只压缩+打印，不调 MCP
  python upload_avatars.py --max 280  # 自定义压缩目标 KB（默认 280）
"""
import os, sys, json, base64, requests
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))  # tavo_plugins/.env
AV_DIR = os.path.join(BASE, "avatars")
CHAT_ID = 6
NAME_MAP = {  # 角色 id -> 角色名（与 avatars/ 文件名一致）
    7: "纯小白", 8: "红缥缈", 9: "白锦儿", 10: "李玄风", 11: "陆青山",
    12: "云火月", 13: "林月", 14: "琳琅", 15: "冷素心", 16: "苍山道人",
    17: "某女子", 18: "某男子",
}
TARGET_KB = 280


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


def compress_to_datauri(path, target_kb):
    """用 PIL 把 PNG 压缩到约 target_kb KB 以内，返回 data URI。"""
    img = Image.open(path).convert("RGBA")
    q = 95
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    # PNG 无损，先用 optimize；若仍过大则转 JPEG 有损
    if buf.tell() > target_kb * 1024:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=q)
        while buf.tell() > target_kb * 1024 and q > 20:
            q -= 8
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=q)
        mime = "image/jpeg"
    else:
        mime = "image/png"
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:{mime};base64,{b64}", len(buf.getvalue())


def main():
    dry = "--dry" in sys.argv
    for a in sys.argv:
        if a.startswith("--max"):
            global TARGET_KB
            TARGET_KB = int(a.split("=")[1]) if "=" in a else TARGET_KB
    url, token = load_env()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1) 准备压缩后的 data URI
    prepared = {}
    for cid, name in NAME_MAP.items():
        p = os.path.join(AV_DIR, name + ".png")
        if not os.path.exists(p):
            print(f"  ⚠️ 缺素材 {name}.png")
            continue
        dur, sz = compress_to_datauri(p, TARGET_KB)
        prepared[cid] = (name, dur, sz)
        print(f"  压缩 {name}: {sz//1024}KB ({'JPEG' if dur.startswith('data:image/jpeg') else 'PNG'})")

    if dry:
        print("[dry] 不调 MCP，结束。")
        return

    # 2) 拉 schema，确认 avatar 路径
    try:
        sch = call(url, h, "tavo_resource_read", {"uri": "tavo://schemas/character"})
        print("  schema 片段:", json.dumps(sch, ensure_ascii=False)[:300])
    except Exception as e:
        print("  (读 schema 失败，继续按 data.avatar 尝试):", str(e)[:120])

    ok = 0
    for cid, (name, dur, sz) in prepared.items():
        ch = call(url, h, "tavo_character_get", {"id": cid})
        data = ch.get("data", {})
        data["avatar"] = dur
        res = call(url, h, "tavo_character_update", {"id": cid, "character": data})
        # 验证
        ch2 = call(url, h, "tavo_character_get", {"id": cid})
        av = ch2.get("data", {}).get("avatar")
        if av:
            print(f"  ✓ {name} (id={cid}) 头像已写入 {len(av)} 字符")
            ok += 1
        else:
            # 回退：import CCv3 wrapper
            card = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
            try:
                call(url, h, "tavo_character_import",
                     {"chatId": CHAT_ID, "card": card, "conflict": "overwrite"})
                ch3 = call(url, h, "tavo_character_get", {"id": cid})
                av3 = ch3.get("data", {}).get("avatar")
                if av3:
                    print(f"  ✓ {name} (id={cid}) 经 import 写入头像")
                    ok += 1
                else:
                    print(f"  ✗ {name} (id={cid}) 两种途径都没存住头像")
            except Exception as e:
                print(f"  ✗ {name} import 失败: {str(e)[:120]}")
    print(f"\n完成：{ok}/{len(prepared)} 个角色头像已写入。")


if __name__ == "__main__":
    main()
