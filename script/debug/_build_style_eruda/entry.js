// toonflow_story_style entry.js
// 单条/多条显示模式：隐藏历史消息，message:added 确保时序正确。

'use strict';

const NS = 'tf_style';

function readMode() {
  try { return tavo.get(NS + '.mode') === 'single' ? 'single' : 'multi'; } catch (e) { return 'multi'; }
}

async function applySingle() {
  let n;
  try { n = await tavo.message.count(); } catch (e) { return; }
  if (!n || n < 1) return;
  if (n >= 2) {
    let msgs;
    try { msgs = await tavo.message.find([0, n - 2]); } catch (e) { msgs = []; }
    for (const m of msgs) {
      if (m && !m.hidden) {
        try { m.hidden = true; await tavo.message.update(m); } catch (e) {}
      }
    }
  }
  let last;
  try { last = (await tavo.message.find([n - 1, n - 1]))[0]; } catch (e) { last = null; }
  if (last && last.hidden) {
    try { last.hidden = false; await tavo.message.update(last); } catch (e) {}
  }
}

async function applyMulti() {
  let n;
  try { n = await tavo.message.count(); } catch (e) { return; }
  if (!n) return;
  let msgs;
  try { msgs = await tavo.message.find([0, n - 1]); } catch (e) { return; }
  for (const m of msgs) {
    if (m && m.hidden) {
      try { m.hidden = false; await tavo.message.update(m); } catch (e) {}
    }
  }
}

tavo.plugin.on('chat:opened', async () => {
  if (readMode() === 'single') await applySingle();
});

tavo.plugin.on('message:added', async (event) => {
  if (event.message && event.message.role === 'system') return;
  if (readMode() !== 'single') return;
  await applySingle();
});

tavo.plugin.onSidebarAction('tf-style-apply-single', async () => { await applySingle(); });
tavo.plugin.onSidebarAction('tf-style-apply-multi', async () => { await applyMulti(); });
