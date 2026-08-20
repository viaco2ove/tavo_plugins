# tava 官方事件
- onInputAction - 输入框操作事件
 manifest.json 里的 contributes.inputActions：
  "inputActions": [
    { "id": "guide", "label": "生成草稿" }
  ]

// 推荐：在所有插件入口中都使用未限定的 tavo。
tavo.plugin.onInputAction('guide', async () => {
  const input = await tavo.input.get();
  await tavo.input.set(`Draft:\n${input}`);
});

作用：增加个输入框的快捷菜单和响应

- onSidebarAction:
tavo.plugin.onSidebarAction('append-note', async () => {
  await tavo.input.append('\n\n来自侧栏插件的备注');
});
作用：增加侧边栏菜单和响应


-  Hooks 
event.cancel(); 可以拦截掉流程，等于可以阻止聊天与生成流程。
  - Chat 与 Message 通知
  这些 Hooks 用来感知聊天和消息变化，不能修改或阻止聊天与生成流程。
  chat:opened	当前聊天打开时。
  chat:closed	离开当前聊天或切换到其它聊天时。
  chat:updated	当前 chat 的元数据更新，例如标题、角色、persona、preset、lorebooks、memory 或背景变化。
  chat:changed	chat:updated 的兼容别名；handler 收到的 event.type 仍为 chat:updated。
  message:added	一条消息添加并保存到当前 chat 后；流式生成过程中不会重复触发。
  message:updated	当前 chat 中已保存消息的内容或元数据发生变化时。
  message:deleted	一条消息从当前 chat 中删除时。
  message:changed	在 message:added、message:updated 或 message:deleted 之后触发的 umbrella 事件。

    使用：
    tavo.plugin.on('chat:opened', async (event) => {
      console.log('打开聊天', event.chat?.name || event.chatId);
    });
    里面使用
    event.cancel(); 可以拦截掉流程，等于可以阻止聊天与生成流程。

  - 生成生命周期 Hooks
      每个事件都有只读的 generationId、chatId、source、at、type 和 pluginId。目前会响应 reply、groupReply、continuation、othersContinuation 和 regeneration；不会响应图片、语音、总结、独立生成或纯 TavoJS/JSAPI 发起的生成。
    
      generation:prepare 在模型请求开始前运行。event.text 是本次请求发送给模型的最后一条用户消息；修改只影响本次模型请求，不会修改聊天中已保存的消息，并且可以设为空。
      generation:success 在生成和 extension 处理完成后、角色消息保存前运行；可改写的最终正文必须 非空，空改写会被丢弃。
      generation:error 在生成失败时通知插件，event.error 提供 code 和 message。
      generation:cancelled 是含布尔 partial 的非阻塞终止通知。partial: true 仍会保存半截响应， 随后触发现有的 message:added；partial: false 不会保存消息。
      generation:prepare 与 generation:success 的 handler 按注册顺序运行，每个最多等待 5 秒。handler 报错、超时或写入无效文本时，Tavo 会忽略该 handler 的修改并继续生成；这两个 Hooks 不能取消生成。每次生成只会触发 generation:success、generation:error 或 generation:cancelled 中的一个。
  - 输入发送 Hooks
      - input:beforeSend 拦截发送按钮 / 回车、tavo.input.send() 和 MCP tavo_input_send；
      - input:afterSend 在 Tavo 接受输入后通知插件。manifest 应声明 "permissions": ["input"]。
