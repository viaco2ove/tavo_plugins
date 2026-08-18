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
function cfg(key, fb) {
  try {
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

// ---------- 消息到达 -> 自动播放 ----------
tavo.plugin.on('message:added', async (event) => {
  const platform = cfg('voice_platform', 'xiaomimimo');
  const autoPlay = cfg('auto_play', false);
  if (platform === 'tavo' || !autoPlay) return;  // tavo 平台不接管

  const msg = event && event.message;
  if (!msg || msg.role !== 'assistant' || !msg.characterId) return;

  const charId = String(msg.characterId);
  const text = (msg.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 120);
  if (!text) return;

  try {
    const apiKey = cfg('voice_platform_apikey', '');
    if (!apiKey) { vw('未配置 API Key，跳过语音'); return; }

    let voiceId = window.tf_voice.getVoiceId(charId);
    if (!voiceId) {
      // 无 voiceId，查是否有音色文件 -> 克隆
      const vf = window.tf_voice.getVoiceFile(charId);
      if (!vf || !vf.file) { vw('角色 ' + charId + ' 无音色文件，跳过'); return; }
      const audioUrl = tavo.file.url(vf.file, 'chat');
      voiceId = (platform === 'aliyun')
        ? await aliyunEnrollVoice(apiKey, audioUrl, 'tf_' + charId)
        : await xiaomiCloneVoice(apiKey, audioUrl);
      window.tf_voice.cacheVoiceId(charId, voiceId);
    }

    // 合成
    if (platform === 'aliyun') {
      const audioUrl = await aliyunTts(apiKey, voiceId, text);
      const audio = new Audio(audioUrl);
      audio.play();
    } else {
      const buf = await xiaomiTts(apiKey, voiceId, text);
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    }
    vl('播放语音 charId=' + charId);
  } catch (e) {
    vw('语音失败（voiceId 可能过期，已失效重试）: ' + e.message);
    window.tf_voice.invalidateVoiceId(charId);
  }
});

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