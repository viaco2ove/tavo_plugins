https://docs.tavoai.dev/cn/guides/mcp-server/
---
title: "MCP Server"
description: "通过内置 MCP Server，让 AI agent 连接并操作 Tavo。"
---

# MCP Server

**自 v0.91.0 起**

Tavo 内置 MCP Server，允许 AI agent（如 Codex 或 Claude Code）连接后进行创作。创作过程不再需要重复 `创作-导入-验证` 的流程，可以直接在 Tavo 中快速验证。

MCP Server 内置当前版本的运行时文档，agent 连接后会自行阅读并调用各类工具，包括但不限于读取或修改 Tavo 角色、世界书、正则、预设、用户身份、聊天主题、聊天、消息和长期记忆等数据，也可以查看当前版本的运行时状态。

聊天主题提供 `tavo_theme_search`、`tavo_theme_get`、`tavo_theme_create`、`tavo_theme_update`、`tavo_theme_import`、`tavo_theme_export` 和 `tavo_theme_delete`。`tools/list` 与 `tavo://schemas/chat-theme` 会列出和运行时校验一致的完整嵌套字段，未知字段会被拒绝。可通过 `tavo://themes/{id}` 读取主题资源。导入、导出必须明确传入 `chatId`，并使用聊天隔离的 `.thm` 文件。导入冲突默认报错，可用 `conflict: "overwrite"` 或 `conflict: "saveAs"` 重试。官方主题只读。压缩文件最大 64 MiB，最多 16 个常规条目，总解压大小最大 256 MiB。

长期记忆提供 `tavo_memory_get`、`tavo_memory_update` 和
`tavo_memory_append`，调用时需明确传入 `chatId`。即使关闭记忆注入，这些工具仍然
可用。append 会保留已有条目，也不会自动开启记忆注入。

角色写入工具支持裸 CC 兼容 data、完整 CCv2/CCv3 wrapper 和 SillyTavern 角色 wrapper。世界书工具支持 CCv3 data、独立 `lorebook_v3`、SillyTavern World Info 和 Tavo 原生条目。`tavo://schemas/*` 资源提供 JSON Schema Draft 2020-12 文档，精确的工具调用参数以实时 `tools/list` 为准。

无效的工具输入返回 JSON-RPC `-32602`（Invalid params）。
`error.data.reason` 说明拒绝原因，安全的 `error.data.details` 可能标出 `path`、
`expected` 和 `actualType`。角色卡和世界书导入内容中的值与 key 是用户可见内容，
可能出现在诊断信息中。内部失败则返回 `-32603`（Internal error），且不包含校验
`details`，客户端不应把它当成可通过修改参数修复的错误。
消息工具会校验 range、filter、id/index selector 和可写字段。无效输入会指出
`filter.hidden`、`message.content` 等路径，找不到目标消息时返回 `-32004`、对应
聊天的 `tavo://chats/{id}/messages` URI，以及安全的 selector 详情。
聊天和用户身份的创建、更新工具也提供具体 schema。无效值会指出
`chat.characterIds[0]`、`chat.pinned`、`chat.mutedCharacterIds[0]`、
`persona.description` 或 `persona.id` 等路径。找不到资源时返回 `-32004`，
并附带对应的聊天、用户身份、角色、预设、世界书或正则资源 URI。

## 文件工具

MCP 提供 `tavo_file_save`、`tavo_file_load`、`tavo_file_delete`、
`tavo_file_exists` 和 `tavo_file_list`。所有调用都必须明确传入 `chatId`，
包括使用全局作用域时。聊天作用域是默认值，全局作用域只应在明确需要跨聊天时使用。

| 工具 | 必填参数 | 可选参数 |
| --- | --- | --- |
| `tavo_file_save` | `chatId`、`name`、`content` | `options.scope`、`options.encoding` |
| `tavo_file_load` | `chatId`、`name` | `options.scope`、`options.encoding` |
| `tavo_file_delete` | `chatId`、`name` | `options.scope` |
| `tavo_file_exists` | `chatId`、`name` | `options.scope` |
| `tavo_file_list` | `chatId` | `options.scope`、`options.limit`、`options.cursor` |

`name` 是不含路径分隔符、冒号或父目录片段的单个文件名。保存和读取支持
`utf8`、`base64` 和 `dataUrl`。`tavo_file_list` 的 `limit` 范围为 1 到
200，默认 100；下一页使用上一页返回的不透明 `nextCursor`。

```json
[
  {
    "tool": "tavo_file_save",
    "arguments": {
      "chatId": 42,
      "name": "notes.txt",
      "content": "通过 MCP 保存",
      "options": { "scope": "chat", "encoding": "utf8" }
    }
  },
  {
    "tool": "tavo_file_list",
    "arguments": { "chatId": 42, "options": { "limit": 10 } }
  },
  {
    "tool": "tavo_file_load",
    "arguments": { "chatId": 42, "name": "notes.txt" }
  },
  {
    "tool": "tavo_file_exists",
    "arguments": { "chatId": 42, "name": "notes.txt" }
  },
  {
    "tool": "tavo_file_delete",
    "arguments": { "chatId": 42, "name": "notes.txt" }
  }
]
```

这意味着你可以让 agent 直接辅助创作角色卡、整理世界书、调整正则、编写插件，或把当前聊天上下文转成可复用的素材。

## 启用服务器

1. 打开 `设置`。
2. 进入 `MCP Server`。
3. 选择访问范围。
4. 启用服务器。
5. 把 URL 和 bearer token 复制到你的 MCP 客户端。

服务器默认关闭。如果没有手动设置 token，Tavo 会在启用服务器时自动生成一个 bearer token。

<Warning title="请保护 bearer token">

任何能访问 MCP endpoint 且拥有 bearer token 的客户端，都可以调用暴露出的 Tavo 工具。不要把 token 粘贴到公开聊天、截图、文档、日志或 issue 里。
</Warning>

## Agent 客户端

你不需要手动记命令。最简单的方式是把 Tavo 生成的完整连接配置发给 agent。

1. 在 MCP Server 页面底部点击 `复制完整连接配置`。
2. 在和 agent 的聊天里发送：

```
Tavo MCP Server: 0.91.0
Preferred access: direct HTTP JSON-RPC
Server URL: http://192.168.0.1:7347/mcp
Authorization: Bearer 123456
```

3. agent 反馈连接成功。
4. 继续对 agent 说：

```text
帮我写一张角色卡，是一位在星际漂泊多年的帝国公主
```

5. agent 反馈写卡成功，你就可以在 Tavo 里查看和继续编辑这张角色卡。

## 无法连接？

请先检查：

1. MCP Server 是否运行中，可尝试关闭后重新开启。
2. 确认两台设备在可互通的网络中。VPN、访客网络、防火墙可能会拦截连接。
3. 没有 Wi-Fi 时，可用手机热点或 USB 网络共享，并保持局域网模式。
4. 如果开启了个人热点，请让对方设备接入该热点。不用热点时可关闭后重试。
5. 蜂窝网络显示的 IP 可能是运营商内网地址，其他设备不一定能访问。
6. 只有从私有网络外访问时，才使用公共网络。通常还需要端口转发、隧道或反向代理。

常见错误：

- 401：Token 缺失或错误。
- 403：访问范围不允许当前设备连接。
- 404/405：URL 或请求方式不对。应使用 POST 请求。
- 连接超时：通常是网络、IP、端口或防火墙问题。
