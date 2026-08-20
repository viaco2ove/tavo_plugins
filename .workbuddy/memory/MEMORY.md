# 项目长期记忆（tavo_plugins）

## 连接与实例（实测 2026-08-19）
- 连接配置在 `tavo_plugins/.env`：`tavo_mcp_url` / `tavo_mcp_toekn`（键名是 **toekn** 拼写）。**当前主配 = 模拟器** `http://127.0.0.1:7347/mcp` + token `28pd43`（ADB 端口转发，比手机 WiFi IP 稳）；`tavo_mode=emulator`，`avd_device=emulator-5554`。手机 WiFi IP（192.168.1.23 等）经常 502。
- **实例曾重置**：模拟器上故事《谁让这个山大王修仙的》现为 **chat 1**（角色 id 99-109 + persona 12 + 旁白），旧记录里的 chat 2 / 手机 chat 8 均已过时。凡涉及该故事默认操作 **chat 1**。手机与模拟器是独立实例，chat/角色 id 不通用。
- `tavo_chat_list` 工具不存在；`tavo_chat_search`/`tavo_plugin_search` 空 query 返回空列表（**不能**据此推断"不存在"）。枚举 chat 用 `tavo_current_chat_get` 或遍历 `tavo_chat_get {id:1..N}`（注意参数名是 `id` 不是 `chat_id`）。
- `tavo_chat_reset` 清 chat 作用域变量 → 关键变量双写 global+chat；`tmm_story_static` 走 global 受保护；抗 reset 背景图用 `--bg-scope global`。

## ⚠️ 变量读取铁律（写插件前必读）
- TavoJS `tavo.get(name,'chat')` 返回包装对象 `{target,name,found,value}`，真实数据在 `.value`。每个插件定义 `readChatVar()` 循环解包（guard<5，`found===false` 返 null，`{`/`[` 开头字符串再 JSON.parse）。**MCP 侧无此问题**：`tavo_variable_*` 返回 `content[0].text` JSON，解析后取 `.variables` 即真身。
- 不解包后果：误判数据为空 → 默认值覆盖持久化变量 → 「配置被清空」。面板读不到有效值只在内存兜底，**绝不破坏性写回**。
- MCP 参数：变量工具用 **`scope`+`chatId`（整型，`"1"`≠`1`）**；`tavo_chat_get` 用 `id`；`tavo_character_get` 的 id 也整型。
- 变量分层：`tmm_story_static`（global 受保护静态卡）→ `tmm_story`（chat:opened 派生展示层，缺失正常会自动派生）→ `tmm.cards`（动态增量 merge 回展示层）。
- **枚举变量用 `tavo_variable_list`**（2026-08-19 实测）：按 scope 返回完整变量树，无需预知变量名。当前全景：global 11 根 + chat 13 根，全为插件创建（`tf_*`/`tmm*` 前缀），**tavo 原生不预置任何变量**；message 作用域可用但当前为空。详见 `md/currdesign/变量设计/变量列表.tavoself.md`；拉取脚本 `script/tavo_mcp_use/_dump_all_variables.py`。
- 变量清单（chat 1 / global，2026-08-19）：`tf_story{edit,boot}`、`tf_progress`（章节进度状态机）、`tf_sprites.byName`（立绘 12 角色，fg=webp/bg=png）、`tf_chapter_backgrounds`、`tf_sprite_fallback_bg`、`tf_sprite_persona_name`、`tf_voice_files`（TTS）、`tf_llm`、`tf_style`、`tmm_story_static`、`tf_test_global`（测试残留可清）；chat 侧另有 `tmm`（记忆）、`mcs_free_mode_seen`、`tf_orch`（编排锁）、`tf_last_speaker`。
- 校验：`node --check plugins/*/entry.js`；HTML 内联脚本用 `script/tavo_mcp_use/_check_html_js.py`。改 ui/*.html 必须重装插件；只改 entry.js 可禁用→启用生效。
- 诊断脚本：`diag_dump.py` / `build_static.py` / `_dump_static.py` / `_probe_variable_tools.py`。

## tavo MCP 字段约定
- chat 用 camelCase：`characterIds`/`lorebookIds`/`responseMode`(natural/everyone/manual/scenario)/`title`。
- lorebook entry 用 Tavo-native：必填 `identifier`+`content`+`strategy`(constant|keyword)；关键词 `keywords` 复数；`probability` 0-100；非标字段被忽略。
- character create 用 CCv3（name/description/first_mes/personality 必填）；`roleType` 不持久化，插件用 description 文本兜底识别（`**角色类型**：旁白` → narrator）。旁白=真实角色+文本兜底，无战斗数值。
- create 返回 id 在 `content[0].text` JSON 的 `"id"` 字段。
- 推送脚本 `tavo_plugins/.cache/story/<故事名>/push_to_tavo.py`（--check/--dry，search 复用否则 create，可安全重跑）。

## 设计「靠山」映射
- UI → `D:\Users\viaco\tools\Toonflow-game\Toonflow-game-web`（src/components 等）
- 业务/引擎 → `D:\Users\viaco\tools\Toonflow-game\toonflow-game-app`（src/lib：真引擎 NarrativeOrchestrator+SessionService，gameEngine.ts 只是状态归一化库）
- 提示词 → `toonflow-game-app\src\lib\fixDB.prompts.ts`（33 个 `_PROMPT_*`）+ 世界知识_agent.md
- 完整提取文档在 `.hide/toonflow_game/`（15 个项目文档 + agents/system_prompts 33 个 + user_prompts 12 个；创作侧 5 个分镜/生图提示词在 `system_prompts/not aigame/`）

## 关键设计约束
1. 世界知识=上下文注入非脚本章节：entry 只把 `content` 发模型；constant 全收，非 constant 按 `keywords` 匹配。绝不要把 keyword entry 当章节脚本自动推进（event_manager 污染聊天根因）。
2. 多 Agent 编排（fixDB.prompts.ts）：orchestrator(NPC优先)/speaker/memory 核心，chapter/event_progress 状态机，mini_game/intent/task 流水线。NPC优先：旁白只做场景描述/时间流转/技能说明；`@角色名`=指名发言；hp/mp/exp/level 必须纯数字。
3. `tavo.plugin.search` 查不到≠未安装：`stageState()` 返回 enabled|disabled|unknown，**只有明确查到且 enabled===false 才算 disabled**，否则默认插件接管(`plugin`)。
4. **编排插件中心枢纽（2026-08-20）**：意图识别、章节判定、事件进度、记忆状态全部收敛到 mcs（`input:beforeSend`）。通过 `window.tfStoryJudge`/`window.tmmIntent` 与 event_manager/memory_manager 通信；mcs 自己不做意图/章节逻辑，只调用 API 获取状态注入编排 prompt。
   - `classifyIntent()` → keyword/LLM 识别，指令类（@记忆管理/@事件进度）让出
   - `buildMemoryContext()` → 读 `tmm`/`tmm_story`，返回角色参数卡注入编排 prompt
   - `window.tmmIntent.refresh()` → 编排前异步触发记忆刷新
   - `window.tfStoryJudge.checkAndAdvance()` → 获取章节+Phase/Event 状态
   - `trigger_memory_agent=true` → 编排 Agent 触发额外记忆刷新

## 章节背景图 / 立绘（已落地）
- `chapters_import.py`：`--bg auto|local|generate|skip` + `--bg-scope`；`backgroundPrompt` 是 AI 生图提示词**不是路径**；失败回退本地上传绝不崩。`tavo_image_generate` 在 AVD 曾报 500（服务端没配图像后端）。
- 立绘：tavo 原生无前景立绘图层（只有头像线 avatar 单图 + 背景线 background/useAvatar 铺满，头像≠立绘，APNG=动画头像），必须插件。方案=PC 抠图 → `tavo_file_save` 上传 `files/chat/sprite_fg_<id>.webp` + `sprite_bg_<id>.png` → 变量 `tf_sprites` 映射 → 插件 htmlFragment 分层显示。设计文档 `md/currdesign/toonflow_sprite_background/toonflow_sprite_background_design.md`。
- 资源映射（`.cache/story/<故事>/ex/avatars/<角色>/`）：`original.png`(1024 RGB)→foreground，`background.png`(768 RGB)→氛围背景，`avatar.webp`(512 RGBA)→小头像，`voice.wav`→音色。
- MCP 写不进角色卡 `data.avatar`，所有图走 files/ + 变量映射。静态 webp 支持实证。

## 插件发布到 hub（独立脚本，非 MCP）
- `script/tavo_pluginhub/pluginhub.py` 对接 `https://hub.tavo.cc/api/v1/creator/plugins`（网页 hub.tavoai.dev）。认证 `.env` 的 `sid`。
- 流程：打包 .tpg → `pluginhub.py list` 查 `_id` → 已存在 `update <_id> <tpg>`，否则 `publish <tpg>`。Python 传参必须 Windows 路径（`D:/...`），不能用 Git Bash `/d/...`。
- 已发布：multi-character-stage/style/speaker/event-manager/memory-manager 5 个；eruda 未发布。
