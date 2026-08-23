// toonflow_story_speaker - entry.js
// 角色发言插件（全面对齐 fixDB.prompts.ts 的 story_speaker）
//
// Tavo 群聊场景模式下，模型自己兼任「编排师 + 发言者」。本插件在 generation:prepare
// 把【在场角色当前动态状态】注入请求（来自 memory_manager 维护的 tmm_story 参数卡），
// 让模型写出贴合当前等级/血量/蓝量/当前行为的角色台词，而不是只凭静态人设。

'use strict';

// 注入等待效果 CSS（台词生成中蓝色，语音生成中黄色）:台词生成中蓝色 "。->."，语音生成中黄色"。->."
(function() {
  var style = document.createElement('style');
  style.textContent = `
    /* 蓝色等待动画 - 台词生成中 */
    .tf-waiting-dots-blue {
      color: #2196F3;
      font-size: 14px;
      animation: tf-blink-blue 1.5s ease-in-out infinite;
    }
    .tf-waiting-dots-blue::after {
      content: '';
      animation: tf-dots-blue 1.5s steps(4, end) infinite;
    }
    @keyframes tf-blink-blue {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes tf-dots-blue {
      0% { content: ''; }
      25% { content: '.'; }
      50% { content: '..'; }
      75% { content: '...'; }
      100% { content: ''; }
    }

    /* 黄色等待动画 - 语音生成和播放中 */
    .tf-waiting-dots-yellow {
      color: #FFC107;
      font-size: 14px;
      animation: tf-blink-yellow 1s ease-in-out infinite;
    }
    .tf-waiting-dots-yellow::after {
      content: '';
      animation: tf-dots-yellow 1s steps(4, end) infinite;
    }
    @keyframes tf-blink-yellow {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    @keyframes tf-dots-yellow {
      0% { content: ''; }
      25% { content: '.'; }
      50% { content: '..'; }
      75% { content: '...'; }
      100% { content: ''; }
    }

    /* 打字机光标 */
    .tf_steam_cursor {
      display: inline-block;
      color: #666;
      animation: tf-cursor-blink 0.8s step-end infinite;
    }
    @keyframes tf-cursor-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* 隐藏 Flutter 渲染的按钮（我们的插件自己处理业务） */
    .tav-action-bar-button-regenerate,
    .tav-action-bar-button-continue,
    .tav-action-bar-button-inspire,
    .tav-action-bar-button-tts {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
})();

const NS = 'tf_speaker';
const ORCH_FLAG = 'tf_orch.active';
let _orchBusy = false; // 编排锁：防止 auto_orchestrate 并发抢占

// 时间戳函数（用于日志）
function ts() {
  const d = new Date();
  return d.toISOString().slice(11, 23).replace('T', ' ');
}

const ROLE_LABEL = {
  player: '用户', npc: '一般角色', narrator: '旁白',
  system: '系统角色', general: '万能角色',
};

// Tavo 的 tavo.get(name) 返回包装对象 {target,name,found,value}，真实数据在 .value。
// 不解包会导致 edit.chapters / story.characters 全是 undefined（表现为「配置被清空、参数为空」）。
function readChatVar(name) {
  let v = null;
  try { v = tavo.get(name, 'chat'); } catch (e) { return null; }
  let guard = 0;
  while (v && typeof v === 'object' && !Array.isArray(v)
         && Object.prototype.hasOwnProperty.call(v, 'value')
         && Object.prototype.hasOwnProperty.call(v, 'name')
         && guard < 5) {
    if (v.found === false) return null;
    v = v.value;
    guard += 1;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s); } catch (e) { return v; }
    }
  }
  return v;
}

// 变量命名（对齐变量设计.原则）：
//   chat scope  → tf_story（不带 chat_id）
//   global scope → tf_story_{chat_id}（带 chat_id）
let _speakerChatId = null;
function storyNs(name) { return 'tf_story.' + name; }
function storyNsGlobal(name) {
  return _speakerChatId ? ('tf_story_' + _speakerChatId + '.' + name) : ('tf_story.' + name);
}
function progressVarName() { return 'tf_progress'; }
function progressVarNameGlobal() {
  return _speakerChatId ? ('tf_progress_' + _speakerChatId) : 'tf_progress';
}
// 双 scope 读取：先 global，再 chat
function readDualScope(chatName, globalName) {
  let v = readChatVar(chatName);
  if (v && typeof v === 'object') return v;
  try {
    let g = tavo.get(globalName, 'global');
    let guard = 0;
    while (g && typeof g === 'object' && g.found !== undefined && 'value' in g && guard < 5) { g = g.value; guard++; }
    if (g && typeof g === 'object') return g;
  } catch (e) {}
  return null;
}

function getConfig() {
  const get = (k, fallback) => {
    try {
      const v = tavo.plugin.config.get(k);
      return v !== undefined && v !== null ? v : fallback;
    } catch (e) {
      return fallback;
    }
  };
  return {
    enabled: get('enabled', true) !== false,
    temperature: parseFloat(get('temperature', 0.7)) || 0.7,
    maxTokens: parseInt(get('maxTokens', 220)) || 220,
  };
}

// 群聊编排设置（来自 event_manager 维护的 tf_story.edit.orchestration）
// 'system' = 跟随系统（不接管、不注入动态状态、不显示编排中）；缺省 / 'plugin' = 插件接管
function getOrchestration() {
  try {
    const edit = readDualScope(storyNs('edit'), storyNsGlobal('edit')) || {};
    const v = edit.orchestration;
    return v === 'system' ? 'system' : 'plugin';
  } catch (e) { return 'plugin'; }
}

// 台词数量：发给 agent 的「最近对话」条数（对齐 Toonflow recent_dialogue 入参），默认 20
function getLineCount() {
  try {
    const edit = readDualScope(storyNs('edit'), storyNsGlobal('edit')) || {};
    const v = parseInt(edit.lineCount, 10);
    return (v >= 1) ? v : 20;
  } catch (e) { return 20; }
}

// 从 memory_manager 的 tmm_story 读取在场角色动态状态；缺失时回退到 chat 角色
async function buildCastState() {
  let story = null;
  try { story = readChatVar('tmm_story') || readChatVar('tmm_story_static'); } catch (e) {}
  let characters = (story && Array.isArray(story.characters)) ? story.characters : null;

  if (!characters) {
    try {
      const chat = await tavo.chat.current();
      const chars = chat?.characters || [];
      characters = await Promise.all(chars.map(async (c) => {
        let full = null;
        try { if (tavo.character && tavo.character.get) full = await tavo.character.get(c.id); } catch (e) {}
        const d = (full && full.data) ? full.data : (full || c || {});
        return { name: c.name || d.name || '未命名', roleType: d.roleType || c.roleType || 'npc', card: {} };
      }));
    } catch (e) {}
  }
  if (!characters || !characters.length) return '';

  let block = '\n【在场角色当前状态】（对齐 story_speaker 动态参数卡，来自记忆）\n';
  for (const ch of characters) {
    const c = ch.card || {};
    if (ch.roleType === 'narrator') {
      block += '- 旁白（系统旁白）：负责场景描述 / 时间流转 / 效果说明，不扮演具体人物，无战斗数值\n';
      continue;
    }
    const label = ROLE_LABEL[ch.roleType] || ch.roleType || 'npc';
    const parts = [ch.name + '(' + label + ')'];
    if (c.level != null && c.level !== '') parts.push('Lv.' + c.level);
    if (c.level_desc) parts.push(c.level_desc);
    if (c.hp != null && c.hp !== '') parts.push('HP' + c.hp);
    if (c.mp != null && c.mp !== '') parts.push('MP' + c.mp);
    if (c.role_key_information) parts.push('当前:' + String(c.role_key_information).slice(0, 48));
    block += '- ' + parts.join(' | ') + '\n';
  }
  block += '（请严格按上面各角色的当前状态与身份发言，推进剧情一小步）\n';
  return block;
}

// 当前事件（对齐 story_speaker 的 [当前事件] currStageSummary）：
// 取当前进度所在章节的标题 + 本章内容大纲，作为本轮发言唯一依据。
async function getCurrentEventText() {
  try {
    const edit = readDualScope(storyNs('edit'), storyNsGlobal('edit')) || {};
    const chapters = edit.chapters || [];
    let prog = null;
    try { prog = readDualScope(progressVarName(), progressVarNameGlobal()); } catch (e) {}
    const idx = (prog && typeof prog.currentChapterIndex === 'number') ? prog.currentChapterIndex : 0;
    const ch = chapters[idx];
    if (!ch) return '';
    let s = '【当前章节】' + (ch.title || '未命名') + '\n';
    s += (ch.content || '').slice(0, 1500);
    return s;
  } catch (e) { return ''; }
}

// 最近对话（对齐 story_speaker 的 [最近对话] recent_dialogue）：取最后 n 条消息，格式化为「角色名：内容」。
async function buildRecentDialogue(n) {
  try {
    const count = await tavo.message.count();
    if (!count) return '';
    const start = Math.max(0, count - n);
    const msgs = await tavo.message.find([start, count - 1]);
    const lines = (msgs || []).map((m) => {
      const name = m.characterName || (m.role === 'user' ? '用户' : '旁白');
      return name + '：' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 200);
    });
    return lines.join('\n');
  } catch (e) { return ''; }
}

// 方案1：window 事件总线监听开场白委托（event_manager 在 playChapterOpening 里调用 tf_story_emit）
tavo.plugin.on('chat:opened', async function() {
  try { const c = await tavo.chat.current(); _speakerChatId = c && c.id; } catch (e) {}

  window.tf_story_on('opening', async function(data) {tf_speaker('opening',data);});

  window.tf_story_on('append_message', async function(data) {tf_speaker('append_message',data); });
  window.tf_story_on('append_message_steam', async function(data) {tf_speaker('append_message_steam',data); });
});
async function tf_speaker(type, data) {

  console.log('[window.tf_story_on] [tf_speaker] ', type);
  var cfg;
  try {
    cfg = getConfig();
  } catch (e) {
    return;
  }
  if (!cfg.enabled) return;
  if (getOrchestration() === 'system') return;

  // 编排锁：防止 auto_orchestrate 并发抢占（同一轮编排内多次 emit 事件）
  if (_orchBusy) {
    console.log('[tf_speaker][LOCK] 编排锁占用，跳过: ' + type);
    return;
  }

  if('opening' == type ){
      var role = (data && data.role) || '旁白';
    var text = (data && data.text) || '';
    if (!text) {
      console.log('[tf_speaker][opening] text 为空，跳过');
      return;
    }
    console.log('[tf_speaker][opening] 收到开场白委托 role=' + role + ' text=' + text.slice(0, 40));
    // 查找角色 id
    var charEntry = null;
    try {
      var chat = await tavo.chat.current();
      var chars = (chat && chat.characters) || [];

      if (chars != null) {
        chars.forEach(el => {
          console.log('[window.tf_story_on] [tf_speaker] chars ', el.name, el.id);
        });
      }

      var findChar = function (name) {
        return chars.find(function (c) {
              return c.name === name;
            })
            || (name === '旁白' || name === 'narrator' ? chars.find(function (c) {
              return c.name === '旁白';
            }) : null);
      };
      var narratorChar = chars.find(function (c) {
        return c.name === '旁白';
      }) || null;
      charEntry = findChar(role) || narratorChar;
    } catch (e) {
    }
    // 写入消息列表（Tavo App 监听 message:added 后自动触发语音播放）
    var speakerAppendOpts = {
      role: 'assistant',
      characterName: role,
      content: text,
      hidden: false,
    };
    if (charEntry && charEntry.id !== undefined) {
      speakerAppendOpts.characterId = charEntry.id;
      console.log('[tf_speaker][opening] speakerAppendOpts charEntry: ' + charEntry.name);
    }
    try {
      await tavo.message.append(speakerAppendOpts);
      console.log('[tf_speaker][opening] 已写入开场白: ' + speakerAppendOpts.characterId + ":" + role + ':' + text.slice(0, 40));
      auto_orchestrate(data);
    } catch (e) {
      console.warn('[tf_speaker][opening] 写入开场白失败', e);
    }
  }else if ('append_message_steam' == type ){
      await steam_speaker_writer(type, data);
  }
  else if (type === 'append_message'){
    try {
      await tavo.message.append(data);
      auto_orchestrate(data)
    } catch (e) {
      console.warn('[tf_speaker][append_message] 写入台词白失败', e);
    }
  }


}

async function auto_orchestrate(data) {
    try {
    console.log('[' + ts() + '] ⏸ [speaker] 准备生成语音');
    // await_user 处理
    if (data && data.awaitUser === true) {
      console.log('[' + ts() + '] ⏸ [speaker] await_user=true → 停止生成，等待用户输入');
      try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {}
      return;
    }
    // 触发下一轮编排
    console.log('[tf_speaker][orchestrate][steam] → 继续编排，auto_orchestrate');
    if (window.tf_story_emit) window.tf_story_emit('auto_orchestrate', {});
  } catch (e) {
    console.warn('[tf_speaker] auto_orchestrate失败', e);
  }
}

async function steam_speaker_writer(type, data){
      // 流式输出台词：speaker 自己调用 LLM 生成台词（不依赖 mcs 二次生成）
    console.log("[tf_speaker][steam] 收到流式台词委托 speaker=" + (data&&data.speaker) + " motive=" + (data&&data.motive));
    // 编排锁：防止多轮 auto_orchestrate 并发抢占
    if (_orchBusy) {
      console.log("[tf_speaker][steam] 编排锁占用，跳过");
      return;
    }
    _orchBusy = true;
    try {
      // 1. 查找角色
      var steamRole = (data && data.speaker) || '旁白';
      var steamMotive = (data && data.motive) || '';
      var steamEventSummary = (data && data.eventSummary) || '';
      var steamRoleType = (data && data.roleType) || 'narrator';
      var steamEvDigest = data && data.evDigest;
      var steamNextEvInfo = data && data.nextEvInfo;
      var steamAwaitUser = data && data.awaitUser;
      var steamThinking = data && data.thinking;

      var steamCharEntry = null;
      var steamChat = await tavo.chat.current();
      var steamChars = (steamChat && steamChat.characters) || [];
      var steamFindChar = function(name) {
        return steamChars.find(function(c){ return c.name === name; })
          || (name === '旁白' || name === 'narrator' ? steamChars.find(function(c){ return c.name === '旁白'; }) : null);
      };
      steamCharEntry = steamFindChar(steamRole) || steamChars.find(function(c){ return c.name === '旁白'; }) || null;

      // 2. 生成唯一 div id
      var msg_div_id = 'tf_steam_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var msg_div_waiting_id = 'tf_steam_waiting' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      // 3. 先 append 占位（蓝色 "..." 等待效果，表示台词生成中）
      var steamAppendOpts = {
        role: 'assistant',
        characterId: steamCharEntry ? steamCharEntry.id : undefined,
        characterName: steamRole,
        content: '<div id="'+msg_div_id+'" class="tf-waiting">台词生成中</div><span  id="'+msg_div_id+'" class="tf-waiting-dots-blue">...</span>',
        hidden: false,
      };
      var steamMsg = null;
      var steamTargetDiv = null;
      var steamTargetWaitingDiv = null;
      try {
        steamMsg = await tavo.message.append(steamAppendOpts);
        // 等待500毫秒
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log("[tf_speaker][steam] 已 append 占位 msgId=" + (steamMsg && steamMsg.id) + " divId=" + msg_div_id);
        // 保存 div 引用（不依赖 getElementById，Tavo markdown 渲染器可能移除 id 属性）
        steamTargetDiv = document.getElementById(msg_div_id);
        steamTargetWaitingDiv = document.getElementById(msg_div_waiting_id);
        msg_div_waiting_id
        if (!steamTargetDiv) {
           // 没有就直接报错
           console.error("[tf_speaker][steam] steamTargetDiv not found, msg_div_id:", msg_div_id);
           return;
        }else {
          console.log("[tf_speaker][steam] steamTargetDiv:", steamTargetDiv.innerHTML);
          return;
        }
        console.log("[tf_speaker][steam] steamTargetDiv=" + (steamTargetDiv ? 'found' : 'null'));
      } catch(e) {
        console.warn("[tf_speaker][steam] append 占位失败", e);
        throw e;
      }

      // 4. speaker 自己生成台词（对齐 Toonflow story_speaker）
      var speakerPrompt = await buildSpeakerPrompt(steamRole, steamRoleType, steamMotive, steamEventSummary, steamEvDigest, steamNextEvInfo);
      console.log("[tf_speaker][steam] speaker prompt len=" + speakerPrompt.length);
      var llmPath = (window.tf_llm && window.tf_llm.callDirect) ? '接管' : 'tavo原生';
      var speechText = '';
      try {
        speechText = llmPath === '接管'
          ? await window.tf_llm.callDirect(speakerPrompt, { maxCompletionTokens: 1500 })
          : await tavo.generate(speakerPrompt, { context: false, settings: { maxCompletionTokens: 1500 } });
      } catch(e) {
        console.error("[tf_speaker][steam] LLM 调用失败", e);
        throw e;
      }
      // 5. 清理 LLM 输出
      speechText = (speechText || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').replace(/^["']|["']$/g, '').trim();

      // 6. 切换到黄色 "..." 等待效果，表示语音生成和播放中
      if (steamTargetDiv) {
        steamTargetDiv.innerHTML = '<span class="tf-waiting-dots-yellow">语音生成和播放中...</span>';
      }

      // 7. 流式输出：直接操作 DOM，每 50ms 填充一个字符
      var steamCharIdx = 0;
      var chunkSize = 2; // 每次填充字符数（打字机效果）
      var steamInterval = setInterval(function() {
        if (steamCharIdx >= speechText.length) {
          clearInterval(steamInterval);
          // 流式完成：移除等待效果，替换为光标
          if (steamTargetDiv) {
            steamTargetDiv.innerHTML = '<span class="tf_steam_cursor">|</span>';
          }
          // 完成后添加 thinking 折叠块
          try {
            if (steamThinking) {
              var esc = steamThinking.replace(/<\/div>/gi, '&lt;/div&gt;');
              var block = '<div style="cursor:pointer;color:#888;font-size:0.85em" onclick="var d=this.getElementsByTagName(\'div\')[0];d.style.display=d.style.display==\'none\'?\'block\':\'none\'">💭 思考（点击展开）<div style="display:none;padding:8px 0;color:#666">' + esc + '</div></div>';
              if (steamTargetDiv) steamTargetDiv.insertAdjacentHTML('beforebegin', block);
            }
          } catch(e) {}
          console.log("[tf_speaker][steam] 流式输出完成 len=" + speechText.length);
          // 8. 流式完成后 - 调用 voice 插件生成 + 播放语音
          console.log('[tf_speaker][steam] 检查 voice 插件: charEntry=' + (steamCharEntry ? steamCharEntry.id : 'null') + ' tf_voice=' + (window.tf_voice ? 'exists' : 'MISSING') + ' playFor=' + (window.tf_voice && typeof window.tf_voice.playFor));
          if (steamCharEntry && steamCharEntry.id && speechText && window.tf_voice) {
            try {
              var vcfg = window.tf_voice.getConfig ? window.tf_voice.getConfig() : null;
              console.log('[tf_speaker][steam] voice config:', JSON.stringify(vcfg));
              if (vcfg && vcfg.auto_play !== false) {
                if (typeof window.tf_voice.playFor === 'function') {
                  console.log('[tf_speaker][steam] 调用 tf_voice.playFor(' + steamCharEntry.id + ', ...)');
                  window.tf_voice.playFor(steamCharEntry.id, speechText);
                } else if (typeof window.tf_voice.speak === 'function') {
                  console.log('[tf_speaker][steam] 调用 tf_voice.speak(' + steamCharEntry.id + ', ...)');
                  window.tf_voice.speak(steamCharEntry.id, speechText);
                } else {
                  console.warn('[tf_speaker][steam] voice.playFor 不可用');
                }
              } else {
                console.log('[tf_speaker][steam] auto_play=false，跳过语音');
              }
            } catch(e) { console.warn('[tf_speaker][steam] TTS 触发失败', e); }
          } else {
            console.warn('[tf_speaker][steam] voice 跳过: charEntry=' + (steamCharEntry ? steamCharEntry.id : 'null') + ' text=' + (speechText ? speechText.length : 0));
          }
          if (steamTargetWaitingDiv) {
            steamTargetWaitingDiv.style.display = 'none';
          }
          // 8. await_user 处理
          if (steamAwaitUser === true) {
            console.log('[tf_speaker][steam] awaitUser=true → 停止编排，等待用户');
            try { tavo.set(ORCH_FLAG, false, 'chat'); } catch(e) {}
            return;
          }

          // 9. 触发下一轮 NPC 编排
          if (window.tf_story_emit) window.tf_story_emit('auto_orchestrate', {});
          auto_orchestrate(data)
          return;
        }
        // 直接填充到 div
        var renderedText = speechText.slice(0, steamCharIdx + chunkSize);
        steamCharIdx += chunkSize;
        if (steamTargetDiv) {
          steamTargetDiv.innerHTML = renderedText + '<span class="tf_steam_cursor">|</span>';
        }
      }, 50);

      // 注意：流式进行中不要在这里写 TTS/编排逻辑，等 setInterval 内部完成
    } catch(e) {
      console.error("[tf_speaker][steam] 流式输出异常", e);
    } finally {
      // 释放编排锁，让下一轮编排可以进入
      _orchBusy = false;
    }
}


// 生成前：注入对齐 Toonflow story_speaker 的「入参」（当前事件 / 最近对话 / 在场角色当前状态）+ 编排标记
tavo.plugin.on('generation:prepare', async (event) => {
  // 编排锁：防止上一轮 append_message_steam 的 LLM 流被新一轮 generation:prepare 抢占
  if (_orchBusy) {
    console.log('[speaker][gen:prepare] 编排锁占用，跳过生成');
    try { event.text = ''; } catch (e) {}
    return;
  }
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (getOrchestration() === 'system') return; // 跟随系统：不注入动态状态、不显示编排中
  try { tavo.set(ORCH_FLAG, true, 'chat'); } catch (e) {}
  try {
    const n = getLineCount();
    const [evt, dlg, cast] = await Promise.all([
      getCurrentEventText(),
      buildRecentDialogue(n),
      buildCastState(),
    ]);
    let block = '【角色发言器入参】（对齐 Toonflow story_speaker，本轮需基于以下信息决定发言角色并生成其台词）\n';
    block += '## 当前事件\n' + (evt || '（无）') + '\n';
    block += '## 最近对话（最近 ' + n + ' 条）\n' + (dlg || '（无）') + '\n';
    block += '## 在场角色当前状态\n' + (cast || '（无）') + '\n';
    event.text = block + '\n---\n' + (event.text || '');
  } catch (e) {
    console.warn('[tf_speaker] prepare failed', e);
  }
});

tavo.plugin.on('generation:success', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });
tavo.plugin.on('generation:error', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });
tavo.plugin.on('generation:cancelled', async () => { try { tavo.set(ORCH_FLAG, false, 'chat'); } catch (e) {} });

// 侧边栏：测试生成一句当前角色台词（隐藏消息）
tavo.plugin.onSidebarAction('speaker-test', async () => {
  const cfg = getConfig();
  if (!cfg.enabled) { tavo.utils.toast('发言插件未启用'); return; }
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) { tavo.utils.toast('当前聊天无角色'); return; }
    const char = await tavo.character.get(chat.characters[0].id);
    const state = await buildCastState();

    // 自由模式：放宽台词长度（用户可自由讨论/提问/闲聊）
    const freeMode = (() => { try { return !!(readDualScope(progressVarName(), progressVarNameGlobal()) || {}).sessionFreeMode; } catch (e) { return false; } })();
    const lengthHint = freeMode ? '40~150字，2~4句（自由模式可稍长）' : '40~80字，最多2句';

    const prompt = (state ? state + '\n' : '') +
      `请以 ${char?.name || '角色'} 的身份，基于当前状态生成一句自然台词（${lengthHint}）。` +
      (freeMode ? '\n（当前是自由模式，可根据用户提问自由回应，不必推进剧情。）' : '');
    const speech = await tavo.generate(prompt, {
      context: false,
      settings: { temperature: cfg.temperature, maxCompletionTokens: cfg.maxTokens },
    });
    await tavo.message.append({ content: speech, hidden: true, characterId: char?.id });
    tavo.utils.toast('已生成测试台词（隐藏）');
  } catch (e) {
    tavo.utils.toast('生成失败：' + (e && e.message ? e.message : e));
  }
});

// 侧边栏：列出当前角色（隐藏消息）
tavo.plugin.onSidebarAction('speaker-char', async () => {
  try {
    const chat = await tavo.chat.current();
    if (!chat || !chat.characters?.length) { tavo.utils.toast('当前聊天无角色'); return; }
    let msg = '【当前角色列表】\n';
    for (const c of chat.characters) {
      const char = await tavo.character.get(c.id);
      msg += `- ${char?.name || c.name}（${char?.personality ? char.personality.slice(0, 30) : '无设定'}）\n`;
    }
    await tavo.message.append({ content: msg, hidden: true, characterId: chat.characters[0].id });
  } catch (e) {
    console.warn('[tf_speaker] list failed', e);
  }
});

console.log('[toonflow_story_speaker] plugin entry loaded');