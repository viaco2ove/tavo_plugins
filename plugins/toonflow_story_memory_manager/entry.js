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

/* =========================================================================
 * 角色参数卡：初始化 / 加载（对齐 toonflow-game-app/src/lib/roleParameterCard.ts）
 * 故事角色在 Toonflow-game 中带一张「静态参数卡」(parameterCardJson)，
 * 由角色设定经 AI 生成。tavo 导入的 CCv3 角色卡把这张参数卡嵌在 description 的
 * 「角色参数卡」```json 块里，本插件在打开聊天时解析并归一化，存入 tmm_story，
 * 供信息面板/事件管理器展示；运行时记忆生成的动态补丁会回流合并，呈现动态参数。
 * ========================================================================= */

const STORY_NS = 'tmm_story';
const STATIC_NS = 'tmm_story_static'; // 受保护的静态基准卡：一次性构建，重启聊天不清空

function scalarText(v) {
  const t = (v == null ? '' : String(v)).trim();
  return (t === 'null' || t === 'undefined') ? '' : t;
}

function numberOrNull(v) {
  const t = scalarText(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function normalizeList(v) {
  if (Array.isArray(v)) return v.map(scalarText).filter(Boolean).slice(0, 24);
  if (typeof v === 'string' && v) {
    return v.split(/[\r\n；;、,，]/).map(scalarText).filter(Boolean).slice(0, 24);
  }
  return [];
}

function detectRoleType(text, hint) {
  let rt = scalarText(hint);
  if (!rt) {
    if (/角色类型\s*[:：]\s*万能角色/i.test(text)) rt = 'general';
    else if (/角色类型\s*[:：]\s*系统角色/i.test(text)) rt = 'system';
  }
  if (!['npc', 'narrator', 'player', 'system', 'general'].includes(rt)) rt = 'npc';
  return rt;
}

const ROLE_TYPE_LABEL = { player: '用户', narrator: '旁白', npc: 'NPC', general: '万能角色', system: '系统角色' };

// 从描述里抽取「角色参数卡」```json {...}``` 块
function extractCardJson(desc) {
  if (!desc) return null;
  const m = desc.match(/角色参数卡[\s\S]*?```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    try { return JSON.parse(m[1].trim()); } catch (e) {}
  }
  const m2 = desc.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m2) {
    try { return JSON.parse(m2[1].trim()); } catch (e) {}
  }
  return null;
}

// 从描述里抽取 **字段**：值 行
function parseFieldMap(desc) {
  const map = {};
  if (!desc) return map;
  scalarText(desc).split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*\*\*([^*]+?)\*\*\s*[:：]\s*(.+?)\s*$/);
    if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
  });
  return map;
}

// 归一化为业务层参数卡（字段顺序与取值规则对齐 roleParameterCard.ts）
function normalizeCard(role, desc) {
  const d = (role && role.data) ? role.data : (role || {});
  const embedded = extractCardJson(d.description || desc || '');
  const source = (embedded && typeof embedded === 'object') ? embedded : {};
  const fm = parseFieldMap(d.description || desc || '');
  const read = (...keys) => {
    for (const k of keys) {
      const v = scalarText(source[k]);
      if (v) return v;
      const fv = scalarText(fm[k.toLowerCase()]);
      if (fv) return fv;
      const dv = scalarText(d[k]);
      if (dv) return dv;
    }
    return '';
  };
  const roleType = detectRoleType((d.description || '') + '\n' + (source.raw_setting || ''), source.role_type || d.roleType);
  const descText = d.description || '';
  let age = numberOrNull(source.age ?? fm['age']);
  if (age == null) { const m = descText.match(/(\d+)\s*岁/); if (m) age = numberOrNull(m[1]); }
  let level = numberOrNull(source.level ?? fm['level']);
  let levelDesc = read('level_desc', 'levelDesc') || '';
  if (level == null) {
    const m = descText.match(/炼气\s*(\d+)\s*层/);
    if (m) { level = numberOrNull(m[1]); if (!levelDesc) levelDesc = '炼气' + m[1] + '层'; }
    else { const m2 = descText.match(/(\d+)\s*级/); if (m2) level = numberOrNull(m2[1]); }
  }
  if (!levelDesc) { const m = descText.match(/炼气\s*\d+\s*层/); if (m) levelDesc = m[0]; }
  let hp = numberOrNull(source.hp ?? fm['hp']);
  if (hp == null) { const m = descText.match(/HP\s*(\d+)/i); if (m) hp = numberOrNull(m[1]); }
  let mp = numberOrNull(source.mp ?? fm['mp']);
  if (mp == null) { const m = descText.match(/MP\s*(\d+)/i); if (m) mp = numberOrNull(m[1]); }
  const money = numberOrNull(source.money ?? fm['money']);
  const exp = numberOrNull(source.exp ?? fm['exp']);
  const next = numberOrNull(source.next_level_exp ?? fm['next_level_exp']);
  let gender = read('gender');
  if (!gender) { if (/男/.test(descText)) gender = '男'; else if (/女/.test(descText)) gender = '女'; }
  return {
    name: read('name') || d.name || '未命名',
    raw_setting: read('raw_setting', 'rawSetting') || scalarText(d.description) || '',
    gender,
    age,
    level: level ?? 1,
    level_desc: levelDesc,
    personality: read('personality'),
    appearance: read('appearance'),
    voice: read('voice'),
    skills: normalizeList(source.skills ?? fm['skills']),
    items: normalizeList(source.items ?? fm['items']),
    equipment: normalizeList(source.equipment ?? fm['equipment']),
    hp: hp ?? 100,
    mp: mp ?? 0,
    money: money ?? 0,
    exp: exp ?? 0,
    next_level_exp: next ?? 0,
    other: normalizeList(source.other ?? fm['other']),
    roleType,
    role_key_information: read('role_key_information', 'information', 'info'),
  };
}

// 从当前聊天读取角色 + persona，构建基准参数卡（纯静态，来自角色 description）
async function buildCharactersFromChat(chat) {
  const chars = chat.characters || [];
  let playerChar = null;
  const personaId = chat.personaId || (chat.persona && chat.persona.id);
  if (personaId) {
    let pf = null;
    try { if (tavo.persona && tavo.persona.get) pf = await tavo.persona.get(personaId); } catch (e) {}
    const pd = pf || {};
    const card = normalizeCard(pf || {}, pd.description);
    card.roleType = 'player';
    playerChar = {
      id: personaId,
      name: (chat.persona && chat.persona.name) || pd.name || '用户',
      roleType: 'player',
      isPersona: true,
      avatar: pd.avatar || '',
      card,
    };
  }
  // chat.characters 仅含 id/name，需拉取完整角色数据才能拿到 avatar/description
  const npcs = await Promise.all(chars.map(async (c) => {
    let full = null;
    try {
      if (tavo.character && tavo.character.get) full = await tavo.character.get(c.id);
    } catch (e) {}
    const d = (full && full.data) ? full.data : (full || c || {});
    return {
      id: c.id,
      name: c.name || d.name || '未命名',
      roleType: d.roleType || c.roleType || 'npc',
      avatar: d.avatar || c.avatar || '',
      card: normalizeCard(full || c, d.description),
    };
  }));
  return (playerChar ? [playerChar] : []).concat(npcs);
}

// 构建 / 修复静态基准卡（写入 STATIC_NS）。
// force=true：仅在"新增角色"上重建，已有角色卡受保护不被覆盖（防止 description 重解析把静态参数清空）。
async function buildStaticStory(force) {
  try {
    if (!tavo.chat || !tavo.chat.current) return null;
    const chat = await tavo.chat.current();
    if (!chat) return null;
    const books = chat.lorebooks || [];
    let synopsis = chat.description || chat.synopsis || '';
    if (!synopsis && books[0] && books[0].entries && books[0].entries[0]) {
      synopsis = books[0].entries[0].content || '';
    }
    const characters = await buildCharactersFromChat(chat);
    // 受保护合并：保留已有角色卡，只补建新角色
    const prev = (force ? (tavo.get(STATIC_NS) || {}) : null);
    const prevById = {};
    (prev && prev.characters || []).forEach(c => { if (c && c.id) prevById[c.id] = c; });
    const merged = characters.map(c => prevById[c.id] || c);
    const staticStory = {
      name: chat.name || '故事信息',
      synopsis: scalarText(synopsis).slice(0, 1200),
      characters: merged,
    };
    tavo.set(STATIC_NS, staticStory, 'chat');
    return staticStory;
  } catch (e) {
    console.warn('[tmm] buildStaticStory failed', e);
    return null;
  }
}

// 打开聊天时：保护静态基准卡（STATIC_NS），重新生成展示层 tmm_story。
// 动态参数（hp/mp/level 等增量）从「静态基准 + 持久化增量 tmm.cards」重新派生，
// 而不是被清空成空白——即"重新生成而非清空"。
async function initStory() {
  try {
    let staticStory = tavo.get(STATIC_NS);
    if (!staticStory || !staticStory.characters || !staticStory.characters.length) {
      staticStory = await buildStaticStory(false);
    }
    if (!staticStory) return;
    // 展示层 = 静态基准的深拷贝，立即生效
    const display = JSON.parse(JSON.stringify(staticStory));
    tavo.set(STORY_NS, display, 'chat');
    // 把持久化的动态增量立刻合并回来，避免展示层短暂空白/清零
    syncStoryDynamicCards();
  } catch (e) {
    console.warn('[tmm] initStory failed', e);
  }
}

// 记忆刷新后把动态参数补丁回流进 tmm_story，让信息面板展示实时数值
function syncStoryDynamicCards() {
  try {
    const story = tavo.get(STORY_NS);
    if (!story || !story.characters) return;
    const mem = tavo.get(NS) || defaultState();
    const player = (mem.cards && mem.cards.player) ? mem.cards.player : {};
    const npcs = (mem.cards && mem.cards.npcs) ? mem.cards.npcs : {};
    let changed = false;
    story.characters.forEach((ch) => {
      let patch = null;
      if (ch.roleType === 'player' && Object.keys(player).length) patch = player;
      else if (npcs[ch.name] && Object.keys(npcs[ch.name]).length) patch = npcs[ch.name];
      if (patch) {
        ch.card = { ...ch.card, ...patch };
        changed = true;
      }
    });
    if (changed) tavo.set(STORY_NS, story, 'chat');
  } catch (e) {}
}

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
      // 把动态参数补丁回流到 tmm_story，供信息面板展示实时数值
      syncStoryDynamicCards();
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
  // 打开聊天：保护静态基准卡，重新生成展示层（动态参数从基准 + 持久化增量重新派生）
  await initStory();
});

tavo.plugin.on('chat:updated', async () => {
  // 聊天角色/绑定变化时：仅补建新增角色（已有角色静态卡受保护），再重新生成展示层
  await buildStaticStory(true);
  await initStory();
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
