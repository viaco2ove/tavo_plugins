#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
plugin_install.py - 通过 tavo MCP Server 安装 / 管理插件

仅依赖 Python 标准库（不依赖 requests / dotenv）。

用法:
  # 安装单个插件目录（pluginId 从 manifest.json 读取）
  python plugin_install.py plugins/toonflow_story_style

  # 安装多个
  python plugin_install.py plugins/toonflow_story_style plugins/toonflow_story_event_manager

  # 安装 plugins/ 下全部带 manifest.json 的目录
  python plugin_install.py --all

  # 只打包 + 校验 manifest（不连 MCP、不安装）
  python plugin_install.py plugins/toonflow_story_style --check-only

  # 列出已安装的插件
  python plugin_install.py --list

  # 覆盖默认连接（否则读 .env 的 tavo_mcp_url / tavo_mcp_toekn）
  python plugin_install.py --all --url http://10.10.2.208:7347/mcp --token YOUR_TOKEN

连接配置（.env，项目根目录）:
  tavo_mcp_url=http://10.10.2.208:7347/mcp
  tavo_mcp_toekn=xxxx
注意：MCP Server 默认关闭，需先在 tavo 桌面端「设置 -> MCP Server」启用，且 IP 可能变。
"""
import os
import sys
import io
import json
import base64
import zipfile
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # tavo_plugins 根目录（脚本在 script/tavo_mcp_use 下，上两级）


# ---------------------------------------------------------------------------
# 配置加载
# ---------------------------------------------------------------------------
def load_env_file(path):
    """极简 .env 解析：KEY=VALUE，忽略空行与 # 注释，去首尾引号。"""
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            env[k] = v
    return env


def resolve_auth(args):
    """优先级：命令行 > 项目根 .env > 系统环境变量。"""
    env = load_env_file(os.path.join(ROOT, ".env"))
    url = args.url or env.get("tavo_mcp_url") or os.environ.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or os.environ.get("tavo_mcp_toekn")
    if not url or not token:
        sys.stderr.write(
            "缺少 MCP 连接配置：请传 --url/--token，或在项目根 .env 配置 "
            "tavo_mcp_url / tavo_mcp_toekn\n"
        )
        sys.exit(2)
    return url.rstrip("/"), token


# ---------------------------------------------------------------------------
# MCP JSON-RPC 调用
# ---------------------------------------------------------------------------
def rpc(url, token, method, arguments, timeout=90):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": method, "arguments": arguments},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败（Server 是否启用？URL/IP 是否正确？）: %s" % e)
    if "error" in body:
        raise RuntimeError("MCP error: %s" % json.dumps(body["error"], ensure_ascii=False))
    return body.get("result", {})


def content_text(result):
    """MCP tools/call 返回 {"content":[{"type":"text","text":"{...json...}"}]}，取出并解析。"""
    content = (result or {}).get("content") or []
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            try:
                return json.loads(c["text"])
            except Exception:
                return {"raw": c.get("text")}
    return {}


# ---------------------------------------------------------------------------
# 打包与校验
# ---------------------------------------------------------------------------
_SKIP_DIRS = {".git", "__pycache__", ".DS_Store", "node_modules"}
_SKIP_FILES = {".DS_Store"}


def build_zip(plugin_dir):
    """把插件目录打成内存 zip（zipfile，与 .tpg 产物一致），返回 bytes。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for f in files:
                if f in _SKIP_FILES or f.endswith(".pyc"):
                    continue
                p = os.path.join(base, f)
                rel = os.path.relpath(p, plugin_dir).replace(os.sep, "/")
                z.write(p, rel)
    return buf.getvalue()


def read_manifest(plugin_dir):
    mp = os.path.join(plugin_dir, "manifest.json")
    if not os.path.isfile(mp):
        raise FileNotFoundError("目录缺少 manifest.json: %s" % plugin_dir)
    with open(mp, "r", encoding="utf-8") as f:
        return json.load(f)


def check_manifest(manifest):
    """返回问题列表（字符串）。"""
    problems = []
    if "localization" not in manifest:
        problems.append(
            "manifest 缺少 localization 字段（tavo 会报 invalidManifest / localizationMissing）"
        )
    if not manifest.get("id"):
        problems.append("manifest.id 缺失")
    if not manifest.get("name"):
        problems.append("manifest.name 缺失")
    return problems


# ---------------------------------------------------------------------------
# 安装流程
# ---------------------------------------------------------------------------
def install_one(url, token, plugin_dir, enable, overwrite, check_only):
    plugin_dir = os.path.abspath(plugin_dir)
    if not os.path.isdir(plugin_dir):
        print("[跳过] 目录不存在: %s" % plugin_dir)
        return False

    manifest = read_manifest(plugin_dir)
    pid = manifest.get("id")
    _name = manifest.get("name")
    name = _name.get("$t") if isinstance(_name, dict) else _name
    problems = check_manifest(manifest)

    z = build_zip(plugin_dir)
    b64 = base64.b64encode(z).decode("ascii")

    print("\n=== %s  (%s) ===" % (pid, name))
    print("  zip: %d bytes -> base64 %d chars" % (len(z), len(b64)))
    if problems:
        print("  [manifest 警告] " + "; ".join(problems))

    if check_only:
        print("  [check-only] 已打包校验，未安装")
        return not problems

    try:
        res = rpc(url, token, "tavo_plugin_install",
                  {"pluginId": pid, "zipBase64": b64, "overwrite": overwrite})
        info = content_text(res)
        ok = info.get("ok")
        print("  install: ok=%s version=%s enabled=%s" % (
            ok, info.get("version"), info.get("enabled")))
        if str(ok).lower() != "true" and ok is not True:
            # 某些返回直接用 result 而非 content；再尝试直接读
            if isinstance(res, dict) and res.get("ok"):
                pass
            else:
                print("  [!] 安装返回非预期: %s" % json.dumps(info, ensure_ascii=False)[:300])
                return False

        if enable:
            res2 = rpc(url, token, "tavo_plugin_set_enabled",
                       {"pluginId": pid, "enabled": True})
            print("  enable: %s" % json.dumps(content_text(res2), ensure_ascii=False)[:150])

        res3 = rpc(url, token, "tavo_plugin_get", {"pluginId": pid})
        g = content_text(res3)
        print("  get: name=%s version=%s enabled=%s" % (
            g.get("name"), g.get("version"), g.get("enabled")))
        return True
    except RuntimeError as e:
        print("  [!] %s" % e)
        return False


def list_plugins(url, token):
    try:
        res = rpc(url, token, "tavo_plugin_search", {})
    except RuntimeError as e:
        print("[!] %s" % e)
        return
    items = content_text(res).get("plugins") or []
    if not items:
        print("  (无已安装插件，或 tavo_plugin_search 需要 query 参数)")
        return
    for p in items:
        print("  [%s] %s  v%s  enabled=%s" % (
            p.get("pluginId"), p.get("name"), p.get("version"), p.get("enabled")))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="通过 tavo MCP 安装 / 管理插件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("dirs", nargs="*", help="插件目录（可多个）；pluginId 从 manifest.json 读取")
    ap.add_argument("--all", action="store_true", help="安装 ROOT/plugins 下全部带 manifest.json 的目录")
    ap.add_argument("--check-only", action="store_true", help="只打包+校验 manifest，不连 MCP、不安装")
    ap.add_argument("--no-enable", action="store_true", help="安装后不 set_enabled(true)")
    ap.add_argument("--no-overwrite", action="store_true", help="不覆盖已安装版本（默认覆盖）")
    ap.add_argument("--list", action="store_true", help="列出已安装的插件并退出")
    ap.add_argument("--url", help="MCP Server URL（覆盖 .env）")
    ap.add_argument("--token", help="MCP Bearer Token（覆盖 .env）")
    args = ap.parse_args()

    targets = []
    if args.all:
        plugins_root = os.path.join(ROOT, "plugins")
        if os.path.isdir(plugins_root):
            for d in sorted(os.listdir(plugins_root)):
                pd = os.path.join(plugins_root, d)
                if os.path.isdir(pd) and os.path.isfile(os.path.join(pd, "manifest.json")):
                    targets.append(pd)
    else:
        targets = args.dirs

    if args.list:
        url, token = resolve_auth(args)
        list_plugins(url, token)
        return

    if not targets:
        ap.print_help()
        sys.exit(1)

    # check-only 不需要连接；其余需要
    url = token = None
    if not args.check_only:
        url, token = resolve_auth(args)

    enable = not args.no_enable
    overwrite = not args.no_overwrite
    ok_count = 0
    for t in targets:
        if install_one(url, token, t, enable, overwrite, args.check_only):
            ok_count += 1

    print("\n--- 完成：%d/%d 个插件成功 ---" % (ok_count, len(targets)))


if __name__ == "__main__":
    main()
