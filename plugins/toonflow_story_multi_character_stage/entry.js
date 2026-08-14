// toonflow_story_multi_character_stage - entry.js
// 多人角色故事台：为 tavo 群聊提供有编排的多角色叙事

'use strict';

const NS = 'mcs';
let orchestrating = false;

// ========== Config ==========
function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  const getNum = (k, fallback) => Number(get(k, fallback)) || fallback;

  return {
    enabled: get('enabled', true) !== false,
    npcAutoTurn: get('npcAutoTurn', true) === true,
    npcAutoInterval: getNum('npcAutoInterval', 3),
    memoryIntegration: get('memoryIntegration', true) === true,
    speakerMode: get('speakerMode', 'auto'),
    dialogueHistoryLimit: getNum('dialogueHistoryLimit', 20),
  };
}

// ========== Default State ==========
function defaultState() {
  return {
    version: 1,
    config: {
      enabled: true,
      npcAutoTurn: true,
      npcAutoInterval: 3,
    },
    context: {
      currentSpeaker: null,
      areaContext: {
        mainArea: '默认场景',
        activeRoles: [],
        remoteRoles: [],
        exceptionRoles: [],
      },
      dialogueHistory: [],
      turnsSinceUserInput: 0,
      pendingSpeakers: [],
    },
    characters: {},
  };
}

// ========== T0 Templates ==========
const T0_TEMPLATES = {
  narrator_enter: [
    '（场景中弥漫着某种氛围）',
    '（空气中似有暗流涌动）',
    '（周围安静得有些异常）',
  ],
  narrator_atmosphere: [
    '（微风拂过，带起一阵轻响）',
    '（远处的喧嚣隐约可闻）',
    '（时间仿佛在这一刻静止）',
  ],
  wildcard_reaction: [
    '（人群中传来低语）',
    '（有人不自觉地看了过来）',
  ],
};

// ========== Speaker Route Engine ==========
function decideSpeaker(state, cfg, userMessage) {
  const { dialogueHistory, areaContext, turnsSinceUserInput, pendingSpeakers } = state.context;
  const lastMsg = dialogueHistory[dialogueHistory.length - 1];

  // 1. 如果有 pending speakers，先处理
  if (pendingSpeakers.length > 0) {
    const next = pendingSpeakers.shift();
    state.context.pendingSpeakers = pendingSpeakers;
    return { ...next, mode: 'sequential' };
  }

  // 2. 检查用户是否直接 @ 指定角色
  const atMatch = userMessage?.match(/@(\S+)/);
  if (atMatch) {
    const targetRole = atMatch[1];
    // 检查是否在激活角色中
    if (areaContext.activeRoles.some(r => r.includes(targetRole) || targetRole.includes(r))) {
      return {
        role: targetRole,
        motive: '回应用户的询问',
        mode: 'direct',
      };
    }
  }

  // 3. 如果用户刚发言，选择一个合理的 NPC 回应
  if (lastMsg?.isUserMessage) {
    const activeNpcs = areaContext.activeRoles.filter(r =>
      r !== '用户' && r !== lastMsg?.role && !r.includes('旁白')
    );
    if (activeNpcs.length > 0) {
      // 选择最近发言最少的 NPC
      const npcStats = activeNpcs.map(name => {
        const char = Object.values(state.characters || {}).find(c => c.name === name);
        return { name, speakingCount: char?.speakingCount || 0, lastSpokeAt: char?.lastSpokeAt || 0 };
      }).sort((a, b) => {
        if (a.speakingCount !== b.speakingCount) return a.speakingCount - b.speakingCount;
        return a.lastSpokeAt - b.lastSpokeAt;
      });

      return {
        role: npcStats[0].name,
        motive: '自然回应用户的发言',
        mode: 'normal',
      };
    }
  }

  // 4. NPC 自主发言
  if (cfg.npcAutoTurn && turnsSinceUserInput >= cfg.npcAutoInterval) {
    const activeNpcs = areaContext.activeRoles.filter(r =>
      r !== '用户' && !r.includes('旁白')
    );
    if (activeNpcs.length > 0) {
      const npc = activeNpcs[Math.floor(Math.random() * activeNpcs.length)];
      return {
        role: npc,
        motive: '推动剧情发展',
        mode: 'auto',
      };
    }
  }

  // 5. 默认旁白（轻量承接）
  return { role: '旁白', motive: '承接剧情氛围', mode: 'fast' };
}

// ========== Speaker Agent ==========
function generateNarratorTemplate(motive) {
  // 根据动机选择合适的模板
  if (motive.includes('进入') || motive.includes('场景')) {
    return T0_TEMPLATES.narrator_enter[Math.floor(Math.random() * T0_TEMPLATES.narrator_enter.length)];
  }
  return T0_TEMPLATES.narrator_atmosphere[Math.floor(Math.random() * T0_TEMPLATES.narrator_atmosphere.length)];
}

async function generateSpeech(speaker, motive, mode, state, cfg) {
  // T0 模板模式
  if (mode === 'fast' && (speaker === '旁白' || speaker.includes('旁白'))) {
    return generateNarratorTemplate(motive);
  }

  // 构建提示词
  const memory = cfg.memoryIntegration ? (tavo.get('tmm') || {}) : {};
  const recentDialogue = state.context.dialogueHistory.slice(-5);

  let systemPrompt = `你是角色发言器。
根据给定的角色和动机，生成一句自然的角色台词。

要求：
- 简洁有力，1-3 句话
- 符合角色性格和当前情境
- 不要重复最近说过的内容

`;

  let userPrompt = `【角色】
${speaker}

【发言动机】
${motive}

【最近对话】
${recentDialogue.map(d => `${d.role}：${d.content}`).join('\n') || '（暂无）'}

`;

  // 如果有记忆，注入记忆摘要
  if (memory.meta?.summary) {
    userPrompt += `【记忆摘要】
${memory.meta.summary}

`;
  }

  userPrompt += `【任务】
生成该角色的一句台词。`;

  try {
    const raw = await tavo.generate(systemPrompt + '\n\n' + userPrompt, {
      context: false,
      settings: { temperature: 0.7, max_tokens: 200 },
    });

    return parseSpeakerOutput(raw, speaker);
  } catch (e) {
    console.warn('[mcs] generateSpeech failed', e);
    // 兜底
    if (speaker === '旁白' || speaker.includes('旁白')) {
      return generateNarratorTemplate(motive);
    }
    return `${speaker}：...`;
  }
}

function parseSpeakerOutput(raw, speaker) {
  if (!raw) return `${speaker}：...`;

  let text = String(raw).trim();
  // 去除代码块
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  text = text.replace(/^["']|["']$/g, '').trim();

  if (!text) return `${speaker}：...`;

  // 如果没有角色名前缀，加上
  if (!text.includes(speaker) && !text.startsWith('（')) {
    text = `${speaker}：${text}`;
  }

  return text;
}

// ========== Orchestrator ==========
async function orchestrate(userMessage) {
  if (orchestrating) return;
  orchestrating = true;

  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;

    const state = tavo.get(NS) || defaultState();

    // 决定发言者
    const decision = decideSpeaker(state, cfg, userMessage);

    // 生成台词
    const speech = await generateSpeech(decision.role, decision.motive, decision.mode, state, cfg);

    // 更新角色状态
    const charKey = Object.keys(state.characters || {}).find(k =>
      state.characters[k].name === decision.role
    );
    if (charKey) {
      state.characters[charKey].speakingCount = (state.characters[charKey].speakingCount || 0) + 1;
      state.characters[charKey].lastSpokeAt = Date.now();
    } else {
      // 如果角色不在列表中，添加
      const newKey = 'char_' + Date.now();
      state.characters[newKey] = {
        name: decision.role,
        type: decision.role.includes('旁白') ? 'narrator' : 'npc',
        speakingCount: 1,
        lastSpokeAt: Date.now(),
      };
    }

    // 记录对话
    state.context.currentSpeaker = decision.role;
    state.context.dialogueHistory.push({
      role: decision.role,
      content: speech,
      timestamp: Date.now(),
      speakerMode: decision.mode,
      isUserMessage: false,
    });

    // 限制历史长度
    if (state.context.dialogueHistory.length > cfg.dialogueHistoryLimit) {
      state.context.dialogueHistory = state.context.dialogueHistory.slice(-cfg.dialogueHistoryLimit);
    }

    // 重置无用户发言计数（因为我们现在生成了 NPC 发言）
    // 不重置，让计数累积直到用户发言

    tavo.set(NS, state, 'chat');

    // 写入对话（作为隐藏消息，或者如果需要可以改为可见）
    await tavo.message.append({
      content: speech,
      hidden: false,
    });

  } catch (e) {
    console.warn('[mcs] orchestrate failed', e);
  } finally {
    orchestrating = false;
  }
}

// ========== Intent Detection ==========
function detectAreaChange(userMessage) {
  const movePatterns = [
    /去(.{1,20}?)(?:那里|地方|场景)/,
    /来到(.{1,20}?)/,
    /走到(.{1,20}?)/,
    /进入(.{1,20}?)/,
    /来到(.{1,20}?)的/,
  ];

  for (const pattern of movePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// ========== Injection Context ==========
function buildInjectionContext(state, cfg) {
  const { areaContext, dialogueHistory } = state.context;
  const memory = cfg.memoryIntegration ? (tavo.get('tmm') || {}) : {};

  let context = '【故事台上下文】\n';

  // 区域信息
  context += `当前区域：${areaContext.mainArea}\n`;
  if (areaContext.activeRoles.length > 0) {
    context += `在场角色：${areaContext.activeRoles.join('、')}\n`;
  }

  // 最近对话（限制）
  if (dialogueHistory.length > 0) {
    const recent = dialogueHistory.slice(-3);
    context += `最近对话：\n${recent.map(d => `${d.role}：${d.content.slice(0, 50)}${d.content.length > 50 ? '...' : ''}`).join('\n')}\n`;
  }

  // 记忆摘要
  if (memory.meta?.summary) {
    context += `【记忆摘要】\n${memory.meta.summary.slice(0, 200)}\n`;
  }

  return context;
}

// ========== Initialize ==========
async function initActiveRoles() {
  try {
    const chars = await tavo.character.find({});
    const state = tavo.get(NS) || defaultState();

    state.context.areaContext.activeRoles = chars.map(c => c.name);
    state.characters = {};

    for (const c of chars) {
      state.characters[c.id] = {
        name: c.name,
        type: c.roleType || 'npc',
        isKey: false,
        speakingCount: 0,
        lastSpokeAt: 0,
      };
    }

    tavo.set(NS, state, 'chat');
  } catch (e) {
    console.warn('[mcs] initActiveRoles failed', e);
  }
}

// ========== Hooks ==========

// 聊天打开时初始化
tavo.plugin.on('chat:opened', async () => {
  const state = tavo.get(NS);
  if (!state || state.version !== 1) {
    tavo.set(NS, defaultState(), 'chat');
  }
  await initActiveRoles();
});

// 用户发送消息前
tavo.plugin.on('input:beforeSend', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  const text = (event.text || '').trim();

  // 检测区域切换
  const newArea = detectAreaChange(text);
  if (newArea) {
    const state = tavo.get(NS) || defaultState();
    state.context.areaContext.mainArea = newArea;
    // 区域切换时可以考虑重置角色列表
    tavo.set(NS, state, 'chat');
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.areaChanged', { area: newArea }));
  }
});

// 消息添加后
tavo.plugin.on('message:added', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (event.message?.role === 'system') return;

  const state = tavo.get(NS) || defaultState();

  // 记录对话
  const roleName = event.message.characterName || event.message.role || '未知';
  const isUser = event.message.role === 'user';

  state.context.dialogueHistory.push({
    role: roleName,
    content: event.message.content || '',
    timestamp: Date.now(),
    speakerMode: 'user',
    isUserMessage: isUser,
  });

  // 限制历史长度
  if (state.context.dialogueHistory.length > cfg.dialogueHistoryLimit) {
    state.context.dialogueHistory = state.context.dialogueHistory.slice(-cfg.dialogueHistoryLimit);
  }

  // 更新无用户发言计数
  if (isUser) {
    state.context.turnsSinceUserInput = 0;
  } else {
    state.context.turnsSinceUserInput++;
  }

  tavo.set(NS, state, 'chat');

  // 用户消息后触发编排（需要 NPC 回应）
  if (isUser) {
    await orchestrate(event.message.content);
  }
});

// 生成准备时注入上下文
tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  const state = tavo.get(NS);
  if (!state) return;

  const inject = buildInjectionContext(state, cfg);
  if (inject) {
    event.text = inject + '\n\n---\n' + (event.text || '');
  }
});

// ========== Sidebar Actions ==========
tavo.plugin.onSidebarAction('mcs-toggle', async () => {
  const cfg = getConfig();
  const newEnabled = !cfg.enabled;

  // 更新设置
  tavo.plugin.config.set('enabled', newEnabled);

  // 更新状态
  const state = tavo.get(NS) || defaultState();
  state.config.enabled = newEnabled;
  tavo.set(NS, state, 'chat');

  tavo.utils.toast(tavo.plugin.i18n.t(newEnabled ? 'runtime.enabled' : 'runtime.disabled'));
});

tavo.plugin.onSidebarAction('mcs-area', async () => {
  const state = tavo.get(NS);
  if (state) {
    await tavo.message.append({
      content: `当前区域：${state.context.areaContext.mainArea}\n在场角色：${state.context.areaContext.activeRoles.join('、') || '无'}`,
      hidden: true,
    });
  }
});

tavo.plugin.onSidebarAction('mcs-status', async () => {
  const state = tavo.get(NS);
  if (state) {
    const status = `故事台状态：
- 启用：${state.config.enabled}
- NPC 自主发言：${state.config.npcAutoTurn}
- 无用户发言 ${state.context.turnsSinceUserInput} 轮
- 待发言队列：${state.context.pendingSpeakers.length}
- 当前发言者：${state.context.currentSpeaker || '无'}`;
    await tavo.message.append({ content: status, hidden: true });
  }
});