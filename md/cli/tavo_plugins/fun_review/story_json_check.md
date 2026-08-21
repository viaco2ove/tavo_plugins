# 命令执行检查

```bash
python -m tavo_plugins sync --story-json "story.json" --force --skip-plugins
```

## 实际检查结果

### step1: 查重删除（--duplicate-delete）

- [ ] **角色删除** - ❌ 未删除重复角色
  - 实际：ID 200-211 的 12 个角色均存在，无删除记录
- [ ] **Persona 删除** - ❌ 未删除重复 persona
  - 实际：存在 12 个名为"纯小白"的 persona（ID 2-13）
- [ ] **世界书删除** - ⚠️ 部分删除
  - 实际：2 个世界书都存在，但 entries=0
- [ ] **日志检查** - ❌ 无删除记录

### step2: 清缓存（--clean-cache）

- [x] **缓存目录删除** - ✅ 已删除
- [x] **日志检查** - ✅ `[cache] Cleaned cache=...`

### step3: 重新建立缓存文件

- [ ] **story_sync_config.json** - ✅ 文件存在
- [ ] **char_ids.json** - ❌ 未创建
- [ ] **persona.name** - ✅ 正确
- [ ] **characters[]** - ✅ 包含 12 个角色
- [ ] **worldbook.source_entries** - ❌ 为空（应为 42）

### step4: 创建角色，记录 ID 到缓存

- [ ] **char_ids.json 更新** - ❌ 文件不存在
- [ ] **角色数量** - ✅ 12 个 NPC + 1 个 persona = 13
- [x] **日志检查** - ✅ 有 `[char] 创建 (无 avatar)` 输出

### step5: 上传角色头像

- [ ] **头像字段** - ❌ 所有角色 avatar 为空
  - 实际：ID 200-211 所有角色 `avatar: 无`
- [ ] **日志检查** - ⚠️ 有上传日志但实际未生效

### step6: 创建/复用群聊

- [x] **chat_id** - ✅ 12
- [x] **群聊名称** - ✅ `谁让这个山大王修仙的 · 第1章`
- [ ] **故事数据绑定** - ❌ 未绑定
  - intro/global_bg/card_scenario 未写入群聊

### step7: 同步世界书

- [ ] **lorebook 存在** - ⚠️ 存在但 entries=0
  - 实际：`[2] 谁让这个山大王修仙的 · 第1章 | entries: 0`
- [ ] **entries 数量** - ❌ 0（应为 42）
- [x] **日志检查** - ✅ `[worldbook] 创建 id=2`

### step8: 重绑群聊

- [x] **群聊角色列表** - ✅ `[200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210]`
- [x] **群聊世界书** - ✅ `[2]`
- [x] **日志检查** - ✅ `[chat] 重绑角色+世界书+persona OK`

### step9: 同步章节

- [ ] **tf_story.edit** - ❌ chapters=0（应为 2）
- [ ] **chapters 数组** - ❌ 0（应为 2）
- [x] **currentChapterIndex** - ✅ 0
- [x] **tf_progress** - ✅ 正确结构
- [x] **日志检查** - ✅ 有输出

### step10: 同步立绘

- [ ] **tf_sprites** - ❌ byName=0（应为 12）
- [x] **tf_chapter_backgrounds** - ✅ 有数据
- [x] **tf_sprite_fallback_bg** - ✅

### step11: 同步音色文件

- [ ] 上传音色文件并绑定到角色卡 - ❌ 未实现

---

## 问题汇总

| 严重程度 | 问题 | 可能原因 |
|---------|------|----------|
| 🔴 严重 | duplicate-delete 无效 | 删除逻辑有 bug |
| 🔴 严重 | 角色 avatar 为空 | upload_character_avatars 未更新到角色卡 |
| 🔴 严重 | 世界书 entries=0 | sync_worldbook 未正确写入 entries |
| 🔴 严重 | tf_story.edit.chapters=0 | 章节数据未写入 |
| 🔴 严重 | tf_sprites.byName=0 | 立绘数据未写入 |
| 🟡 中等 | char_ids.json 未创建 | 缓存保存逻辑缺失 |
| 🟡 中等 | Persona 有 12 个重复 | duplicate-delete 未删除 persona |
| 🟡 中等 | 故事数据未绑定到群聊 | intro/global_bg/card_scenario 未写入 |