# Tavo Plugins CLI 工具

通过 `tavo` 命令管理 Tavo 故事同步、插件安装和变量操作。

## 快速开始

```bash
# 安装（开发模式）
cd tavo_plugins
pip install -e .

# 列出已安装插件
tavo plugins

# 同步故事
tavo sync ".cache/story/故事名"

# 读变量
tavo var tf_sprites
```


## 命令总览

| 命令 | 说明 |
|------|------|
| [`tavo plugins`](tavo_plugins/plugins.md) | 列出已安装插件 |
| [`tavo install`](tavo_plugins/install.md) | 安装插件（传入插件目录） |
| [`tavo sync`](tavo_plugins/sync.md) | 同步故事到 Tavo（角色+立绘+章节+插件） |
| [`tavo characters`](tavo_plugins/characters.md) | 列出、搜索或删除角色卡 |
| [`tavo personas`](tavo_plugins/personas.md) | 列出、搜索或删除 persona |
| [`tavo var`](tavo_plugins/var.md) | 读取或写入 chat/global 变量 |

## 通用选项

| 选项 | 说明 |
|------|------|
| `-e, --env PATH` | 指定 `.env` 文件路径（默认在当前目录查找） |

## 配置文件

工具通过 `.env` 文件连接 Tavo MCP 服务：

```env
TAVO_MCP_URL=http://localhost:38685/mcp
TAVO_MCP_TOKEN=你的token
```

详见 [配置说明](tavo_plugins/config.md)。

## 角色 ID 管理

同步时如果不想重复创建角色，可传入 ID 映射文件：

```bash
tavo sync ".cache/story/故事名" --reuse-ids char_ids.json
```

详见 [角色 ID 管理](tavo_plugins/config.md#角色-id-映射)。

## 目录结构

```
md/cli/tavo_plugins/
├── setup.md       # 安装与环境配置
├── sync.md        # sync 命令详解
├── plugins.md     # plugins 命令
├── install.md     # install 命令
├── characters.md  # characters 命令
├── personas.md   # personas 命令
├── var.md         # var 命令
└── config.md      # .env 和 char_ids.json 配置
```
