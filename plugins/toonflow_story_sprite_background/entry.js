'use strict';
// toonflow_story_sprite_background - entry.js
// 注册 sidebar actions，HTML 片段包含完整渲染逻辑

// 立绘开关
tavo.plugin.onSidebarAction('tf-sprite-toggle', () => {
  try {
    const current = tavo.plugin.config.get('enabled');
    tavo.plugin.config.set('enabled', current ? false : true);
    tavo.utils.toast(current ? '立绘已关闭' : '立绘已开启');
  } catch (e) {
    tavo.utils.toast('立绘切换失败');
  }
});

// 立绘绑定编辑器（唤起 HTML 里嵌入的绑定面板）
tavo.plugin.onSidebarAction('tf-sprite-bind', () => {
  try {
    if (typeof window.__tfSpriteBindRender === 'function') {
      window.__tfSpriteBindRender();
    }
    // 面板已在 ui/sprite_layer.html 里预设好，sidebar 点击只做渲染触发
    tavo.utils.toast('立绘绑定编辑器已刷新');
  } catch (e) {
    tavo.utils.toast('打开绑定编辑器失败');
  }
});
