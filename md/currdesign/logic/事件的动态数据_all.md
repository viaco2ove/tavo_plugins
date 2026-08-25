# 事件的动态数据

> 基于 `plugins/toonflow_story_event_manager/entry.js` v1.4.0 实际代码。

---

## 1. 架构概览

```
story_sync_config.json
         ↓ sync_story（Python）
         ↓ 写入 tavo 变量
tf_story.edit（chat scope）
         ↓ rebuildDynamicData() 读
         ↓ parseProgress() 解析
tf_progress.phases（chat scope）
         ↓ LLM judgment 后写入
tf_progress.completedEvents / progressSummary / ...
```

两层数据：

| 层次 | 变量名 | 生命周期 | 内容 |
|------|--------|----------|------|
| 静态 | `tf_story.edit` | chat scope | 章节内容、简介、全局背景 |
| 动态 | `tf_progress` | chat scope | phases 数组、当前 phase/event、已完成记录 |

---

## 2. 变量命名规则

```javascript
// chat scope（聊天级别，天然隔离）
ns('edit')      // → 'tf_story.edit'
ns('boot')      // → 'tf_story.boot'

// global scope（所有聊天共享，用 chat_id 区分）
nsGlobal('edit') // → 'tf_story_{chatId}.edit'
// 不带 chat_id 时 → 'tf_story.edit'（fallback）

progressNs()    // → 'tf_progress'（chat scope）
progressNsGlobal() // → 'tf_progress_{chatId}'（global scope）
```

**为什么要 global scope**：因为 `tavo_chat_reset` 会清空 chat scope。global scope 是权威备份，`restoreStaticData()` 从 global 恢复到 chat。

---

## 3. 静态数据结构

`tf_story.edit` 的结构（由 `sync_story` 从 `story_sync_config.json` 写入）：

```json
{
  "intro": "故事简介文本",
  "globalBackground": "全局背景文本",
  "lineCount": 20,
  "intentMode": "keyword",
  "chapters": [
    {
      "title": "第 1 章",
      "openingRole": "旁白",
      "openingLine": "台词...",
      "background": "",
      "content": "## 第一阶段\n### 事件1\n### 事件2\n## 第二阶段\n### 事件3",
      "successCondition": "",
      "conditionVisible": true
    }
  ]
}
```

**初始数据来源**：`defaultEditData()` 是硬编码 fallback（不是从模板变量读取）。正常流程下，`sync_story` 会把 `story_sync_config.json` 写入 `tf_story.edit`，覆盖这个 fallback。

---

## 4. 动态数据结构

`tf_progress` 的完整字段：

```json
{
  "currentChapterIndex": 0,
  "currentPhase": 0,
  "currentEvent": 0,
  "phases": [
    {
      "name": "第一阶段",
      "events": [
        { "name": "事件1", "state": "" },
        { "name": "事件2", "state": "" }
      ],
      "index": 0
    },
    {
      "name": "第二阶段",
      "events": [
        { "name": "事件3", "state": "" }
      ],
      "index": 1
    }
  ],
  "completedChapters": [],
  "completedPhases": [],
  "completedEvents": [],
  "progressSummary": "",
  "progressFacts": [],
  "failedAttempts": 0,
  "storyCompleted": false,
  "sessionFreeMode": false,
  "phasesAllCompleted": false,
  "chaptersKey": "1:0",
  "startedAt": 1234567890,
  "updatedAt": 1234567890
}
```

**chaptersKey**：格式 `章节数量:当前章节索引`。用于检测章节数量变化（重新解析 phases）。

---

## 5. phases 是怎么从章节内容解析出来的

`parseProgress(content)` — 纯字符串解析，不依赖任何模板声明语法：

```javascript
// 输入：chapter.content 纯文本
// ## 第一阶段
// ### 事件1
// ### 事件2
// ## 第二阶段
// ### 事件3

// 输出：phases 数组
[
  { name: "第一阶段", index: 0, events: [
      { name: "事件1", state: "" },
      { name: "事件2", state: "" }
  ]},
  { name: "第二阶段", index: 1, events: [
      { name: "事件3", state: "" }
  ]}
]
```

**规则**：
- `##` 开头的行 → phase（章节阶段）
- `###` 开头的行 → event（事件），属于上一个 phase
- 可选 `[s/i/f]` 标记：`[s]`=success, `[i]`=in-progress, `[f]`=failed（状态标记）

**注意**：没有 variable 声明、没有 condition 声明、没有 milestone 声明。`##` 和 `###` 就是全部的"声明式字段"。

---

## 6. 核心函数

### restoreStaticData()
**什么时候调用**：chat scope 被清空后（tavo_chat_reset）恢复。

**做什么**：把 `tf_story.edit` 和 `tmm_story_static_{chatId}` 从 global scope 复制回 chat scope。

```javascript
// 遍历两个变量名
for (name of ['tf_story.edit', 'tmm_story_static_{chatId}']) {
  // 1. 如果 chat scope 已有内容 → 跳过（正常续玩）
  // 2. 如果 chat scope 空 → 从 global scope 读取
  // 3. 检查是否有实质内容（有 chapters 数组 / characters 数组）
  // 4. 有内容 → 写入 chat scope
}
```

### rebuildDynamicData()
**什么时候调用**：chat:opened 时检查 progress 完整性。

**做什么**：

```javascript
// 1. 读取 tf_progress
// 2. 如果 progress 不存在或结构异常（无 completedChapters 数组）
//    → defaultProgress() + parseProgress(chapters[0].content)
// 3. 如果 progress 存在但 phases 为空（换章后）
//    → parseProgress(当前章节.content) + currentPhase=0, currentEvent=0
```

### tfEventProgress_advance(messageContext)
**什么时候调用**：mcs 编排后，LLM judgment 后推进事件进度。

**做什么**（LLM 返回 `ended=true` 时）：

```javascript
// 1. 标记当前事件完成
if (!progress.completedEvents.includes('phase:0:event:0'))
  progress.completedEvents.push('phase:0:event:0')

// 2. 推进 phase/event 指针
if (eventIdx + 1 < events.length) {
  progress.currentEvent = eventIdx + 1;
} else if (phaseIdx + 1 < phases.length) {
  progress.completedPhases.push(phaseName);
  progress.currentPhase = phaseIdx + 1;
  progress.currentEvent = 0;
} else {
  progress.phasesAllCompleted = true;  // 所有事件完成
}

// 3. 写入 LLM 返回的摘要
if (llmRes.progress_summary)  progress.progressSummary = llmRes.progress_summary;
if (llmRes.progress_facts)    progress.progressFacts = [...(prev), ...llmRes.progress_facts].slice(-20);

// 4. 更新时间戳
progress.updatedAt = Date.now();
setProgress(progress);
```

### _llmJudgeEventProgress(progress, chapters, recentDialogue)
**做什么**：调用 LLM 判定当前事件是否完成。构造的快照结构：

```json
{
  "chapter": { "id": 0, "title": "第 1 章" },
  "current_event": {
    "index": 0,
    "label": "事件1",
    "status": ""
  },
  "current_stage": { "index": 0, "name": "第一阶段" },
  "next_stage": { "index": 1, "name": "第二阶段" },
  "next_event": { "name": "事件2" },
  "recent_dialogue": "...最近1500字符..."
}
```

**LLM 输出要求**（`ended` / `event_status` / `progress_summary` / `progress_facts`）。

---

## 7. 编排器快照结构

`_llmJudgeEventProgress` 传给 LLM 的 snapshot：

```
snapshot = {
  chapter: { id, title },
  current_event: { index, kind, flow, status, summary, facts, label },
  current_stage: { index, name, label },
  next_stage: { index, name, label },
  next_event: { name },
  recent_dialogue: string（最近1500字符）
}
```

---

## 8. 三个关键时刻

| 时刻 | 触发条件 | 做了什么 |
|------|----------|----------|
| 静态恢复 | tavo_chat_reset 清空 chat scope | `restoreStaticData()` 从 global 复制回 `tf_story.edit` |
| 动态重建 | chat:opened 发现 progress 丢失/相位空 | `rebuildDynamicData()` 从当前章节 content 重新 parse phases |
| 进度推进 | mcs 编排后 LLM judgment 返回 ended | `tfEventProgress_advance()` 标记事件完成 + 更新指针 + 写 summary |

---

## 9. pendingGuide 机制

`pendingGuide` 是另一个插件（mcs）维护的字段，不在 `tf_progress` 里。流程：

1. **事件判定**：编排器调用 `_llmJudgeEventProgress`
2. **返回**：`ended=true` + `event_status` + `progress_summary` + `progress_facts`
3. **推进**：`tfEventProgress_advance()` 写入 `tf_progress`
4. **章节结局**：`evaluateChapterOutcome(chapter, ctx)` — 独立的完成条件判定（`successCondition`），不在 `tf_progress` 里
5. **pendingGuide**：`tf_story.judge` 在编排器侧维护，不是事件管理器的职责

---

## 10. advanceEventProgress — 用户发言推进

与 LLM judgment 推进并列的另一条路径：**用户每次发言直接推进**（确定性规则，不需要 LLM）：

```javascript
function advanceEventProgress(progress) {
  // 1. 用户发言 → 当前 event 完成（currentEvent+1）
  // 2. 如果下一 event 是「用户发言」节点 → 一并跳过（刚发过言）
  // 3. event 全完成 → 下一 phase（跳过「非事件」段）
  // 4. phase 完成也标记 completedPhases
}
```

---

## 11. 记忆管理器交互

`tf_progress` 不直接和记忆管理器交互。记忆管理由 `toonflow_story_memory_manager` 插件独立维护。

---

## 12. UI 数据来源

HTML panel 读取 `tf_progress` 和 `tf_story.edit` 的字段：

- `tf_progress.currentChapterIndex` → 当前章节
- `tf_progress.currentPhase` → 当前阶段
- `tf_progress.currentEvent` → 当前事件
- `tf_progress.completedChapters` → 已完成章节列表
- `tf_progress.progressSummary` → LLM 生成的进度摘要
- `tf_progress.progressFacts` → 事实列表

**注意**：HTML panel 里的 `progressHtml` 渲染的是 `tf_progress` 字段，不是从 `tf_story.edit.chapters` 读取。
