# toonflow_群聊插件

> 在 Tavo 群聊场景模式上，搭建「Toonflow 剧情流」的整套 LLM 驱动插件。  
> 完全对齐官方 toonflow-game-app 的剧情编排、事件推进、记忆管理、角色发言等核心能力。

---

## 项目下载

```bash
git clone https://github.com/viaco2ove/tavo_plugins.git
cd tavo_plugins
```

---

## 插件清单（8 个）

所有插件位于 `plugins/`，每个子目录是一个独立插件，按 `entry.js` + `ui/` 组织。  
它们通过 `window.*` 全局对象跨插件协同，并各自挂载 `tavo.plugin.on(...)` 监听 Tavo 生命周期事件。

| # | 插件名 | 主要职责 | 关键 API / 监听 |
|---|---|---|---|
| 1 | **toonflow_story_event_manager** | 剧情推进中枢：解析章节大纲 → runtimeOutline（phases/stages）→ 判定事件进度 → 编排阶段切换 | `message:added` / `chat:opened` / `window.tfStoryJudge.checkAndAdvance` |
| 2 | **toonflow_story_multi_character_stage** | 编排师 + 角色发言器：决定本轮由谁发言 → 生成台词 | `input:beforeSend` / `window.tf_story_emit('append_message_steam')` |
| 3 | **toonflow_story_speaker** | 流式发言器：生成 → 等待流结束 → append，监听编排师的 emit | `window.tf_story_on('append_message_steam')` |
| 4 | **toonflow_story_memory_manager** | 长期记忆 + 角色动态参数卡维护：刷新 `tmm` 摘要 / facts / tags / `tmm_story` 角色卡 | `tmmIntent` / `@记忆管理 xxx` 指令 |
| 5 | **toonflow_story_llm_optimization** | 统一 LLM 通道（接管 `tavo.generate`）：超时控制、降级 fallback、usage 埋点 | `window.tf_llm.callDirect` |
| 6 | **toonflow_story_voice** | TTS 语音合成（xiaomimimo / aliyun）：按句切分，逐句 `await audio.onended` | `message:added` 流式触发 |
| 7 | **toonflow_story_style** | 气泡样式面板（单条/多条切换 + 透明度滑块）：纯 CSS 变量驱动，零 API | `#tf-style-tab` 拖拽定位 |
| 8 | **toonflow_story_sprite_background** | 角色立绘 / 场景背景切换 | `message:added` 触发立绘替换 |
| 9 | **toonflow_story_debug_eruda** | 调试面板：注入 eruda 控制台，运行时调试 | 初始化时挂载 |

> 排序按依赖顺序：event_manager 维护进度 → mcs 编排 → speaker 生成 → memory_manager 持久化 → llm_optimization 提供统一 LLM 通道 → voice/style/sprite 是体验增强。

### 数据流（简化）

```
用户输入 (input:beforeSend)
        │
        ▼
   mcs (编排师) ──→ tf_llm.callDirect ──→ 决定 speaker
        │
        ▼
window.tf_story_emit('append_message_steam')
        │
        ▼
   speaker (发言器) ──→ 生成台词 → append_message
        │
        ▼
   event_manager (message:added) ──→ 判定事件进度
        │
        ├─→ memory_manager (异步刷新记忆)
        ├─→ voice (TTS)
        └─→ sprite_background (立绘)
```

---

## 故事编写

### 1. 故事配置：`story_sync_config.json`

每部故事一个目录，根目录放 `story_sync_config.json`，结构示例：

```json
{
  "story_name": "谁让这个山大王修仙的",
  "chat_name": "谁让这个山大王修仙的",
  "response_mode": "scenario",
  "bind_persona": true,
  "persona": {
    "name": "纯小白",
    "personality": "玩家"
  },
  "characters": [],
  "worldbook": {
    "name": "未命名",
    "intro": ""
  },
  "chapters": {
    "dir": "chapters",
    "enabled_first_only": true
  }
}
```

### 2. 章节大纲（Markdown 格式）

`chapters/` 目录下放每个章节的 Markdown 文件，例如 `chapters/01_苏醒.md`。

格式遵循 **## 一级标题 = Phase / ### 二级标题 = Stage**：

```markdown
## 苏醒
### 穿越醒来
（穿越成山大王）

@旁白：冰冷的石板硌着后背，你猛地睁开眼……

### 发现身份
@旁白：你揉了揉眼睛，发现世界变得不一样了：周围的物品散发着不同颜色的光芒……

### 用户发言
（请用户做出反应）

## 觉醒财气眼
### 发现异常
@旁白：你突然注意到自己的右眼微微发热……
…
```

**约定**：
- `## xxx` = Phase（剧情阶段）
- `### xxx` = Stage（事件 / 阶段）
- 标题含「用户发言」= 用户回合节点
- `@角色名：台词` = 该角色的台词或旁白内容

### 3. 世界书（可选）

`story_sync_config.json` 里配 `worldbook` 字段，引用 Tavo 世界书条目。  
插件运行时会按 **关键词匹配 + 粘性 + 延时** 自动注入 `【世界知识】` 到 LLM prompt。

### 4. 角色卡

Tavo 内置的 `tavo.character` 系统管理，sync 流程会把 `story_sync_config.json` 里的角色列表同步到群聊。

---

## 故事安装与同步

### 方式一：CLI 同步（推荐）

通过 `pyproject.toml` 打包的 `tavo` 命令：

```bash
# 1) 安装 CLI
cd tavo_plugins
pip install -e .

# 2) 在 story.json 指定要同步的故事目录
cat story.json
{
  "story_sync_mode": "--all --force",
  "story_sync_file": ".cache/story/real_sj/谁让这个山大王修仙的/story_sync_config.json",
  "story_sync_cache": ".cache/story/real_sj/谁让这个山大王修仙的/story_cache"
}

# 3) 执行同步
tavo sync story
```

CLI 会自动完成：
1. 连通性检查（MCP）
2. 找/建群聊
3. 同步角色卡
4. 同步世界书
5. 同步章节大纲（解析为 runtimeOutline）
6. 初始化 progress / memory / cast cards

### 方式二：手动安装插件

把 `plugins/*` 里的每个子目录作为独立插件上传到 Tavo 后台：

```
plugins/
├── toonflow_story_event_manager/   # 入口 entry.js + ui/story_panel.html
├── toonflow_story_multi_character_stage/
├── toonflow_story_speaker/
├── toonflow_story_memory_manager/
├── toonflow_story_llm_optimization/
├── toonflow_story_voice/
├── toonflow_story_style/
├── toonflow_story_sprite_background/
└── toonflow_story_debug_eruda/
```

每个插件结构：

```
toonflow_story_xxx/
├── entry.js       # 主逻辑（tavo.plugin.on(...) 注册）
└── ui/
    └── *.html     # 注入的 UI（拖拽面板、样式面板等）
```

> 注意：插件安装顺序很重要，`llm_optimization` 必须先于其他依赖 LLM 的插件加载（它注册 `window.tf_llm`）。

---

## 玩法介绍

启动群聊后：

1. **开场白**：插件自动播放章节 1 的开场台词
2. **轮次**：用户输入 → 编排师决定谁发言 → 发言器生成台词 → 流式输出
3. **进度推进**：每轮自动判定事件进度，状态标记 `[s]=completed / [f]=failed / [i]=active / []=idle`
4. **章节切换**：满足完成条件时自动切下一章；全部章节完成后进入「自由模式」
5. **记忆维护**：每 1 轮自动刷新摘要；`@记忆管理 xxx` 可手动触发
6. **语音 / 立绘 / 样式**：可选增强体验

### 特殊指令

- `输入 "."` = 跳过本轮（系统视为已完成用户发言阶段）
- `@角色名 xxx` = 强制编排该角色说话
- `@记忆管理 xxx` = 直接操作记忆与角色卡

---

## 开发说明

- 每个插件独立 JS 作用域，跨插件共享函数必须挂到 `window.*`
- LLM 调用统一走 `window.tf_llm.callDirect(messages, { maxCompletionTokens, usageType })`
- 所有 prompt 必须按 toonflow-game-app 的「分段格式」写：[世界] / [章节] / [原始全局背景] / [动态全局背景] / [当前事件] / [最近对话] / ...
- 进度数据结构见 `md/currdesign/logic/变量设计/json_scope/chat.tf_grogress.json`

---

## 版本

v0.1.0 — 对齐 toonflow-game-app 章节判定 / 事件进度 / 记忆管理 / 编排 / 角色发言 五个核心 prompt 结构。