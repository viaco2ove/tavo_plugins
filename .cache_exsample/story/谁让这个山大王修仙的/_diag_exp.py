#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, base64, io, urllib.request
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))
AV_DIR = os.path.join(BASE, "avatars")


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


def compress(path, target_kb=250):
    img = Image.open(path)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    if buf.tell() <= target_kb * 1024:
        return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"
    q = 88
    while q > 25:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=q)
        if buf.tell() <= target_kb * 1024:
            break
        q -= 8
    return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"


def main():
    url, token = load_env()
    name = "纯小白"
    # 1) 取现有卡（id=20）完整 data
    d, _ = call(url, token, "tavo_character_get", {"id": 20})
    data = d.get("data", d)
    print("[现有 20] avatar 前缀:", str(data.get("avatar"))[:50])

    # 2) 实验 A：用完整 CCv3 wrapper 重新导入（avatar=dataUrl）
    dur = compress(os.path.join(AV_DIR, name + ".png"))
    wrapper = {"spec": "chara_card_v3", "spec_version": "3.0", "data": dict(data)}
    wrapper["data"]["avatar"] = dur
    res, raw = call(url, token, "tavo_character_import_card", {"card": wrapper})
    nid = (res or {}).get("id") or (res or {}).get("characterId")
    print(f"[实验A 完整wrapper导入] 新id={nid} 返回={str(res)[:200]}")
    if nid:
        d2, _ = call(url, token, "tavo_character_get", {"id": nid})
        a2 = (d2.get("data", d2) if isinstance(d2, dict) else {}).get("avatar")
        print(f"  -> 新卡 avatar 前缀: {str(a2)[:60]}  (len={len(a2) if isinstance(a2,str) else 0})")

    # 3) 实验 B：tavo_file_save 保存 PNG，看返回路径
    png_bytes = open(os.path.join(AV_DIR, name + ".png"), "rb").read()
    b64 = base64.b64encode(png_bytes).decode()
    fres, fraw = call(url, token, "tavo_file_save",
                      {"chatId": 6, "name": name + ".png", "content": b64,
                       "options": {"scope": "chat", "encoding": "base64"}})
    print(f"[实验B file_save] 返回={json.dumps(fres, ensure_ascii=False)[:300]}")
    print(f"  raw.result.content[0].text 预览: {str(fraw.get('result',{}).get('content',[{}])[:1])[:200]}")

    # 清理实验A产生的新卡（避免重复）
    if nid:
        try:
            call(url, token, "tavo_character_delete", {"id": nid})
            print(f"[清理] 已删实验A新卡 id={nid}")
        except Exception as e:
            print(f"[清理] 删 {nid} 失败: {str(e)[:80]}")


if __name__ == "__main__":
    main()
