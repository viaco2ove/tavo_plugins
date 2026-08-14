// toonflow_story_event_manager - entry.js
// 故事事件管理器（对齐设计图约束 #1：世界书 = 上下文注入，不是章节脚本）
//
// UI 形态（参照 toonflow-game 的「故事信息」面板，非浮动）：
// - 触发按钮直接画在聊天页顶部（ui/story_panel.html，挂载 /chat/body/start），非浮动、始终可见
// - 点击按钮 → 就地展开右侧抽屉面板，展示角色信息（头像/名/参数）与故事参数
// 不注入可见消息、不弹 toast、不改动世界书 enabled。
//
// 本插件不再使用 sidebar 贡献：侧边栏事件只派发给 entry handler，HTML 片段收不到，
// 会导致「点按钮无反应」。故触发器改为片段内自带按钮，逻辑全在 story_panel.html 内闭环。

'use strict';
