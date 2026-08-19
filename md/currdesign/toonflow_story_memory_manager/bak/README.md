# toonflow_story_memory_manager 插件设计

> 把 Toonflow-game 的「记忆管理器」agent（`story_memory_manager`）移植为 tavo 插件。

## 一句话定位

为任意 tavo 聊天提供**结构化长期记忆**：每轮对话后异步提炼剧情摘要、事实、标签、动态世界背景与角色参数卡补丁；在下一次生成前把记忆上下文注入模型请求；用户可用 `@记忆管理` 指令直接管理记忆。

## 触发机制（看齐 toonflw game）
SessionMemoryWorker 负责后台异步记忆刷新：

```typescript
// 每30秒轮询活跃会话，触发记忆更新
startSessionMemoryWorker();
```
- 后台异步线程：每30秒轮询活跃会话：读取该 session 最近 20 条消息（倒序） 对比 lastProcessedMessageId，有新消息才处理：refreshStoryMemoryBestEffort
- 意图分析触发：意图分析器认为是记忆管理需求是，例如@记忆管理 xxxx
- 编排师：编排师返回 trigger_memory_agent: true
- 关键节点触发（事件/章节生命周期）
 Toonflow Game 记忆管理 agent 的触发机制。

**总共 4 种触发路径**，按"谁/什么来触发"区分：

### 1️⃣ 编排师判定触发（语义触发，最核心）
- 位置：`fixDB.prompts.ts` 编排师 prompt
- 流程：编排师每轮编排时判断是否"有新信息/变化"（等级、物品、技能、关系、立场等），有就返回 `trigger_memory_agent: true`
- 落点：`SessionService.ts` 看到标志位就调 `refreshStoryMemoryBestEffort`
- 提示词里明确列了 4 个判定点：① 有新信息/变化 ② 用户状态变化（等级/物品/技能） ③ 用户输入 `@记忆管理` ④ 旁白输入 `@记忆管理`

### 2️⃣ 显式指令触发（`@记忆管理`）
- 位置：`PlayerMemoryDirectiveService.ts` + `SessionService.ts` 行 2434
- 流程：用户/旁白输入以 `@记忆管理` 开头的文本（如 `@记忆管理 睡觉恢复`）
- 优先级最高，**不依赖 AI 自由发挥**，直接同步写回用户参数卡并触发记忆刷新
- 配套日志：`story:memory_directive:stats`

### 3️⃣ 后台轮询触发（SessionMemoryWorker）
- 位置：`SessionMemoryWorker.ts`
- 流程：每 **30 秒**扫描活跃 session，对比 `lastProcessedMessageId`，有新消息就拉最近 20 条，调 `refreshStoryMemoryBestEffort`
- 失败退避：失败时 60s 重试
- 活跃状态过滤：仅 `active` / `chapter_completed`
- 异步执行，**首屏不等记忆完成**（设计原则）

### 4️⃣ 关键节点触发（事件/章节生命周期）
- 文档依据：`记忆管理.md` §6.2
- 触发时机：
  - 每个动态事件完成后
  - 章节切换时
  - 关键触发器命中时（`TriggerEngine`）
  - 章节成功/失败
- 实现路径：`ChapterProgressEngine` / `TriggerEngine` 调 `refreshStoryMemoryBestEffort`

---

**简单记**：

| # | 触发方 | 频率 | 关键文件 |
|---|---|---|---|
| 1 | 编排师（AI 判定） | 每轮 | `fixDB.prompts.ts` + `SessionService.ts` |
| 2 | `@记忆管理` 指令 | 不定 | `PlayerMemoryDirectiveService.ts` |
| 3 | SessionMemoryWorker | 30s 轮询 | `SessionMemoryWorker.ts` |
| 4 | 章节/事件/触发器 | 节点性 | `ChapterProgressEngine` / `TriggerEngine` |

如果按"自动 vs 显式"粗分，那就是 **3 种自动**（编排师、轮询、节点）+ **1 种显式**（`@记忆管理`）。_



## 设计文档导航

| 文件 | 内容 |
|------|------|
| [设计文档.md](设计文档.md) | 源 agent 分析、tavo 能力映射、总体架构、核心流程、触发与节流、设置项、风险边界 |
| [提示词设计.md](提示词设计.md) | system / user 提示词模板（compact 与 full 两套）、输出 JSON Schema、解析与清洗规则 |
| [插件包草案.md](插件包草案.md) | 目标文件树、manifest.json 草案、i18n catalog 键表、entry.js 骨架代码 |

## 关键设计决策（摘要）

1. **写入侧异步化**：源系统"发言成功后先提交消息、后台刷新记忆"的原则，映射为在 `message:added` Hook 中 fire-and-forget 启动刷新任务，绝不阻塞聊天流程（生成生命周期 Hook 每个 handler 最多等待 5 秒）。
2. **注入侧走 `generation:prepare`**：把记忆摘要拼进 `event.text`（model-only，不改已保存消息），对应源系统中编排师/发言器消费记忆摘要的机制。
3. **存储用 chat 作用域变量**：全部状态放在命名空间变量 `tmm` 下（`tavo.set/get/update`），随聊天导出/克隆迁移；参数卡补丁默认**只注入不写回**角色卡（tavo 更新角色卡会弹确认框，故写回默认关闭、走手动侧边栏动作）。
4. **`@记忆管理` 直接指令**：源系统的 `@记忆管理` 规则映射为 `input:beforeSend` 拦截——命中即执行记忆管理指令并取消本次发送。
5. **提示词忠实移植**：system 规则采用源系统运行时优先生效的**数据库种子版**（`fixDB.prompts.ts` 的 `_PROMPT_STORY_MEMORY`，含五大章节：工作范围/输入释义/数值公式/指令优先级/输出约束），而非代码保底版；user prompt 的字段来源从 Toonflow 数据库改接 tavo API（映射表见设计文档第 2 节）。同时修正源系统的一个格式矛盾：种子版文字称 `npc_card_patches` 为对象格式，但输出样例与解析器均为数组格式——插件统一为数组格式并在解析层兼容两种（见提示词设计.md 第 0 节）。
6. **compact/full 双模式**：沿用源系统按模型能力选择精简/完整载荷的思路，做成设置项，默认 compact。

## 范围说明

- **移植**：记忆管理器本体（写入侧）+ 记忆注入（读取侧的最小实现）。
- **不移植（v1）**：深度记忆检索器（两阶段检索/凝练）、发言聚焦系统、世界书注入（tavo 世界书由宿主原生注入）、世界时钟/NPC 当前行为（自由模式专属，列入 v2）、台词快照（tavo 消息模型不同，用隐藏消息快照替代，见设计文档 5.4）。

## 状态

- 设计版本：v1.0（2026-08-14）
- 依赖：Tavo `specVersion 2`、TavoJS API（`tavo.generate` / `tavo.plugin.on` / 变量 / 消息 / 长记忆）
- 下一步：按[插件包草案.md](插件包草案.md)落地实现并在备份聊天中测试
