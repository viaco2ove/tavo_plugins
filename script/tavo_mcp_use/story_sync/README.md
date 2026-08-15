# story_sync — 通用「故事 → tavo」同步工具

把任意故事目录里的 `story_sync_config.json` 同步到 tavo（创建 / 编辑，幂等可重跑）。
故事数据**不写死在脚本里**，换故事只需换目录 + 配置。

## 解决的历史错误

1. **头像**：必须用 `tavo_file_save` 落为 `files/global/<name>` 文件引用，再经
   `tavo_character_import_card`（角色）或 `tavo_persona_create`（用户身份）整卡/整身份导入。
   **绝不**内联 base64，也**绝不**依赖 `tavo_character_update`（它不持久化 avatar）。
2. **用户身份**：玩家角色 = persona 资产（`kind: persona`），经 `tavo_persona_create` 建并
   `set_active`，再用 `tavo_chat_update({personaId})` 绑定群聊；玩家角色**不**作为 NPC 进
   `characterIds`（否则出现「用户 X + NPC X」双实体）。

## 配置文件 `story_sync_config.json`

放在故事目录下，字段：

| 字段 | 说明 |
|------|------|
| `story_name` | 故事名（世界书缺省名） |
| `chat_name` | 群聊名（缺省 = `story_name · 第1章`） |
| `response_mode` | 群聊响应模式，默认 `scenario` |
| `bind_persona` | 是否把 persona 绑定到群聊（默认 true） |
| `persona` | **用户身份**：`{name, description, first_mes, personality, avatar_file}`；`avatar_file` 相对故事目录 |
| `characters` | **NPC 角色数组**：每个 `{name, description, first_mes, personality, avatar_file}` |
| `worldbook.name` | 世界书名 |
| `worldbook.intro` | 故事简介（作为 constant 常驻条目，可选） |
| `worldbook.source` | worldbook 源 JSON 相对路径（如 `worldbook/worldbook.json`），其 entries 会被转换 |
| `chapters.dir` | 章节 JSON 目录（相对路径）；每章转成一个 keyword 条目 |
| `chapters.enabled_first_only` | 仅第一章默认启用（默认 true） |

> `avatar_file` / `worldbook.source` / `chapters.dir` 均**相对故事目录**解析。

## 用法

```bash
# 连通性自检
python story_sync.py <故事目录> --check

# 预演（不落库）
python story_sync.py <故事目录> --dry

# 正式同步（幂等，可安全重跑）
python story_sync.py <故事目录>

# 强制重导所有角色/身份（换头像或大幅改文案）
python story_sync.py <故事目录> --force

# 重建世界书（旧世界书需手动删除后换名/重跑）
python story_sync.py <故事目录> --rebuild-worldbook

# 覆盖连接
python story_sync.py <故事目录> --url http://127.0.0.1:7347/mcp --token TOKEN
```

## 同步策略（幂等）

- **世界书**：按名 search，命中复用，缺失才建。
- **用户身份**：按名 search，命中复用并激活，缺失才建（persona 无 update/delete MCP）。
- **角色**：按名 search，命中比对 avatar/文本，有差异或 `--force` 走 `import_card` 换新卡 → 重绑 → 删旧；无差异复用。
- **群聊**：按名 search，命中 `chat_update` 重绑，缺失 `chat_create`。

连接配置读项目根 `.env` 的 `tavo_mcp_url` / `tavo_mcp_toekn`（键名 toekn 是历史拼写）。
