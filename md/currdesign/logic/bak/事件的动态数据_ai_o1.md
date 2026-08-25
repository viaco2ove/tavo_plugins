# 事件的动态数据生命周期

> 每个事件在运行期间会产生"动态数据"（决策结果、羁绊值、解锁状态等），
> 后续事件或章节判定需要读取。
>
> **设计原则**：事件模板保持静态可编辑，运行时数据存在 `progress` 对象中，
> 由 `dynamicInit` / `dynamicReset` 管理生命周期。

---

## 1. 架构概览

```
事件模板 (chapters/*.json)
  └─ event.variable / event.condition ──→ 声明式，告诉系统"存什么、查什么"

progress (Tavo 变量 tf_progress_{chat_id})
  └─ progress.flags   ← 任意键值的自由存储
  └─ progress.decision / progress.milestones / progress.memory / progress.comments
                        ← 结构化动态字段

getSnapshot(event)    ← 把动态数据序列化，注入编排器快照
evaluateCondition()   ← 读 progress，判断条件是否满足
applyDynamicVars()    ← 把 LLM 输出写回 progress + Tavo 变量
```

---

## 2. 动态字段分类

| 类别 | 存储位置 | 写入时机 | 读取方 |
|------|----------|----------|--------|
| 变量 (`variable`) | `progress.flags[key]` + Tavo 变量 | `applyDynamicVars` | 条件事件、快照 |
| 决策 (`decision`) | `progress.decision` | 用户回复匹配后 | 章节判定、编排器 |
| 里程碑 (`milestone`) | `progress.milestones[name]` | 事件完成时 | 章节判定 |
| 记忆 (`memory`) | `progress.memory` | LLM / 记忆管理器 | 编排器 |
| 旁注 (`comment`) | `progress.comments[]` | LLM 输出后 | 面板展示 |

---

## 3. `progress` 对象结构

```js
{
  // ─── 事件进度 ───
  currentChapter: 0,
  currentPhase: 0,       // 阶段索引（对应 chapterOutlineEvents）
  currentEvent: 0,       // 阶段内事件索引
  completedPhases: [],   // 已完成阶段名 ["初遇阶段"]
  completedEvents: [],   // 已完成事件标记 ["phase:0", "phase:1"]

  // ─── 动态数据 ───
  flags: {},             // 自由键值（variable 写入目标）
  decision: null,        // 当前决策结果（一次性消费）
  decisionHistory: [],   // 历史决策栈
  milestones: {},        // { "事件名": true }
  memory: '',            // 记忆管理器写入的摘要
  comments: [],          // 旁注列表

  // ─── 引导 ───
  pendingGuide: null,    // { summary, goal, instruction } — 章节切换前的引导
}
```

---

## 4. 事件模板中的声明式字段

### 4.1 变量声明 — `event.variable`

告诉系统"事件完成后存一个值"：

```json
{
  "name": "选择阵营",
  "type": "roleplay",
  "variable": "faction",
  "variableScope": "event",
  "condition": { "var": "flags.trust", "op": ">=", "value": "3" },
  "completionCondition": "用户明确选择了阵营"
}
```

`applyDynamicVars()` 执行时：
1. 从 LLM 输出提取值
2. 写入 `progress.flags[variable]`
3. 同步写入 Tavo 变量（chat scope）

### 4.2 条件声明 — `event.condition`

`evaluateCondition(cond, progress)` 支持的操作符：

| 操作符 | 含义 | 示例 |
|--------|------|------|
| `==` | 等于 | `{ var: "flags.faction", op: "==", value: "guild" }` |
| `!=` | 不等于 | `{ var: "flags.faction", op: "!=", value: "bandit" }` |
| `>` / `>=` / `<` / `<=` | 数值比较 | `{ var: "flags.trust", op: ">=", value: "5" }` |

`var` 字段的路径从 `progress` 根开始，如 `flags.trust`、`decision`、`milestones.初遇`。

---

## 5. 核心函数

### 5.1 `dynamicInit(e)` — 初始化事件动态字段

事件开始时调用，清除上次运行的残留：

```js
dynamicInit(e) {
  delete e.dynamic;
  delete e._pendingVar;
  delete e._started;
  delete e._replied;
  // 结构化字段重置为默认值
  e.milestone = false;
  e.decision = null;
  e.spriteId = null;
  e.loopGuard = 0;
}
```

### 5.2 `dynamicReset(e, preserveKeys)` — 选择性重置

保留指定字段（如 `spriteId` 跨事件复用），其余清除：

```js
// preserveKeys = ['spriteId', 'decision']
// → 只清除不在列表中的字段
```

### 5.3 `getSnapshot(e)` — 序列化给编排器

把事件的动态数据打包成可读对象，注入 `orchestratorSnapshot.events.current`：

```js
getSnapshot(e) {
  const p = getProgress();
  return {
    name: e.name,
    type: e.type,
    variable: e.variable || null,
    condition: e.condition || null,
    dynamic: {
      flags: p.flags || {},
      decision: p.decision,
      milestones: p.milestones || {},
      memory: p.memory || '',
    },
    milestone: e.milestone || false,
    decision: e.decision || null,
    spriteId: e.spriteId || null,
    loopGuard: e.loopGuard || 0,
    pendingGuide: p.pendingGuide || null,
  };
}
```

### 5.4 `evaluateCondition(cond, progress)` — 条件求值

纯函数，不修改任何状态：

```js
evaluateCondition({ var: "flags.trust", op: ">=", value: "3" }, progress)
// → 读 progress.flags.trust，与 3 比较，返回 true/false
```

### 5.5 `applyDynamicVars(e)` — 写回动态变量

LLM 输出后调用，把事件声明的 `variable` 写入存储：

```js
// 1. 从 LLM 输出提取值（key = event.variable）
// 2. 写入 progress.flags[key]
// 3. 同步写 Tavo 变量：T.set(tf_progress_{chatId}, progress, 'chat')
```

---

## 6. 编排器快照中的动态数据

`orchestratorSnapshot` 传递给 LLM 编排器时，动态数据位于：

```json
{
  "chapter": {
    "current_stage": "初遇阶段",
    "next_event": "选择阵营",
    "completion_condition": "收集3条线索"
  },
  "events": {
    "current": {
      "name": "选择阵营",
      "type": "roleplay",
      "variable": "faction",
      "dynamic": {
        "flags": { "trust": 5, "rescued_npc": true },
        "decision": null,
        "milestones": { "初遇": true },
        "memory": "用户与李玄风结识..."
      },
      "condition": { "var": "flags.trust", "op": ">=", "value": "3" }
    },
    "all": ["初遇", "选择阵营", "..."]
  },
  "progress": {
    "flags": { "trust": 5 },
    "decision": null,
    "lastDecision": "left_path",
    "lastReason": "用户选择了稳健路线"
  },
  "pending_guide": {
    "summary": "引导用户做出阵营选择",
    "goal": "让用户明确加入散修联盟或独行",
    "instruction": "以李玄风的视角提出建议，但不替用户决定"
  }
}
```

编排器 LLM 据此决定"当前事件是否满足条件"、"下一步该派谁说话"。

---

## 7. `pendingGuide` — 章节切换引导

当 LLM 判定当前事件是**最后一个事件**且结果为 `guide` 时：

1. 事件管理器写入 `progress.pendingGuide = { summary, goal, instruction }`
2. 编排器读取 `progress.pendingGuide`，注入快照的 `pending_guide` 字段
3. `storyStatusNote` 追加 `【章节引导】` 段落，提示 LLM 引导用户
4. 用户回复后，章节判定再次触发，LLM 可返回 `success` 进入下一章节
5. 进入下一章节时，`pendingGuide` 被清空

**关键**：`guide` 只在最后一个事件触发。中间事件的 `guide` 当作 `continue` 处理。

---

## 8. 记忆管理器与动态数据的交互

记忆管理器通过 `progress` 间接读写动态数据：

- **读取**：编排器快照包含 `progress.flags`、`progress.decision` 等，记忆管理器在分析对话时可参考
- **写入**：记忆管理器通过 `progress.memory` 写入摘要，编排器快照读取后展示给 LLM

```
对话 → 记忆管理器 input:beforeSend
  → 分析意图（关键词 或 LLM）
  → 匹配 @记忆管理 → runMemoryAgent
  → 更新 progress.memory（chat scope 变量）
  → 编排器下次读取时生效
```

---

## 9. 生命周期总结

| 时机 | 操作 | 影响 |
|------|------|------|
| 事件开始 | `dynamicInit(e)` | 清除上次残留，重置为默认值 |
| 事件进行中 | LLM 输出 → `applyDynamicVars` | 写入 `progress.flags` + Tavo 变量 |
| 事件完成 | `getSnapshot(e)` | 序列化当前状态供编排器使用 |
| 章节切换 | `progress = defaultProgress()` | 全部清空（flags/decision/milestones/memory/comments） |
| `pendingGuide` 生效 | 用户回复后 | 清空 `pendingGuide`，进入下一章节 |

---

## 10. 初始化的静态数据来源

事件模板从 `chapters/*.json` 加入时，以下字段是**静态只读**的：

- `name` / `type` / `character` — 事件元信息
- `condition` / `completionCondition` — 声明式条件
- `variable` / `variableScope` — 变量声明
- `flow` — 内容流程

这些字段在 `dynamicInit` 中**不会被清除**，始终保留模板原始值。

## 11. UI 显示的数据来源 — `progressHtml` 函数

面板 UI 的数据流：

```
progress (Tavo 变量)
  → progressHtml(progress)
  → 生成 HTML 渲染到 story-panel

包含：
  - 当前阶段/事件名 → progress.currentPhase / currentEvent + chapterOutlineEvents
  - 事件状态标记 → [i]/[s]/[ ] + completedEvents/completedPhases
  - pendingGuide 提示 → progress.pendingGuide.summary
  - flags/decision/memory → 面板底部区域
```

## 12. 事件 Agent 的数据控制 & UI 数据与更新 UI

事件 Agent（编排器 LLM）通过以下路径控制数据：

```
编排器 LLM 输出
  → 意图识别（send / memory_update / other）
  → speaker prompt → 角色 LLM 输出
  → applyDynamicVars(e) → 写 progress.flags
  → judgeAndAdvance() → 更新 currentPhase/currentEvent
  → 面板 onProgressUpdate 回调 → 重新渲染 progressHtml
```

UI 更新触发点：
1. `judgeAndAdvance()` 每次调用后触发 `onProgressUpdate` 回调
2. `buildStory()` 初始化时渲染完整面板
3. `pendingGuide` 写入后，面板显示引导提示

---

*最后更新：2026-07-22 — 基于 entry.js 实际实现*
