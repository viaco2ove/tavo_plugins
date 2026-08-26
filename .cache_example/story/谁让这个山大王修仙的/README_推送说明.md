# 谁让这个山大王修仙的 · tavo 推送包

> 本目录是《谁让这个山大王修仙的！》故事的 tavo 可推送产物，依据
> `../../../../md/currdesign/plugins/toonflow_story_multi-character_stage/design.md`（世界书=故事蓝图 + 角色=原生 Character）。

## 目录内容

- `tavo_story_payload.json` —— 一键推送用的完整载荷
  - `characters`：12 个角色卡（纯小白 player + 11 NPC/general）
  - `worldbook.entries`：45 条世界书入口
    - 11 条 `constant`（故事简介 + 世界总纲 + 财气眼 + 战斗公式 + 等级体系 + 主角规则 + 旁白规则 + 灵石经济 + 突破机制 + 金手指体系 + 任务奖励）
    - 34 条 `keyword`（地理/势力/地点/角色/物品/事件/随机 + 2 个章节入口）
- `build_tavo_payload.py` —— 从 `worldbook/worldbook.json` + `chapters/` + `roles/` 重新生成载荷
- `push_to_tavo.py` —— 读取 `.env`（`tavo_mcp_url` / `tavo_mcp_toekn`），推送到 tavo
- 其余 `avatars/ chapters/ roles/ worldbook/ story.json STORY.md` —— 与参考故事一致的暂存副本

## 推送步骤

```bash
# 1) 确保本机能连到 tavo MCP（参考 .env 的 tavo_mcp_url）
cd .cache/story/谁让这个山大王修仙的
python push_to_tavo.py --check      # 连通性自检

# 2) 真正推送：创建 12 角色 -> 创建世界书 -> 创建群聊(scenario)
python push_to_tavo.py
```

推送成功后会写入 `push_result.json`（含 chat_id / lorebook_id / character_ids）。

## 设计对应关系（design.md）

| design.md | 本包实现 |
|-----------|----------|
| 世界书 = 故事蓝图 | `worldbook.entries`：constant=世界规则，keyword=章节/知识 |
| 角色 = Character | `characters`：tavo_character_create |
| 群聊 + 世界书 + scenario | `tavo_chat_create` 绑定 character_ids + lorebook_ids，response_mode=scenario |
| 章节 completion_condition | 章节入口带 `completion_condition` 字段，供事件管理插件评估 |

## 网络说明

诊断结论（2026-08-14）：`.env` 当前为 `tavo_mcp_url=http://10.10.2.208:7347/mcp`。
- 本机可 `ping` 通 `10.10.2.208`（~29ms，路由正常）；
- 但 TCP `7347` 及常见备用端口（7348/4737/8080/3000/8000）**全部无响应** → tavo 的 MCP Server 当前未监听。

修复步骤（需在 tavo 所在机器上操作）：
1. 打开 tavo 桌面端 → `设置` → `MCP Server` → 启用（记下展示的 URL 与 Bearer Token）
2. 确认 `.env` 的 `tavo_mcp_url` / `tavo_mcp_toekn` 与 tavo 设置页完全一致
3. 回到本目录执行自检：`python push_to_tavo.py --check`（返回「✅ 连通」即可）
4. 真正推送：`python push_to_tavo.py`

> 若 `10.10.2.208` 不是运行 tavo 的机器，请把 `.env` 改为正确的 MCP 地址后重跑。
> 注意 `.env` 键名是 `tavo_mcp_toekn`（历史拼写），脚本已兼容 `tavo_mcp_token`。
