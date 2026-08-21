#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""直接调用 story_sync_all.py 的 main 函数 - 调试版本"""
import os
import sys

# 设置工作目录
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

# 添加路径
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/script/tavo_mcp_use/story_sync")

# 故事目录 - 使用 Windows 风格路径
story_dir = "D:\\Users\\viaco\\tools\\Toonflow-game\\tavo_plugins\\.cache\\story\\谁让这个山大王修仙的"

print("执行 story_sync_all.py")
print("故事目录:", story_dir)
print("目录存在:", os.path.isdir(story_dir))
print()

# 模拟命令行参数
sys.argv = [
    "story_sync_all.py",
    story_dir,
    "--force",
    "--skip-plugins",
    "--duplicate-delete",
    "--clean-cache"
]

# 导入并运行
from story_sync_all import main

if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        sys.exit(e.code)