'use strict';
// toonflow_story_llm_optimization - 统一 LLM 调用层
//
// 对齐 Toonflow fixDB.ts / modelConfigType.ts / orchestrationResponseShared.ts:
// - reasoningEffort: none/minimal/low/medium/high（默认 minimal）
// - temperature / topP
// - JSON 响应统一解析（剥离 <thinking> 标签）
// - 其他插件通过 tf_llm.generate() / tf_llm.parseOrchestratorResponse() 调用

const NS = 'tf_llm';
const DEFAULTS = {
  reasoningEffort: 'minimal',
  temperature: 0.3,
  topP: 0.5,
};

// ============================================================
// 配置读写（chat 变量 + global 双份）
// ============================================================

// 读配置（plugin config 优先，chat/global 变量兜底）
function getLlmConfig() {
  const cfg = (() => {
    try {
      return tavo.plugin.config || {};
    } catch (e) { return {}; }
  })();
  return {
    reasoningEffort: cfg.reasoningEffort || DEFAULTS.reasoningEffort,
    temperature: parseFloat(cfg.temperature) || DEFAULTS.temperature,
    topP: parseFloat(cfg.topP) || DEFAULTS.topP,
  };
}

// 写配置到 chat + global 变量（防 chat reset）
function saveLlmConfigToVars(cfg) {
  try {
    tavo.set(NS, cfg, 'chat');
    tavo.set(NS, cfg, 'global');
  } catch (e) {
    console.warn('[tf_llm] saveLlmConfigToVars failed', e);
  }
}

// 从变量读取配置（chat → global → DEFAULTS）
function readLlmConfigFromVars() {
  for (const scope of ['chat', 'global']) {
    try {
      let raw = scope === 'chat'
        ? tavo.get(NS, 'chat')
        : tavo.get(NS, 'global');
      // 解包 {target, name, found, value} 结构
      let guard = 0;
      while (raw && typeof raw === 'object' && raw.found !== undefined && 'value' in raw && guard < 5) {
        raw = raw.value; guard++;
      }
      if (raw && typeof raw === 'object' && raw.reasoningEffort) return raw;
    } catch (e) {}
  }
  return null;
}

// ============================================================
// JSON 响应解析（对齐 orchestrationResponseShared.ts）
// ============================================================

// 剥离推理标签（<thinking>...</thinking> / <think>...</think>）
function stripThinkingTags(s) {
  return (s || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

// 对齐 normalizeReasoningEffort()
function normalizeReasoningEffort(v) {
  const s = String(v || '').toLowerCase().trim();
  if (['none','minimal','low','medium','high'].includes(s)) return s;
  return 'minimal';
}

// 对齐 buildPlanResult 字段规范（orchestrationResponseShared.ts）
function parseOrchestratorResponse(rawText) {
  const text = (rawText || '').trim();

  // 1. 先剥离 thinking 标签
  const cleaned = stripThinkingTags(text);

  // 2. 尝试解析 JSON
  // 2a. ```json ... ``` 包裹
  let jsonText = cleaned;
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonText = fence[1].trim();

  try {
    const obj = JSON.parse(jsonText);
    return {
      // 对齐 PlanLike 字段
      speaker: asTrim(obj.speaker),
      role: asTrim(obj.speaker),         // alias
      roleType: asTrim(obj.role_type || obj.roleType),
      motive: asTrim(obj.motive),
      awaitUser: Boolean(obj.await_user || obj.awaitUser),
      triggerMemoryAgent: Boolean(obj.trigger_memory_agent || obj.triggerMemoryAgent),
      eventAdjustMode: normalizeEventAdjustMode(obj.event_adjust_mode || obj.eventAdjustMode),
      eventStatus: normalizeEventStatus(obj.event_status || obj.eventStatus),
      eventSummary: asTrim(obj.event_summary || obj.eventSummary),
      eventFacts: Array.isArray(obj.event_facts || obj.eventFacts)
        ? (obj.event_facts || obj.eventFacts).map(asTrim).filter(Boolean)
        : [],
      timeAdvance: obj.time_advance || obj.timeAdvance || null,
      source: 'ai',
      // 原始解析结果
      _raw: obj,
    };
  } catch (e) {
    // 3. Fallback：正则提取关键字段
    return parseOrchestratorFallback(cleaned);
  }
}

function parseOrchestratorFallback(text) {
  const speaker = extractJsonField(text, ['speaker', 'role']) || '旁白';
  const roleType = extractJsonField(text, ['role_type', 'roleType']) || 'narrator';
  const motive = extractJsonField(text, ['motive']) || '';
  const eventSummary = extractJsonField(text, ['event_summary', 'eventSummary']) || '';
  const eventFactsStr = extractJsonField(text, ['event_facts', 'eventFacts']) || '[]';
  let eventFacts = [];
  try { eventFacts = JSON.parse(eventFactsStr); } catch (e) {}
  const awaitUser = /"await_user"\s*:\s*true/i.test(text) || /"awaitUser"\s*:\s*true/i.test(text);
  const eventAdjustMode = normalizeEventAdjustMode(extractJsonField(text, ['event_adjust_mode', 'eventAdjustMode']));
  const eventStatus = normalizeEventStatus(extractJsonField(text, ['event_status', 'eventStatus']));
  return {
    speaker, role: speaker, roleType, motive,
    awaitUser, triggerMemoryAgent: false,
    eventAdjustMode, eventStatus,
    eventSummary, eventFacts,
    timeAdvance: null,
    source: 'fallback',
    _raw: null,
  };
}

// 发言器响应解析（返回纯字符串台词）
function parseSpeakerResponse(rawText) {
  const text = (rawText || '').trim();
  const cleaned = stripThinkingTags(text);
  // 剥离 ```json ``` 等 markdown 包裹
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : cleaned;
  // 如果 body 看起来像 JSON，再解析 content 字段
  try {
    const obj = JSON.parse(body);
    let content = obj.content || obj.text || obj.dialogue || obj.speech || '';
    // 递归 strip
    content = stripThinkingTags(String(content));
    return content.replace(/^["']|["']$/g, '').trim();
  } catch (e) {
    return body.replace(/^["']|["']$/g, '').trim();
  }
}

// ============================================================
// 统一 LLM 生成（核心 API）
// ============================================================

// 读取 reasoningEffort，判断模型类型
// tavo.generate() 的 settings 中 temperature/topP 可直接用
// reasoningEffort 由 MCP 层面处理（MiniMax 用 reasoning.effort，OpenAI 兼容用 providerOptions）
async function llmGenerate(prompt, options) {
  const cfg = getLlmConfig();
  const opts = options || {};

  // 确定温度和 topP（插件配置 > 调用方指定 > 默认值）
  const temperature = (opts.temperature !== undefined) ? opts.temperature : cfg.temperature;
  const topP = (opts.topP !== undefined) ? opts.topP : cfg.topP;
  const reasoningEffort = normalizeReasoningEffort(cfg.reasoningEffort);
  const maxTokens = opts.maxCompletionTokens || opts.maxTokens || 400;
  const model = opts.model || null;

  // 对齐 toonflow reasoningEffort 记录
  console.log('[tf_llm] generate | reasoningEffort=' + reasoningEffort
    + ' temperature=' + temperature + ' topP=' + topP
    + ' maxTokens=' + maxTokens
    + ' model=' + (model || '(default)')
    + ' promptLen=' + (prompt || '').length);

  let raw;
  try {
    const genOpts = {
      context: opts.context !== undefined ? opts.context : false,
      settings: {
        temperature,
        topP,
        maxCompletionTokens: maxTokens,
      },
    };
    if (model) {
      // tavo_generate API 支持 chatId + prompt + options
      // 注意：实际调用通过 tavo.chat.current() 获取 chatId
      const chatId = opts.chatId || (await tavo.chat.current())?.id;
      raw = await tavo.generate(prompt, genOpts);
    } else {
      raw = await tavo.generate(prompt, genOpts);
    }
  } catch (e) {
    console.error('[tf_llm] generate failed:', e);
    throw e;
  }

  const rawText = (raw || '').trim();
  console.log('[tf_llm] raw response length=' + rawText.length
    + ' first 100 chars: ' + JSON.stringify(rawText.slice(0, 100)));

  // 统一 strip thinking 标签
  return stripThinkingTags(rawText);
}

// ============================================================
// 暴露全局 API（供其他插件调用）
// ============================================================

// 挂到 window 上供其他插件使用
if (typeof window !== 'undefined') {
  window.tf_llm = {
    generate: llmGenerate,
    parseOrchestratorResponse,
    parseSpeakerResponse,
    parseResponse: parseOrchestratorResponse, // alias
    getConfig: getLlmConfig,
    saveConfig: (cfg) => {
      const merged = { ...getLlmConfig(), ...cfg };
      saveLlmConfigToVars(merged);
    },
    stripThinkingTags,
    normalizeReasoningEffort,
  };
}

// tavo 插件内部也挂到全局
try {
  tavo.tf_llm = window.tf_llm;
} catch (e) {}

// ============================================================
// 初始化：chat:opened 时从变量恢复配置
// ============================================================

tavo.plugin.on('chat:opened', async () => {
  console.log('[tf_llm] chat:opened init');
  // 1. 尝试从 chat/global 变量恢复
  const saved = readLlmConfigFromVars();
  if (saved) {
    console.log('[tf_llm] restored from vars:', JSON.stringify(saved));
  } else {
    // 2. 首次使用，写入默认值（minimal）
    const defaultCfg = {
      reasoningEffort: DEFAULTS.reasoningEffort,
      temperature: DEFAULTS.temperature,
      topP: DEFAULTS.topP,
    };
    saveLlmConfigToVars(defaultCfg);
    console.log('[tf_llm] initialized defaults:', JSON.stringify(defaultCfg));
  }
});

// ============================================================
// 辅助函数
// ============================================================

function asTrim(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

// 对齐 PlanEventAdjustMode
function normalizeEventAdjustMode(v) {
  const s = String(v || '').toLowerCase();
  if (['keep','update','waiting_input','completed'].includes(s)) return s;
  return 'keep';
}

// 对齐 PlanEventStatus
function normalizeEventStatus(v) {
  const s = String(v || '').toLowerCase();
  if (['idle','active','waiting_input','completed'].includes(s)) return s;
  return 'active';
}

// 从文本中提取 JSON 字段值
function extractJsonField(text, fieldNames) {
  for (const name of fieldNames) {
    // "fieldName": "value"（双引号字符串）
    const re1 = new RegExp('"' + name + '"\\s*:\\s*"([^"]*)"', 'i');
    const m = text.match(re1);
    if (m) return m[1];
    // "fieldName": `value`（反引号字符串）
    const re2 = new RegExp('"' + name + '"\\s*:\\s*`([^`]*)`', 'i');
    const m2 = text.match(re2);
    if (m2) return m2[1];
    // "fieldName": number / boolean
    const re3 = new RegExp('"' + name + '"\\s*:\\s*([\\w.]+)', 'i');
    const m3 = text.match(re3);
    if (m3) return m3[1];
  }
  return null;
}
