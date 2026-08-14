// toonflow_story_memory_manager - entry.js
// 故事记忆管理器：异步提炼剧情记忆，注入上下文到生成

'use strict';

const NS = 'tmm';
let refreshing = false;

const SYSTEM_RULES = `你是记忆管理器。
根据当前对话提炼剧情摘要、关键事实和标签。

输出 JSON 格式：
{
  "summary": "剧情摘要",
  "facts": ["事实1", "事实2"],
  "tags": ["标签1", "标签2"]
}

要求：
- summary 简洁，50字以内
- facts 只记录长期有效信息
- tags 分类：角色、场景、事件、状态`;

function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  return {
    enabled: get('enabled', true) !== false,
    refreshInterval: Number(get('refreshInterval', 3)) || 3,
    factCap: Number(get('factCap', 12)) || 12,
    tagCap: Number(get('tagCap', 8)) || 8,
    injectEnabled: get('injectEnabled', true) !== false,
    worldSetting: String(get('worldSetting', '')),
  };
}

function defaultState() {
  return {
    summary: '',
    facts: [],
    tags: [],
    turnsSinceRefresh: 0,
    updatedAt: 0,
  };
}

async function refreshMemory() {
  if (refreshing) return;
  refreshing = true;

  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;

    const messages = await tavo.message.find([-10, -1]);
    const recentDialogue = messages.map(m => ({
      role: m.characterName || m.role,
      content: m.content?.slice(0, 200) || '',
    }));

    const prompt = `${SYSTEM_RULES}

【世界背景】
${cfg.worldSetting || '无'}

【最近对话】
${recentDialogue.map(d => `${d.role}: ${d.content}`).join('\n')}

【当前记忆】
摘要: ${tavo.get(NS + '.summary') || ''}
事实: ${(tavo.get(NS + '.facts') || []).join('; ')}
`;

    const result = await tavo.generate(prompt, { context: false });

    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[tmm] parse failed', e);
    }

    if (parsed) {
      const state = tavo.get(NS) || defaultState();

      if (parsed.summary) state.summary = parsed.summary.slice(0, 200);
      if (Array.isArray(parsed.facts)) {
        const newFacts = parsed.facts.filter(f => !state.facts.includes(f));
        state.facts = [...state.facts, ...newFacts].slice(-cfg.factCap);
      }
      if (Array.isArray(parsed.tags)) {
        const newTags = parsed.tags.filter(t => !state.tags.includes(t));
        state.tags = [...state.tags, ...newTags].slice(-cfg.tagCap);
      }

      state.turnsSinceRefresh = 0;
      state.updatedAt = Date.now();
      tavo.set(NS, state, 'chat');
    }
  } catch (e) {
    console.warn('[tmm] refresh failed', e);
  } finally {
    refreshing = false;
  }
}

tavo.plugin.on('chat:opened', async () => {
  if (!tavo.get(NS)) {
    tavo.set(NS, defaultState(), 'chat');
  }
});

tavo.plugin.on('message:added', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || event.message?.role === 'system') return;

  const state = tavo.get(NS) || defaultState();
  state.turnsSinceRefresh = (state.turnsSinceRefresh || 0) + 1;
  tavo.set(NS, state, 'chat');

  if (state.turnsSinceRefresh >= cfg.refreshInterval) {
    await refreshMemory();
  }
});

tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.injectEnabled) return;

  const state = tavo.get(NS);
  if (!state || !state.summary) return;

  const inject = `【记忆上下文】
摘要: ${state.summary}
事实: ${state.facts.join('; ')}
标签: ${state.tags.join(', ')}

`;
  event.text = inject + event.text;
});

tavo.plugin.onSidebarAction('tmm-refresh', async () => {
  await refreshMemory();
  tavo.utils.toast('记忆已刷新');
});

tavo.plugin.onSidebarAction('tmm-inspect', async () => {
  const state = tavo.get(NS);
  await tavo.message.append({
    content: '```\n' + JSON.stringify(state, null, 2) + '\n```',
    hidden: true,
  });
});

tavo.plugin.onSidebarAction('tmm-export', async () => {
  const state = tavo.get(NS);
  await tavo.file.export('memory.json', JSON.stringify(state, null, 2));
});