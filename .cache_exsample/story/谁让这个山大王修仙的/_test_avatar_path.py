#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对照测试 v2：头像强制 PNG（缩到 512px，匹配参照角色的 .png），用 files/global 路径当 avatar。
先清理上一轮测试卡(33)，把 chat 6 还原为 [20..31]，再重做。"""
import os, json, base64, io, urllib.request
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))
AV_DIR = os.path.join(BASE, "avatars")
CHAT_ID = 6
TARGET_KB = 250


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


def call(url, token, name, args, timeout=120):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": name, "arguments": args}}).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        res = json.loads(r.read().decode("utf-8"))
    out = None
    for c in res.get("result", {}).get("content", []):
        t = c.get("text")
        if isinstance(t, str):
            try:
                out = json.loads(t)
            except Exception:
                out = t
            break
    return out, res


def main():
    url, token = load_env()
    name = "纯小白"

    # 0) 清理上一轮测试卡(avatar 以 files/global/纯小白.png 开头者) + 还原 chat6
    ch, _ = call(url, token, "tavo_chat_get", {"id": CHAT_ID})
    olds = list(ch.get("characterIds", []))
    for cid in list(olds):
        d, _ = call(url, token, "tavo_character_get", {"id": cid})
        av = (d.get("data", d) if isinstance(d, dict) else {}).get("avatar") if isinstance(d, dict) else None
        if isinstance(av, str) and av.startswith("files/global/纯小白.png"):
            call(url, token, "tavo_character_delete", {"id": cid})
            print(f"[清理] 删上一轮测试卡 id={cid}")
            olds = [c for c in olds if c != cid]
    # 确保 20 在列表中
    if 20 not in olds:
        olds = [20] + [c for c in olds if c != 20]
    call(url, token, "tavo_chat_update", {"id": CHAT_ID, "chat": {"characterIds": olds,
                                                                   "lorebookIds": ch.get("lorebookIds")}})
    print(f"[还原] chat 6 characterIds = {olds}")

    # 1) 强制 PNG（缩到 512px 以内）
    img = Image.open(os.path.join(AV_DIR, name + ".png"))
    img.thumbnail((512, 512))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    if buf.tell() > TARGET_KB * 1024:
        q = 90
        while q > 40:
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=q)
            if buf.tell() <= TARGET_KB * 1024:
                break
            q -= 10
        ext = "jpg"
    else:
        ext = "png"
    b64 = base64.b64encode(buf.getvalue()).decode()
    fres, _ = call(url, token, "tavo_file_save",
                   {"chatId": CHAT_ID, "name": f"{name}.{ext}", "content": b64,
                    "options": {"scope": "global", "encoding": "base64"}})
    fpath = fres.get("path") or f"files/global/{name}.{ext}"
    print(f"[file_save global] path={fpath} 格式={ext} 大小={buf.tell()//1024}KB")

    # 2) 取 20，重导入完整 wrapper，avatar=文件路径
    d, _ = call(url, token, "tavo_character_get", {"id": 20})
    data = dict(d.get("data", d))
    data["avatar"] = fpath
    wrapper = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
    res, _ = call(url, token, "tavo_character_import_card", {"card": wrapper})
    nid = (res or {}).get("id")
    print(f"[导入] 纯小白 旧20 → 新{nid}，avatar={fpath}")

    # 3) 校验
    d2, _ = call(url, token, "tavo_character_get", {"id": nid})
    a2 = (d2.get("data", d2) if isinstance(d2, dict) else {}).get("avatar")
    print(f"[校验] 新卡 avatar = {str(a2)[:60]} (len={len(a2) if isinstance(a2,str) else 0})")

    # 4) 重绑 chat 6：新卡替换 20
    ch2, _ = call(url, token, "tavo_chat_get", {"id": CHAT_ID})
    news = [nid if c == 20 else c for c in ch2.get("characterIds", [])]
    call(url, token, "tavo_chat_update", {"id": CHAT_ID, "chat": {"characterIds": news,
                                                                   "lorebookIds": ch2.get("lorebookIds")}})
    print(f"[重绑] chat 6 characterIds = {news}")
    print(f"\n>>> 请到 Tavo 检查 群聊里的【纯小白】头像是否显示（当前引用路径 {fpath}）。")


if __name__ == "__main__":
    main()
