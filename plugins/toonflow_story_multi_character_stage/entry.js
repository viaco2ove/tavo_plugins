// toonflow_story_multi_character_stage - entry.js
// 角色编排插件：基于群聊的场景模式编排

'use strict';

const NS = 'mcs_stage';

function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  return {
    enabled: get('enabled', true) !== false,
    responseMode: get('responseMode', 'scenario'),
    npcAuto: get('npcAuto', true) !== false,
  };
}

tavo.plugin.on('chat:opened', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  // 设置 responseMode
  try {
    await tavo.chat.update({
      responseMode: cfg.responseMode,
      overrideScenario: getScenarioPrompt(),
    });
  } catch (e) {
    console.warn('[mcs] failed to update chat', e);
  }
});

function getScenarioPrompt() {
  return `【发言规则】
- 由主持人决定下一位发言者
- 每轮只让一个角色发言
- 优先回应用户最近的输入
- 保持对话自然流畅`;
}

tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || cfg.responseMode !== 'scenario') return;

  // 读取记忆
  const memory = tavo.get('tmm') || {};
  const storyState = tavo.get('tf_story') || {};

  let inject = '';

  if (memory.meta?.summary) {
    inject += `【记忆】${memory.meta.summary}\n`;
  }

  if (storyState.current_chapter !== undefined && storyState.chapters?.length) {
    const ch = storyState.chapters[storyState.current_chapter];
    inject += `【当前章节】${ch?.name || ''}\n`;
  }

  if (inject) {
    event.text = inject + event.text;
  }
});

tavo.plugin.onSidebarAction('mcs-toggle', async () => {
  const cfg = getConfig();
  await tavo.chat.update({
    responseMode: cfg.enabled ? cfg.responseMode : 'natural',
  });
  tavo.utils.toast(cfg.enabled ? '编排已开启' : '编排已关闭');
});

tavo.plugin.onSidebarAction('mcs-area', async () => {
  const chat = await tavo.chat.current();
  await tavo.message.append({
    content: `当前模式: ${getConfig().responseMode}\n在场角色: ${(chat?.characters || []).map(c => c.name).join(', ')}`,
    hidden: true,
  });
});