#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inject_eruda_pack.py
把 Eruda 调试面板内联进 Tavo 插件的所有 HTML 片段，重新打包成 .tpg。

用法:
    python inject_eruda_pack.py <plugin_dir> <output.tpg>

示例:
    python inject_eruda_pack.py ../plugins/toonflow_story_style toonflow_story_style_eruda.tpg

原理:
    Tavo 的 htmlFragments 机制把 HTML 字符串注入到聊天页 DOM。
    <script src="xxx.js"> 的相对路径解析不了（base URL 不是插件包），
    所以必须把 eruda.min.js 整个内联到 <script> 标签里才能执行。
"""
import sys
import os
import zipfile
import shutil
import tempfile

ERUDA_INIT_JS = '''eruda.init({
  tool: ["console", "elements", "network", "resources", "info", "settings"],
  autoScale: true,
  defaults: { displaySize: 50, transparency: 0.9, theme: "auto" }
});
console.log("%c[eruda] DevTools ready (inlined)", "color:#7cb3ff;font-weight:bold");
console.log("[eruda] location:", location.href);
console.log("[eruda] tavo API:", typeof tavo !== "undefined" ? "available" : "NOT available");
console.log("[eruda] plugin elements:", document.querySelectorAll('[id^="tf-"]').length, "个");
'''


def build_injection(eruda_content):
    """构造注入到 HTML 顶部的 <script> 块。"""
    return (
        '<script>\n'
        + eruda_content
        + '\n</script>\n'
        + '<script>\n'
        + ERUDA_INIT_JS
        + '</script>\n'
    )


def inject_into_html(html, eruda_content):
    """把 Eruda 注入块插到 HTML 最前面。"""
    return build_injection(eruda_content) + html


def pack(plugin_dir, output_tpg=None, outdir=None):
    debug_dir = os.path.dirname(os.path.abspath(__file__))
    eruda_path = os.path.join(debug_dir, "eruda.min.js")
    if not os.path.isfile(eruda_path):
        print(f"[ERROR] 找不到 eruda.min.js: {eruda_path}")
        print("请先运行: curl -sL -o eruda.min.js https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js")
        sys.exit(1)

    with open(eruda_path, "r", encoding="utf-8") as f:
        eruda_content = f.read()
    eruda_size = len(eruda_content.encode("utf-8"))

    plugin_dir = os.path.abspath(plugin_dir)
    if not os.path.isdir(plugin_dir):
        print(f"[ERROR] 插件目录不存在: {plugin_dir}")
        sys.exit(1)

    build_dir = tempfile.mkdtemp(prefix="tavo_build_")
    try:
        html_count = 0
        file_count = 0
        for root, dirs, files in os.walk(plugin_dir):
            # 跳过 .tpg 等打包产物本身
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if fname.endswith(".tpg") or fname.endswith(".zip"):
                    continue
                src = os.path.join(root, fname)
                rel = os.path.relpath(src, plugin_dir)
                dst = os.path.join(build_dir, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if fname.endswith(".html"):
                    with open(src, "r", encoding="utf-8") as f:
                        html = f.read()
                    html = inject_into_html(html, eruda_content)
                    with open(dst, "w", encoding="utf-8") as f:
                        f.write(html)
                    html_count += 1
                else:
                    shutil.copy2(src, dst)
                file_count += 1

        if outdir:
            # 输出目录（不打包），供 plugin_install.py 等工具读取
            outdir = os.path.abspath(outdir)
            if os.path.exists(outdir):
                shutil.rmtree(outdir)
            shutil.copytree(build_dir, outdir)
            print(f"[OK] 目录就绪: {outdir}")
            print(f"     文件数: {file_count}（其中 HTML {html_count} 个已注入 Eruda）")
            print(f"     Eruda 内联大小: {eruda_size/1024:.1f} KB")
            print(f"")
            print(f"用 MCP 安装: python script/tavo_mcp_use/plugin_install.py \"{outdir}\"")
        else:
            # 打包成 .tpg (本质是 zip)
            if not output_tpg:
                print("[ERROR] 需要指定 output_tpg 或 --outdir")
                sys.exit(1)
            output_tpg = os.path.abspath(output_tpg)
            os.makedirs(os.path.dirname(output_tpg) or ".", exist_ok=True)
            if os.path.exists(output_tpg):
                os.remove(output_tpg)
            with zipfile.ZipFile(output_tpg, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(build_dir):
                    for fname in files:
                        src = os.path.join(root, fname)
                        rel = os.path.relpath(src, build_dir).replace(os.sep, "/")
                        zf.write(src, rel)
            size_kb = os.path.getsize(output_tpg) / 1024
            print(f"[OK] 打包完成: {output_tpg}")
            print(f"     大小: {size_kb:.1f} KB")
            print(f"     文件数: {file_count}（其中 HTML {html_count} 个已注入 Eruda）")
            print(f"     Eruda 内联大小: {eruda_size/1024:.1f} KB")
            print(f"")
            print(f"安装: Tavo → 设置 → 插件 → 从文件安装 → 选这个 .tpg")
    finally:
        shutil.rmtree(build_dir, ignore_errors=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="把 Eruda 内联进 Tavo 插件 HTML，输出 .tpg 或目录")
    ap.add_argument("plugin_dir", help="插件目录")
    ap.add_argument("output_tpg", nargs="?", help="输出 .tpg 路径（与 --outdir 二选一）")
    ap.add_argument("--outdir", help="输出目录（不打包，供 plugin_install.py 用 MCP 安装）")
    args = ap.parse_args()
    if not args.output_tpg and not args.outdir:
        ap.error("需要指定 output_tpg 或 --outdir 之一")
    pack(args.plugin_dir, args.output_tpg, args.outdir)
