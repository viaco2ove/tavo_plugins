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
  advanceEventProgress(progress);
  // 事件推进结果必须落盘（即使章节未完成，面板也要显示最新 stage 状态）
  setProgress(progress);

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

// 播报章节开场白（对齐 Toonflow introduction 流程）：
// 优先按 chat.characters 查找 role 对应的 characterId；
// 旁白匹配专用的"旁白"角色（story_sync 创建的 id）防 fallback 到第一个 NPC。
async function playChapterOpening() {
  try {
    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) return false;
    const progress = getProgress();
    const idx = Math.min(progress.currentChapterIndex || 0, chapters.length - 1);
    const ch = chapters[idx];
    if (!ch || !ch.openingLine) return false;
    const role = ch.openingRole || '旁白';

    // 开场白标记（防重复播报）
    const boot = readBoot();
    if (boot.openingDone) return false;

    // 按角色名在 chat 里找 characterId；旁白/通用则精确匹配
    let characterId;
    try {
      const chat = await tavo.chat.current();
      const chars = chat.characters || [];
      const hit = chars.find(c => c.name === role)
        || chars.find(c => c.name === '旁白') // 兜底：用专门的"旁白"角色
        || null;
      if (hit) characterId = hit.id;
    } catch (e) {}

    await tavo.message.append({
      role: 'assistant',
      characterId,
      content: ch.openingLine,
      hidden: false,
    });
    // 标记开场白已播（状态由 bootSequence 最终统一写入 ready）
    boot.openingDone = true;
    boot.currentChapterIndex = idx;
    writeBoot(boot);
    return true;
  } catch (e) {
    console.warn('[tf_story] playChapterOpening failed', e);
    return false;
  }
}

// 完整 Boot 序列（5 阶段：uninitialized/reset/resumption_start -> data_loaded -> ready）
async function bootSequence() {
  const myGuard = ++_bootGuard;
  let chatId = null;
  try { const c = await tavo.chat.current(); chatId = c && c.id; } catch (e) {}

  // 0) 立刻切到 natural 模式 + 清空 overrideScenario，阻断官方 scenario 默认开场
  try {
    await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
  } catch (e) {}

  const boot = readBoot();
  // 1) 判定会话类型（首次 vs 重启 vs 继聊）
  let count = 0;
  try { count = await tavo.message.count(); } catch (e) {}
  let sessionStage;
  if (count === 0) {
    // global 是否有数据判定 uninitialized vs reset
    const gv = (() => { try { let g = tavo.get('tf_story.edit', 'global'); let i=0; while (g && typeof g==='object' && 'value' in g && i<5){g=g.value;i++;} return g; } catch(e){return null;} })();
    sessionStage = (gv && typeof gv === 'object' && Array.isArray(gv.chapters) && gv.chapters.length) ? 'reset' : 'uninitialized';
  } else {
    sessionStage = 'resumption_start';
  }

  writeBoot({
    status: 'loading',
    stage: sessionStage,
    chatId,
    openedAt: Date.now(),
    openingDone: false,
    sessionType: sessionStage,
  });
  notifyBootStage(sessionStage, '检测会话：' + sessionStage);

  // 2) 加载静态数据（global -> chat）
  const restored = restoreStaticData();
  notifyBootStage('data_loaded', '恢复静态数据' + (restored ? '（global -> chat）' : '（无 global 备份）'));

  // 3) 重建动态数据
  const rebuilt = rebuildDynamicData();

  // 4) 若不是继聊：清掉官方劫持的首条发言
  if (sessionStage !== 'resumption_start') {
    const purged = await purgeOfficialHijack();
    if (purged > 0) console.log('[tf_story] purged official hijack messages:', purged);
  }

  // 5) 标记 data_loaded（静态 + 动态数据已就位）
  writeBoot({
    status: 'loading',
    stage: 'data_loaded',
    chatId,
    openedAt: Date.now(),
    openingDone: false,
    sessionType: sessionStage,
    restored,
    rebuilt,
  });
  notifyBootStage('data_loaded', '数据已加载，准备开场白…');

  // 6) 播报开场白（非继聊场景）
  if (sessionStage !== 'resumption_start') {
    _bootState = 'opening';
    await playChapterOpening();
  }

  // 7) 进入 ready（编排插件接管 scenario 的前提）
  const finalBoot = {
    status: 'ready',
    stage: 'ready',
    chatId,
    openedAt: Date.now(),
    openingDone: (sessionStage === 'resumption_start'),
    sessionType: sessionStage,
    restored,
    rebuilt,
    readyAt: Date.now(),
  };
  writeBoot(finalBoot);
  _bootState = 'ready';
  notifyBootStage('ready', '故事已就绪');
  // 短暂保留遮罩一帧再隐藏（避免闪烁）
  setTimeout(function () { notifyBootStage('ready', ''); }, 400);

  console.log('[tf_story] boot ready:', JSON.stringify({ sessionType: sessionStage, restored, rebuilt, count }));

  // 8) 应用编排模式（编排插件会自己再确认 boot ready）
  await applyOrchestrationMode();
  return sessionStage;
}

// boot 未就绪时拦截所有生成（阻止官方开场白/第一个角色自动发言）
tavo.plugin.on('generation:prepare', async (event) => {
  if (_bootState !== 'ready') {
    // boot 未完成：把请求文本置空阻断（tavo 会忽略无效文本继续，但至少不注入编排上下文）
    try { event.text = ''; } catch (e) {}
  }
});

// 官方首条消息落地即删（message:added 里做二次保险）
tavo.plugin.on('message:added', async (event) => {
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

tavo.plugin.on('chat:opened', async () => {
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
tavo.plugin.on('message:added', async (event) => {
  if (!event || !event.message) return;
  if (event.message.role !== 'user') return; // 只在用户发言后判定
  // boot 未完成时不判定（避免官方劫持阶段误判）
  const boot = readBoot();
  if (!boot || boot.status !== 'ready' || !boot.openingDone) return;
  try {
    let count = 0;
    try { count = await tavo.message.count(); } catch (e) {}
    await judgeAndAdvance({ content: event.message.content || '', messageCount: count });
  } catch (e) {
    console.warn('[tf_story] judge failed', e);
  }
});

// 整章推进（复用判定成功分支）：进入下一章或完结进入自由模式。供自动判定与手动指令共用。
async function manualChapterAdvance(chapters, idx, progress) {
  const nextIdx = idx + 1;
  if (nextIdx >= chapters.length) {
    progress.storyCompleted = true;
    progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
    progress.currentChapterIndex = nextIdx;
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.updatedAt = Date.now();
    setProgress(progress);
    tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
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
    try {
      let openingLine = '（场景切换至 ' + (nextCh.title || '下一章') + '）';
      if (nextCh.openingLine) openingLine = nextCh.openingLine;
      await tavo.message.append({ content: openingLine, hidden: false });
    } catch (e) {}
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

tavo.plugin.on('input:beforeSend', async (event) => {
  if (cfgGet('enabled', true) === false) return;
  const text = String((event && event.text) || '').trim();
  if (!/^@(事件进度检测\s*下个?事件|下个?事件|下个?章节)/.test(text)) return;
  try { if (event && typeof event.cancel === 'function') event.cancel(); } catch (e) {}
  tavo.utils.toast('事件推进指令处理中…');
  advanceManually(text).catch(err => console.warn('[tf_story] manual advance failed', err));
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