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
| `STORY_DIR` | 故事目录路径（必填） |
| `--force, -f` | 强制重新导入所有角色卡（跳过复用检查） |
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


# 实例
## 同步故事
python -m tavo_plugins sync ".cache/story/谁让这个山大王修仙的" --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json" --skip-plugins
## story.json 控制的故事同步：
python -m tavo_plugins sync --story-json "story.json"
story.json 说明
{
  "story_sync_mode": "--all --force --duplicate-delete  --clean-cache",
  "story_sync_file": ".cache/story/谁让这个山大王修仙的/story_sync_config.json"
}
--all 代表完全同步：角色，角色头像,角色立绘，章节和章节结束条件,开场白，世界书
--force 代表强力模式的同步
--duplicate-delete 代表同名查重只留一个（角色，角色头像,角色立绘，章节和章节结束条件,开场白，世界书）
--clean-cache 开始同步时清掉 "story_sync_cache" 里的缓存文件
story_sync_file 故事文件夹
story_sync_cache 故事同步过程的缓存数据，如角色id 等。