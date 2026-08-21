#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""直接运行 sync，跳过 click 的路径验证"""
import os
import sys
import json

# 设置工作目录
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

# 添加 src 到 path
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

# 直接调用 story_sync_all.py
script_path = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/script/tavo_mcp_use/story_sync/story_sync_all.py"

# 故事目录
story_dir = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/谁让这个山大王修仙的"

# 直接用 subprocess 调用 story_sync_all.py（绕过 cli.py）
import subprocess
env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

args = [sys.executable, script_path, story_dir, "--force", "--skip-plugins", "--duplicate-delete", "--clean-cache"]
print("执行:", " ".join(args))
print()
result = subprocess.run(args, env=env)
sys.exit(result.returncode)