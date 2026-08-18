'use strict';

// 日志时间戳
const ts = () => {
  const d = new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
    + ' ' + [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3,'0');
};
// toonflow_story_llm_optimization - 统一 LLM 响应解析层
//
// 对齐 Toonflow reasoningEffort 机制（fixDB.ts / modelConfigType.ts）：
// - reasoningEffort: none/minimal/low/medium/high（记录在 tf_llm 变量，默认 minimal）
// - temperature/topP 由 tavo 模型设置决定（已在「更多-模型配置」里配好），本插件不覆盖
// - 统一 stripThinkingTags 解析（MiniMax 的 <think> 标签内含实际台词，只删标签不删内容）
// - 其他插件通过 tf_llm.parseOrchestratorResponse() / parseSpeakerResponse() 调用

const NS = 'tf_llm';
const DEFAULTS = { reasoningEffort: 'minimal' };

// ============================================================
// 配置读写（chat 变量 + global 双份）
// ============================================================

// 读插件配置
function getPluginConfig() {
  try {
    const cfg = tavo.plugin.config || {};
    return {
      reasoningEffort: cfg.reasoningEffort || DEFAULTS.reasoningEffort,
    };
  } catch (e) { return { reasoningEffort: DEFAULTS.reasoningEffort }; }
}

// 写配置到 chat + global 变量
function saveLlmConfigToVars(cfg) {
  try {
    tavo.set(NS, { ...DEFAULTS, ...cfg }, 'chat');
    tavo.set(NS, { ...DEFAULTS, ...cfg }, 'global');
  } catch (e) {
    console.warn('[' + ts() + '] [tf_llm] saveLlmConfigToVars failed', e);
  }
}

// 从变量读取配置（chat → global → DEFAULTS）
function readLlmConfigFromVars() {
  for (const scope of ['chat', 'global']) {
    try {
      let raw = scope === 'chat'
        ? tavo.get(NS, 'chat')
        : tavo.get(NS, 'global');
      let guard = 0;
      while (raw && typeof raw === 'object' && raw.found !== undefined && 'value' in raw && guard < 5) {
        raw = raw.value; guard++;
      }
      if (raw && typeof raw === 'object' && (raw.reasoningEffort || raw.temperature)) return raw;
    } catch (e) {}
  }
  return null;
}

// ============================================================
// 核心：剥离推理标签（只删标签，保留标签内所有内容）
// MiniMax 的 <think> 标签内可能含实际台词，如：
//   <think>红缥缈：（转身，轻笑）大王叫我？...</think>
// 必须只删标签，变成：
//   红缥缈：（转身，轻笑）大王叫我？...
// ============================================================
function stripThinkingTags(s) {
  return (s || '')
    .replace(/<thinking>/gi, '')
    .replace(/<\/thinking>/gi, '')
    .replace(/<think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/<talk>/gi, '')
    .replace(/<\/talk>/gi, '')
    .trim();
}

function normalizeReasoningEffort(v) {
  const s = String(v || '').toLowerCase().trim();
  if (['none','minimal','low','medium','high'].includes(s)) return s;
  return 'minimal';
}

// ============================================================
// 编排器响应解析（对齐 orchestrationResponseShared.ts / buildPlanResult 字段）
// ============================================================
function parseOrchestratorResponse(rawText) {
  const text = (rawText || '').trim();
  const cleaned = stripThinkingTags(text);

  // 1. 尝试 ```json ``` 包裹的 JSON
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1].trim() : cleaned;

  try {
    const obj = JSON.parse(jsonText);
    return {
      speaker: asTrim(obj.speaker),
      role: asTrim(obj.speaker),
      roleType: asTrim(obj.role_type || obj.roleType),
      motive: asTrim(obj.motive),
      awaitUser: Boolean(obj.await_user || obj.awaitUser),
      triggerMemoryAgent: Boolean(obj.trigger_memory_agent || obj.triggerMemoryAgent),
      eventAdjustMode: normEventAdjustMode(obj.event_adjust_mode || obj.eventAdjustMode),
      eventStatus: normEventStatus(obj.event_status || obj.eventStatus),
      eventSummary: asTrim(obj.event_summary || obj.eventSummary),
      eventFacts: Array.isArray(obj.event_facts || obj.eventFacts)
        ? (obj.event_facts || obj.eventFacts).map(asTrim).filter(Boolean)
        : [],
      timeAdvance: obj.time_advance || obj.timeAdvance || null,
      source: 'ai',
      _raw: obj,
    };
  } catch (e) {
    return parseOrchestratorFallback(cleaned);
  }
}

function parseOrchestratorFallback(text) {
  return {
    speaker: extractField(text, ['speaker', 'role']) || '旁白',
    role: extractField(text, ['speaker', 'role']) || '旁白',
    roleType: extractField(text, ['role_type', 'roleType']) || 'narrator',
    motive: extractField(text, ['motive']) || '',
    awaitUser: /"await_user"\s*:\s*true/i.test(text) || /"awaitUser"\s*:\s*true/i.test(text),
    triggerMemoryAgent: false,
    eventAdjustMode: normEventAdjustMode(extractField(text, ['event_adjust_mode', 'eventAdjustMode'])),
    eventStatus: normEventStatus(extractField(text, ['event_status', 'eventStatus'])),
    eventSummary: extractField(text, ['event_summary', 'eventSummary']) || '',
    eventFacts: [],
    timeAdvance: null,
    source: 'fallback',
    _raw: null,
  };
}

// ============================================================
// 发言器响应解析（返回纯字符串台词）
// ============================================================
function parseSpeakerResponse(rawText) {
  const text = (rawText || '').trim();
  const cleaned = stripThinkingTags(text);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : cleaned;

  try {
    const obj = JSON.parse(body);
    let content = obj.content || obj.text || obj.dialogue || obj.speech || '';
    return stripThinkingTags(String(content)).replace(/^["']|["']$/g, '').trim();
  } catch (e) {
    return body.replace(/^["']|["']$/g, '').trim();
  }
}

// ============================================================
// 统一 LLM 生成（供其他插件调用）
// temperature/topP 不传，让 tavo 用模型设置（已在「更多-模型配置」里配好）
// ============================================================
async function llmGenerate(prompt, options) {
  const cfg = getPluginConfig();
  const opts = options || {};
  const maxTokens = opts.maxCompletionTokens || opts.maxTokens || 1500;
  const effort = normalizeReasoningEffort(cfg.reasoningEffort);

  console.log('[' + ts() + '] [tf_llm] generate | reasoningEffort=' + effort
    + ' maxTokens=' + maxTokens + ' promptLen=' + (prompt || '').length);

  let raw;
  try {
    raw = await tavo.generate(prompt, {
      context: opts.context !== undefined ? opts.context : false,
      settings: { maxCompletionTokens: maxTokens },
    });
  } catch (e) {
    console.error('[' + ts() + '] [tf_llm] generate failed:', e);
    throw e;
  }

  const rawText = (raw || '').trim();
  const stripped = stripThinkingTags(rawText);
  console.log('[' + ts() + '] [tf_llm] rawLen=' + rawText.length + ' strippedLen=' + stripped.length
    + ' preview: ' + JSON.stringify(stripped.slice(0, 100)));

  return stripped;
}

// ============================================================
// 暴露全局 API
// ============================================================
if (typeof window !== 'undefined') {
  window.tf_llm = {
    generate: llmGenerate,
    parseOrchestratorResponse,
    parseSpeakerResponse,
    parseResponse: parseOrchestratorResponse,
    getConfig: () => ({ ...DEFAULTS, ...getPluginConfig(), ...readLlmConfigFromVars() }),
    saveConfig: (cfg) => saveLlmConfigToVars(cfg),
    stripThinkingTags,
    normalizeReasoningEffort,
  };
}
try { tavo.tf_llm = window.tf_llm; } catch (e) {}

// ============================================================
// 初始化
// ============================================================
tavo.plugin.on('chat:opened', async () => {
  const saved = readLlmConfigFromVars();
  if (saved) {
    console.log('[' + ts() + '] [tf_llm] chat:opened restored:', JSON.stringify(saved));
  } else {
    saveLlmConfigToVars(DEFAULTS);
    console.log('[' + ts() + '] [tf_llm] chat:opened initialized defaults:', JSON.stringify(DEFAULTS));
  }
});

// ============================================================
// 辅助
// ============================================================
function asTrim(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

function normEventAdjustMode(v) {
  const s = String(v || '').toLowerCase();
  if (['keep','update','waiting_input','completed'].includes(s)) return s;
  return 'keep';
}

function normEventStatus(v) {
  const s = String(v || '').toLowerCase();
  if (['idle','active','waiting_input','completed'].includes(s)) return s;
  return 'active';
}

function extractField(text, fieldNames) {
  for (const name of fieldNames) {
    const m = text.match(new RegExp('"' + name + '"\\s*:\\s*"([^"]*)"', 'i'));
    if (m) return m[1];
    const m2 = text.match(new RegExp('"' + name + '"\\s*:\\s*`([^`]*)`', 'i'));
    if (m2) return m2[1];
    const m3 = text.match(new RegExp('"' + name + '"\\s*:\\s*([\\w.]+)', 'i'));
    if (m3) return m3[1];
  }
  return null;
}
