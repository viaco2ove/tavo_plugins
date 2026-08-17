'use strict';
// eruda debug plugin - 默认隐藏，sidebar 按钮手动切换
console.log('[eruda-debug] plugin entry loaded');

tavo.plugin.onSidebarAction('eruda-toggle', () => {
  try {
    if (window.eruda && window.eruda._isInit) {
      var el = document.getElementById('eruda-box');
      if (el) {
        var show = el.style.display === 'none';
        el.style.display = show ? 'block' : 'none';
        tavo.utils.toast(show ? 'eruda 已显示' : 'eruda 已隐藏');
      }
    } else {
      tavo.utils.toast('eruda 未初始化');
    }
  } catch(e) { tavo.utils.toast('切换失败'); }
});