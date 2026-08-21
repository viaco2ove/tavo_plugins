#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 打包所有插件成 .tpg
import os, io, zipfile

SKIP_DIRS = {".git", "__pycache__", ".DS_Store", "node_modules"}
SKIP_FILES = {".DS_Store"}

ROOT = os.path.dirname(os.path.abspath(__file__))
PLUGINS_DIR = os.path.join(ROOT, "plugins")

def build_zip(plugin_dir):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if f in SKIP_FILES or f.endswith(".pyc"):
                    continue
                p = os.path.join(base, f)
                rel = os.path.relpath(p, plugin_dir).replace(os.sep, "/")
                zf.write(p, rel)
    return buf.getvalue()

def main():
    print("打包插件到 plugins/*.tpg...")
    for name in sorted(os.listdir(PLUGINS_DIR)):
        src = os.path.join(PLUGINS_DIR, name)
        if not os.path.isdir(src):
            continue
        if name.startswith("."):
            continue
        out = os.path.join(ROOT, "plugins", name + ".tpg")
        data = build_zip(src)
        with open(out, "wb") as f:
            f.write(data)
        print(f"  {name}.tpg ({len(data)} bytes)")

if __name__ == "__main__":
    main()
