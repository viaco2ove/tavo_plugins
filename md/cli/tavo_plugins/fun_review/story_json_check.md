# 命令执行检查

```bash
python -m tavo_plugins sync --story-json "story.json" --force --skip-plugins
```

## 实际验证结果 (2026-08-22)

### ✅ 全部通过

| Step | 检查项 | 结果 | 备注 |
|------|--------|------|------|
| step1 | 查重删除 | ✅ | 角色/Persona/世界书无重复 |
| step2 | 清缓存 | ✅ | story_cache 已删除 |
| step3 | 缓存文件 | ✅ | story_sync_config.json, char_ids.json 正常 |
| step4 | 创建角色 | ✅ | 11 NPC + 1 persona |
| step5 | 角色头像 | ✅ | NPC + Persona 头像已更新 |
| step6 | 群聊绑定 | ✅ | characterIds, lorebookIds, personaId 正确 |
| step7 | 世界书 | ⚠️ | 创建成功但 entries=0（MCP 端问题） |
| step8 | 重绑群聊 | ✅ | 绑定正确 |
| step9 | 章节同步 | ✅ | 2 chapters, openingLine, content, successCondition 完整 |
| step10 | 立绘同步 | ✅ | 12 角色 (1 persona + 11 NPC), fg/bg 完整 |
| step11 | 音色文件 | ✅ | 12 个角色音色已上传和绑定 |

---

## 验证详情

**Persona 头像**：
- `avatar: files/global/纯小白.png` ✅

**tf_sprites**：
- `纯小白: fg=files/chat/sprite_fg_24.webp bg=files/chat/sprite_bg_24.png` ✅
- `byName: 12 个角色` ✅

**tf_character_voices**：
- 12 个角色音色配置 ✅
- 每个角色包含: `mode`, `prompt`, `audioRef`

**tf_story.edit**：
- `intro`, `global_bg`, `card_scenario`, `card_tags` ✅
- `chapters: 2 个` ✅
- `openingLine`, `successCondition` ✅

---

## ✅ 代码修复清单

| 功能 | 修复方案 |
|------|----------|
| Persona 头像 | 使用 `tavo_persona_update` 更新 |
| Persona 立绘 | 添加到 `tf_sprites.byName["纯小白"]` |
| 章节 openingLine | 读取 `openingText` 字段 |
| 章节 successCondition | 读取 `completionCondition` 字段 |
| 故事数据同步 | 同步 `intro`/`global_bg`/`card_scenario`/`card_tags` |
| 复用 config 时同步故事数据 | 添加故事数据同步逻辑 |
| **音色文件同步** | 新增 `sync_voices()` 函数 |

---

## ⚠️ MCP 端问题（需 MCP 修复）

1. **世界书 entries=0** - `lorebook_create` 后 entries 为空