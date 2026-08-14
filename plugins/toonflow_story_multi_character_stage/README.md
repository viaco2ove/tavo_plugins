# toonflow_story_multi_character_stage

为 tavo 群聊提供有编排的多角色叙事插件。

## 功能特性

- **发言路由引擎**：自动决定谁来说下一句话
- **三档台词生成**：T0 模板(<200ms)、T1 轻量(1-3s)、T2 高质量(3-8s)
- **区域聚焦系统**：控制谁可以发言
- **NPC 自主发言**：无用户输入时自动推进剧情
- **记忆协同**：与 `toonflow_story_memory_manager` 插件联动

## 文件结构

```
toonflow_story_multi_character_stage/
├── manifest.json
├── entry.js
├── locales/
│   ├── en.json
│   └── zh-CN.json
├── ui/
│   └── panel.html
├── cover.png
└── build.ps1
```

## 打包命令

```powershell
cd plugins/toonflow_story_multi_character_stage
powershell -File build.ps1
```

## 设置项

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 启用故事台 | 总开关 | 开 |
| NPC 自主发言 | 无用户时自动发言 | 开 |
| 无用户发言 N 轮后触发 | NPC 自主发言间隔 | 3 |
| 与记忆管理器协同 | 读取记忆插件数据 | 开 |
| 发言模式 | auto/manual | auto |
| 对话历史保留条数 | 历史消息数量 | 20 |