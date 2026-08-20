'use strict';
// toonflow_story_voice - entry.js
// 克隆音色语音插件（对齐 toonflow_story_voice.md 设计）
//
// 业务对齐 Toonflow-game：
// - voice_platform: xiaomimimo / aliyun / tavo
//   - xiaomimimo: 模型固定 mimo-v2.5-tts-voiceclone（克隆）+ mimo-v2.5-tts（合成）
//   - aliyun: voice-enrollment -> cosyvoice-v3-plus
//   - tavo: 走 tavo 官方语音（本插件不接管）
// - voiceId 缓存: tf_voice 变量 { byCharId: { <charId>: { voiceId, platform, updatedAt, status } } }
// - voiceId 过期处理: 合成报错时清掉对应 voiceId 重新克隆
// - 切换平台: 清空所有 voiceId（旧平台 id 在新平台无效）

const VOICE_NS = 'tf_voice';          // voiceId 缓存 {byCharId: {...}}
const VOICE_FILE_NS = 'tf_voice_files'; // 音色文件路径 {byCharId: {file, name, uploadedAt}}

// 日志时间戳
const ts = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
    + ' ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
};
const vl = (...a) => console.log('[' + ts() + '] [voice] ' + a.join(' '));
const vw = (...a) => console.warn('[' + ts() + '] [voice] ' + a.join(' '));

// ---------- 工具 ----------
// 配置读取：优先 tf_voice_config 变量（跨插件面板可写），兜底插件 settings
const VOICE_CFG_NS = 'tf_voice_config';
function readVoiceCfgVar() {
  const v = readVar(VOICE_CFG_NS);
  return (v && typeof v === 'object') ? v : null;
}
function cfg(key, fb) {
  try {
    const fromVar = readVoiceCfgVar();
    if (fromVar && fromVar[key] !== undefined && fromVar[key] !== null && fromVar[key] !== '') {
      return fromVar[key];
    }
    const v = tavo.plugin.config.get(key);
    return v === undefined || v === null ? fb : v;
  } catch (e) { return fb; }
}

function readVar(name, scope) {
  try {
    let raw = null;
    try { raw = tavo.get(name, scope || 'chat'); } catch (e) {}
    if (!raw) { try { raw = tavo.get(name, 'global'); } catch (e) {} }
    let v = raw;
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) { v = v.value; guard++; }
    return v;
  } catch (e) { vw('readVar error', e.message); return null; }
}

function writeVar(name, value, scope) {
  try {
    tavo.set(name, value, scope || 'chat');
    if ((scope || 'chat') === 'chat') {
      try { tavo.set(name, value, 'global'); } catch (e) {}
    }
    return true;
  } catch (e) { vw('writeVar error', e.message); return false; }
}

// 读 voiceId 缓存
function getVoiceCache() {
  const v = readVar(VOICE_NS);
  if (v && typeof v === 'object' && v.byCharId) return v;
  return { byCharId: {} };
}

// 写 voiceId 缓存
function setVoiceCache(cache) {
  writeVar(VOICE_NS, cache, 'chat');
}

// 读音色文件绑定
function getVoiceFiles() {
  const v = readVar(VOICE_FILE_NS);
  if (v && typeof v === 'object' && v.byCharId) return v;
  return { byCharId: {} };
}

// ---------- 全局 API（供 panel / 其他插件调用） ----------
window.tf_voice = {
  // 取角色 voiceId（有缓存直接返回，无则 null）
  getVoiceId: (charId) => {
    const cache = getVoiceCache();
    const e = cache.byCharId[charId];
    const platform = cfg('voice_platform', 'xiaomimimo');
    if (e && e.platform === platform && e.voiceId) return e.voiceId;
    return null;
  },

  // 缓存 voiceId
  cacheVoiceId: (charId, voiceId) => {
    const cache = getVoiceCache();
    cache.byCharId[charId] = {
      voiceId: voiceId,
      platform: cfg('voice_platform', 'xiaomimimo'),
      updatedAt: Date.now(),
      status: 'ready',
    };
    setVoiceCache(cache);
    vl('cacheVoiceId charId=' + charId + ' voiceId=' + voiceId);
  },

  // voiceId 失效（合成报错时调用，下次重新克隆）
  invalidateVoiceId: (charId) => {
    const cache = getVoiceCache();
    if (cache.byCharId[charId]) {
      cache.byCharId[charId].status = 'expired';
      cache.byCharId[charId].voiceId = null;
      setVoiceCache(cache);
      vl('invalidateVoiceId charId=' + charId);
    }
  },

  // 绑定音色文件（角色配置弹窗保存时调用）
  bindVoiceFile: (charId, name, file) => {
    const files = getVoiceFiles();
    files.byCharId[charId] = { name: name, file: file, uploadedAt: Date.now() };
    writeVar(VOICE_FILE_NS, files, 'chat');
    // 文件变了，旧 voiceId 作废
    window.tf_voice.invalidateVoiceId(charId);
    vl('bindVoiceFile charId=' + charId + ' file=' + file);
  },

  // 读音色文件绑定
  getVoiceFile: (charId) => {
    const files = getVoiceFiles();
    return files.byCharId[charId] || null;
  },

  // 切换平台时清空全部 voiceId
  clearAllVoiceIds: () => {
    writeVar(VOICE_NS, { byCharId: {} }, 'chat');
    vl('clearAllVoiceIds（平台切换）');
  },

  getPlatform: () => cfg('voice_platform', 'xiaomimimo'),

  // 面板/其他插件写配置（跨 iframe 通过变量中转）
  setConfig: (partial) => {
    const old = readVoiceCfgVar() || {};
    const merged = { ...old, ...partial };
    writeVar(VOICE_CFG_NS, merged, 'chat');
    try { writeVar(VOICE_CFG_NS, merged, 'global'); } catch (e) {}
    // 平台切换 -> 清空全部 voiceId
    if (partial.voice_platform && partial.voice_platform !== old.voice_platform) {
      window.tf_voice.clearAllVoiceIds();
    }
    vl('setConfig: ' + JSON.stringify(partial));
    return merged;
  },
  getConfig: () => ({
    voice_platform: cfg('voice_platform', 'xiaomimimo'),
    voice_platform_apikey: cfg('voice_platform_apikey', ''),
    auto_play: cfg('auto_play', false),
  }),
};

// ---------- 平台 API 调用 ----------

// xiaomimimo: 克隆音色
// 文档对齐 toonflow-game: POST /v1/audio/voice/clone 模型 mimo-v2.5-tts-voiceclone
async function xiaomiCloneVoice(apiKey, audioUrl) {
  vl('xiaomiCloneVoice: mimo-v2.5-tts-voiceclone');
  const resp = await fetch('https://api.xiaomimimo.com/v1/audio/voice/clone', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts-voiceclone',
      audio_url: audioUrl,
    }),
  });
  if (!resp.ok) throw new Error('xiaomimimo clone HTTP ' + resp.status);
  const data = await resp.json();
  return data.voice_id || data.voiceId || data.id;
}

// xiaomimimo: 合成语音
async function xiaomiTts(apiKey, voiceId, text) {
  const resp = await fetch('https://api.xiaomimimo.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      voice: voiceId,
      input: text,
    }),
  });
  if (!resp.ok) throw new Error('xiaomimimo tts HTTP ' + resp.status);
  return await resp.arrayBuffer();
}

// aliyun: 注册音色（voice-enrollment）
async function aliyunEnrollVoice(apiKey, audioUrl, prefix) {
  vl('aliyunEnrollVoice: voice-enrollment');
  const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/enrollment', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voice-enrollment',
      input: { prefix: prefix },
      parameters: { audio_url: audioUrl },
    }),
  });
  if (!resp.ok) throw new Error('aliyun enroll HTTP ' + resp.status);
  const data = await resp.json();
  return data.output.voice_id || data.voiceId;
}

// aliyun: 合成（cosyvoice-v3-plus）
async function aliyunTts(apiKey, voiceId, text) {
  const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'cosyvoice-v3-plus',
      input: { text: text },
      parameters: { voice: voiceId },
    }),
  });
  if (!resp.ok) throw new Error('aliyun tts HTTP ' + resp.status);
  const data = await resp.json();
  return data.output.audio.url;
}

// ---------- 逐句拆分（对齐 toonflow splitSpeechSegments） ----------
// 按句号/感叹号/问号拆分，保留标点，保留动作描写小括号内的完整内容（不打断）
function splitSpeechSegments(text) {
  // 保护动作描写：(...) 内不拆分
  const protectedPhrases = [];
  let clean = text.replace(/\([^)]+\)/g, (m) => {
    protectedPhrases.push(m);
    return '\x00PROT' + (protectedPhrases.length - 1) + '\x00';
  });
  // 按句子切分（保留句末标点）
  const segments = clean.split(/(?<=[。！？.?!])/).filter(Boolean);
  // 恢复保护内容
  return segments.map(s => s.replace(/\x00PROT(\d+)\x00/g, (_, i) => protectedPhrases[parseInt(i)]))
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ---------- 流式状态追踪（对齐 toonflow NDJSON sentence-event 语义） ----------
// pendingMessages: msgId -> { charId, content, meta, streaming, startedAt }
// 用于在 message:added（流式开始）后等待流式完成（message:updated），再触发完整 TTS
const _pendingStreamMessages = new Map();

// 核心 TTS 播放函数（供 message:added 和 sentence-event 回调共用）
async function playTtsForSegments(charId, segments) {
  const platform = cfg('voice_platform', 'xiaomimimo');
  const apiKey = cfg('voice_platform_apikey', '');
  if (!apiKey) { vw('未配置 API Key，跳过语音'); return; }

  let voiceId = window.tf_voice.getVoiceId(charId);
  if (!voiceId) {
    const vf = window.tf_voice.getVoiceFile(charId);
    if (!vf || !vf.file) { vw('角色 ' + charId + ' 无音色文件，跳过'); return; }
    const audioUrl = tavo.file.url(vf.file, 'chat');
    voiceId = (platform === 'aliyun')
      ? await aliyunEnrollVoice(apiKey, audioUrl, 'tf_' + charId)
      : await xiaomiCloneVoice(apiKey, audioUrl);
    window.tf_voice.cacheVoiceId(charId, voiceId);
  }

  for (let i = 0; i < segments.length; i++) {
    const segText = segments[i].slice(0, 200);
    try {
      if (platform === 'aliyun') {
        const audioUrl = await aliyunTts(apiKey, voiceId, segText);
        const audio = new Audio(audioUrl);
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play();
        });
      } else {
        const buf = await xiaomiTts(apiKey, voiceId, segText);
        const blob = new Blob([buf], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await new Promise((resolve, reject) => {
          audio.onended = () => { resolve(); };
          audio.onerror = (e) => { reject(e); };
          audio.play().catch(reject);
        });
      }
      vl('[逐句] 第' + (i + 1) + '/' + segments.length + '句播放完毕: ' + segText.slice(0, 20));
    } catch (e) {
      vw('[逐句] 第' + (i + 1) + '句 TTS 失败: ' + e.message);
      window.tf_voice.invalidateVoiceId(charId);
      break;
    }
  }
  vl('[逐句] 全部播放完毕 charId=' + charId);
}

// ---------- message:added -> 检测流式开始/完整消息 ----------
// 对齐官方 introduction.ts streamSessionIntroductionPlan：
// - message:added 可能是流式中间态（content 还在追加，meta.streaming=true）
// - 流式开始时记录消息，收到 message:updated 时触发完整 TTS
// - 非流式消息（meta.streaming !== true）直接触发 TTS
tavo.plugin.on('message:added', async (event) => {
  const platform = cfg('voice_platform', 'xiaomimimo');
  const autoPlay = cfg('auto_play', false);
  if (platform === 'tavo' || !autoPlay) return;

  const msg = event && event.message;
  if (!msg || msg.role !== 'assistant' || !msg.characterId) return;

  const charId = String(msg.characterId);
  const msgId = String(msg.id || '');
  const rawText = (msg.content || '').replace(/<[^>]+>/g, '').trim();
  if (!rawText) return;

  // 读取 meta 判断是否流式（对齐官方 message.meta.streaming）
  const meta = msg.meta || {};
  const isStreaming = meta.streaming === true;
  vl('[流式] msgId=' + msgId + ' streaming=' + isStreaming + ' content_len=' + rawText.length);

  if (isStreaming) {
    // 流式中间态：记录消息，等待 message:updated 触发完整 TTS
    _pendingStreamMessages.set(msgId, { charId, content: rawText, meta, startedAt: Date.now() });
    vl('[流式] 记录流式消息，等待完成 msgId=' + msgId);
  } else {
    // 完整消息：直接触发 TTS
    const segments = splitSpeechSegments(rawText);
    vl('[完整] charId=' + charId + ' 共' + segments.length + '句');
    try {
      await playTtsForSegments(charId, segments);
    } catch (e) {
      vw('语音失败: ' + e.message);
      window.tf_voice.invalidateVoiceId(charId);
    }
  }
});

// ---------- message:updated -> 流式完成，触发完整 TTS ----------
// 对齐官方 NDJSON done 事件语义：流式完成后一次性处理完整 content
tavo.plugin.on('message:updated', async (event) => {
  const msgId = String(event && event.message && event.message.id || '');
  if (!msgId) return;

  const pending = _pendingStreamMessages.get(msgId);
  if (!pending) return;

  // 流式完成：读取完整 content（可能通过 message.find 重新获取）
  let fullContent = '';
  try {
    const msgs = await tavo.message.find([0, 100]);
    const found = (msgs || []).find(m => String(m.id || '') === msgId);
    if (found) {
      fullContent = (found.content || '').replace(/<[^>]+>/g, '').trim();
    } else {
      // 找不到就用缓存 content
      fullContent = pending.content;
    }
  } catch (e) {
    fullContent = pending.content;
  }

  // 判断流式是否真正结束（meta.streaming !== true）
  let streamingDone = true;
  try {
    const msgs = await tavo.message.find([0, 100]);
    const found = (msgs || []).find(m => String(m.id || '') === msgId);
    if (found && found.meta && found.meta.streaming === true) {
      streamingDone = false; // 还在流式，暂不触发
    }
  } catch (e) {}

  if (!streamingDone) return;

  _pendingStreamMessages.delete(msgId);
  vl('[流式完成] msgId=' + msgId + ' content_len=' + fullContent.length);

  if (!fullContent) return;

  const segments = splitSpeechSegments(fullContent);
  vl('[流式TTS] charId=' + pending.charId + ' 共' + segments.length + '句');
  try {
    await playTtsForSegments(pending.charId, segments);
  } catch (e) {
    vw('流式语音失败: ' + e.message);
    window.tf_voice.invalidateVoiceId(pending.charId);
  }
});

// ---------- tf_voice_stream API（对齐官方 sentence-event NDJSON 语义） ----------
// 外部（mcs 编排插件）可在每句生成时调用 onSentence，实现真正的逐句实时 TTS
// 当 TTS 服务支持低延迟单句合成时，用此接口替代等待 message:updated
window.tf_voice_stream = {
  // sentence-event 回调：编排插件每生成一句台词时调用，实时触发 TTS
  // sentence: 本句文本，index: 句子序号（0-based），msgId: 关联消息ID，charId: 角色ID
  onSentence: async (charId, sentence, index, msgId) => {
    const platform = cfg('voice_platform', 'xiaomimimo');
    const autoPlay = cfg('auto_play', false);
    if (platform === 'tavo' || !autoPlay) return;
    const text = String(sentence || '').replace(/<[^>]+>/g, '').trim();
    if (!text) return;
    vl('[sentence] charId=' + charId + ' idx=' + index + ' text=' + text.slice(0, 30));

    try {
      const apiKey = cfg('voice_platform_apikey', '');
      if (!apiKey) return;

      let voiceId = window.tf_voice.getVoiceId(charId);
      if (!voiceId) {
        const vf = window.tf_voice.getVoiceFile(charId);
        if (!vf || !vf.file) return;
        const audioUrl = tavo.file.url(vf.file, 'chat');
        voiceId = (platform === 'aliyun')
          ? await aliyunEnrollVoice(apiKey, audioUrl, 'tf_' + charId)
          : await xiaomiCloneVoice(apiKey, audioUrl);
        window.tf_voice.cacheVoiceId(charId, voiceId);
      }

      const segText = text.slice(0, 200);
      if (platform === 'aliyun') {
        const audioUrl = await aliyunTts(apiKey, voiceId, segText);
        const audio = new Audio(audioUrl);
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play();
        });
      } else {
        const buf = await xiaomiTts(apiKey, voiceId, segText);
        const blob = new Blob([buf], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await new Promise((resolve, reject) => {
          audio.onended = () => { resolve(); };
          audio.onerror = (e) => { reject(e); };
          audio.play().catch(reject);
        });
      }
      vl('[sentence] TTS完成 charId=' + charId + ' idx=' + index);
    } catch (e) {
      vw('[sentence] TTS失败 charId=' + charId + ': ' + e.message);
      window.tf_voice.invalidateVoiceId(charId);
    }
  },

  // 流式消息开始：通知开始追踪（配合 message:added 流式中间态）
  onStreamStart: (msgId, charId) => {
    vl('[stream] start msgId=' + msgId + ' charId=' + charId);
    _pendingStreamMessages.set(String(msgId), { charId: String(charId), content: '', meta: { streaming: true }, startedAt: Date.now() });
  },

  // 流式消息完成：强制触发 TTS（外部可调用，覆盖 message:updated 的自动检测）
  onStreamDone: async (msgId) => {
    const pending = _pendingStreamMessages.get(String(msgId));
    if (!pending) return;
    let fullContent = pending.content;
    // 尝试从消息列表获取最新 content
    try {
      const msgs = await tavo.message.find([0, 100]);
      const found = (msgs || []).find(m => String(m.id || '') === String(msgId));
      if (found) fullContent = (found.content || '').replace(/<[^>]+>/g, '').trim();
    } catch (e) {}
    _pendingStreamMessages.delete(String(msgId));
    if (!fullContent) return;
    const segments = splitSpeechSegments(fullContent);
    vl('[streamDone] msgId=' + msgId + ' charId=' + pending.charId + ' 共' + segments.length + '句');
    try {
      await playTtsForSegments(pending.charId, segments);
    } catch (e) {
      vw('[streamDone] 失败: ' + e.message);
      window.tf_voice.invalidateVoiceId(pending.charId);
    }
  },

  // 查询流式状态
  isStreaming: (msgId) => _pendingStreamMessages.has(String(msgId)),
};

// ---------- 平台切换 -> 清空 voiceId ----------
tavo.plugin.on('chat:opened', async () => {
  vl('chat:opened, platform=' + cfg('voice_platform', 'xiaomimimo'));
});

vl('插件已加载');

// 平台配置变化 -> 清空缓存
try {
  tavo.plugin.config.onChange((changed) => {
    if (changed && changed.key === 'voice_platform') {
      window.tf_voice.clearAllVoiceIds();
    }
  });
} catch (e) {}