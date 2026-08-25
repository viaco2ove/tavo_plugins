
1. 谁写 tf_progress.phases

chat:opened 时只更新 updatedAt，不解析 phases。phases 是在两个时机写入的：

- judgeAndAdvance()（message:added hook，用户发言后）—— 从当前章节 content 解析 phases + 写入
- tfEventProgress_advance()（外部调用）—— 推进后写入

---

2. 为什么 UI 看不见事件列表

根本原因：panel 只在打开时渲染一次，不会跟着 tf_progress 更新而刷新。

用户打开 panel → renderSheet() → 读 tf_progress（此时 phases 可能还是空的）
     ↓
用户发消息 → judgeAndAdvance() → tf_progress.phases 被写入
     ↓
panel 永远是第一次打开时的快照，不会重新读 tf_progress

所以：
- 如果 message:added 还没跑过（boot 没 ready），phases 一直是空的
- panel 打开时 phases 是空的，UI 就显示空的事件列表，之后即使 phases 被写入了，panel 也不会更新

---

3. 解决方向

两条路：

方案 A：panel 打开后定时重新渲染（polling）
// panel 初始化时加一个 setInterval，每 3s 重新读 tf_progress 并更新事件列表
setInterval(() => {
  var p = readVarDualScope(progressNs(), progressNsGlobal());
  if (p && p.phases && p.phases.length) {
    // 更新 #tf-events-list 的内容，不重绘整个 panel
  }
}, 3000);

方案 B：message:added 后通知 panel 刷新
// entry.js 写入 tf_progress 后，触发事件
window.dispatchEvent(new CustomEvent('tf_progress_updated', { detail: progress }));

// panel 监听这个事件，收到后重新读 tf_progress 更新 UI
window.addEventListener('tf_progress_updated', (e) => { updateEventsList(e.detail); });

方案 C：panel 每次切换 tab/展开折叠时重新读（不重绘整个 body，只更新变化的部分）