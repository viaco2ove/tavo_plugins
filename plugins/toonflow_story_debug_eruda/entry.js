'use strict';
// eruda debug plugin - 默认隐藏，sidebar 按钮手动切换
console.log('[eruda-debug] plugin entry loaded');

// eruda 入口按钮位置：左下角
function _resetErudaBtnPos() {
  var btn = document.querySelector('.eruda-entry-btn');
  if (btn) {
    btn.style.left = 'auto';
    btn.style.top = 'auto';
    btn.style.bottom = '50px';
    btn.style.right = '10px';
    btn.style.position = 'fixed';
  }
}

tavo.plugin.onSidebarAction('eruda-toggle', () => {
  try {
    if (window.eruda && window.eruda._isInit) {
      var el = document.getElementById('eruda-box');
      if (el) {
        var show = el.style.display === 'none';
        el.style.display = show ? 'block' : 'none';
        _resetErudaBtnPos();
        tavo.utils.toast(show ? 'eruda 已显示' : 'eruda 已隐藏');
      }
    } else {
      tavo.utils.toast('eruda 未初始化');
    }
  } catch(e) { tavo.utils.toast('切换失败'); }
});

// 页面加载后也重置一次（以防按钮在 eruda-toggle 之前就被拖动过）
window.addEventListener('load', _resetErudaBtnPos);