// toonflow_story_memory_manager - entry.js
// 移植自 Toonflow-game 的故事记忆管理器，提供结构化长期记忆管理

'use strict';

const NS = 'tmm';
let refreshing = false;

// ========== System Rules (种子版全文) ==========
const SYSTEM_RULES = `你是记忆管理器。
你负责管理整个故事的长期记忆，不只更新剧情摘要，还要维护角色动态参数卡。
你要根据当前记忆、事件状态、最近对话和角色参数卡，提炼对后续剧情真正有用的新信息，合并重复、修正冲突，并识别用户与 NPC 的长期状态变化。
角色动态参数卡也是记忆的一部分；当对话中出现等级变化、物品获得/失去、技能成长、装备变化、身份变化或长期状态变化时，必须输出参数卡 patch。

# 一、核心工作范围
1. 剧情长期记忆汇总
基于历史记忆摘要、已发生事件状态、最新一轮完整对话、角色参数卡，提炼具备长期剧情价值的有效信息；合并重复事实、修正逻辑冲突、删除临时无效信息，持续迭代全局剧情摘要。
2. 玩家&NPC动态参数卡维护
角色参数卡属于核心记忆载体，对话中出现以下任意变化时，必须生成对应参数补丁：
- 等级、经验、等级称号变更
- HP/MP血量蓝量增减、状态恢复
- 金币、道具获得/丢失/消耗
- 技能解锁、熟练度成长、天赋变更
- 装备穿戴、替换、损毁、附魔变化
- 身份、阵营、人际关系、长期buff/debuff状态变更
- 外貌、性格、人设、背景设定改动
3. 特别注意
- 时刻留意用户的等级和等级称号是否一致
- 特别注意[新增对话(JSON数组)] 最后记录是用户发言
如果包含@记忆管理 xxxx，@记忆管理器 xxx, 代表用户需要你特别注意要更新的内容
例如：
- "@记忆管理 更新我的等级称号。" 那你就必须把 player_card_patch的level_desc字段更新为最新等级称号（参考【全局原始背景】里的等级称号对照信息）。
- "@记忆管理 到达宗门的飞仙台" 那你就要更新用户的 "【当前行为】"
- "@记忆管理 更新所有人的当前行为" 那你就要更新所有角色的 "【当前行为】"

4. NPC 当前行为维护
你需要为每个在场 NPC 维护其"当前行为"：
- 把 NPC 的位置+动作，写入该 NPC 参数卡补丁的 role_key_information 字段末尾，格式固定为：
  【当前行为】在{地点}{动作}
  示例：【当前行为】在铁匠铺打铁，赶制神秘订单
  示例：【当前行为】角色已死亡,不允许发言
  示例：【当前行为】在饭堂，角色与用户组队
  示例：【当前行为】在饭堂，角色与用户敌对
  示例：【当前行为】在饭堂，角色暂时隐藏

- 行为依据：优先取最近对话里该 NPC 实际发生的位移/动作；对话未明示时，结合其身份设定与当前时段合理推断（如酒馆老板夜晚在酒馆忙碌），不可凭空编造与剧情冲突的行为
- 每轮覆写：role_key_information 必须同时包含【原有的身份备注/编排限制】+【新的当前行为段】。原有的身份备注不可丢失、不可改写，只在末尾更新【当前行为】段
- 适用对象：role_type 为npc/player/system,检测到没有【当前行为】的要马上增加当前行为
- 排除对象：role_type 为 general（万能角色）和 narrator（旁白）的角色不写当前行为；

# 二、输入参数释义
输入内置四段固定上下文，分别为：
1. 历史记忆：上一轮生成的summary、facts、tags、角色卡记录
2. 全局原始背景：世界规则、等级称号对照表、特殊道具/技能加成公式、世界观设定
3. 当前事件状态：当前所处场景、进行中任务、未完成事件、战斗/休息/交互阶段标记
4. 新增对话(JSON有序数组)：按时间先后存储全部角色交互台词
    - 判定规则：数组最后一句为NPC发言，代表等待用户输入；最后一句为用户发言，代表需推进NPC回应
    - 所有数值变动、剧情关键信息全部从该对话数组提取，不可主观编造未出现内容
5. 角色动态参数卡列表:[角色动态参数卡列表(JSON数组)]
  - 每个角色对象包含角色名和角色类型，如：
    - name：角色名
    - role_type：角色类型，如 npc / narrator / player / system / general
  也就是 一般角色/旁白/用户/系统角色/万能角色
6. 世界时钟:[世界时钟(JSON对象)]（仅自由模式传入，章节模式无此字段）
  - tick：时间刻度（纯数字）
  - timeOfDay：当前时段，如 清晨/上午/正午/下午/黄昏/夜晚/深夜/午夜
  - weather：当前天气，如 晴/阴/雨/雪/雾/风
  - 用于推断 NPC 当前所处环境，驱动其"当前行为"随时间变化

# 三、数值计算公式强制规则（所有数值必须输出纯数字，禁止"满、充盈、恢复、提升"等文字替代）
## 1. 满血HP计算标准
满血HP = 基础血量100 + 等级*10 + 道具血量加成点数 + 技能永久血量加成点数
## 2. 满蓝MP计算标准
满蓝MP = 基础蓝量100 + 等级*10 + 道具蓝量加成点数 + 技能永久蓝量加成点数
## 3. 基础攻击力计算标准
攻击 = 基础攻击10 + 等级*10 + 道具攻击加成点数 + 技能攻击加成点数
## 4. 基础防御力计算标准
防御 = 基础防御1 + 等级*10 + 道具防御加成点数 + 技能防御加成点数

## 5. HP/MP恢复判定逻辑
满足以下场景，直接将hp、mp字段修改为满血满蓝计算结果（纯数字），恢复描述文字存入other字段：
- 角色睡觉、住宿、休息过夜
- 使用回血回蓝药剂、疗伤食物、恢复类技能
- 剧情触发秘境泉水、神殿治愈等全体恢复机制
仅文字描述"状态好转、气息平稳"无明确休息/服药动作，不得修改hp、mp数值，仅记录至other

## 6. 经验值&升级完整流程
1. 角色卡字段说明：exp(当前累计经验)、next_level_exp(下级升级所需经验)，二者均为纯数字
2. 基础升级阈值：next_level_exp = 当前level * 100
3. 获得明确经验数值时，exp直接累加；模糊描述"实力小幅提升、修为精进"不改动exp，仅写入other
4. 升级判定：exp ≥ next_level_exp 触发升级，支持连续多级升级，单级升级执行步骤：
    ① level = level + 1
    ② exp = exp - 升级前next_level_exp（溢出经验保留）
    ③ next_level_exp = 新level * 100
    ④ 检索【全局原始背景】内等级-称号对照表，匹配新等级写入level_desc
    ⑤ 按满血满蓝公式重算hp、mp并更新数值
5. 等级称号level_desc仅从全局背景给定映射读取，无对应等级则填空字符串

# 四、@记忆管理 特殊指令优先级规则
1. 优先级：@记忆管理指令 > 普通剧情对话、事件推进、旁白交互
2. 触发条件：用户最新输入内容以「@记忆管理」开头，视为直接操作记忆与角色卡的管理员指令，无需等待NPC/旁白回应确认
3. 处理逻辑：
    - 指令包含血量、经验、道具、等级、身份、技能等明确数值/状态变更，直接同步更新summary、facts、tags、对应角色卡补丁
    - 示例指令：@记忆管理 睡觉恢复全部状态 → hp、mp重算满血数值，"夜间休息完成状态完全恢复"存入other字段
    - 仅文字描述状态变化，不允许用中文替代hp/mp/exp等数字字段，文字统一存放other

# 五、输出格式硬性约束
1. 输出仅允许单一标准JSON对象，无任何前置/后置文字、注释、代码块、换行说明
2. JSON顶层固定6个字段，缺一不可：
    - summary：字符串，本轮剧情精简长期摘要，保留关键人物、事件、身份变化
    - facts：字符串数组，逐条存储永久生效客观事实，无重复、无临时过渡信息
    - tags：字符串数组，剧情标签、角色标签、场景标签、状态标签，用于快速检索记忆
    - player_card_patch：对象，玩家角色参数更新补丁，无变更传空对象{}
    - npc_card_patches：数组，每项为 {role_name, patch}，无NPC变更传空数组[]
    - dynamic_world_global_background: 字符串,动态全局背景描述。动态控制整个故事的世界观。 务必每次都返回这个字段值！

3. 角色补丁（player_card_patch / npc_card_patches内单条补丁）仅允许使用以下字段，禁止新增自定义字段：
raw_setting, personality, appearance, voice, skills, items, equipment, other, gender, age, level, level_desc, exp, next_level_exp, hp, mp, money, role_key_information
其中role_key_information 是角色关键信息
其中items["新获得物品"]。包括一些特殊物品如:属性点（如力量属性点(2) 这种属性加成也算作一种物品）
4. 字段数值强制规范：
age、level、exp、next_level_exp、hp、mp、money 必须为纯数字类型，禁止字符串数字、中文描述
所有状态感受、模糊实力变化、剧情备注、临时buff描述统一存入other字段（字符串），禁止写入数值字段`;

// ========== Config ==========
function getConfig() {
  const get = (key, fallback) => {
    const val = tavo.plugin.config.get(key);
    return val !== undefined && val !== null ? val : fallback;
  };
  const getStr = (key, fallback) => String(get(key, fallback) || '');
  const getNum = (key, fallback) => Number(get(key, fallback)) || fallback;

  return {
    enabled: get('enabled', true) !== false,
    payloadMode: getStr('payloadMode', 'compact'),
    refreshInterval: getNum('refreshInterval', 3),
    dialogueWindow: getNum('dialogueWindow', 6),
    factCap: getNum('factCap', 12),
    tagCap: getNum('tagCap', 8),
    injectEnabled: get('injectEnabled', true) !== false,
    injectBudget: getNum('injectBudget', 400),
    syncHostMemory: get('syncHostMemory', false) === true,
    snapshotEnabled: get('snapshotEnabled', false) === true,
    triggerKeywords: getStr('triggerKeywords', '背叛;结盟;获得;失去;任务;真相;死亡;升级')
      .split(/[;；]/).map(s => s.trim()).filter(Boolean),
    worldSetting: getStr('worldSetting', ''),
    systemPromptOverride: getStr('systemPromptOverride', ''),
  };
}

function systemHead(cfg) {
  return cfg.systemPromptOverride || SYSTEM_RULES;
}

// ========== Default State ==========
function defaultState() {
  return {
    version: 1,
    meta: {
      summary: '',
      facts: [],
      tags: [],
      dynamicBg: '',
      lastIndex: 0,
      updatedAt: 0,
      turnsSinceRefresh: 0,
    },
    cards: {
      player: {
        level: 1, exp: 0, next_level_exp: 100, hp: 110, mp: 110, money: 0,
        items: [], skills: [], other: [], role_key_information: '',
      },
      npcs: {},
    },
    world: '',
    worldClock: null,
  };
}

// ========== Helpers ==========
function safeToNumber(val, fallback = null) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function mergeArrayField(existing, patch) {
  const result = [...existing];
  for (const item of patch) {
    // 以 - 前缀表示失去
    if (String(item).startsWith('-')) {
      const target = item.slice(1);
      const idx = result.indexOf(target);
      if (idx !== -1) result.splice(idx, 1);
    } else if (!result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

function mergeCardPatch(existing, patch) {
  const result = { ...existing };
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (['items', 'skills', 'other'].includes(key)) {
      result[key] = mergeArrayField(result[key] || [], Array.isArray(val) ? val : [val]);
    } else if (['level', 'exp', 'next_level_exp', 'hp', 'mp', 'money', 'age'].includes(key)) {
      const n = safeToNumber(val);
      if (n !== null) result[key] = n;
    } else if (key !== 'role_key_information') {
      result[key] = val;
    }
  }
  return result;
}

function normalizeExperience(card) {
  // 处理升级逻辑
  while (card.exp >= card.next_level_exp) {
    card.level = (card.level || 1) + 1;
    card.exp = card.exp - card.next_level_exp;
    card.next_level_exp = card.level * 100;
    // 满血满蓝
    card.hp = 100 + card.level * 10;
    card.mp = 100 + card.level * 10;
  }
  return card;
}

function appendCurrentBehavior(existingInfo, newBehavior) {
  if (!existingInfo) existingInfo = '';
  // 移除旧【当前行为】段
  existingInfo = existingInfo.replace(/【当前行为】[^\n]*/g, '').trim();
  return existingInfo + '\n【当前行为】' + newBehavior;
}

// ========== Parsing ==========
function unwrapModelText(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  // 去掉代码块围栏
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  // 取第一个 { 到最后一个 }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text.trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function normalizeFieldNames(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // 字段名归一化
  const aliases = {
    playerCardPatch: 'player_card_patch',
    player_card_patch: 'player_card_patch',
    npcCardPatches: 'npc_card_patches',
    npc_card_patches: 'npc_card_patches',
    dynamicWorldGlobalBackground: 'dynamic_world_global_background',
    dynamic_world_global_background: 'dynamic_world_global_background',
  };
  const result = {};
  for (const key of Object.keys(obj)) {
    const normalizedKey = aliases[key] || key;
    result[normalizedKey] = obj[key];
  }
  return result;
}

function sanitizePatch(patch) {
  const whitelist = [
    'raw_setting', 'personality', 'appearance', 'voice', 'skills', 'items',
    'equipment', 'other', 'gender', 'age', 'level', 'level_desc', 'exp',
    'next_level_exp', 'hp', 'mp', 'money', 'role_key_information',
  ];
  const result = {};
  for (const key of whitelist) {
    if (patch[key] !== undefined) {
      if (['level', 'exp', 'next_level_exp', 'hp', 'mp', 'money', 'age'].includes(key)) {
        const n = safeToNumber(patch[key]);
        if (n !== null) result[key] = n;
      } else if (['items', 'skills', 'other'].includes(key)) {
        result[key] = Array.isArray(patch[key]) ? patch[key].filter(Boolean) : [patch[key]];
      } else {
        result[key] = patch[key];
      }
    }
  }
  return result;
}

function parseMemoryResult(raw) {
  const text = unwrapModelText(raw);
  if (!text) return null;

  let obj = safeJsonParse(text);
  if (!obj) {
    // 尝试修复常见格式问题
    const fixed = text.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    obj = safeJsonParse(fixed);
  }
  if (!obj) return null;

  obj = normalizeFieldNames(obj);

  // npc_card_patches 归一化（可能是对象或数组）
  if (obj.npc_card_patches && typeof obj.npc_card_patches === 'object' && !Array.isArray(obj.npc_card_patches)) {
    const normalized = [];
    for (const [roleName, patch] of Object.entries(obj.npc_card_patches)) {
      if (patch && typeof patch === 'object') {
        normalized.push({ role_name: roleName, patch: sanitizePatch(patch) });
      }
    }
    obj.npc_card_patches = normalized;
  } else if (Array.isArray(obj.npc_card_patches)) {
    obj.npc_card_patches = obj.npc_card_patches
      .map(item => {
        if (!item || typeof item !== 'object') return null;
        const roleName = item.role_name || item.role_id || '';
        const patch = sanitizePatch(item.patch || item);
        return { role_name: roleName, patch };
      })
      .filter(item => item && item.role_name);
  } else {
    obj.npc_card_patches = [];
  }

  // sanitize player_card_patch
  if (obj.player_card_patch && typeof obj.player_card_patch === 'object') {
    obj.player_card_patch = sanitizePatch(obj.player_card_patch);
  } else {
    obj.player_card_patch = {};
  }

  // 确保必填字段存在
  if (typeof obj.summary !== 'string') obj.summary = '';
  if (!Array.isArray(obj.facts)) obj.facts = [];
  if (!Array.isArray(obj.tags)) obj.tags = [];
  if (typeof obj.dynamic_world_global_background !== 'string') {
    obj.dynamic_world_global_background = '';
  }

  return obj;
}

// ========== Apply Memory Result ==========
function applyMemoryResult(result, cfg, lastIndex) {
  const state = tavo.get(NS) || defaultState();

  // 更新 summary
  if (result.summary) {
    state.meta.summary = result.summary;
  }

  // 合并 facts（去重 + cap）
  if (Array.isArray(result.facts)) {
    const newFacts = result.facts.filter(f => f && !state.meta.facts.includes(f));
    state.meta.facts = [...state.meta.facts, ...newFacts].slice(-cfg.factCap);
  }

  // 合并 tags（去重 + cap）
  if (Array.isArray(result.tags)) {
    const newTags = result.tags.filter(t => t && !state.meta.tags.includes(t));
    state.meta.tags = [...state.meta.tags, ...newTags].slice(-cfg.tagCap);
  }

  // 更新 dynamicBg（缺失时保留旧值）
  if (result.dynamic_world_global_background) {
    state.meta.dynamicBg = result.dynamic_world_global_background;
  }

  // 合并玩家参数卡
  if (result.player_card_patch && Object.keys(result.player_card_patch).length > 0) {
    state.cards.player = normalizeExperience(mergeCardPatch(state.cards.player, result.player_card_patch));
  }

  // 合并 NPC 参数卡
  if (Array.isArray(result.npc_card_patches)) {
    for (const npcPatch of result.npc_card_patches) {
      if (!npcPatch.role_name) continue;
      const roleName = npcPatch.role_name;
      const existing = state.cards.npcs[roleName] || {
        level: 1, exp: 0, next_level_exp: 100, hp: 110, mp: 110, money: 0,
        items: [], skills: [], other: [], role_key_information: '',
      };
      // 处理 role_key_information 追加【当前行为】
      if (npcPatch.patch && npcPatch.patch.role_key_information) {
        const newBehavior = npcPatch.patch.role_key_information;
        npcPatch.patch.role_key_information = appendCurrentBehavior(existing.role_key_information, newBehavior);
      }
      state.cards.npcs[roleName] = normalizeExperience(mergeCardPatch(existing, npcPatch.patch || {}));
    }
  }

  // 更新 meta
  state.meta.lastIndex = lastIndex || state.meta.lastIndex;
  state.meta.updatedAt = Date.now();
  state.meta.turnsSinceRefresh = 0;

  tavo.set(NS, state, 'chat');

  // 同步到宿主长记忆（可选）
  if (cfg.syncHostMemory && result.summary) {
    try {
      tavo.memory.append('[记忆摘要] ' + result.summary);
    } catch (e) {
      console.warn('[tmm] sync to host memory failed', e);
    }
  }
}

// ========== Build Prompts ==========
function buildMemoryPayload({ chat, state, recentMsgs, deltaMsgs, cfg }) {
  const now = Date.now();
  const lastUpdate = state.meta.updatedAt ? Math.round((now - state.meta.updatedAt) / 1000) : -1;

  // 最近对话
  const dialogueItems = recentMsgs.map(msg => ({
    role: msg.role || 'unknown',
    speaker: msg.characterName || (msg.role === 'user' ? '用户' : 'NPC'),
    content: (msg.content || '').slice(0, cfg.payloadMode === 'compact' ? 420 : 1600),
  }));

  // 事件增量
  const deltaStart = state.meta.lastIndex || 0;
  const deltaItems = deltaMsgs.filter((_, i) => (deltaStart + i) > (state.meta.lastIndex || 0));
  const deltaText = deltaItems.map(m => `${m.characterName || m.role}: ${m.content || ''}`).join('\n')
    .slice(0, cfg.payloadMode === 'compact' ? 800 : 2000);

  // 当前剧情焦点（最近一条 assistant 消息首句）
  const lastAssistant = recentMsgs.reverse().find(m => m.role === 'assistant');
  const currentFocus = lastAssistant ? ((lastAssistant.content || '').split('\n')[0] || '').slice(0, 100) : '';

  // 角色参数卡列表
  const playerCard = {
    name: '用户',
    role_type: 'player',
    ...state.cards.player,
  };
  const npcCards = Object.entries(state.cards.npcs).map(([name, card]) => ({
    name,
    role_type: 'npc',
    ...card,
  }));

  return {
    worldName: chat?.name || '未知世界',
    world: cfg.worldSetting || '',
    dynamicBg: state.meta.dynamicBg || '',
    currentFocus,
    deltaText,
    dialogueItems,
    playerCard,
    npcCards,
    lastUpdate,
  };
}

function buildMemoryUserPrompt(payload, compactMode) {
  const { worldName, world, dynamicBg, currentFocus, deltaText, dialogueItems, playerCard, npcCards } = payload;

  const summaryLimit = compactMode ? 160 : 320;
  const factsLimit = compactMode ? 5 : 8;
  const tagsLimit = compactMode ? 6 : 12;
  const currentMemory = tavo.get(`${NS}.meta.summary`)?.slice(0, summaryLimit) || '';
  const currentFacts = (tavo.get(`${NS}.meta.facts`) || []).slice(-factsLimit);
  const currentTags = (tavo.get(`${NS}.meta.tags`) || []).slice(-tagsLimit);

  let prompt = '';

  // [世界]
  prompt += `[世界] ${worldName}\n`;
  if (world) prompt += `[原始全局背景]\n${world}\n\n`;
  if (dynamicBg) prompt += `[动态全局背景]\n${dynamicBg.slice(0, compactMode ? 600 : 1200)}\n\n`;

  // [章节] - v1 省略
  // prompt += `[章节] ${chapterTitle}\n\n`;

  // [当前记忆]
  if (currentMemory) prompt += `[当前记忆]\n${currentMemory}\n\n`;
  if (currentFacts.length) prompt += `[当前事实]\n${currentFacts.map(f => `- ${f}`).join('\n')}\n\n`;
  if (currentTags.length) prompt += `[当前标签]\n${currentTags.join('、')}\n\n`;

  // [当前事件] / [最近剧情焦点]
  if (currentFocus) prompt += `[当前事件]\n${currentFocus}\n\n`;
  if (deltaText) prompt += `[事件增量]\n${deltaText}\n\n`;

  // [新增对话]
  if (dialogueItems.length) {
    prompt += `[新增对话(JSON数组)]\n${JSON.stringify(dialogueItems, null, 2)}\n\n`;
  }

  // [用户当前参数卡]
  prompt += `[用户当前参数卡(JSON)]\n${JSON.stringify(playerCard, null, 2)}\n\n`;

  // [角色动态参数卡列表]
  if (npcCards.length) {
    prompt += `[角色动态参数卡列表(JSON数组)]\n${JSON.stringify(npcCards, null, 2)}\n\n`;
  }

  // [任务]
  if (compactMode) {
    prompt += `[任务]
请对比当前记忆、当前参数卡与新增对话，只保留对后续剧情有用的新事实、修正和标签。
如果对话里出现角色状态变化、获得/失去物品、技能成长、身份变化，请同时输出参数卡 patch。
如果有重复，直接合并；如果有冲突，按最新对话修正。

`;
    prompt += `[输出格式(JSON)]
{
  "summary": "新的故事摘要",
  "facts": ["新事实1"],
  "tags": ["标签1"],
  "player_card_patch": {
    "level": 2,
    "exp": 30,
    "next_level_exp": 200,
    "items": ["新获得物品"],
    "other": ["新的长期状态"],
    "role_key_information": "角色的关键信息，如身份备注、编排限制等"
  },
  "npc_card_patches": [
    {
      "role_name": "某角色",
      "patch": {
        "items": ["新获得物品"],
        "other": ["新状态"],
        "role_key_information": "身份备注等关键信息\\n【当前行为】在铁匠铺打铁，赶制神秘订单"
      }
    }
  ],
  "dynamic_world_global_background": "新的动态全局背景"
}
注意：patch 只允许这些字段：raw_setting, personality, appearance, voice, skills, items, equipment, other, gender, age, level, level_desc, exp, next_level_exp, hp, mp, money, role_key_information。
role_key_information 必须包含原身份备注 + 末尾【当前行为】段，不可只返回行为段而丢失身份备注。
没有变化就返回空对象 {} 或空数组 []。
`;
  } else {
    prompt += `[任务]
根据现有记忆、当前事件、最近对话和角色参数卡，更新整个故事所需的长期记忆。
如果对话里出现用户或 NPC 的长期状态变化，必须同时输出参数卡 patch。
只保留对后续剧情真的有用的变化，重复项请合并，冲突项按最新剧情修正。

`;
    prompt += `[输出格式(JSON)]
{
  "summary": "新的故事摘要",
  "facts": ["新事实1", "新事实2"],
  "tags": ["标签1", "标签2"],
  "player_card_patch": {
    "level": 2,
    "exp": 40,
    "next_level_exp": 200,
    "level_desc": "斗之气2星",
    "skills": ["新技能"],
    "items": ["新物品"],
    "other": ["新的长期状态"],
    "role_key_information": "角色的关键信息，如身份备注、编排限制等"
  },
  "npc_card_patches": [
    {
      "role_name": "某角色",
      "patch": {
        "items": ["新物品"],
        "other": ["新状态"],
        "role_key_information": "身份备注等关键信息\\n【当前行为】在铁匠铺打铁，赶制神秘订单"
      }
    }
  ],
  "dynamic_world_global_background": "新的动态全局背景"
}
只允许使用这些 patch 字段：raw_setting, personality, appearance, voice, skills, items, equipment, other, gender, age, level, level_desc, exp, next_level_exp, hp, mp, money, role_key_information。
role_key_information 必须包含原身份备注 + 末尾【当前行为】段，不可只返回行为段而丢失身份备注。
如果没有参数卡变化，player_card_patch 返回 {}，npc_card_patches 返回 []。
`;
  }

  return prompt;
}

function buildDirectivePrompt(text) {
  const state = tavo.get(NS) || defaultState();
  const directive = text.replace(/^@记忆管理\s*/i, '').trim();

  let prompt = `[直接管理指令]
${directive}

[当前记忆]
${state.meta.summary}

[当前事实]
${state.meta.facts.map(f => `- ${f}`).join('\n') || '（无）'}

[当前标签]
${state.meta.tags.join('、') || '（无）'}

[用户当前参数卡(JSON)]
${JSON.stringify(state.cards.player, null, 2)}

[角色动态参数卡列表(JSON数组)]
${JSON.stringify(
    Object.entries(state.cards.npcs).map(([name, card]) => ({ name, role_type: 'npc', ...card })),
    null, 2
  )}

[任务]
按[直接管理指令]更新长期记忆和角色参数卡，输出格式同标准JSON输出。
`;

  return prompt;
}

function buildInjectionBlock(state, budget) {
  const { meta, cards } = state;
  if (!meta.summary) return '';

  const player = cards.player || {};
  const playerStatus = `Lv.${player.level || 1}（${player.level_desc || ''}） | HP ${player.hp || 110} | MP ${player.mp || 110} | 金币 ${player.money || 0}${player.items?.length ? ' | 持有: ' + player.items.join('、') : ''}`;

  let block = '[记忆上下文（模型参考，不要在正文中提及本段）]\n';
  block += `故事摘要: ${meta.summary}\n`;
  block += `最近事实: ${(meta.facts || []).join('；')}\n`;
  block += `关键标签: ${(meta.tags || []).join('、')}\n`;
  if (meta.dynamicBg) block += `动态全局背景: ${meta.dynamicBg}\n`;
  block += `用户当前状态: ${playerStatus}`;

  // 按优先级截断
  if (block.length > budget) {
    const excess = block.length - budget;
    // 优先截断 dynamicBg，然后是 facts、tags、最后是 summary
    if (meta.dynamicBg && excess > 0) {
      const cut = Math.min(meta.dynamicBg.length, excess);
      block = block.replace(`动态全局背景: ${meta.dynamicBg}`, `动态全局背景: ${meta.dynamicBg.slice(0, -cut)}`);
    }
    if (block.length > budget && meta.tags?.length) {
      const cut = Math.min(block.length - budget, 20);
      block = block.replace(/关键标签: [^\n]+/, m => m.slice(0, -cut));
    }
    if (block.length > budget && meta.facts?.length) {
      const cut = Math.min(block.length - budget, 50);
      block = block.replace(/最近事实: [^\n]+/, m => m.slice(0, -cut));
    }
    if (block.length > budget) {
      block = block.slice(0, budget);
    }
  }

  return block;
}

// ========== Core Functions ==========
async function refreshMemory(cfg) {
  try {
    const chat = await tavo.chat.current();
    const state = tavo.get(NS) || defaultState();
    const totalCount = await tavo.message.count();
    const recentMsgs = await tavo.message.find([-cfg.dialogueWindow, -1]);
    const deltaMsgs = await tavo.message.find([state.meta.lastIndex || 0, -1]);

    const payload = buildMemoryPayload({ chat, state, recentMsgs, deltaMsgs, cfg });
    const userPrompt = buildMemoryUserPrompt(payload, cfg.payloadMode === 'compact');
    const fullPrompt = systemHead(cfg) + '\n\n' + userPrompt;

    const raw = await tavo.generate(fullPrompt, {
      context: false,
      settings: { temperature: 0.3 },
    });

    const result = parseMemoryResult(raw);
    if (!result) {
      console.warn('[tmm] parse failed, keep old memory');
      tavo.utils.toast(tavo.plugin.i18n.t('runtime.parseFailed'));
      return;
    }

    applyMemoryResult(result, cfg, totalCount);

    if (cfg.snapshotEnabled) {
      try {
        await tavo.message.append({
          content: '[记忆快照] ' + JSON.stringify(result),
          hidden: true,
        });
      } catch (e) {
        console.warn('[tmm] snapshot failed', e);
      }
    }
  } catch (e) {
    console.warn('[tmm] refreshMemory failed', e);
  }
}

async function runDirective(text) {
  try {
    const cfg = getConfig();
    const userPrompt = buildDirectivePrompt(text);
    const fullPrompt = systemHead(cfg) + '\n\n' + userPrompt;

    const raw = await tavo.generate(fullPrompt, {
      context: false,
      settings: { temperature: 0.3 },
    });

    const result = parseMemoryResult(raw);
    if (result) {
      const state = tavo.get(NS) || defaultState();
      applyMemoryResult(result, cfg, state.meta.lastIndex);
      tavo.utils.toast(tavo.plugin.i18n.t('runtime.directiveDone'));
    } else {
      tavo.utils.toast(tavo.plugin.i18n.t('runtime.directiveFailed', { error: '解析失败' }));
    }
  } catch (e) {
    console.warn('[tmm] directive failed', e);
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.directiveFailed', { error: String(e) }));
  }
}

async function writebackCards() {
  const state = tavo.get(NS);
  if (!state) return;

  tavo.utils.toast(tavo.plugin.i18n.t('runtime.writebackConfirm'));

  // 写回 NPC 角色卡
  for (const [name, card] of Object.entries(state.cards.npcs)) {
    try {
      // 查找角色
      const characters = await tavo.character.find({ search: name });
      if (characters?.length) {
        const char = characters[0];
        // 提取可写回字段（不包括 role_key_information）
        const patch = {};
        for (const key of ['level', 'exp', 'next_level_exp', 'hp', 'mp', 'money', 'items', 'skills', 'other']) {
          if (card[key] !== undefined) patch[key] = card[key];
        }
        await tavo.character.update(char.id, patch);
      }
    } catch (e) {
      console.warn(`[tmm] writeback failed for ${name}`, e);
    }
  }
}

// ========== Hooks ==========

// 初始化
tavo.plugin.on('chat:opened', async () => {
  const state = tavo.get(NS);
  if (!state || state.version !== 1) {
    tavo.set(NS, defaultState(), 'chat');
  }
});

// @记忆管理 直接指令
tavo.plugin.on('input:beforeSend', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const text = (event.text || '').trim();
  if (!text.startsWith('@记忆管理') && !text.startsWith('@记忆管理器')) return;
  event.cancel();
  runDirective(text).catch(err => console.warn('[tmm] directive failed', err));
});

// 消息添加触发记忆刷新
tavo.plugin.on('message:added', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || refreshing) return;
  if (event.message?.role === 'system') return;

  const state = tavo.get(NS) || defaultState();
  state.meta.turnsSinceRefresh = (state.meta.turnsSinceRefresh || 0) + 1;

  const deltaText = String(event.message?.content || '');
  const hardTrigger = cfg.triggerKeywords.some(k => deltaText.includes(k));

  if (!hardTrigger && state.meta.turnsSinceRefresh < cfg.refreshInterval) {
    tavo.update(NS, { meta: state.meta }, 'chat');
    return;
  }

  refreshing = true;
  try {
    await refreshMemory(cfg);
  } finally {
    refreshing = false;
  }
});

// 生成时注入记忆上下文
tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.injectEnabled) return;
  const state = tavo.get(NS);
  if (!state || !state.meta?.summary) return;

  const block = buildInjectionBlock(state, cfg.injectBudget);
  if (block) {
    event.text = block + '\n\n---\n' + (event.text || '');
  }
});

// ========== Sidebar Actions ==========
tavo.plugin.onSidebarAction('refresh-memory', async () => {
  if (refreshing) {
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.refreshBusy'));
    return;
  }
  refreshing = true;
  try {
    await refreshMemory(getConfig());
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.refreshDone'));
  } catch (e) {
    console.warn('[tmm] manual refresh failed', e);
  } finally {
    refreshing = false;
  }
});

tavo.plugin.onSidebarAction('inspect-memory', async () => {
  const state = tavo.get(NS);
  if (state) {
    await tavo.message.append({
      content: '```\n' + JSON.stringify(state, null, 2) + '\n```',
      hidden: true,
    });
  }
});

tavo.plugin.onSidebarAction('export-memory', async () => {
  const state = tavo.get(NS);
  if (state) {
    await tavo.file.export(
      tavo.plugin.i18n.t('runtime.exportName'),
      JSON.stringify(state, null, 2)
    );
  }
});

tavo.plugin.onSidebarAction('writeback-cards', async () => {
  await writebackCards();
});
