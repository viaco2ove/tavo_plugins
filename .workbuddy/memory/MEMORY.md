# 项目长期记忆（tavo_plugins）

## tavo MCP 推送流程（Toonflow-game 故事）
- 连接配置在 `tavo_plugins/.env`：`tavo_mcp_url` / `tavo_mcp_toekn`（注意键名是 **toekn** 拼写）。
- tavo 是移动端 App（iOS/Android），开发者 Bitbear Limited；文档仅提到 "Dart"（格式转换层），未提及 Flutter。需「设置 → MCP Server → 启用」才会监听端口（7347）。**手机 IP 随 WiFi 变化**：换网后先 `adb shell ip addr show wlan0 | grep inet` 查当前 IP，再更新 `.env` 的 `tavo_mcp_url`。曾用过 10.10.2.208（公司段）/ 192.168.31.219（家庭段）。
- 推送脚本：`tavo_plugins/.cache/story/<故事名>/push_to_tavo.py`，支持 `--check`(连通自检) / `--dry`(dryRun 预演) / 正式推送；角色+世界书均先 search 复用、否则 create，**可安全重跑不重复**。
- **tavo 字段约定（务必遵守）**：
  - chat 对象用 camelCase：`characterIds`、`lorebookIds`、`responseMode`(enum natural/everyone/manual/scenario)、`title`(或 name 别名)。
  - lorebook entry 用 Tavo-native 形状：必填 `identifier`+`content`+`strategy`(constant|keyword)；关键词 `keywords`(复数)；`probability` 0-100；`completion_condition` 等非标准字段会被忽略。
  - character create 用 CCv3 形状（name/description/first_mes/personality 必填）；`roleType` 非标准、会被忽略。
  - create 返回 id 在 `content[0].text` 的 JSON 字符串的 `"id"` 字段。
- 推送目标：世界书=故事蓝图（constant 世界规则 + keyword 章节/角色/地点），群聊 responseMode=scenario 实现 design.md 的多角色演出效果。

## tavo_plugins 设计「靠山」映射（跨项目参考约定）
做 tavo_plugins 的 UI / 业务 / 提示词时，分别对齐以下真源，不要另起炉灶：
- **UI → `Toonflow-game-web`**（web_project_windows）：`D:\Users\viaco\tools\Toonflow-game\Toonflow-game-web`（src 含 api/components/composables，即前端界面真源）
- **业务/剧情引擎逻辑 → `toonflow-game-app`**（current_project_windows）：`D:\Users\viaco\tools\Toonflow-game\toonflow-game-app`（src/lib 含 gameEngine.ts/fixDB.ts/roleParameterCard.ts 等）
- **提示词/世界知识设计 → 两份文件**：
  1. 世界知识 Agent 设计：`toonflow-game-app\md\curr_design\剧情编排\自由模式\世界书\复刻酒馆\世界知识_agent.md`
  2. Toonflow-game 提示词库（多 Agent 编排）：`toonflow-game-app\src\lib\fixDB.prompts.ts`

### 关键设计约束（来自两份参考，设计 tavo_plugins 必须遵守）
1. **世界知识 = 上下文注入，不是脚本章节**：worldbook entry 只把 `content` 发给模型；`title`/`keys`/`category`/`order`/`agentList` 仅用于匹配筛选+前端展示。`agentList` 控制注入范围（空或含"all"=全 Agent 可见；填具体 Agent Key=只发给该 Agent）。注入引擎逻辑：constant 全收；非 constant 按 `keys` 匹配 scanText + category 白名单 + token 预算截断。→ tavo lorebook 的 `keywords` 对应 Toonflow 的 `keys`；**绝不要把"所有 keyword entry"当章节脚本自动推进**（这是之前 toonflow_story_event_manager 污染聊天的根因）。
2. **多 Agent 剧情编排模式（fixDB.prompts.ts）**：总调度 story_main / 编排师 story_orchestrator(NPC优先) / 发言器 story_speaker / 记忆管理器 story_memory / 章节判定 story_chapter / 事件进度 story_event_progress / 小游戏解析 / 意图分析 intent_analyzer / 任务编排 task_director+task_speaker。**NPC优先原则**：优先 NPC 或万能角色发言推进，旁白只做场景描述/时间流转/技能说明。万能角色不能替代列表里已存在的具体角色；`@角色名`=指名编排该角色发言。数值(hp/mp/exp/level)必须纯数字，禁止中文替代。
