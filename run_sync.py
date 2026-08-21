#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import subprocess
import sys
import os

# 设置工作目录
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins")

# 使用绝对路径
story_dir = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story/谁让这个山大王修仙的"

args = [
    sys.executable, "-m", "tavo_plugins", "sync",
    story_dir,
    "--force",
    "--skip-plugins",
    "--duplicate-delete",
    "--clean-cache"
]

print("执行命令:", " ".join(args))
print()

result = subprocess.run(args, capture_output=False)
sys.exit(result.returncode)
