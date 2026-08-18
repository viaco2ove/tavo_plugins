# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **tavo plugin library** for developing plugins that extend the tavo chat application's functionality. The primary project is `toonflow_story_memory_manager` — a plugin that provides structured long-term memory management for AI roleplay conversations.

## Key Reference Resources

- **Tavo JavaScript API**: https://docs.tavoai.dev/cn/guides/javascript-api/
- **Plugin Development Guide**: https://docs.tavoai.dev/cn/guides/plugin-development/
- **Plugin System**: https://docs.tavoai.dev/cn/guides/plugins/
- **MCP Server**: https://docs.tavoai.dev/cn/guides/mcp-server/
- **Toonflow-game Source**: https://github.com/viaco2ove/Toonflow-game.git
  - The memory manager agent (`story_memory_manager`) is the reference implementation for the plugin
  - Key file: `toonflow-game-app/src/lib/fixDB.prompts.ts` (contains `_PROMPT_STORY_MEMORY` system prompt)

## Architecture

### Plugin Structure
```
toonflow_story_memory_manager/
├── manifest.json       # Plugin manifest (specVersion 2)
├── entry.js            # Main entry with hooks and logic
├── locales/
│   ├── en.json
│   └── zh-CN.json
├── ui/
│   └── panel.html      # Floating memory status panel
└── cover.png
```

### Plugin Data Storage
All plugin state uses chat-scoped variables under the `tmm` namespace:
```javascript
tavo.set('tmm', { version: 1, meta: {...}, cards: {...}, world: '', worldClock: null }, 'chat')
```

### Core Hooks
| Hook | Purpose |
|------|---------|
| `chat:opened` | Initialize/migrate tmm state |
| `message:added` | Trigger async memory refresh (throttled) |
| `generation:prepare` | Inject memory context into generation prompt |
| `input:beforeSend` | Intercept `@记忆管理` direct commands |

### Memory Flow
1. **Write side**: On `message:added`, throttled fire-and-forget calls `tavo.generate()` to extract memory updates
2. **Read side**: On `generation:prepare`, prepends memory block to `event.text` (model-only, doesn't modify saved messages)
3. **Direct commands**: `@记忆管理` prefix triggers management operations

## Plugin Packaging

Plugins are packaged as `.tpg` files (zip format with manifest.json at root):

```powershell
cd plugins\toonflow_story_memory_manager
Compress-Archive -Path manifest.json, entry.js, locales, ui, cover.png -DestinationPath ..\toonflow_story_memory_manager.tpg
```

## Design Documents

Detailed design specs are in `md/currdesign/toonflow_story_memory_manager/`:
- `设计文档.md` — Source analysis, tavo capability mapping, architecture, risk boundaries
- `提示词设计.md` — System/user prompt templates, JSON schema, parsing rules
- `插件包草案.md` — Target file tree, manifest draft, i18n keys, entry.js skeleton

## Design Decisions (Key Points)

1. **Async memory refresh**: Fire-and-forget on `message:added`, never blocks chat flow
2. **Injection via `generation:prepare`**: Modifies `event.text` only (model-only, no saved message changes)
3. **Compact/full dual mode**: Compact mode reduces token usage, configurable via settings
4. **No auto writeback**: Role card patches are stored in `tmm.cards` but not auto-synced back to tavo character cards (avoids confirmation dialogs)
5. **JSON parsing resilience**: Triple-layer unwrap + safe parse + sanitize for unreliable model output

## 不允许随意放置测试和临时文档
测试脚本和文档和临时文档
只允许放置在.cache 文件夹下。

## git 提交限制
不允许自己commit 和push 到 git


## 特别注意
[for_ai.md](md/toonflow-game-md/for_ai.md)

不要乱改我的提示词！提示词完全看齐toonflow game!!!!  然后在  md/currdesign/toonflow_story_llm_optimization 设计 llm 优化器 向toonflow game 看齐。
  开发plugins/toonflow_story_llm_optimization  增加思考程度配置（信息面板的故事配置里）默认为minimal（gobal） 。接口调用和解析也有完全接管。其他插件的对llm 返回的处理也完全看齐    
  toonflow game
[toonflow_ai_game_agent.md](.hide/toonflow_ai_game_agent.md)[@.hide/toonflow_ai_game_agent.md:4-9] 

## 特别注意 - cli
不能直接调用 python文件来操作 tava mcp 要 通过
调用 “tavo” 命令 来维护 故事同步等功能
[py_cli.md](md/cli/py_cli.md)

例如：tavo characters              # 列出全部角色
