## issue 诚实回答

---

### 1. 能否局域网 API 让 Workbddy 等工具直接为安卓手机的 tavo 创建故事和角色甚至是章节和世界书、备份数据等
[]不考虑走官方的mcp ，由插件自己实现可否

### 2. 是否完全抛弃 tavo 自带的"群聊"，用插件自己实现"多人角色故事"的能力
以下内容均非直接在官方的"群聊"功能里实现
[] 插件是否可以在单个聊天框里气泡显示角色的头像。 台词列表的显示多个角色的台词
[] 插件是否可以像“Toonflow-game” 一样切换多条台词和单条台词的显示模式
[] 插件是否可以提供创建故事的能力和创建角色的能力。还是故事章节等。为故事添加世界书等


### 3. 一键上传或自动同步数据备份
[] 插件是否可以获取备份数据，调用自定义接口上传数据。

### 4. tavo MCP 有啥用的
[] 插件是否可以自定义 mcp 函数 
[] 插件的业务是否可以被tavo MCP函数调用


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