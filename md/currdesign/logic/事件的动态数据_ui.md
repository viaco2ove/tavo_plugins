# 事件的动态数据 生命周期
## 初始化的静态数据来源：
1. sync_story 把 story_sync_config.json 的数据写入 tf_story.edit
2. rebuildDynamicData() 读 tf_story.edit.chapters[0].content（就是那些 ## 第一阶段 ### 事件1 的文本）
3. parseProgress() 解析这些文本 → 生成 phases 数组
4. 写入 tf_progress

defaultProgress() 只是 fallback，正常流程下 phases 来自 parseProgress(chapters[0].content)。
## ui 显示的数据来源：progressHtml 函数
UI 的数据来源和处理：

两个读取入口

┌───────────────┬─────────────────────────┬──────────────────────────────────────────────────────────┐
│     变量      │       scope 策略        │                         读取方式                         │
├───────────────┼─────────────────────────┼──────────────────────────────────────────────────────────┤
│ tf_story.edit │ 双域读取：global → chat │ readVarDualScope(panelNs('edit'), panelNsGlobal('edit')) │
├───────────────┼─────────────────────────┼──────────────────────────────────────────────────────────┤
│ tf_progress   │ 双域读取：global → chat │ readVarDualScope(progressNs(), progressNsGlobal())       │
└───────────────┴─────────────────────────┴──────────────────────────────────────────────────────────┘

处理逻辑

1. loadEdit() 读 tf_story.edit → 赋值给 _edit 全局变量
   - 如果读不到 → fallback：世界书 entry「章节备份」
   - 还读不到 → defaultEdit()（空章节）
   - 写入时机：编辑器保存时双写 tf_story.edit（chat + global）
2. getProgressState() 每次直接读 tf_progress，不缓存
   - 读不到 → 返回空对象 {}
3. eventsHtml() 显示：
   - _edit.chapters → 章节标题、章节目标（successCondition）
   - tf_progress.phases → phase/event 列表 + 完成状态标记 [s/i/ ]
   - tf_progress.currentPhase / currentEvent → 高亮当前项
   - tf_progress.completedChapters / failedAttempts → 统计
4. progressHtml() 显示：
   - tf_progress.currentChapterIndex → 当前第几章
   - tf_progress.completedChapters.length / 章节总数 → 进度百分比
   - tf_progress.phases → 阶段列表（带颜色标记）
   - tf_progress.storyCompleted / sessionFreeMode → 状态文字

没有做的处理：没有 parseProgress，phases 直接从 tf_progress.phases 读。parseProgress 是在 entry.js 写入 tf_progress 时做的，不在 UI 层。
## 事件agent 的数据控制 & ui 数据 与 更新ui
_llmJudgeEventProgress 读了 tf_progress 里 event 上的 kind/flow/status/summary/facts：

current_event: {
  summary: curEvent.summary || '',
  facts: curEvent.facts || [],
  kind: curEvent.kind || '',
  ...
}

但是 parseProgress 解析出来的 event 只有 {name, state}——根本不存在 kind/status/summary/facts。

而 tfEventProgress_advance 写入的是 progress.progressSummary 和 progress.progressFacts——写在 progress 顶层，不是写在 event 对象上。

所以：
- LLM 读的是 event 上的字段（永远空）
- LLM 写的摘要在 progress 顶层
- UI 读的是 phases 里的 event（永远只有 name）

function setProgress(p) {
  try { writeVarDual(progressNs(), progressNsGlobal(), p); return true; } catch (e) { return false; }
}
writeVarDual 会同时写 chat scope 和 global scope：

tf_progress          → chat scope（聊天级别，tavo_chat_reset 会清掉）
tf_progress_{chatId} → global scope（全局备份，reset 后还能恢复）
