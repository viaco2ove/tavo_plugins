# story_sync_all.py - 故事完整安装 CLI

把一个 Toonflow 故事目录完整安装到 tavo：
**角色卡（带头像）+ 世界书 + 群聊 + 章节 + 立绘 + 插件**，一条命令搞定。

**脚本位置**：`script/tavo_mcp_use/story_sync/story_sync_all.py`

---

## 一、快速开始

```bash
# 在 tavo_plugins 根目录下运行
python script/tavo_mcp_use/story_sync/story_sync_all.py ".cache/story/谁让这个山大王修仙的"
```

首次运行会自动生成 `story_sync_config.json`，之后可手动编辑该文件微调（不会被覆盖）。

---

## 二、完整参数（POSIX/GNU 标准）

```bash
python story_sync_all.py [选项] [故事目录]
```

| 短 | 长 | 说明 |
|----|---|------|
| `-c` | `--check` | 仅做连通性检查，不写任何数据 |
| `-n` | `--dry-run` | 预演模式：查询已有数据但 create/import/update 都不落库 |
| `-f` | `--force` | 强制重导所有角色卡（换头像 / 大幅改文案时用） |
| `-v` | `--verbose` | 详细输出（reserved for future use） |
| `-h` | `--help` | 显示帮助 |
| | `--skip-sprite` | 跳过立绘资源同步（只装角色 + 世界书 + 群聊 + 章节） |
| | `--skip-chapters` | 跳过章节同步到 `tf_story.edit.chapters` |
| | `--skip-plugins` | 跳过插件安装（默认装 MCS / sprite / memory / event 等 7 个） |
| | `--skip-voice` | 跳过世界书（历史名，实际跳 lorebook） |
| | `--chat-id N` | 指定已有群聊 ID，跳过创建直接 update |
| | `--url URL` | 覆盖 `.env` 的 `tavo_mcp_url` |
| | `--token TOKEN` | 覆盖 `.env` 的 `tavo_mcp_toekn` |
| | `故事目录`（位置参数） | 故事根目录（含 `story.json`），默认 `.cache/story` |

退出码：0=成功，1=连接/执行失败，2=参数错误，130=Ctrl+C 中断。

---

## 三、典型用法

### 1. 连通性自检（改了 token / 模拟器后先跑）
```bash
python story_sync_all.py -c
# 或
python story_sync_all.py --check ".cache/story/谁让这个山大王修仙的"
```

### 2. 预演（看会动哪些数据，不落库）
```bash
python story_sync_all.py -n
# 或
python story_sync_all.py --dry-run ".cache/story/谁让这个山大王修仙的"
```

### 3. 首次完整安装
```bash
python story_sync_all.py ".cache/story/谁让这个山大王修仙的"
```

### 4. 换了头像 / 改了角色文案，强制重导
```bash
python story_sync_all.py -f ".cache/story/谁让这个山大王修仙的"
```

### 5. 只重绑群聊（角色卡已装好，改了群聊配置）
```bash
python story_sync_all.py --skip-sprite --skip-chapters --chat-id 1
```

### 6. 覆盖连接（手机真机调试）
```bash
python story_sync_all.py ".cache/story/谁让这个山大王修仙的" \
  --url http://192.168.1.23:7347/mcp --token YOUR_TOKEN
```

---

## 四、安装流程（9 步，幂等可重跑）

```
1. 读 .env 连接配置（tavo_mcp_url / tavo_mcp_toekn）
2. 读 story.json（Toonflow 数据：story_name / global_bg / card_scenario / player_role / npc_roles / chapter_covers）
3. 自动生成 story_sync_config.json（已存在则跳过，手动编辑优先）
4. 创建/复用群聊（先空建拿 chat_id，avatar 上传需要 chatId）
5. 同步角色卡（avatar 先 file_save 成 files/global/<name>.<ext> 引用，再写进 card）
   ├─ persona（玩家身份）-> tavo_persona_create + tavo_persona_set_active
   └─ NPCs（每个角色）-> tavo_character_import_card
      card 格式：{"spec":"chara_card_v3","spec_version":"3.0","data":{...}}
      按 name search，命中复用，缺失才建；--force 强制重导
6. 同步世界书 -> tavo_lorebook_create / update（参数：{"lorebook":{name, entries}}）
7. 重绑群聊（角色卡 + 世界书 + persona 都到位后再 chat_update）
   （characterIds + lorebookIds + personaId + responseMode）
8. 同步章节 -> tf_story.edit.chapters（chat 变量，双写 global）
   └─ tf_progress 初始化（currentChapterIndex=0）
9. 同步立绘资源 -> tavo_file_save + tavo_variable_set
   ├─ 角色 fg/bg（ex/avatars/<名>/original.png > avatar.webp > avatars/<名>.png）
   ├─ 章节背景（image/chapter_*_background.png）
   └─ 兜底背景（image/cover.jpg | bg.jpg）
   └─ 写入 tf_sprites / tf_chapter_backgrounds / tf_sprite_fallback_bg
10.同步插件 -> tavo_plugin_install（默认装 7 个）
   ├─ toonflow_story_event_manager
   ├─ toonflow_story_memory_manager
   ├─ toonflow_story_multi_character_stage
   ├─ toonflow_story_speaker
   ├─ toonflow_story_sprite_background
   ├─ toonflow_story_style
   └─ toonflow_story_debug_eruda
```

---

## 五、story.json 字段（Toonflow 格式，输入）

```json
{
  "story_name": "谁让这个山大王修仙的",
  "intro": "故事简介...",
  "global_bg": "世界观背景...",
  "card_scenario": "角色与关系...",
  "card_tags": ["Roleplay", "修仙"],
  "player_role": { "name": "纯小白", "md_file": "纯小白.md", "avatar_file": "纯小白.png" },
  "npc_roles": [
    { "name": "红缥缈", "md_file": "红缥缈.md", "avatar_file": "红缥缈.png" },
    ...
  ],
  "chapter_covers": { "1": { "cover": "...", "background": "..." }, ... }
}
```

---

## 六、story_sync_config.json（tavo 格式，自动生成）

脚本首次运行自动生成在故事目录下，字段：

| 字段 | 说明 |
|------|------|
| `story_name` | 故事名 |
| `chat_name` | 群聊名（默认 `故事名 · 第1章`） |
| `response_mode` | 群聊响应模式（默认 `natural`） |
| `bind_persona` | 是否把 persona 绑定到群聊 |
| `persona` | `{name, description, first_mes, personality, avatar_file}` |
| `characters` | `[{name, description, first_mes, personality, avatar_file, roleType}]` |
| `worldbook` | `{name, intro, source_entries, dir}` |
| `chapters` | `{dir, enabled_first_only}` |

> 手动编辑后不会被覆盖（脚本只读不写）。改了 story.json 想重新生成，先删掉这个文件。

---

## 七、关键实现细节

### 头像（avatar）流程
tavo 的角色卡不直接收 base64。流程：
1. `tavo_file_save(name="<name>.png", scope="global")` 上传原图 → 返回 `files/global/<name>.png` 引用路径
2. 把引用路径写进 card 的 `data.avatar` 字段

```python
# avatar_ref 是 files/global/xxx.png 引用，不是 base64
card = {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": {
        "name": name,
        "description": ...,
        "firstMes": ...,
        "personality": ...,
        "roleType": "npc",
        "avatar": avatar_ref,  # ← files/global/xxx.png
    }
}
```

### 群聊必须先建（avatar 上传要 chatId）
`tavo_file_save` 无论 scope 都要传 chatId。所以流程是：
1. 先 `sync_chat` 建空群聊拿 chat_id
2. 再 `sync_characters` 用 chat_id 传 avatar + 写 card
3. 再 `chat_update` 重绑 characterIds + lorebookIds + personaId

### persona 字段限制
`tavo_persona_create` 只支持：`name` / `description` / `avatar` / `active`。
**不要**传 `firstMes` / `personality`（会报 `persona.firstMes must be a supported persona field`）。

### 插件安装
`sync_plugins` 自动打包 `plugins/` 下所有子目录，匹配内置列表（7 个）后调 `tavo_plugin_install` + `tavo_plugin_set_enabled(true)`。

## 八、幂等策略

- **角色卡**：按 name search，命中复用 id；缺失才 create。`--force` 强制重导。
- **世界书**：按 name search，命中 update entries，缺失才 create。
- **群聊**：按 name search，命中 update 重绑，缺失才 create。`--chat-id` 直接指定。
- **章节 / 立绘变量**：直接覆盖写（`tf_story.edit` / `tf_progress` / `tf_sprites` / `tf_chapter_backgrounds` / `tf_sprite_fallback_bg`）。

可安全重跑，不会产生重复角色卡 / 世界书。

---

## 九、文件路径解析（相对故事目录）

脚本会自动在以下子目录找文件：
- 头像：`<名>.png` / `avatars/<名>.png` / `image/<名>.png` / `ex/avatars/<名>/original.png`
- MD：`<名>.md` / `avatars/<名>.md` / `roles/<名>.md`
- 章节背景：`image/chapter_*_background.png`
- 兜底背景：`image/cover.jpg` / `image/bg.jpg`
- 章节 JSON：`chapters/*.json`

---

## 十、连接配置（.env）

读项目根 `.env`：

```env
tavo_mcp_url=http://127.0.0.1:7347/mcp
tavo_mcp_toekn=28pd43   # 注意键名是 toekn（历史拼写）
```

> 模拟器用 `127.0.0.1`（需先 `adb forward tcp:7347 tcp:7347`）；真机用局域网 IP。

---

## 十一、输出示例

```
=== 连通性检查 ===
  MCP OK

故事目录: .cache/story/谁让这个山大王修仙的
故事: 谁让这个山大王修仙的
  [config] 自动生成 story_sync_config.json

=== sync chat ===
  [chat] create id=1 name=谁让这个山大王修仙的
=== chat_id = 1 ===

=== 同步角色卡 ===
  [persona] 复用 id=2 name=纯小白 avatar=files/global/纯小白.png
  [char]    复用 id=14 name=红缥缈 avatar=files/global/红缥缈.png
  [char]    复用 id=15 name=白锦儿 avatar=（无）
  ...

=== 同步世界书 ===
  [worldbook] 复用 id=1 name=谁让这个山大王修仙的
  [worldbook] 更新 entries=3

=== persona_id = 2 ===
  [chat] 重绑角色+世界书+persona OK

=== 同步章节 ===
  [chapter] chapter_1.json 第1章：穿越成山大王 (enabled=True)
  ...

=== 同步立绘资源 ===
  [sprite] 红缥缈 fg -> files/chat/sprite_fg_14.png
  [chapter_bg] chapter_1_background.png -> files/chat/chapter_bg_chapter_1.png
  [fallback_bg] cover.jpg -> files/chat/fallback_bg.jpg

=== 同步插件 ===
  [plugin] com.toonflow.story-event-manager -> ok=True version=1.4.0
  [plugin] com.toonflow.story-memory-manager -> ok=True version=1.0.8
  [plugin] com.toonflow.multi-character-stage -> ok=True version=2.0.4
  [plugin] com.toonflow.story-speaker -> ok=True version=2.0.2
  [plugin] com.toonflow.story-sprite-background -> ok=True version=1.0.0
  [plugin] com.toonflow.story-style -> ok=True version=1.3.5
  [plugin] com.toonflow.story-debug-eruda -> ok=True version=1.0.0
  已安装 7 个插件

=== 完成 ===
chat_id: 1
lorebook_id: 1
角色数量: 13
```
