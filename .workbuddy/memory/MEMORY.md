# 项目长期记忆（tavo_plugins）

## tavo MCP 推送流程（Toonflow-game 故事）
- 连接配置在 `tavo_plugins/.env`：`tavo_mcp_url` / `tavo_mcp_toekn`（注意键名是 **toekn** 拼写）。`.env` 主配（未注释）= **手机** `http://192.168.1.23:7347/mcp` + token `3ts67a`；注释行 `127.0.0.1:7347` + `34rxzr` = **AVD 模拟器**本机 ADB 通道。**手机与模拟器是两个独立 tavo 实例，chat id 不通用**：手机上故事《谁让这个山大王修仙的》= **chat 8**（12 NPC id 7-18 + persona 3）；模拟器上同名故事 = chat 2（NPC id 25-36 + persona 2）。**推送/上传必须对 `.env` 主配的目标实例**，别误连模拟器把数据上错地方。手机 IP 随 WiFi 变化：曾用 10.10.2.208（公司段）/ 192.168.31.219（家庭段）/ 192.168.1.23（当前）。换网后先 `adb shell ip addr show wlan0 | grep inet` 查 IP 再改 `.env`。
- 推送脚本：`tavo_plugins/.cache/story/<故事名>/push_to_tavo.py`，支持 `--check`(连通自检) / `--dry`(dryRun 预演) / 正式推送；角色+世界书均先 search 复用、否则 create，**可安全重跑不重复**。
- **tavo 字段约定（务必遵守）**：
  - chat 对象用 camelCase：`characterIds`、`lorebookIds`、`responseMode`(enum natural/everyone/manual/scenario)、`title`(或 name 别名)。
  - lorebook entry 用 Tavo-native 形状：必填 `identifier`+`content`+`strategy`(constant|keyword)；关键词 `keywords`(复数)；`probability` 0-100；`completion_condition` 等非标准字段会被忽略。
  - character create 用 CCv3 形状（name/description/first_mes/personality 必填）；`roleType` 非标准、会被忽略（Tavo 角色卡不持久化该字段，get 回来是 None）。
  - **「旁白」建模约定**：Toonflow-game 里旁白是系统自带角色类型（roleType=narrator），Tavo 没有。tavo_plugins 把旁白做成 Tavo 里一个真实角色（故事《谁让这个山大王修仙的》chat 2 中 id=36），`roleType:'narrator'` 写进 CCv3 data；因 Tavo 忽略该字段，插件用 description 文本兜底识别（`**角色类型**：旁白` → 正则 `角色类型[:：]旁白|系统旁白|系统叙事者?` → narrator）。信息面板对旁白不显示 HP/MP/等级（无战斗数值）；发言器入参把旁白列为"系统叙事者"；编排提示词明确旁白只负责场景描述/时间流转/效果说明。新增旁白只需在 `story_sync_config.json` 的 characters 加该条目 + 提供 `avatars/旁白.png`。
  - create 返回 id 在 `content[0].text` 的 JSON 字符串的 `"id"` 字段。
- 推送目标：世界书=故事蓝图（constant 世界规则 + keyword 章节/角色/地点），群聊 responseMode=scenario 实现 design.md 的多角色演出效果。

## ⚠️ Tavo 变量读取铁律：`tavo.get` / `T.get` 必须解包（写插件前必读）
- `tavo.get(name, 'chat')` **不返回值本身**，返回包装对象 `{target, name, found, value}`，真实数据在 `.value`。
- MCP 侧同理：`tavo_variable_get` → `result.content[0].text` 是 JSON 字符串，解析后仍是上面这个包装形状。
- **不解包的后果（真实踩过）**：`edit.chapters`/`story.characters`/`card.level` 全 undefined → 代码误判"数据为空"→
  用默认值兜底覆盖 → 用户看到「故事配置被清空、角色参数全空」。此外 `get(k) === 'single'` 永远 false、
  `!!get('flag')` 永远 true（包装对象恒真）、迁移/一次性标记永远读不到。
- **统一做法**：每个插件（entry.js 与 ui/*.html 各自一份）定义 `readChatVar(name)`：
  循环解包（判据 `hasOwnProperty('value') && hasOwnProperty('name')`，guard<5，`found===false` 返回 null），
  末尾对 `{`/`[` 开头的字符串再 `JSON.parse` 兜底。所有变量读取只走它。
- **面板绝不做破坏性写回**：读不到有效值时只在内存用默认值，**不得** `save*Var()` 覆盖持久化变量。
- MCP 参数细节：`tavo_variable_get/set` 用 **`scope`**（不是 `target`）；`chatId` 必须**整型**
  （`"2"` 与 `2` 被当作不同作用域，写了 get 不到）；`tavo_character_get` 的 id 也必须整型。
- 变量分层：`tmm_story_static`（受保护静态基准卡，重启不重建）→ `tmm_story`（chat:opened 从 static 深拷贝派生的展示层）
  → `tmm.cards`（动态增量，派生后 merge 回展示层）。`tmm_story` 缺失是正常的，会自动派生。
- 校验手段：`node --check plugins/*/entry.js`；HTML 内联脚本用 `script/tavo_mcp_use/_check_html_js.py` 抽出来逐块校验。
- 现场诊断：`script/tavo_mcp_use/diag_dump.py`（解包打印关键变量）、`build_static.py`（从角色描述预建静态卡）、`_dump_static.py`（列参数卡）。
- **改了 ui/*.html 必须重装插件**（HTML 片段不热替换）；只改 entry.js 可「禁用→启用」生效。
- **`tavo.plugin.search` 不带 query 返回空列表**（MCP 的 `tavo_plugin_search` 同理）。绝不能用"查不到"推断
  "插件未安装" —— event_manager 曾因此把 `tf_story.edit.orchestration` 默认值写成 `system`（跟随系统、插件不接管）。
  正确做法：`stageState()` 返回 `enabled|disabled|unknown`，多次带 query 探测（pluginId / 'toonflow' / '编排' / 无 query），
  查不到就返回 unknown；**只有明确查到且 enabled===false 才算 disabled**，其余一律按默认「插件接管」(`plugin`)。

## tavo_plugins 设计「靠山」映射（跨项目参考约定）
做 tavo_plugins 的 UI / 业务 / 提示词时，分别对齐以下真源，不要另起炉灶：
- **UI → `Toonflow-game-web`**（web_project_windows）：`D:\Users\viaco\tools\Toonflow-game\Toonflow-game-web`（src 含 api/components/composables，即前端界面真源）
- **业务/剧情引擎逻辑 → `toonflow-game-app`**（current_project_windows）：`D:\Users\viaco\tools\Toonflow-game\toonflow-game-app`（src/lib 含 gameEngine.ts/fixDB.ts/roleParameterCard.ts 等）
- **提示词/世界知识设计 → 两份文件**：
  1. 世界知识 Agent 设计：`toonflow-game-app\md\curr_design\剧情编排\自由模式\世界书\复刻酒馆\世界知识_agent.md`
  2. Toonflow-game 提示词库（多 Agent 编排）：`toonflow-game-app\src\lib\fixDB.prompts.ts`

## 章节背景图业务（chapters_import.py 已落地）
- **根因澄清**：章节 JSON 里 `backgroundPrompt` 是 AI 生图提示词（调 `tavo_image_generate`），**不是**图片路径；`background` 字段是源 JSON 里指向本地缓存图的路径（如 `image/bg.jpg`）。`chapters_import.py` 旧代码把 `backgroundPrompt` 当字符串塞进 `background` → 面板把提示词当图路径。
- **正确流程（已写入 `script/tavo_mcp_use/chapters_import.py`）**：
  - `--bg auto`（默认）：优先上传本地 `background`/约定 `image/<base>_background.<ext>` 图（`tavo_file_save` → `files/<scope>/<name>`）；本地没有才调 `tavo_image_generate` 生图。
  - `--bg local`：只上传本地图；`--bg generate`：只 AI 生图；`--bg skip`：不动背景。
  - `--bg-scope {chat,global}`（默认 chat）；`--force-bg` 强制重传/重生；`--dry` 纯本地预览（不联网）。
  - 失败绝不崩：生图端点不可用时告警并继续（auto 回退本地），绝不把提示词当路径写进去。
- **⚠️ tavo 图像端点当前不可用**：`tavo_image_generate` 在 AVD 实例返回 `500: Unsupported resource type: imageEndpoint`（服务端没配图像生成后端）。要在代码里启用 AI 生图，需先在 tavo App 开启/配置图像生成；在那之前 `--bg generate` 会失败，`--bg auto` 自动回退本地上传（现在就能出真实背景）。
- 落库：`background` 写 `files/chat/<name>` 虚拟路径，面板可渲染；`backgroundPrompt` 原样保留。

## 连接/通道与 chat 编号（实测，2026-08-16）
- **本机 ADB 通道比 WiFi IP 更稳**：`.env` 主配 `192.168.1.23:7347`(家庭段, token `3ts67a`) 经常 502（手机不在该 WiFi）；注释里的 `127.0.0.1:7347` + token `34rxzr` 走 ADB 端口转发，只要 `adb` 转发在、tavo App 开着就通。脚本可用 `--url http://127.0.0.1:7347/mcp --token 34rxzr` 覆盖 `.env` 跑，无需改 `.env`。
- **故事聊天是 chat 2（id=2）**，名「谁让这个山大王修仙的！ · 第1章」。用户口中的「chat 8」在当前实例不存在（`Resource not found`）——应是记混或属于另一个不可达实例（192.168.1.23 现在 502）。凡涉及该故事，默认操作 chat 2。
- `tavo_chat_list` 工具**不存在**（报 Method not found），查 chat 用 `tavo_chat_search`/`tavo_chat_get`。
- `tavo_chat_reset` 会清 chat 作用域变量（`tf_story.edit` 等）——所以 `chapters_import`/`build_static` 对关键变量双写 global+chat，且 `tmm_story_static` 走 global 受保护；但 `files/chat/*` 背景图若用 chat 作用域，reset 后文件可能丢（路径字符串仍在，图裂）。要更抗 reset 用 `--bg-scope global`。

### 插件发布到 hub（不是 MCP，是独立脚本）
- **发布机制在 `script/tavo_pluginhub/pluginhub.py`**，对接 `https://hub.tavo.cc/api/v1/creator/plugins`（hub 网页版 `hub.tavoai.dev`）。**MCP 没有发布/hub 工具**（只有 install/package/set_enabled 等本地管理），所以"发布到 hub"必须走这个脚本，别在 MCP 工具里找。
- 认证：`.env` 的 `sid=xxx`（从 hub.tavoai.dev 登录后取；当前 `sid=3f164505-cf78-4aed-9572-a4da480f310c`）。
- 流程：先把插件打包成 `.tpg`（zip 即 .tpg，可用 `plugin_install.build_zip` 或 `tavo_plugin_package`，但后者 sourcePath 必须是手机端目录、传本机路径报 Invalid params）；再 `pluginhub.py list` 查已发布 `_id`；已存在走 `update <_id> <tpg>`（check-package+publish 两步），不存在走 `publish <tpg>`（id 已存在会报 package_id_taken）。
- 注意 Python 传参必须用 Windows 路径（`D:/...` 或 `D:\...`），不能用 Git Bash 的 `/d/...`，否则 FileNotFoundError。
- 已发布清单（2026-08-16）：multi-character-stage/style/speaker/event-manager/memory-manager 5 个；eruda 调试面板未发布。event-manager 现 published v1.3.4。

## 关键设计约束（来自两份参考，设计 tavo_plugins 必须遵守）
1. **世界知识 = 上下文注入，不是脚本章节**：worldbook entry 只把 `content` 发给模型；`title`/`keys`/`category`/`order`/`agentList` 仅用于匹配筛选+前端展示。`agentList` 控制注入范围（空或含"all"=全 Agent 可见；填具体 Agent Key=只发给该 Agent）。注入引擎逻辑：constant 全收；非 constant 按 `keys` 匹配 scanText + category 白名单 + token 预算截断。→ tavo lorebook 的 `keywords` 对应 Toonflow 的 `keys`；**绝不要把"所有 keyword entry"当章节脚本自动推进**（这是之前 toonflow_story_event_manager 污染聊天的根因）。
2. **多 Agent 剧情编排模式（fixDB.prompts.ts）**：总调度 story_main / 编排师 story_orchestrator(NPC优先) / 发言器 story_speaker / 记忆管理器 story_memory / 章节判定 story_chapter / 事件进度 story_event_progress / 小游戏解析 / 意图分析 intent_analyzer / 任务编排 task_director+task_speaker。**NPC优先原则**：优先 NPC 或万能角色发言推进，旁白只做场景描述/时间流转/技能说明。万能角色不能替代列表里已存在的具体角色；`@角色名`=指名编排该角色发言。数值(hp/mp/exp/level)必须纯数字，禁止中文替代。

## tavo 立绘（sprite）可行性结论（2026-08-17 分析）
- **制作**：PC 抠图（BiRefNet/MODNet/云API）→ `tavo_file_save` 上传 `files/chat/sprite_<characterId>.png`。手机本地抠图❌（算力）；云API⚠️（依赖网络/密钥）。`tavo_image_generate` 当前不可用（500），抠图必须 PC 侧完成。
- **存储**：不用角色卡非标字段（Tavo 不持久化，roleType 实测被忽略❌）；用 chat 变量 `tf_sprites={角色名:图路径}` 或命名约定 `sprite_<characterId>.png`。✅
- **显示**：tavo 原生不支持「背景+去背立绘分层融合」❌，必须插件。方案=新建 toonflow_story_sprite：htmlFragment 挂立绘层（position 悬浮，z-index 介于原生背景层与消息流层之间）+ entry.js 监听 message:added，`tavo.message.find` 取最新消息 `characterName` → 查 `tf_sprites` → 切 `<img src>`。

## 立绘 / sprite 设计约定（toonflow-game 对齐，2026-08-17）
- **Toonflow-game 立绘真源**：`Toonflow-game-web/src/components/LayeredAvatar.vue`：两层图片，`backgroundPath` 全铺 cover + `foregroundPath` 底部居中 contain。角色字段：`StoryRole.avatarPath`→foreground，`avatarBgPath`→background，`avatarSourcePath`→分离前原图。
- **下载资源映射**（`.cache/story/<故事>/ex/avatars/<角色>/`）：
  - `original.png` (1024×1024 RGB) → foreground 立绘 / source 原图
  - `background.png` (768×768 RGB) → 立绘氛围背景（不是透明去背，是虚化/氛围）
  - `avatar.webp/png` (512×512 RGBA) → 小头像
  - `voice.wav` → 音色参考
- **tavo 侧实现方式**：不用角色卡 `data.avatar`（MCP 写不进去，已踩坑），所有图走 `tavo_file_save` 上传到 `files/chat/sprite_fg_<id>.png`、`files/chat/sprite_bg_<id>.png` 等，再用 chat 变量 `tf_sprites` / `tf_chapter_backgrounds` / `tf_story_config` 做映射；插件 `toonflow_story_sprite_background` 用 htmlFragment 挂前景+背景层，监听 `message:added` 按当前说话角色切换。
- **设计文档**：`md/currdesign/toonflow_sprite_background/toonflow_sprite_background_design.md`。
- **与现有插件协作**：`event_manager` 维护 `tf_story.edit.chapterIndex` 用于切章节背景；`speaker/multi_character_stage` 提供角色识别，sprite 只负责视觉层。
- **未实测风险**：`files/chat/sprite_*.png` 在插件 htmlFragment 的 `<img>` 里是否真渲染；立绘层 z-index 能否卡在原生背景之上、消息气泡之下。
- **已验证 API**：htmlFragments 可挂 `/chat/body/start|end`；`tavo.message.find([s,e])` 返回含 `characterName`；`tavo.get(name,'chat')` 须解包；`files/chat/<name>` 虚拟路径可被前端渲染（章节背景 background 已验证）。
- **两个待实测风险**：① 立绘 `<img src="files/chat/x.png">` 是否真能渲染（高概率可行，未实测）；② 立绘层 z-index 能否卡在原生背景之上、消息流之下（需探 tavo DOM 层级）。
- **[用户澄清 2026-08-17] 头像≠立绘，tavo 原生做不了真立绘**：
  - 角色卡（CCv3）只有单 `data.avatar` 字段，**无 Gallery/多图**（Grep 全项目无 gallery/imageList 证据）；`avatar` 必须文件引用（`charaCard/...png` 或 `files/global/...`），不能 base64（客户端不渲染内嵌 base64）。
  - tavo 图能力仅两体系：① 头像 `avatar`（气泡旁小图，四种样式 avatar/radius/name）；② 背景 `background.image`（`files/chat/...` 或网图）+ 可设 `useAvatar:true` 把**当前角色头像铺满当背景**。
  - `useAvatar:true` 看似"立绘"实为"头像放大铺满"，无分层/透叠/消息流居中层次，**不是真立绘**。APNG 只是让头像动起来，本质仍是头像。
  - 抠图全身图塞进 avatar：要么被裁成气泡小图，要么靠 useAvatar 糊满屏，均非立绘。→ 立绘必须插件 + 全局 `files/` 存储（每角色 `sprite_<id>.png`）+ 变量/插件按 id 映射取，角色卡本身不存立绘。
  - 格式：静态 webp 上传循环含 `("png","jpg","jpeg","webp")`（chapters_import/story_sync 实证），Flutter/Android 原生支持显示；APNG 用户记忆 v0.62.2+ 支持动画头像；animated webp 未证实。格式支持 ≠ 立绘支持。
