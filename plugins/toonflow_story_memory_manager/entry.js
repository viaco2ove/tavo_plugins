// toonflow_story_memory_manager - entry.js
// 故事记忆管理器（对齐 fixDB.prompts.ts 的 story_memory 人设）
// 提炼长期记忆 + 维护角色动态参数卡；数值必须纯数字；输出结构化 JSON。

'use strict';

// 诊断：确认 entry.js 真的被 Tavo 加载并执行
try {
  console.log('[tmm] ENTRY START v1.0.8 ' + new Date().toISOString()
    + ' tavo=' + (typeof tavo)
    + ' tavo.plugin=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin : 'undefined')
    + ' tavo.plugin.on=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin.on : 'undefined'));
} catch (e) {
  console.error('[tmm] entry log failed', e);
}

// hook 注册用 try/catch 包裹：抓 Tavo API 抛错（之前没有错误日志 = 静默死）
const _safeOn = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.on !== 'function') {
      console.error('[tmm] hook 注册失败: tavo.plugin.on 不可用, hook=' + name);
      return;
    }
    tavo.plugin.on(name, fn);
    console.log('[tmm] hook registered: ' + name);
  } catch (e) {
    console.error('[tmm] hook 注册失败: hook=' + name, e && (e.message || e));
  }
};
const _safeOnSide = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.onSidebarAction !== 'function') {
      console.error('[tmm] sidebar 注册失败: tavo.plugin.onSidebarAction 不可用, name=' + name);
      return;
    }
    tavo.plugin.onSidebarAction(name, fn);
    console.log('[tmm] sidebar registered: ' + name);
  } catch (e) {
    console.error('[tmm] sidebar 注册失败: name=' + name, e && (e.message || e));
  }
};

const NS = 'tmm';
let refreshing = false;

// 严格对齐 toonflow-game-app/src/lib/fixDB.prompts.ts 的 _PROMPT_STORY_MEMORY
const MEMORY_RULES = `你是记忆管理器。
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

. NPC 当前行为维护
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
    - \`name\`：角色名
    - \`role_type\`：角色类型，如 \`npc\` / \`narrator\` / \`player\` / \`system\` /\`general\`
    也就是 \`一般角色\`/\`旁白\`/\`用户\`/\`系统角色\`/\`万能角色\`
6. 世界时钟:[世界时钟(JSON对象)]（仅自由模式传入，章节模式无此字段）
  - \`tick\`：时间刻度（纯数字）
  - \`timeOfDay\`：当前时段，如 \`清晨\`/\`上午\`/\`正午\`/\`下午\`/\`黄昏\`/\`夜晚\`/\`深夜\`/\`午夜\`
  - \`weather\`：当前天气，如 \`晴\`/\`阴\`/\`雨\`/\`雪\`/\`雾\`/\`风\`
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
    - npc_card_patches：对象，key为NPC唯一标识名，value为对应NPC参数补丁，无变更传空对象{}
    - dynamic_world_global_background: 字符串,动态全局背景描述。动态控制整个故事的世界观。 务必每次都返回这个字段值！

3. 角色补丁（player_card_patch / npc_card_patches内单条补丁）仅允许使用以下字段，禁止新增自定义字段：
raw_setting, personality, appearance, voice, skills, items, equipment, other, gender, age, level, level_desc, exp, next_level_exp, hp, mp, money, role_key_information
其中role_key_information 是角色关键信息
其中items["新获得物品"]。包括一些特殊物品如:属性点（如力量属性点(2) 这种属性加成也算作一种物品）
4. 字段数值强制规范：
age、level、exp、next_level_exp、hp、mp、money 必须为纯数字类型，禁止字符串数字、中文描述
所有状态感受、模糊实力变化、剧情备注、临时buff描述统一存入other字段（字符串），禁止写入数值字段
`;

/* =========================================================================
 * 角色参数卡：初始化 / 加载（对齐 toonflow-game-app/src/lib/roleParameterCard.ts）
 * 故事角色在 Toonflow-game 中带一张「静态参数卡」(parameterCardJson)，
 * 由角色设定经 AI 生成。tavo 导入的 CCv3 角色卡把这张参数卡嵌在 description 的
 * 「角色参数卡」```json 块里，本插件在打开聊天时解析并归一化，存入 tmm_story，
 * 供信息面板/事件管理器展示；运行时记忆生成的动态补丁会回流合并，呈现动态参数。
 * ========================================================================= */

const STORY_NS = 'tmm_story';
const STATIC_NS = 'tmm_story_static'; // 受保护的静态基准卡：一次性构建，重启聊天不清空

// Tavo 的 chat 变量经 tavo.get 返回的是包装对象 {target,name,found,value}，
// 真实数据在 .value 里。所有读变量都必须解包，否则 v.chapters / v.level 等会是 undefined，
// 代码会误判为"空"并覆盖，造成配置/参数卡被清空。
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
  if (rt === '旁白') rt = 'narrator'; // 中文字面值归一化
  if (rt === '万能角色') rt = 'general';
  if (rt === '系统角色') rt = 'system';
  if (!rt) {
    // 1) 角色名本身是类型标识
    if (/^旁白$|^narrator$/i.test(hint || '')) rt = 'narrator';
    else if (/^某男子$|^某女子$|^万能/.test(hint || '')) rt = 'general';
    else if (/^系统$|^system$/i.test(hint || '')) rt = 'system';
    // 2) desc 显式角色类型字段
    else if (/角色类型\s*[:：]\s*万能角色/i.test(text)) rt = 'general';
    else if (/角色类型\s*[:：]\s*系统角色/i.test(text)) rt = 'system';
    else if (/角色类型\s*[:：]\s*旁白|系统旁白|系统叙事者?/i.test(text)) rt = 'narrator';
    // 3) 弱信号
    else if (/万能角色|不可作为具体角色独立使用/.test(text)) rt = 'general';
    else if (/饰演|扮演虚无/.test(text)) rt = 'general';
    else if (/旁白|系统叙事|系统旁白/.test(text)) rt = 'narrator';
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
  const roleType = detectRoleType((d.description || '') + '\n' + (source.raw_setting || ''),
    // 优先级：data.roleType（同步来的卡字段）> source.role_type（嵌入JSON）> d.name（角色名）
    d.roleType || source.role_type || d.name);
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
    // 角色解析健壮化：任一角色拉取/解析失败不影响整体，缺省空数组也要写基准卡
    let characters = [];
    try { characters = await buildCharactersFromChat(chat); } catch (e) {
      console.warn('[tmm] buildCharactersFromChat failed', e);
      characters = [];
    }
    // 受保护合并：保留已有角色卡，只补建新角色（优先读 global 防 reset）
    const prev = (force ? (readStaticStory() || {}) : null);
    const prevById = {};
    (prev && prev.characters || []).forEach(c => { if (c && c.id) prevById[c.id] = c; });
    const merged = characters.map(c => prevById[c.id] || c);
    const staticStory = {
      name: chat.name || '故事信息',
      synopsis: scalarText(synopsis).slice(0, 1200),
      characters: merged,
    };
    // 静态基准卡必须写 global scope 才能抗 tavo_chat_reset！
    // chat scope 在 reset 时被清空，导致角色参数卡全部消失。
    try { tavo.set(STATIC_NS, staticStory, 'global'); } catch (e) {}
    try { tavo.set(STATIC_NS, staticStory, 'chat'); } catch (e) {}
    return staticStory;
  } catch (e) {
    console.warn('[tmm] buildStaticStory failed', e);
    return null;
  }
}

// 读取静态基准卡：优先 chat scope，回退 global scope（global 在 reset 后仍能恢复）
function readStaticStory() {
  let v = null;
  try { v = tavo.get(STATIC_NS, 'chat'); } catch (e) {}
  if (v && typeof v === 'object' && v.found !== false && v.value) return v.value;
  try { v = tavo.get(STATIC_NS, 'global'); } catch (e) {}
  if (v && typeof v === 'object' && v.found !== false && v.value) return v.value;
  return null;
}

// 打开聊天时：保护静态基准卡（STATIC_NS），重新生成展示层 tmm_story。
// 动态参数（hp/mp/level 等增量）从「静态基准 + 持久化增量 tmm.cards」重新派生，
// 而不是被清空成空白——即"重新生成而非清空"。
async function initStory() {
  try {
    // 优先读 chat scope，reset 后 chat 为空则回退 global scope
    let staticStory = readStaticStory();
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
    const story = readChatVar(STORY_NS);
    if (!story || !story.characters) return;
    const mem = readChatVar(NS) || defaultState();
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
  const kwRaw = String(get('triggerKeywords', '') || '');
  const kw = kwRaw.split(',').map(s => s.trim()).filter(Boolean);
  return {
    enabled: get('enabled', true) !== false,
    refreshInterval: Number(get('refreshInterval', 3)) || 3,
    dialogueWindow: Number(get('dialogueWindow', 12)) || 12,
    factCap: Number(get('factCap', 12)) || 12,
    tagCap: Number(get('tagCap', 8)) || 8,
    injectEnabled: get('injectEnabled', true) !== false,
    worldSetting: String(get('worldSetting', '')),
    triggerKeywords: kw.length ? kw : ['记忆管理', '更新', '获得', '得到', '到达', '等级', '睡觉', '休息', '恢复', '装备', '技能', '身份', '加入', '拾取', '服用', '修炼', '突破', '领取', '任务奖励', '标记'],
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

// 读取全局原始背景（等级称号对照表等）：优先 tf_story.edit.globalBackground，
// 再补充 lorebook 里 constant 的【简介】/【全局背景】条目（event_manager 写入的）
async function getGlobalBackground() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    let bg = String(edit.globalBackground || '').trim();
    try {
      const chat = await tavo.chat.current();
      if (chat && chat.lorebooks && chat.lorebooks[0]) {
        const lb = await tavo.lorebook.get(chat.lorebooks[0].id);
        (lb.entries || []).forEach(e => {
          const c = String(e.content || '');
          if (/^【简介】|^【全局背景】/.test(c)) bg += '\n' + c;
        });
      }
    } catch (e) {}
    return bg.trim() || '（无）';
  } catch (e) { return '（无）'; }
}

// 当前事件状态：所在章节标题/内容/完成条件
async function getEventState() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    const chapters = edit.chapters || [];
    const prog = readChatVar('tf_progress') || {};
    const idx = (typeof prog.currentChapterIndex === 'number') ? prog.currentChapterIndex : 0;
    const ch = chapters[idx];
    if (!ch) return '（自由模式，无进行中章节）';
    let s = '【当前章节】' + (ch.title || '') + '\n';
    if (ch.content) s += (ch.content).slice(0, 1200) + '\n';
    if (ch.successCondition) s += '【本章完成条件】' + ch.successCondition + '\n';
    return s;
  } catch (e) { return '（无）'; }
}

// 角色动态参数卡列表（来自 tmm_story / 静态基准）：让记忆 LLM 看到每个角色当前 card
function buildCharacterCardList() {
  const story = readChatVar(STORY_NS) || readChatVar(STATIC_NS);
  const characters = (story && Array.isArray(story.characters)) ? story.characters : [];
  if (!characters.length) return '（无角色参数卡）';
  return characters.map(ch => {
    const c = ch.card || {};
    const parts = ['name: ' + (ch.name || '?'), 'role_type: ' + (ch.roleType || 'npc')];
    if (c.level != null && c.level !== '') parts.push('level: ' + c.level);
    if (c.level_desc) parts.push('level_desc: ' + c.level_desc);
    if (c.hp != null && c.hp !== '') parts.push('hp: ' + c.hp);
    if (c.mp != null && c.mp !== '') parts.push('mp: ' + c.mp);
    if (c.gender) parts.push('gender: ' + c.gender);
    if (c.age != null && c.age !== '') parts.push('age: ' + c.age);
    ['raw_setting', 'personality', 'appearance', 'skills', 'items', 'equipment', 'other'].forEach(k => {
      if (c[k]) parts.push(k + ': ' + (Array.isArray(c[k]) ? c[k].join('、') : c[k]));
    });
    if (c.role_key_information) parts.push('role_key_information(关键信息/当前行为): ' + c.role_key_information);
    return '{ ' + parts.join('; ') + ' }';
  }).join('\n');
}

// 记忆管理器 LLM 主入口：directive 非空时表示 @记忆管理 直接指令
async function runMemoryAgent(directive) {
  if (refreshing) return;
  refreshing = true;
  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;

    // 防御：展示层 tmm_story 缺失（如重置后）则立刻重建，保证模型能看到角色参数卡以生成 patch
    if (!readChatVar(STORY_NS)) {
      try { await initStory(); } catch (e) {}
    }

    const count = Math.max(cfg.dialogueWindow || 12, 10);
    const messages = await tavo.message.find([-count, -1]);
    const recentDialogue = messages.map(m => ({
      role: m.characterName || (m.role === 'user' ? '用户' : (m.role === 'assistant' ? 'NPC' : m.role)),
      content: (m.content || '').slice(0, 400),
    }));
    const cur = readChatVar(NS) || defaultState();
    const cardList = buildCharacterCardList();
    const globalBg = await getGlobalBackground();
    const eventState = await getEventState();
    const worldClock = cur.worldClock || null;
    // 读取 input:beforeSend 塞进来的指令（指令被 cancel 后不在消息历史里）
    const pendingDirective = cur._pendingDirective || (directive ? '@记忆管理 ' + directive : null);

    let prompt = '';
    prompt += '【历史记忆】\n';
    prompt += '摘要: ' + (cur.summary || '（尚无）') + '\n';
    prompt += '事实: ' + (cur.facts || []).join('; ') + '\n';
    prompt += '标签: ' + (cur.tags || []).join(', ') + '\n';
    prompt += '动态全局背景: ' + (cur.dynamic_world_global_background || '（尚无）') + '\n\n';
    prompt += '【全局原始背景】\n' + globalBg + '\n\n';
    prompt += '【当前事件状态】\n' + eventState + '\n\n';
    prompt += '【新增对话(JSON数组)】\n' + JSON.stringify(recentDialogue) + '\n\n';
    prompt += '【角色动态参数卡列表(JSON数组)】\n' + cardList + '\n\n';
    if (worldClock) prompt += '【世界时钟】\n' + JSON.stringify(worldClock) + '\n\n';
    if (pendingDirective) {
      prompt += '\n【用户直接指令】\n' + pendingDirective + '\n（按「@记忆管理 特殊指令优先级规则」处理：直接同步更新对应角色卡与记忆，无需等待NPC/旁白回应）\n';
    }
    prompt += '\n请基于以上上下文，输出唯一的 JSON 记忆更新结果。';

    const raw = await tavo.generate(MEMORY_RULES + '\n\n' + prompt, {
      context: false,
      settings: { temperature: 0.3 },
    });

    let parsed = null;
    try {
      const jsonMatch = raw && raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('[tmm] parse failed', e);
    }

    if (parsed) {
      const state = readChatVar(NS) || defaultState();
      if (parsed.summary) state.summary = String(parsed.summary).slice(0, 800);
      if (Array.isArray(parsed.facts)) {
        const newFacts = parsed.facts.filter(f => !state.facts.includes(f));
        state.facts = [...state.facts, ...newFacts].slice(-cfg.factCap);
      }
      if (Array.isArray(parsed.tags)) {
        const newTags = parsed.tags.filter(t => !state.tags.includes(t));
        state.tags = [...state.tags, ...newTags].slice(-cfg.tagCap);
      }
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
      delete state._pendingDirective; // 清理指令标记
      tavo.set(NS, state, 'chat');
      // 把动态参数补丁回流到 tmm_story，供信息面板/发言器展示实时数值与关键信息
      syncStoryDynamicCards();
      if (directive) tavo.utils.toast('@记忆管理 指令已执行');
    } else if (directive) {
      tavo.utils.toast('@记忆管理 指令解析失败');
    }
  } catch (e) {
    console.warn('[tmm] agent failed', e);
    if (directive) tavo.utils.toast('@记忆管理 执行异常');
  } finally {
    refreshing = false;
  }
}

_safeOn('chat:opened', async () => {
  if (!readChatVar(NS)) {
    tavo.set(NS, defaultState(), 'chat');
  }
  // 打开聊天：保护静态基准卡，重新生成展示层（动态参数从基准 + 持久化增量重新派生）
  await initStory();
});

_safeOn('chat:updated', async () => {
  // 聊天角色/绑定变化时：仅补建新增角色（已有角色静态卡受保护），再重新生成展示层
  await buildStaticStory(true);
  await initStory();
});

// 指令类前缀：被 input:beforeSend 拦截处理（@记忆管理）或交给事件管理器处理（@事件进度检测/@下个事件/@下个章节），
// 普通自动刷新应跳过，避免重复触发或把指令当剧情记忆。
const DIRECTIVE_PREFIXES = ['@记忆管理', '@记忆管理器', '@事件进度检测', '@下个事件', '@下一个事件', '@下个章节', '@下一个章节'];

// 拦截 @记忆管理 / @记忆管理器 直接指令：先取消原发送（不受 5 秒限制），再运行记忆代理。
// 这是「角色关键信息 / 当前行为 / @记忆管理 指令」能真正生效的关键钩子。
_safeOn('input:beforeSend', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const text = String((event && event.text) || '').trim();
  const m = text.match(/^@(记忆管理|记忆管理器)\s*([\s\S]*)$/);
  if (!m) return;
  try { if (event && typeof event.cancel === 'function') event.cancel(); } catch (e) {}
  const rawText = '@记忆管理 ' + (m[2] || '').trim();

  const mode = getIntentMode();
  if (mode === 'keyword') {
    // 确定性关键词模式：直接解析指令落参数卡，不调 AI
    const state = readChatVar(NS) || defaultState();
    const result = applyKeywordDirective(state, rawText);
    if (result && result.applied) {
      tavo.set(NS, state, 'chat');
      syncStoryDynamicCards();
      const parts = [];
      if (result.addedSkills.length) parts.push('技能+' + result.addedSkills.length);
      if (result.addedItems.length) parts.push('物品+' + result.addedItems.length);
      if (result.addedEquipment.length) parts.push('装备+' + result.addedEquipment.length);
      if (result.addedOther.length) parts.push('其他+' + result.addedOther.length);
      tavo.utils.toast('@记忆管理 已更新：' + (parts.join(' · ') || '状态'));
    } else {
      tavo.utils.toast('@记忆管理（关键词模式）：未识别到明确操作');
    }
    return;
  }

  // 模型 API 模式：调用 AI 记忆代理
  // 把指令塞进 state._pendingDirective，runMemoryAgent 读取它
  try {
    const state = readChatVar(NS) || defaultState();
    state._pendingDirective = rawText;
    tavo.set(NS, state, 'chat');
  } catch (e) {}
  tavo.utils.toast('@记忆管理 指令处理中…（模型 API 模式）');
  runMemoryAgent(m[2] || '')
    .catch(err => { console.warn('[tmm] directive failed', err); tavo.utils.toast('@记忆管理 执行异常'); });
});

_safeOn('message:added', async (event) => {
  console.log('[tmm][msg:added] role=' + ((event&&event.message&&event.message.role)||'?'));
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const msg = event && event.message;
  if (!msg || msg.role === 'system') return;
  // 指令类消息（被 input:beforeSend 拦截或交由事件管理器）不参与普通记忆刷新
  const text = String(msg.content || '').trim();
  if (DIRECTIVE_PREFIXES.some(p => text.startsWith(p))) return;
  if (msg.role !== 'user') return; // 仅按"用户发言"轮数推进，NPC/系统消息不计数

  const state = readChatVar(NS) || defaultState();
  state.turnsSinceRefresh = (state.turnsSinceRefresh || 0) + 1;
  tavo.set(NS, state, 'chat');

  const hardTrigger = cfg.triggerKeywords.some(k => text.includes(k));
  if (hardTrigger || state.turnsSinceRefresh >= cfg.refreshInterval) {
    await runMemoryAgent();
  }
});

// NOTE: 已移除 generation:prepare 注入记忆到请求的逻辑。
// 记忆插件通过 tavo.generate() 单独生成 JSON 结果存入 tmm 变量，
// 再由发言插件在 generation:prepare 里读取 tmm 注入。
// 原来的 generation:prepare 会把记忆输出注入给下轮生成，造成循环污染（记忆越注越多）。
// 世界书注入由编排插件统一负责（见 multi_character_stage entry.js）。

// ============================================================================
// 确定性关键词解析器（对齐 Toonflow PlayerMemoryDirectiveService.ts）
// 直接从 @记忆管理 指令提取物品/技能/装备/HP/MP/EXP，命中确定性规则直接落参数卡。
// 不调 AI，速度快，不耗 Token。
// ============================================================================

function scalarText(v) { return String(v == null ? '' : v).trim(); }
function uniqueTexts(arr) { return [...new Set(arr.filter(Boolean))]; }

function extractDirectiveBody(raw) {
  const m = String(raw || '').match(/^[＠@]\s*记忆管理\s*[:：]?\s*(.+)$/s);
  return scalarText(m ? m[1] : '');
}

function extractInventoryClause(body) {
  const keywords = ['藏有', '包括', '包含', '拥有', '获得', '收获', '得到', '展现', '展示', '里面有'];
  for (const kw of keywords) {
    const idx = body.lastIndexOf(kw);
    if (idx >= 0) {
      const tail = scalarText(body.slice(idx + kw.length));
      if (tail) return tail;
    }
  }
  return body;
}

function normalizeToken(token) {
  return scalarText(token)
    .replace(/^[（(][^）)]*[）)]/g, '')
    .replace(/^(这枚|这些|这批|其中|还有|以及|并有|并且有|并且|并|和|与)/g, '')
    .replace(/^(空间波动|戒指内|戒指内部|内部空间|物品|东西)/g, '')
    .replace(/(展现在你眼前|出现在你眼前|摆在眼前|静置其中|等物品?)$/g, '')
    .replace(/[。；;]+$/g, '').trim();
}

function splitTokens(body) {
  return extractInventoryClause(body)
    .split(/[，,、；;\n]/)
    .flatMap(s => s.split(/(?:以及|还有|并有|并且有|并且|和|与)/))
    .map(normalizeToken).filter(Boolean);
}

function isSkill(t) { return /(诀|决|功法|心法|身法|步|尺法|剑法|刀法|枪法|弓|甲|盾|鼎|炉|鞭|锤|杖|斧|匕|护)/.test(t) && t.length < 20; }
function isEquipment(t) { return /(戒指|剑|刀|枪|弓|甲|盾|鼎|炉|鞭|锤|杖|斧|匕|护腕|护符)/.test(t); }
function isItem(t) { return /(^[一二三四五六七八九十百千万两\d]+(?:颗|枚|个|把|本|瓶|件|份|套))|丹|石|魔核|药|卷|符|材料|矿石|晶核|药液|灵液|灵草|药草|果$/.test(t); }

function isRestoration(body) {
  return /((睡觉|睡眠|休息|住宿|过夜|调息))/ .test(body) && /((恢复|回满|满血|满蓝))/ .test(body);
}

function fullResource(level) { return 100 + Math.max(1, Math.floor(Number(level) || 1)) * 10; }

function applyKeywordDirective(state, rawText) {
  const body = extractDirectiveBody(rawText);
  if (!body) return null;
  const tokens = splitTokens(body);
  if (!tokens.length) return null;

  const addedSkills = [], addedItems = [], addedEquipment = [], addedOther = [];
  for (const t of tokens) {
    if (!t || t.length > 40) continue;
    if (isSkill(t)) { addedSkills.push(t); continue; }
    if (isEquipment(t)) { addedEquipment.push(t); continue; }
    if (isItem(t)) { addedItems.push(t); continue; }
    if (!/(空间|波动|展现|眼前|开阔)/.test(t)) addedOther.push(t);
  }

  const hasAny = addedSkills.length || addedItems.length || addedEquipment.length || addedOther.length;
  if (!hasAny) return null;

  const player = state.cards.player || {};
  if (isRestoration(body)) {
    player.hp = fullResource(player.level || 1);
    player.mp = fullResource(player.level || 1);
    if (!player.other) player.other = [];
    player.other = uniqueTexts([...player.other.filter(Boolean), '睡觉恢复']);
  }
  player.skills = uniqueTexts([...(player.skills || []), ...addedSkills]);
  player.items = uniqueTexts([...(player.items || []), ...addedItems]);
  player.equipment = uniqueTexts([...(player.equipment || []), ...addedEquipment]);
  player.other = uniqueTexts([...(player.other || []), ...addedOther]);
  state.cards.player = player;

  return { applied: true, body, addedSkills, addedItems, addedEquipment, addedOther };
}

// ============================================================================
// 意图识别模式：从 tf_story.edit.intentMode 读取
// ============================================================================

function getIntentMode() {
  try {
    const edit = readChatVar('tf_story.edit') || {};
    return edit.intentMode === 'model_api' ? 'model_api' : 'keyword';
  } catch (e) { return 'keyword'; }
}

_safeOnSide('tmm-refresh', async () => {
  await runMemoryAgent();
  tavo.utils.toast('记忆已刷新');
});

_safeOnSide('tmm-inspect', async () => {
  const state = readChatVar(NS);
  await tavo.message.append({
    content: '```\n' + JSON.stringify(state, null, 2) + '\n```',
    hidden: true,
  });
});

_safeOnSide('tmm-export', async () => {
  const state = readChatVar(NS);
  await tavo.file.export('memory.json', JSON.stringify(state, null, 2));
});
