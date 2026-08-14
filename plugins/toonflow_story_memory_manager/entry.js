// toonflow_story_memory_manager - entry.js
// 故事记忆管理器（对齐 fixDB.prompts.ts 的 story_memory 人设）
// 提炼长期记忆 + 维护角色动态参数卡；数值必须纯数字；输出结构化 JSON。

'use strict';

const NS = 'tmm';
let refreshing = false;

const MEMORY_RULES = `你是记忆管理器。
你负责管理整个故事的长期记忆，不只更新剧情摘要，还要维护角色动态参数卡。
你要根据当前记忆、最近对话和角色参数卡，提炼对后续剧情真正有用的新信息，合并重复、修正冲突，并识别用户与 NPC 的长期状态变化。
角色动态参数卡也是记忆的一部分；当对话中出现等级变化、物品获得/失去、技能成长、装备变化、身份变化或长期状态变化时，必须输出参数卡 patch。

# 核心工作
1. 剧情长期记忆汇总：基于历史摘要与最新对话，提炼具备长期剧情价值的信息；合并重复、删除临时无效信息。
2. 玩家&NPC动态参数卡维护：出现以下变化时必须生成对应补丁——等级/经验/HP/MP/金币/道具/技能/装备/身份/人际关系/当前行为。
3. NPC 当前行为：为每个在场 NPC 维护"当前行为"，写入 role_key_information 字段末尾，格式：【当前行为】在{地点}{动作}；每轮覆写，原有身份备注不可丢失。role_type 为 general/narrator 的不写。

# 数值计算公式强制规则（所有数值必须输出纯数字，禁止"满、充盈、恢复、提升"等文字替代）
- 满血HP = 100 + 等级*10 + 道具/技能加成
- 满蓝MP = 100 + 等级*10 + 道具/技能加成
- 满足睡觉/休息/服药等恢复场景，直接将 hp/mp 改为满血满蓝纯数字，恢复描述文字存入 other 字段
- 经验：exp 累加；exp ≥ next_level_exp 触发升级，next_level_exp = 等级*100；升级后按满血满蓝重算

# 输出格式硬性约束
仅输出单一 JSON 对象，无前后文字/注释/代码块。
JSON 顶层固定字段：
- summary：字符串，本轮剧情精简长期摘要
- facts：字符串数组，永久生效客观事实
- tags：字符串数组，剧情/角色/场景/状态标签
- player_card_patch：对象，玩家参数补丁，无变更传 {}
- npc_card_patches：对象，key 为 NPC 名，value 为补丁，无变更传 {}
- dynamic_world_global_background：字符串，动态全局背景，务必每次返回

角色补丁仅允许字段：raw_setting, personality, appearance, voice, skills, items, equipment, other, gender, age, level, level_desc, exp, next_level_exp, hp, mp, money, role_key_information
数值字段(age/level/exp/next_level_exp/hp/mp/money)必须为纯数字，禁止中文替代；状态感受/模糊变化统一存 other。`;

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

// 统一记忆契约：tmm = { summary, facts, tags, cards:{player,npcs}, dynamic_world_global_background, turnsSinceRefresh, updatedAt }
function defaultState() {
  return {
    summary: '',
    facts: [],
    tags: [],
    cards: { player: {}, npcs: {} },
    dynamic_world_global_background: '',
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

    const cur = tavo.get(NS) || defaultState();

    const prompt = `${MEMORY_RULES}

【世界背景】
${cfg.worldSetting || '无'}

【最近对话】
${recentDialogue.map(d => `${d.role}: ${d.content}`).join('\n')}

【当前记忆】
摘要: ${cur.summary}
事实: ${cur.facts.join('; ')}
角色卡: ${JSON.stringify(cur.cards)}
`;

    const result = await tavo.generate(prompt, { context: false });

    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('[tmm] parse failed', e);
    }

    if (parsed) {
      const state = tavo.get(NS) || defaultState();

      if (parsed.summary) state.summary = String(parsed.summary).slice(0, 500);
      if (Array.isArray(parsed.facts)) {
        const newFacts = parsed.facts.filter(f => !state.facts.includes(f));
        state.facts = [...state.facts, ...newFacts].slice(-cfg.factCap);
      }
      if (Array.isArray(parsed.tags)) {
        const newTags = parsed.tags.filter(t => !state.tags.includes(t));
        state.tags = [...state.tags, ...newTags].slice(-cfg.tagCap);
      }
      // 合并角色参数卡补丁
      if (parsed.player_card_patch && typeof parsed.player_card_patch === 'object'
          && Object.keys(parsed.player_card_patch).length) {
        state.cards.player = { ...state.cards.player, ...parsed.player_card_patch };
      }
      if (parsed.npc_card_patches && typeof parsed.npc_card_patches === 'object') {
        for (const [name, patch] of Object.entries(parsed.npc_card_patches)) {
          if (patch && typeof patch === 'object') {
            state.cards.npcs[name] = { ...(state.cards.npcs[name] || {}), ...patch };
          }
        }
      }
      if (typeof parsed.dynamic_world_global_background === 'string') {
        state.dynamic_world_global_background = parsed.dynamic_world_global_background;
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

  const inject = `【剧情记忆】
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
