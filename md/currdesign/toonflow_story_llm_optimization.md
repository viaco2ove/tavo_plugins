# Toonflow Story LLM 优化器插件设计

> 对齐 Toonflow-game 的 `reasoningEffort` 机制和 JSON 响应解析

## 1. 背景

Toonflow-game 在 `fixDB.ts` 中向 `t_config` 表添加了 LLM 全局参数：
- `reasoningEffort`（text，默认 `"minimal"`，5 级：none/minimal/low/medium/high）
- `temperature`（float，默认 0.3）
- `topP`（float，默认 0.5）

`t_textModel` 表每行有 `think` 字段（0/1），标识模型是否支持思考能力。

调用时：
- OpenAI 兼容（火山引擎/豆包等）：通过 `providerOptions.openai.reasoningEffort` 注入
- MiniMax：特殊处理 `{ reasoning: { effort } }`

**JSON 解析**：Toonflow 用 `@ai-sdk/values` 的 `best-effort-json-parser` 做兜底解析。

## 2. 问题

1. tavo 官方 `tavo.generate()` 不暴露 `reasoningEffort` 控制参数
2. tavo 返回 `<thinking>...</thinking>` 标签污染 JSON 解析
3. 各插件各自独立调用 LLM，缺少统一的响应解析层

## 3. 插件职责

### 3.1 接管 `tavo.generate` 调用（完全看齐 toonflow）

提供统一封装 `tf_llm.generate(prompt, options)`：
- 读取 `tf_llm.reasoningEffort`（故事级配置，默认 `"minimal"`）
- 读取 `tf_llm.temperature`（默认 0.3）
- 读取 `tf_llm.topP`（默认 0.5）
- 根据模型类型自动选择思考控制方式（MiniMax 用 `{ reasoning: { effort } }`，其他用 `providerOptions`）

### 3.2 统一响应解析（看齐 toonflow 的 `buildMinimalOrchestrationResponse`）

提供 `tf_llm.parseJsonResponse(rawText, options)`：
- 剥离 `<thinking>...</thinking>` 标签
- 尝试 JSON.parse
- Fallback 正则提取 `"key": "value"` 字段
- 对齐 `orchestrationResponseShared.ts` 的字段规范

### 3.3 思考程度配置 UI

故事配置面板新增「LLM 优化」Tab：
- 思考程度：`none` / `minimal`（默认） / `low` / `medium` / `high`
- Temperature：滑块 0~2，默认 0.3
- TopP：滑块 0~1，默认 0.5

配置持久化到 `tf_llm` chat 变量，**双写 global** 防 chat reset。

## 4. 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `reasoningEffort` | string | `"minimal"` | 思考程度 none/minimal/low/medium/high |
| `temperature` | float | `0.3` | 随机性 |
| `topP` | float | `0.5` | Top-P 采样 |
| `payloadMode` | string | `"compact"` | compact / advanced（编排 payload 模式） |

## 5. API 设计

```javascript
// 其他插件调用方式
const raw = await tf_llm.generate(systemPrompt, {
  model: 'MiniMax-M2.7',
  temperature: 0.3,
  maxCompletionTokens: 600,
});

const result = tf_llm.parseOrchestratorResponse(raw);
// result: { speaker, role_type, motive, event_summary, event_facts, event_status, event_adjust_mode }

const dialogue = tf_llm.parseSpeakerResponse(raw);
// dialogue: 纯字符串台词
```

## 6. 实现计划

### Phase 1: 核心引擎
- `plugins/toonflow_story_llm_optimization/entry.js`
- `_readLlmConfig()`: 读取 `tf_llm` 变量（chat+global 双读）
- `generate(prompt, opts)`: 封装 tavo.generate，注入 reasoningEffort
- `parseResponse(raw)`: stripTags + JSON.parse + fallback 正则
- chat:opened 时初始化默认配置（minimal）

### Phase 2: UI 配置面板
- `ui/llm_panel.html` 嵌入故事配置 Tab
- 提供 reasoningEffort / temperature / topP 三项控制

### Phase 3: 迁移其他插件
- MCS 改用 `tf_llm.generate()` 替代直接调用 `tavo.generate()`
- sprite/event_manager 按需迁移

## 7. 与 Toonflow-game 对齐点

| Toonflow | tavo_plugins |
|----------|-------------|
| `t_config.reasoningEffort` | `tf_llm.reasoningEffort` |
| `providerOptions.openai.reasoningEffort` | MiniMax 用 `{ reasoning: { effort } }` |
| `best-effort-json-parser` | `parseResponse()` 正则兜底 |
| `normalizeReasoningEffort()` | `_normalizeReasoningEffort()` 同逻辑 |
| `orchestrationResponseShared.buildPlanResult()` | `parseOrchestratorResponse()` 同字段 |
