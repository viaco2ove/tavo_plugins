#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pluginhub.py - tavo 插件中心（hub.tavo.cc）管理脚本

功能：
  list                 列出我发布的插件（id/版本/状态）
  info <plugin_id>     查看单个插件详情
  publish <tpg>        发布新插件（id 已存在会报 package_id_taken）
  update <plugin_id> <tpg>   更新已有插件版本（check-package + publish 两步）
  unpublish <plugin_id>      下架
  delete <plugin_id>         删除
  check <tpg>          仅校验包（不落库）

认证：.env 的 sid=xxx（或 --sid）

用法示例：
  python pluginhub.py list
  python pluginhub.py publish plugins/toonflow_story_speaker.tpg
  python pluginhub.py update 6a7f0cb14364bff66349c0fb plugins/toonflow_story_speaker.tpg
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
HUB = "https://hub.tavo.cc/api/v1/creator/plugins"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")


def load_env(path):
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve_sid(args):
    env = load_env(os.path.join(ROOT, ".env"))
    sid = args.sid or env.get("sid") or os.environ.get("tavo_hub_sid")
    if not sid:
        sys.exit("缺少 sid：传 --sid 或在 .env 配 sid=xxx")
    return sid


def _read_manifest_from_tpg(tpg_path):
    """从 .tpg（zip）里读 manifest.json，拿 name/description 做默认 metadata"""
    import zipfile
    try:
        with zipfile.ZipFile(tpg_path) as z:
            for n in z.namelist():
                if n == "manifest.json" or n.endswith("/manifest.json"):
                    m = json.loads(z.read(n).decode("utf-8"))
                    name = m.get("name")
                    if isinstance(name, dict):
                        name = name.get("$t", "插件")
                    desc = m.get("description")
                    if isinstance(desc, dict):
                        desc = desc.get("$t", "")
                    return {"name": name or "插件", "description": desc or "",
                            "external_url": None}
    except Exception:
        pass
    return {"name": "插件", "description": "", "external_url": None}


def _boundary_encode(fields, files):
    """构造 multipart/form-data body（boundary 手写，等价 curl --data-raw）"""
    boundary = "----TavoPluginHubScript7f3k2b9x"
    lines = []
    for k, v in fields.items():
        lines.append("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                     % (boundary, k, v))
    for k, (fname, data, ctype) in files.items():
        lines.append("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                     "Content-Type: %s\r\n\r\n" % (boundary, k, fname, ctype))
        # 二进制部分单独拼
    head = "".join(lines).encode("utf-8")
    # 逐段拼：head 里每个 file 段后面接二进制再接 CRLF
    out = b""
    idx = 0
    for k, (fname, data, ctype) in files.items():
        marker = ('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\n'
                  'Content-Type: %s\r\n\r\n' % (boundary, k, fname, ctype)).encode("utf-8")
        pos = head.find(marker, idx)
        if pos < 0:
            continue
        end = pos + len(marker)
        out += head[idx:end] + data + b"\r\n"
        idx = end
    out += head[idx:]
    out += ("--%s--\r\n" % boundary).encode("utf-8")
    return out, boundary


def hub_request(sid, method, path, fields=None, files=None, timeout=60):
    """发 hub 请求。fields: dict[str,str]；files: {field: (fname, bytes, ctype)}"""
    url = "%s%s?lang=zh-CN" % (HUB, path)
    headers = {
        "accept": "*/*",
        "origin": "https://hub.tavoai.dev",
        "referer": "https://hub.tavoai.dev/account/plugins",
        "user-agent": UA,
        "x-sid": sid,
    }
    if fields is None and files is None:
        data = None
    else:
        data, boundary = _boundary_encode(fields or {}, files or {})
        headers["content-type"] = "multipart/form-data; boundary=%s" % boundary
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except Exception:
        return {"raw": body}


def err_of(resp):
    e = resp.get("error") if isinstance(resp, dict) else None
    if isinstance(e, dict):
        return e.get("message", str(e))
    return None


# ---------------- 子命令 ----------------

def cmd_list(args):
    sid = resolve_sid(args)
    resp = hub_request(sid, "GET", "")
    items = resp.get("items") if isinstance(resp, dict) else None
    if items is None:
        print("错误:", err_of(resp) or resp)
        return 1
    if not items:
        print("（无已发布插件）")
        return 0
    print("%-26s %-24s %-10s %-10s %s" % ("_id", "package_id", "version", "status", "name"))
    for it in items:
        print("%-26s %-24s %-10s %-10s %s" % (
            it.get("id", ""), it.get("package_id", ""),
            it.get("published_version", "-"), it.get("status", "-"), it.get("name", "")))
    print("共 %d 个" % len(items))
    return 0


def cmd_info(args):
    sid = resolve_sid(args)
    resp = hub_request(sid, "GET", "/%s" % args.plugin_id)
    if err_of(resp):
        print("错误:", err_of(resp))
        return 1
    print(json.dumps(resp, ensure_ascii=False, indent=2)[:3000])
    return 0


def cmd_check(args):
    sid = resolve_sid(args)
    data = open(args.tpg, "rb").read()
    resp = hub_request(sid, "POST", "/check-package", files={
        "plugin_file": (os.path.basename(args.tpg), data, "application/octet-stream")})
    if err_of(resp):
        print("❌", err_of(resp))
        return 1
    print("✅ 包有效:")
    print("  package_id:", resp.get("package_id"))
    print("  version:   ", resp.get("version"))
    print("  name:      ", resp.get("name"))
    print("  sha256:    ", (resp.get("sha256") or "")[:16] + "…")
    return 0


def cmd_publish(args):
    sid = resolve_sid(args)
    meta_default = _read_manifest_from_tpg(args.tpg)
    meta = {"name": args.name or meta_default["name"],
            "description": args.desc or meta_default["description"],
            "external_url": None}
    data = open(args.tpg, "rb").read()
    resp = hub_request(sid, "POST", "", fields={"metadata": json.dumps(meta, ensure_ascii=False)},
                       files={"plugin_file": (os.path.basename(args.tpg), data, "application/octet-stream")})
    if err_of(resp):
        print("❌ 发布失败:", err_of(resp))
        if "taken" in str(err_of(resp)):
            print("   （id 已存在：请用 update <plugin_id> <tpg> 更新版本）")
        return 1
    print("✅ 已发布:", resp.get("name"), "v" + str(resp.get("published_version", "?")), "id=" + str(resp.get("id")))
    return 0


def cmd_update(args):
    sid = resolve_sid(args)
    data = open(args.tpg, "rb").read()
    # 第一步：check-package 上传新版本
    r1 = hub_request(sid, "POST", "/%s/check-package" % args.plugin_id,
                     files={"plugin_file": (os.path.basename(args.tpg), data, "application/octet-stream")})
    if err_of(r1):
        print("❌ check-package 失败:", err_of(r1))
        return 1
    print("✓ 新版本已上传:", r1.get("version"))
    # 第二步：publish 保存修改
    meta_default = _read_manifest_from_tpg(args.tpg)
    meta = {"name": args.name or meta_default["name"],
            "description": args.desc or meta_default["description"],
            "external_url": None}
    r2 = hub_request(sid, "PATCH", "/%s/publish" % args.plugin_id,
                     fields={"metadata": json.dumps(meta, ensure_ascii=False)},
                     files={"plugin_file": (os.path.basename(args.tpg), data, "application/octet-stream")})
    if err_of(r2):
        print("❌ publish 失败:", err_of(r2))
        return 1
    print("✅ 已发布新版本:", r2.get("published_version"), "status=" + str(r2.get("status")))
    return 0


def cmd_unpublish(args):
    sid = resolve_sid(args)
    resp = hub_request(sid, "POST", "/%s/unpublish" % args.plugin_id)
    if err_of(resp):
        print("❌", err_of(resp))
        return 1
    print("✅ 已下架:", args.plugin_id)
    return 0


def cmd_delete(args):
    sid = resolve_sid(args)
    if not args.yes:
        ans = input("确认删除 %s？(y/N) " % args.plugin_id)
        if ans.strip().lower() != "y":
            print("已取消")
            return 0
    resp = hub_request(sid, "DELETE", "/%s" % args.plugin_id)
    if err_of(resp):
        print("❌", err_of(resp))
        return 1
    print("✅ 已删除:", args.plugin_id)
    return 0


def main():
    ap = argparse.ArgumentParser(description="tavo 插件中心管理")
    ap.add_argument("--sid", default=None, help="hub sid（默认读 .env）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="列出我发布的插件"); p.set_defaults(func=cmd_list)

    p = sub.add_parser("info", help="插件详情"); p.add_argument("plugin_id"); p.set_defaults(func=cmd_info)

    p = sub.add_parser("check", help="校验 .tpg 包"); p.add_argument("tpg"); p.set_defaults(func=cmd_check)

    p = sub.add_parser("publish", help="发布新插件")
    p.add_argument("tpg"); p.add_argument("--name", default=None); p.add_argument("--desc", default=None)
    p.set_defaults(func=cmd_publish)

    p = sub.add_parser("update", help="更新已有插件版本（两步：check-package + publish）")
    p.add_argument("plugin_id"); p.add_argument("tpg")
    p.add_argument("--name", default=None); p.add_argument("--desc", default=None)
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("unpublish", help="下架"); p.add_argument("plugin_id"); p.set_defaults(func=cmd_unpublish)

    p = sub.add_parser("delete", help="删除（需 --yes 跳过确认）")
    p.add_argument("plugin_id"); p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_delete)

    args = ap.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()