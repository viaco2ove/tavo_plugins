// toonflow_story_style - 气泡样式插件入口
// 实际 UI 与样式逻辑在 ui/story_style_panel.html（聊天 UI 片段 runtime）中实现。
// 此处仅提供最低限度的生命周期钩子，避免 manifest 引用缺失 entry 导致安装失败。
module.exports = {
  async onSidebarAction() {},
  async onEnable() {},
  async onDisable() {},
};
