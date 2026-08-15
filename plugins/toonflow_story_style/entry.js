// toonflow_story_style entry.js
// v1.3.0: 单条/多条切换改用 CSS class 控制（body.tf-style-single + data-tf-last 标记），
//          不再调 message API，彻底避免"是否允许修改聊天消息"权限弹框。
// 配套迁移：升级时一次性清空 v1.2.0 及之前残留的 hidden 标记。

'use strict';

const NS = 'tf_style';

function readMode() {
  try { return tavo.get(NS + '.mode') === 'single' ? 'single' : 'multi'; } catch (e) { return 'multi'; }
}

// 一次性迁移：v1.2.0 及之前用 message.update 标过 hidden=true 的消息，
// 现在用 CSS 控制可见性，需把所有 hidden 还原为 false，避免历史消息被永久隐藏。
// 用 'global' scope 而非 'chat'：每个聊天只迁移一次。
async function migrateClearHidden() {
  try {
    if (tavo.get('tf_style.migrated_v130') === '1') return;
  } catch (e) { return; }
  try {
    var n = await tavo.message.count();
    if (n && n > 0) {
      var msgs = await tavo.message.find([0, n - 1]);
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i] && msgs[i].hidden) {
          try { msgs[i].hidden = false; await tavo.message.update(msgs[i]); } catch (e) {}
        }
      }
    }
    try { tavo.set('tf_style.migrated_v130', '1', 'global'); } catch (e) {}
  } catch (e) {}
}

// 给聊天主页 DOM（window.parent）最新一条 .tav-item-message 打 data-tf-last 标记
// 配合 ui fragment 注入的 CSS：
//   body.tf-style-single .tav-item-message:not([data-tf-last]) .tav-bubble { display:none!important }
// 注意：Tavo 消息列表最新消息在顶部（scrollToCurrentBottom => scrollTo({top:0})），
// 故「最新」是 DOM 中纵向最靠上的一条，不能用 items[length-1]（那是最旧/第一条）。
function markLastBubble() {
  try {
    var doc = (window.parent && window.parent.document) ? window.parent.document : document;
    var old = doc.querySelectorAll('.tav-item-message[data-tf-last]');
    for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-tf-last');
    var items = Array.prototype.slice.call(doc.querySelectorAll('.tav-item-message'));
    if (!items.length) return;
    var top = items[0], topY = top.getBoundingClientRect().top;
    for (var j = 1; j < items.length; j++) {
      var y = items[j].getBoundingClientRect().top;
      if (y < topY) { topY = y; top = items[j]; }
    }
    top.setAttribute('data-tf-last', '');
  } catch (e) {}
}

tavo.plugin.on('chat:opened', async () => {
  await migrateClearHidden();
  if (readMode() === 'single') setTimeout(markLastBubble, 300);
});

tavo.plugin.on('message:added', async (event) => {
  if (event.message && event.message.role === 'system') return;
  if (readMode() !== 'single') return;
  setTimeout(markLastBubble, 50);
});

// 旧 sidebar actions（兼容）：不再做任何操作，UI 切换由 ui fragment 处理
tavo.plugin.onSidebarAction('tf-style-apply-single', async () => {});
tavo.plugin.onSidebarAction('tf-style-apply-multi', async () => {});