# no_modify
# 命令效果检查

```bash
python -m tavo_plugins sync --story-json "story.json" --force --skip-plugins
```

```json
{
  "story_sync_mode": "--all --force --duplicate-delete --clean-cache",
  "story_sync_file": ".cache/story/real_sj/谁让这个山大王修仙的/story_sync_config.json",
  "story_sync_cache": ".cache/story/real_sj/谁让这个山大王修仙的/story_cache"
}
```

## 数据检验 steps

### step1: 查重删除（--duplicate-delete）

> 有 `--duplicate-delete` 第一步先把当前故事对应的都删了

- [ ] 角色：用角色名搜索，验证同名角色已删除：头像，立绘，音色文件->角色
- [ ] Persona：用 persona 名称搜索，验证已删除：头像，立绘，音色文件->Persona
- [ ] 世界书：搜索同名世界书，验证已删除
- [ ] 故事数据：验证故事数据已删除
- [ ] 日志检查：输出应包含 `[char] Deleted id=X name=xxx`


### step2: 清缓存（--clean-cache）

> 有 `--clean-cache` 先把 `story_cache` 目录删了

- [ ] 缓存目录删除：`.cache/story/xxx/story_cache/` 目录不存在
- [ ] 日志检查：输出应包含 `[cache] Cleaned cache=...`

### step3: 重新建立缓存文件

> `story_sync_config.json` 和 `char_ids.json` 重新生成

- [ ] `story_sync_config.json`：文件存在，内容包含正确的角色列表
- [ ] `char_ids.json`：文件存在，包含角色名→ID 映射
- [ ] `persona.name` = `player_role.name`
- [ ] `characters[]` 包含所有 `npc_roles`
- [ ] `worldbook.source_entries` 非空（如果有世界书）

### step4: 创建角色，记录 ID 到缓存

> MCP 创建角色，ID 记录到 `char_ids.json`

- [ ] `char_ids.json` 更新：包含所有角色名到 ID 的映射
- [ ] 角色数量：与 `npc_roles` 数量一致（不含 persona）
- [ ] 日志检查：输出应包含 `[persona] 创建` 或 `[persona] 复用`
- [ ] 日志检查：输出应包含 `[char] 创建` 或 `[char] 复用`

### step5: 上传角色头像

> 上传本地头像文件到 MCP，修改角色卡的头像字段

- [ ] 头像字段：角色卡的 `avatar` 字段为 `files/global/xxx.png` 格式
- [ ] 日志检查：输出应包含 `avatar=files/global/xxx.png`
- [ ] Tavo 界面检查：角色列表显示头像缩略图

### step6: 创建/复用群聊 和故事的数据

> 查找同名群聊或创建新群聊

- [ ] chat_id 有效：返回有效的群聊 ID
- [ ] 群聊名称：`chat_name` = `story_name + " · 第1章"`
- [ ] 群聊绑定->故事数据.简介:intro, 故事数据.全局背景：global_bg,故事数据.card_scenario，故事数据.card_tags
- [ ] 日志检查：输出应包含 `[chat] create` 或 `[chat] reuse`

### step7: 同步世界书

> 创建或更新世界书（Lorebook）

- [ ] lorebook 存在：Tavo 中有名为 `story_name` 的世界书
- [ ] entries 数量：与 `worldbook.source_entries` 数量一致
- [ ] 日志检查：输出应包含 `[worldbook] 创建` 或 `[worldbook] 更新`

### step8: 重绑群聊

> 将角色、worldbook、persona 绑定到群聊

- [ ] 群聊角色列表：包含所有 NPC 的 ID
- [ ] 群聊世界书：绑定到刚创建/更新的 lorebook
- [ ] 日志检查：输出应包含 `[chat] 重绑角色+世界书+persona OK`

### step9: 同步章节

> 上传章节到 `tf_story.edit.chapters`

- [ ] `tf_story.edit` 变量：在群聊变量中存在, 开场白和发言者。章节背景图片，章节内容。
- [ ] chapters 数组：长度与 `chapters/*.json` 文件数一致
- [ ] `currentChapterIndex`：值为 0（第一章）
- [ ] `tf_progress` 变量：存在且包含正确结构
- [ ] 日志检查：输出应包含 `[chapter] Write tf_story.edit.chapters=X chapters`

### step10: 同步立绘

> 上传角色立绘和章节背景

- [ ] `tf_sprites` 变量：存在且包含角色立绘映射
- [ ] `tf_chapter_backgrounds` 变量：存在且包含章节背景
- [ ] `tf_sprite_fallback_bg` 变量：存在（如果有兜底背景）

### step11: 同步音色文件
- [ ]上传音色文件并绑定到角色卡