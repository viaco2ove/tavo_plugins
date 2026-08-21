# tavo sync — 同步故事到 Tavo

将本地故事目录完整同步到 Tavo，包括角色卡、立绘、章节和插件。
[tavo_run.md](tavo_run.md)
## 基本用法

```bash
tavo sync ".cache/story/故事名"
```

## 选项

| 选项 | 说明 |
|------|------|
| `STORY_DIR` | 故事目录路径（必填，与 `--story-json` 二选一） |
| `--story-json FILE` | 从 story.json 控制同步（支持 `--all`/`--force`/`--duplicate-delete`/`--clean-cache`） |
| `--force, -f` | 强制重新导入所有角色卡（跳过复用检查） |
| `--all` | 完整同步（含世界书） |
| `--duplicate-delete` | 同名去重（角色 + 世界书条目） |
| `--clean-cache` | 开始同步前清空 `story_sync_cache` |
| `--reuse-ids FILE` | 角色 ID 映射 JSON 文件（避免重复创建角色） |
| `--skip-sprite` | 跳过立绘资源同步 |
| `--skip-chapters` | 跳过章节同步 |
| `--skip-plugins` | 跳过插件安装 |
| `--chat-id N` | 指定已有群聊 ID，不创建新群聊 |
| `-e, --env PATH` | 指定 .env 文件路径 |

## 同步流程

`sync` 分 7 步执行：

### 第1步：群聊
- 在 Tavo 中查找同名群聊
- 找到则复用，ID 写入后续步骤
- 找不到则新建

### 第2步：角色卡
- **persona**：查找或创建用户身份
- **NPCs**：查找或导入角色卡
- 每次同步后角色 ID 可能变化，建议配合 `--reuse-ids` 使用

### 第3步：世界书
- 同步或更新 Lorebook 条目

### 第4步：重绑群聊
- 将角色、persona、世界书绑定到群聊

### 第5步：立绘资源
- 上传前景立绘（fg）和氛围背景（bg）
- 写入 `tf_sprites` 等变量

### 第6步：章节
- 同步章节到 `tf_story.edit`
- 初始化 `tf_progress`

### 第7步：插件
- 安装 `plugins/` 目录下的所有插件

## 示例

### 首次同步（全新）

```bash
tavo sync ".cache/story/谁让这个山大王修仙的"
```

### 同步（跳过插件，已装过）

```bash
tavo sync ".cache/story/谁让这个山大王修仙的" --skip-plugins
```

### 强制重新导入角色

```bash
tavo sync ".cache/story/谁让这个山大王修仙的" --force
```

### 指定已有群聊

```bash
tavo sync ".cache/story/谁让这个山大王修仙的" --chat-id 1
```

## 角色 ID 映射（重要）

`sync` 会为每个角色在 Tavo 中创建/查找记录。如果之前已同步过，再次同步可能产生重复角色。

使用 `--reuse-ids` 传入映射文件，强制复用已有 ID：

```bash
tavo sync ".cache/story/谁让这个山大王修仙的" \
  --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json"
```

映射文件格式：

```json
{
  "纯小白": 2,
  "红缥缈": 26,
  "白锦儿": 27,
  "李玄风": 28,
  "陆青山": 29,
  "云火月": 30,
  "林月": 31,
  "琳琅": 32,
  "冷素心": 33,
  "苍山道人": 34,
  "某女子": 35,
  "某男子": 36
}
```

> 首次同步后，映射文件会保存在故事目录下的 `char_ids.json`。

## 跳过选项组合

```bash
# 只同步角色和立绘
tavo sync ".cache/story/xxx" --skip-chapters --skip-plugins

# 只同步章节（角色、立绘已到位）
tavo sync ".cache/story/xxx" --skip-plugins
```

## 依赖文件

`sync` 依赖故事目录下的 `story_sync_config.json`，确保已生成：

```bash
# 检查是否存在
ls .cache/story/故事名/story_sync_config.json
```


## 两种模式

### 模式 1：传故事目录（向后兼容）

```bash
python -m tavo_plugins sync ".cache/story/谁让这个山大王修仙的" \
  --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json" \
  --skip-plugins
```

### 模式 2：从 story.json 控制（推荐）

`story.json` 是 Toonflow-game 的源格式，包含 `player_role` / `npc_roles` / `chapter_covers` / `intro` / `global_bg` / `card_scenario` 等字段。

```bash
python -m tavo_plugins sync --story-json "story.json"
```

`story.json` 模式自动生成 / 复用 `story_sync_config.json`：
- 角色描述从 `npc_roles[].md_file`（md 文件）读取
- 头像从 `npc_roles[].avatar_file` 查找
- 章节从 `chapters/*.json` 读取
- 世界书从 `worldbook/worldbook.json`（SillyTavern 格式，含 keys/probability/order）读取
- `chapter_covers` 的背景图自动上传

`--story-json` 模式支持的额外选项：
- `--all`：完整同步（含世界书）
- `--duplicate-delete`：删除同名重复（角色 + 世界书条目）
- `--clean-cache`：开始前清空 `story_sync_cache`

```bash
# 完整清理 + 同步
python -m tavo_plugins sync --story-json "story.json"
```

