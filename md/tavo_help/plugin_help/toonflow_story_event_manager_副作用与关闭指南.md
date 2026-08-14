# toonflow_story_event_manager 副作用说明 & 关闭指南

> 截图里的「场景切换至 XXX」自动消息、「进入章节『XXX』」toast、「故事进度」浮窗、
> 以及每次都弹一次的「是否允许添加加聊天消息？」**全部来自这个插件**，不是世界书内容。

## 它在干什么

读 `plugins/toonflow_story_event_manager/entry.js`，关键两段：

```js
// advanceChapter() 内：把当前章节标记完成，注入"场景切换"旁白
state.current_chapter = nextIndex;
...
await tavo.message.append({
  content: `（场景切换至 ${nextChapter.name}）`,
  hidden: false,
});
tavo.utils.toast(tavo.plugin.i18n.t('runtime.chapterAdvanced', { chapter: nextChapter.name }));
```

```js
// initStory() 内：把 worldbook 里"非 constant"的所有 entry 都当章节
const chapters = [];
for (const entry of lorebook.entries) {
  if (entry.strategy === 'constant') continue;  // ← 只跳过 constant
  chapters.push({ name: entry.name, ... });
}
```

也就是说：**它把所有非 constant 的 worldbook entry 都视为"章节"**，并自动推进。
我们推送的世界书有 34 条 `keyword` entry（角色、地点、势力、章节锚点），它一打开
对话就把每个 keyword 都当成新章节，立刻 `append` "场景切换至XXX" + toast。

**弹框「是否允许添加加聊天消息？」** 不是这个插件弹的，是 tavo 的原生权限确认——
每当插件调用 `tavo.message.append` 时 tavo 会要求用户授权。"加加"是 tavo 的 i18n 文本 bug。

**浮窗「故事进度」** = 插件 manifest 注册的 htmlFragment：

```json
"htmlFragments": [
  { "id": "tf-story-panel", "src": "ui/story_panel.html", "mount": "/chat/body/end" }
]
```

"未绑定故事" 是因为它把章节识别 + 状态初始化流程跑挂了（因为我们 entry 没有
`【完成条件】…` 字段它就走 fallback，然后一直显示未绑定）。

## 立即止血（两种方式任选）

### 方式 A：tavo 设置页关掉插件

打开 tavo 桌面端 → `设置` → `插件` → 找到 `toonflow_story_event_manager` → 关闭 `启用` 开关。
关掉后浮窗立即消失、自动消息停止追加、toast 不再弹。

### 方式 B：跑 MCP 清理脚本（推荐，能顺带删垃圾消息）

前置：tavo 桌面端 MCP Server 已开启（`设置` → `MCP Server` → 启用）。

```bash
cd D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.cache\story\谁让这个山大王修仙的
python cleanup_tavo.py            # 关插件 + 删垃圾消息
python cleanup_tavo.py --dry      # 预演，不实际修改
python cleanup_tavo.py --avatar-dir D:\path\to\portraits   # 额外补头像
```

脚本做 3 件事：
1. **关插件** — `com.toonflow.story-event-manager` 的 `enabled=false`、`autoAdvance=false`、`showPanel=false`
2. **删垃圾消息** — 拉群聊所有消息，匹配 `场景切换至` / `进入章节` 开头的批量删除
3. **补头像（可选）** — 把 `--avatar-dir` 下 `<角色名>.png` 上传到 tavo 文件存储，写入对应 character 的 `avatar` 字段

## 头像缺失的原因（与插件无关）

我之前推送 12 个角色时用了 Tavo-native 字段 `character: {name, description, first_mes, personality, roleType}`，
**没有传 `avatar` 字段**，所以 tavo 那边显示空头像。这是脚本侧漏写，不是插件造成的。

修法：MCP 通后用 `tavo_character_update` 给每个角色补 `avatar`（可以是个图片 url、tavo 文件 uri、
或者 base64 data url）。`cleanup_tavo.py --avatar-dir` 已经封装好。

## 角色头像推荐方案

`谁让这个山大王修仙的` 共 12 个角色，建议目录结构：

```
portraits/
  纯小白.png        # player 男主
  红缥缈.png        # 女主
  白锦儿.png
  李玄风.png
  陆青山.png
  云火月.png
  林月.png
  琳琅.png
  冷素心.png
  苍山道人.png
  某女子.png        # 可后补：模板配角
  某男子.png
```

没有现成头像时：可以先用占位图（任意同样尺寸 png），或者干脆**不补头像**——关掉污染源
后画面会比现在干净得多。

## 长期建议

- 插件本身是想做"故事编排/章节推进"，逻辑没错，**但前提是世界书结构与它假设的一致**：
  章节 entry 需要在 `content` 里有 `【完成条件】…` 字段（或 entry 自身有 `completion_condition`），
  让插件能正确评估完成条件、自动推进。否则就会出现"把所有 keyword 当章节"的污染行为。
- 短期可以关插件；长期如果想保留章节推进能力，需要让世界书的"章节"entry 与"知识"entry
  在结构上明显区分（例如把章节命名为统一前缀 `【第N章】…`，把知识 entry 也设为 `constant`），
  或者扩展插件让 `initStory()` 用命名规则区分两种 entry。