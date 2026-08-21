#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过自动查找目录来运行 sync"""
import os
import sys

# 设置工作目录
os.chdir("D:/Users/viaco/tools/Toonflow-game/tavo_plugins/src")

# 添加路径
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins")
sys.path.insert(0, "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/script/tavo_mcp_use/story_sync")

# 自动找到故事目录
cache_base = "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.cache/story"
story_dir = None

print("查找故事目录...")
for name in os.listdir(cache_base):
    full_path = os.path.join(cache_base, name)
    if os.path.isdir(full_path):
        print(f"  找到: {name}")
        # 检查是否有 story.json
        story_json = os.path.join(full_path, "story.json")
        if os.path.isfile(story_json):
            print(f"    [OK] 包含 story.json")
            story_dir = full_path
            break
        # 也检查子目录
        for sub in os.listdir(full_path):
            sub_path = os.path.join(full_path, sub)
            if os.path.isdir(sub_path):
                story_json = os.path.join(sub_path, "story.json")
                if os.path.isfile(story_json):
                    print(f"    [OK] 子目录 {sub} 包含 story.json")
                    story_dir = sub_path
                    break
        if story_dir:
            break

if not story_dir:
    print("未找到包含 story.json 的目录")
    sys.exit(1)

print()
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