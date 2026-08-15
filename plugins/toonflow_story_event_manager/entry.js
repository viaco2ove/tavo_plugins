// toonflow_story_event_manager - entry.js
// 故事信息面板 + 事件管理 + 故事编辑器 + 编排联动
//
// 职责：
// 1. 故事面板/编辑器 UI 的数据桥（entry 能注册 Hooks，面板通过 sidebar 事件调用）
// 2. 编排联动：默认把群聊切到 scenario 模式交给编排插件；若编排插件未安装则回退 natural
// 3. 故事数据（tf_story 变量）与世界书章节的读写

'use strict';

const NS = 'tf_story';
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
  } catch (e) {
    // tavo.plugin.search 不存在时保守返回 true（不干扰）
    return true;
  }
}

// ---------- 编排模式应用 ----------
async function applyOrchestrationMode() {
  const enabled = cfgGet('enabled', true) !== false;
  const useCustom = cfgGet('useCustomOrchestration', true) !== false;
  if (!enabled || !useCustom) return;

  const installed = await isStageInstalled();
  if (!installed) {
    // 编排插件未安装：回退 natural，不写 overrideScenario
    try {
      await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
      console.log('[tf_story] stage plugin missing -> natural mode');
    } catch (e) {}
    return;
  }
  // 编排插件在：它自己的 chat:opened 会写 scenario + overrideScenario，
  // 这里不重复写，避免覆盖编排插件最新的规则文本。
}

tavo.plugin.on('chat:opened', async () => {
  await applyOrchestrationMode();
});

// ---------- 故事数据读写（供编辑器调用） ----------
// 故事结构（chat 变量 tf_story.edit）：
// {
//   intro: '故事简介',
//   globalBackground: '全局背景',
//   chapters: [
//     { title, openingRole, openingLine, background, content, successCondition,
//       conditionVisible, entryCondition, musicAutoPlay, sort }
//   ]
// }

function defaultEditData() {
  return {
    intro: '',
    globalBackground: '',
    chapters: [{ title: '第 1 章', openingRole: '旁白', openingLine: '', background: '', content: '', successCondition: '', conditionVisible: true, entryCondition: '', musicAutoPlay: false, sort: 1 }],
  };
}

// 把编辑数据同步到世界书：仅写简介+全局背景（constant）
// 章节独立管理在群聊变量 tf_story.edit.chapters，不进世界书
async function syncEditToWorldbook(edit) {
  const chat = await tavo.chat.current();
  if (!chat || !chat.lorebooks?.length) {
    // 没有世界书也无所谓：章节仍在 chat 变量里
    return { ok: true, count: 0, msg: '当前聊天未绑定世界书，仅保存到 chat 变量' };
  }
  const lbId = chat.lorebooks[0].id;
  const lb = await tavo.lorebook.get(lbId);
  if (!lb) return { ok: false, msg: '读取世界书失败' };

  // 保留所有非「简介/全局背景」的原 entry；只重建这两个
  const kept = (lb.entries || []).filter(e => !/^【简介】|^【全局背景】/.test(e.content || ''));
  const rebuilt = [];
  if (edit.intro) {
    rebuilt.push({ name: '故事简介', content: '【简介】' + edit.intro, strategy: 'constant', enabled: true });
  }
  if (edit.globalBackground) {
    rebuilt.push({ name: '全局背景', content: '【全局背景】' + edit.globalBackground, strategy: 'constant', enabled: true });
  }

  try {
    await tavo.lorebook.update({ id: lbId, name: lb.name, entries: [...kept, ...rebuilt] });
    return { ok: true, count: rebuilt.length };
  } catch (e) {
    return { ok: false, msg: String(e && e.message || e) };
  }
}

// 从世界书反向解析：仅读简介+全局背景（章节从 chat 变量读，不从世界书）
async function loadEditFromWorldbook() {
  const chat = await tavo.chat.current();
  if (!chat || !chat.lorebooks?.length) return defaultEditData();
  const lb = await tavo.lorebook.get(chat.lorebooks[0].id);
  if (!lb) return defaultEditData();

  const edit = defaultEditData();
  (lb.entries || []).forEach(e => {
    const c = e.content || '';
    const mi = c.match(/^【简介】([\s\S]*?)(?=\n【|$)/);
    if (mi) edit.intro = mi[1].trim();
    const mb = c.match(/^【全局背景】([\s\S]*?)(?=\n【|$)/);
    if (mb) edit.globalBackground = mb[1].trim();
  });
  return edit;
}

// 章节独立管理 API：get / set / list（供 MCP 脚本读写章节）
function getEdit() {
  try {
    const v = tavo.get(NS + '.edit');
    return v || defaultEditData();
  } catch (e) { return defaultEditData(); }
}
function setEdit(edit) {
  try {
    tavo.set(NS + '.edit', edit, 'chat');
    return true;
  } catch (e) { return false; }
}

// 桥接：面板 -> entry（sidebar 事件做通道）
tavo.plugin.onSidebarAction('tf-story-save-edit', async () => {
  // 章节数据由面板写到 chat 变量 tf_story.edit，这里把简介/背景同步到世界书
  const edit = tavo.get(NS + '.edit');
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  const r = await syncEditToWorldbook(edit);
  tavo.utils.toast(r.ok ? ('已同步到世界书（' + r.count + ' 条）') : ('同步失败：' + r.msg));
});

tavo.plugin.onSidebarAction('tf-story-apply-mode', async () => {
  await applyOrchestrationMode();
  tavo.utils.toast('编排模式已按配置应用');
});