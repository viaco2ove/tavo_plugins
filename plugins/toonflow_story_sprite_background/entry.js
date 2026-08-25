'use strict';

// 日志时间戳
const ts = () => {
  const d = new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
    + ' ' + [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3,'0');
};
const sl = (...a) => console.log('[sprite_background][' + ts() + '] ' + a.join(' '));
const sw = (...a) => console.warn('[sprite_background][' + ts() + '] ' + a.join(' '));
// toonflow_story_sprite_background - entry.js
// 背景：tavo.chat.update({ background: { image: '...' } }) 原生 API
// 前景：DOM 层 #tf-sprite-fg

const NS_SPRITE = 'tf_sprites';
const BG_NS = 'tf_chapter_backgrounds';
const FB_NS = 'tf_sprite_fallback_bg';
const PERSONA_KEY = 'tf_sprite_persona_name'; // 变量名：存 persona 角色名

function cfg(key, fb) {
  try { const v = tavo.plugin.config.get(key); return v === undefined || v === null ? fb : v; } catch(e) { return fb; }
}

let _chatId = null;
let _chatIdInit = false;
let _updateSpriteRetried = false;
function getChatId() {
  if (_chatId) return _chatId;
  if (!_chatIdInit) {
    _chatIdInit = true;
    try {
      const result = tavo.chat.current();
      if (result && typeof result.then === 'function') {
        result.then(chat => { _chatId = chat && chat.id; }).catch(() => {});
      } else {
        _chatId = result && result.id;
      }
    } catch(e) {}
  }
  return _chatId;
}

// 强制刷新 _chatId（异步版，用于 updateSprite 重试路径）
async function refreshChatId() {
  try {
    const chat = await tavo.chat.current();
    _chatId = chat && chat.id;
  } catch(e) {}
  return _chatId;
}

function readGlobalVar(name) {
  try {
    let v = tavo.get(name, 'global');
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) {
      v = v.value; guard++;
    }
    return v;
  } catch (e) { return null; }
}

function readVar(name) {
  try {
    let raw = null;
    // 对于立绘变量，优先读 global scope 的 tf_sprites_{chatId}（同步脚本写入的格式）
    if (name === NS_SPRITE || name === BG_NS || name === 'tf_story.edit') {
      const cid = getChatId();
      if (cid) {
        const nameWithId = (name === 'tf_story.edit')
          ? ('tf_story_' + cid + '.edit')
          : (name + '_' + cid);
        try { raw = tavo.get(nameWithId, 'global'); } catch(e) {}
        if (raw) {
          sl('[sprite] readVar found global ' + nameWithId);
        }
      }
    }
    // 兜底：先 chat scope 再 global scope
    if (!raw) {
      try { raw = tavo.get(name, 'chat'); } catch(e) {}
    }
    if (!raw) {
      try { raw = tavo.get(name, 'global'); } catch(e) {}
    }
    sl('[sprite] readVar "' + name + '" raw=' + (raw ? JSON.stringify(raw).slice(0, 200) : 'null/undefined'));
    let v = raw;
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) { v = v.value; guard++; }
    sl('[sprite] readVar "' + name + '" unwrapped=' + (v ? JSON.stringify(v).slice(0, 200) : 'null/undefined'));
    return v;
  } catch(e) { sw('[sprite] readVar error', e.message); return null; }
}

function resolveUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('files/')) {
    // tavo.file.url(name, scope) 需要两个参数
    // 文件存在 chat scope，name 只需文件名（不含 files/chat/ 前缀）
    const name = path.split('/').pop() || path;
    let url = '';
    try { url = tavo.file.url(name, 'chat') || tavo.file.url(path, 'chat')
        ||tavo.file.url(name, 'global') || tavo.file.url(path, 'global')
        || path; } catch(e) { url = path; }
    sl('[sprite] resolveUrl(' + path + ') name=' + name + ' → ' + url);
    return url;
  }
  // 相对路径：直接用
  let url = '';
  try { url = tavo.file.url(path, 'chat') ||tavo.file.url(path, 'global')|| path; } catch(e) { url = path; }
  return url;
}

function getSpeaker() {
  try {
    const cnt = tavo.message.count();
    if (!cnt) return null;
    const msgs = tavo.message.find([Math.max(0, cnt - 5), cnt - 1]);
    if (!Array.isArray(msgs) || !msgs.length) return null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] && msgs[i].characterName) return msgs[i].characterName;
    }
  } catch(e) {}
  return null;
}

// ===== 背景图切换（走 tavo 原生 API，带重试） =====
// chat:opened 触发时 tavo 内部可能未 ready，报 "internal error, try again"
// 重试 3 次，每次间隔 500ms
async function _retry(fn, label, maxTries) {
  let lastErr = null;
  for (let i = 1; i <= maxTries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      // 只有 "internal error" / "try again" / "Tavo could not complete" 才重试
      const retriable = /internal error|try again|could not complete|not ready/i.test(msg);
      if (!retriable || i === maxTries) throw e;
      sw('[sprite] ' + label + ' retry ' + i + '/' + (maxTries-1) + ': ' + msg);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

async function setBackground(bgPath) {
  try {
    sl('[sprite] setBackground bgPath=' + bgPath);
    if (bgPath) {
      const res = await _retry(
        () => tavo.chat.update({ background: { image: bgPath, opacity: 0.85 } }),
        'setBackground', 4);
      sl('[sprite] setBackground result=' + JSON.stringify(res));
    } else {
      const fb = readVar(FB_NS) || '';
      sl('[sprite] setBackground fallback=' + fb);
      if (fb) {
        const res = await _retry(
          () => tavo.chat.update({ background: { image: fb, opacity: 0.85 } }),
          'setBackgroundFallback', 4);
        sl('[sprite] setBackground fallback result=' + JSON.stringify(res));
      }
    }
  } catch(e) {
    sw('[sprite] setBackground error', e);
  }
}

// ===== 变量同步恢复：chat reset 后从 global 重建 chat scope =====
// tavo_chat_reset 清 chat scope 但 global 不清；初始化时恢复
function syncVarsFromGlobal() {
  for (const ns of [NS_SPRITE, BG_NS, FB_NS]) {
    try {
      const chatVal = readVar(ns);
      if (chatVal && typeof chatVal === 'object' && Object.keys(chatVal).length) {
        sl('[sprite] ' + ns + ' chat 已就绪，跳过恢复');
        continue;
      }
      const gv = readVar(ns);
      if (gv && typeof gv === 'object' && Object.keys(gv).length) {
         console.log('sprite_background_fun]['+ns+']set');
        try { tavo.set(ns, gv, 'chat'); sl('[sprite] ✓ ' + ns + ' 从 global 恢复到 chat，' + Object.keys(gv).length + ' 键'); } catch(e) {}
      }
    } catch(e) {}
  }
}

// ===== 前景立绘切换（DOM 层） =====
function setForeground(fgPath) {
  const fgImg = document.getElementById('tf-sprite-fg');
  const fgWrap = document.getElementById('tf-sprite-fg-wrap');
  sl('[sprite] setForeground fgPath=' + fgPath + ' | #tf-sprite-fg=' + !!fgImg + ' | #tf-sprite-fg-wrap=' + !!fgWrap);
  if (!fgImg) {
    // 尝试直接查找 img 标签
    const imgs = document.querySelectorAll('img.tf-sprite-fg');
    sl('[sprite] fallback img.tf-sprite-fg count=' + imgs.length);
    if (imgs.length > 0) {
      sl('[sprite] using fallback img, src before=' + imgs[0].src + ' class=' + imgs[0].className);
    }
    return;
  }
  if (fgPath) {
    const url = resolveUrl(fgPath);
    const basename = fgPath.split('/').pop();
    sl('[sprite] setCharacterProfileDrawing: ' + basename + ' (resolved: ' + url + ')');
    if (fgImg.src !== url) {
      fgImg.src = url;
      sl('[sprite] setForeground src set to ' + url);
    }
    fgImg.classList.remove('hidden');
    if (fgWrap) fgWrap.classList.remove('hidden');
    sl('[sprite] setForeground visible | wrap class=' + (fgWrap ? fgWrap.className : 'N/A') + ' img class=' + fgImg.className);
  } else {
    fgImg.classList.add('hidden');
    if (fgWrap) fgWrap.classList.add('hidden');
    fgImg.src = '';
    sl('[sprite] setForeground hidden');
  }
}

// ===== 主渲染 =====
function updateSprite(speakerName) {
  sl('=== [sprite] updateSprite speaker=' + speakerName + ' enabled=' + cfg('enabled', true) + ' ===');

  // _chatId 还没异步解析完，刷新后延迟重试一次（避免无限递归）
  if (!_chatId && !_updateSpriteRetried) {
    _updateSpriteRetried = true;
    refreshChatId().then(function() {
      _updateSpriteRetried = false;
      updateSprite(speakerName);
    });
    return;
  }

  if (!cfg('enabled', true)) {
    setForeground('');
    sl('[sprite] disabled, hiding foreground');
    return;
  }

  const sprites = readVar(NS_SPRITE) || {};
  sl('[sprite] tf_sprites=' + JSON.stringify(sprites).slice(0, 300));

  const byName = sprites.byName || {};
  const chapterBgs = readVar(BG_NS) || {};
  sl('[sprite] tf_chapter_backgrounds=' + JSON.stringify(chapterBgs));

  const storyEdit = readVar('tf_story.edit') || {};
  const curChapterIdx = storyEdit.currentChapterIndex || 0;
  sl('[sprite] currentChapterIndex=' + curChapterIdx);

  const entry = byName[speakerName] || null;
  sl('[sprite] entry for "' + speakerName + '"=' + JSON.stringify(entry));

  const roleType = entry && entry.roleType;
  const showNarrator = cfg('showForNarrator', false);
  sl('[sprite] roleType=' + roleType + ' showNarrator=' + showNarrator);

  // 旁白默认不显示前景，但背景保留
  if (roleType === 'narrator' && !showNarrator) {
    setForeground('');
    sl('[sprite] narrator, hiding foreground');
  } else {
    let fgPath = entry && entry.fg ? entry.fg : '';
    if (!fgPath && cfg('useAvatarAsSprite', false) && entry && entry.avatar) {
      fgPath = entry.avatar;
      sl('[sprite] fallback to avatar=' + fgPath);
    }
    setForeground(fgPath);
  }

  // 背景图：章节背景 or 角色氛围背景
  const bgMode = cfg('backgroundMode', 'chapter');
  let bgPath = '';
  if (bgMode === 'character' && entry && entry.bg) {
    bgPath = entry.bg;
  } else {
    const chapterKeys = Object.keys(chapterBgs);
    const key = chapterKeys[curChapterIdx] || chapterKeys[0] || '';
    bgPath = chapterBgs[key] || '';
    sl('[sprite] bgPath from chapterBgs key=' + key + ' bgPath=' + bgPath);
  }
  setBackground(bgPath);
}

// ===== 事件监听 =====
let _charNameCache = null;
let _charNameCacheAt = 0;

// 优先从 tf_last_speaker 变量取发言者（MCS 插件在 input:beforeSend 时写入）
// 其次才从 message:added event 解析（tavo 有延迟，可能缺 characterName）
function resolveSpeaker(msg) {
  // 1. 优先读 tf_last_speaker（由 MCS 插件写入）
  const lastSpeaker = readVar('tf_last_speaker');
  if (lastSpeaker && lastSpeaker.name) {
    sl('[sprite] resolved from tf_last_speaker: ' + lastSpeaker.name);
    return { name: lastSpeaker.name, id: lastSpeaker.characterId || null };
  }
  // 2. event.message 有 characterName
  if (msg && msg.characterName) {
    return { name: msg.characterName, id: msg.characterId || null };
  }
  // 3. 有 characterId，从缓存角色列表反查 name
  if (msg && msg.characterId) {
    if (!_charNameCache || Date.now() - _charNameCacheAt > 30000) {
      try {
        const chat = tavo.chat.current();
        _charNameCache = {};
        ((chat && chat.characters) || []).forEach(c => { _charNameCache[c.id] = c.name; });
        _charNameCacheAt = Date.now();
      } catch (e) { _charNameCache = {}; }
    }
    const name = _charNameCache[msg.characterId];
    sl('[sprite] resolved characterId=' + msg.characterId + ' → name=' + name);
    return { name: name || null, id: msg.characterId };
  }
  return { name: null, id: null };
}

tavo.plugin.on('message:added', async (event) => {
  const msg = event && event.message;
  sl('[sprite] message:added raw event=' + JSON.stringify(event || {}).slice(0, 300));
  if (!msg) { sl('[sprite] no msg in event'); return; }

  // 用户消息 -> 立即切到用户立绘（persona），并清掉 tf_last_speaker 防止旧值污染
  if (msg.role === 'user') {
    sl('[sprite] user msg -> 切换用户立绘');
    console.log('sprite_background_fun][tf_last_speaker]set');
    try { tavo.set('tf_last_speaker', null, 'chat'); } catch (e) {}
    const sprites0 = readVar(NS_SPRITE) || {};
    const personaName = readVar(PERSONA_KEY) || '纯小白'; // 默认 persona 名
    const personaEntry = (sprites0.byName || {})[personaName] || null;
    if (personaEntry) {
      sl('[sprite] persona "' + personaName + '" entry: ' + JSON.stringify(personaEntry).slice(0, 120));
      await updateSprite(personaName);
    } else {
      sl('[sprite] persona "' + personaName + '" 无立绘，隐藏前景');
      await updateSprite(null);
    }
    return;
  }

  // 编排中跳过（等 MCS 的 message:added 通知角色立绘）
  const orchActive = readVar('tf_orch.active');
  const isOrchOn = orchActive === true || orchActive === 'true' || orchActive === 1 || orchActive === '1';
  if (isOrchOn) { sl('[sprite] 编排中，跳过 sprite 切换'); return; }

  const { name: speakerName, id: speakerId } = resolveSpeaker(msg);
  if (!speakerName) { sl('[sprite] no speakerName resolved, skip'); return; }

  const sprites = readVar(NS_SPRITE) || {};
  const byName = sprites.byName || {};
  const entry = byName[speakerName] || null;
  sl('[sprite] message:added → characterName=' + speakerName + ' characterId=' + speakerId + ' entry=' + JSON.stringify(entry));
  sl('[sprite] allSpriteNames: ' + Object.keys(byName).join(', '));

  // DOM 检查
  const fgImg = document.getElementById('tf-sprite-fg');
  sl('[sprite] DOM check: #tf-sprite-fg exists=' + !!fgImg + ' src=' + (fgImg ? fgImg.src : 'N/A') + ' classList=' + (fgImg ? fgImg.className : 'N/A'));

  updateSprite(speakerName);
});

try {
  if (tavo.plugin && tavo.plugin.config) {
    tavo.plugin.config.onChange(() => {
      sl('[sprite] config changed');
      updateSprite(getSpeaker());
    });
  }
} catch(e) {}

// chat reset 后从 global 恢复立绘变量
tavo.plugin.on('chat:opened', () => {
  sl('[sprite] chat:opened → syncVarsFromGlobal');
  syncVarsFromGlobal();
});

// ===== Sidebar =====
tavo.plugin.onSidebarAction('tf-sprite-toggle', () => {
  try {
    const cur = tavo.plugin.config.get('enabled');
    if (typeof tavo.plugin?.config?.set === 'function') tavo.plugin.config.set('enabled', cur ? false : true);
    tavo.utils.toast(cur ? '立绘已关闭' : '立绘已开启');
    updateSprite(getSpeaker());
  } catch(e) { tavo.utils.toast('切换失败'); }
});

// ===== 对外 API（供其他插件主动切换立绘） =====
window.tfSpriteAPI = {
  showSprite: (fgPath, speakerName) => {
    sl('[tfSpriteAPI] showSprite fg=' + fgPath + ' speaker=' + speakerName);
    updateSprite(speakerName || null);
  },
  hideSprite: () => {
    sl('[tfSpriteAPI] hideSprite');
    updateSprite(null);
  }
};
sl('[sprite] tfSpriteAPI registered');

// ===== 初始化 =====
sl('[sprite] init in 800ms...');
setTimeout(() => {
  const speaker = getSpeaker();
  sl('[sprite] init speaker=' + speaker);
  updateSprite(speaker);
}, 800);