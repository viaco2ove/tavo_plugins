// toonflow_story_speaker - entry.js
// 角色发言插件：读取角色设定、记忆、故事状态，注入到生成请求

'use strict';

const NS = 'tf_speaker';

function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  return {
    enabled: get('enabled', true) !== false,
    temperature: parseFloat(get('temperature', 0.7)) || 0.7,
    maxTokens: parseInt(get('maxTokens', 200)) || 200,
  };
}

// ========== 获取当前发言角色 ==========
async function getCurrentSpeaker() {
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) return null;

    // 取最近的消息，判断说话人
    const msgs = await tavo.message.find([-3, -1]);
    const lastMsg = msgs[msgs.length - 1];

    if (lastMsg && lastMsg.characterId) {
      try {
        return await tavo.character.get(lastMsg.characterId);
      } catch (e) {}
    }

    // 兜底：返回第一个角色
    if (chat.characters[0]) {
      try {
        return await tavo.character.get(chat.characters[0].id);
      } catch (e) {}
    }

    return null;
  } catch (e) {
    console.warn('[tf_speaker] getCurrentSpeaker failed', e);
    return null;
  }
}

// ========== 构建发言上下文 ==========
function buildSpeakerContext(character, cfg) {
  const memory = tavo.get('tmm') || {};
  const storyState = tavo.get('tf_story') || {};

  let context = '';

  // 角色设定
  if (character) {
    context += `【当前角色】
名称: ${character.name}
`;

    if (character.personality) {
      context += `性格: ${character.personality}
`;
    }
    if (character.description) {
      context += `设定: ${character.description.slice(0, 150)}
`;
    }

    // 角色状态（如果有）
    if (memory.cards?.npcs) {
      const npcCard = memory.cards.npcs[character.name];
      if (npcCard) {
        const parts = [];
        if (npcCard.level) parts.push(`Lv.${npcCard.level}`);
        if (npcCard.hp) parts.push(`HP ${npcCard.hp}`);
        if (npcCard.role_key_information) parts.push(npcCard.role_key_information);
        if (parts.length) context += `状态: ${parts.join(' | ')}\n`;
      }
    }
  }

  // 记忆摘要
  if (memory.meta?.summary) {
    context += `
【剧情记忆】
${memory.meta.summary.slice(0, 200)}
`;
  }

  // 故事章节
  if (storyState.current_chapter !== undefined && storyState.chapters?.length) {
    const ch = storyState.chapters[storyState.current_chapter];
    if (ch) {
      context += `
【当前章节】${ch.name}
`;
    }
  }

  context += `
【发言要求】
- 简洁自然，2-3句
- 符合角色性格
- 推动剧情发展
- 不要重复最近说过的内容
`;

  return context;
}

// ========== 生成角色台词 ==========
async function generateSpeech(character, context) {
  const cfg = getConfig();

  // 获取最近对话
  const recentMsgs = await tavo.message.find([-5, -1]);
  const dialogue = recentMsgs.map(m =>
    `${m.characterName || (m.role === 'user' ? '用户' : 'NPC')}: ${m.content?.slice(0, 100) || ''}`
  ).join('\n');

  const prompt = `${context}

【最近对话】
${dialogue}

【任务】
以 ${character?.name || '角色'} 的身份，生成一句自然台词。`;

  const result = await tavo.generate(prompt, {
    context: false,
    settings: {
      temperature: cfg.temperature,
      maxCompletionTokens: cfg.maxTokens,
    },
  });

  return result;
}

// ========== Hooks ==========

// 生成前注入角色上下文
tavo.plugin.on('generation:prepare', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  const speaker = await getCurrentSpeaker();
  const context = buildSpeakerContext(speaker, cfg);

  if (context) {
    event.text = context + '\n---\n' + (event.text || '');
  }
});

// 生成成功后可以记录发言
tavo.plugin.on('generation:success', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  // 记录到发言历史
  try {
    const history = tavo.get(NS + '.history') || [];
    const speaker = await getCurrentSpeaker();

    history.push({
      role: speaker?.name || 'unknown',
      content: (event.text || '').slice(0, 200),
      at: new Date().toISOString(),
    });

    // 只保留最近 20 条
    if (history.length > 20) history.shift();

    tavo.set(NS + '.history', history, 'chat');
  } catch (e) {
    console.warn('[tf_speaker] record failed', e);
  }
});

// ========== Sidebar Actions ==========

// 测试发言
tavo.plugin.onSidebarAction('speaker-test', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) {
    tavo.utils.toast('发言插件未启用');
    return;
  }

  const speaker = await getCurrentSpeaker();
  if (!speaker) {
    tavo.utils.toast('未找到发言角色');
    return;
  }

  const context = buildSpeakerContext(speaker, cfg);
  const speech = await generateSpeech(speaker, context);

  await tavo.message.append({
    content: speech,
    hidden: true,
  });
});

// 角色列表
tavo.plugin.onSidebarAction('speaker-char', async () => {
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) {
      tavo.utils.toast('当前聊天无角色');
      return;
    }

    let msg = '【当前角色列表】\n';
    for (const c of chat.characters) {
      const char = await tavo.character.get(c.id);
      msg += `- ${char?.name || c.name} (${char?.personality?.slice(0, 30) || '无设定'})\n`;
    }

    await tavo.message.append({ content: msg, hidden: true });
  } catch (e) {
    console.warn('[tf_speaker] list failed', e);
  }
});