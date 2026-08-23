// toonflow_story_llm_optimization - 完全接管 LLM 接口调用
// 对齐 toonflow-game 的 llmGenerate 逻辑：读取 Tavo 配置 + 直接 fetch 调用适配器 API
// 其他插件通过 tf_llm.generate() 调用（不再直接调 tavo.generate()）

const NS = 'tf_llm';
const DEFAULTS = { enabled: true, apiUrl: '', apiKey: '', apiMode: '', model: "", reasoningEffort: 'none', temperature: 0.3, topP: 0.5, topK: null, maxTokens: 1500, memoryLength: 20, stream: true };

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

// MiniMax 模型名映射（保留，仅用于模型切换参考）
// MiniMax-M3 是默认推荐模型；M2-her 无思考能力
const MINIMAX_MODELS = {
  'MiniMax-M3': 'MiniMax-M3',
  'MiniMax-M2.7': 'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed': 'MiniMax-M2.7-highspeed',
  'M2-her': 'M2-her',
  'MiniMax-Text-01': 'MiniMax-Text-01',
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
    reasoningEffort: cfg('reasoningEffort', 'none'),
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

// MiniMax /v1/responses 格式（完全对齐 toonflow-game-app modelList.ts minimax 适配器）
// 核心转换：
//   URL: /v1/chat/completions → /v1/responses
//   Body: messages → instructions(system) + input(user)
//   reasoning: { effort: "none"|"minimal"|"low"|"medium"|"high" } 只在 /v1/responses 有效
//   响应: responses格式 → chat/completions格式（统一出口）
async function callMiniMax(messages, cfg) {
  const model = cfg.model || 'MiniMax-M3';
  const reasoningEffort = cfg.reasoningEffort || 'none';

  // 解析 messages：提取 system → instructions，user → input
  const systemMsg = (messages || []).find((m) => m.role === 'system');
  const userMsgs = (messages || []).filter((m) => m.role !== 'system') || [];
  const instructions = systemMsg?.content || '';
  const userContent = userMsgs.map((m) => m.content || '').join('\n');

  // 构建 /v1/responses 请求体
  const body = { model };
  if (instructions) body.instructions = instructions;
  if (userContent) body.input = userContent;
  // reasoning.effort 只在 /v1/responses 有效
  body.reasoning = { effort: reasoningEffort };
  if (cfg.temperature != null) body.temperature = cfg.temperature;
  else body.temperature = 0.3;
  if (cfg.topP != null) body.top_p = cfg.topP;
  else body.top_p = 0.5;

  // URL：apiUrl 已含 /v1，拼 /responses（不重复 /v1/）
  const baseUrl = cfg.apiUrl.replace(/\/$/, '');
  const url = baseUrl + '/responses';
  log('MiniMax request:', JSON.stringify({ url, model, reasoning: body.reasoning, temperature: body.temperature, top_p: body.top_p }));

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    warn('MiniMax fetch failed:', e.message, '| type:', e.name, '| stack:', (e.stack || '').slice(0, 300));
    throw new Error('fetch failed: ' + e.message);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    warn('MiniMax HTTP ' + resp.status + ': ' + errText.slice(0, 500));
    throw new Error('MiniMax API error ' + resp.status + ': ' + errText);
  }

  // 解析 /v1/responses 响应，转换回 chat/completions 统一格式
  const data = await resp.json();
  const outputText = data.output_text || '';
  const usage = data.usage || {};

  // 统一日志输出：显示 chat/completions 格式（与 SiliconFlow/DashScope 一致）
  log('MiniMax response text len=' + outputText.length + ' | model=' + (data.model || model)
    + ' | reasoning_tokens=' + (usage.output_tokens_details?.reasoning_tokens || 0));

  // 返回纯文本（与 chat/completions 格式的 choice.message.content 等价）
  return outputText;
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
  const url = cfg.apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
  log('SiliconFlow request:', JSON.stringify({ url, model, max_tokens: body.max_tokens }));
  const resp = await fetch(url, {
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
  const url = cfg.apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
  log('DashScope request:', JSON.stringify({ url, model, max_tokens: body.max_tokens }));
  const resp = await fetch(url, {
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
  const url = cfg.apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
  log('OpenAI-compatible request:', JSON.stringify({ url, model, max_tokens: body.max_tokens }));
  const resp = await fetch(url, {
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

  // prompt 可以是 string / [{role, content}] 消息数组 / {system, user} 对象
  const isMessagesArray = Array.isArray(prompt);
  const isSystemUserObj = !isMessagesArray && prompt && typeof prompt === 'object' && prompt.system !== undefined;

  // 统一转成 messages 数组（如果需要）
  function toMessages(p) {
    if (Array.isArray(p)) return p;
    if (p && typeof p === 'object' && p.system !== undefined) {
      return [
        { role: 'system', content: typeof p.system === 'string' ? p.system : JSON.stringify(p.system) },
        { role: 'user', content: typeof p.user === 'string' ? p.user : JSON.stringify(p.user || '') },
      ];
    }
    return [{ role: 'user', content: typeof p === 'string' ? p : JSON.stringify(p) }];
  }
  function toPromptString(p) {
    if (typeof p === 'string') return p;
    if (Array.isArray(p)) return p.map(m => (m.role === 'system' ? '[系统]\n' : '') + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
    if (p && typeof p === 'object' && p.system !== undefined) return (typeof p.system === 'string' ? '[系统]\n' + p.system : '') + '\n\n' + (typeof p.user === 'string' ? p.user : JSON.stringify(p.user || ''));
    return String(p);
  }

  // 有配置 apiKey + apiUrl + 有效适配器域名 → 走直接 fetch
  if (cfg.apiKey && cfg.apiUrl && isAdapterUrl(cfg.apiUrl)) {
    // 统一转成 messages 数组传给适配器
    const messages = toMessages(prompt);
    log('llmCallDirect: 走适配器 apiUrl=' + cfg.apiUrl + ' model=' + cfg.model + ' maxTokens=' + maxTokens
      + ' isMessagesArray=' + isMessagesArray + ' isSystemUserObj=' + isSystemUserObj);
    let rawText;
    try {
      rawText = await callAdapterDirect(messages, { ...cfg, maxTokens, temperature, topP });
    } catch (e) {
      warn('Adapter failed, fallback tavo.generate():', e.message);
      // fallback 走 tavo.generate 需要 string
      const promptStr = toPromptString(prompt);
      let raw;
      try {
        raw = await tavo.generate(promptStr, { context: false, settings: { maxCompletionTokens: maxTokens } });
      } catch (e2) { warn('tavo.generate also failed:', e2.message); throw e2; }
      rawText = (raw || '').trim();
    }
    const stripped = stripThinkingTags(rawText);
    log('adapter result len=' + stripped.length + ' preview: ' + JSON.stringify(stripped.slice(0, 80)));
    return stripped;
  }

  // 无适配器配置 → 走 tavo.generate()（需要 string）
  const promptStr = toPromptString(prompt);
  log('llmCallDirect: 走 tavo.generate() model=' + cfg.model + ' maxTokens=' + maxTokens);
  let raw;
  try {
    raw = await tavo.generate(promptStr, {
      context: false,
      settings: { maxCompletionTokens: maxTokens },
    });
  } catch (e) {
    warn('tavo.generate failed:', e.message);
    throw e;
  }
  const stripped = stripThinkingTags((raw || '').trim());
  log('tavo.generate result len=' + stripped.length + ' preview: ' + JSON.stringify(stripped.slice(0, 80)));
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
console.warn('[llm-opt] ✅ 插件加载成功 | tf_llm.callDirect=' + (typeof window.tf_llm?.callDirect) + ' | getConfig=' + JSON.stringify(window.tf_llm?.getConfig ? window.tf_llm.getConfig() : null).slice(0,300));

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
