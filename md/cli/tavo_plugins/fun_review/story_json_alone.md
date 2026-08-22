# 命令执行检查

```bash
python -m tavo_plugins sync --story-json "story.json" --force --skip-plugins
```

## 用户身份测试 ✅

| 测试项 | 结果 |
|--------|------|
| Persona 头像 | `files/global/纯小白.png` ✅ |
| tf_sprites 立绘绑定 | `纯小白 fg=files/chat/sprite_fg_29.webp` ✅ |
| tf_character_voices 音色绑定 | `纯小白 audioRef=files/global/voice_纯小白.wav` ✅ |

## 故事信息绑定 ✅

读取代码：
```javascript
const edit = readChatVar('tf_story.edit') || {};
let bg = String(edit.globalBackground || '').trim();
```

| 变量 | 结果 |
|------|------|
| `edit.intro` | 有内容 ✅ |
| `edit.globalBackground` | 有内容 ✅ |
| `edit.cardScenario` | 有内容 ✅ |
| `edit.cardTags` | 有内容 ✅ |

## 章节数据绑定 ✅

| 变量 | 结果 |
|------|------|
| `edit.chapters[0].openingRole` | `旁白` ✅ |
| `edit.chapters[0].openingLine` | 有内容 ✅ |
| `edit.chapters[0].background` | 有内容 ✅ |
| `edit.chapters[0].content` | 1238 字符 ✅ |
| `edit.chapters[0].successCondition` | 有内容 ✅ |
| `edit.chapters[0].title` | `第 1 章：穿越成山大王` ✅ |