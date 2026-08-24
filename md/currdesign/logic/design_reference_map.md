# tavo_plugins 设计「靠山」映射（跨项目参考索引）

> 做 tavo_plugins 的 UI / 业务 / 提示词时，分别对齐下方真源，**不要另起炉灶**。
> 本文是索引；具体约束见文末"关键设计约束"。

## 一、三处真源

| 关注点 | 靠哪个项目 / 文件 | 绝对路径 |
|---|---|---|
| **UI / 前端界面** | `Toonflow-game-web`（web_project_windows） | `D:\Users\viaco\tools\Toonflow-game\Toonflow-game-web` |
| **业务 / 剧情引擎逻辑** | `toonflow-game-app`（current_project_windows） | `D:\Users\viaco\tools\Toonflow-game\toonflow-game-app` |
| **世界知识（世界书）注入设计** | 世界知识 Agent 设计文档 | `D:\Users\viaco\tools\Toonflow-game\toonflow-game-app\md\curr_design\剧情编排\自由模式\世界书\复刻酒馆\世界知识_agent.md` |
| **提示词 / 多 Agent 编排** | Toonflow-game 提示词库 | `D:\Users\viaco\tools\Toonflow-game\toonflow-game-app\src\lib\fixDB.prompts.ts` |

## 二、各真源怎么用

### 1. UI → Toonflow-game-web
- 前端界面真源。`../../../src` 结构：`api` / `components` / `composables` / `types` / `utils` / `styles.css`。
- tavo_plugins 若要新做 Web UI（配置面板、对话浮层等），组件风格、状态管理、API 调用方式以它为准。
- 注意：tavo 自身的插件 UI 通过 manifest 的 `htmlFragments` / `htmlFragment` 注入（见此前 `toonflow_story_event_manager` 的 `tf-story-panel`），与 web 项目的 Vue 组件是两套体系——tavo 插件 UI 只能挂到 tavo 指定的挂载点。

### 2. 业务 → toonflow-game-app
- 剧情/游戏引擎真源。`src/lib/` 关键文件：
  - `gameEngine.ts`：世界知识注入引擎 `selectWorldBookForInjection`、编排主流程（NarrativeOrchestrator.ts 内编排/发言/记忆注入点）。
  - `fixDB.ts` / `fixDB.prompts.ts`：提示词与"装修/改造"逻辑（fixDB 不动大结构，只加房间/改布局/修毛病）。
  - `roleParameterCard.ts`：角色动态参数卡结构（raw_setting/personality/appearance/voice/skills/items/equipment/level/exp/hp/mp…）。
  - `sessionInitialSnapshot.ts` / `storyRuntimeSettings.ts` / `storyboardChatSessionStore.ts`：会话快照、运行态、剧情会话存储。
- 设计 tavo_plugins 的"业务"逻辑（世界书如何注入、角色卡如何维护、剧情如何推进）时，**对齐这套引擎的语义**。

### 3. 世界知识 Agent → 世界知识_agent.md
- 讲清世界知识如何进入上下文：
  - `agentList` 控制注入范围（空/"all"=全 Agent；具体 Key=只发该 Agent）。
  - 发给模型的是条目的 **`content`**；`title`/`keys`/`category`/`order`/`agentList` 仅做匹配筛选+前端展示。
  - 注入引擎：`constant` 全收；非 constant 按 `keys` 匹配 `scanText` + category 白名单 + token 预算截断。
- 已实现的 Agent 注入点：narrative_orchestrator / story_speaker / story_memory_manager / task_director(+task_speaker)，共 5/18。

### 4. 提示词 → fixDB.prompts.ts
- Toonflow-game 全部提示词常量在此集中维护（模板字符串，改这里即可，fixDB.ts 不动）。
- 多 Agent 体系（按文件内常量名）：
  - `story_main` 总调度、`story_orchestrator`(极简/高级) 剧情编排师、`story_speaker` 角色发言器、`story_memory` 记忆管理器
  - `story_chapter` 章节判定、`story_event_progress` 事件进度
  - 小游戏解析：mini_game / battle / fishing / werewolf / cultivation / mining / research_skill / alchemy / upgrade_equipment
  - `intent_analyzer` 意图分析、`task_director`/`task_speaker`/`task_progress` 任务体系
  - `story_safety` 安全审查、`story_sell_item` 收购商人
- tavo_plugins 内若要写"剧情编排/发言/记忆/章节判定"类提示词，**复用这套人设与规则**（NPC优先、万能角色不可替具体角色、`@角色名` 指名发言、数值纯数字等）。

## 三、关键设计约束（来自两份参考，设计 tavo_plugins 必须守）

1. **世界知识 = 上下文注入，不是脚本章节。**
   - worldbook entry 只把 `content` 发给模型；其余字段仅用于匹配+前端展示。
   - `agentList` 控制注入范围；注入引擎：constant 全收，非 constant 按 `keys` 匹配 `scanText` + category 白名单 + token 预算截断。
   - tavo lorebook 的 `keywords` 对应 Toonflow 的 `keys`。
   - **⚠️ 坑位**：绝不要把"所有 keyword entry"当章节脚本自动推进（此前 `toonflow_story_event_manager` 把 34 条 keyword 全当章节，一开对话就狂刷"场景切换至XXX"+toast，污染聊天）。

2. **多 Agent 剧情编排模式（fixDB.prompts.ts）**
   - 总调度 / 编排师(NPC优先) / 发言器 / 记忆管理器 / 章节判定 / 事件进度 / 小游戏 / 意图分析 / 任务编排。
   - **NPC优先原则**：优先 NPC 或万能角色发言推进；旁白只做场景描述/时间流转/技能说明。
   - 万能角色不能替代列表里已存在的具体角色；`@角色名` = 指名编排该角色发言。
   - 数值（hp/mp/exp/level）必须纯数字，禁止中文替代（满/恢复/提升 等文字只能写进 `other` 字段）。

## 四、本次约定记录时间
2026-08-14，由用户明确指定：tavo_plugins 的 UI/业务/提示词分别靠 Toonflow-game-web / toonflow-game-app / 上述两份文件。
