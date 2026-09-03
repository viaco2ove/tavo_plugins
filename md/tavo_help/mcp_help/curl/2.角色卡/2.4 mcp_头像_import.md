# mcp 头像上传

头像字段是 CCv3 的 `data.avatar`。**必须是文件引用 `files/global/<name>`（由 `tavo_file_save` 返回），不能是 base64 data URI——客户端不渲染内嵌 base64，界面会显示空。**

先把图片落为文件、拿到引用路径：
```
tavo_file_save({ chatId, name:"<角色名>.<ext>", content:<base64>, options:{ scope:"global", encoding:"base64" } })
# 返回 path = files/global/<角色名>.<ext>
```

## 创建角色时上传头像

把上面拿到的 `files/global/...` 路径作为 `data.avatar` 整卡导入：
```
tavo_character_import_card({ card:{ spec:"chara_card_v3", spec_version:"3.0", data:{ ..., avatar:"files/global/<角色名>.<ext>" } } })
```

## 更新已有角色的头像

`tavo_character_update` **不会持久化 `avatar`**，只能走「导入新卡 → 重绑 → 删旧」：
1. `tavo_character_get(id)` 取完整 `data`。
2. 用上面的 `tavo_file_save` 落新头像，拿到路径。
3. `tavo_character_import_card({ card:{ ..., data:{ 完整旧的data, avatar:"files/global/..." } } })` → 得到新 id（按 name 新建）。
4. `tavo_chat_update(chatId, chat:{ characterIds:[新id], lorebookIds:[原lorebookIds] })` 重绑。
5. `tavo_character_delete(id)` 删旧卡。

> 注意：`tavo_character_import_card` 真名如此（非 `tavo_character_import`），入参无 `conflict` 字段；`tavo_file_save` 即使 `scope=global` 也要传 `chatId`。
