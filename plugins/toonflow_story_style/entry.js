// toonflow_story_style entry.js
// v1.3.0: 单条/多条切换改用 CSS class 控制（body.tf-style-single），不再调 message API，
//          彻底避免"是否允许修改聊天消息"权限弹框。v1.3.3 起单条可见性完全由 CSS 选择器
//          （.kuibao-list-item:first-child）控制，连 data-tf-last 标记都不再需要。
// 配套迁移：升级时一次性清空 v1.2.0 及之前残留的 hidden 标记。

'use strict';

const NS = 'tf_style';

// tavo.get 返回包装对象 {target,name,found,value}，真实值在 .value。
// 不解包会让 === 'single' 永远为 false（模式切换失效）、迁移标记永远读不到（每次开聊天都重跑迁移）。
function readVar(name, target) {
  let v = null;
  try { v = tavo.get(name, target || 'chat'); } catch (e) { return null; }
  let guard = 0;
  while (v && typeof v === 'object' && !Array.isArray(v)
         && Object.prototype.hasOwnProperty.call(v, 'value')
         && Object.prototype.hasOwnProperty.call(v, 'name')
         && guard < 5) {
    if (v.found === false) return null;
    v = v.value;
    guard += 1;
  }
  return v;
}

function readMode() {
  try { return readVar(NS + '.mode') === 'single' ? 'single' : 'multi'; } catch (e) { return 'multi'; }
}

// 一次性迁移：v1.2.0 及之前用 message.update 标过 hidden=true 的消息，
// 现在用 CSS 控制可见性，需把所有 hidden 还原为 false，避免历史消息被永久隐藏。
// 用 'global' scope 而非 'chat'：每个聊天只迁移一次。
async function migrateClearHidden() {
  try {
    if (String(readVar('tf_style.migrated_v130', 'global')) === '1') return;
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

// 单条模式可见性完全由 ui fragment 注入的 CSS 控制（body.tf-style-single + .kuibao-list-item 选择器），
// 无需 JS 标记、无需 message API。这里只保留一次性迁移逻辑。

tavo.plugin.on('chat:opened', async () => {
  await migrateClearHidden();
});

// 旧 sidebar actions（兼容）：不再做任何操作，UI 切换由 ui fragment 处理
tavo.plugin.onSidebarAction('tf-style-apply-single', async () => {});
tavo.plugin.onSidebarAction('tf-style-apply-multi', async () => {});