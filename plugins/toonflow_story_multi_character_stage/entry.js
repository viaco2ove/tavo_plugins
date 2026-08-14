// toonflow_story_multi_character_stage - entry.js
// 角色编排插件（对齐 fixDB.prompts.ts 的 story_orchestrator 人设）
// 基于群聊的场景模式编排：NPC优先、@角色名指名发言、每轮只推一小步。

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

  // 设置 responseMode = 场景模式（即 design.md 效果）
  try {
    await tavo.chat.update({
      responseMode: cfg.responseMode,
      overrideScenario: getScenarioPrompt(),
    });
  } catch (e) {
    console.warn('[mcs] failed to update chat', e);
  }
});

// 对齐 story_orchestrator 的编排原则
function getScenarioPrompt() {
  return `【发言规则】（对齐 story_orchestrator）
- 由编排师决定下一位发言者，每轮只推进剧情一小步
- NPC优先原则：优先安排 NPC 或万能角色发言推动剧情；仅在无合适 NPC/万能角色，或需描述环境/时间/心理时才用旁白
- 万能角色不能替代角色列表中已存在的具体角色
- 用户以"@角色名 xxx"发言时，必须编排该角色回应，再继续推进
- 不写最终展示给用户的台词，只决定谁发言与动机
- 不复述章节或背景，不连续编排用户发言`;
}

tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || cfg.responseMode !== 'scenario') return;

  // 统一记忆契约：memory 即 tmm，摘要在 tmm.summary
  const memory = tavo.get('tmm') || {};
  const storyState = tavo.get('tf_event') || {};

  let inject = '';

  if (memory.summary) {
    inject += `【记忆】${memory.summary}\n`;
  }

  if (storyState.responseMode) {
    inject += `【发言模式】${storyState.responseMode}\n`;
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
