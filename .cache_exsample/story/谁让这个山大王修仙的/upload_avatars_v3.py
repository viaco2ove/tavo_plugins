#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量把 12 角色头像从 base64 data URI 改为 files/global/... 文件引用（已验证可渲染）。

机制（2026-08-14 实测，纯小白=id34 已确认客户端能显示）：
  1) tavo_file_save({chatId, name, content(base64), options:{scope:'global', encoding:'base64'}})
     -> 返回 path = files/global/<name>
  2) tavo_character_import_card({card:{spec:'chara_card_v3', spec_version:'3.0', data:{...avatar:path}}})
     -> 按 name 新建卡
  3) tavo_chat_update 重绑 characterIds
  4) tavo_character_delete 删旧卡

本脚本遍历 chat6 当前 characterIds（含已修好的 34），对仍是 data URI 的旧卡做转换，
保持群聊顺序不变，最后删除所有被替换的旧卡。
"""
import os, json, base64, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.normpath(os.path.join(BASE, "..", "..", "..", ".env"))
CHAT_ID = 6
DRY = "--dry" in os.sys.argv


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
    if "error" in res:
        raise RuntimeError(f"{name} error: {res['error']}")
    return out, res


def main():
    url, token = load_env()

    # 1) 拉当前群聊绑定
    ch, _ = call(url, token, "tavo_chat_get", {"id": CHAT_ID})
    old_ids = list(ch.get("characterIds", []))
    lorebook_ids = ch.get("lorebookIds")
    print(f"[chat {CHAT_ID}] 当前 characterIds={old_ids} lorebookIds={lorebook_ids}")

    mapping = {}        # old_id -> new_id (未替换则相同)
    need_delete = []    # 待删旧卡

    for old_id in list(old_ids):
        d, _ = call(url, token, "tavo_character_get", {"id": old_id})
        data = dict(d.get("data", d)) if isinstance(d, dict) else {}
        name = data.get("name", f"char{old_id}")
        av = data.get("avatar")

        # 已经是文件引用 -> 跳过（纯小白 34 等）
        if isinstance(av, str) and (av.startswith("files/") or av.startswith("charaCard/")):
            print(f"[跳过] id={old_id} {name} 已是文件引用: {av}")
            mapping[old_id] = old_id
            continue

        # 2) 解出 base64
        if not (isinstance(av, str) and av.startswith("data:")):
            print(f"[跳过] id={old_id} {name} 无 data URI 头像(av={str(av)[:30]})")
            mapping[old_id] = old_id
            continue
        header, b64 = av.split(",", 1)
        mime = header.split(";")[0].replace("data:", "").lower()
        ext = "png" if "png" in mime else ("jpg" if ("jpeg" in mime or "jpg" in mime) else "png")
        print(f"[处理] id={old_id} {name} mime={mime} dataLen={len(b64)//1024}KB")

        if DRY:
            print(f"   (dry) 将 file_save + import_card + 重绑")
            mapping[old_id] = old_id
            continue

        # 3) 落文件
        fname = f"{name}.{ext}"
        fres, _ = call(url, token, "tavo_file_save",
                       {"chatId": CHAT_ID, "name": fname, "content": b64,
                        "options": {"scope": "global", "encoding": "base64"}})
        fpath = fres.get("path") or f"files/global/{fname}"
        print(f"   file_save -> {fpath}")

        # 4) 整卡重导
        data["avatar"] = fpath
        wrapper = {"spec": "chara_card_v3", "spec_version": "3.0", "data": data}
        res, _ = call(url, token, "tavo_character_import_card", {"card": wrapper})
        nid = (res or {}).get("id")
        print(f"   import_card -> 新id={nid} avatar={fpath}")

        # 5) 校验
        d2, _ = call(url, token, "tavo_character_get", {"id": nid})
        a2 = (d2.get("data", d2) if isinstance(d2, dict) else {}).get("avatar")
        ok = isinstance(a2, str) and a2.startswith("files/")
        print(f"   校验 avatar={str(a2)[:50]} 渲染可用={'YES' if ok else 'NO'}")

        mapping[old_id] = nid
        need_delete.append(old_id)

    if DRY:
        print("\n[DRY] 未做任何写入。去掉 --dry 再跑。")
        return

    # 6) 重绑群聊（保持原顺序）
    new_ids = [mapping[c] for c in old_ids]
    call(url, token, "tavo_chat_update",
         {"id": CHAT_ID, "chat": {"characterIds": new_ids, "lorebookIds": lorebook_ids}})
    print(f"\n[重绑] chat {CHAT_ID} characterIds={new_ids}")

    # 7) 删旧卡
    for oid in need_delete:
        call(url, token, "tavo_character_delete", {"id": oid})
        print(f"[删旧] id={oid}")
    print(f"\n>>> 完成。请到 Tavo 检查群聊 12 个角色头像是否全部显示。")


if __name__ == "__main__":
    main()
