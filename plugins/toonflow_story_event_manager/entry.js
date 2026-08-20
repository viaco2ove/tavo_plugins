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

// 诊断：确认 entry.js 真的被 Tavo 加载并执行（之前发现 message:added 监听没跑，怀疑 entry 加载时就静默失败）
try {
  console.log('[tf_story] ENTRY START v1.4.0 ' + new Date().toISOString()
    + ' tavo=' + (typeof tavo)
    + ' tavo.plugin=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin : 'undefined')
    + ' tavo.plugin.on=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin.on : 'undefined'));
} catch (e) {
  console.error('[tf_story] entry log failed', e);
}

// =========================================================================
// 供其他插件调用的 API（暴露到 window）
// =========================================================================
// 完整章节+事件判定入口（mcs 编排前调用，同步返回章节状态 + 更新事件进度）
// 对齐 judgeAndAdvance 逻辑，但不 append 消息（mcs 自己 append）
// 返回：{ chapterStatus, pendingChapterId, storyCompleted, freeMode, progress }
function tfStoryJudge_checkAndAdvance(messageContext) {
  try {
    const cfg = cfgGet('enabled', true);
    if (cfg === false) return { chapterStatus: 'continue' };

    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return {
        chapterStatus: progress.storyCompleted ? 'completed' : 'free_mode',
        pendingChapterId: progress.pendingChapterId || null,
        storyCompleted: progress.storyCompleted,
        freeMode: progress.sessionFreeMode,
        progress: { currentChapterIndex: progress.currentChapterIndex, currentPhase: progress.currentPhase, currentEvent: progress.currentEvent, phases: progress.phases },
      };
    }

    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) return { chapterStatus: 'continue' };

    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { chapterStatus: 'completed' };

    // 解析 phases（首次进入新章节时）
    let prog = Object.assign({}, progress);
    if (!prog.phases || prog.chaptersKey !== chapters.length + ':' + idx) {
      prog.phases = parseProgress(chapter.content || '');
      prog.currentPhase = 0;
      prog.currentEvent = 0;
      prog.chaptersKey = chapters.length + ':' + idx;
    }

    // 快速同步到 tf_progress（供编排 prompt 读取最新进度）
    setProgress(prog);

    // pendingChapterId 检测（章节切换中）
    if (prog.pendingChapterId) {
      const nextIdx = prog.pendingChapterId;
      return {
        chapterStatus: 'chapter_switching',
        pendingChapterId: nextIdx,
        storyCompleted: nextIdx >= chapters.length,
        freeMode: nextIdx >= chapters.length && cfgGet('autoFreeMode', true) !== false,
        progress: { currentChapterIndex: nextIdx, currentPhase: 0, currentEvent: 0, phases: prog.phases },
        message: '章节切换中，将在下一轮生效',
      };
    }

    // 章节结局条件快速检查（无条件 = 不判）
    const cond = chapter.successCondition;
    const hasCondition = cond && String(cond).trim();

    // 返回当前状态供编排使用
    return {
      chapterStatus: 'active',
      pendingChapterId: null,
      storyCompleted: false,
      freeMode: false,
      progress: { currentChapterIndex: prog.currentChapterIndex, currentPhase: prog.currentPhase, currentEvent: prog.currentEvent, phases: prog.phases },
      chapterInfo: {
        title: chapter.title || '未命名章节',
        condition: hasCondition ? cond.slice(0, 100) : null,
      },
    };
  } catch (e) {
    console.warn('[tf_story][mcs_api] checkAndAdvance error', e);
    return { chapterStatus: 'error', error: e.message };
  }
}

// 检查章节完成条件是否满足（编排后调用，决定是否需要截断/提示）
// 返回 { done, result, pendingChapterId, message }
function tfStoryJudge_checkChapterDone(messageContext) {
  try {
    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return { done: progress.storyCompleted, result: progress.storyCompleted ? 'completed' : 'free_mode', pendingChapterId: null, message: '' };
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { done: true, result: 'completed', pendingChapterId: null, message: '' };
    const cond = chapter.successCondition;
    if (!cond || !String(cond).trim()) return { done: false, result: 'continue', pendingChapterId: null, message: '' };

    // 简单启发式判断（与 evaluateChapterOutcome 一致）
    const ctx = {
      latestMessage: messageContext.content || '',
      allMessages: messageContext.allMessages || '',
      chapterTitle: chapter.title || '',
      chapterContent: chapter.content || '',
      messageCount: messageContext.messageCount || 0,
      memoryItems: [],
    };
    const matched = evalFreeText(cond, ctx);
    if (!matched) return { done: false, result: 'continue', pendingChapterId: null, message: '' };

    // 章节完成！
    const nextIdx = idx + 1;
    if (!progress.completedChapters.includes(idx)) {
      progress.completedChapters = [...(progress.completedChapters||[]), idx];
    }
    if (nextIdx >= chapters.length) {
      progress.storyCompleted = true;
      progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.updatedAt = Date.now();
      setProgress(progress);
      return { done: true, result: 'completed', pendingChapterId: null, message: '故事已完结！' + (progress.sessionFreeMode ? ' 进入自由模式' : '') };
    } else {
      progress.pendingChapterId = nextIdx;
      progress.updatedAt = Date.now();
      setProgress(progress);
      const nextCh = chapters[nextIdx];
      return { done: true, result: 'success', pendingChapterId: nextIdx, message: '第 ' + (idx+1) + ' 章完成！下一章将在下一轮切换' };
    }
  } catch (e) {
    console.warn('[tf_story][mcs_api] checkChapterDone error', e);
    return { done: false, result: 'error', error: e.message };
  }
}

// hook 注册用 try/catch 包裹：抓 Tavo API 抛错（之前没错误日志 = 静默死，导致 message:added 监听没注册成功）
const _safeOn = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.on !== 'function') {
      console.error('[tf_story] hook 注册失败: tavo.plugin.on 不可用, hook=' + name);
      return;
    }
    tavo.plugin.on(name, fn);
    console.log('[tf_story] hook registered: ' + name);
  } catch (e) {
    console.error('[tf_story] hook 注册失败: hook=' + name, e && (e.message || e));
  }
};
const _safeOnSide = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.onSidebarAction !== 'function') {
      console.error('[tf_story] sidebar 注册失败: tavo.plugin.onSidebarAction 不可用, name=' + name);
      return;
    }
    tavo.plugin.onSidebarAction(name, fn);
    console.log('[tf_story] sidebar registered: ' + name);
  } catch (e) {
    console.error('[tf_story] sidebar 注册失败: name=' + name, e && (e.message || e));
  }
};

const NS = 'tf_story';
const PROGRESS_NS = 'tf_progress';
const STAGE_PLUGIN_ID = 'com.toonflow.multi-character-stage';

function cfgGet(k, fb) {
  try { const v = tavo.plugin.config.get(k); return (v === undefined || v === null) ? fb : v; } catch (e) { return fb; }
}

// Tavo 的 chat 变量经 tavo.get 返回的是包装对象 {target,name,found,value}，
// 真实数据在 .value 里。所有读变量都必须解包，否则 v.chapters / v.level 等会是 undefined，
// 代码会误判为"空"并拿默认值覆盖，造成配置/参数卡被清空。
function readChatVar(name) {
  try {
    let v = tavo.get(name);
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) {
      v = v.value; guard++;
    }
    return v;
  } catch (e) { return null; }
}

// 读变量（先 global 后 chat）：tavo_chat_reset 会清 chat scope，但 global scope 不受影响。
// 故事数据（tf_story.edit / tf_progress）必须双写到 global 才能抗 reset。
function readVarAnyScope(name) {
  // 1) global scope
  try {
    let g;
    if (typeof tavo.get === 'function') {
      // tavo.get(name, scope) -> {name,found,value}
      try { g = tavo.get(name, 'global'); } catch (e) { g = null; }
      if (g && typeof g === 'object' && 'value' in g && g.found === false) g = null;
      if (g && typeof g === 'object' && 'value' in g) g = g.value;
    }
    if (g !== null && g !== undefined) return g;
  } catch (e) {}
  // 2) chat scope
  return readChatVar(name);
}

// 写变量：双写 chat + global，确保 reset 后仍能恢复
function writeVarDual(name, value) {
  let ok = false;
  try { tavo.set(name, value, 'chat'); ok = true; } catch (e) {}
  // global scope：去掉 chat 专属后缀，写同名变量
  try { tavo.set(name, value, 'global'); } catch (e) {}
  return ok;
}

// ---------- 编排插件检测 ----------
// 实测：tavo.plugin.search 不带 query 时会返回空列表，**不能**因为"查不到"就判定未安装
// —— 那会把 tf_story.edit.orchestration 的默认值错设成 'system'（跟随系统，插件不接管）。
// 返回 'enabled' | 'disabled' | 'unknown'，只有明确查到且被禁用才算 disabled。
async function stageState() {
  const probe = async (args) => {
    try {
      const res = await tavo.plugin.search?.(args);
      const items = (res && res.items) ? res.items : (Array.isArray(res) ? res : []);
      return Array.isArray(items) ? items : [];
    } catch (e) { return []; }
  };
  const tries = [
    { query: STAGE_PLUGIN_ID, limit: 100 },
    { query: 'toonflow', limit: 100 },
    { query: '编排', limit: 100 },
    { limit: 100 },
  ];
  for (const args of tries) {
    const items = await probe(args);
    const hit = items.find(p => p && p.pluginId === STAGE_PLUGIN_ID);
    if (hit) return hit.enabled === false ? 'disabled' : 'enabled';
  }
  return 'unknown'; // 查不到就别下结论，交给调用方按「默认插件接管」处理
}


// 群聊编排：读 tf_story.edit.orchestration（'system' 跟随系统 / 'plugin' 角色编排插件）
// 缺省默认 = 'plugin'（角色编排插件接管）；只有明确查到编排插件被禁用才退回 'system'。
async function applyOrchestrationMode() {
  const enabled = cfgGet('enabled', true) !== false;
  if (!enabled) return;
  const edit = getEdit();
  let orch = edit.orchestration;
  const state = await stageState();
  const installed = state !== 'disabled';
  if (!orch) {
    orch = (state === 'disabled') ? 'system' : 'plugin';
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

// 事件级推进（对齐 Toonflow event_progress_judge 的确定性规则）：
// - 用户每次发言 -> 当前 stage 完成（currentEvent+1）
// - 若消费后的下一个 stage 是「用户发言」，一并跳过（等待用户阶段已被这次发言满足）
// - phase 事件全部完成 -> 进入下一 phase（跳过「非事件」段）
// - 全 phase 完成 -> 停留在最后（章节结局判定器接管）
function advanceEventProgress(progress) {
  const phases = progress.phases || [];
  if (!phases.length) return;
  let pi = Math.max(0, progress.currentPhase || 0);
  // 跳过非事件 phase
  while (pi < phases.length && /^非事件/.test(phases[pi].name || '')) pi++;
  if (pi >= phases.length) return;
  progress.currentPhase = pi;
  const phase = phases[pi];
  const events = phase.events || [];
  if (!events.length) return;
  let ei = Math.max(0, progress.currentEvent || 0);
  // 当前 stage 完成
  ei += 1;
  // 连续「用户发言」消费：发言后若下一 stage 也是用户发言节点，视为此前已满足，跳过
  while (ei < events.length && /用户发言/.test(events[ei].name || '')) ei += 1;
  if (ei >= events.length) {
    // 本 phase 完成 -> 下一 phase（跳过非事件段）
    let np = pi + 1;
    while (np < phases.length && /^非事件/.test(phases[np].name || '')) np++;
    progress.currentPhase = np;
    progress.currentEvent = 0;
    // 新 phase 的第一个 stage 若是「用户发言」也消费掉（用户刚说完话）
    const nEvents = (phases[np] && phases[np].events) || [];
    let ne = 0;
    while (ne < nEvents.length && /用户发言/.test(nEvents[ne].name || '')) ne++;
    progress.currentEvent = ne;
  } else {
    progress.currentEvent = ei;
  }
  progress.updatedAt = Date.now();
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
  const v = readChatVar(PROGRESS_NS);
  return (v && typeof v === 'object') ? v : defaultProgress();
}

function setProgress(p) {
  try { writeVarDual(PROGRESS_NS, p); return true; } catch (e) { return false; }
}

// 章节推进时同步写入 tf_story.edit.currentChapterIndex（供 sprite 等插件监听）
function syncChapterIndex(idx) {
  try {
    const edit = getEdit();
    if (edit.currentChapterIndex !== idx) {
      edit.currentChapterIndex = idx;
      setEdit(edit);
    }
  } catch (e) {}
}

// 评估每条用户消息对当前章节的影响
async function judgeAndAdvance(messageContext) {
  if (cfgGet('enabled', true) === false) { console.log('[tf_story][judge] ✗ enabled=false'); return; }
  const progress = getProgress();
  console.log('[tf_story][judge] progress.chapter=' + progress.currentChapterIndex + ' completed=' + JSON.stringify(progress.completedChapters) + ' storyCompleted=' + progress.storyCompleted + ' freeMode=' + progress.sessionFreeMode);
  if (progress.storyCompleted || progress.sessionFreeMode) { console.log('[tf_story][judge] ✗ stopped: storyCompleted or freeMode'); return; }

  const edit = getEdit();
  const chapters = edit.chapters || [];
  if (!chapters.length) return;

  const idx = progress.currentChapterIndex || 0;
  const chapter = chapters[idx];
  const phases = progress.phases || [];
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const curPhase = phases[phaseIdx] || null;
  const curEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx] || null) : null;

  console.log('[tf_story] ┌─── judgeAndAdvance 入口 ─────────────────');
  console.log('[tf_story] │ 📝 用户消息: ' + JSON.stringify((messageContext.content||'').slice(0,100)));
  console.log('[tf_story] │ 📚 章节: ' + (idx+1) + '/' + chapters.length + (chapter ? '「' + chapter.title + '」' : '(无)'));
  console.log('[tf_story] │ 📋 完成条件: ' + (chapter && chapter.successCondition ? chapter.successCondition.slice(0,80) : '(无)'));
  console.log('[tf_story] │ 📊 事件进度: Phase=' + phaseIdx + '(' + (curPhase?curPhase.name:'无') + ')'
    + ' Event=' + eventIdx + '/' + ((curPhase&&curPhase.events)?curPhase.events.length:0)
    + '(' + (curEvent?curEvent.name:'无') + ')');
  console.log('[tf_story] │ 🏷  phases: ' + JSON.stringify(phases.map(p=>({n:p.name,e:p.events.map(e=>e.name||'')}))));
  console.log('[tf_story] │ 🔖 pendingChapterId=' + progress.pendingChapterId
    + ' failedAttempts=' + progress.failedAttempts
    + ' completedChapters=' + JSON.stringify(progress.completedChapters||[]));
  console.log('[tf_story] └─────────────────────────────────────────');
  console.log('[tf_story][judge] idx=' + idx + ' chapters.len=' + chapters.length + ' chapter.title=' + (chapter ? chapter.title : 'NULL'));
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

    console.log('[tf_story][judge] 解析章节 content → phases...');
  // 解析事件进度（首次进入新章节时）
  if (!progress.phases || progress.phaptersKey !== chapters.length + ':' + idx) {
    progress.phases = parseProgress(chapter.content || '');
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.chaptersKey = chapters.length + ':' + idx;
    console.log('[tf_story][judge] phases=' + progress.phases.length + ' ' + JSON.stringify(progress.phases.map(p=>({n:p.name,e:p.events.length}))));

  }
  // ========== pendingChapterId 处理（对齐官方 pendingChapterId 双阶段语义）==========
  // 阶段0：检测 pendingChapterId —— 上一轮结局已宣告本章完成，本轮才正式切换
  if (progress.pendingChapterId) {
    const prevChapterId = progress.currentChapterIndex;
    const prevChapter = chapters[prevChapterId];
    const nextIdx = progress.pendingChapterId;
    console.log('[tf_story] ⏳ [pendingChapterId] 章节切换: ' + (prevChapterId+1) + '「' + (prevChapter?prevChapter.title:'?') + '」'
      + ' → ' + (nextIdx+1) + '/' + chapters.length);
    progress.pendingChapterId = null; // 先清除标记
    if (nextIdx >= chapters.length) {
      // 故事完结
      progress.storyCompleted = true;
      progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.updatedAt = Date.now();
      setProgress(progress);
      syncChapterIndex(nextIdx);
      tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
      try {
        await tavo.message.append({
          content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
          hidden: false,
        });
      } catch (e) {}
    } else {
      // 正式切换章节
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.failedAttempts = 0;
      // 重新解析新章节 phases
      const nextCh = chapters[nextIdx];
      if (nextCh) {
        progress.phases = parseProgress(nextCh.content || '');
        progress.chaptersKey = chapters.length + ':' + nextIdx;
      }
      progress.updatedAt = Date.now();
      setProgress(progress);
      syncChapterIndex(nextIdx);
      tavo.utils.toast('✅ 进入「' + (nextCh.title || '下一章') + '」');
      try {
        let openingLine = '（场景切换至 ' + (nextCh.title || '下一章') + '）';
        if (nextCh.openingLine) openingLine = nextCh.openingLine;
        await tavo.message.append({ content: openingLine, hidden: false });
      } catch (e) {}
    }
    // 章节已切换，当前轮次的剩余逻辑（event_progress / 章节判定）基于新章节执行
    // 重新获取当前章节引用
    const newIdx = progress.currentChapterIndex;
    chapter = chapters[newIdx];
    console.log('[tf_story][judge] chapter switched to idx=' + newIdx + ' title=' + (chapter ? chapter.title : 'NULL'));
  }

  // 阶段一：LLM 事件进度检测（对齐 toonflow applySessionUserEventProgress）
  // 替代纯 +1 规则的 advanceEventProgress
  const eventResult = await applySessionUserEventProgress(
    chapter, progress, messageContext.content || '', '用户'
  );
  console.log("[tf_story][judge] after event_progress: phase=" + progress.currentPhase + " ev=" + progress.currentEvent + " advanced=" + eventResult.advanced);
  // 事件推进结果必须落盘（即使章节未完成，面板也要显示最新 stage 状态）
  setProgress(progress);

  // 阶段二：章节结局判定（优先 LLM，回退启发式）
  console.log("[tf_story][judge] cond=" + JSON.stringify(chapter.successCondition) + " msgCount=" + (messageContext.messageCount || 0));

  let outcome = null;
  const llmOutcome = await evaluateChapterOutcomeByAi(chapter, progress, messageContext.content || '');
  if (llmOutcome) {
    outcome = { result: llmOutcome.result };
  } else {
    // 回退到原有启发式
    const ctx = {
      latestMessage: messageContext.content || '',
      allMessages: await getAllMessagesText(),
      chapterTitle: chapter.title || '',
      chapterContent: chapter.content || '',
      messageCount: messageContext.messageCount || 0,
      memoryItems: await getMemoryItems(),
    };
    outcome = evaluateChapterOutcome(chapter, ctx);
    console.log("[tf_story][judge] 章节判定回退到启发式: result=" + outcome.result);
  }

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

  // 对齐官方 pendingChapterId 语义：只宣告下一章，不立即切换
  // 下一轮 judgeAndAdvance 的 phase0 会检测到 pendingChapterId 并执行真正切换
  const nextIdx = idx + 1;
  if (nextIdx >= chapters.length) {
    // 故事完结：直接切换（无下一章，不需要延迟语义）
    progress.storyCompleted = true;
    progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
    progress.currentChapterIndex = nextIdx;
    progress.updatedAt = Date.now();
    setProgress(progress);
    syncChapterIndex(nextIdx);
    tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
    try {
      await tavo.message.append({
        content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
        hidden: false,
      });
    } catch (e) {}
  } else {
    // 有下一章：设置 pendingChapterId（本轮宣告，下轮生效）
    progress.pendingChapterId = nextIdx;
    progress.updatedAt = Date.now();
    setProgress(progress);
    console.log('[tf_story][judge] chapter success: pendingChapterId=' + nextIdx + ' (will switch next round)');
    tavo.utils.toast('✅ 第 ' + (idx + 1) + ' 章完成！下一章将在下一轮对话开始时切换');
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
    const mem = readChatVar('tmm');
    const player = (mem && mem.cards && mem.cards.player) || {};
    return [...(player.items || []), ...((mem.meta && mem.meta.facts) || [])];
  } catch (e) { return []; }
}

// =========================================================================
// 故事数据读写
// =========================================================================

function defaultEditData() {
  return {
    intro: '', globalBackground: '', lineCount: 20, intentMode: 'keyword',
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
  const v = readChatVar(NS + '.edit');
  return (v && typeof v === 'object') ? v : defaultEditData();
}
function setEdit(edit) {
  try { writeVarDual(NS + '.edit', edit); return true; } catch (e) { return false; }
}

function isValidChapter(ch) {
  return ch && typeof ch === 'object'
    && typeof ch.title === 'string'
    && typeof ch.content === 'string'
    && typeof ch.openingRole === 'string';
}

// =========================================================================
// Boot Controller（启动控制器）-- 完全接管官方启动行为
// =========================================================================
// 五种会话状态（对齐你的设计）：
//   uninitialized       - 首次打开聊天，静态数据全空（global 也没有）
//   reset               - 重启聊天（global 有数据，chat 为空）
//   resumption_start    - 继聊开始（chat 有消息，boot 序列启动）
//   data_loaded         - 数据已加载（静态恢复 + 动态重建完成）
//   ready               - 数据已加载 + 开场白已播报，编排可接管
// 流程：
//   uninitialized | reset | resumption_start -> 加载数据 -> data_loaded -> 播开场白 -> ready
// 任何阶段失败/未 ready 时阻断官方自动发言
const BOOT_NS = 'tf_story.boot';
const BOOT_STAGES = ['uninitialized', 'reset', 'resumption_start', 'data_loaded', 'ready'];
let _bootState = 'uninitialized'; // 内存态镜像
let _bootGuard = 0;              // 并发保护
let _bootStage = '';              // 当前阶段文字描述（给 UI 显示）

function readBoot() {
  const v = readVarAnyScope(BOOT_NS);
  return (v && typeof v === 'object') ? v : { status: 'uninitialized', chatId: null, openedAt: 0, openingDone: false, stage: 'uninitialized' };
}
function writeBoot(b) {
  // boot 状态必须写 global scope，否则 tavo_chat_reset 后丢失，无法感知「已就绪」
  try { tavo.set(BOOT_NS, b, 'global'); } catch (e) {}
  // 同时写 chat scope 用于 hot read
  try { tavo.set(BOOT_NS, b, 'chat'); } catch (e) {}
  _bootState = b.status || 'uninitialized';
  _bootStage = b.stage || b.status || '';
}

// 通知 htmlFragment 更新加载遮罩（如果已挂载）
function notifyBootStage(stage, detail) {
  try {
    var el = document.getElementById('tf-boot-stage');
    if (el) el.textContent = detail || stage;
    var se = document.getElementById('tf-boot-session');
    if (se && stage) se.textContent = '会话：' + stage;
    var overlay = document.getElementById('tf-boot-overlay');
    if (overlay) overlay.style.display = (stage === 'ready') ? 'none' : 'flex';
  } catch (e) {}
}

// 恢复静态数据：global -> chat（tavo_chat_reset 清了 chat，global 是权威备份）
function restoreStaticData() {
  let restored = false;
  const names = [NS + '.edit', 'tmm_story_static'];
  for (const name of names) {
    try {
      // chat 里还有就跳过（正常续玩）
      const cv = readChatVar(name);
      if (cv && typeof cv === 'object' && Object.keys(cv).length) continue;
      // 从 global 恢复
      const gv = (() => {
        try {
          let g = tavo.get(name, 'global');
          let guard = 0;
          while (g && typeof g === 'object' && g.found !== undefined && 'value' in g && guard < 5) { g = g.value; guard++; }
          return g;
        } catch (e) { return null; }
      })();
      if (gv && typeof gv === 'object' && Object.keys(gv).length) {
        tavo.set(name, gv, 'chat');
        restored = true;
      }
    } catch (e) {}
  }
  return restored;
}

// 重建动态数据（对齐 Toonflow「重启聊天 = 动态数据重新生成」）：
// tf_progress 若丢失 -> 按静态章节重新生成；tmm 记忆丢失 -> 重新初始化
function rebuildDynamicData() {
  let rebuilt = false;
  // tf_progress
  let prog = readVarAnyScope(PROGRESS_NS);
  const edit = readVarAnyScope(NS + '.edit') || defaultEditData();
  const chapters = edit.chapters || [];
  if (!prog || typeof prog !== 'object' || !Array.isArray(prog.completedChapters)) {
    prog = defaultProgress();
    if (chapters.length) prog.phases = parseProgress(chapters[0].content || '');
    setProgress(prog);
    rebuilt = true;
  } else if (!prog.phases || !prog.phases.length) {
    // 进度在但 phases 空（换章后）-> 重新解析当前章节
    const idx = Math.min(prog.currentChapterIndex || 0, Math.max(chapters.length - 1, 0));
    if (chapters[idx]) {
      prog.phases = parseProgress(chapters[idx].content || '');
      prog.currentPhase = 0;
      prog.currentEvent = 0;
      setProgress(prog);
      rebuilt = true;
    }
  }
  return rebuilt;
}

// 官方劫持检测：boot ready 之前落地的 assistant 消息 = 官方自动开场发言 -> 删
async function purgeOfficialHijack() {
  try {
    const count = await tavo.message.count();
    if (!count) return 0;
    const msgs = await tavo.message.find([0, Math.min(count, 20) - 1]);
    let deleted = 0;
    for (const m of (msgs || [])) {
      if (m && m.role === 'assistant' && !(m.hidden)) {
        // 只删 boot 期间产生的（boot 标记存在之前的旧消息不动）
        const boot = readBoot();
        if (boot.status === 'ready' && boot.openingDone) break; // 已就绪：不删
        try { await tavo.message.delete(m.id); deleted++; } catch (e) {}
      }
    }
    return deleted;
  } catch (e) { return 0; }
}

// 播报章节开场白 + 事件链首段自动编排（对齐 Toonflow introduction 流程）：
// 开场白 -> 继续按章节 content 的事件链自动播 NPC/旁白台词 -> 遇到「### 用户发言」停下等用户。
// 旁白消息挂专用「旁白」角色（story_sync 创建），NPC 消息按角色名找 characterId。
// 返回播报的消息条数。
function parseChapterBeats(content, openingText) {
  // 解析章节脚本 -> [{role, text}]，遇到第一个「用户发言」停止
  const beats = [];
  const openNorm = (openingText || '').replace(/\s/g, '');
  for (const raw of (content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^###/.test(line) && /用户发言/.test(line)) break;
    if (line.startsWith('@')) {
      const body = line.slice(1);
      const sep = body.indexOf('：') >= 0 ? body.indexOf('：') : body.indexOf(':');
      if (sep < 0) continue;
      const role = body.slice(0, sep).trim();
      const text = body.slice(sep + 1).trim();
      if (!text) continue;
      // 去重：openingText 已覆盖的短句不重复播
      if (openNorm && text.replace(/\s/g, '').length < openNorm.length
          && openNorm.includes(text.replace(/\s/g, ''))) continue;
      beats.push({ role, text });
    }
  }
  return beats;
}

// 开场白完整流程（对齐 开场白.md 设计）
// 流程：故事初始化开始 → 禁止和清理tavo开场白 → 故事初始化完毕 → 
//       获取开场白配置 → 调用发言插件生成台词 → 语音生成 → 语音播放 → 进入编排
async function playChapterOpening() {
  try {
    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) return 0;
    const progress = getProgress();
    const idx = Math.min(progress.currentChapterIndex || 0, chapters.length - 1);
    const ch = chapters[idx];
    if (!ch) return 0;

    // 开场白标记（防重复播报）
    const boot = readBoot();
    if (boot.openingDone) return 0;

    // ====== 完整开场白流程（按 开场白.md 实现）======
    
    // 1. 故事初始化开始
    console.log('[tf_story] ┌─── 开场白流程 ──────────────────────────');
    console.log('[tf_story] │ ✅ 故事初始化开始');
    
    // 2. 禁止和清理 tavo 自己的开场白
    //    切换到 natural 模式 + 清空 overrideScenario，阻断官方 scenario 开场
    try {
      await _retry(() => tavo.chat.update({ responseMode: 'natural', overrideScenario: '' }), 'step0 chat.update', 4);
      console.log('[tf_story] │ ✅ 已禁止和清理tavo自己的开场白');
    } catch (e) {
      console.warn('[tf_story][opening] 禁止开场白失败', e);
    }
    
    // 3. 故事初始化完毕
    console.log('[tf_story] │ ✅ 故事初始化完毕');

    // 角色 id 映射（旁白用专用角色）
    let chat = null;
    try { chat = await tavo.chat.current(); } catch (e) {}
    const chars = (chat && chat.characters) || [];
    const findChar = (name) => chars.find(c => c.name === name)
      || (name === '旁白' || name === 'narrator' ? chars.find(c => c.name === '旁白') : null);
    const narratorChar = chars.find(c => c.name === '旁白') || null;

    let played = 0;
    
    // 4. 获取开场白配置
    const openingRole = ch.openingRole || '旁白';
    const openingText = ch.openingLine || '';
    console.log('[tf_story] │ ✅ 获取开场白: $openingRole="' + openingRole + '" $openingText="' + (openingText.slice(0, 40) || '(空)') + '"');

    // 5. 调用发言插件生成开场白台词
    if (openingText) {
      console.log('[tf_story] │ ✅ 调用发言插件生成开场白台词');
      
      // 设置开场白待处理标记（供 speaker 插件 generation:prepare 读取）
      try {
        tavo.set('tf_story.opening', {
          pending: true,
          role: openingRole,
          text: openingText,
          index: idx,
        }, 'chat');
      } catch (e) {}
      
      // 查找角色 id
      const charEntry = findChar(openingRole) || narratorChar;
      const charId = charEntry ? charEntry.id : undefined;
      
      // 生成台词（走 tavo.generate，speaker 插件 generation:prepare 注入在场角色状态）
      let generatedLine = openingText;
      try {
        // 由于 generation:beforeGenerate 不被支持，这里直接用 openingText 作为台词
        // speaker 插件通过 generation:prepare 注入角色状态，但不拦截生成
        generatedLine = openingText;
        console.log('[tf_story] │ ✅ 开场白台词: "' + generatedLine.slice(0, 60) + '"');
      } catch (e) {
        console.warn('[tf_story][opening] 生成失败，回退使用 openingText', e);
        generatedLine = openingText;
      }
      
      // ===== 关键修复1：设 tf_orch.active=true，防止 sprite 插件抢跑 =====
      // sprite 插件在 message:added 时检查 tf_orch.active，
      // 若为 true 则跳过（由编排插件负责切换立绘）。
      // 旁白开场时若不设此标记，sprite 会走 getSpeaker() 误取红飘渺。
      try { tavo.set('tf_orch.active', true, 'chat'); } catch (e) {}
      
      // 写入消息列表
      // ⚠️ 关键修复：不传 characterId！当 characterId 为 undefined 时，
      // Tavo UI 会用 characterId 查头像，fallback 成第一个角色卡的名字（红缥缈）。
      // 完全不传 characterId 字段，UI 才会只用 characterName 显示名称和头像。
      const appendOpts = {
        role: 'assistant',
        characterName: openingRole,
        content: generatedLine,
        hidden: false,
      };
      if (charId !== undefined && charId !== null) {
        appendOpts.characterId = charId;
      }
      console.log('[tf_story] │ append msg: characterName=' + openingRole + ' charId=' + (charId !== undefined ? charId : '(无)'));
      await tavo.message.append(appendOpts);
      played++;
      
      // 同步 tf_last_speaker：sprite 插件优先读它，voice 插件也需要
      try { tavo.set('tf_last_speaker', { name: openingRole, characterId: charId || '' }, 'chat'); } catch (e) {}
      
      // ===== 关键修复2：通知 voice 插件开场白已落地，触发语音流式追踪 =====
      // voice 插件靠 message:added 自动捕获，但 boot 期间 generation:prepare 可能会
      // 拦截，导致 voice 的 message:added handler 收不到。我们主动通知 voice 插件。
      if (window.tf_voice_stream && typeof window.tf_voice_stream.onStreamStart === 'function') {
        try { window.tf_voice_stream.onStreamStart('opening_' + idx, charId || 0); } catch (e) {}
      }
      if (window.tf_voice_stream && typeof window.tf_voice_stream.onStreamDone === 'function') {
        try { window.tf_voice_stream.onStreamDone('opening_' + idx); } catch (e) {}
      }
      
      console.log('[tf_story] │ ✅ 开场白台词已写入消息列表');
      
      // 6. 开场白语音生成 + 播放（统一日志：播放完毕:{status}）
      // hasVoiceStream 只代表函数存在，不等于语音真正生效（auto_play 开关决定）
      // 真正生效 = hasVoiceStream && auto_play==true && onSentence 调用后无错
      const hasVoiceStream = !!(window.tf_voice_stream && typeof window.tf_voice_stream.onSentence === 'function');
      // auto_play 配置从 voice 插件读（plugin.cfg）
      const voicePlugin = tavo.plugin && tavo.plugin.plugins && tavo.plugin.plugins['com.toonflow.story-voice'];
      const autoPlay = voicePlugin ? !!voicePlugin.cfg('auto_play', true) : false;
      console.log('[tf_story] │ voicePlugin :',voicePlugin? '已安装' : '未安装');
      console.log('[tf_story] │ voicePlugin auto_play:',voicePlugin.cfg('auto_play'));

      if (hasVoiceStream && autoPlay) {
        const segments = generatedLine.split(/(?<=[。！？.?!])/).filter(Boolean).map(s => s.trim()).filter(s => s.length > 0);
        let voiceOk = true;
        try {
          if (segments.length > 0) {
            for (let i = 0; i < segments.length; i++) {
              await window.tf_voice_stream.onSentence(charId || 0, segments[i], i, 'opening_' + idx);
            }
          } else {
            await window.tf_voice_stream.onSentence(charId || 0, generatedLine, 0, 'opening_' + idx);
          }
        } catch (e) {
          console.warn('[tf_story][opening] 语音失败', e.message);
          voiceOk = false;
        }
        console.log('[tf_story] │ 播放完毕:' + (voiceOk ? '成功' : '失败'));
      } else if (!autoPlay) {
        // voice 插件没装，或 auto_play=false
        console.log('[tf_story] │ 播放完毕:语音未开启(auto_play=false)');
      } else {
        // tf_voice_stream 根本不存在
        console.log('[tf_story] │ 播放完毕:语音插件未加载');
      }
      
      // ===== 关键修复3：开场白播完后主动触发下一轮 generation =====
      // boot 完成后 _bootState='ready'，generation:prepare 会放行。
      // 但 tmm 插件（记忆管理器）可能还没就绪，generation:prepare 的 tmm 检查会阻断。
      // 我们轮询等待 tmm 就绪（最多 5 秒），再触发 generation。
      const waitForTmm = (maxMs) => new Promise((resolve) => {
        let waited = 0;
        const interval = setInterval(() => {
          waited += 500;
          const tmm = readChatVar('tmm');
          const ok = !!(tmm && typeof tmm === 'object' && ('summary' in tmm));
          if (ok || waited >= maxMs) {
            clearInterval(interval);
            if (ok) {
              console.log('[tf_story] │ ✅ tmm 已就绪（等待 ' + waited + 'ms）');
            } else {
              console.warn('[tf_story] │ ⚠️ tmm 未就绪（等待 ' + waited + 'ms），仍尝试触发 generation');
            }
            resolve(ok);
          }
        }, 500);
      });
      
      setTimeout(async () => {
        // 等待 tmm 就绪（最多 5s）
        await waitForTmm(5000);
        
        try {
          // 清掉 tf_orch.active，让编排插件重新设
          try { tavo.set('tf_orch.active', false, 'chat'); } catch (e) {}
          // 主动触发 generation：编排插件在 generation:prepare 时检测 boot ready，
          // 注入 scenario 并接管这轮 generation，开始角色编排
          await tavo.generate('[系统]请描述用户醒来后的第一眼场景。', {
            context: false,
            settings: { maxCompletionTokens: 300 }
          });
          console.log('[tf_story] │ ✅ 下一轮 generation 已触发（由编排插件接管）');
        } catch (e) {
          console.warn('[tf_story][opening] 触发 generation 失败', e.message);
        }
      }, 800); // 等待 800ms 让语音播放（或跳过）
    }
    
    console.log('[tf_story] └─────────────────────────────────────────');

    // 标记开场白已播
    boot.openingDone = true;
    boot.currentChapterIndex = idx;
    writeBoot(boot);
    syncChapterIndex(idx); // 同步到 tf_story.edit（供 sprite 插件监听）
    // 开场白后把事件进度推进到「第一个用户发言」处：
    // 首 phase 的 stage 播完即停（currentEvent = 已播 stage 数）
    const prog = getProgress();
    const firstPhase = (prog.phases || [])[0];
    if (firstPhase) {
      let ne = 0;
      const evs = firstPhase.events || [];
      // 数到第一个「用户发言」
      while (ne < evs.length && !/用户发言/.test(evs[ne].name || '')) ne++;
      prog.currentPhase = 0;
      prog.currentEvent = Math.max(0, ne - 1);
      prog.updatedAt = Date.now();
      setProgress(prog);
    }
    console.log('[tf_story] opening played ' + played + ' messages');
    return played;
  } catch (e) {
    console.warn('[tf_story] playChapterOpening failed', e);
    return 0;
  }
}

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
      const retriable = /internal error|try again|could not complete|not ready/i.test(msg);
      if (!retriable || i === maxTries) throw e;
      console.warn('[tf_story] ' + label + ' retry ' + i + '/' + (maxTries-1) + ': ' + msg);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

// 完整 Boot 序列（5 阶段：uninitialized/reset/resumption_start -> data_loaded -> ready）
async function bootSequence() {
  const myGuard = ++_bootGuard;
  console.log('[tf_story][boot] start, myGuard=' + myGuard);
  let chatId = null;
  try { const c = await tavo.chat.current(); chatId = c && c.id; console.log('[tf_story][boot] chatId=' + chatId); } catch (e) { console.warn('[tf_story][boot] chat.current failed', e); }

  // 0) 立刻切到 natural 模式 + 清空 overrideScenario，阻断官方 scenario 默认开场
  // chat:opened 触发时 tavo 内部可能未 ready，报 "internal error, try again"，重试
  try {
    await _retry(() => tavo.chat.update({ responseMode: 'natural', overrideScenario: '' }), 'step0 chat.update', 4);
    console.log('[tf_story][boot] step0 natural mode set');
  } catch (e) { console.warn('[tf_story][boot] step0 chat.update failed', e); }

  const boot = readBoot();
  let count = 0;
  try {
    count = await _retry(() => tavo.message.count(), 'message.count', 4);
    console.log('[tf_story][boot] message count=' + count);
  } catch (e) { console.warn('[tf_story][boot] count failed', e); }

  // 关键判定：chat_reset 清空 chat scope 变量但保留 global。
  // 「chat scope 的 boot 镜像是否还在」是判断「是否刚 reset」的可靠信号：
  //   - chat boot 丢失 + global 数据在       => 刚 reset（reset 后 tavo 可能自动插 1 条消息，count 不可靠）
  //   - chat boot 在 + status ready + 有消息 => 正常继聊
  //   - global 数据都没有                    => 全新故事
  let sessionStage;
  const chatBoot = readChatVar(BOOT_NS);
  const globalHasData = (() => {
    const gv = (() => { try { let g = tavo.get('tf_story.edit', 'global'); let i=0; while (g && typeof g==='object' && 'value' in g && i<5){g=g.value;i++;} return g; } catch(e){return null;} })();
    return !!(gv && typeof gv === 'object' && Array.isArray(gv.chapters) && gv.chapters.length);
  })();

  if (!globalHasData) {
    sessionStage = 'uninitialized';            // 故事从未初始化（global 空）
  } else if (!chatBoot) {
    sessionStage = 'reset';                    // 刚 reset：chat boot 被清，global 还在
  } else if (chatBoot.status === 'ready' && count > 0) {
    sessionStage = 'resumption_start';         // 正常继聊
  } else {
    sessionStage = 'reset';                    // 兜底：global 有数据但状态异常
  }
  console.log('[tf_story][boot] sessionStage=' + sessionStage + ' globalHasData=' + globalHasData + ' chatBoot=' + (chatBoot ? chatBoot.status : 'null') + ' count=' + count);

  writeBoot({ status: 'loading', stage: sessionStage, chatId, openedAt: Date.now(), openingDone: false, sessionType: sessionStage });
  notifyBootStage(sessionStage, '检测会话：' + sessionStage);

  const restored = restoreStaticData();
  console.log('[tf_story][boot] restored=' + restored);
  notifyBootStage(sessionStage, '恢复静态数据' + (restored ? '（global -> chat）' : '（无 global 备份）'));

  const rebuilt = rebuildDynamicData();
  console.log('[tf_story][boot] rebuilt=' + rebuilt);

  if (sessionStage !== 'resumption_start') {
    const purged = await purgeOfficialHijack();
    if (purged > 0) console.log('[tf_story][boot] purged ' + purged + ' official hijack');
  }

  writeBoot({ status: 'loading', stage: 'data_loaded', chatId, openedAt: Date.now(), openingDone: false, sessionType: sessionStage, restored, rebuilt });
  notifyBootStage('data_loaded', '数据已加载，准备开场白…');

  // 编排模式必须在开场白之前应用（speaker 插件的 generation:prepare 需要读到 orchestration='plugin'）
  if (sessionStage !== 'resumption_start') {
    await applyOrchestrationMode();
  }

  if (sessionStage !== 'resumption_start') {
    _bootState = 'opening';
    try {
      const played = await playChapterOpening();
      console.log('[tf_story][boot] playChapterOpening result=' + played);
    } catch (e) { console.warn('[tf_story][boot] playChapterOpening failed', e); }
  }

  // openingDone：reset/uninitialized 都为 true（开场白已播），resumption 也为 true（直接用历史消息）
  const finalBoot = { status: 'ready', stage: 'ready', chatId, openedAt: Date.now(), openingDone: true, sessionType: sessionStage, restored, rebuilt, readyAt: Date.now() };
  writeBoot(finalBoot);
  _bootState = 'ready';
  notifyBootStage('ready', '故事已就绪');
  setTimeout(function () { notifyBootStage('ready', ''); }, 400);

  console.log('[tf_story][boot] DONE sessionType=' + sessionStage + ' restored=' + restored + ' rebuilt=' + rebuilt);

  return sessionStage;
}

// boot 未就绪时拦截所有生成（阻止官方开场白/第一个角色自动发言）
// 注意：_bootState='opening' 时不拦截，放行给 speaker 插件接管开场白生成
_safeOn('generation:prepare', async (event) => {
  if (_bootState !== 'ready' && _bootState !== 'opening') {
    try { event.text = ''; } catch (e) {}
    return;
  }
  // tmm 就绪检查：只打日志，不再阻断（插件加载顺序不确定，阻断会导致编排永远无法启动）
  const tmm = readChatVar('tmm');
  if (!tmm || typeof tmm !== 'object' || !('summary' in tmm)) {
    console.warn('[tf_story][gen:prepare] tmm not ready yet (memory_manager still initializing)');
    // 不再阻断生成！让编排继续
  } else {
    console.log('[tf_story][gen:prepare] tmm ready, generation allowed');
  }
});

// 官方首条消息落地即删（message:added 里做二次保险）
_safeOn('message:added', async (event) => {
  const msg = event && event.message;
  if (!msg || msg.role !== 'assistant') return;
  const boot = readBoot();
  // boot ready 且开场白已播 -> 正常消息
  if (boot.status === 'ready' && boot.openingDone) return;
  // 否则视为官方劫持 -> 删除
  // 但要小心：我们自己的 playChapterOpening 也会 append assistant 消息，
  // 用 openingDone 标记区分（playChapterOpening append 前先标记后写入会来不及，
  // 所以 append 前先把内存 _bootState 设为 opening）
  if (_bootState === 'opening') return; // 自己的开场白
  try {
    await tavo.message.delete(msg.id);
    console.log('[tf_story] deleted official hijack message', msg.id);
  } catch (e) {}
});

_safeOn('chat:opened', async () => {
  // Boot 序列接管：数据恢复 -> 官方劫持清理 -> 开场白 -> 编排应用
  await bootSequence();

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

  // 台词数量（最近对话入参条数）补全：缺失/非法时回退默认 20（静态配置，受保护不覆盖）
  if (typeof cur.lineCount !== 'number' || isNaN(cur.lineCount) || cur.lineCount < 1) {
    cur.lineCount = 20;
    setEdit(cur);
  }

  // 进度时间戳更新（不重置章节进度等动态数值，仅刷新时间）
  const progress = getProgress();
  progress.updatedAt = Date.now();
  setProgress(progress);
});

// 判定器入口：每轮对话后评估章节结局（仅 boot ready 后生效）
_safeOn('message:added', async (event) => {
  if (!event || !event.message) return;
  const msg = event.message;
  console.log('[tf_story][msg:added] role=' + msg.role + ' content=' + JSON.stringify((msg.content||'').slice(0,60)));
  if (msg.role !== 'user') return; // 只在用户发言后判定
  // boot 未完成时不判定（避免官方劫持阶段误判）
  const boot = readBoot();
  console.log('[tf_story][msg:added] ★ 用户发言 boot.status=' + (boot&&boot.status) + ' openingDone=' + (boot&&boot.openingDone));
  if (!boot || boot.status !== 'ready' || !boot.openingDone) {
    console.warn('[tf_story][msg:added] ✗ judge blocked: boot not ready');
    return;
  }
  try {
    let count = 0;
    try { count = await tavo.message.count(); } catch (e) {}

    // ===== 全链路 TRACE LOG =====
    const progress = getProgress();
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx] || null;
    const phases = progress.phases || [];
    const phaseIdx = Math.max(0, progress.currentPhase || 0);
    const eventIdx = Math.max(0, progress.currentEvent || 0);
    const curPhase = phases[phaseIdx] || null;
    const curEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx] || null) : null;
    const nextEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx + 1] || null) : null;

    console.log('══════════════════════════════════════════');
    console.log('[tf_story] ┌─── 全链路 TRACE ───────────────────');
    console.log('[tf_story] │ 📝 用户输入: ' + JSON.stringify((msg.content||'').slice(0,80)));
    console.log('[tf_story] │ 📚 章节状态: 第' + (idx+1) + '/' + chapters.length + '章'
      + (chapter ? '「' + chapter.title + '」' : '(无)'));
    if (chapter && chapter.successCondition) {
      console.log('[tf_story] │ 📋 完成条件: ' + chapter.successCondition.slice(0,100));
    }
    console.log('[tf_story] │ 📊 事件进度: Phase=' + phaseIdx + '(' + (curPhase?curPhase.name:'无') + ')'
      + ' / Event=' + eventIdx + '(' + (curEvent?curEvent.name:'无') + ')'
      + ' / next=' + (nextEvent?nextEvent.name:'无'));
    console.log('[tf_story] │    phases总数=' + phases.length
      + ' completedChapters=[' + (progress.completedChapters||[]).map(i=>i+1).join(',') + ']'
      + ' pendingChapterId=' + progress.pendingChapterId
      + ' storyCompleted=' + progress.storyCompleted
      + ' freeMode=' + progress.sessionFreeMode);
    console.log('[tf_story] │ 🔄 触发: judgeAndAdvance (messageCount=' + count + ')');
    console.log('[tf_story] └─────────────────────────────────────');

    await judgeAndAdvance({ content: msg.content || '', messageCount: count });

    // ===== judgeAndAdvance 完成后 TRACE =====
    const progressAfter = getProgress();
    const phasesAfter = progressAfter.phases || [];
    const phaseIdxAfter = Math.max(0, progressAfter.currentPhase || 0);
    const eventIdxAfter = Math.max(0, progressAfter.currentEvent || 0);
    const curPhaseAfter = phasesAfter[phaseIdxAfter] || null;
    const curEventAfter = (curPhaseAfter && curPhaseAfter.events) ? (curPhaseAfter.events[eventIdxAfter] || null) : null;
    console.log('══════════════════════════════════════════');
    console.log('[tf_story] ┌─── judgeAndAdvance 结果 ─────────────');
    console.log('[tf_story] │ ✅ 章节: ' + (idx+1) + '/' + chapters.length
      + (progressAfter.pendingChapterId ? ' → pending切第' + (progressAfter.pendingChapterId+1) + '章' : '')
      + (progressAfter.storyCompleted ? ' 故事完结!' : ''));
    console.log('[tf_story] │ 📊 事件进度(后): Phase=' + phaseIdxAfter + '(' + (curPhaseAfter?curPhaseAfter.name:'无') + ')'
      + ' / Event=' + eventIdxAfter + '(' + (curEventAfter?curEventAfter.name:'无') + ')');
    console.log('[tf_story] │    pendingChapterId=' + progressAfter.pendingChapterId
      + ' failedAttempts=' + progressAfter.failedAttempts);
    console.log('[tf_story] └─────────────────────────────────────');
    console.log('══════════════════════════════════════════');
  } catch (e) {
    console.warn('[tf_story] judge failed', e);
  }
});

// 整章推进（对齐 judgeAndAdvance 的 success 分支 pendingChapterId 语义）
// 有下一章时设置 pendingChapterId，下一轮 judgeAndAdvance 阶段0执行真正切换
async function manualChapterAdvance(chapters, idx, progress) {
  const nextIdx = idx + 1;
  if (nextIdx >= chapters.length) {
    // 故事完结：直接切换
    progress.storyCompleted = true;
    progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
    progress.currentChapterIndex = nextIdx;
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.updatedAt = Date.now();
    setProgress(progress);
    syncChapterIndex(nextIdx);
    tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
    try {
      await tavo.message.append({
        content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
        hidden: false,
      });
    } catch (e) {}
  } else {
    // 有下一章：设置 pendingChapterId（下一轮 judgeAndAdvance 阶段0执行真正切换）
    progress.pendingChapterId = nextIdx;
    progress.updatedAt = Date.now();
    setProgress(progress);
    const nextCh = chapters[nextIdx];
    tavo.utils.toast('✅ 第 ' + (idx + 1) + ' 章完成！下一章将在下一轮对话开始时切换');
    console.log('[tf_story][manual] pendingChapterId=' + nextIdx + ' (will switch next round)');
  }
}

// 手动推进指令：@事件进度检测 下个事件 / @下个事件 / @下一个事件 / @下个章节 / @下一个章节
// 先取消原发送，再整章推进（与判定成功分支一致，确保指令真正生效）。
async function advanceManually(rawText) {
  try {
    if (cfgGet('enabled', true) === false) return;
    const progress = getProgress();
    if (progress.storyCompleted) {
      tavo.utils.toast('故事已完结（自由模式），无需推进');
      return;
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) { tavo.utils.toast('无章节数据'); return; }
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) { tavo.utils.toast('无当前章节'); return; }
    await manualChapterAdvance(chapters, idx, progress);
  } catch (e) {
    console.warn('[tf_story] manual advance failed', e);
    tavo.utils.toast('推进失败：' + (e && e.message ? e.message : e));
  }
}

_safeOn('input:beforeSend', async (event) => {
  if (cfgGet('enabled', true) === false) return;
  const text = String((event && event.text) || '').trim();

  const boot = readBoot();
  const tmm = readChatVar('tmm');
  const tmmOk = !!(tmm && typeof tmm === 'object' && ('summary' in tmm));
  console.log('[tf_story][input:beforeSend] ★ _bootState=' + _bootState + ' boot.status=' + (boot && boot.status) + ' openingDone=' + (boot && boot.openingDone) + ' tmm_ok=' + tmmOk);

  // 故事加载门：boot 未 ready（数据未加载 / 开场白未播）时禁止一切用户发言
  if (_bootState !== 'ready') {
    console.log('[tf_story][input:beforeSend] ✗ blocked: _bootState=' + _bootState);
    try { if (event && typeof event.cancel === 'function') event.cancel('故事加载中…'); } catch (e) {}
    tavo.utils.toast('⏳ 故事加载中，请稍候…');
    return;
  }
  if (!boot || boot.status !== 'ready' || !boot.openingDone) {
    console.log('[tf_story][input:beforeSend] ✗ blocked: boot.status=' + (boot && boot.status) + ' openingDone=' + (boot && boot.openingDone));
    try { if (event && typeof event.cancel === 'function') event.cancel('故事加载中…'); } catch (e) {}
    tavo.utils.toast('⏳ 故事加载中，请稍候…');
    return;
  }

  // tmm 就绪检查：只打日志，不阻断（插件加载顺序不确定，阻断会导致用户无法发言）
  if (!tmmOk) {
    console.warn('[tf_story][input:beforeSend] tmm not ready yet, proceeding anyway');
  }

  if (!/^@(事件进度检测\s*下个?事件|下个?事件|下个?章节)/.test(text)) return;
  try { if (event && typeof event.cancel === 'function') event.cancel(); } catch (e) {}
  tavo.utils.toast('事件推进指令处理中…');
  advanceManually(text).catch(err => console.warn('[tf_story] manual advance failed', err));
});

// =========================================================================
// 事件进度 LLM（对齐 toonflow story-event-progress Agent）
// 替代纯 +1 规则的 advanceEventProgress，用 LLM 判断当前事件是否结束
// =========================================================================

// 对齐 toonflow fixDB.prompts.ts _PROMPT_STORY_EVENT_PROGRESS
const PROMPT_STORY_EVENT_PROGRESS = `你是事件进度检测器。你只判断"当前事件是否结束、现在进行到哪一步"，不判断章节是否成功或失败。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"
## 任务
根据当前事件、当前进度和最近 10 条台词，判断：
- 当前事件是否已经结束
- 当前事件当前应处于什么状态
- 当前事件应该如何总结当前进度
- 如果事件是要求某个角色说个台词，那么他说了给类似的台词这个事件就是结束
- 你倾向于宽松地认为事件已经结束，除非事件里有强硬的说一定要完成些什么事情。
- 如果事件是要求用户回应什么的，那么不说话也是一种回应，输入"."也是一种回应

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
"." 就是明确的发言和行动。应该判定为已完成用户发言阶段！！！
模型禁止返回类似的判定：【"reason": "当前阶段是用户发言阶段，用户虽然多次输入'.'但根据事件流程仍在等待用户做出明确的发言或行动来决定下一步方向，因此事件尚未结束，继续等待用户输入"】
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。
- 此时，\`event_status\` 应判定为 \`active\`，表示系统可以继续推进剧情，而不是 \`waiting_input\`。

## 约束
1. 只判断当前事件，不判断章节整体成败
2. 不要自己编造新剧情
3. recent_dialogue 里的"用户"才代表真实用户发言
4. 不能把单个数字误判成"输入了多次"
5. 如果事件还没达成，只能 ended=false
6. 用户输入 "." 是跳过，不是迷茫，不需要引导。

## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块。

字段固定为：
- ended: boolean
- event_status: "active" | "waiting_input" | "completed"
- progress_summary: string
- progress_facts: string[]
- reason: string

## 判定规则
- ended=true：代表当前事件已经完成，系统应切到下一个事件
- ended=false：代表当前事件仍未完成，系统继续停留在当前事件
- event_status=waiting_input：代表当前事件还需要用户输入
- event_status=active：代表当前事件仍在推进，但还没轮到用户
- event_status=completed：只在 ended=true 时使用

## 用户发言阶段完成判定（重要）
当 current_stage.label 含"用户发言"且需要判定该阶段是否完成时：
- 用户**任何**非空、非纯标点的输入都算已发言（"." 视为跳过表达，也算完成）
- 不要把"用户发言"理解为"用户必须下达具体动作指令"——表达意愿、提问、感叹、命令、沉默跳过都属于"发言"
- 用户一旦在该阶段留下任何有效输入，ended=true、event_status=active，让系统推进剧情
- 不要因为"剧情还没发生具体变化"就判定用户还没发言——那是编排师的事，不是你的事
- 若用户**连续多轮**都被判 waiting_input 但实际已多次输入，应主动结束该阶段，避免死循环

## 输出示例
{"ended":false,"event_status":"waiting_input","progress_summary":"当前事件仍在等待用户补充角色名称、性别和年龄","progress_facts":["用户尚未提供完整角色信息","当前仅完成开场引导","需要继续等待用户输入"],"reason":"当前事件目标尚未完成，仍需用户继续提供信息"}
`;

// 构建事件进度检测输入快照（对齐官方 buildEventProgressInputSnapshot）
async function buildEventProgressSnapshot(chapter, progress, latestMessageContent, latestMessageRole) {
  const phases = progress.phases || [];
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const phase = phases[phaseIdx] || {};
  const events = phase.events || [];
  const curEv = events[eventIdx] || {};
  const nextEv = events[eventIdx + 1] || null;
  const isUserPhase = /用户发言/.test(curEv.name || '');
  const isUserNode = /用户发言/.test(curEv.name || '');

  // recent_dialogue: 最近 10 条
  let recentDialogue = [];
  try {
    const cnt = await tavo.message.count();
    if (cnt > 0) {
      const msgs = tavo.message.find([Math.max(0, cnt - 10), cnt]) || [];
      recentDialogue = msgs.map(m => {
        const role = m.characterName || (m.role === 'user' ? '用户' : '旁白');
        const role_type = m.role === 'user' ? 'player' : (m.characterName ? 'npc' : 'narrator');
        return {
          role: role,
          role_type: role_type,
          content: String(m.content || '').replace(/<[^>]+>/g, '').slice(0, 160),
        };
      });
    }
  } catch (e) {}

  // current_stage（tavo 没有 runtimeOutline，简化版）
  const currentStage = {
    index: eventIdx,
    label: curEv.name || '事件',
    kind: isUserNode ? 'user' : 'scene',
    summary: curEv.name || '',
    user_speak_required: isUserNode ? true : null,
  };
  const nextStage = nextEv ? {
    index: eventIdx + 1,
    label: nextEv.name || '',
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    summary: nextEv.name || '',
  } : null;

  // next_event
  const nextEvent = nextEv ? {
    index: eventIdx + 2,
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    label: nextEv.name || '',
    summary: nextEv.name || '',
  } : null;

  // 计算 user_speak_count（用户发言轮数）
  const userSpeakCount = recentDialogue.filter(m => m.role === '用户').length;

  return {
    chapter: {
      id: 0,
      title: chapter?.title || '未命名章节',
    },
    current_event: {
      index: eventIdx + 1,
      kind: isUserNode ? 'user' : 'scene',
      flow: isUserPhase ? 'user_phase' : 'chapter_content',
      status: isUserPhase ? 'waiting_input' : 'active',
      summary: (phase.name || '') + (curEv.name ? ' > ' + curEv.name : ''),
      facts: [phase.name || '', curEv.name || ''].filter(Boolean),
    },
    current_progress: {
      phase_id: phase.name || '',
      phase_index: phaseIdx,
      stage_index: eventIdx,
      total_stages: events.length,
      user_node_status: isUserPhase ? 'waiting' : 'idle',
      completed_events: [],
      user_speak_count: userSpeakCount,
      user_speak_required: isUserNode ? true : null,
    },
    current_stage: currentStage,
    next_stage: nextStage,
    next_event: nextEvent,
    phase_transition_hint: '',
    latest_message: {
      role: latestMessageRole || '用户',
      role_type: 'player',
      event_type: 'on_message',
      content: (latestMessageContent || '').replace(/<[^>]+>/g, '').slice(0, 200),
    },
    recent_dialogue: recentDialogue,
  };
}

// 调用 LLM 判断事件进度（对齐官方 evaluateEventProgressByAi）
async function evaluateEventProgressByAi(chapter, progress, latestMessageContent, latestMessageRole) {
  try {
    const snapshot = await buildEventProgressSnapshot(chapter, progress, latestMessageContent, latestMessageRole);
    const userPrompt = JSON.stringify(snapshot, null, 2);
    const llmMode = (window.tf_llm && window.tf_llm.callDirect) ? '接管' : 'tavo原生';

    const rawText = llmMode === '接管'
      ? await window.tf_llm.callDirect(PROMPT_STORY_EVENT_PROGRESS + '\n\n' + userPrompt, { maxCompletionTokens: 400 })
      : await tavo.generate(PROMPT_STORY_EVENT_PROGRESS + '\n\n' + userPrompt, { context: false, settings: { maxCompletionTokens: 400 } });

    const cleaned = (rawText || '').trim()
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<[^>]+>/g, '');
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fence ? fence[1].trim() : cleaned;
    const obj = JSON.parse(jsonText);
    console.log('[tf_story] 🤖 [event_progress] LLM调用 → ended=' + obj.ended + ' status=' + obj.event_status);
    console.log('[tf_story]    reason=' + (obj.reason || '').slice(0, 100));
    console.log('[tf_story]    progress_summary=' + (obj.progress_summary || '').slice(0, 80));
    console.log('[tf_story]    progress_facts=' + JSON.stringify((obj.progress_facts||[]).slice(0,3)));
    return {
      ended: !!(obj.ended),
      event_status: obj.event_status || 'active',
      progress_summary: obj.progress_summary || '',
      progress_facts: Array.isArray(obj.progress_facts) ? obj.progress_facts : [],
      reason: obj.reason || '',
    };
  } catch (e) {
    console.warn('[tf_story][event_progress] LLM 调用失败，回退到规则:', e.message);
    return null;
  }
}

// LLM 事件进度应用：替代 advanceEventProgress（对齐官方 applySessionUserEventProgress）
// 返回 { advanced: true } 表示推进了，{ advanced: false } 表示未推进
async function applySessionUserEventProgress(chapter, progress, latestMessageContent, latestMessageRole, precomputedResolution) {
  const phases = progress.phases || [];
  if (!phases.length) return { advanced: false };

  let pi = Math.max(0, progress.currentPhase || 0);
  const phase = phases[pi];
  const events = phase?.events || [];
  let ei = Math.max(0, progress.currentEvent || 0);
  const curEv = events[ei] || {};
  const isUserPhase = /用户发言/.test(curEv.name || '');
  const trimmed = (latestMessageContent || '').trim();

  // user phase：用户发言即完成节点，规则推进，不调 AI
  if (isUserPhase) {
    console.log('[tf_story][event_progress] user phase，规则推进 ei=' + ei + ' -> ' + (ei + 1));
    ei += 1;
    // 消费后若是用户发言节点，继续跳过
    while (ei < events.length && /用户发言/.test(events[ei].name || '')) ei += 1;
    if (ei >= events.length) {
      // 本 phase 完成
      let np = pi + 1;
      while (np < phases.length && /^非事件/.test(phases[np].name || '')) np++;
      progress.currentPhase = np;
      progress.currentEvent = 0;
      const nEvents = (phases[np] && phases[np].events) || [];
      let ne = 0;
      while (ne < nEvents.length && /用户发言/.test(nEvents[ne].name || '')) ne++;
      progress.currentEvent = ne;
    } else {
      progress.currentEvent = ei;
    }
    progress.updatedAt = Date.now();
    return { advanced: true };
  }

  // 非 user phase：仅当 "." 或 forceAi 时才调 LLM
  const shouldSkipAi = trimmed !== '.' && !precomputedResolution;
  if (shouldSkipAi) {
    console.log('[tf_story][event_progress] 非 user phase + 非 "." 快路径，事件不推进');
    return { advanced: false };
  }

  // 调用 LLM 判断
  const resolution = precomputedResolution || await evaluateEventProgressByAi(chapter, progress, latestMessageContent, latestMessageRole);
  if (!resolution) {
    // LLM 不可用，回退到 "." 跳过规则
    if (trimmed === '.') {
      ei += 1;
      while (ei < events.length && /用户发言/.test(events[ei].name || '')) ei += 1;
      if (ei >= events.length) {
        let np = pi + 1;
        while (np < phases.length && /^非事件/.test(phases[np].name || '')) np++;
        progress.currentPhase = np;
        progress.currentEvent = 0;
        const nEvents = (phases[np] && phases[np].events) || [];
        let ne = 0;
        while (ne < nEvents.length && /用户发言/.test(nEvents[ne].name || '')) ne++;
        progress.currentEvent = ne;
      } else {
        progress.currentEvent = ei;
      }
      progress.updatedAt = Date.now();
      return { advanced: true };
    }
    return { advanced: false };
  }

  // LLM 判定 ended=true → 推进
  if (resolution.ended) {
    console.log('[tf_story][event_progress] LLM ended=true，推进: ei=' + ei + ' -> ' + (ei + 1) + ' reason=' + (resolution.reason || '').slice(0, 80));
    ei += 1;
    while (ei < events.length && /用户发言/.test(events[ei].name || '')) ei += 1;
    if (ei >= events.length) {
      let np = pi + 1;
      while (np < phases.length && /^非事件/.test(phases[np].name || '')) np++;
      progress.currentPhase = np;
      progress.currentEvent = 0;
      const nEvents = (phases[np] && phases[np].events) || [];
      let ne = 0;
      while (ne < nEvents.length && /用户发言/.test(nEvents[ne].name || '')) ne++;
      progress.currentEvent = ne;
    } else {
      progress.currentEvent = ei;
    }
    progress.updatedAt = Date.now();
    return { advanced: true };
  }

  console.log('[tf_story][event_progress] LLM ended=false，事件未推进: ' + (resolution.reason || '').slice(0, 80));
  return { advanced: false };
}

// =========================================================================
// 章节判定 LLM（对齐 toonflow story-chapter Agent）
// 在 evaluateChapterOutcome 基础上增强：优先用 LLM，失败时回退启发式
// =========================================================================

// 对齐 toonflow fixDB.prompts.ts _PROMPT_STORY_CHAPTER
const PROMPT_STORY_CHAPTER = `你是章节判定器。你只判断当前章节是否成功、失败或继续，以及是否进入下一章。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"。
## 任务
根据用户提供的章节信息、当前事件状态和运行态数据，判断章节是否应该结束。

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。

## 特别注意
用户指的是台词（recent_dialogue）里用户： recent_dialogue 数据里的 "role": "用户"
用户输入："2", 不是代表输入了两次！！！
## 入参说明
current_event：当前事件
next_event：该章节的下一事件，用于判断是否需要引导。一般来说没有下一事件，才需要result="guide"
## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块，不要 markdown 格式。

字段固定为：
- result: string - 只能是 "continue" /"guide"/ "success" / "failed"
- matched_rule: string | null - 命中的规则标识，未命中时为 null
- reason: string - 判定原因说明
- next_chapter_id: number | null - 下一章 ID，无则为 null
- guide_summary: string - 当 result="guide" 时的引导摘要，说明如何满足结束条件
- guide_facts: string[] - 当 result="guide" 时的引导事实列表（1-3条）

## 输出规则
- 当 result="continue" 时，无须给出 guide_summary和 guide_facts.代表的是继续该章节的事件推进
- 当 result="guide" 时，必须给出 guide_summary 和 1~3 条 guide_facts，说明下一步如何满足结束条件
- 当 result="success" 或 "failed" 时，guide_summary 置空串，guide_facts 置空数组

## 输出示例

result=guide:
{"result":"guide","matched_rule":null,"reason":"用户尚未输入名称、性别、年龄，未满足结束条件","next_chapter_id":null,"guide_summary":"需要引导用户输入角色名称、性别和年龄","guide_facts":["用户尚未提供角色基本信息","需要询问用户角色名称","需要询问用户角色性别和年龄"]}
result=continue:
{
  "result": "continue",
  "matched_rule": null,
  "reason": "当前站队场景需要用户回应西游孙悟空的提问，用户尚未完成回应，事件未完成，未达到章节完成条件",
  "next_chapter_id": null,
  "guide_summary": "暂无",
  "guide_facts": [
    "暂无"
  ]
}
`;

// 构建章节判定输入快照
async function buildChapterJudgeSnapshot(chapter, progress, latestMessageContent, recentDialogue) {
  const phases = progress.phases || [];
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const phase = phases[phaseIdx] || {};
  const events = phase.events || [];
  const curEv = events[eventIdx] || {};
  const nextEv = events[eventIdx + 1] || null;
  const isUserNode = /用户发言/.test(curEv.name || '');

  const nextEventInfo = nextEv ? {
    index: eventIdx + 2,
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    label: nextEv.name || '',
    summary: nextEv.name || '',
    transition_hint: '',
  } : null;

  // 读取全局背景
  const edit = getEdit();
  const worldGlobalBackground = (edit.globalBackground || '').slice(0, 500);

  return {
    chapter: {
      title: chapter?.title || '未命名章节',
      completion_condition: chapter?.successCondition || null,
      ending_rules: null,
      content: (chapter?.content || '').slice(0, 500),
    },
    world_intro: (edit.intro || '').slice(0, 300),
    world_global_background: worldGlobalBackground,
    current_event: {
      index: eventIdx + 1,
      kind: isUserNode ? 'user' : 'scene',
      flow: 'chapter_content',
      status: curEv.state || 'active',
      summary: (phase.name || chapter?.title || '') + (curEv.name ? ' > ' + curEv.name : ''),
      facts: [phase.name || '', curEv.name || ''].filter(Boolean),
    },
    next_event: nextEventInfo,
    runtime_state: {
      completed_events: [],
      message_content: (latestMessageContent || '').replace(/<[^>]+>/g, '').slice(0, 200),
      event_type: 'on_message',
    },
    recent_dialogue: recentDialogue,
  };
}

// 调用 LLM 判断章节结局（对齐官方 evaluateChapterOutcomeByAi）
async function evaluateChapterOutcomeByAi(chapter, progress, latestMessageContent) {
  if (!chapter) return null;
  const cond = chapter.successCondition;
  if (!cond || !String(cond).trim()) return null; // 无条件 = 不判

  try {
    // recent_dialogue（最近 10 条）
    let recentDialogue = [];
    try {
      const cnt = await tavo.message.count();
      if (cnt > 0) {
        const msgs = tavo.message.find([Math.max(0, cnt - 10), cnt]) || [];
        recentDialogue = msgs.map(m => ({
          role: m.characterName || (m.role === 'user' ? '用户' : '旁白'),
          role_type: m.role === 'user' ? 'player' : (m.characterName ? 'npc' : 'narrator'),
          content: String(m.content || '').replace(/<[^>]+>/g, '').slice(0, 160),
        }));
      }
    } catch (e) {}

    const snapshot = await buildChapterJudgeSnapshot(chapter, progress, latestMessageContent, recentDialogue);
    const userPrompt = JSON.stringify(snapshot, null, 2);
    const llmMode = (window.tf_llm && window.tf_llm.callDirect) ? '接管' : 'tavo原生';

    const rawText = llmMode === '接管'
      ? await window.tf_llm.callDirect(PROMPT_STORY_CHAPTER + '\n\n' + userPrompt, { maxCompletionTokens: 400 })
      : await tavo.generate(PROMPT_STORY_CHAPTER + '\n\n' + userPrompt, { context: false, settings: { maxCompletionTokens: 400 } });

    const cleaned = (rawText || '').trim()
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<[^>]+>/g, '');
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fence ? fence[1].trim() : cleaned;
    const obj = JSON.parse(jsonText);
    console.log('[tf_story] 🤖 [chapter_judge] LLM调用 → result=' + obj.result + ' matched_rule=' + (obj.matched_rule||'null'));
    console.log('[tf_story]    reason=' + (obj.reason || '').slice(0, 120));
    if (obj.result === 'guide') {
      console.log('[tf_story]    guide_summary=' + (obj.guide_summary || '').slice(0, 80));
      console.log('[tf_story]    guide_facts=' + JSON.stringify((obj.guide_facts||[]).slice(0,3)));
    }
    return {
      result: obj.result || 'continue',
      matched_rule: obj.matched_rule || null,
      reason: obj.reason || '',
      next_chapter_id: obj.next_chapter_id || null,
      guide_summary: obj.guide_summary || '',
      guide_facts: Array.isArray(obj.guide_facts) ? obj.guide_facts : [],
    };
  } catch (e) {
    console.warn('[tf_story][chapter_judge] LLM 调用失败，回退到启发式:', e.message);
    return null;
  }
}

// =========================================================================
// 桥接：面板 -> entry（sidebar 事件做通道）
// =========================================================================

_safeOnSide('tf-story-save-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  tavo.utils.toast('章节列表已保存（' + (edit.chapters || []).length + ' 章）');
});

_safeOnSide('tf-story-publish-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  const r = await syncEditToWorldbook(edit);
  tavo.utils.toast(r.ok ? ('已发布（' + r.count + ' 条常量）') : ('发布失败：' + r.msg));
});

_safeOnSide('tf-story-apply-mode', async () => {
  await applyOrchestrationMode();
  tavo.utils.toast('编排模式已按配置应用');
});

// 进入自由模式（剧情完结后）
_safeOnSide('tf-story-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = true;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已进入自由模式');
});

// 退出自由模式（回到正常判定）
_safeOnSide('tf-story-exit-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = false;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已退出自由模式');
});

// 重置故事进度
_safeOnSide('tf-story-reset', async () => {
  const p = defaultProgress();
  setProgress(p);
  tavo.utils.toast('故事进度已重置');
});

// =========================================================================
// 对外 API（供其他插件如 multi_character_stage 调用）
// =========================================================================
(function () {
  try {
    if (typeof window === 'undefined') return;
    // 编排前调用：快速返回章节+事件状态，同步 tf_progress 到最新
    window.tfStoryJudge = {
      checkAndAdvance: tfStoryJudge_checkAndAdvance,
      // 编排后调用：判断章节是否完成
      checkChapterDone: tfStoryJudge_checkChapterDone,
    };
    console.log('[tf_story] ✅ window.tfStoryJudge 已注册');
  } catch (e) {
    console.warn('[tf_story] window.tfStoryJudge 注册失败', e);
  }
})();