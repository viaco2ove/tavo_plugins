// toonflow_story_llm_optimization - 完全接管 LLM 接口调用
// 对齐 toonflow-game 的 llmGenerate 逻辑：读取 Tavo 配置 + 直接 fetch 调用适配器 API
// 其他插件通过 tf_llm.generate() 调用（不再直接调 tavo.generate()）

const NS = 'tf_llm';
const DEFAULTS = { enabled: true, apiUrl: '', apiKey: '', apiMode: '', model: '', reasoningEffort: 'minimal', temperature: 0.3, topP: 0.5, topK: null, maxTokens: 1500, memoryLength: 20, stream: true };

// 支持直接 fetch 的适配器 URL 前缀（命中则完全接管）
const ADAPTER_URLS = [
  'https://api.minimaxi.com',
  'https://api.siliconflow.cn',
  'https://dashscope.aliyuncs.com/compatible-mode',
  'https://ark.cn-beijing.volces.com/api/v3',
  'https://api.openai.com/v1',
  'https://generativelanguage.googleapis.com',
  'https://ai.t8star.cn',
];

// MiniMax 模型名映射（reasoningEffort → 模型名）
const MINIMAX_MODELS = {
  none: 'MiniMax-Text-01',
  minimal: 'MiniMax-Text-01',
  low: 'MiniMax-Text-01',
  medium: 'MiniMax-Text-01',
  high: 'MiniMax-Text-01',
};

// ============================================================
// 工具函数
// ============================================================
function ts() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
    + ' ' + [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3,'0');
}
const log = (...a) => console.log('[' + ts() + '] [tf_llm] ' + a.join(' '));
const warn = (...a) => console.warn('[' + ts() + '] [tf_llm] ' + a.join(' '));

function cfg(key, fb) {
  try { const v = tavo.plugin.config.get(key); return (v === undefined || v === null) ? fb : v; }
  catch (e) { return fb; }
}

function readVar(name, scope) {
  try {
    let raw = null;
    try { raw = tavo.get(name, scope || 'chat'); } catch(e) {}
    if (!raw) { try { raw = tavo.get(name, 'global'); } catch(e) {} }
    let v = raw, guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) { v = v.value; guard++; }
    return v;
  } catch (e) { warn('readVar error', e.message); return null; }
}

function writeVar(name, value, scope) {
  try { tavo.set(name, value, scope || 'chat'); } catch(e) { warn('writeVar error', e.message); }
}

// ============================================================
// 配置读写
// ============================================================
function readPluginConfig() {
  return {
    enabled: cfg('enabled', true),
    apiUrl: cfg('apiUrl', ''),
    apiKey: cfg('apiKey', ''),
    apiMode: cfg('apiMode', ''),
    model: cfg('model', ''),
    reasoningEffort: cfg('reasoningEffort', 'minimal'),
    temperature: parseFloat(cfg('temperature', 0.3)),
    topP: parseFloat(cfg('topP', 0.5)),
    topK: cfg('topK', null),
    maxTokens: parseInt(cfg('maxTokens', 1500)),
    memoryLength: parseInt(cfg('memoryLength', 20)),
    stream: cfg('stream', true),
  };
}

function readLlmConfig() {
  // 变量优先级 > 插件配置 > DEFAULTS
  const fromVar = readVar(NS) || {};
  const fromPlugin = readPluginConfig();
  return {
    ...DEFAULTS,
    ...fromPlugin,
    ...(fromVar && typeof fromVar === 'object' ? fromVar : {}),
  };
}

function saveLlmConfig(cfg) {
  const merged = { ...DEFAULTS, ...cfg };
  writeVar(NS, merged, 'chat');
  writeVar(NS, merged, 'global');
  log('config saved:', JSON.stringify(merged));
}

// ============================================================
// 思考标签剥离（只删标签，保留标签内所有内容）
// MiniMax <<think> 标签内可能含实际台词
// ============================================================
function stripThinkingTags(s) {
  return (s || '')
    .replace(/<thinking>/gi, '').replace(/<\/thinking>/gi, '')
    .replace(/<think>/gi, '').replace(/<\/think>/gi, '')
    .replace(/<talk>/gi, '').replace(/<\/talk>/gi, '')
    .replace(/<reasoning>/gi, '').replace(/<\/reasoning>/gi, '')
    .replace(/<thought>/gi, '').replace(/<\/thought>/gi, '')
    .trim();
}

// ============================================================
// 编排器响应解析
// ============================================================
function parseOrchestratorResponse(rawText) {
  const text = (rawText || '').trim();
  const cleaned = stripThinkingTags(text);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1].trim() : cleaned;
  try {
    const obj = JSON.parse(jsonText);
    return {
      speaker: asTrim(obj.speaker) || '旁白',
      role: asTrim(obj.speaker),
      roleType: asTrim(obj.role_type || obj.roleType),
      motive: asTrim(obj.motive),
      awaitUser: !!(obj.await_user || obj.awaitUser),
      triggerMemoryAgent: !!(obj.trigger_memory_agent || obj.triggerMemoryAgent),
      eventSummary: asTrim(obj.event_summary || obj.eventSummary),
      eventFacts: Array.isArray(obj.event_facts || obj.eventFacts)
        ? (obj.event_facts || obj.eventFacts).map(asTrim).filter(Boolean) : [],
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
    speaker: extractField(text, ['speaker','role']) || '旁白',
    role: extractField(text, ['speaker','role']) || '旁白',
    roleType: extractField(text, ['role_type','roleType']) || 'narrator',
    motive: extractField(text, ['motive']) || '',
    awaitUser: /"await_user"\s*:\s*true/i.test(text) || /"awaitUser"\s*:\s*true/i.test(text),
    triggerMemoryAgent: false,
    eventSummary: extractField(text, ['event_summary','eventSummary']) || '',
    eventFacts: [],
    timeAdvance: null,
    source: 'fallback',
    _raw: null,
  };
}

// ============================================================
// 发言器响应解析
// ============================================================
function parseSpeakerResponse(rawText) {
  const text = (rawText || '').trim();
  const cleaned = stripThinkingTags(text);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : cleaned;
  try {
    const obj = JSON.parse(body);
    const content = obj.content || obj.text || obj.dialogue || obj.speech || '';
    return stripThinkingTags(String(content)).replace(/^["']|["']$/g, '').trim();
  } catch (e) {
    return body.replace(/^["']|["']$/g, '').trim();
  }
}

// ============================================================
// 辅助
// ============================================================
function asTrim(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

function extractField(text, fieldNames) {
  for (const name of fieldNames) {
    let m = text.match(new RegExp('"' + name + '"\\s*:\\s*"([^"]*)"', 'i'));
    if (m) return m[1];
    m = text.match(new RegExp('"' + name + '"\\s*:\\s*`([^`]*)`', 'i'));
    if (m) return m[1];
    m = text.match(new RegExp('"' + name + '"\\s*:\\s*([\\w.]+)', 'i'));
    if (m) return m[1];
  }
  return null;
}

// ============================================================
// 核心：判断是否走直接 fetch（适配器 URL）
// ============================================================
function isAdapterUrl(url) {
  return ADAPTER_URLS.some(prefix => (url || '').startsWith(prefix));
}

// ============================================================
// 直接 fetch 调用（MiniMax / SiliconFlow 等）
// ============================================================

// MiniMax chat.completions 格式
async function callMiniMax(messages, cfg) {
  const model = cfg.model || 'MiniMax-Text-01';
  const body = {
    model,
    messages,
    max_tokens: cfg.maxTokens || 1500,
    temperature: cfg.temperature ?? 0.3,
    top_p: cfg.topP ?? 0.5,
    stream: false,
  };
  if (cfg.reasoningEffort && cfg.reasoningEffort !== 'none') {
    body.reasoning_effort = cfg.reasoningEffort;
  }
  log('MiniMax request:', JSON.stringify({ model, max_tokens: body.max_tokens, reasoning_effort: body.reasoning_effort }));
  const resp = await fetch(cfg.apiUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('MiniMax API error ' + resp.status + ': ' + errText);
  }
  const data = await resp.json();
  const choice = (data.choices || [])[0] || {};
  return choice.message?.content || choice.text || '';
}

// SiliconFlow 格式（与 OpenAI 兼容）
async function callSiliconFlow(messages, cfg) {
  const model = cfg.model || 'deepseek-ai/DeepSeek-V3';
  const body = {
    model,
    messages,
    max_tokens: cfg.maxTokens || 1500,
    temperature: cfg.temperature ?? 0.3,
    top_p: cfg.topP ?? 0.5,
    stream: false,
  };
  log('SiliconFlow request:', JSON.stringify({ model, max_tokens: body.max_tokens }));
  const resp = await fetch(cfg.apiUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('SiliconFlow API error ' + resp.status + ': ' + errText);
  }
  const data = await resp.json();
  const choice = (data.choices || [])[0] || {};
  return choice.message?.content || choice.text || '';
}

// 阿里云 DashScope 格式（OpenAI 兼容）
async function callDashScope(messages, cfg) {
  const model = cfg.model || 'qwen-plus';
  const body = {
    model,
    messages,
    max_tokens: cfg.maxTokens || 1500,
    temperature: cfg.temperature ?? 0.3,
    top_p: cfg.topP ?? 0.5,
    stream: false,
  };
  log('DashScope request:', JSON.stringify({ model, max_tokens: body.max_tokens }));
  const resp = await fetch(cfg.apiUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('DashScope API error ' + resp.status + ': ' + errText);
  }
  const data = await resp.json();
  const choice = (data.choices || [])[0] || {};
  return choice.message?.content || choice.text || '';
}

// OpenAI 兼容格式（其他适配器）
async function callOpenAICompatible(messages, cfg) {
  const model = cfg.model || 'gpt-4o-mini';
  const body = {
    model,
    messages,
    max_tokens: cfg.maxTokens || 1500,
    temperature: cfg.temperature ?? 0.3,
    top_p: cfg.topP ?? 0.5,
    stream: false,
  };
  log('OpenAI-compatible request:', JSON.stringify({ model, max_tokens: body.max_tokens }));
  const resp = await fetch(cfg.apiUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('API error ' + resp.status + ': ' + errText);
  }
  const data = await resp.json();
  const choice = (data.choices || [])[0] || {};
  return choice.message?.content || choice.text || '';
}

// ============================================================
// 路由：根据 apiUrl 匹配适配器
// ============================================================
async function callAdapter(messages, cfg) {
  const url = (cfg.apiUrl || '').toLowerCase();
  if (url.includes('minimaxi') || url.includes('xiaomi')) {
    return callMiniMax(messages, cfg);
  }
  if (url.includes('siliconflow')) {
    return callSiliconFlow(messages, cfg);
  }
  if (url.includes('dashscope') || url.includes('aliyun')) {
    return callDashScope(messages, cfg);
  }
  // 其他 OpenAI 兼容格式
  return callOpenAICompatible(messages, cfg);
}

async function callAdapterDirect(messages, cfg) {
  return callAdapter(messages, cfg);
}

// ============================================================
// 直接调用（context=false，standalone 模式）
// MCS 编排调用这个
// ============================================================
async function llmCallDirect(prompt, options) {
  const cfg = readLlmConfig();
  const opts = options || {};
  const maxTokens = opts.maxCompletionTokens || opts.maxTokens || cfg.maxTokens || 1500;
  const temperature = opts.temperature ?? cfg.temperature ?? 0.3;
  const topP = opts.topP ?? cfg.topP ?? 0.5;

  // 没配置 apiKey/apiUrl 或不匹配适配器，走 tavo.generate()
  if (!cfg.apiKey || !cfg.apiUrl || !isAdapterUrl(cfg.apiUrl)) {
    log('fallback tavo.generate()');
    let raw;
    try {
      raw = await tavo.generate(prompt, {
        context: false,
        settings: { maxCompletionTokens: maxTokens },
      });
    } catch (e) {
      warn('tavo.generate failed:', e.message);
      throw e;
    }
    const stripped = stripThinkingTags((raw || '').trim());
    log('tavo.generate result len=' + stripped.length);
    return stripped;
  }

  // 直接调用适配器
  const messages = [{ role: 'user', content: prompt }];
  let rawText;
  try {
    rawText = await callAdapterDirect(messages, { ...cfg, maxTokens, temperature, topP });
  } catch (e) {
    warn('Adapter failed, fallback tavo.generate():', e.message);
    let raw;
    try {
      raw = await tavo.generate(prompt, { context: false, settings: { maxCompletionTokens: maxTokens } });
    } catch (e2) { warn('tavo.generate also failed:', e2.message); throw e2; }
    rawText = (raw || '').trim();
  }
  const stripped = stripThinkingTags(rawText);
  log('adapter result len=' + stripped.length + ' preview: ' + JSON.stringify(stripped.slice(0, 100)));
  return stripped;
}

// ============================================================
// 主入口：tf_llm.generate(prompt, options)
// 其他插件调这个（已废弃，统一用 llmCallDirect）
// ============================================================
async function llmGenerate(prompt, options) {
  return llmCallDirect(prompt, options);
}

// ============================================================
// 暴露全局 API
// ============================================================
if (typeof window !== 'undefined') {
  window.tf_llm = {
    generate: llmGenerate,
    callDirect: llmCallDirect,
    parseOrchestratorResponse,
    parseSpeakerResponse,
    parseResponse: parseOrchestratorResponse,
    getConfig: readLlmConfig,
    saveConfig: saveLlmConfig,
    stripThinkingTags,
    isAdapterUrl,
  };
}
try { tavo.tf_llm = window.tf_llm; } catch (e) {}

// ============================================================
// 初始化
// ============================================================
tavo.plugin.on('chat:opened', async () => {
  const saved = readVar(NS);
  if (saved && typeof saved === 'object') {
    log('chat:opened restored:', JSON.stringify(saved));
  } else {
    saveLlmConfig(DEFAULTS);
    log('chat:opened initialized defaults');
  }
});
