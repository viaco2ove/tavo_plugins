'use strict';
// toonflow_story_sprite_background - entry.js
// 背景：tavo.chat.update({ background: { image: '...' } }) 原生 API
// 前景：DOM 层 #tf-sprite-fg

const NS = 'tf_sprites';
const BG_NS = 'tf_chapter_backgrounds';
const FB_NS = 'tf_sprite_fallback_bg';

function cfg(key, fb) {
  try { const v = tavo.plugin.config.get(key); return v === undefined || v === null ? fb : v; } catch(e) { return fb; }
}

function readVar(name) {
  try {
    // 先 chat scope 再 global scope
    let raw = null;
    try { raw = tavo.get(name, 'chat'); } catch(e) {}
    if (!raw) {
      try { raw = tavo.get(name, 'global'); } catch(e) {}
    }
    console.log('[sprite] readVar "' + name + '" raw=' + (raw ? JSON.stringify(raw).slice(0, 200) : 'null/undefined'));
    let v = raw;
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) { v = v.value; guard++; }
    console.log('[sprite] readVar "' + name + '" unwrapped=' + (v ? JSON.stringify(v).slice(0, 200) : 'null/undefined'));
    return v;
  } catch(e) { console.warn('[sprite] readVar error', e.message); return null; }
}

function resolveUrl(path) {
  if (!path) return '';
  if (path.startsWith('files/')) {
    try { return tavo.file.url(path) || path; } catch(e) { return path; }
  }
  if (/^https?:\/\//.test(path)) return path;
  return path;
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

// ===== 背景图切换（走 tavo 原生 API） =====
async function setBackground(bgPath) {
  try {
    console.log('[sprite] setBackground bgPath=' + bgPath);
    if (bgPath) {
      const res = await tavo.chat.update({ background: { image: bgPath, opacity: 0.85 } });
      console.log('[sprite] setBackground result=' + JSON.stringify(res));
    } else {
      const fb = readVar(FB_NS) || '';
      console.log('[sprite] setBackground fallback=' + fb);
      if (fb) {
        const res = await tavo.chat.update({ background: { image: fb, opacity: 0.85 } });
        console.log('[sprite] setBackground fallback result=' + JSON.stringify(res));
      }
    }
  } catch(e) {
    console.warn('[sprite] setBackground error', e);
  }
}

// ===== 变量同步恢复：chat reset 后从 global 重建 chat scope =====
// tavo_chat_reset 清 chat scope 但 global 不清；初始化时恢复
function syncVarsFromGlobal() {
  for (const ns of [NS, BG_NS, FB_NS]) {
    try {
      const chatVal = readVar(ns);
      if (chatVal && typeof chatVal === 'object' && Object.keys(chatVal).length) {
        console.log('[sprite] ' + ns + ' chat 已就绪，跳过恢复');
        continue;
      }
      const gv = readVar(ns);
      if (gv && typeof gv === 'object' && Object.keys(gv).length) {
        try { tavo.set(ns, gv, 'chat'); console.log('[sprite] ✓ ' + ns + ' 从 global 恢复到 chat，' + Object.keys(gv).length + ' 键'); } catch(e) {}
      }
    } catch(e) {}
  }
}

// ===== 前景立绘切换（DOM 层） =====
function setForeground(fgPath) {
  const fgImg = document.getElementById('tf-sprite-fg');
  console.log('[sprite] setForeground fgPath=' + fgPath + ' fgImg=' + !!fgImg);
  if (!fgImg) return;
  if (fgPath) {
    const url = resolveUrl(fgPath);
    console.log('[sprite] setForeground resolved url=' + url);
    if (fgImg.src !== url) {
      fgImg.src = url;
      console.log('[sprite] setForeground src set to ' + url);
    }
    fgImg.classList.remove('hidden');
    console.log('[sprite] setForeground visible');
  } else {
    fgImg.classList.add('hidden');
    fgImg.src = '';
    console.log('[sprite] setForeground hidden');
  }
}

// ===== 主渲染 =====
function updateSprite(speakerName) {
  console.log('=== [sprite] updateSprite speaker=' + speakerName + ' enabled=' + cfg('enabled', true) + ' ===');

  if (!cfg('enabled', true)) {
    setForeground('');
    console.log('[sprite] disabled, hiding foreground');
    return;
  }

  const sprites = readVar(NS) || {};
  console.log('[sprite] tf_sprites=' + JSON.stringify(sprites).slice(0, 300));

  const byName = sprites.byName || {};
  const chapterBgs = readVar(BG_NS) || {};
  console.log('[sprite] tf_chapter_backgrounds=' + JSON.stringify(chapterBgs));

  const storyEdit = readVar('tf_story.edit') || {};
  const curChapterIdx = storyEdit.currentChapterIndex || 0;
  console.log('[sprite] currentChapterIndex=' + curChapterIdx);

  const entry = byName[speakerName] || null;
  console.log('[sprite] entry for "' + speakerName + '"=' + JSON.stringify(entry));

  const roleType = entry && entry.roleType;
  const showNarrator = cfg('showForNarrator', false);
  console.log('[sprite] roleType=' + roleType + ' showNarrator=' + showNarrator);

  // 旁白默认不显示前景，但背景保留
  if (roleType === 'narrator' && !showNarrator) {
    setForeground('');
    console.log('[sprite] narrator, hiding foreground');
  } else {
    let fgPath = entry && entry.fg ? entry.fg : '';
    if (!fgPath && cfg('useAvatarAsSprite', false) && entry && entry.avatar) {
      fgPath = entry.avatar;
      console.log('[sprite] fallback to avatar=' + fgPath);
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
    console.log('[sprite] bgPath from chapterBgs key=' + key + ' bgPath=' + bgPath);
  }
  setBackground(bgPath);
}

// ===== 事件监听 =====
let _charNameCache = null;
let _charNameCacheAt = 0;

tavo.plugin.on('message:added', async (event) => {
  const msg = event && event.message;
  console.log('[sprite] message:added raw event=' + JSON.stringify(event || {}).slice(0, 300));
  if (!msg) { console.log('[sprite] no msg in event'); return; }
  if (msg.role === 'user') { console.log('[sprite] user msg, skip'); return; }

  // characterName 可能不在 event.message 里（tavo 没实时解析），尝试自己 resolve
  let speakerName = msg.characterName || null;
  let speakerId = msg.characterId || null;

  if (!speakerName && speakerId) {
    // 从缓存的群聊角色列表里找 name
    if (!_charNameCache || Date.now() - _charNameCacheAt > 30000) {
      try {
        const chat = await tavo.chat.current();
        _charNameCache = {};
        (chat?.characters || []).forEach(c => { _charNameCache[c.id] = c.name; });
        _charNameCacheAt = Date.now();
      } catch (e) { _charNameCache = {}; }
    }
    speakerName = _charNameCache[speakerId] || null;
    console.log('[sprite] resolved characterId=' + speakerId + ' → name=' + speakerName);
  }

  if (!speakerName) { console.log('[sprite] no speakerName resolved, skip'); return; }

  const sprites = readVar(NS) || {};
  const byName = sprites.byName || {};
  const entry = byName[speakerName] || null;
  console.log('[sprite] message:added → characterName=' + speakerName + ' characterId=' + speakerId + ' entry=' + JSON.stringify(entry));
  console.log('[sprite] allSpriteNames: ' + Object.keys(byName).join(', '));

  // DOM 检查
  const fgImg = document.getElementById('tf-sprite-fg');
  console.log('[sprite] DOM check: #tf-sprite-fg exists=' + !!fgImg + ' src=' + (fgImg ? fgImg.src : 'N/A') + ' classList=' + (fgImg ? fgImg.className : 'N/A'));

  updateSprite(speakerName);
});

try {
  if (tavo.plugin && tavo.plugin.config) {
    tavo.plugin.config.onChange(() => {
      console.log('[sprite] config changed');
      updateSprite(getSpeaker());
    });
  }
} catch(e) {}

// chat reset 后从 global 恢复立绘变量
tavo.plugin.on('chat:opened', () => {
  console.log('[sprite] chat:opened → syncVarsFromGlobal');
  syncVarsFromGlobal();
});

// ===== Sidebar =====
tavo.plugin.onSidebarAction('tf-sprite-toggle', () => {
  try {
    const cur = tavo.plugin.config.get('enabled');
    tavo.plugin.config.set('enabled', cur ? false : true);
    tavo.utils.toast(cur ? '立绘已关闭' : '立绘已开启');
    updateSprite(getSpeaker());
  } catch(e) { tavo.utils.toast('切换失败'); }
});

// ===== 初始化 =====
console.log('[sprite] init in 800ms...');
setTimeout(() => {
  const speaker = getSpeaker();
  console.log('[sprite] init speaker=' + speaker);
  updateSprite(speaker);
}, 800);