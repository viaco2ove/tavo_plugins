## issue 诚实回答

---

### 1. 能否局域网 API 让 Workbddy 等工具直接为安卓手机的 tavo 创建故事和角色甚至是章节和世界书、备份数据等

**部分可以，但"故事"和"章节"做不到**。

tavo MCP 只能调用官方暴露的工具函数。tavo 的数据模型里**根本没有"故事"和"章节"这两个实体**：

| 数据类型 | tavo 是否有 | MCP 能创建吗 |
|----------|-------------|--------------|
| 角色 | ✅ 有 | ✅ 可以 |
| 世界书 | ✅ 有 | ✅ 可以 |
| 预设 | ✅ 有 | ✅ 可以 |
| 正则 | ✅ 有 | ✅ 可以 |
| 用户身份 | ✅ 有 | ✅ 可以 |
| 聊天 | ✅ 有 | ✅ 可以 |
| 消息 | ✅ 有 | ✅ 可以 |
| **故事** | ❌ **没有** | ❌ **做不到** |
| **章节** | ❌ **没有** | ❌ **做不到** |
| **任务** | ❌ 没有 | ❌ 做不到 |
| **事件** | ❌ 没有 | ❌ 做不到 |

**结论**：
- Workbddy 只能创建角色、世界书、预设这些东西
- "故事/章节/任务/事件"这些 Toonflow 概念在 tavo 里根本不存在，MCP 再强大也创建不了不存在的东西
- 备份/恢复：可以导出角色卡、世界书、聊天等，但需要自己写服务端来存

---

### 2. 是否完全抛弃 tavo 自带的"群聊"，用插件自己实现"多人角色故事"的能力

**不能完全替换，但可以在群聊基础上增强**。

tavo 群聊的 `responseMode` 有四种：
- `natural` - 自然
- `everyone` - 所有人
- `manual` - 手动
- `scenario` - 场景模式，可通过 `overrideScenario` 动态指定发言规则

插件能做的：
1. 设 `responseMode: 'scenario'`
2. 通过 `tavo.chat.update({ overrideScenario: '...' })` 注入编排规则
3. `generation:prepare` 注入编排上下文
4. `input:beforeSend` 拦截或修改输入

插件**不能**做的：
- 不能控制 tavo 底层消息渲染
- 不能禁用原生群聊 UI
- 不能接管消息气泡生成

**正确做法**：基于 tavo 群聊增强，不是抛弃它。插件负责"编排决策"，tavo 负责"渲染和交互"。

---

### 3. 一键上传或自动同步数据备份

**插件可以导出，但上传需要自己开发服务端**。

tavo 有导出能力：
- `tavo.character.export()` / `tavo.lorebook.export()` - 导出为文件
- `tavo.file.export()` - 导出到外部

但 tavo **没有内置云端**，上传需要：
1. 自己写服务器
2. 插件把数据 POST 到服务器
3. 服务器存储和版本管理

这不是 tavo 原生功能，需要额外开发。

---

### 4. tavo MCP 有啥用的

**让 AI agent 连接并操作 tavo 的数据**。

MCP 只暴露 tavo 官方提供的工具，能做的操作见问题1的表格。

**使用场景**：
```
用户：帮我创建一张角色卡
Agent：调用 tavo_character_create()
结果：角色卡直接出现在 tavo 角色库里
```

MCP 不能做任何 tavo 官方没有暴露的事情。

---

### 5. tavo 插件有哪几种服务形式，可不可以自定义各种 UI 和业务

**插件可以完全自定义 UI 和业务逻辑**。

插件能提供的功能：

| 类型 | manifest 配置 | 说明 |
|------|---------------|------|
| 设置页 | `contributes.settings` | switch、slider、select、textarea 等 |
| 侧边栏动作 | `contributes.sidebar` | 点击执行操作 |
| 输入框动作 | `contributes.inputActions` | 输入框 + 菜单 |
| 聊天 UI 片段 | `contributes.htmlFragments` | 悬浮面板、状态栏等 |
| 插件主入口 | `entry.js` | 所有业务逻辑 |

**支持的 Hooks**：

| Hook | 触发时机 |
|------|----------|
| `chat:opened/closed/updated` | 聊天生命周期 |
| `message:added/updated/deleted` | 消息变化 |
| `generation:prepare/success/error/cancelled` | 生成生命周期 |
| `input:beforeSend/afterSend` | 输入发送前后 |

**自定义 UI**：完全支持
- 可以写任意 HTML/CSS/JavaScript
- 可以访问 `tavo.*` 所有 API
- 支持悬浮面板（必须可拖动）、按钮、表单等
- 需要开启「高级渲染」

---

## 总结

| 问题 | 诚实答案 |
|------|----------|
| 1. 局域网 API | ❌ 不能创建故事/章节（MCP 只调官方函数，tavo 里根本没有这些实体） |
| 2. 抛弃群聊 | ❌ 不能完全替换，正确做法是基于群聊增强 |
| 3. 云同步备份 | ❌ tavo 没有内置云，需要自己开发服务端 |
| 4. MCP 用途 | 让 AI 操作 tavo 的角色、世界书、聊天等已有数据 |
| 5. 插件能力 | ✅ 完全支持自定义 UI 和业务逻辑 |