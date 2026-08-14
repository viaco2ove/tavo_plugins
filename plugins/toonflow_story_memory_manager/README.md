# toonflow_story_memory_manager

为 tavo 聊天应用提供结构化长期记忆管理的插件。

## 功能特性

- **异步记忆刷新**：每轮对话后自动提炼剧情摘要、事实、标签
- **记忆上下文注入**：在生成前将记忆注入模型请求
- **角色参数卡维护**：自动追踪玩家和 NPC 的等级、物品、技能等变化
- **@记忆管理 指令**：直接管理记忆和角色状态
- **可拖动面板**：悬浮面板展示当前记忆状态

## 文件结构

```
toonflow_story_memory_manager/
├── manifest.json       # 插件清单
├── entry.js            # 主入口
├── locales/
│   ├── en.json         # 英文
│   └── zh-CN.json      # 中文
├── ui/
│   └── panel.html      # 记忆状态面板
└── cover.png           # 封面图（需自备）
```

## 打包命令

```powershell
cd plugins/toonflow_story_memory_manager
# Windows
Compress-Archive -Path manifest.json, entry.js, locales, ui, cover.png -DestinationPath ..\toonflow_story_memory_manager.tpg

# Linux/Mac
zip -r ../toonflow_story_memory_manager.tpg manifest.json entry.js locales ui cover.png
```

## 设置项

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 启用插件 | 总开关 | 开 |
| 提示词模式 | compact 省 token / full 信息全 | compact |
| 刷新间隔 | 每 N 轮刷新一次 | 3 |
| 最近对话窗口 | 发送给模型的对话条数 | 6 |
| 事实/标签上限 | facts/tags 保留数量 | 12/8 |
| 注入记忆上下文 | 生成时注入记忆 | 开 |
| 注入字符预算 | 注入块最大字符数 | 400 |
| 同步宿主长记忆 | 同步关键记忆到 tavo.memory | 关 |
| 保存隐藏快照 | 保存记忆快照到隐藏消息 | 关 |
| 强触发关键词 | 命中立即刷新 | 背叛;结盟;获得;失去;任务;真相;死亡;升级 |
| 世界背景设定 | 注入到记忆提示词的全局背景 | 空 |
| 自定义规则 | 覆盖内置 system prompt | 空 |

## 开发说明

- 状态存储在 chat 作用域变量 `tmm` 下
- Hooks: `chat:opened`, `message:added`, `generation:prepare`, `input:beforeSend`
- 侧边栏动作: `refresh-memory`, `inspect-memory`, `export-memory`, `writeback-cards`
