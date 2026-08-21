# 当前项目 是tavo 的一个插件库
为tavo编写插件的一个库

# tavo javascript-api
https://docs.tavoai.dev/cn/guides/javascript-api/
https://docs.tavoai.dev/cn/guides/plugin-development/
https://docs.tavoai.dev/cn/guides/plugins/
https://docs.tavoai.dev/cn/guides/mcp-server/

# plugins
[plugins](plugins)
plugins
- toonflow_story_memory_manager [把Toonflow-game的记忆管理器 agent 移植为 tavo 插件]


# Toonflow-game
一个在Toonflow 项目 基础上二次开发的ai 文本游戏项目
https://github.com/viaco2ove/Toonflow-game.git

Toonflow-game 的agent list
[Toonflow-game_世界知识_agent.md](md/toonflow-game-md/Toonflow-game_%E4%B8%96%E7%95%8C%E7%9F%A5%E8%AF%86_agent.md)

# cli 说明
为了复用mcp 功能 编写了cli 模块
[cli](md/cli)
让ai 工具 如 claude code 不要 直接调用 python文件来操作 tava mcp 要 通过
调用 tavo 命令 来维护 故事同步等功能
减少ai 重复犯错的问题。
例如：tavo characters  # 列出全部角色

## story.json 控制的故事同步：
完全同步：强力，角色查重,角色卡重建。
```
python -m tavo_plugins sync --story-json "story.json" --duplicate-delete --clean-cache --skip-plugins
```

# 目录结构

```
tavo_plugins/
├── .env                    # MCP 连接配置（TAVO_MCP_URL / TAVO_MCP_TOKEN）
├── pyproject.toml         # Python CLI 入口配置（pip install -e . 后生成 tavo 命令）
│
├── src/                   # Python CLI 源码
│   └── tavo_plugins/
│       ├── __init__.py
│       ├── cli.py          # CLI 入口（plugins / install / sync / var）
│       ├── lib/
│       │   └── mcp_client.py   # MCP JSON-RPC 客户端封装
│       └── commands/
│           └── sync_story.py    # 同步故事逻辑
│
├── plugins/               # 已开发的 Tavo 插件
│   ├── toonflow_story_event_manager/      # 事件管理器（面板 + tf_story.edit）
│   ├── toonflow_story_memory_manager/       # 记忆管理器
│   ├── toonflow_story_multi_character_stage/ # 角色编排（MCS）
│   ├── toonflow_story_sprite_background/    # 立绘背景
│   ├── toonflow_story_speaker/             # 角色发言器
│   ├── toonflow_story_style/               # 样式美化
│   └── toonflow_story_debug_eruda/         # Eruda 调试面板
│
├── script/               # MCP 工具封装脚本
│   └── tavo_mcp_use/
│       ├── plugin_install.py     # 安装插件（MCP tavo_plugin_install）
│       ├── story_sync/          # 故事同步脚本
│       │   ├── story_sync.py
│       │   ├── story_sync_all.py
│       │   └── story_sync_voice.py
│       └── chapter_sync.py
│
├── .cache/               # 缓存 文件夹，不上传git
├── .cache_example/      # 缓存文件夹的演示版，上传git
├── .hide/                # 隐藏文件夹，不上传git
└── md/                   # 项目文档
    ├── cli/               # CLI 使用文档
    │   ├── tavo_plugins_help.md    # 总览入口
    │   └── tavo_plugins/            # 分命令详解
    │       ├── setup.md     # 安装与环境配置
    │       ├── sync.md      # sync 命令
    │       ├── plugins.md   # plugins 命令
    │       ├── install.md   # install 命令
    │       ├── var.md       # var 命令
    │       └── config.md    # .env 和 char_ids.json
    ├── currdesign/         # 当前设计文档
    ├── debug/              # 调试记录
    └── ...
```

## CLI 命令

安装后使用 `tavo` 命令（需 pip install -e .）：

```bash
tavo plugins                  # 列出已安装插件
tavo install plugins/xxx     # 安装插件
tavo sync .cache/story/xxx   # 同步故事
tavo var tf_sprites          # 读写变量
```
tavo vs  python -m tavo_plugins ：tavo 需要配置环境，  python -m tavo_plugins 不需要

详见 [md/cli/tavo_plugins_help.md](md/cli/tavo_plugins_help.md)
# cli实例
## 同步故事
python -m tavo_plugins sync ".cache/story/谁让这个山大王修仙的" --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json" --skip-plugins
## story.json 控制的故事同步：
```
python -m tavo_plugins sync --story-json "story.json" --duplicate-delete --clean-cache --skip-plugins
```