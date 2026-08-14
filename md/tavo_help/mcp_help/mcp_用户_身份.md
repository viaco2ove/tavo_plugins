# 用户身份（persona）

tavo 里「用户身份」= **persona 资产**（`kind: persona`）。它决定 AI 角色如何看待你、如何与你互动（`{{user}}` 的入场券）。MCP 通过 `tavo_persona_*` 管理，无需去桌面端「更多 → 用户身份」手动建。

## 关键字段

`persona = { name, description(身份描述), avatar, active }`
- `description`：身份描述，按「关系 + 状态 + 基调」写 1–2 句（见下）。
- `avatar`：虚拟路径，如 `files/global/xxx.jpg`（MCP 内 `<img>` 用 `tavo.file.load(...,dataUrl)` 渲染，不要直接 `<img src>`）。
- `active`：是否为当前默认身份（全局唯一激活项）。

## 在某个群聊里以指定身份发言（以「纯小白」为例）

1. **建身份并激活**：
   ```
   tavo_persona_create({ persona: { name:"纯小白",
     description:"你是纯小白，阴差阳错穿越后子承父业当上黑风寨大当家（山大王）的穿越者……",
     avatar:"files/global/纯小白.jpg", active:true } })
   # 返回 id（如 2）。active:true 即设为当前默认身份；否则再调：
   tavo_persona_set_active({ id: <新id> })
   ```
2. **绑定到群聊**（让该聊天的用户身份固定为此 persona）：
   ```
   tavo_chat_update({ id: <chatId>, chat: { personaId: <新id> } })
   ```
3. **以该身份发言**：直接 append 一条 `role:"user"` 消息，服务端会按当前激活 persona 自动填 `speakerName` / `speakerAvatar`：
   ```
   tavo_message_append({ chatId: <chatId>,
     message: { role:"user", content:"（把腿一盘）本大王今日心情甚好……" } })
   # 回写 speakerName="纯小白"、speakerAvatar="files/global/纯小白.jpg"
   ```
   > 想走完整聊天流（含触发编排师/NPC 回应），也可：`tavo_current_chat_set({id})` → `tavo_input_set({text})` → `tavo_input_send()`。

## 身份描述 编写心法（description）

1. 你与角色的关系（陌生/挚友/宿敌/首领与部下…）
2. 你在此情境的基本状态（为何在此、已知信息、目标）
3. （可选）互动基调（轻松/紧张/亲密）

例：「你是纯小白，子承父业当上黑风寨大当家的穿越者，身怀『财气眼』金手指；腹黑搞笑、护短，以匪道行仙道。你是山上众弟兄的首领，与在场角色是首领与部下的关系。」

## 实测记录（群聊 6「谁让这个山大王修仙的！·第1章」）

- 原 `personaId:1(User)` → 新建 `纯小白`(id=2) 并 `set_active` → `chat_update` 绑定 `personaId:2`。
- `message_append` 发言回写 `speakerName="纯小白"`、`speakerAvatar="files/global/纯小白.jpg"`，身份生效。
- ⚠️ 注意：纯小白同时是群聊 6 的第 34 号**角色卡(NPC)**。用户以纯小白身份发言后，聊天里会出现「用户纯小白 + NPC纯小白」两个同名实体；若不希望纯小白作为 NPC 存在，把群聊 `characterIds` 里的 `34` 去掉即可（`tavo_chat_update`）。
