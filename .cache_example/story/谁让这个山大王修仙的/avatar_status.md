# 头像上传状态 · 谁让这个山大王修仙的

> 生成时间：2026-08-14 18:0x

## 现状
tavo 上 12 个角色（id 7–18）的 `avatar` 字段**全部为空（null）**——头像尚未上传。

## 素材
参考故事自带 `avatars/` 目录，含 **12 张 PNG，与角色一一对应**，已复制到工作缓存：
`D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.cache\story\谁让这个山大王修仙的\avatars\`

- 纯小白.png / 红缥缈.png / 白锦儿.png / 李玄风.png / 陆青山.png / 云火月.png
- 林月.png / 琳琅.png / 冷素心.png / 苍山道人.png / 某女子.png / 某男子.png

## 为什么没直接传成功（已排查）
1. 第一关：`character_update` 接受完整 CCv3 数据对象，但**实测写不进 `avatar` 字段** ——
   即使塞 1×1 极小 data URI，返回 `ok:true` 但 `get` 回来仍是 `null`（证伪了“图片太大被静默丢弃”的假设，与体积无关）。
2. 第二关：`avatar` 设为 `files/global/xxx.png` 路径引用也写不进（同样 `null`）。
3. 第三关：已把 `纯小白.png` 试存进 `files/global/`（含 `纯小白.png` 与 `avatar_纯小白.png` 两个名），
   但角色 `avatar` 字段并不引用它们，因此前端不显示。
4. **结论**：tavo 当前 MCP 的 `character_update` 不支持写头像。正确机制大概率是
   `tavo_character_import`（整卡导入）或**客户端 UI 手动设置**——后者未走 MCP。

## 网络
tavo MCP（`10.10.2.208:7347`）间歇可达：本轮回合前半段能连（HTTP 200），
传 1.1MB 大图 dataUrl 后开始 `ConnectTimeout`。需保持 tavo 桌面端 **MCP Server 开启**。

## 下一步方案
- **方案 B（最快最稳）**：在 tavo 客户端进入每个角色 → 编辑 → 上传头像，素材用上面 12 张 PNG。
- **方案 A（联网后我试）**：tavo MCP 恢复后，查 `tavo_character_import` 是否支持带头像整卡导入；
  若支持，用压缩后的小图（建议 < 200KB）重建 12 角色（会自动换 id，需重新绑群聊）。
