// toonflow_story_event_manager - entry.js
// 故事事件管理器（对齐设计图约束 #1：世界书 = 上下文注入，不是章节脚本）
//
// 彻底对齐后的行为：
// - 不再把世界书关键词条目当"章节"自动推进
// - 不再注入"场景切换至 XXX"等可见消息，不再弹 toast
// - 不再改动世界书 enabled 状态
// 仅作为只读状态面板：展示当前群聊绑定的世界书、在场角色、发言模式。

'use strict';

const NS = 'tf_event';

function getConfig() {
  const get = (k, fallback) => {
    const v = tavo.plugin.config.get(k);
    return v !== undefined && v !== null ? v : fallback;
  };
  return { enabled: get('enabled', true) !== false };
}

// 计算只读状态（不修改任何数据，世界书保持纯上下文注入）
async function computeStatus() {
  const chat = await tavo.chat.current();
  if (!chat) return null;
  return {
    lorebook_ids: (chat.lorebooks || []).map(l => l.id),
    lorebook_count: (chat.lorebooks || []).length,
    character_count: (chat.characters || []).length,
    responseMode: chat.responseMode || 'natural',
    updatedAt: Date.now(),
  };
}

tavo.plugin.on('chat:opened', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    const status = await computeStatus();
    if (status) tavo.set(NS, status, 'chat');
  } catch (e) {
    console.warn('[tf_event] compute status failed', e);
  }
});

tavo.plugin.onSidebarAction('tf-story-progress', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const status = await computeStatus();
  if (!status) {
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.noStory') || '未绑定聊天');
    return;
  }
  const msg = `【故事状态】
发言模式：${status.responseMode}
绑定世界书：${status.lorebook_count} 个
在场角色：${status.character_count} 个

（世界书为上下文注入，不自动推进章节）`;
  await tavo.message.append({ content: msg, hidden: true });
});

tavo.plugin.onSidebarAction('tf-story-restart', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    const status = await computeStatus();
    if (status) tavo.set(NS, status, 'chat');
    tavo.utils.toast(tavo.plugin.i18n.t('runtime.storyRestarted') || '状态已刷新');
  } catch (e) {
    console.warn('[tf_event] refresh failed', e);
  }
});
