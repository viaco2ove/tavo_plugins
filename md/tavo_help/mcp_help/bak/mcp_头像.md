# mcp 头像上传

本文件记录在 tavo MCP 上给角色卡上传头像的实测结论、正确流程与踩坑。所有结论来自 2026-08-14 真实推送 12 角色头像（id 7–18 → 20–31）的过程。

## 结论速览

- **`tavo_character_update` 存不进头像。** 无论传「裸 CC 兼容 data」还是「完整 CCv3 wrapper」，都只同步文本字段，`avatar` 永远不会持久化（连 1×1 极小 data URI 也写不进，返回 ok 但 `get` 仍 `null`）。
- **`tavo_character_import_card` 是唯一能存头像的路径**，而且它是**整卡替换**：必须传「完整 `data` 对象 + `avatar`」，只传 `{name, avatar}` 会丢掉性格/对白等字段。
- 该工具按 `name` **新建而非覆盖** → 会产重复卡。正确流程 = **导入新卡 → 重绑群聊 → 删旧卡**。
正确做法：先把图片作为文件上传（落到 charaCard/...png），再把 data.avatar 设成那个路径再导入。而不能是base64 图片
## 工具实测对比

| 工具 | 能否存 `avatar` | 行为 | 备注 |
| --- | --- | --- | --- |
| `tavo_character_update(id, character)` | ❌ 否 | 只同步文本字段，`avatar` 被忽略 | 裸 data / 完整 CCv3 wrapper 均无效 |
| `tavo_character_import_card({data, avatar})` | ✅ 是 | 整卡导入，**按 name 新建** | 真名是 `tavo_character_import_card`，非 `tavo_character_import` |
| `tavo_character_import({...})` | — | 不存在 | 早期推测的错名，勿用 |

> 字段名约定：`tavo_character_update` 入参是 `id + character`（非 `characterId`）；`tavo_character_import_card` 入参没有 `conflict` 字段（`conflict` 仅 theme 用）。

## 正确上传流程（见上方 ⚠️ 修正：data URI 能存但不能渲染）

> 上一版"压缩成 data URI 直接塞 `data.avatar`"的走法**只能存进库、界面仍空**。真正的有效格式是 `charaCard/...png` 文件引用（见第 10 行结论）。下面的步骤需按"最终 `data.avatar` 必须是文件引用"来落地，具体产出方式待连上 MCP 后实测确认（见文末待验证项）。

1. **拉取旧卡完整数据**：`tavo_character_get(id)` 取回完整 `data`（含 `description`/`personality`/`first_mes` 等），避免丢字段。
2. **准备头像文件**：原图 1.1MB 偏大，压到 **300KB 以内**（PNG 无损优化不够就转 JPEG q≈80–88）。
3. **上传为资源文件并拿到引用路径**：把图片作为文件上传，落到 `charaCard/...png` 这类资源引用（具体工具/命名空间待实测：候选为「完整 CCv3 wrapper 导入时服务端自动提取 dataUrl→charaCard 资源」，或 `tavo_file_save` 落文件后引用返回路径）。
4. **导入新卡**：`tavo_character_import_card({card:{完整 data, avatar: <文件引用路径>}})` → 得到新 id（按 name 新建）。
5. **重绑群聊**：`tavo_chat_update(chatId, chat:{characterIds:[新ids], lorebookIds:[原lorebookIds]})`。
6. **删旧卡**：`tavo_character_delete(id)` 清掉旧卡，避免重复。
7. **验收**：`tavo_character_get` 回看 `data.avatar` 应是 `charaCard/...png` 形式，且**界面真能显示**才算成功。

> 之所以不直接覆盖：import 工具无 `overwrite` 语义，只会新建，所以必须用「导入→重绑→删旧」三步收口。

## 头像 data URI / 文件引用 处理

- 头像在 CCv3 形状里是一等字段：`data.avatar`。它**可以**是 data URI（`data:image/png;base64,...`），也**可以**是文件引用（`charaCard/...png`）。
- ⚠️ **关键坑**：data URI 能写进库，但 Tavo 客户端**不渲染**内嵌 base64；只有 `charaCard/...png` 这类资源文件引用才会显示（参照 3 个内置角色验证）。
- 大小敏感：1.1MB 大图在传输中易被静默丢弃/超时，**建议压到 300KB 以内**。
- 用 Pillow 压缩（`PIL 11.3.0` 可用）：超过 300KB 先压，PNG 不够小则转 JPEG。

## 环境与连接约定（影响头像上传成败）

- **MCP Server 默认关闭**：tavo 桌面端需手动开启（设置 → MCP Server → 选访问范围 → 启用）。
- **重启用时 URL/IP 可能变**（DHCP）：每次联网前必须重读 `.env` 的 `tavo_mcp_url`，不要缓存旧 IP。
- 沙箱联网需 `dangerouslyDisableSandbox: true`；传 1.1MB 大图后若 `ConnectTimeout`，多半是 MCP Server 被关，让用户保持桌面端开着。
- 文件类工具（如 `tavo_file_save`）即使 `scope=global` 也要传 `chatId`。

## 踩坑记录

- 最早推送 12 角色时，Tavo-native `character` 形状只传了 `{name, description, first_mes, personality, roleType}`，**漏了 `avatar`** → 头像全空。
- 误以为 `update` 支持头像：塞 1×1 极小图返回 ok 但 `get` 仍 null，实测确认 update 不持久化 avatar。
- 误以为工具名是 `tavo_character_import`、有 `conflict` 字段 → 真名是 `tavo_character_import_card`，无 `conflict`。
- 只传 `{name, avatar}` 导入 → 文本字段全丢；必须带完整 `data`。
- 按 name 导入产生重复卡（误建 id=19，已删），需后续清理旧卡。

## 本次执行结果（2026-08-14，含返工）

- 12 角色 id 7–18 → **20–31**，头像以 data URI 形式**写入库**、字段保留（当时校验 12/12）。
- 群聊 6：`characterIds=[20..31]`、`lorebookIds=[1]`。
- 旧卡 7–18 及探测误建 19 已删。
- ⚠️ **但该次校验只看了"库里有 avatar"，没看界面渲染**：data URI 不被 Tavo 客户端渲染，用户侧仍显示空头像。需按上方修正重做（把 `data.avatar` 改成 `charaCard/...png` 文件引用）。

## 产物脚本

- `upload_avatars_v2.py`（位于 `.cache/story/谁让这个山大王修仙的/`）：导入 + 重绑 + 清理，`--dry` 可预演。
- `avatar_status.md`：排查结论与方案。
- `push_result.json`：最终 id 映射（chat_id=6, lorebook_id=1, character_ids=20–31）。
