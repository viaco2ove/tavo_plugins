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
    const edit = tavo.get('tf_story.edit', 'chat') || {};
    const v = edit.orchestration;
    return v === 'system' ? 'system' : 'plugin';
  } catch (e) { return 'plugin'; }
}

// 从 memory_manager 的 tmm_story 读取在场角色动态状态；缺失时回退到 chat 角色
async function buildCastState() {
  let story = null;
  try { story = tavo.get('tmm_story', 'chat'); } catch (e) {}
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

// 生成前：注入在场角色动态状态 + 编排进行中标记
tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (getOrchestration() === 'system') return; // 跟随系统：不注入动态状态、不显示编排中
  try { tavo.set(ORCH_FLAG, true, 'chat'); } catch (e) {}
  try {
    const state = await buildCastState();
    if (state) event.text = state + '\n---\n' + (event.text || '');
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
    const freeMode = (() => { try { return !!tavo.get('tf_progress.sessionFreeMode'); } catch (e) { return false; } })();
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
