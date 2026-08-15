// toonflow_story_event_manager - entry.js
// 故事信息面板 + 事件管理 + 故事编辑器 + 编排联动
// + 章节结局判定器 + 事件进度追踪 + 自由模式（完全对齐 Toonflow-game）
//
// 职责：
// 1. 故事面板/编辑器 UI 的数据桥
// 2. 编排联动：把群聊切到 scenario 模式交给编排插件；未装则回退 natural
// 3. 章节结局判定器：每轮 message:added 后评估完成条件
// 4. 事件进度追踪：从章节内容解析 Phase/Event 结构，状态机推进
// 5. 自由模式：所有章节完成后进入，不再做结局判定
// 6. 章节独立管理（chat 变量 tf_story.edit.chapters）

'use strict';

const NS = 'tf_story';
const PROGRESS_NS = 'tf_progress';
const STAGE_PLUGIN_ID = 'com.toonflow.multi-character-stage';

function cfgGet(k, fb) {
  try { const v = tavo.plugin.config.get(k); return (v === undefined || v === null) ? fb : v; } catch (e) { return fb; }
}

// ---------- 编排插件检测 ----------
async function isStageInstalled() {
  try {
    const res = await tavo.plugin.search?.({ limit: 100 });
    const items = res?.items || [];
    return items.some(p => p.pluginId === STAGE_PLUGIN_ID && p.enabled !== false);
  } catch (e) { return true; }
}

// 群聊编排：读 tf_story.edit.orchestration（'system' 跟随系统 / 'plugin' 角色编排插件）
// 缺省时根据是否安装编排器决定默认：装了 → 角色编排插件，没装 → 跟随系统
async function applyOrchestrationMode() {
  const enabled = cfgGet('enabled', true) !== false;
  if (!enabled) return;
  const edit = getEdit();
  let orch = edit.orchestration;
  const installed = await isStageInstalled();
  if (!orch) {
    orch = installed ? 'plugin' : 'system';
    edit.orchestration = orch;
    setEdit(edit);
  }
  if (orch === 'system') {
    try {
      await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
      tavo.utils.toast('群聊编排：跟随系统（Tavo 原生）');
    } catch (e) {}
    return;
  }
  // 角色编排插件模式：交由 multi_character_stage 接管 scenario + overrideScenario
  if (installed) {
    tavo.utils.toast('群聊编排：角色编排插件 → 角色发言插件');
  } else {
    try {
      await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
    } catch (e) {}
    tavo.utils.toast('⚠️ 未检测到角色编排器，已回退跟随系统');
  }
}

// =========================================================================
// 章节结局判定器（对齐 Toonflow-game useToonflowStore.evaluateDebugChapterResult）
// =========================================================================
//
// 成功条件格式（两种都支持）：
// 1. 自由文本："与萧炎对话3次" → 用启发式匹配最近对话/记忆
// 2. 结构化 JSON：
//    { type: 'contains', field: 'message', value: '萧炎' }
//    { type: 'regex', field: 'messages', value: '.*萧炎.*' }
//    { type: 'length_gte', field: 'messages', value: '50' }
//    { any: [{...}, {...}] }
//    { all: [{...}, {...}] }
//    { not: {...} }
//    { failure: {...}, success: {...}, nextChapterId: 3 }
// 结果：success → 推进；failed → 重置（自由模式或重试）

function evalConditionNode(node, ctx) {
  if (node === null || node === undefined) return false;
  if (typeof node === 'string') {
    const s = node.trim();
    if (!s) return false;
    return ctx.latestMessage.toLowerCase().includes(s.toLowerCase());
  }
  if (Array.isArray(node)) return node.some(item => evalConditionNode(item, ctx));
  if (typeof node !== 'object') return false;
  // 逻辑组合
  if (Array.isArray(node.all)) return node.all.length > 0 && node.all.every(it => evalConditionNode(it, ctx));
  if (Array.isArray(node.any)) return node.any.length > 0 && node.any.some(it => evalConditionNode(it, ctx));
  if (node.not !== undefined) return !evalConditionNode(node.not, ctx);
  // 比较节点
  const type = String(node.type || 'contains').toLowerCase();
  const field = String(node.field || 'message').toLowerCase();
  const value = String(node.value || '').trim();
  if (!value && !['length_gte', 'length_lte'].includes(type)) return false;
  const target = (() => {
    if (['message', 'latest', 'latest_message'].includes(field)) return ctx.latestMessage;
    if (['messages', 'history', 'full', 'all'].includes(field)) return ctx.allMessages;
    if (['chapter', 'chapter_title'].includes(field)) return ctx.chapterTitle;
    if (field === 'chapter_content') return ctx.chapterContent;
    return ctx.latestMessage;
  })();
  const t = target || '';
  const v = value;
  switch (type) {
    case 'contains':       return t.toLowerCase().includes(v.toLowerCase());
    case 'not_contains':
    case 'notcontains':    return !t.toLowerCase().includes(v.toLowerCase());
    case 'equals':
    case 'eq':             return t.trim().toLowerCase() === v.toLowerCase();
    case 'not_equals':
    case 'neq':            return t.trim().toLowerCase() !== v.toLowerCase();
    case 'regex':
      try { return new RegExp(v, 'i').test(t); } catch (e) { return false; }
    case 'length_gte':     return t.length >= Number(v);
    case 'length_lte':     return t.length <= Number(v);
    default:               return t.toLowerCase().includes(v.toLowerCase());
  }
}

// 自由文本成功条件启发式（对齐 web 端的"对话N次"语义）
function evalFreeText(text, ctx) {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  // 匹配 "对话 N 次" 形式
  const m1 = t.match(/对话\s*(\d+)\s*次/);
  if (m1) {
    const need = parseInt(m1[1]);
    return ctx.messageCount >= need;
  }
  // 匹配 "获得 XXX" 形式（从记忆插件查）
  const m2 = t.match(/获得\s*(.+)/);
  if (m2 && ctx.memoryItems.length) {
    return ctx.memoryItems.some(it => it.includes(m2[1]));
  }
  // 默认：消息中包含文本中所有关键词
  const words = t.split(/[，,。;；]/).map(x => x.trim()).filter(x => x.length >= 2);
  if (!words.length) return false;
  const hit = words.filter(w => ctx.latestMessage.toLowerCase().includes(w.toLowerCase())).length;
  return hit >= Math.ceil(words.length * 0.5);
}

// 判定当前章节结果
function evaluateChapterOutcome(chapter, ctx) {
  if (!chapter) return { result: 'continue' };
  const cond = chapter.successCondition;
  if (!cond || !String(cond).trim()) return { result: 'continue' };

  let matched = false;
  let result = 'success';
  let nextChapterId = null;

  // 尝试 JSON 解析
  let node = null;
  try { node = JSON.parse(cond); } catch (e) { node = null; }

  if (node && typeof node === 'object') {
    // 结构化失败/成功分支
    if (node.failure !== undefined && evalConditionNode(node.failure, ctx)) {
      return { result: 'failed', nextChapterId: node.nextChapterId || null };
    }
    if (node.success !== undefined && evalConditionNode(node.success, ctx)) {
      return { result: 'success', nextChapterId: node.nextChapterId || null };
    }
    // 整体匹配
    matched = evalConditionNode(node, ctx);
    if (node.nextChapterId) nextChapterId = node.nextChapterId;
    if (node.result === 'failed' || node.result === 'failure') result = 'failed';
  } else {
    // 自由文本启发式
    matched = evalFreeText(cond, ctx);
  }

  if (!matched) return { result: 'continue' };
  return { result, nextChapterId };
}

// =========================================================================
// 事件进度（Phase Graph）解析
// =========================================================================
// 从 chapter.content 中提取 ## Phase / ### Event 层次结构
// 状态：[s] 完成 / [i] 进行中 / [] 未开始 / [f] 失败

function parseProgress(content) {
  const lines = (content || '').split(/\r?\n/);
  const phases = [];
  let current = null;
  let order = 0;
  for (const line of lines) {
    const phaseMatch = line.match(/^##\s+(?:(【[^】]*】)|.*?)(.+?)\s*(【[^】]*】)?\s*$/);
    if (/^##\s+/.test(line)) {
      const m = line.match(/^##\s+(.+)/);
      if (m) {
        current = { name: m[1].trim(), events: [], index: order++ };
        phases.push(current);
      }
    } else if (/^###\s+/.test(line) && current) {
      const m = line.match(/^###\s+(.+)/);
      if (m) {
        const stateMatch = m[1].match(/^[\s]*(\[[sif]\])?\s*(.+)/i);
        current.events.push({ name: stateMatch ? stateMatch[2].trim() : m[1].trim(), state: stateMatch ? (stateMatch[1] || '') : '' });
      }
    }
  }
  return phases;
}

// =========================================================================
// 故事进度推进
// =========================================================================

function defaultProgress() {
  return {
    currentChapterIndex: 0,
    completedChapters: [],
    failedAttempts: 0,
    sessionFreeMode: false,
    storyCompleted: false,
    currentPhase: 0,
    currentEvent: 0,
    phases: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getProgress() {
  try {
    const v = tavo.get(PROGRESS_NS);
    return v || defaultProgress();
  } catch (e) { return defaultProgress(); }
}

function setProgress(p) {
  try { tavo.set(PROGRESS_NS, p, 'chat'); return true; } catch (e) { return false; }
}

// 评估每条用户消息对当前章节的影响
async function judgeAndAdvance(messageContext) {
  if (cfgGet('enabled', true) === false) return;
  const progress = getProgress();
  if (progress.storyCompleted || progress.sessionFreeMode) return;

  const edit = getEdit();
  const chapters = edit.chapters || [];
  if (!chapters.length) return;

  const idx = progress.currentChapterIndex || 0;
  const chapter = chapters[idx];
  if (!chapter) {
    // 越界：所有章节完成
    progress.storyCompleted = true;
    progress.sessionFreeMode = true;
    progress.updatedAt = Date.now();
    setProgress(progress);
    if (cfgGet('autoFreeMode', true) !== false) {
      tavo.utils.toast('🎉 故事已完结！已进入自由模式');
    }
    return;
  }

  // 解析事件进度（首次进入新章节时）
  if (!progress.phases || progress.phaptersKey !== chapters.length + ':' + idx) {
    progress.phases = parseProgress(chapter.content || '');
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.chaptersKey = chapters.length + ':' + idx;
  }

  // 收集判定上下文
  const ctx = {
    latestMessage: messageContext.content || '',
    allMessages: await getAllMessagesText(),
    chapterTitle: chapter.title || '',
    chapterContent: chapter.content || '',
    messageCount: messageContext.messageCount || 0,
    memoryItems: await getMemoryItems(),
  };

  const outcome = evaluateChapterOutcome(chapter, ctx);

  if (outcome.result === 'continue') return;

  if (outcome.result === 'failed') {
    progress.failedAttempts = (progress.failedAttempts || 0) + 1;
    progress.updatedAt = Date.now();
    setProgress(progress);
    tavo.utils.toast('⚠️ 章节「' + chapter.title + '」结局条件失败（尝试 ' + progress.failedAttempts + '）');
    // 不推进，让用户继续尝试
    return;
  }

  // success
  if (!progress.completedChapters.includes(idx)) progress.completedChapters.push(idx);

  // 推进
  const nextIdx = idx + 1;
  if (nextIdx >= chapters.length) {
    progress.storyCompleted = true;
    progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
    progress.currentChapterIndex = nextIdx;
    progress.updatedAt = Date.now();
    setProgress(progress);
    tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
    // 注入故事完结旁白（隐藏消息，方便模型感知）
    try {
      await tavo.message.append({
        content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
        hidden: false,
      });
    } catch (e) {}
  } else {
    progress.currentChapterIndex = nextIdx;
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.failedAttempts = 0;
    progress.updatedAt = Date.now();
    setProgress(progress);
    const nextCh = chapters[nextIdx];
    tavo.utils.toast('✅ 进入「' + (nextCh.title || '下一章') + '」');
    // 注入章节切换旁白
    try {
      let openingLine = '（场景切换至 ' + (nextCh.title || '下一章') + '）';
      if (nextCh.openingLine) openingLine = nextCh.openingLine;
      await tavo.message.append({ content: openingLine, hidden: false });
    } catch (e) {}
  }
}

async function getAllMessagesText() {
  try {
    const count = await tavo.message.count();
    if (!count) return '';
    const msgs = await tavo.message.find([0, Math.min(count, 30) - 1]);
    return (msgs || []).map(m => (m.characterName || (m.role === 'user' ? '用户' : 'NPC')) + '：' + (m.content || '')).join('\n');
  } catch (e) { return ''; }
}

async function getMemoryItems() {
  try {
    const mem = tavo.get('tmm');
    const player = (mem && mem.cards && mem.cards.player) || {};
    return [...(player.items || []), ...((mem.meta && mem.meta.facts) || [])];
  } catch (e) { return []; }
}

// =========================================================================
// 故事数据读写
// =========================================================================

function defaultEditData() {
  return {
    intro: '', globalBackground: '',
    chapters: [{ title: '第 1 章', openingRole: '旁白', openingLine: '', background: '', content: '', successCondition: '', conditionVisible: true, entryCondition: '', musicAutoPlay: false }],
  };
}

async function syncEditToWorldbook(edit) {
  const chat = await tavo.chat.current();
  if (!chat || !chat.lorebooks?.length) return { ok: true, count: 0 };
  const lbId = chat.lorebooks[0].id;
  const lb = await tavo.lorebook.get(lbId);
  if (!lb) return { ok: false, msg: '读取世界书失败' };
  const kept = (lb.entries || []).filter(e => !/^【简介】|^【全局背景】/.test(e.content || ''));
  const rebuilt = [];
  if (edit.intro) rebuilt.push({ name: '故事简介', content: '【简介】' + edit.intro, strategy: 'constant', enabled: true });
  if (edit.globalBackground) rebuilt.push({ name: '全局背景', content: '【全局背景】' + edit.globalBackground, strategy: 'constant', enabled: true });
  try {
    await tavo.lorebook.update({ id: lbId, name: lb.name, entries: [...kept, ...rebuilt] });
    return { ok: true, count: rebuilt.length };
  } catch (e) { return { ok: false, msg: String(e && e.message || e) };
  }
}

function getEdit() {
  try { const v = tavo.get(NS + '.edit'); return v || defaultEditData(); } catch (e) { return defaultEditData(); }
}
function setEdit(edit) {
  try { tavo.set(NS + '.edit', edit, 'chat'); return true; } catch (e) { return false; }
}

function isValidChapter(ch) {
  return ch && typeof ch === 'object'
    && typeof ch.title === 'string'
    && typeof ch.content === 'string'
    && typeof ch.openingRole === 'string';
}

// =========================================================================
// Hooks
// =========================================================================

tavo.plugin.on('chat:opened', async () => {
  await applyOrchestrationMode();

  // 章节修复（仅补全缺失字段，绝不清空/丢弃已有章节 —— 静态故事数据受保护）
  const cur = getEdit();
  let repaired = false;
  if (cur.chapters && cur.chapters.length) {
    cur.chapters = cur.chapters.map((ch) => {
      const c = (ch && typeof ch === 'object') ? { ...ch } : { title: '未命名章节' };
      if (typeof c.title !== 'string' || !c.title) { c.title = '未命名章节'; repaired = true; }
      if (typeof c.content !== 'string') { c.content = ''; repaired = true; }
      if (typeof c.openingRole !== 'string') { c.openingRole = '旁白'; repaired = true; }
      if (typeof c.openingLine !== 'string') c.openingLine = '';
      if (typeof c.successCondition !== 'string') c.successCondition = '';
      if (typeof c.background !== 'string') c.background = '';
      if (!Array.isArray(c.events)) c.events = [];
      return c;
    });
    if (repaired) setEdit(cur);
  }

  // 进度时间戳更新（不重置章节进度等动态数值，仅刷新时间）
  const progress = getProgress();
  progress.updatedAt = Date.now();
  setProgress(progress);
});

// 判定器入口：每轮对话后评估章节结局
tavo.plugin.on('message:added', async (event) => {
  if (!event || !event.message) return;
  if (event.message.role !== 'user') return; // 只在用户发言后判定
  try {
    let count = 0;
    try { count = await tavo.message.count(); } catch (e) {}
    await judgeAndAdvance({ content: event.message.content || '', messageCount: count });
  } catch (e) {
    console.warn('[tf_story] judge failed', e);
  }
});

// =========================================================================
// 桥接：面板 -> entry（sidebar 事件做通道）
// =========================================================================

tavo.plugin.onSidebarAction('tf-story-save-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  tavo.utils.toast('章节列表已保存（' + (edit.chapters || []).length + ' 章）');
});

tavo.plugin.onSidebarAction('tf-story-publish-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  const r = await syncEditToWorldbook(edit);
  tavo.utils.toast(r.ok ? ('已发布（' + r.count + ' 条常量）') : ('发布失败：' + r.msg));
});

tavo.plugin.onSidebarAction('tf-story-apply-mode', async () => {
  await applyOrchestrationMode();
  tavo.utils.toast('编排模式已按配置应用');
});

// 进入自由模式（剧情完结后）
tavo.plugin.onSidebarAction('tf-story-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = true;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已进入自由模式');
});

// 退出自由模式（回到正常判定）
tavo.plugin.onSidebarAction('tf-story-exit-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = false;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已退出自由模式');
});

// 重置故事进度
tavo.plugin.onSidebarAction('tf-story-reset', async () => {
  const p = defaultProgress();
  setProgress(p);
  tavo.utils.toast('故事进度已重置');
});