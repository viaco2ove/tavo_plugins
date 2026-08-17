# toonflow_story_event_manager 的 故事配置里增加立绘头像上传绑定到角色的能力
# currdesign/toonflow_sprite_background
根据当前章节显示背景图片。 然后上面叠加角色立绘头像的能力
# toonflow_story_sprite_background 设计文档

> 目标：把 Toonflow-game 的「立绘」能力对齐到 tavo 插件体系。
> 以《谁让这个山大王修仙的！》为例，用 MCP 把角色立绘资源 + 章节背景资源传入 tavo，再由插件在聊天页渲染成「背景 + 角色立绘前景」两层。

---


## 一、与 Toonflow-game 立绘能力对齐

### 1.1 Toonflow-game 的真源

- 组件：`Toonflow-game-web/src/components/LayeredAvatar.vue`
- 角色字段：`Toonflow-game-web/src/types/toonflow.ts` → `StoryRole`

| 字段 | 含义 | 对应本地下载文件 |
|---|---|---|
| `avatarPath` | **前景立绘**：角色主体图，显示在容器底部居中，`object-fit: contain` | `ex/avatars/<角色>/original.png` |
| `avatarBgPath` | **立绘背景**：铺满容器，`object-fit: cover`，通常是原图模糊/虚化后的氛围底图 | `ex/avatars/<角色>/background.png` |
| `avatarSourcePath` | 生图后未分离的原始图 | `ex/avatars/<角色>/original.png` |
| `avatarVideoPath` | 动画版立绘（WebP/MP4） | 本次未下载动画，暂不支持 |
| `voiceReferenceAudioPath` | 角色音色参考音频 | `ex/avatars/<角色>/voice.wav`（本插件暂不用） |

### 1.2 渲染方式

`LayeredAvatar.vue` 的 CSS 说明一切：

```css
.layered-avatar__bg { object-fit: cover; }      /* 立绘背景：全铺满 */
.layered-avatar__fg { object-fit: contain; object-position: center bottom; }  /* 前景：底部居中 */
```

**对齐到 tavo**：在聊天页注入一个绝对定位的 DOM 层，同样分两层：

1. **背景层**：默认用当前章节的场景背景图；当切换到某个角色发言时，可切换为该角色的 `avatarBgPath`（氛围背景）。
2. **前景层**：显示当前发言角色的 `avatarPath`（original.png），底部居中，contain 缩放，不遮挡消息流。

> 注意：下载的 `original.png` 大多是 1024×1024 RGB（非透明），所以前景层本质是「角色全身/半身像」而不是「去背透明 PNG」。这不影响显示——tavo 同样用 `object-fit: contain` 居中底部即可，与 toonflow-game 的行为一致。

---

## 二、资源目录约定（以「谁让这个山大王修仙的」为例）

### 2.1 已下载资源

```text
.cache/story/谁让这个山大王修仙的/
├── ex/avatars/<角色名>/          # 服务器真实立绘结构
│   ├── original.png              # 前景立绘（对应 avatarPath）
│   ├── background.png            # 立绘背景（对应 avatarBgPath）
│   ├── avatar.webp / avatar.png  # 小头像（对应角色卡头像）
│   ├── voice.wav                 # 音色参考
│   └── role.json                 # 角色元数据
├── image/
│   ├── chapter_1_background.png  # 第 1 章场景背景
│   ├── chapter_2_background.png  # 第 2 章场景背景
│   ├── bg.jpg / cover.jpg        # 通用背景/封面
│   └── ...
├── avatars/                      # 旧版平铺头像（1024×1024 RGB）
├── chapters/chapter_*.json       # 章节配置（含 background/backgroundPrompt）
└── story_sync_config.json        # 角色列表与 tavo 映射
```

### 2.2 实际尺寸实测

| 文件类型 | 尺寸 | 模式 | 用途 |
|---|---|---|---|
| `ex/avatars/<角色>/original.png` | 1024×1024 | RGB | 主角色前景立绘 |
| `ex/avatars/<角色>/background.png` | 768×768 | RGB | 立绘氛围背景 |
| `ex/avatars/<角色>/avatar.webp` | 512×512 | RGBA | 小头像/头像 |
| `image/chapter_1_background.png` | 1216×832 | RGB | 第 1 章场景背景 |
| `image/chapter_2_background.png` | 1216×832 | RGB | 第 2 章场景背景 |

---

## 三、MCP 传入 tavo 的数据设计

### 3.1 设计原则

- 不依赖角色卡 `data.avatar`：实测 `tavo_character_update` 写不进 `avatar`（`avatar_status.md` 已踩坑）。
- 所有图片走 `tavo_file_save` 上传到 `files/<scope>/<name>`，返回虚拟路径。
- 角色与图片的映射用 chat 变量保存，插件从变量读取。

### 3.2 上传目标

建议统一用 **chat 作用域**，避免 chat reset 后背景图丢失（`avatar_status.md` 提示 global 更稳，但背景图若只服务于当前 chat，chat 作用域即可）。

| 源文件 | 上传后路径 | 说明 |
|---|---|---|
| `ex/avatars/<角色>/original.png` | `files/chat/sprite_fg_<tavo角色id>.png` | 前景立绘 |
| `ex/avatars/<角色>/background.png` | `files/chat/sprite_bg_<tavo角色id>.png` | 立绘氛围背景 |
| `ex/avatars/<角色>/avatar.webp` | `files/chat/avatar_<tavo角色id>.webp` | 可选：插件内当头像用 |
| `image/chapter_N_background.png` | `files/chat/chapter_bg_<章节key>.png` | 章节场景背景 |

### 3.3 变量结构

写入 chat 作用域的变量（`scope=chat`）：

```json
{
  "tf_sprites": {
    "byName": {
      "纯小白": {
        "fg": "files/chat/sprite_fg_25.png",
        "bg": "files/chat/sprite_bg_25.png",
        "avatar": "files/chat/avatar_25.webp",
        "roleType": "player"
      },
      "红缥缈": {
        "fg": "files/chat/sprite_fg_26.png",
        "bg": "files/chat/sprite_bg_26.png",
        "avatar": "files/chat/avatar_26.webp",
        "roleType": "npc"
      }
    },
    "byId": {
      "25": { "name": "纯小白", "fg": "...", "bg": "..." },
      "26": { "name": "红缥缈", "fg": "...", "bg": "..." }
    }
  },
  "tf_chapter_backgrounds": {
    "chapter_1": "files/chat/chapter_bg_chapter_1.png",
    "chapter_2": "files/chat/chapter_bg_chapter_2.png"
  },
  "tf_story_config": {
    "spriteEnabled": true,
    "defaultFgMode": "contain",
    "defaultFgPosition": "center bottom",
    "showForNarrator": false,
    "backgroundMode": "chapter", // chapter | character | both
    "version": "1.0.0"
  }
}
```

说明：

- `byName` 用角色名匹配（插件从消息 `characterName` 直接取）。
- `byId` 用 tavo `characterId` 匹配（更稳，避免重名）。
- `backgroundMode`：
  - `chapter`：背景层跟随当前章节场景背景；
  - `character`：背景层跟随当前发言角色的 `bg`（氛围背景）；
  - `both`：章节场景打底 + 角色氛围图叠上方半透明。

---

## 四、插件架构：`plugins/toonflow_story_sprite_background/`

### 4.1 目录结构

```text
plugins/toonflow_story_sprite_background/
├── manifest.json
├── entry.js
└── ui/
    └── sprite_layer.html
```

### 4.2 `manifest.json`

```json
{
  "id": "toonflow_story_sprite_background",
  "name": "Toonflow Story 立绘背景",
  "version": "1.0.0",
  "description": "在 tavo 聊天页复刻 Toonflow-game 的 LayeredAvatar 立绘效果：章节背景 + 角色前景立绘。",
  "author": "toonflow",
  "permissions": ["file", "variable", "message", "chat"],
  "htmlFragments": [
    {
      "path": "ui/sprite_layer.html",
      "position": "/chat/body/end"
    }
  ]
}
```

### 4.3 `ui/sprite_layer.html` 关键结构

```html
<div id="tf-sprite-layer" class="tf-sprite-layer">
  <!-- 章节/角色氛围背景层 -->
  <div class="tf-sprite-bg-wrap">
    <img id="tf-sprite-bg" class="tf-sprite-bg" src="" alt="background" />
  </div>
  <!-- 角色前景立绘层 -->
  <div class="tf-sprite-fg-wrap">
    <img id="tf-sprite-fg" class="tf-sprite-fg" src="" alt="sprite" />
  </div>
</div>
```

关键 CSS（示例）：

```css
.tf-sprite-layer {
  position: fixed;
  left: 0; right: 0; top: 0; bottom: 0;
  pointer-events: none;
  z-index: 0; /* 必须低于消息流，高于原生 background */
}
.tf-sprite-bg-wrap {
  position: absolute; inset: 0;
  z-index: 1;
}
.tf-sprite-bg {
  width: 100%; height: 100%;
  object-fit: cover;
}
.tf-sprite-fg-wrap {
  position: absolute;
  left: 50%; bottom: 80px;        /* 底部留出消息输入区 */
  transform: translateX(-50%);
  width: min(80vw, 600px);
  height: min(70vh, 700px);
  z-index: 2;
}
.tf-sprite-fg {
  width: 100%; height: 100%;
  object-fit: contain;
  object-position: center bottom;
  filter: drop-shadow(0 10px 30px rgba(0,0,0,0.4));
}
```

> `z-index` 需要实测：目标是在原生聊天背景之上、消息气泡之下。若 tavo 消息流 `z-index` 更高，可适当调低立绘层透明度/尺寸，避免视觉冲突。

### 4.4 `entry.js` 核心逻辑

```js
const SCOPE = "chat";
const VAR_SPRITES = "tf_sprites";
const VAR_CHAPTER_BGS = "tf_chapter_backgrounds";
const VAR_CONFIG = "tf_story_config";

// 解包 tavo.get 的 {found, value} 包装
function readChatVar(name, defaultValue = null) {
  let value = tavo.get(name, SCOPE);
  let guard = 0;
  while (value && typeof value === "object" && value.hasOwnProperty("value") && value.hasOwnProperty("name")) {
    value = value.value;
    if (++guard > 5) break;
  }
  if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
    try { value = JSON.parse(value); } catch (_) {}
  }
  return value !== undefined && value !== null ? value : defaultValue;
}

function getCurrentSpeaker() {
  const msgs = tavo.message.find(0, Date.now());
  const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : null;
  if (!last) return null;
  return last.characterName || last.name || null;
}

function updateSprite(speakerName) {
  const sprites = readChatVar(VAR_SPRITES, {});
  const cfg = readChatVar(VAR_CONFIG, {});
  const entry = (sprites.byName || {})[speakerName] || null;

  // 旁白/万能角色可选择不显示
  if (!entry && cfg.showForNarrator === false) {
    document.getElementById("tf-sprite-fg").src = "";
    return;
  }

  const bgImg = document.getElementById("tf-sprite-bg");
  const fgImg = document.getElementById("tf-sprite-fg");

  // 前景：按角色立绘切
  if (entry && entry.fg) {
    if (fgImg.src !== entry.fg) fgImg.src = entry.fg;
  } else {
    fgImg.src = "";
  }

  // 背景：根据 backgroundMode 决定
  const chapterBgs = readChatVar(VAR_CHAPTER_BGS, {});
  const currentChapter = readChatVar("tf_story.edit.chapterIndex", null); // 由 event_manager 维护
  if (cfg.backgroundMode === "character" && entry && entry.bg) {
    if (bgImg.src !== entry.bg) bgImg.src = entry.bg;
  } else if (cfg.backgroundMode === "both") {
    // 章节打底 + 角色氛围图叠上方（需要两层 bg 容器）
    // 略：可扩展
  } else {
    const chapterKey = Object.keys(chapterBgs)[currentChapter || 0] || "chapter_1";
    if (chapterBgs[chapterKey] && bgImg.src !== chapterBgs[chapterKey]) {
      bgImg.src = chapterBgs[chapterKey];
    }
  }
}

// 监听新消息
Tavo.on("message:added", (event) => {
  const speaker = event.message?.characterName || event.message?.name;
  if (speaker) updateSprite(speaker);
});

// 也监听变量变化（章节切换时 event_manager 会改 chapterIndex）
Tavo.on("variable:changed", (event) => {
  if (event.name === "tf_story.edit.chapterIndex") {
    updateSprite(getCurrentSpeaker());
  }
});

// 初始化
updateSprite(getCurrentSpeaker());
```

### 4.5 与现有插件的协作

| 现有插件 | 协作点 |
|---|---|
| `toonflow_story_event_manager` | 维护 `tf_story.edit.chapterIndex`，sprite 插件监听其变化切换章节背景 |
| `toonflow_story_speaker` | 已识别当前说话角色，可复用其逻辑；sprite 插件只负责视觉层 |
| `toonflow_story_multi_character_stage` | 提供消息角色信息；sprite 层是独立 UI 层，不冲突 |
| `toonflow_story_style` | 可注入 CSS 变量控制立绘层大小/位置/动画 |

---

## 五、MCP 导入脚本设计

### 5.1 脚本位置

`script/tavo_mcp_use/sprites_import.py`

复用 `chapters_import.py` 的连接、认证、RPC、file_save 封装。

### 5.2 调用方式

```bash
# chatId 为整数，对应故事聊天 id
python sprites_import.py 2 .cache/story/谁让这个山大王修仙的
python sprites_import.py 2 .cache/story/谁让这个山大王修仙的 --dry
python sprites_import.py 2 .cache/story/谁让这个山大王修仙的 --force-bg  # 强制重传
```

### 5.3 脚本流程

1. **连接 MCP**（`.env` 或 `--url/--token`）。
2. **解析 `story_sync_config.json`**：拿到角色名列表与 `roleType`。
3. **解析 `ex/roles.json`**：拿到服务器端 `avatarSourcePath / avatarBgPath / avatarPath` 等字段（可选，用于校验）。
4. **解析 `ex/avatars/<角色>/`**：列出 `original.png`、`background.png`、`avatar.*`。
5. **用 `tavo_character_search` 按名字匹配** tavo 里的 characterId；匹配不到的记录 warn。
6. **上传图片**到 `files/chat/sprite_fg_<id>.png`、`sprite_bg_<id>.png`、`avatar_<id>.webp`。
7. **上传章节背景**到 `files/chat/chapter_bg_<key>.png`。
8. **写 chat 变量**：`tf_sprites`、`tf_chapter_backgrounds`、`tf_story_config`。

### 5.4 上传示例（Python 伪代码）

```python
def file_save_bytes(url, token, chat_id, name, b64, scope="chat"):
    res = rpc(url, token, "tavo_file_save", {
        "name": name,
        "content": b64,
        "options": {"scope": scope, "encoding": "base64"}
    })
    return res  # "files/chat/sprite_fg_25.png"

def variable_set(url, token, chat_id, name, value):
    rpc(url, token, "tavo_variable_set", {
        "scope": "chat",
        "chatId": int(chat_id),
        "name": name,
        "value": value
    })
```

---

## 六、实际数据示例：「谁让这个山大王修仙的」

### 6.1 角色映射（示例，需按实际 tavo characterId 填充）

```json
{
  "tf_sprites": {
    "byName": {
      "纯小白": { "id": 25, "fg": "files/chat/sprite_fg_25.png", "bg": "files/chat/sprite_bg_25.png", "avatar": "files/chat/avatar_25.webp", "roleType": "player" },
      "红缥缈": { "id": 26, "fg": "files/chat/sprite_fg_26.png", "bg": "files/chat/sprite_bg_26.png", "avatar": "files/chat/avatar_26.webp", "roleType": "npc" },
      "白锦儿": { "id": 27, "fg": "files/chat/sprite_fg_27.png", "bg": "files/chat/sprite_bg_27.png", "avatar": "files/chat/avatar_27.webp", "roleType": "npc" },
      "李玄风": { "id": 28, "fg": "files/chat/sprite_fg_28.png", "bg": "files/chat/sprite_bg_28.png", "avatar": "files/chat/avatar_28.webp", "roleType": "npc" },
      "陆青山": { "id": 29, "fg": "files/chat/sprite_fg_29.png", "bg": "files/chat/sprite_bg_29.png", "avatar": "files/chat/avatar_29.webp", "roleType": "npc" },
      "云火月": { "id": 30, "fg": "files/chat/sprite_fg_30.png", "bg": "files/chat/sprite_bg_30.png", "avatar": "files/chat/avatar_30.webp", "roleType": "npc" },
      "林月": { "id": 31, "fg": "files/chat/sprite_fg_31.png", "bg": "files/chat/sprite_bg_31.png", "avatar": "files/chat/avatar_31.webp", "roleType": "npc" },
      "琳琅": { "id": 32, "fg": "files/chat/sprite_fg_32.png", "bg": "files/chat/sprite_bg_32.png", "avatar": "files/chat/avatar_32.webp", "roleType": "npc" },
      "冷素心": { "id": 33, "fg": "files/chat/sprite_fg_33.png", "bg": "files/chat/sprite_bg_33.png", "avatar": "files/chat/avatar_33.webp", "roleType": "npc" },
      "苍山道人": { "id": 34, "fg": "files/chat/sprite_fg_34.png", "bg": "files/chat/sprite_bg_34.png", "avatar": "files/chat/avatar_34.webp", "roleType": "npc" },
      "某女子": { "id": 35, "fg": "files/chat/sprite_fg_35.png", "bg": "files/chat/sprite_bg_35.png", "avatar": "files/chat/avatar_35.png", "roleType": "general" },
      "某男子": { "id": 36, "fg": "files/chat/sprite_fg_36.png", "bg": "files/chat/sprite_bg_36.png", "avatar": "files/chat/avatar_36.png", "roleType": "general" },
      "旁白": { "id": 37, "fg": "", "bg": "", "avatar": "", "roleType": "narrator" }
    }
  }
}
```

> 旁白 `fg` 为空，默认不显示立绘（`showForNarrator: false`）。

### 6.2 章节背景映射

```json
{
  "tf_chapter_backgrounds": {
    "chapter_1": "files/chat/chapter_bg_chapter_1.png",
    "chapter_2": "files/chat/chapter_bg_chapter_2.png"
  }
}
```

---

## 七、渲染规则与边界

| 场景 | 行为 |
|---|---|
| 角色 A 发言 | 前景切换为 A 的 `fg`；背景按 `backgroundMode` 决定 |
| 用户发言（纯小白） | 同角色逻辑；若用户没有前景图则隐藏 |
| 旁白发言 | 默认隐藏前景；背景保持当前章节场景 |
| 万能角色（某男子/某女子） | 显示对应通用立绘 |
| 章节切换 | `event_manager` 修改变量 `tf_story.edit.chapterIndex`，插件监听后切背景 |
| 找不到角色图 | 保持上一张 / 淡出 / 显示占位，不写死 |
| 消息流遮挡 | 立绘层 `pointer-events: none` + z-index 低于消息；必要时底部预留 80-120px |

---

## 八、实现优先级

1. **P0**：最小可跑验证——只做 `foreground` 层：一个角色发言时显示其 `original.png`，测通 `files/chat/` 图片在 `<img>` 中可渲染、z-index 卡位正确。
2. **P1**：加 `background` 层：章节背景 + 角色氛围背景切换。
3. **P2**：平滑过渡动画（cross-fade）、多角色同框（左右并排列两个角色立绘）。
4. **P3**：把 `avatar.webp` 也同步进 `tf_sprites`，供其他插件/原生头像使用（可选）。

---

## 九、风险与已知限制

| 风险 | 影响 | 兜底 |
|---|---|---|
| `tavo_file_save` 上传后路径不可读 | 中 | 用 base64 回显测试；tavo 已验证 `files/chat/x.png` 可被面板渲染 |
| `original.png` 是 RGB 非透明，前景会自带背景 | 中 | 与 toonflow-game `LayeredAvatar` 用 `object-fit: contain` 保持一致；视觉上就是大张角色图 |
| 旁白.png 在 `ex/avatars/旁白/` 下不存在图片 | 低 | 旁白默认不显示立绘 |
| 纯小白 ex 目录缺少 `original.png` | 低 | 导入脚本 fallback 用 `avatar.webp` 或提示用户 |
| z-index 被 tavo 消息流/输入框覆盖 | 中 | 先实测；预留底部安全区；必要时半透明 |
| 手机端 AVD 实例 chat 角色 id 与手机不同 | 高 | 脚本必须用 `tavo_character_search` 按名字解析 id，不可 hardcode |
| `tavo_image_generate` 服务端不可用 | 无 | 本设计只上传本地已下载资源，不调用生图 |

---

## 十、一句话总结

> 对齐 toonflow-game 的 `LayeredAvatar.vue` 模型：用 MCP 把 `ex/avatars/<角色>/original.png` 作为前景立绘、`background.png` 作为立绘背景、`image/chapter_*_background.png` 作为章节场景背景上传到 `files/chat/`，再通过 `toonflow_story_sprite_background` 插件在 tavo 聊天页渲染「章节背景 + 当前说话角色立绘前景」两层。
