// toonflow_story_event_manager - entry.js
// 故事事件管理器：追踪章节进度、评估完成条件、自动推进章节

'use strict';

const NS = 'tf_event';
const STORY_NS = 'tf_story';

let evaluating = false;

// ========== Config ==========
function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  return {
    enabled: get('enabled', true) !== false,
    autoAdvance: get('autoAdvance', true) === true,
    showPanel: get('showPanel', true) === true,
  };
}

// ========== Default State ==========
function defaultState() {
  return {
    worldbook_id: null,
    current_chapter: 0,
    chapters: [],
    progress: 0,
    started_at: 0,
    completed: false,
    message_counts: {},  // 角色对话计数
  };
}

// ========== Condition Parser ==========
// completion_condition 格式：
// "与萧炎对话3次;获得玄阶功法"
// "完成萧战的任务;获得金币500"

function parseCondition(text) {
  if (!text) return [];

  const conditions = [];
  const parts = text.split(/[;；]/);

  for (const part of parts) {
    const p = part.trim();

    // 对话 N 次
    const countMatch = p.match(/与?(.+?)对话(\d+)次/);
    if (countMatch) {
      conditions.push({
        type: 'count',
        target: countMatch[1].replace(/与/g, '').trim(),
        count: parseInt(countMatch[2]),
      });
      continue;
    }

    // 获得物品/功法
    const itemMatch = p.match(/获得(.+)/);
    if (itemMatch) {
      conditions.push({
        type: 'flag',
        item: itemMatch[1].trim(),
      });
      continue;
    }

    // 完成某个任务
    const taskMatch = p.match(/完成(.+?)(?:任务|目标)/);
    if (taskMatch) {
      conditions.push({
        type: 'task',
        task: taskMatch[1].trim(),
      });
      continue;
    }

    // 自定义条件（交给 AI 评估）
    conditions.push({
      type: 'custom',
      text: p,
    });
  }

  return conditions;
}

// ========== Condition Evaluator ==========
async function evaluateConditions(chapterIndex) {
  const state = tavo.get(STORY_NS) || defaultState();
  if (!state.worldbook_id || chapterIndex >= state.chapters.length) return true;

  const chapter = state.chapters[chapterIndex];
  if (!chapter || chapter.completed) return true;

  // 读取世界书获取完成条件
  let lorebook;
  try {
    lorebook = await tavo.lorebook.get(state.worldbook_id);
  } catch (e) {
    console.warn('[tf_event] failed to get lorebook', e);
    return true;
  }

  if (!lorebook || !lorebook.entries) return true;

  // 找到对应章节 entry
  const entry = lorebook.entries.find((e, i) =>
    e.name === chapter.name || i === chapterIndex
  );

  if (!entry) return true;

  const conditionText = entry.content?.match(/【完成条件】(.+)/)?.[1]
    || entry.completion_condition
    || '';

  const conditions = parseCondition(conditionText);
  if (conditions.length === 0) return true;

  // 读取记忆插件状态
  const memory = tavo.get('tmm') || {};
  const playerItems = memory.cards?.player?.items || [];
  const facts = memory.meta?.facts || [];

  let allPassed = true;
  const results = [];

  for (const cond of conditions) {
    let passed = false;

    switch (cond.type) {
      case 'count': {
        // 从 message_counts 读取
        const count = state.message_counts?.[cond.target] || 0;
        passed = count >= cond.count;
        results.push(`与${cond.target}对话 ${count}/${cond.count}次 ${passed ? '✓' : '✗'}`);
        break;
      }

      case 'flag': {
        // 查物品
        passed = playerItems.some(item =>
          item.includes(cond.item) || cond.item.includes(item)
        );
        results.push(`获得${cond.item} ${passed ? '✓' : '✗'}`);
        break;
      }

      case 'task': {
        // 查任务事实
        passed = facts.some(f =>
          f.includes(cond.task) || f.includes('完成') && f.includes(cond.task)
        );
        results.push(`完成${cond.task} ${passed ? '✓' : '✗'}`);
        break;
      }

      case 'custom': {
        // 交给 AI 评估
        const evalResult = await evaluateWithAI(cond.text, chapter.name);
        passed = evalResult.passed;
        results.push(`${cond.text} ${passed ? '✓' : '✗'}`);
        break;
      }
    }

    if (!passed) allPassed = false;
  }

  console.log('[tf_event] evaluation:', results);
  return allPassed;
}

async function evaluateWithAI(conditionText, chapterName) {
  const recentMsgs = await tavo.message.find([-5, -1]);
  const memory = tavo.get('tmm') || {};

  const prompt = `判断当前剧情是否满足完成条件。

章节：${chapterName}
完成条件：${conditionText}

最近对话：
${recentMsgs.map(m => `${m.characterName || m.role}：${m.content?.slice(0, 100)}`).join('\n')}

记忆摘要：${memory.meta?.summary || '无'}

请判断条件是否满足，只回答 JSON：
{"passed": true/false, "reason": "判断理由"}`;

  try {
    const result = await tavo.generate(prompt, { context: false });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('[tf_event] AI evaluation failed', e);
  }

  return { passed: false, reason: '评估失败' };
}

// ========== Chapter Advancement ==========
async function advanceChapter() {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.autoAdvance) return;

  const state = tavo.get(STORY_NS) || defaultState();
  if (state.completed) return;
  if (state.current_chapter >= state.chapters.length - 1) {
    // 所有章节完成
    state.completed = true;
    tavo.set(STORY_NS, state, 'chat');
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.storyCompleted'));
    return;
  }

  const nextIndex = state.current_chapter + 1;
  const nextChapter = state.chapters[nextIndex];

  if (!nextChapter) return;

  // 标记当前章节完成
  state.chapters[state.current_chapter].completed = true;
  state.chapters[state.current_chapter].completed_at = Date.now();

  // 推进到下一章节
  state.current_chapter = nextIndex;
  state.progress = Math.round((nextIndex / state.chapters.length) * 100);

  // 开启下一章节的 worldbook entry
  try {
    const lorebook = await tavo.lorebook.get(state.worldbook_id);
    if (lorebook && lorebook.entries) {
      // 关闭当前章节 entry
      lorebook.entries[state.current_chapter - 1] = {
        ...lorebook.entries[state.current_chapter - 1],
        enabled: false,
      };
      // 开启下一章节 entry
      if (lorebook.entries[nextIndex]) {
        lorebook.entries[nextIndex].enabled = true;
        await tavo.lorebook.update({
          id: state.worldbook_id,
          entries: lorebook.entries,
        });
      }
    }
  } catch (e) {
    console.warn('[tf_event] failed to update lorebook', e);
  }

  // 注入章节切换旁白
  await tavo.message.append({
    content: `（场景切换至 ${nextChapter.name}）`,
    hidden: false,
  });

  // 更新变量
  state.message_counts = {};  // 重置计数
  tavo.set(STORY_NS, state, 'chat');

  tavo.utils.toast(tavo.plugin.i18n.t('runtime.chapterAdvanced', { chapter: nextChapter.name }));
}

// ========== Story Initialization ==========
async function initStory() {
  const chat = await tavo.chat.current();
  if (!chat || !chat.lorebooks?.length) {
    console.log('[tf_event] no lorebook bound to chat');
    return;
  }

  const lorebookId = chat.lorebooks[0].id;

  // 读取世界书
  let lorebook;
  try {
    lorebook = await tavo.lorebook.get(lorebookId);
  } catch (e) {
    console.warn('[tf_event] failed to get lorebook', e);
    return;
  }

  if (!lorebook || !lorebook.entries) return;

  // 提取章节（排除 constant 的世界规则）
  const chapters = [];
  for (const entry of lorebook.entries) {
    if (entry.strategy === 'constant') continue;
    chapters.push({
      name: entry.name,
      content: entry.content,
      completed: false,
      started_at: 0,
    });
  }

  if (chapters.length === 0) {
    console.log('[tf_event] no chapters found in lorebook');
    return;
  }

  const state = {
    worldbook_id: lorebookId,
    current_chapter: 0,
    chapters,
    progress: 0,
    started_at: Date.now(),
    completed: false,
    message_counts: {},
  };

  // 开启第一章
  if (lorebook.entries && lorebook.entries[0]) {
    lorebook.entries[0].enabled = true;
    try {
      await tavo.lorebook.update({
        id: lorebookId,
        entries: lorebook.entries,
      });
    } catch (e) {
      console.warn('[tf_event] failed to enable first chapter', e);
    }
  }

  tavo.set(STORY_NS, state, 'chat');
  console.log('[tf_event] story initialized:', state);
}

// ========== Message Counter ==========
function countMessage(roleName) {
  const state = tavo.get(STORY_NS) || defaultState();
  if (!state.message_counts) state.message_counts = {};

  const key = roleName || 'unknown';
  state.message_counts[key] = (state.message_counts[key] || 0) + 1;

  tavo.set(STORY_NS, state, 'chat');
}

// ========== Hooks ==========

tavo.plugin.on('chat:opened', async () => {
  await initStory();
});

tavo.plugin.on('message:added', async (event) => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (event.message?.role === 'system') return;

  // 计数
  const roleName = event.message.characterName || event.message.role;
  countMessage(roleName);

  // 评估完成条件
  if (evaluating) return;
  evaluating = true;

  try {
    const passed = await evaluateConditions(
      (tavo.get(STORY_NS) || defaultState()).current_chapter
    );

    if (passed) {
      await advanceChapter();
    }
  } catch (e) {
    console.warn('[tf_event] evaluation failed', e);
  } finally {
    evaluating = false;
  }
});

// ========== Sidebar Actions ==========

tavo.plugin.onSidebarAction('tf-story-progress', async () => {
  const state = tavo.get(STORY_NS);
  if (!state || !state.chapters?.length) {
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.noStory'));
    return;
  }

  const current = state.chapters[state.current_chapter];
  const progress = `${state.current_chapter + 1}/${state.chapters.length}`;

  let msg = `【故事进度】\n`;
  msg += `当前：${current?.name || '未知'}\n`;
  msg += `进度：${progress}\n`;

  if (current) {
    msg += `已完成：${state.chapters.slice(0, state.current_chapter).length} 章`;
  }

  await tavo.message.append({ content: msg, hidden: true });
});

tavo.plugin.onSidebarAction('tf-story-restart', async () => {
  const state = tavo.get(STORY_NS);
  if (!state) {
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.noStory'));
    return;
  }

  // 重置状态
  for (const ch of state.chapters) {
    ch.completed = false;
    ch.started_at = 0;
    ch.completed_at = 0;
  }

  state.current_chapter = 0;
  state.progress = 0;
  state.completed = false;
  state.started_at = Date.now();
  state.message_counts = {};

  // 重置世界书 entry
  try {
    const lorebook = await tavo.lorebook.get(state.worldbook_id);
    if (lorebook && lorebook.entries) {
      for (const entry of lorebook.entries) {
        entry.enabled = entry.strategy === 'constant';
      }
      await tavo.lorebook.update({
        id: state.worldbook_id,
        entries: lorebook.entries,
      });
    }
  } catch (e) {
    console.warn('[tf_event] failed to reset lorebook', e);
  }

  tavo.set(STORY_NS, state, 'chat');
  tavo.utils.toast(tavo.plugin.i18n.t('runtime.storyRestarted'));
});