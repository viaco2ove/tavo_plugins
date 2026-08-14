# tavo MCP 使用脚本

通过 tavo MCP Server 操作 tavo 的命令行工具。

## 使用前提

1. 在 tavo 中开启 MCP Server：`设置` -> `MCP Server` -> 启用
2. 复制连接配置中的 URL 和 Bearer Token

## 安装依赖

```bash
pip install requests
```

## 获取 Token

在 tavo MCP Server 设置页面复制 Bearer Token。

## 命令示例

### 创建世界书（故事）

```bash
# 先准备故事数据
python tavo_mcp.py create-worldbook "斗破苍穹" story.json --url http://192.168.1.100:7347/mcp --token YOUR_TOKEN
```

### 创建群聊

```bash
python tavo_mcp.py create-chat "萧炎篇" char_ids.json --worldbook 42 --mode scenario --url ... --token ...
```

### 创建角色

```bash
python tavo_mcp.py create-character xiaoyan.json --url ... --token ...
```

### 列出资源

```bash
python tavo_mcp.py list chats --url ... --token ...
```

## 数据格式

### 故事 JSON (story.json)

```json
{
  "name": "斗破苍穹·萧炎篇",
  "world_rules": "【世界观】\\n斗气大陆，等级分为：斗之气、斗者...",
  "chapters": [
    {
      "name": "第一章：觉醒",
      "content": "【剧情】主角在乌坦城偶遇萧炎...",
      "keywords": ["觉醒", "乌坦城"],
      "completion_condition": "与萧炎对话3次;获得玄阶功法"
    },
    {
      "name": "第二章：入门",
      "content": "【剧情】主角决定加入萧家修炼...",
      "keywords": ["入门", "萧家"],
      "completion_condition": "完成萧战的任务"
    }
  ]
}
```

### 角色 JSON (character.json)

```json
{
  "name": "萧炎",
  "first_mes": "（目光落在你身上）你是谁？",
  "description": "乌坦城萧家的天才少年...",
  "personality": "表面冷漠，内心正义"
}
```

### 角色 ID 列表 (char_ids.json)

```json
[12, 34, 56]
```

## API 映射

| 功能 | MCP 函数 |
|------|----------|
| 创建世界书 | `tavo_lorebook_create` |
| 获取世界书 | `tavo_lorebook_get` |
| 更新世界书 | `tavo_lorebook_update` |
| 创建角色 | `tavo_character_create` |
| 获取角色 | `tavo_character_get` |
| 创建聊天 | `tavo_chat_create` |
| 更新聊天 | `tavo_chat_update` |
| 列出聊天 | `tavo_chat_list` |