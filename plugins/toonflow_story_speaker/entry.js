// toonflow_story_speaker - entry.js
// 角色发言插件（全面对齐 fixDB.prompts.ts 的 story_speaker）
//
// Tavo 群聊场景模式下，模型自己兼任「编排师 + 发言者」。本插件在 generation:prepare
// 把【在场角色当前动态状态】注入请求（来自 memory_manager 维护的 tmm_story 参数卡），
// 让模型写出贴合当前等级/血量/蓝量/当前行为的角色台词，而不是只凭静态人设。

'use strict';

const NS = 'tf_speaker';
const ORCH_FLAG = 'tf_orch.active';

const ROLE_LABEL = {
  player: '用户', npc: '一般角色', narrator: '旁白',
  system: '系统角色', general: '万能角色',
};

// Tavo 的 tavo.get(name) 返回包装对象 {target,name,found,value}，真实数据在 .value。
// 不解包会导致 edit.chapters / story.characters 全是 undefined（表现为「配置被清空、参数为空」）。
function readChatVar(name) {
  let v = null;
  try { v = tavo.get(name, 'chat'); } catch (e) { return null; }
  let guard = 0;
  while (v && typeof v === 'object' && !Array.isArray(v)
         && Object.prototype.hasOwnProperty.call(v, 'value')
         && Object.prototype.hasOwnProperty.call(v, 'name')
         && guard < 5) {
    if (v.found === false) return null;
    v = v.value;
    guard += 1;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s); } catch (e) { return v; }
    }
  }
  return v;
}

function getConfig() {
  const get = (k, fallback) => {
    try {
      const v = tavo.plugin.config.get(k);
      return v !== undefined && v !== null ? v : fallback;
    } catch (e) {
      return fallback;
    }
  };
  return {
    enabled: get('enabled', true) !== false,
    temperature: parseFloat(get('temperature', 0.7)) || 0.7,
    maxTokens: parseInt(get('maxTokens', 220)) || 220,
  };
}

// 群聊编排设置（来自 event_manager 维护的 tf_story.edit.orchestration）
// 'system' = 跟随系统（不接管、不注入动态状态、不显示编排中）；缺省 / 'plugin' = 插件接管
function getOrchestration() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    const v = edit.orchestration;
    return v === 'system' ? 'system' : 'plugin';
  } catch (e) { return 'plugin'; }
}

// 台词数量：发给 agent 的「最近对话」条数（对齐 Toonflow recent_dialogue 入参），默认 20
function getLineCount() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    const v = parseInt(edit.lineCount, 10);
    return (v >= 1) ? v : 20;
  } catch (e) { return 20; }
}

// 从 memory_manager 的 tmm_story 读取在场角色动态状态；缺失时回退到 chat 角色
async function buildCastState() {
  let story = null;
  try { story = readChatVar('tmm_story') || readChatVar('tmm_story_static'); } catch (e) {}
  let characters = (story && Array.isArray(story.characters)) ? story.characters : null;

  if (!characters) {
    try {
      const chat = await tavo.chat.current();
      const chars = chat?.characters || [];
      characters = await Promise.all(chars.map(async (c) => {
        let full = null;
        try { if (tavo.character && tavo.character.get) full = await tavo.character.get(c.id); } catch (e) {}
        const d = (full && full.data) ? full.data : (full || c || {});
        return { name: c.name || d.name || '未命名', roleType: d.roleType || c.roleType || 'npc', card: {} };
      }));
    } catch (e) {}
  }
  if (!characters || !characters.length) return '';

  let block = '\n【在场角色当前状态】（对齐 story_speaker 动态参数卡，来自记忆）\n';
  for (const ch of characters) {
    const c = ch.card || {};
    if (ch.roleType === 'narrator') {
      block += '- 旁白（系统旁白）：负责场景描述 / 时间流转 / 效果说明，不扮演具体人物，无战斗数值\n';
      continue;
    }
    const label = ROLE_LABEL[ch.roleType] || ch.roleType || 'npc';
    const parts = [ch.name + '(' + label + ')'];
    if (c.level != null && c.level !== '') parts.push('Lv.' + c.level);
    if (c.level_desc) parts.push(c.level_desc);
    if (c.hp != null && c.hp !== '') parts.push('HP' + c.hp);
    if (c.mp != null && c.mp !== '') parts.push('MP' + c.mp);
    if (c.role_key_information) parts.push('当前:' + String(c.role_key_information).slice(0, 48));
    block += '- ' + parts.join(' | ') + '\n';
  }
  block += '（请严格按上面各角色的当前状态与身份发言，推进剧情一小步）\n';
  return block;
}

// 当前事件（对齐 story_speaker 的 [当前事件] currStageSummary）：
// 取当前进度所在章节的标题 + 本章内容大纲，作为本轮发言唯一依据。
async function getCurrentEventText() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    const chapters = edit.chapters || [];
    let prog = null;
    try { prog = readChatVar('tf_progress'); } catch (e) {}
    const idx = (prog && typeof prog.currentChapterIndex === 'number') ? prog.currentChapterIndex : 0;
    const ch = chapters[idx];
    if (!ch) return '';
    let s = '【当前章节】' + (ch.title || '未命名') + '\n';
    s += (ch.content || '').slice(0, 1500);
    return s;
  } catch (e) { return ''; }
}

// 最近对话（对齐 story_speaker 的 [最近对话] recent_dialogue）：取最后 n 条消息，格式化为「角色名：内容」。
async function buildRecentDialogue(n) {
  try {
    const count = await tavo.message.count();
    if (!count) return '';
    const start = Math.max(0, count - n);
    const msgs = await tavo.message.find([start, count - 1]);
    const lines = (msgs || []).map((m) => {
      const name = m.characterName || (m.role === 'user' ? '用户' : '旁白');
      return name + '：' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 200);
    });
    return lines.join('\n');
  } catch (e) { return ''; }
}

// 开场白生成拦截（对齐你说的流程：发言插件 → 发言agent → 语音合成）
// 当 event_manager 设置了 tf_story.opening.pending=true 时，接管本轮生成
// 1. 用 openingText + openingRole 生成台词
// 2. 写入消息列表（带角色名）
// 3. 取消本轮 LLM 生成（event.cancel()）
// 4. 触发语音播放（tavo.message.append 后 Tavo App 自动播放）
tavo.plugin.on('generation:beforeGenerate', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (getOrchestration() === 'system') return;

  // 读开场白待处理标记（event_manager 在 opening 状态设置）
  let openingPending = false;
  try {
    let v = tavo.get('tf_story.opening', 'chat');
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) {
      v = v.value; guard++;
    }
    if (v && typeof v === 'object' && v.pending === true) openingPending = true;
  } catch (e) {}

  if (!openingPending) return;
  console.log('[tf_speaker][beforeGenerate] 开场白拦截，开始生成…');

  // 清除标记
  try { tavo.set('tf_story.opening', { pending: false }, 'chat'); } catch (e) {}

  // 读取开场白内容
  let openingRole = '旁白', openingText = '';
  try {
    const edit = readChatVar('tf_story.edit') || {};
    const chapters = edit.chapters || [];
    let prog = null;
    try { prog = readChatVar('tf_progress'); } catch (e) {}
    const idx = (prog && typeof prog.currentChapterIndex === 'number') ? prog.currentChapterIndex : 0;
    const ch = chapters[idx];
    if (ch) {
      openingRole = ch.openingRole || '旁白';
      openingText = ch.openingLine || '';
    }
  } catch (e) {}

  if (!openingText) {
    console.log('[tf_speaker][beforeGenerate] openingText 为空，跳过');
    return;
  }

  // 查找角色 id
  let chat = null;
  try { chat = await tavo.chat.current(); } catch (e) {}
  const chars = (chat && chat.characters) || [];
  const findChar = (name) => chars.find(c => c.name === name)
    || (name === '旁白' || name === 'narrator' ? chars.find(c => c.name === '旁白') : null);
  const narratorChar = chars.find(c => c.name === '旁白') || null;
  const charEntry = findChar(openingRole) || narratorChar;

  // 取消 LLM 生成（开场白直接写死）
  try {
    if (event && typeof event.cancel === 'function') {
      event.cancel();
      console.log('[tf_speaker][beforeGenerate] 已取消本轮 LLM 生成');
    }
  } catch (e) {}

  // 写入消息列表（Tavo App 监听 message:added 后自动触发语音播放）
  // ⚠️ 关键：不传 characterId（旁白时为 undefined），
  //    否则 UI 用 characterId 查头像 fallback 成第一个角色卡名字。
  //    只传 characterName，让 UI 完全用名字显示。
  const speakerAppendOpts = {
    role: 'assistant',
    characterName: openingRole,
    content: openingText,
    hidden: false,
  };
  if (charEntry && charEntry.id !== undefined) {
    speakerAppendOpts.characterId = charEntry.id;
  }
  try {
    await tavo.message.append(speakerAppendOpts);
    console.log('[tf_speaker][beforeGenerate] 已写入开场白: ' + openingRole + '：' + openingText.slice(0, 40));
  } catch (e) {
    console.warn('[tf_speaker][beforeGenerate] 写入开场白失败', e);
  }
});

// 生成前：注入对齐 Toonflow story_speaker 的「入参」（当前事件 / 最近对话 / 在场角色当前状态）+ 编排标记
tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (getOrchestration() === 'system') return; // 跟随系统：不注入动态状态、不显示编排中
  try { tavo.set(ORCH_FLAG, true, 'chat'); } catch (e) {}
  try {
    const n = getLineCount();
    const [evt, dlg, cast] = await Promise.all([
      getCurrentEventText(),
      buildRecentDialogue(n),
      buildCastState(),
    ]);
    let block = '【角色发言器入参】（对齐 Toonflow story_speaker，本轮需基于以下信息决定发言角色并生成其台词）\n';
    block += '## 当前事件\n' + (evt || '（无）') + '\n';
    block += '## 最近对话（最近 ' + n + ' 条）\n' + (dlg || '（无）') + '\n';
    block += '## 在场角色当前状态\n' + (cast || '（无）') + '\n';
    event.text = block + '\n---\n' + (event.text || '');
  } catch (e) {
    console.warn('[tf_speaker] prepare failed', e);
  }
});

tavo.plugin.on('generation:success', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });
tavo.plugin.on('generation:error', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });
tavo.plugin.on('generation:cancelled', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });

// 侧边栏：测试生成一句当前角色台词（隐藏消息）
tavo.plugin.onSidebarAction('speaker-test', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) { tavo.utils.toast('发言插件未启用'); return; }
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) { tavo.utils.toast('当前聊天无角色'); return; }
    const char = await tavo.character.get(chat.characters[0].id);
    const state = await buildCastState();

    // 自由模式：放宽台词长度（用户可自由讨论/提问/闲聊）
    const freeMode = (() => { try { return !!(readChatVar('tf_progress') || {}).sessionFreeMode; } catch (e) { return false; } })();
    const lengthHint = freeMode ? '40~150字，2~4句（自由模式可稍长）' : '40~80字，最多2句';

    const prompt = (state ? state + '\n' : '') +
      `请以 ${char?.name || '角色'} 的身份，基于当前状态生成一句自然台词（${lengthHint}）。` +
      (freeMode ? '\n（当前是自由模式，可根据用户提问自由回应，不必推进剧情。）' : '');
    const speech = await tavo.generate(prompt, {
      context: false,
      settings: { temperature: cfg.temperature, maxCompletionTokens: cfg.maxTokens },
    });
    await tavo.message.append({ content: speech, hidden: true, characterId: char?.id });
    tavo.utils.toast('已生成测试台词（隐藏）');
  } catch (e) {
    tavo.utils.toast('生成失败：' + (e && e.message ? e.message : e));
  }
});

// 侧边栏：列出当前角色（隐藏消息）
tavo.plugin.onSidebarAction('speaker-char', async () => {
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) { tavo.utils.toast('当前聊天无角色'); return; }
    let msg = '【当前角色列表】\n';
    for (const c of chat.characters) {
      const char = await tavo.character.get(c.id);
      msg += `- ${char?.name || c.name}（${char?.personality ? char.personality.slice(0, 30) : '无设定'}）\n`;
    }
    await tavo.message.append({ content: msg, hidden: true, characterId: chat.characters[0].id });
  } catch (e) {
    console.warn('[tf_speaker] list failed', e);
  }
});
