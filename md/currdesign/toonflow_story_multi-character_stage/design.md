# Toonflow Multi-Character Stage 设计方案

> 用 tavo 世界书作为"故事蓝图"，配合多个插件实现完整的多人角色故事体验。

---

## 1. 核心思路

**用世界书当故事，绕开 tavo 没有"故事实体"的死结。**

| Toonflow 概念 | tavo 映射 | 说明 |
|---------------|-----------|------|
| 故事 | 世界书 (Lorebook) | 包含章节列表、完成条件、世界规则 |
| 章节 | 世界书 Entry | 每个 entry 是一章的内容 |
| 角色 | 角色 (Character) | tavo 原生支持 |
| 世界书 | 世界书 Entry (constant) | 世界规则、全局设定 |
| 事件 | 插件维护的状态 | chat 变量 |
| 记忆 | 记忆管理插件 | chat 变量 |

**关键认知**：世界书是"蓝图"，插件是"引擎"。

- 世界书 = 静态故事蓝图（章节列表、完成条件、世界规则）
- chat 变量 = 动态故事状态（当前第几章、哪些章完成）
- 插件 = 真正的"故事引擎"（评估条件、推进章节、编排发言）

---

## 2. 世界书结构设计

### 2.1 世界书 = 故事

一个故事 = 一个世界书。

```
故事书（世界书）
├─ 世界规则（constant entry，所有聊天都注入）
│   └─ 故事背景、阵营设定、等级体系等
├─ 章节 1
│   ├─ name: "第一章：觉醒"
│   ├─ content: "..."
│   └─ completion_condition: "与萧炎对话3次"
├─ 章节 2
│   ├─ name: "第二章：入门"
│   ├─ content: "..."
│   └─ completion_condition: "完成新手任务"
└─ 章节 N...
```

### 2.2 Entry 设计

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 章节名，如"第一章：觉醒" |
| content | string | 章节详细内容、剧情描述 |
| completion_condition | string | 完成条件（文本，插件解析） |
| strategy | `constant` 或 `keyword` | constant=全局规则，keyword=章节触发 |
| keywords | string[] | 关键词，仅 keyword 时用 |
| enabled | boolean | 是否启用 |

### 2.3 世界书 Entry 分类

| 类型 | strategy | 触发方式 | 用途 |
|------|----------|-----------|------|
| 世界规则 | `constant` | 始终注入 | 故事背景、阵营、等级体系等 |
| 章节详情 | `keyword` | 由插件动态注入 | 当前章节的详细内容 |
| 历史章节 | `keyword` | 完成后关闭 | 已完成的章节，不注入 |

### 2.4 世界书 JSON 示例

```json
{
  "name": "斗破苍穹·萧炎篇",
  "entries": [
    {
      "name": "世界规则",
      "content": "【世界观】\n斗气大陆，等级分为：斗之气、斗者、斗师...【阵营】\n- 萧家：乌坦城三大家族之一...",
      "strategy": "constant",
      "enabled": true
    },
    {
      "name": "第一章：觉醒",
      "content": "【剧情】主角在乌坦城偶遇萧炎...\n【场景】乌坦城街道\n【关键NPC】萧炎、薰儿",
      "completion_condition": "与萧炎对话3次;获得玄阶功法",
      "keywords": ["觉醒", "乌坦城"],
      "strategy": "keyword",
      "enabled": true
    },
    {
      "name": "第二章：入门",
      "content": "【剧情】主角决定加入萧家修炼...\n【场景】萧家练武场\n【关键NPC】萧战、萧宁",
      "completion_condition": "完成萧战的任务",
      "keywords": ["入门", "萧家"],
      "strategy": "keyword",
      "enabled": false
    }
  ]
}
```

---

## 3. 数据流设计

```
┌─────────────────────────────────────────────────────────────┐
│                      世界书（故事蓝图）                      │
│  ├─ 世界规则（constant）                                     │
│  └─ 章节 1-N（keyword，动态启停）                             │
└──────────────────┬────────────────────────────────────────┘
                   │ MCP 创建/读取
                   ↓
┌─────────────────────────────────────────────────────────────┐
│                     chat 变量（故事状态）                     │
│  story.worldbook_id     // 当前故事世界书 ID                  │
│  story.current_chapter // 当前章节 index                    │
│  story.chapters[]      // 章节状态列表                        │
│  story.progress       // 总体进度                           │
│  story.started_at      // 开始时间                            │
│  story.completed       // 是否完成                            │
└──────────────────┬────────────────────────────────────────┘
                   │ 插件读写
                   ↓
┌─────────────────────────────────────────────────────────────┐
│                       插件引擎                               │
│  ├─ 事件管理插件     // 评估完成条件、推进章节               │
│  ├─ 记忆管理插件     // 提炼剧情摘要、追踪状态               │
│  ├─ 角色编排插件     // 决定谁发言                           │
│  └─ 角色发言插件     // 生成台词（群聊渲染气泡）             │
└──────────────────┬────────────────────────────────────────┘
                   │ tavo 原生
                   ↓
┌─────────────────────────────────────────────────────────────┐
│                     tavo 群聊                              │
│  ├─ responseMode: 'scenario'                               │
│  ├─ overrideScenario: 动态编排发言规则                      │
│  ├─ 消息气泡渲染（带头像、角色名）                         │
│  └─ 世界书注入（模型看到故事结构）                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 插件职责

### 4.1 事件管理插件（核心）

**职责**：
1. 读取世界书，解析章节列表和完成条件
2. 每轮对话后评估当前章节完成情况
3. 完成时推进到下一章节
4. 全部章节完成时触发结局

**数据存储**：
```javascript
// chat 变量
tavo.set('tf_story', {
  worldbook_id: 42,
  current_chapter: 0,
  chapters: [
    { name: '第一章：觉醒', completed: false, started_at: 0 },
    { name: '第二章：入门', completed: false, started_at: 0 },
  ],
  progress: 0,
  started_at: Date.now(),
  completed: false
}, 'chat')
```

**工作流程**：
```
message:added
  ↓
读取 tf_story.current_chapter
  ↓
读取世界书第 N 个 entry 的 completion_condition
  ↓
解析条件类型：
  ├─ "对话3次" → 数 message:added 次数
  ├─ "获得功法" → 查记忆插件状态
  └─ 其他 → tavo.generate() AI 评估
  ↓
条件满足？
  ├─ 是 → 标记 completed，推进 current_chapter++
  └─ 否 → 不动
  ↓
generation:prepare 注入当前章节详情
```

### 4.2 记忆管理插件

**职责**：
1. 提炼剧情摘要、事实、标签
2. 追踪关键状态变化（等级、物品、任务进度）
3. 为事件管理插件提供状态查询

**与事件管理插件协同**：
```javascript
// 记忆插件维护
tavo.set('tmm', {
  meta: { summary, facts, tags },
  cards: { player, npcs }
}, 'chat')

// 事件管理插件读取
const memory = tavo.get('tmm')
// 检查是否获得功法
if (memory.cards.player.items.includes('玄阶功法')) { ... }
```

### 4.3 角色编排插件

**职责**：
1. 设 `responseMode: 'scenario'`
2. 通过 `overrideScenario` 动态指定发言规则
3. `generation:prepare` 注入编排上下文

**overrideScenario 注入内容**：
```
【发言规则】
- 当前章节：第一章：觉醒
- 场景：乌坦城街道
- 在场角色：萧炎、薰儿
- 发言优先级：
  1. 回应用户的角色
  2. 与用户刚建立互动的角色
  3. 推进剧情的关键角色
- 当前任务：与萧炎对话3次
```

### 4.4 角色发言插件

**职责**：
1. 生成角色台词（复用 tavo 群聊的渲染）
2. 或者直接让群聊发言，插件只做编排

**注意**：tavo 群聊天然支持多角色气泡渲染（带头像、角色名），插件不需要自己实现。插件只需决定"谁来说"，tavo 负责渲染。

---

## 5. MCP 创建故事的流程

### 5.1 完整创建流程

```
用户/Agent 请求创建故事
  ↓
1. tavo_lorebook_create()           // 创建世界书
  └─ name: "斗破苍穹·萧炎篇"
  └─ entries: [世界规则, 章节1, 章节2, ...]
  ↓
2. tavo_chat_create()               // 创建群聊
  └─ name: "斗破苍穹·萧炎篇 - 第1章"
  └─ characters: [用户角色, 萧炎, 薰儿, ...]
  ↓
3. tavo_chat_update()                // 设置世界书
  └─ lorebooks: [世界书ID]
  ↓
4. tavo_chat_update()                // 设置回复模式
  └─ responseMode: 'scenario'
  └─ overrideScenario: '...'         // 初始发言规则
  ↓
5. 插件初始化                        // 事件管理插件读取世界书
  └─ 解析章节列表
  └─ 初始化 tf_story 变量
  ↓
6. 聊天就绪，用户开始游玩
```

### 5.2 MCP 函数映射

| 步骤 | MCP 函数 | 参数 |
|------|----------|------|
| 创建世界书 | `tavo_lorebook_create` | name, entries |
| 创建群聊 | `tavo_chat_create` | name, characterIds |
| 设置世界书 | `tavo_chat_update` | lorebooks |
| 设置回复模式 | `tavo_chat_update` | responseMode, overrideScenario |

---

## 6. 世界书 Entry 解析

### 6.1 completion_condition 格式

插件需要解析 completion_condition 文本，格式约定：

```
condition := simple_condition (semicolon simple_condition)*
simple_condition := keyword_condition | count_condition | flag_condition

keyword_condition := "包含关键词:" keywords
count_condition := "对话" count "次"
flag_condition := "获得" item_name
```

**示例**：
```
"与萧炎对话3次;获得玄阶功法"
```

解析后：
```javascript
{
  conditions: [
    { type: 'count', target: '萧炎', count: 3 },
    { type: 'flag', item: '玄阶功法' }
  ],
  operator: 'AND'  // 或 'OR'
}
```

### 6.2 条件评估

| 条件类型 | 评估方式 |
|----------|----------|
| `count` | `message:added` 计数 |
| `flag` | 查 `tmm.cards.player.items` |
| `keyword` | 查 `tmm.meta.facts` |
| 其他 | `tavo.generate()` AI 评估 |

---

## 7. 章节切换流程

```
事件管理插件评估当前章节完成
  ↓
完成！
  ↓
1. 标记 chapters[N].completed = true
2. 关闭当前章节 entry (enabled = false)
   └─ tavo.lorebook.update()
3. 开启下一章节 entry (enabled = true)
   └─ tavo.lorebook.update()
4. 更新 current_chapter++
5. 注入章节切换旁白
   └─ tavo.message.append({ role: 'assistant', content: '（场景切换至 第二章：入门）' })
6. 重置下一章节的状态
   └─ chapters[N+1].started_at = Date.now()
```

---

## 8. 结局处理

所有章节完成后：

```
当前章节 = 最后一章
且 最后一章 completed = true
  ↓
触发结局流程
  ↓
1. tavo.set('tf_story.completed', true)
2. 生成结局台词
3. 显示完成面板（插件 UI）
4. 提供"重新开始"或"继续自由探索"选项
```

---

## 9. 插件包结构

```
toonflow_story_multi_character_stage/
├── manifest.json
├── entry.js                    # 事件管理插件主入口
├── locales/
│   ├── en.json
│   └── zh-CN.json
├── ui/
│   └── story_panel.html       # 故事进度面板
└── cover.png

toonflow_story_memory_manager/
├── manifest.json
├── entry.js                    # 记忆管理插件主入口
├── locales/
│   ├── en.json
│   └── zh-CN.json
├── ui/
│   └── memory_panel.html      # 记忆状态面板
└── cover.png
```

---

## 10. 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 世界书做故事蓝图 | ✅ | tavo 真实存在，可 MCP 创建 |
| 世界书 constant 做全局规则 | ✅ | 始终注入，体积小 |
| 章节用 keyword | ✅ | 可动态启停，不爆 token |
| 当前章节详情由插件注入 | ✅ | generation:prepare 动态拼入 |
| 群聊发言 | ✅ | tavo 原生渲染，不重复造轮子 |
| completion_condition 解析 | 混合 | 能规则规则，不能的用 AI |
| chat 变量做状态 | ✅ | 可导出、可克隆 |

---

## 11. 限制与诚实说明

1. **"故事"能力是插件给的**：严格说 tavo 不支持故事，是世界书+插件拼出来的体验
2. **completion_condition 是文本**：不是结构化数据，解析有歧义风险
3. **章节切换依赖插件逻辑**：世界书自己不会推进，需要事件管理插件驱动
4. **多故事管理**：一个世界书 = 一个故事；需要多个故事要创建多个世界书

---

## 12. 参考

- tavo 世界书 API：`tavo.lorebook.*`
- tavo 聊天 API：`tavo.chat.*`
- tavo 消息 API：`tavo.message.*`
- tavo 变量 API：`tavo.get/set/update`
- tavo MCP Server：`tavo_lorebook_create`、`tavo_chat_create`、`tavo_chat_update`