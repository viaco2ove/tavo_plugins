# no_modify
```bash
python -m tavo_plugins sync --story-json "story.json" --force --skip-plugins
```
# 用户身份测试
单独先测试给给用户身份:纯小白，上传头像后设置头像路径，然后上传立绘图像，用全局变量绑定立绘信息。
上传音色文件并绑定到用户身份:纯小白

# 故事信息绑定测试
故事信息绑定：
"chat_name": "谁让这个山大王修仙的！"
群聊绑定->故事数据.简介:intro, 故事数据.全局背景：global_bg,故事数据.card_scenario，故事数据.card_tags
## 绑定了怎么用：
// Tavo 的 chat 变量经 tavo.get 返回的是包装对象 {target,name,found,value}，
// 真实数据在 .value 里。所有读变量都必须解包，否则 v.chapters / v.level 等会是 undefined，
// 代码会误判为"空"并覆盖，造成配置/参数卡被清空。
function readChatVar(name) {
  try {
    let v = tavo.get(name);
    let guard = 0;
    while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) {
      v = v.value; guard++;
    }
    return v;
  } catch (e) { return null; }
}

const edit = readChatVar('tf_story.edit') || {};
let bg = String(edit.globalBackground || '').trim();

也就是故事变量的
tf_story.edit.globalBackground 和 tf_story.edit.intro

mcp 操作：
``` PYTHON
edit = {
    'chapters': chapters,
    'currentChapterIndex': 0,
    'intro': config.get('intro', ''),
    'globalBackground': config.get('global_bg', ''),
    'cardScenario': config.get('card_scenario', ''),
    'cardTags': config.get('card_tags', []),
}
# MCP JSON-RPC
rpc(http_url, token, 'tavo_variable_set', {
    'scope': 'chat', 'chatId': chat_id, 'name': 'tf_story.edit', 'value': edit
})
```
但真正的真元数据global scope ：


# 故事章节数据绑定测试
"chat_name": "谁让这个山大王修仙的！"
章节数据绑定到故事：开场白，开场白发言人， 章节背景图片，章节内容，章节结束条件