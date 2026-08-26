// toonflow_story_event_manager - entry.js

// ============================================================
// 自建事件总线（tavo.plugin.emit 不存在，用 window 模拟）
// window.tf_story_on(event, handler)  监听
// window.tf_story_emit(event, data)   触发
// ============================================================
let isNeedJump=true;
let cmAtJump ='#jump';
(function() {
  console.log('[event_manager][_handlers] add start 1');
  var _handlers = {};

  console.log('[event_manager][_handlers] add  window.tf_story_on');
  window.tf_story_on = function(event, handler) {
    console.log('[event_manager][_handlers]  window.tf_story_on');
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(handler);
  };
  console.log('[event_manager][_handlers] add   window.tf_story_emit');
  window.tf_story_emit = function(event, data) {
    console.log('[event_manager][tf_story_game][event] emit ' + event, data);
    var list = _handlers[event] || [];
    list.forEach(function(fn) {
      try { fn(data); } catch(e) { console.warn('[event_manager][tf_story_game][event] handler error', e); }
    });
  };
})();
if (typeof window !== 'undefined') {
  console.log(window.tf_story_on);
}

// 故事信息面板 + 事件管理 + 故事编辑器 + 编排联动
// + 章节结局判定器 + 事件进度追踪 + 自由模式（完全对齐 Toonflow-game）
//
// 职责：
// 1. 故事面板/编辑器 UI 的数据桥
// 2. 编排联动：把群聊切到 scenario 模式交给编排插件；未装则回退 natural
// 3. 章节结局判定器：每轮 message:added 后评估完成条件
// 4. 事件进度追踪：从章节内容解析 Phase/Event 结构，状态机推进
// 5. 自由模式：所有章节完成后进入，不再做结局判定
// 6. 章节独立管理（chat 变量 tf_story.edit.chapters）

'use strict';

// 诊断：确认 entry.js 真的被 Tavo 加载并执行（之前发现 message:added 监听没跑，怀疑 entry 加载时就静默失败）
try {
  console.log('[event_manager][tf_story_game] ENTRY START v1.4.0 ' + new Date().toISOString()
    + ' tavo=' + (typeof tavo)
    + ' tavo.plugin=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin : 'undefined')
    + ' tavo.plugin.on=' + ((typeof tavo !== 'undefined' && tavo.plugin) ? typeof tavo.plugin.on : 'undefined'));
} catch (e) {
  console.error('[event_manager][tf_story_game] entry log failed', e);
}

// =========================================================================
// 供其他插件调用的 API（暴露到 window）
// =========================================================================
// 完整章节+事件判定入口（mcs 编排前调用，同步返回章节状态 + 更新事件进度）
// 对齐 judgeAndAdvance 逻辑，但不 append 消息（mcs 自己 append）
// 返回：{ chapterStatus, pendingChapterId, storyCompleted, freeMode, progress }
function tfStoryJudge_checkAndAdvance(messageContext) {
  try {
    const cfg = cfgGet('enabled', true);
    if (cfg === false) return { chapterStatus: 'continue' };

    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return {
        chapterStatus: progress.storyCompleted ? 'completed' : 'free_mode',
        pendingChapterId: progress.pendingChapterId || null,
        storyCompleted: progress.storyCompleted,
        freeMode: progress.sessionFreeMode,
        progress: { currentChapterIndex: progress.currentChapterIndex, currentPhase: progress.currentPhase, currentEvent: progress.currentEvent, phases: progress.phases },
      };
    }

    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) return { chapterStatus: 'continue' };

    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { chapterStatus: 'completed' };

    // 读 chapter.runtimeOutline（sync 预解析），fallback parseProgress
    // 关键修复（bug A 兜底）：重建 outline 时不要无脑重置指针到 [0][0]。
    // 只有「指针在 outline 里找不到」时才 fallback 到首个 phase/首个 stage。
    let prog = Object.assign({}, progress);
    if (!prog.runtimeOutline || prog.chaptersKey !== chapters.length + ':' + idx) {
      prog.runtimeOutline = (chapter && chapter.runtimeOutline && Array.isArray(chapter.runtimeOutline.phases) && chapter.runtimeOutline.phases.length)
        ? chapter.runtimeOutline
        : parseProgress(chapter.content || '');
      // 指针：优先保留 prog 已有指针（如果在新 outline 里找得到）
      const phases = prog.runtimeOutline.phases || [];
      let keepPhase = null, keepStage = null;
      if (prog.currentPhaseId) {
        keepPhase = phases.find(p => p.id === prog.currentPhaseId) || null;
      }
      if (keepPhase && prog.currentStageId) {
        keepStage = (keepPhase.stages || []).find(s => s.id === prog.currentStageId) || null;
      }
      if (!keepPhase) {
        keepPhase = phases[0] || null;
        if (keepPhase) {
          prog.currentPhaseId = keepPhase.id;
          // 检查是否已完成：completed 的 phase 不能回退，跳到下一个未完成
          while (keepPhase && isPhaseCompleted(prog, keepPhase.id)) {
            const nextIdx = phases.indexOf(keepPhase) + 1;
            keepPhase = phases[nextIdx] || null;
          }
          if (keepPhase) {
            prog.currentPhaseId = keepPhase.id;
            keepStage = (keepPhase.stages || []).find(s => !isStageCompleted(prog, keepPhase.id, s.id)) || (keepPhase.stages || [])[0] || null;
          }
        }
      }
      if (keepPhase && !keepStage) {
        keepStage = (keepPhase.stages || []).find(s => !isStageCompleted(prog, keepPhase.id, s.id)) || (keepPhase.stages || [])[0] || null;
      }
      if (keepPhase) {
        prog.currentPhaseId = keepPhase.id;
        prog.currentStageId = keepStage ? keepStage.id : null;
      } else {
        // outline 为空：清空指针
        prog.currentPhaseId = null;
        prog.currentStageId = null;
      }
      prog.chaptersKey = chapters.length + ':' + idx;
    }

    // 快速同步到 tf_progress（供编排 prompt 读取最新进度）
    setProgress(prog);

    // pendingChapterId 检测（章节切换中）
    if (prog.pendingChapterId) {
      const nextIdx = prog.pendingChapterId;
      return {
        chapterStatus: 'chapter_switching',
        pendingChapterId: nextIdx,
        storyCompleted: nextIdx >= chapters.length,
        freeMode: nextIdx >= chapters.length && cfgGet('autoFreeMode', true) !== false,
        progress: { currentChapterIndex: nextIdx, currentPhase: 0, currentEvent: 0, phases: prog.phases },
        message: '章节切换中，将在下一轮生效',
      };
    }

    // 章节结局条件快速检查（无条件 = 不判）
    const cond = chapter.successCondition;
    const hasCondition = cond && String(cond).trim();

    // 返回当前状态供编排使用
    return {
      chapterStatus: 'active',
      pendingChapterId: null,
      storyCompleted: false,
      freeMode: false,
      progress: { currentChapterIndex: prog.currentChapterIndex, currentPhase: prog.currentPhase, currentEvent: prog.currentEvent, phases: prog.phases },
      chapterInfo: {
        title: chapter.title || '未命名章节',
        condition: hasCondition ? cond.slice(0, 100000) : null,
      },
    };
  } catch (e) {
    console.warn('[event_manager][tf_story_game][mcs_api] checkAndAdvance error', e);
    return { chapterStatus: 'error', error: e.message };
  }
}

// LLM 为主章节判定：异步调用 LLM 评估条件
async function tfStoryJudge_checkChapterDoneLLM(messageContext) {
  try {
    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return { done: progress.storyCompleted, result: 'completed', reason: 'free_mode' };
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { done: true, result: 'completed', reason: 'no_chapter' };
    const cond = chapter.successCondition;
    if (!cond) return { done: false, result: 'continue', reason: 'no_condition' };
    const recent = (await getAllMessagesText()) || '';
    const prompt = '判断当前章节是否完成。章节：'
        + (chapter.title||'') + '完成条件：'
        + cond + '最近对话：' + recent.slice(-150000)
        + '返回 JSON: {"result":"continue"或"done","reason":"一句话"}';
    let raw;
    try {
      raw = (window.tf_llm && window.tf_llm.callDirect)
        ? await window.tf_llm.callDirect(prompt, { maxCompletionTokens: 400 })
        : await tavo.generate(prompt, { context: false, settings: { temperature: 0.3, maxCompletionTokens: 400 } });
    } catch(e) { return { done: false, result: 'continue', reason: 'llm_error:' + e.message }; }
    const fence = (raw||'').match(/```json\s*([\s\S]*?)```/);
    const obj = fence ? JSON.parse(fence[1].trim()) : null;
    if (obj && obj.result === 'done') {
      return { done: true, result: 'success', reason: obj.reason || 'llm_judge' };
    }
    return { done: false, result: 'continue', reason: (obj && obj.reason) || 'llm_continue' };
  } catch (e) {
    return { done: false, result: 'continue', reason: 'exception:' + e.message };
  }
}


// 检查章节完成条件是否满足（编排后调用，决定是否需要截断/提示）
// 走 LLM 判定：对齐 toonflow_game/agents/agent_story_chapter.md
// 返回 { done, result, pendingChapterId, message }
async function tfStoryJudge_checkChapterDone(messageContext) {
  try {
    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return { done: progress.storyCompleted, result: progress.storyCompleted ? 'completed' : 'free_mode', pendingChapterId: null, message: '' };
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { done: true, result: 'completed', pendingChapterId: null, message: '' };
    const cond = chapter.successCondition;
    if (!cond || !String(cond).trim()) return { done: false, result: 'continue', pendingChapterId: null, message: '' };

    // 先走启发式规则（"对话 N 次" / 关键词）；不命中再调 LLM
    const ctx = {
      latestMessage: messageContext.content || '',
      allMessages: messageContext.allMessages || '',
      chapterTitle: chapter.title || '',
      chapterContent: chapter.content || '',
      messageCount: messageContext.messageCount || 0,
      memoryItems: [],
    };
    const ruleMatched = evalFreeText(cond, ctx);

    let llmResult = null;
    if (!ruleMatched) {
      llmResult = await _llmJudgeChapter(chapter, cond, ctx);
    }

    console.log('[event_manager][tf_story_game][mcs_api] checkChapterDone start')
    let finalResult = 'continue';
    let reason = '';
    if (ruleMatched) {
      finalResult = 'done'; reason = 'rule_matched';
    } else if (llmResult) {
      finalResult = llmResult.result || 'continue';
      reason = llmResult.reason || 'llm';
    }
    //result: string - 只能是 "continue" /"guide"/ "success" / "failed"
    console.log('[event_manager][tf_story_game][mcs_api] checkChapterDone result', finalResult, reason, llmResult)
    if (finalResult !== 'done' && finalResult !== 'success') {
      return { done: false, result: 'continue', pendingChapterId: null, message: '', llmResult, reason };
    }


    // 章节完成！
    const nextIdx = idx + 1;
    if (!progress.completedChapters.includes(idx)) {
      progress.completedChapters = [...(progress.completedChapters||[]), idx];
    }
    if (nextIdx >= chapters.length) {
      progress.storyCompleted = true;
      progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.completedPhases = [];
      progress.completedEvents = [];
      progress.updatedAt = Date.now();
      setProgress(progress);
      return { done: true, result: 'completed', pendingChapterId: null, message: '故事已完结！' + (progress.sessionFreeMode ? ' 进入自由模式' : ''), llmResult, reason };
    } else {
      progress.pendingChapterId = nextIdx;
      progress.updatedAt = Date.now();
      setProgress(progress);
      const nextCh = chapters[nextIdx];
      return { done: true, result: 'success', pendingChapterId: nextIdx, message: '第 ' + (idx+1) + ' 章完成！下一章将在下一轮切换', llmResult, reason };
    }
  } catch (e) {
    console.warn('[event_manager][tf_story_game][mcs_api] checkChapterDone error', e);
    return { done: false, result: 'error', error: e.message };
  }
}

// LLM 章节判定（对齐 fixDB.prompts.ts: _PROMPT_STORY_CHAPTER）
const _PROMPT_STORY_CHAPTER = `你是章节判定器。你只判断当前章节是否成功、失败或继续，以及是否进入下一章。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"。
## 任务
根据用户提供的章节信息、当前事件状态和运行态数据，判断章节是否应该结束。

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。

## 特别注意
用户指的是台词（recent_dialogue）里用户： recent_dialogue 数据里的 "role": "用户"
用户输入："2", 不是代表输入了两次！！！
## 入参说明
current_event：当前事件
next_event：该章节的下一事件，用于判断是否需要引导。一般来说没有下一事件，才需要result="guide"
## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块，不要 markdown 格式。

字段固定为：
- result: string - 只能是 "continue" /"guide"/ "success" / "failed"
- matched_rule: string | null - 命中的规则标识，未命中时为 null
- reason: string - 判定原因说明
- next_chapter_id: number | null - 下一章 ID，无则为 null
- guide_summary: string - 当 result="guide" 时的引导摘要，说明如何满足结束条件
- guide_facts: string[] - 当 result="guide" 时的引导事实列表（1-3条）

## 输出规则
- 当 result="continue" 时，无须给出 guide_summary和 guide_facts.代表的是继续该章节的事件推进
- 当 result="guide" 时，必须给出 guide_summary 和 1~3 条 guide_facts，说明下一步如何满足结束条件
- 当 result="success" 或 "failed" 时，guide_summary 置空串，guide_facts 置空数组

## 输出示例

result=guide:
{"result":"guide","matched_rule":null,"reason":"用户尚未输入名称、性别、年龄，未满足结束条件","next_chapter_id":null,"guide_summary":"需要引导用户输入角色名称、性别和年龄","guide_facts":["用户尚未提供角色基本信息","需要询问用户角色名称","需要询问用户角色性别和年龄"]}
result=continue:
{
  "result": "continue",
  "matched_rule": null,
  "reason": "当前站队场景需要用户回应西游孙悟空的提问，用户尚未完成回应，事件未完成，未达到章节完成条件",
  "next_chapter_id": null,
  "guide_summary": "暂无",
  "guide_facts": [
    "暂无"
  ]
}
`;

async function _llmJudgeChapter(chapter, cond, ctx) {
  // Fetch recent messages directly (ctx.allMessages is often empty from callers)
  let recentDialogue = String(ctx.allMessages || ctx.latestMessage || '').slice(-150000);
  if (!recentDialogue || recentDialogue.length < 10) {
    try {
      const _jc = await tavo.message.count();
      const _js = Math.max(0, (_jc || 0) - 10);
      const _jm = await tavo.message.find([_js, Math.max(0, (_jc || 1) - 1)]);
      if (Array.isArray(_jm) && _jm.length) {
        // Build charIdMap for chapter judge
        let _charMap = {};
        try {
          const _chat = await tavo.chat.current();
          for (const c of ((_chat && _chat.characters) || [])) {
            if (c && c.id !== undefined && c.name) _charMap[c.id] = c.name;
          }
        } catch (_e) {}
        recentDialogue = _jm.map(m => {
          let name = '旁白';
          if (m.role === 'user') name = '用户';
          else if (m.role === 'assistant' && m.characterId !== undefined && _charMap[m.characterId]) name = _charMap[m.characterId];
          return name + '：' + String(m.content || '').replace(/<[^>]+>/g, '').slice(0, 400);
        }).join('\n');
      }
    } catch(_) {}
  }
  const snapshot = {
    chapter: { id: chapter.id || idx, title: chapter.title || '' ,content: chapter?.content || '',},
    successCondition: cond,
    chapterContent: (chapter.content || '').slice(0, 222000),
    message_content: ctx.latestMessage || '',
    messageCount: ctx.messageCount || 0,
    recentDialogue,
    current_event: ctx.current_event || null,
    next_event: ctx.next_event || null,
  };
  const userPrompt = JSON.stringify(snapshot, null, 2);
  let raw = null;
  try {
    if (window.tf_llm && window.tf_llm.callDirect) {
      raw = await window.tf_llm.callDirect(
        [{ role: 'system', content: _PROMPT_STORY_CHAPTER }, { role: 'user', content: userPrompt }],
        { maxCompletionTokens: 800, temperature: 0.3, usageType: '章节判定' }
      );
    } else {
      raw = await tavo.generate(_PROMPT_STORY_CHAPTER + '\n\n' + userPrompt, { context: false, settings: { temperature: 0.3, maxCompletionTokens: 800 } });
    }
  } catch (e) {
    console.warn('[event_manager][tf_story_game][judge_llm] 调用失败:', e.message);
    return { result: 'continue', reason: 'llm_error:' + e.message };
  }
  console.warn('[event_manager][tf_story_game][judge_llm] raw:',raw);
  return _parseJudgeResponse(raw);
}

// 解析 LLM JSON 输出（支持 ```json``` 围栏）
function _parseJudgeResponse(raw) {
  if (!raw) return { result: 'continue', reason: 'empty' };
  let txt = String(raw).trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  let obj = null;
  try { obj = JSON.parse(txt); } catch (e) {
    // 兼容：找第一个 { ... } 块
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!obj) return { result: 'continue', reason: 'parse_fail' };
  const result = String(obj.result || obj.outcome || 'continue').toLowerCase();
  return {
    result: result === 'done' ? 'success' : (['continue', 'success', 'failed', 'guide'].includes(result) ? result : 'continue'),
    matchedRule: obj.matched_rule || obj.matchedRule || null,
    reason: obj.reason || '',
    nextChapterId: obj.next_chapter_id != null ? obj.next_chapter_id : (obj.nextChapterId != null ? obj.nextChapterId : null),
    guideSummary: obj.guide_summary || obj.guideSummary || '',
    guideFacts: Array.isArray(obj.guide_facts) ? obj.guide_facts : (Array.isArray(obj.guideFacts) ? obj.guideFacts : []),
  };
}

// LLM 事件进度判定（对齐 fixDB.prompts.ts: _PROMPT_STORY_EVENT_PROGRESS）
const _PROMPT_STORY_EVENT_PROGRESS = `你是事件进度检测器。你只判断"当前事件是否结束、现在进行到哪一步"，不判断章节是否成功或失败。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"
## 任务
根据当前事件、当前进度和最近 10 条台词，判断：
- 当前事件是否已经结束
- 当前事件当前应处于什么状态
- 当前事件应该如何总结当前进度
- 如果事件是需要某个角色说个台词，那么他说了给类似的台词这个事件就是结束
- 你倾向于宽松地认为事件已经结束，除非事件里有强硬的说一定要完成些什么事情。
- 如果事件是要求用户回应什么的，那么不说话也是一种回应，输入"."也是一种回应

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
"." 就是明确的发言和行动。应该判定为已完成用户发言阶段！！！
模型禁止返回类似的判定：【"reason": "当前阶段是用户发言阶段，用户虽然多次输入'.'但根据事件流程仍在等待用户做出明确的发言或行动来决定下一步方向，因此事件尚未结束，继续等待用户输入"】
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。
- 此时，\`event_status\` 应判定为 \`active\`，表示系统可以继续推进剧情，而不是 \`waiting_input\`。

## 约束
1. 只判断当前事件，不判断章节整体成败
2. 不要自己编造新剧情
3. recent_dialogue 里的"用户"才代表真实用户发言
4. 不能把单个数字误判成"输入了多次"
5. 如果事件还没达成，只能 ended=false
6. 用户输入 "." 是跳过，不是迷茫，不需要引导。

## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块。

字段固定为：
- ended: boolean
- event_status: "active" | "waiting_input" | "completed"
- progress_summary: string
- progress_facts: string[]
- reason: string

## 判定规则
- ended=true：代表当前事件已经完成，系统应切到下一个事件
- ended=false：代表当前事件仍未完成，系统继续停留在当前事件
- event_status=waiting_input：代表当前事件还需要用户输入
- event_status=active：代表当前事件仍在推进，但还没轮到用户
- event_status=completed：只在 ended=true 时使用

## 用户发言阶段完成判定（重要）
当 current_stage.label 含"用户发言"且需要判定该阶段是否完成时：
- 用户**任何**非空、非纯标点的输入都算已发言（"." 视为跳过表达，也算完成）
- 不要把"用户发言"理解为"用户必须下达具体动作指令"——表达意愿、提问、感叹、命令、沉默跳过都属于"发言"
- 用户一旦在该阶段留下任何有效输入，ended=true、event_status=active，让系统推进剧情
- 不要因为"剧情还没发生具体变化"就判定用户还没发言——那是编排师的事，不是你的事
- 若用户**连续多轮**都被判 waiting_input 但实际已多次输入，应主动结束该阶段，避免死循环

## 输出示例
{"ended":false,"event_status":"waiting_input","progress_summary":"当前事件仍在等待用户补充角色名称、性别和年龄","progress_facts":["用户尚未提供完整角色信息","当前仅完成开场引导","需要继续等待用户输入"],"reason":"当前事件目标尚未完成，仍需用户继续提供信息"}
`;

async function _llmJudgeEventProgress(progress, chapters, recentDialogue) {
  console.log("[event_manager][_llmJudgeEventProgress] start");
  const idx = progress.currentChapterIndex || 0;
  const chapter = chapters[idx];
  if (!chapter) return null;
  const phases = progress.phases || [];
  normalizePhasesEvents(phases);
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const curPhase = phases[phaseIdx] || null;
  const curEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx] || null) : null;
  console.log("[event_manager][_llmJudgeEventProgress] curEvent:",JSON.stringify(curEvent));
  if (!curEvent) return null;

  // Parse recentDialogue into object array (align to toonflow-game-app)
  let recentDialogueList = [];
  if (typeof recentDialogue === 'string') {
    try { recentDialogueList = JSON.parse(recentDialogue); } catch (_) {
      recentDialogueList = String(recentDialogue || '').split(/\n/).filter(Boolean).map(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          return { role: line.slice(0, colonIdx).trim(), content: line.slice(colonIdx + 1).trim() };
        }
        return { role: 'user', content: line };
      });
    }
  } else if (Array.isArray(recentDialogue)) {
    recentDialogueList = recentDialogue;
  }
  recentDialogueList = recentDialogueList.slice(-10);

  // 提取事件详细内容（@旁白/角色台词行等）
  const eventWindow = extractEventContent(chapter?.content || '', curPhase?.label || curPhase?.name || '', curEvent?.name || '');

    const snapshot = {
     chapter: { id: chapter.id || (idx || 0), title: chapter.title || '' ,content: chapter?.content || '',},
    current_event: {
      id: curEvent.id || '',
      index: eventIdx,
      kind: curEvent.kind || '',
      flow: curEvent.flow || '',
      status: curEvent.status || '',
      label: curEvent.label || curEvent.name || '',
      summary: curEvent.targetSummary || curEvent.summary || curEvent.name || '',
      targetSummary: curEvent.targetSummary || '',
      body: curEvent.body || '',
      facts: curEvent.facts || [],
      window: eventWindow,
    },
    current_progress: {
      phase_index: phaseIdx,
      stage_index: 0,
      total_stages: (curPhase && curPhase.events) ? curPhase.events.length : 0,
      completed_events: progress.completedEvents || [],
      user_speak_count: 0,
      user_speak_required: null,
    },
    current_stage: curPhase ? {
      index: phaseIdx,
      label: curPhase.label || curPhase.name || '',
      summary: curEvent.summary || '',
      user_speak_required: null,
    } : null,
    next_stage: phases[phaseIdx + 1] ? {
      index: phaseIdx + 1,
      label: phases[phaseIdx + 1].label || phases[phaseIdx + 1].name || '',
      summary: (phases[phaseIdx + 1].events && phases[phaseIdx + 1].events[0]) ? (phases[phaseIdx + 1].events[0].summary || '') : '',
    } : null,
    next_event: (curPhase && curPhase.events) ? (curPhase.events[eventIdx + 1] || null) : null,
    latest_message: (() => {
          // 从 recentDialogueList 中取最后一条用户消息作为 latest_message
          const lastUserMsg = recentDialogueList.slice().reverse().find(m => m.role === '用户' || m.role_type === 'player');
          return {
            role: (lastUserMsg && lastUserMsg.role) || 'user',
            content: (lastUserMsg && lastUserMsg.content) || '',
          };
    })(),
    recent_dialogue: recentDialogueList,
  };
  const userPrompt = JSON.stringify(snapshot, null, 2);
  console.log("[event_manager][_llmJudgeEventProgress] userPrompt:", userPrompt);
  let raw = null;
  try {
    if (window.tf_llm && window.tf_llm.callDirect) {
      raw = await window.tf_llm.callDirect(
        [{ role: 'system', content: _PROMPT_STORY_EVENT_PROGRESS }, { role: 'user', content: userPrompt }],
        { maxCompletionTokens: 600, temperature: 0.3, usageType: '事件进度检测' }
      );
    } else {
      raw = await tavo.generate(_PROMPT_STORY_EVENT_PROGRESS + '\n\n' + userPrompt, { context: false, settings: { temperature: 0.3, maxCompletionTokens: 600 } });
    }
  } catch (e) {
    console.warn('[event_manager][tf_story_game][event_llm] 调用失败:', e.message);
    return { ended: false, event_status: 'active', reason: 'llm_error:' + e.message };
  }
  // 解析 ended / event_status / progress_summary / progress_facts / reason
  if (!raw) return { ended: false, event_status: 'active', reason: 'empty' };
    console.warn('[event_manager][tf_story_game][event_llm] 调用 :raw', JSON.stringify(raw));
  let txt = String(raw).trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  let obj = null;
  try { obj = JSON.parse(txt); } catch (e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!obj) return { ended: false, event_status: 'active', reason: 'parse_fail' };
  const status = String(obj.event_status || 'active').toLowerCase();
  return {
    ended: obj.ended === true || status === 'completed',
    event_status: ['active', 'waiting_input', 'completed'].includes(status) ? status : 'active',
    progress_summary: obj.progress_summary || obj.progressSummary || '',
    progress_facts: Array.isArray(obj.progress_facts) ? obj.progress_facts : (Array.isArray(obj.progressFacts) ? obj.progressFacts : []),
    reason: obj.reason || '',
  };
}

// 对外：事件进度推进（mcs 编排后调用，LLM 主动推进 phase/event）
async function tfEventProgress_advance(messageContext) {
  try {
    const progress = getProgress();
    if (progress.storyCompleted || progress.sessionFreeMode) {
      return { advanced: false, reason: 'free_or_done' };
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) return { advanced: false, reason: 'no_chapter' };
    if (!progress.runtimeOutline || progress.chaptersKey !== chapters.length + ':' + idx) {
      // 优先读 chapter.runtimeOutline（sync_story 阶段预解析），fallback 才用 parseProgress
      progress.runtimeOutline = (chapter && chapter.runtimeOutline && Array.isArray(chapter.runtimeOutline.phases) && chapter.runtimeOutline.phases.length)
        ? chapter.runtimeOutline
        : parseProgress(chapter.content || '');
      // 指针：保留已有（如果在新 outline 里找得到），否则 fallback 到首个未完成 phase
      const phases = progress.runtimeOutline.phases || [];
      let keepPhase = progress.currentPhaseId ? phases.find(p => p.id === progress.currentPhaseId) : null;
      let keepStage = (keepPhase && progress.currentStageId) ? (keepPhase.stages || []).find(s => s.id === progress.currentStageId) : null;
      if (!keepPhase) {
        // 找第一个未完成的 phase
        keepPhase = phases.find(p => !isPhaseCompleted(progress, p.id)) || phases[0] || null;
        if (keepPhase) {
          progress.currentPhaseId = keepPhase.id;
          keepStage = (keepPhase.stages || []).find(s => !isStageCompleted(progress, keepPhase.id, s.id)) || (keepPhase.stages || [])[0] || null;
        }
      }
      if (keepPhase && !keepStage) {
        keepStage = (keepPhase.stages || []).find(s => !isStageCompleted(progress, keepPhase.id, s.id)) || (keepPhase.stages || [])[0] || null;
      }
      if (keepPhase) {
        progress.currentPhaseId = keepPhase.id;
        progress.currentStageId = keepStage ? keepStage.id : null;
      } else {
        progress.currentPhaseId = null;
        progress.currentStageId = null;
      }
      progress.completedEvents = [];
      progress.completedPhases = [];
      progress.chaptersKey = chapters.length + ':' + idx;
    }
    const phases = (progress.runtimeOutline && progress.runtimeOutline.phases) || [];
    if (!phases.length) return { advanced: false, reason: 'no_phases' };

    // Fetch recent messages directly (messageContext.allMessages is often empty)
    let recentDialogue = '';
    try {
      const _msgCnt = await tavo.message.count();
      const _msgStart = Math.max(0, (_msgCnt || 0) - 10);
      const _msgs = await tavo.message.find([_msgStart, Math.max(0, (_msgCnt || 1) - 1)]);
      if (Array.isArray(_msgs) && _msgs.length) {
        // Build characterId → name map
        let _charMap = {};
        try {
          const _chat = await tavo.chat.current();
          for (const c of ((_chat && _chat.characters) || [])) {
            if (c && c.id !== undefined) _charMap[c.id] = c.name || '未命名';
          }
        } catch (_e) {}
        recentDialogue = JSON.stringify(_msgs.map(m => {
          const content = String(m.content || '').replace(/<[^>]+>/g, '').trim();
          if (!content) return null;
          let role = '系统';
          if (m.role === 'user') role = '用户';
          else if (m.role === 'assistant') role = (m.characterId !== undefined && _charMap[m.characterId]) || 'NPC';
          return { role, content };
        }).filter(Boolean));
      }
    } catch(_) {}
    if (!recentDialogue) {
      recentDialogue = (messageContext && (messageContext.allMessages || messageContext.content)) || '';
    }
     console.log('[event_manager][_llmJudgeEventProgress][tfEventProgress_advance][tf_progress]llmRes input', JSON.stringify({progress:chapters,chapters:chapters,recentDialogue:recentDialogue}) );
    const llmRes = await _llmJudgeEventProgress(progress, chapters, recentDialogue);
    console.log('[event_manager][_llmJudgeEventProgress][tfEventProgress_advance][tf_progress]llmRes', JSON.stringify(llmRes) );
    try { if (typeof tavo.utils.toast === 'function') tavo.utils.toast('🎉 进度 llmRes.ended=' + (llmRes && llmRes.ended) + ' reason=' + (llmRes && llmRes.reason)); } catch(e){
      console.error('[event_manager][_llmJudgeEventProgress]',e);
    }

    // 多条件推进判断（对齐 toonflow applyAiEventProgressResolution）
    // 1) ended=true → 直接推进
    // 2) progress_summary 包含完成提示
    // 3) 连续 waiting_input ≥ 5 次 → stall force complete
    const _summary = (llmRes && llmRes.progress_summary) || '';
    const _summarySaysComplete = /(已完成.*推进至|已完成.*等待|已完成.*进入|场景.*阶段|阶段.*阶段|推进到.*阶段)/i.test(_summary);
    if (typeof progress.vars !== 'object' || progress.vars === null) progress.vars = {};
    if (progress.vars.eventStallCount === undefined || progress.vars.eventStallCount === null) progress.vars.eventStallCount = 0;
    const _isStall = !!(llmRes && String(llmRes.event_status || '').trim() === 'waiting_input' && !llmRes.ended);
    const _newStall = _isStall ? (progress.vars.eventStallCount + 1) : 0;
    progress.vars.eventStallCount = _newStall;
    const STALL_THRESHOLD = 5;
    const _stallForce = _newStall >= STALL_THRESHOLD;
    if (_stallForce) progress.vars.eventStallCount = 0;
    const _shouldAdvance = !!(llmRes && (llmRes.ended || _summarySaysComplete || _stallForce));
    console.log('[event_manager][_llmJudgeEventProgress][tfEventProgress_advance] shouldAdvance=' + _shouldAdvance + ' summarySays=' + _summarySaysComplete + ' stall=' + _newStall + ' force=' + _stallForce);
    if (!llmRes || !_shouldAdvance) return { advanced: false, reason: (llmRes && llmRes.reason) || 'not_ended' };
    if (!llmRes.ended) llmRes.ended = true;


    // 推进：对齐 applySessionUserEventProgress 的 completedEvents 标记逻辑
    const phaseIdx = progress.currentPhase || 0;
    const eventIdx = progress.currentEvent || 0;
    const curPhase = phases[phaseIdx] || {};
    const events = curPhase.events || [];
    const phaseName = curPhase.name || '';
    if (!progress.completedPhases) progress.completedPhases = [];
    if (!progress.completedEvents) progress.completedEvents = [];
    // 标记当前 event 完成
    const eventMarker = 'phase:' + phaseIdx + ':event:' + eventIdx;
     console.log('[event_manager][_llmJudgeEventProgress][tfEventProgress_advance][tf_progress]eventMarker', eventMarker );
    if (!progress.completedEvents.includes(eventMarker)) progress.completedEvents.push(eventMarker);
    if (events[eventIdx]) events[eventIdx].state = '[s]'; // 直接写入 event.state，UI 不用推理
    if (eventIdx + 1 < events.length) {
      progress.currentEvent = eventIdx + 1;
    } else if (phaseIdx + 1 < phases.length) {
      // 当前 phase 完成
      const phaseMarker = 'phase:' + phaseIdx;
      if (!progress.completedEvents.includes(phaseMarker)) progress.completedEvents.push(phaseMarker);
      if (phases[phaseIdx]) phases[phaseIdx].state = '[s]';
      if (phaseName && !progress.completedPhases.includes(phaseName)) progress.completedPhases.push(phaseName);
      progress.currentPhase = phaseIdx + 1;
      progress.currentEvent = 0;
    } else {
      // 所有 event/phase 都完成
      const phaseMarker = 'phase:' + phaseIdx;
      if (!progress.completedEvents.includes(phaseMarker)) progress.completedEvents.push(phaseMarker);
      if (phaseName && !progress.completedPhases.includes(phaseName)) progress.completedPhases.push(phaseName);
      progress.phasesAllCompleted = true;
    }
    // LLM 返回 summary/facts 写到 event 对象（UI 读 phase.events[i]）
    const writeEvt = (curPhase.events || [])[eventIdx];
    if (writeEvt) {
      if (llmRes.progress_summary) writeEvt.summary = llmRes.progress_summary;
      if (llmRes.progress_facts && llmRes.progress_facts.length) writeEvt.facts = llmRes.progress_facts;
      if (llmRes.event_status) writeEvt.status = llmRes.event_status;
    }
    // 兼容：progress 顶层保留快照
    // 事件进度状态：[s] 完成 / [i] 进行中 / [] 未开始 / [f] 失败
    // 如 （phases[currIndex](ph,pi)）-> 阶段pi:ph.name->阶段1:苏醒
    // ph.events -> [s]穿越醒来 [i]发现身份 []用户发言
    // [s]穿越醒来 [i]发现身份 []用户发言 -> [s]穿越醒来 [s]发现身份 [i]用户发言->[s]穿越醒来 [s]发现身份 [s]用户发言
    // currIndex+1 , 进入下一个阶段
    if (llmRes.progress_summary) progress.progressSummary = llmRes.progress_summary;
    if (llmRes.progress_facts && llmRes.progress_facts.length) {
      progress.progressFacts = [...(progress.progressFacts || []), ...llmRes.progress_facts].slice(-20);
    }
    // 标记新当前 event 为：“进行中”
    const newPhaseIdx = progress.currentPhase || 0;
    const newEventIdx = progress.currentEvent || 0;
    const newPhase = phases[newPhaseIdx];
    // tavo.utils.toast('🎉 进度阿推进 llmRes.ended'+llmRes.ended+", reason:"+llmRes.reason);
    if (newPhase && newPhase.events && newPhase.events[newEventIdx] && !newPhase.events[newEventIdx].state) {
      newPhase.events[newEventIdx].state = '[i]';
      const _facts = Array.isArray(progress.progressFacts) ? progress.progressFacts.join('、') : (progress.progressFacts || '');
      try { if (typeof tavo.utils.toast === 'function')
        tavo.utils.toast('🎉 进度推进 newEventIdx:' + newEventIdx + ' | ' + _facts);
      } catch(e){}
    }
    progress.updatedAt = Date.now();

    console.log('[event_manager][_llmJudgeEventProgress][tfEventProgress_advance][tf_progress]progress:', JSON.stringify(progress) );
    setProgress(progress);
    return { advanced: true, reason: llmRes.reason, summary: llmRes.progress_summary, event_status: llmRes.event_status };
  } catch (e) {
    console.warn('[event_manager][tf_story_game][event_advance] error', e);
    return { advanced: false, reason: 'exception:' + e.message };
  }
}

// hook 注册用 try/catch 包裹：抓 Tavo API 抛错（之前没错误日志 = 静默死，导致 message:added 监听没注册成功）
const _safeOn = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.on !== 'function') {
      console.error('[event_manager][tf_story_game] hook 注册失败: tavo.plugin.on 不可用, hook=' + name);
      return;
    }
    tavo.plugin.on(name, fn);
    console.log('[event_manager][tf_story_game] hook registered: ' + name);
  } catch (e) {
    console.error('[event_manager][tf_story_game] hook 注册失败: hook=' + name, e && (e.message || e));
  }
};
const _safeOnSide = (name, fn) => {
  try {
    if (typeof tavo === 'undefined' || !tavo.plugin || typeof tavo.plugin.onSidebarAction !== 'function') {
      console.error('[event_manager][tf_story_game] sidebar 注册失败: tavo.plugin.onSidebarAction 不可用, name=' + name);
      return;
    }
    tavo.plugin.onSidebarAction(name, fn);
    console.log('[event_manager][tf_story_game] sidebar registered: ' + name);
  } catch (e) {
    console.error('[event_manager][tf_story_game] sidebar 注册失败: name=' + name, e && (e.message || e));
  }
};

const NS_BASE = 'tf_story';
const PROGRESS_NS_BASE = 'tf_progress';
const STAGE_PLUGIN_ID = 'com.toonflow.multi-character-stage';
let _currentChatId = null; // 当前聊天 ID，用于构建带 chat_id 的全局变量名

// 变量命名规则（对齐变量设计.原则）：
//   chat scope  → tf_story.{name}（不带 chat_id，chat scope 本身就是聊天级别的，reset 后会清空）
//   global scope → tf_story_db_{chat_id}.{name}（带 chat_id，global scope 是所有聊天共享的）
function ns(name) { return NS_BASE + '.' + name; }              // chat scope 用
function nsGlobal(name) {                                        // global scope 用 (tf_story_db_{chatId}.*)
  return _currentChatId ? ('tf_story_db_' + _currentChatId + '.' + name) : (NS_BASE + '.' + name);
}
function progressNs() { return PROGRESS_NS_BASE; }               // tf_progress 动态数据，只在 chat scope
function settingNs(name) { return 'tf_story_setting.' + name; }  // 共享配置，多故事共用
function settingNsGlobal(name) { return 'tf_story_setting.' + name; }

// 向后兼容：NS 和 PROGRESS_NS 仍然指向基础名（不带 chat_id）
// 主要用于 boot 状态等不需要区分聊天的变量
const NS = NS_BASE;
const PROGRESS_NS = PROGRESS_NS_BASE;

function cfgGet(k, fb) {
  try { const v = tavo.plugin.config.get(k); return (v === undefined || v === null) ? fb : v; } catch (e) { return fb; }
}

// Tavo 的 chat 变量经 tavo.get 返回的是包装对象 {target,name,found,value}，
// 真实数据在 .value 里。所有读变量都必须解包，否则 v.chapters / v.level 等会是 undefined，
// 代码会误判为"空"并拿默认值覆盖，造成配置/参数卡被清空。
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

// 读变量（先 global 后 chat）：tavo_chat_reset 会清 chat scope，但 global scope 不受影响。
// 故事数据（tf_story.edit / tf_progress）必须双写到 global 才能抗 reset。
function readVarAnyScope(name) {
  // 1) global scope
  try {
    let g;
    if (typeof tavo.get === 'function') {
      // tavo.get(name, scope) -> {name,found,value}
      try { g = tavo.get(name, 'global'); } catch (e) { g = null; }
      if (g && typeof g === 'object' && 'value' in g && g.found === false) g = null;
      if (g && typeof g === 'object' && 'value' in g) g = g.value;
    }
    if (g !== null && g !== undefined) return g;
  } catch (e) {}
  // 2) chat scope
  return readChatVar(name);
}

// 写变量：双写 chat + global，确保 reset 后仍能恢复
// chatVarName: chat scope 变量名（不带 chat_id）
// globalVarName: global scope 变量名（带 chat_id）
function writeVarDual(chatVarName, globalVarName, value) {
  console.log('[event_manager][tf_story_game][writeVarDual] writeVarDual chatVarName: ' + chatVarName );
  console.log('[event_manager][tf_story_game][writeVarDual] writeVarDual globalVarName: ' + globalVarName);
  console.log('[event_manager][tf_story_game][writeVarDual] writeVarDual value: ' + JSON.stringify(value));
  let ok = false;
  try { tavo.set(chatVarName, value, 'chat'); ok = true; } catch (e) { console.warn('[event_manager][tf_story_game][writeVarDual] chat write failed: ' + (e && e.message)); }
  try { tavo.set(globalVarName, value, 'global'); console.log('[event_manager][tf_story_game][writeVarDual] global write: ' + globalVarName); } catch (e) { console.warn('[event_manager][tf_story_game][writeVarDual] global write failed: ' + (e && e.message)); }
  return ok;
}

// ---------- 编排插件检测 ----------
// 实测：tavo.plugin.search 不带 query 时会返回空列表，**不能**因为"查不到"就判定未安装
// —— 那会把 tf_story.edit.orchestration 的默认值错设成 'system'（跟随系统，插件不接管）。
// 返回 'enabled' | 'disabled' | 'unknown'，只有明确查到且被禁用才算 disabled。
async function stageState() {
  const probe = async (args) => {
    try {
      const res = await tavo.plugin.search?.(args);
      const items = (res && res.items) ? res.items : (Array.isArray(res) ? res : []);
      return Array.isArray(items) ? items : [];
    } catch (e) { return []; }
  };
  const tries = [
    { query: STAGE_PLUGIN_ID, limit: 100 },
    { query: 'toonflow', limit: 100 },
    { query: '编排', limit: 100 },
    { limit: 100 },
  ];
  for (const args of tries) {
    const items = await probe(args);
    const hit = items.find(p => p && p.pluginId === STAGE_PLUGIN_ID);
    if (hit) return hit.enabled === false ? 'disabled' : 'enabled';
  }
  return 'unknown'; // 查不到就别下结论，交给调用方按「默认插件接管」处理
}


// 群聊编排：从 tf_story_setting.edit.orchestration（global scope）读取，多故事共享
// 'system' = 跟随系统 / 'plugin' = 角色编排插件接管
async function applyOrchestrationMode() {
  const enabled = cfgGet('enabled', true) !== false;
  if (!enabled) return;
  // 读 tf_story_setting.edit（多故事共享配置）
  let orch = null;
  try {
    let raw = tavo.get(settingNsGlobal('edit'), 'global');
    let guard = 0;
    while (raw && typeof raw === 'object' && raw.found !== undefined && 'value' in raw && guard < 5) { raw = raw.value; guard++; }
    if (raw && typeof raw === 'object' && raw.orchestration) orch = raw.orchestration;
  } catch (e1) {}
  const state = await stageState();
  const installed = state !== 'disabled';
  if (!orch) {
    orch = (state === 'disabled') ? 'system' : 'plugin';
    // 写回 tf_story_setting.edit（多故事共享）
    try {
      let raw = tavo.get(settingNsGlobal('edit'), 'global');
      let guard = 0;
      while (raw && typeof raw === 'object' && raw.found !== undefined && 'value' in raw && guard < 5) { raw = raw.value; guard++; }
      const setting = (raw && typeof raw === 'object') ? raw : {};
      setting.orchestration = orch;
      tavo.set(settingNs('edit'), setting, 'global');
    } catch (e2) {}
  }
  if (orch === 'system') {
    try {
      await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
      tavo.utils.toast('群聊编排：跟随系统（Tavo 原生）');
    } catch (e) {}
    return;
  }
  // 角色编排插件模式：交由 multi_character_stage 接管 scenario + overrideScenario
  if (installed) {
    tavo.utils.toast('群聊编排：角色编排插件 → 角色发言插件');
  } else {
    try {
      await tavo.chat.update({ responseMode: 'natural', overrideScenario: '' });
    } catch (e) {}
    tavo.utils.toast('⚠️ 未检测到角色编排器，已回退跟随系统');
  }
}

// =========================================================================
// 章节结局判定器（对齐 Toonflow-game useToonflowStore.evaluateDebugChapterResult）
// =========================================================================
//
// 成功条件格式（两种都支持）：
// 1. 自由文本："与萧炎对话3次" → 用启发式匹配最近对话/记忆
// 2. 结构化 JSON：
//    { type: 'contains', field: 'message', value: '萧炎' }
//    { type: 'regex', field: 'messages', value: '.*萧炎.*' }
//    { type: 'length_gte', field: 'messages', value: '50' }
//    { any: [{...}, {...}] }
//    { all: [{...}, {...}] }
//    { not: {...} }
//    { failure: {...}, success: {...}, nextChapterId: 3 }
// 结果：success → 推进；failed → 重置（自由模式或重试）

function evalConditionNode(node, ctx) {
  if (node === null || node === undefined) return false;
  if (typeof node === 'string') {
    const s = node.trim();
    if (!s) return false;
    return ctx.latestMessage.toLowerCase().includes(s.toLowerCase());
  }
  if (Array.isArray(node)) return node.some(item => evalConditionNode(item, ctx));
  if (typeof node !== 'object') return false;
  // 逻辑组合
  if (Array.isArray(node.all)) return node.all.length > 0 && node.all.every(it => evalConditionNode(it, ctx));
  if (Array.isArray(node.any)) return node.any.length > 0 && node.any.some(it => evalConditionNode(it, ctx));
  if (node.not !== undefined) return !evalConditionNode(node.not, ctx);
  // 比较节点
  const type = String(node.type || 'contains').toLowerCase();
  const field = String(node.field || 'message').toLowerCase();
  const value = String(node.value || '').trim();
  if (!value && !['length_gte', 'length_lte'].includes(type)) return false;
  const target = (() => {
    if (['message', 'latest', 'latest_message'].includes(field)) return ctx.latestMessage;
    if (['messages', 'history', 'full', 'all'].includes(field)) return ctx.allMessages;
    if (['chapter', 'chapter_title'].includes(field)) return ctx.chapterTitle;
    if (field === 'chapter_content') return ctx.chapterContent;
    return ctx.latestMessage;
  })();
  const t = target || '';
  const v = value;
  switch (type) {
    case 'contains':       return t.toLowerCase().includes(v.toLowerCase());
    case 'not_contains':
    case 'notcontains':    return !t.toLowerCase().includes(v.toLowerCase());
    case 'equals':
    case 'eq':             return t.trim().toLowerCase() === v.toLowerCase();
    case 'not_equals':
    case 'neq':            return t.trim().toLowerCase() !== v.toLowerCase();
    case 'regex':
      try { return new RegExp(v, 'i').test(t); } catch (e) { return false; }
    case 'length_gte':     return t.length >= Number(v);
    case 'length_lte':     return t.length <= Number(v);
    default:               return t.toLowerCase().includes(v.toLowerCase());
  }
}

// 自由文本成功条件启发式（对齐 web 端的"对话N次"语义）
function evalFreeText(text, ctx) {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  // 匹配 "对话 N 次" 形式
  const m1 = t.match(/对话\s*(\d+)\s*次/);
  if (m1) {
    const need = parseInt(m1[1]);
    return ctx.messageCount >= need;
  }
  // 匹配 "获得 XXX" 形式（从记忆插件查）
  const m2 = t.match(/获得\s*(.+)/);
  if (m2 && ctx.memoryItems.length) {
    return ctx.memoryItems.some(it => it.includes(m2[1]));
  }
  // 默认：消息中包含文本中所有关键词
  const words = t.split(/[，,。;；]/).map(x => x.trim()).filter(x => x.length >= 2);
  if (!words.length) return false;
  const hit = words.filter(w => ctx.latestMessage.toLowerCase().includes(w.toLowerCase())).length;
  return hit >= Math.ceil(words.length * 0.5);
}

// 判定当前章节结果
function evaluateChapterOutcome(chapter, ctx) {
  if (!chapter) return { result: 'continue' };
  const cond = chapter.successCondition;
  if (!cond || !String(cond).trim()) return { result: 'continue' };

  let matched = false;
  let result = 'success';
  let nextChapterId = null;

  // 尝试 JSON 解析
  let node = null;
  try { node = JSON.parse(cond); } catch (e) { node = null; }

  if (node && typeof node === 'object') {
    // 结构化失败/成功分支
    if (node.failure !== undefined && evalConditionNode(node.failure, ctx)) {
      return { result: 'failed', nextChapterId: node.nextChapterId || null };
    }
    if (node.success !== undefined && evalConditionNode(node.success, ctx)) {
      return { result: 'success', nextChapterId: node.nextChapterId || null };
    }
    // 整体匹配
    matched = evalConditionNode(node, ctx);
    if (node.nextChapterId) nextChapterId = node.nextChapterId;
    if (node.result === 'failed' || node.result === 'failure') result = 'failed';
  } else {
    // 自由文本启发式
    matched = evalFreeText(cond, ctx);
  }

  if (!matched) return { result: 'continue' };
  return { result, nextChapterId };
}

// =========================================================================
// 事件进度（Phase Graph）解析
// =========================================================================
// 从 chapter.content 中提取 ## Phase / ### Event 层次结构
// 状态：[s] 完成 / [i] 进行中 / [] 未开始 / [f] 失败

// 从章节内容中提取当前事件的详细内容（@旁白/角色台词行等），对齐 toonflow eventWindow
function extractEventContent(chapterContent, phaseName, eventName) {
  if (!chapterContent || !eventName) return '';
  const lines = chapterContent.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^###\s+/.test(line) && line.includes(eventName)) { startIdx = i; break; }
  }
  if (startIdx < 0) return '';
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{2,3}\s+/.test(line)) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim().slice(0, 3000);
}

// 把 runtimeOutline 派生为老结构的 phases[]（每次保存 progress 时同步写入，供老 plugins 读）
function derivePhasesFromOutline(outline) {
  if (!outline || !Array.isArray(outline.phases)) return [];
  return outline.phases.map(p => {
    const stageList = (p.stages || []).map(s => {
      // 解析 [s]/[f]/[i]/[] 状态标记（写在 stage.label 前的状态字符）
      // 对齐 toonflow-game-app stage.state 字段
      const stateMatch = (s.label || '').match(/^[\s]*\[([sif])\]/i);
      const stateTag = stateMatch ? stateMatch[1].toLowerCase() : '';
      const cleanLabel = stateMatch ? s.label.replace(/^[\s]*\[[sif]\][\s]*/i, '') : s.label;
      // 状态映射：s=completed, f=failed, i=active, ''=idle
      const statusFromState = stateTag === 's' ? 'completed'
        : stateTag === 'f' ? 'failed'
        : stateTag === 'i' ? 'active'
        : 'idle';
      return {
        name: cleanLabel,
        id: s.id,
        kind: s.kind === 'user' ? 'user_input' : 'scene',
        flow: s.kind === 'user' ? 'waiting_input' : 'chapter_content',
        // status 默认从 s.status 读，没有就从 [sif] 标记读，都没有就 active
        status: s.status || statusFromState || (s.kind === 'user' ? 'waiting_input' : 'active'),
        summary: s.targetSummary || cleanLabel,
        facts: [],
        label: cleanLabel,
        body: s.body || '',
        state: stateTag,
      };
    });
    // phase.state 解析（## 标题前的 [s]/[f]/[i]）
    const phStateMatch = (p.label || '').match(/^[\s]*\[([sif])\]/i);
    const phState = phStateMatch ? phStateMatch[1].toLowerCase() : '';
    const phCleanLabel = phStateMatch ? p.label.replace(/^[\s]*\[[sif]\][\s]*/i, '') : p.label;
    return {
      name: phCleanLabel,
      id: p.id,
      index: outline.phases.indexOf(p),
      state: p.state || phState,
      events: stageList,
    };
  });
}

// 同步指针：保存前调用，确保 phases/currentPhase/currentEvent 与 runtimeOutline 一致
function syncLegacyProgressFields(progress) {
  if (!progress) return progress;
  const outline = progress.runtimeOutline;
  if (outline) {
    // 派生 phases 缓存（老 plugins 读这个）
    progress.phases = derivePhasesFromOutline(outline);
    // 同步 currentPhase/currentEvent 索引（从 id 指针派生）
    if (progress.currentPhaseId) {
      const pi = progress.phases.findIndex(p => p.id === progress.currentPhaseId);
      if (pi >= 0) {
        progress.currentPhase = pi;
        const cur = progress.phases[pi] || {};
        if (progress.currentStageId) {
          const ei = (cur.events || []).findIndex(e => e.id === progress.currentStageId);
          if (ei >= 0) progress.currentEvent = ei;
          // 注意：找不到时不重置 currentEvent，保留上一个值（避免 bug A：phaseId 丢失导致重置）
        }
        // currentEvent 找不到对应 stage 时也不重置（保留原值）
      } else {
        // phaseId 找不到对应 phase：不重置 currentPhase（保留原值），只刷新 phases
        // 这种情况通常是 runtimeOutline 重建了（章节内容变了），但 currentPhaseId 是老 id
        // 让 advanceEventProgress / 后续调用自然修正
      }
    }
    // currentPhaseId 缺失：保持 currentPhase/currentEvent 原值（兜底）
  }
  return progress;
}

// phase 完成标记管理（对齐 toonflow gameEngine.getPhaseMarker）
function makePhaseMarker(phaseId) {
  return 'phase:' + String(phaseId || '').trim();
}
function isPhaseCompleted(progress, phaseId) {
  return Array.isArray(progress.completedPhases) && progress.completedPhases.indexOf(makePhaseMarker(phaseId)) >= 0;
}
function markPhaseCompleted(progress, phaseId) {
  if (!Array.isArray(progress.completedPhases)) progress.completedPhases = [];
  const marker = makePhaseMarker(phaseId);
  if (progress.completedPhases.indexOf(marker) < 0) {
    progress.completedPhases.push(marker);
  }
}

// stage 状态保护：completed 不退回到 active（兜底）
function isStageCompleted(progress, phaseId, stageId) {
  return Array.isArray(progress.completedStages)
    && progress.completedStages.indexOf(phaseId + ':' + stageId) >= 0;
}
function markStageCompleted(progress, phaseId, stageId) {
  if (!Array.isArray(progress.completedStages)) progress.completedStages = [];
  const marker = phaseId + ':' + stageId;
  if (progress.completedStages.indexOf(marker) < 0) {
    progress.completedStages.push(marker);
  }
}

// 从 stage.state 字段读取状态标记（[s]/[f]/[i]）
function getStageStateTag(stage) {
  if (!stage) return '';
  return (stage.state || '').toString().trim().toLowerCase().slice(0, 1);
}
// phase 内所有 stage 都是 [s]（成功）或 [f]（失败）= phase 已终结（terminated）
// 这是强制切换 phase 的兜底：即使 currentStageId 还在本 phase，也必须跳到下一个
function isPhaseTerminated(phase) {
  if (!phase || !Array.isArray(phase.stages) || phase.stages.length === 0) return false;
  // 元数据 phase（meta/非事件）不算
  if (phase.kind === 'meta' || /^非事件/.test(phase.label || '')) return false;
  return phase.stages.every(s => {
    const t = getStageStateTag(s);
    return t === 's' || t === 'f';
  });
}
// 在 phases 列表中找下一个未终结的 phase（跳过 meta 和已 terminate 的）
function findNextUnterminatedPhase(phases, fromIdx) {
  if (!Array.isArray(phases)) return null;
  for (let i = fromIdx + 1; i < phases.length; i++) {
    const ph = phases[i];
    if (!ph) continue;
    if (ph.kind === 'meta' || /^非事件/.test(ph.label || '')) continue;
    if (isPhaseTerminated(ph)) continue; // 跳过已终止的
    return ph;
  }
  return null;
}

// 双指针：读 currentPhaseId/currentStageId 在 runtimeOutline 里的位置
// 返回 { phase, stage, phaseIdx, stageIdx }，各插件可直接读 phase.label / stage.body 等
function getCurrentPhaseStage(progress) {
  if (!progress) return { phase: null, stage: null, phaseIdx: 0, stageIdx: 0 };
  const newPhases = (progress.runtimeOutline && progress.runtimeOutline.phases) || [];
  if (!newPhases.length) return { phase: null, stage: null, phaseIdx: 0, stageIdx: 0 };
  let phaseIdx = newPhases.findIndex(p => p.id === progress.currentPhaseId);
  if (phaseIdx < 0) phaseIdx = 0;
  const phase = newPhases[phaseIdx] || null;
  if (!phase) return { phase: null, stage: null, phaseIdx: 0, stageIdx: 0 };
  let stageIdx = (phase.stages || []).findIndex(s => s.id === progress.currentStageId);
  if (stageIdx < 0) stageIdx = 0;
  const stage = (phase.stages || [])[stageIdx] || null;
  return { phase, stage, phaseIdx, stageIdx };
}

// 确保 phases 里的每个事件都有 LLM 需要的字段（kind/flow/status/summary/facts/label）
function normalizePhasesEvents(phases) {
  if (!Array.isArray(phases)) return phases;
  for (const phase of phases) {
    if (!phase || !Array.isArray(phase.events)) continue;
    for (const evt of phase.events) {
      if (!evt) continue;
      const isUserNode = /用户发言/.test(evt.name || '');
      if (!evt.kind) evt.kind = isUserNode ? 'user_input' : 'scene';
      if (!evt.flow) evt.flow = isUserNode ? 'waiting_input' : 'chapter_content';
      if (!evt.status) evt.status = isUserNode ? 'waiting_input' : 'active';
      if (!evt.summary) evt.summary = evt.name || '';
      if (!evt.facts) evt.facts = [];
      if (!evt.label) evt.label = evt.name || '';
    }
  }
  return phases;
}

// parseProgress 直接返回 runtimeOutline（对齐 toonflow-game-app，不再输出老 phases[]）
// 结构：
//   runtimeOutline.phases[]: {id, label, kind, targetSummary, stages: [{id, label, kind, body}], nextPhaseIds, ...}
//   runtimeOutline.userNodes[]: 用户发言节点
//   runtimeOutline.fixedEvents[]: 章节结局条件
//   runtimeOutline.endingRules: {success, failure, nextChapterId}
function parseProgress(content) {
  const lines = (content || '').split(/\r?\n/);
  const newPhases = [];
  let currentNewPhase = null;
  let order = 0;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      const m = line.match(/^##\s+(.+)/);
      if (m) {
        const phaseName = m[1].trim();
        currentNewPhase = {
          id: 'phase_' + (order + 1) + '_' + phaseName,
          label: phaseName,
          kind: /^非事件/.test(phaseName) ? 'meta' : 'scene',
          targetSummary: '',
          stages: [],
          userNodeId: null,
          allowedSpeakers: [],
          nextPhaseIds: [],
          defaultNextPhaseId: null,
          requiredEventIds: [],
          completionEventIds: [],
          advanceSignals: [],
          relatedFixedEventIds: [],
        };
        newPhases.push(currentNewPhase);
        order++;
      }
    } else if (/^###\s+/.test(line) && currentNewPhase) {
      const m = line.match(/^###\s+(.+)/);
      if (m) {
        const stateMatch = m[1].match(/^[\s]*(\[[sif]\])?\s*(.+)/i);
        const evtName = stateMatch ? stateMatch[2].trim() : m[1].trim();
        const stateTag = stateMatch ? (stateMatch[1] || '').toLowerCase().slice(0, 1) : '';
        const isUserNode = /用户发言/.test(evtName);
        const stageBody = _extractStageBody(content, m.index + m[0].length);
        const stageId = currentNewPhase.id + '_stage_' + currentNewPhase.stages.length + '_' + evtName;
        currentNewPhase.stages.push({
          id: stageId,
          label: evtName,
          kind: isUserNode ? 'user' : 'scene',
          state: stateTag, // 保留 [s]/[f]/[i] 状态标记，advanceEventProgress 用它判定 phase 是否 terminated
          status: stateTag === 's' ? 'completed' : stateTag === 'f' ? 'failed' : (isUserNode ? 'waiting_input' : 'active'),
          targetSummary: stageBody || evtName,
          userNodeId: isUserNode ? stageId : null,
          body: stageBody || '',
        });
        if (stageBody) currentNewPhase.advanceSignals.push(stageBody);
      }
    }
  }
  // 建立 nextPhaseIds 链（顺序推进）
  for (let i = 0; i < newPhases.length; i++) {
    if (i + 1 < newPhases.length) {
      newPhases[i].nextPhaseIds = [newPhases[i + 1].id];
      newPhases[i].defaultNextPhaseId = newPhases[i + 1].id;
    }
  }
  // 提取 endingRules（## 本章完成条件 / ## 章节完成条件 后的内容）
  let endingRules = null;
  let fixedEvents = [];
  const condMatch = content.match(/##\s*(?:本章完成条件|章节完成条件)[：:]\s*(.+?)(?=\n##|\n$)/m);
  if (condMatch) {
    const condText = condMatch[1].trim();
    const fixedEventId = 'fixed_event_' + condText.replace(/\s+/g, '_').slice(0, 60);
    fixedEvents.push({
      id: fixedEventId,
      label: condText,
      requiredBeforeFinish: true,
      conditionExpr: null,
    });
    endingRules = { success: [fixedEventId], failure: [], nextChapterId: null };
  }
  for (const ph of newPhases) {
    ph.advanceSignals = ['事件标题：' + ph.label, ...ph.advanceSignals];
    // 派生 phase.targetSummary：把 stage.label 用 ' → ' 拼起来（如 "穿越醒来 → 发现身份 → 用户发言"）
    // 这样 agent 看到的是「阶段的完整流程」而不只是一个抽象 label
    if (!ph.targetSummary) {
      ph.targetSummary = (ph.stages || []).map(s => s.label).filter(Boolean).join(' → ');
    }
  }
  return {
    openingMessages: [],
    phases: newPhases,
    userNodes: [],
    fixedEvents: fixedEvents,
    endingRules: endingRules || { success: [], failure: [], nextChapterId: null },
  };
}

// 提取 ### 标题下面到下一个 ## 或 ### 之间的内容
function _extractStageBody(content, startOffset) {
  if (!content) return '';
  const rest = content.slice(startOffset);
  const lines = rest.split(/\r?\n/);
  const bodyLines = [];
  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line.trim())) break;
    bodyLines.push(line);
  }
  return bodyLines.join('\n').trim();
}

// 事件级推进（对齐 toonflow ChapterProgressEngine.applyAiEventProgressResolution）
// 用 currentPhaseId/currentStageId 推进；用 completedPhases/completedStages 防止回退
// 兜底：如果当前 phase 已经被手动标 [s]/[f]（terminated），强制切到下一未终止 phase
function advanceEventProgress(progress) {
  if (!progress) return;
  const phases = (progress.runtimeOutline && progress.runtimeOutline.phases) || [];
  if (!phases.length) return;
  // 找到当前 phase
  let pi = phases.findIndex(p => p.id === progress.currentPhaseId);
  if (pi < 0) pi = 0;
  let phase = phases[pi] || null;
  if (!phase) return;
  // 跳过「非事件」phase（meta 类）
  while (pi < phases.length && (phase.kind === 'meta' || /^非事件/.test(phase.label || ''))) {
    pi++;
    phase = phases[pi] || null;
  }
  if (!phase) return;
  // 兜底（关键）：如果当前 phase 已被标 [s]/[f]（所有 stage 都 terminated），
  // 即使 currentStageId 还在本 phase，也强制推进到下一个未终止 phase。
  // 这是为了「阶段末尾强制切换」规则：阶段一终结就必须切走。
  if (isPhaseTerminated(phase) && pi < phases.length - 1) {
    markPhaseCompleted(progress, phase.id);
    const next = findNextUnterminatedPhase(phases, pi);
    if (next) {
      // 找到 next 在 phases 里的索引
      const np = phases.indexOf(next);
      let stagesN = next.stages || [];
      let ne = 0;
      while (ne < stagesN.length && (stagesN[ne].kind === 'user' || /用户发言/.test(stagesN[ne].label || ''))) {
        markStageCompleted(progress, next.id, stagesN[ne].id);
        ne += 1;
      }
      progress.currentPhaseId = next.id;
      progress.currentStageId = (stagesN[ne] && stagesN[ne].id) || null;
      progress.currentPhase = np;
      progress.currentEvent = ne;
      progress.updatedAt = Date.now();
      console.log('[event_manager][advance] phase terminated -> force jump: ' + phase.id + ' -> ' + next.id);
      return;
    }
    // 找不到下一个：章节完成
    markPhaseCompleted(progress, phase.id);
    progress.updatedAt = Date.now();
    return;
  }
  // 找到当前 stage
  let stages = phase.stages || [];
  let si = stages.findIndex(s => s.id === progress.currentStageId);
  if (si < 0) si = 0;
  // 标记当前 stage 已完成（完成的不再退回到 active）
  if (progress.currentStageId) {
    markStageCompleted(progress, phase.id, progress.currentStageId);
  }
  // 推进：下一个 stage
  si += 1;
  // 连续「用户发言」消费：用户刚说完话，下一个 stage 如果也是 user_node 视为已满足
  while (si < stages.length && (stages[si].kind === 'user' || /用户发言/.test(stages[si].label || ''))) {
    markStageCompleted(progress, phase.id, stages[si].id);
    si += 1;
  }
  if (si >= stages.length) {
    // 当前 phase 所有 stage 完成 -> 标记 phase 完成，进入下一 phase
    markPhaseCompleted(progress, phase.id);
    // 兜底（再次检查）：如果当前阶段被标 [s]/[f]（terminated），强制跳到下一未终止
    const next = isPhaseTerminated(phase) ? findNextUnterminatedPhase(phases, pi) : null;
    if (next) {
      const np = phases.indexOf(next);
      let stagesN = next.stages || [];
      let ne = 0;
      while (ne < stagesN.length && (stagesN[ne].kind === 'user' || /用户发言/.test(stagesN[ne].label || ''))) {
        markStageCompleted(progress, next.id, stagesN[ne].id);
        ne += 1;
      }
      progress.currentPhaseId = next.id;
      progress.currentStageId = (stagesN[ne] && stagesN[ne].id) || null;
      progress.currentPhase = np;
      progress.currentEvent = ne;
    } else {
      // 已是最后一个 phase，章节完成
      progress.currentPhaseId = phase.id;
      progress.currentStageId = null;
      progress.currentPhase = pi;
      progress.currentEvent = si;
    }
  } else {
    progress.currentPhaseId = phase.id;
    progress.currentStageId = stages[si].id;
    progress.currentPhase = pi;
    progress.currentEvent = si;
  }
  progress.updatedAt = Date.now();
}

// =========================================================================
// 故事进度推进
// =========================================================================

function defaultProgress() {
  return {
    currentChapterIndex: 0,
    completedChapters: [],
    completedPhases: [],
    completedEvents: [],
    failedAttempts: 0,
    sessionFreeMode: false,
    storyCompleted: false,
    currentPhase: 0,
    currentEvent: 0,
    phases: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getProgress() {
  // tf_progress 动态数据：只读 chat scope
  let v = readChatVar(progressNs());
  return (v && typeof v === 'object') ? v : defaultProgress();
}

function setProgress(p) {
  // 同步派生字段：phases[] + currentPhase/currentEvent 必须与 runtimeOutline 一致
  // （老 plugins 仍然读 phases[]，这是从 runtimeOutline 派生的缓存视图）
  syncLegacyProgressFields(p);
  // tf_progress 动态数据：只写 chat scope（reset 后重始就清空）
  let ok = false;
  try { tavo.set(progressNs(), p, 'chat'); ok = true; } catch (e) { console.warn('[event_manager][tf_story_game][setProgress] chat write failed: ' + (e && e.message)); }
  // 即时刷新 panel 故事进度单元格（如果 panel 打开）
  try {
    if (typeof window !== 'undefined' && window.tfRefreshProgress) window.tfRefreshProgress();
  } catch (e) { /* ignore */ }
  return ok;
}

// 章节推进时同步写入 tf_story.edit.currentChapterIndex（供 sprite 等插件监听）
function syncChapterIndex(idx) {
  try {
    const edit = getEdit();
    if (edit.currentChapterIndex !== idx) {
      edit.currentChapterIndex = idx;
      setEdit(edit);
    }
  } catch (e) {}
}

// 评估每条用户消息对当前章节的影响
async function judgeAndAdvance(messageContext) {
  if (cfgGet('enabled', true) === false) { console.log('[event_manager][tf_story_game][judge] ✗ enabled=false'); return; }
  const progress = getProgress();
  console.log('[event_manager][tf_story_game][judge] progress.chapter=' + progress.currentChapterIndex + ' completed=' + JSON.stringify(progress.completedChapters) + ' storyCompleted=' + progress.storyCompleted + ' freeMode=' + progress.sessionFreeMode);
  if (progress.storyCompleted || progress.sessionFreeMode) { console.log('[event_manager][tf_story_game][judge] ✗ stopped: storyCompleted or freeMode'); return; }

  const edit = getEdit();
  const chapters = edit.chapters || [];
  if (!chapters.length) return;

  const idx = progress.currentChapterIndex || 0;
  let chapter = chapters[idx];
  const phases = progress.phases || [];
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const curPhase = phases[phaseIdx] || null;
  const curEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx] || null) : null;

  console.log('[event_manager][tf_story_game] ┌─── judgeAndAdvance 入口 ─────────────────');
  console.log('[event_manager][tf_story_game] │ 📝 用户消息: ' + JSON.stringify((messageContext.content||'').slice(0,100)));
  console.log('[event_manager][tf_story_game] │ 📚 章节: ' + (idx+1) + '/' + chapters.length + (chapter ? '「' + chapter.title + '」' : '(无)'));
  console.log('[event_manager][tf_story_game] │ 📋 完成条件: ' + (chapter && chapter.successCondition ? chapter.successCondition.slice(0,80) : '(无)'));
  console.log('[event_manager][tf_story_game] │ 📊 事件进度: Phase=' + phaseIdx + '(' + (curPhase?curPhase.name:'无') + ')'
    + ' Event=' + eventIdx + '/' + ((curPhase&&curPhase.events)?curPhase.events.length:0)
    + '(' + (curEvent?curEvent.name:'无') + ')');
  console.log('[event_manager][tf_story_game] │ 🏷  phases: ' + JSON.stringify(phases.map(p=>({n:p.name,e:p.events.map(e=>e.name||'')}))));
  console.log('[event_manager][tf_story_game] │ 🔖 pendingChapterId=' + progress.pendingChapterId
    + ' failedAttempts=' + progress.failedAttempts
    + ' completedChapters=' + JSON.stringify(progress.completedChapters||[]));
  console.log('[event_manager][tf_story_game] └─────────────────────────────────────────');
  console.log('[event_manager][tf_story_game][judge] idx=' + idx + ' chapters.len=' + chapters.length + ' chapter.title=' + (chapter ? chapter.title : 'NULL'));
  if (!chapter) {
    // 越界：所有章节完成
    progress.storyCompleted = true;
    progress.sessionFreeMode = true;
    progress.updatedAt = Date.now();
    setProgress(progress);
    if (cfgGet('autoFreeMode', true) !== false) {
      tavo.utils.toast('🎉 故事已完结！已进入自由模式');
    }
    return;
  }

    console.log('[event_manager][tf_story_game][judge] 解析章节 content → runtimeOutline...');
  // 解析事件进度（首次进入新章节时）
  if (!progress.phases || progress.phaptersKey !== chapters.length + ':' + idx) {
    const outlinePhases = (chapter && chapter.runtimeOutline && Array.isArray(chapter.runtimeOutline.phases) && chapter.runtimeOutline.phases.length)
      ? chapter.runtimeOutline.phases
      : parseProgress(chapter.content || '');
    progress.phases = outlinePhases;
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.chaptersKey = chapters.length + ':' + idx;
    console.log('[event_manager][tf_story_game][judge] phases=' + progress.phases.length + ' ' + JSON.stringify(progress.phases.map(p=>({n:p.name,e:p.events.length}))));

  }
  // ========== pendingChapterId 处理（对齐官方 pendingChapterId 双阶段语义）==========
  // 阶段0：检测 pendingChapterId —— 上一轮结局已宣告本章完成，本轮才正式切换
  if (progress.pendingChapterId) {
    const prevChapterId = progress.currentChapterIndex;
    const prevChapter = chapters[prevChapterId];
    const nextIdx = progress.pendingChapterId;
    console.log('[event_manager][tf_story_game] ⏳ [pendingChapterId] 章节切换: ' + (prevChapterId+1) + '「' + (prevChapter?prevChapter.title:'?') + '」'
      + ' → ' + (nextIdx+1) + '/' + chapters.length);
    progress.pendingChapterId = null; // 先清除标记
    if (nextIdx >= chapters.length) {
      // 故事完结
      progress.storyCompleted = true;
      progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.completedPhases = [];
      progress.completedEvents = [];
      progress.updatedAt = Date.now();
      setProgress(progress);
      syncChapterIndex(nextIdx);
      tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
      try {
        await tavo.message.append({
          content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
          hidden: false,
        });
      } catch (e) {}
    } else {
      // 正式切换章节
      progress.currentChapterIndex = nextIdx;
      progress.currentPhase = 0;
      progress.currentEvent = 0;
      progress.completedPhases = [];
      progress.completedEvents = [];
      progress.failedAttempts = 0;
      // 从 chapter.runtimeOutline 读 phases（sync 阶段预解析），fallback parseProgress
      const nextCh = chapters[nextIdx];
      if (nextCh) {
        const nextOutline = (nextCh && nextCh.runtimeOutline && Array.isArray(nextCh.runtimeOutline.phases) && nextCh.runtimeOutline.phases.length)
          ? nextCh.runtimeOutline
          : parseProgress(nextCh.content || '');
        progress.phases = nextOutline.phases;
        progress.runtimeOutline = nextOutline;
        // 新结构指针重置到首章首段
        if (nextOutline.phases && nextOutline.phases[0]) {
          progress.currentPhaseId = nextOutline.phases[0].id;
          progress.currentStageId = (nextOutline.phases[0].stages && nextOutline.phases[0].stages[0]) ? nextOutline.phases[0].stages[0].id : null;
        }
        progress.chaptersKey = chapters.length + ':' + nextIdx;
      }
      progress.updatedAt = Date.now();
      setProgress(progress);
      syncChapterIndex(nextIdx);
      tavo.utils.toast('✅ 进入「' + (nextCh.title || '下一章') + '」');
      try {
        let openingLine = '（场景切换至 ' + (nextCh.title || '下一章') + '）';
        if (nextCh.openingLine) openingLine = nextCh.openingLine;
        await tavo.message.append({ content: openingLine, hidden: false });
      } catch (e) {}
    }
    // 章节已切换，当前轮次的剩余逻辑（event_progress / 章节判定）基于新章节执行
    // 重新获取当前章节引用
    const newIdx = progress.currentChapterIndex;
    chapter = chapters[newIdx];
    console.log('[event_manager][tf_story_game][judge] chapter switched to idx=' + newIdx + ' title=' + (chapter ? chapter.title : 'NULL'));
  }

  // 阶段一：LLM 事件进度检测（对齐 toonflow applySessionUserEventProgress）
  // 替代纯 +1 规则的 advanceEventProgress
  const eventResult = await applySessionUserEventProgress(
    chapter, progress, messageContext.content || '', '用户'
      ,true
  );
  console.log("[tf_story_game][judge] after event_progress: phase=" + progress.currentPhase + " ev=" + progress.currentEvent + " advanced=" + eventResult.advanced);
  // 事件推进结果必须落盘（即使章节未完成，面板也要显示最新 stage 状态）
  setProgress(progress);

  // 阶段二：章节结局判定（纯 LLM 驱动，无硬编码启发式）
  console.log("[tf_story_game][judge] cond=" + JSON.stringify(chapter.successCondition) + " msgCount=" + (messageContext.messageCount || 0));

  let outcome = { result: 'continue' };
  const llmOutcome = await evaluateChapterOutcomeByAi(chapter, progress, messageContext.content || '');
  if (llmOutcome) {
    outcome = { result: llmOutcome.result, reason: llmOutcome.reason || '', guide_summary: llmOutcome.guide_summary || '', guide_facts: llmOutcome.guide_facts || [] };
    console.log("[tf_story_game][judge] LLM 章节判定: result=" + outcome.result + " reason=" + (outcome.reason || '').slice(0, 80));
  } else {
    console.log("[tf_story_game][judge] LLM 章节判定不可用，默认 continue");
  }
  console.log("[tf_story_game][judge] LLM 章节判定不可用，默认 outcome:",outcome);
   //result: string - 只能是 "continue" /"guide"/ "success" / "failed"
  if (outcome.result === 'continue') return;

  if (outcome.result === 'failed') {
    progress.failedAttempts = (progress.failedAttempts || 0) + 1;
    progress.updatedAt = Date.now();
    setProgress(progress);
    tavo.utils.toast('⚠️ 章节「' + chapter.title + '」结局条件失败（尝试 ' + progress.failedAttempts + '）');
    // 不推进，让用户继续尝试
    return;
  }

  //result: string - 只能是 "continue" /"guide"/ "success" / "failed"
  if (outcome.result === 'guide') {
    // 引导：仅当当前是最后一个事件时把 guide 信息写入 progress，
    // 编排器下一轮会读取 progress.pendingGuide 决定是否向用户发起引导问句。
    // 当前不是最后一个事件 → 行为等同于 continue（不推进章节）
    if (progress.currentPhase >= (progress.phases || []).length - 1
        && progress.currentEvent >= ((progress.phases || [])[progress.phases.length - 1]?.events || []).length - 1) {
      progress.pendingGuide = {
        summary: outcome.guide_summary || '',
        facts: outcome.guide_facts || [],
        reason: outcome.reason || '',
        chapterTitle: chapter.title || '',
        at: Date.now(),
      };
      progress.updatedAt = Date.now();
      setProgress(progress);
      console.log('[event_manager][tf_story_game][judge] guide 已落盘（最后一个事件）');
    } else {
      console.log('[event_manager][tf_story_game][judge] guide 但不是最后一个事件 → 等同 continue，不落盘');
    }
    return;
  }

  if (outcome.result === 'success') {
    if (!progress.completedChapters.includes(idx)) progress.completedChapters.push(idx);

    // 对齐官方 pendingChapterId 语义：只宣告下一章，不立即切换
    // 下一轮 judgeAndAdvance 的 phase0 会检测到 pendingChapterId 并执行真正切换
    const nextIdx = idx + 1;
    if (nextIdx >= chapters.length) {
      // 故事完结：直接切换（无下一章，不需要延迟语义）
      progress.storyCompleted = true;
      progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
      progress.currentChapterIndex = nextIdx;
      progress.updatedAt = Date.now();
      setProgress(progress);
      syncChapterIndex(nextIdx);
      tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
      try {
        await tavo.message.append({
          content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
          hidden: false,
        });
      } catch (e) {}
    } else {
      // 有下一章：设置 pendingChapterId（本轮宣告，下轮生效）
      progress.pendingChapterId = nextIdx;
      progress.updatedAt = Date.now();
      setProgress(progress);
      console.log('[event_manager][tf_story_game][judge] chapter success: pendingChapterId=' + nextIdx + ' (will switch next round)');
      tavo.utils.toast('✅ 第 ' + (idx + 1) + ' 章完成！下一章将在下一轮对话开始时切换');
    }
  }

}

async function getAllMessagesText() {
  try {
    const count = await tavo.message.count();
    if (!count) return '';
    const msgs = await tavo.message.find([0, Math.min(count, 30) - 1]);
    let _charMap = {};
    try {
      const _chat = await tavo.chat.current();
      for (const c of ((_chat && _chat.characters) || [])) {
        if (c && c.id !== undefined && c.name) _charMap[c.id] = c.name;
      }
    } catch (_e) {}
    return (msgs || []).map(m => {
      let name = 'NPC';
      if (m.role === 'user') name = '用户';
      else if (m.role === 'assistant' && m.characterId !== undefined && _charMap[m.characterId]) name = _charMap[m.characterId];
      return name + '：' + (m.content || '');
    }).join('\n');
  } catch (e) { return ''; }
}

async function getMemoryItems() {
  try {
    const mem = readChatVar('tmm');
    const player = (mem && mem.cards && mem.cards.player) || {};
    return [...(player.items || []), ...((mem.meta && mem.meta.facts) || [])];
  } catch (e) { return []; }
}

// =========================================================================
// 故事数据读写
// =========================================================================

function defaultEditData() {
  console.log('[event_manager][tf_story_game] │ ？？？ 获取默认编辑数据，请检查检查故事数据异常！！！');
  return {
    intro: '', globalBackground: '',
    chapters: [{ title: '第 1 章', openingRole: '旁白', openingLine: '。。。', background: '', content: '', successCondition: '', conditionVisible: true, entryCondition: '', musicAutoPlay: false }],
  };
}

async function syncEditToWorldbook(edit) {
  const chat = await tavo.chat.current();
  if (!chat || !chat.lorebooks?.length) return { ok: true, count: 0 };
  const lbId = chat.lorebooks[0].id;
  const lb = await tavo.lorebook.get(lbId);
  if (!lb) return { ok: false, msg: '读取世界书失败' };
  const kept = (lb.entries || []).filter(e => !/^【简介】|^【全局背景】/.test(e.content || ''));
  const rebuilt = [];
  if (edit.intro) rebuilt.push({ name: '故事简介', content: '【简介】' + edit.intro, strategy: 'constant', enabled: true });
  if (edit.globalBackground) rebuilt.push({ name: '全局背景', content: '【全局背景】' + edit.globalBackground, strategy: 'constant', enabled: true });
  try {
    await tavo.lorebook.update({ id: lbId, name: lb.name, entries: [...kept, ...rebuilt] });
    return { ok: true, count: rebuilt.length };
  } catch (e) { return { ok: false, msg: String(e && e.message || e) };
  }
}

function getEdit() {
  // 读 chat scope（tf_story.edit）→ fallback 读 global scope（tf_story_db_{chat_id}.edit）
  let v = readChatVar(ns('edit'));
  if (!(v && typeof v === 'object')) {
    try {
      let g = tavo.get(nsGlobal('edit'), 'global');
      let guard = 0;
      while (g && typeof g === 'object' && g.found !== undefined && 'value' in g && guard < 5) { g = g.value; guard++; }
      if (g && typeof g === 'object') v = g;
    } catch (e) {}
  }
  if (!(v && typeof v === 'object')){
    console.error('[event_manager][tf_story_game] │ ？？？getEdit 数据异常！！！');
  }
  return (v && typeof v === 'object') ? v : defaultEditData();
}
function setEdit(edit) {
  // tf_story.edit 只写 chat scope�88reset 时会被清，需要恢刷新读 global 进来）
  // 静态数据（intro/globalBackground/chapters/runtimeOutline）只存 global scope: tf_story_db_{chatId}.edit
  console.log('[event_manager][tf_story_game][setEdit][tf_story]');
  try { tavo.set(ns('edit'), edit, 'chat'); return true; } catch (e) { return false; }
}

function isValidChapter(ch) {
  return ch && typeof ch === 'object'
    && typeof ch.title === 'string'
    && typeof ch.content === 'string'
    && typeof ch.openingRole === 'string';
}

// =========================================================================
// Boot Controller（启动控制器）-- 完全接管官方启动行为
// =========================================================================
// 五种会话状态（对齐你的设计）：
//   uninitialized       - 首次打开聊天，静态数据全空（global 也没有）
//   reset               - 重启聊天（global 有数据，chat 为空）
//   resumption_start    - 继聊开始（chat 有消息，boot 序列启动）
//   data_loaded         - 数据已加载（静态恢复 + 动态重建完成）
//   ready               - 数据已加载 + 开场白已播报，编排可接管
// 流程：
//   uninitialized | reset | resumption_start -> 加载数据 -> data_loaded -> 播开场白 -> ready
// 任何阶段失败/未 ready 时阻断官方自动发言
const BOOT_NS = 'tf_story.boot';
const BOOT_STAGES = ['uninitialized', 'reset', 'resumption_start', 'data_loaded', 'ready'];
let _bootState = 'uninitialized'; // 内存态镜像
let _bootGuard = 0;              // 并发保护
let _bootStage = '';              // 当前阶段文字描述（给 UI 显示）

function readBoot() {
  const v = readVarAnyScope(BOOT_NS);
  return (v && typeof v === 'object') ? v : { status: 'uninitialized', chatId: null, openedAt: 0, openingDone: false, stage: 'uninitialized' };
}
function writeBoot(b) {
  console.log('[event_manager][tf_story_game][writeBoot] [tf_story.boot]: ' + JSON.stringify(b));
  // boot 状态必须写 global scope，否则 tavo_chat_reset 后丢失，无法感知「已就绪」
  try { tavo.set(BOOT_NS, b, 'global'); } catch (e) {}
  // 同时写 chat scope 用于 hot read
  try { tavo.set(BOOT_NS, b, 'chat'); } catch (e) {}
  _bootState = b.status || 'uninitialized';
  _bootStage = b.stage || b.status || '';
}

// 通知 htmlFragment 更新加载遮罩（如果已挂载）
function notifyBootStage(stage, detail) {
  try {
    var el = document.getElementById('tf-boot-stage');
    if (el) el.textContent = detail || stage;
    var se = document.getElementById('tf-boot-session');
    if (se && stage) se.textContent = '会话：' + stage;
    var overlay = document.getElementById('tf-boot-overlay');
    if (overlay) overlay.style.display = (stage === 'ready') ? 'none' : 'flex';
  } catch (e) {}
}

// 恢复静态数据：global -> chat（tavo_chat_reset 清了 chat，global 是权威备份）
function restoreStaticData() {
  // 只恢复 tf_story.edit（chat scope），原数据在 tf_story_db_{chatId}.edit（global scope）
  const chat = ns('edit');
  const globalName = nsGlobal('edit');
  try {
    const cv = readChatVar(chat);
    if (cv && typeof cv === 'object' && Object.keys(cv).length) return false; // chat 已有数据
    let g = tavo.get(globalName, 'global');
    let guard = 0;
    while (g && typeof g === 'object' && g.found !== undefined && 'value' in g && guard < 5) { g = g.value; guard++; }
    // 只有 chapters 数组有实质内容才恢复
    if (g && typeof g === 'object' && Array.isArray(g.chapters) && g.chapters.length > 0) {
      tavo.set(chat, g, 'chat');
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[event_manager][tf_story_game][restore] error: ' + (e && e.message));
    return false;
  }
}

// 重建动态数据（对齐 Toonflow「重启聊天 = 动态数据重新生成」）：
// tf_progress 若丢失 -> 按静态章节重新生成；tmm 记忆丢失 -> 重新初始化
function rebuildDynamicData() {
  let rebuilt = false;
  // tf_progress
  let prog = readVarAnyScope(progressNs());
  const edit = readVarAnyScope(ns('edit')) || defaultEditData();
  const chapters = edit.chapters || [];
  if (!prog || typeof prog !== 'object' || !Array.isArray(prog.completedChapters)) {
    prog = defaultProgress();
    // 优先读 chapter.runtimeOutline.phases（sync 阶段预解析），fallback 才用 parseProgress
    if (chapters.length) {
      const ch0 = chapters[0];
      prog.runtimeOutline = (ch0 && ch0.runtimeOutline && Array.isArray(ch0.runtimeOutline.phases) && ch0.runtimeOutline.phases.length)
        ? ch0.runtimeOutline
        : parseProgress(ch0.content || '');
      // 指针：保留已有（如果在新 outline 里找得到），否则 fallback 到首个未完成 phase
      const phases0 = prog.runtimeOutline.phases || [];
      let keep0 = prog.currentPhaseId ? phases0.find(p => p.id === prog.currentPhaseId) : null;
      if (!keep0) {
        keep0 = phases0.find(p => !isPhaseCompleted(prog, p.id)) || phases0[0] || null;
      }
      if (keep0) {
        let keepSt0 = (keep0.stages || []).find(s => !isStageCompleted(prog, keep0.id, s.id)) || (keep0.stages || [])[0] || null;
        prog.currentPhaseId = keep0.id;
        prog.currentStageId = keepSt0 ? keepSt0.id : null;
      } else {
        prog.currentPhaseId = null;
        prog.currentStageId = null;
      }
    }
    setProgress(prog);
    rebuilt = true;
  } else if (!prog.runtimeOutline || !prog.runtimeOutline.phases || !prog.runtimeOutline.phases.length) {
    // progress 在但 runtimeOutline 空（换章后）-> 从 chapter.runtimeOutline 重读
    const idx = Math.min(prog.currentChapterIndex || 0, Math.max(chapters.length - 1, 0));
    if (chapters[idx]) {
      const ch = chapters[idx];
      prog.runtimeOutline = (ch && ch.runtimeOutline && Array.isArray(ch.runtimeOutline.phases) && ch.runtimeOutline.phases.length)
        ? ch.runtimeOutline
        : parseProgress(ch.content || '');
      const phasesCh = prog.runtimeOutline.phases || [];
      let keepCh = prog.currentPhaseId ? phasesCh.find(p => p.id === prog.currentPhaseId) : null;
      if (!keepCh) {
        keepCh = phasesCh.find(p => !isPhaseCompleted(prog, p.id)) || phasesCh[0] || null;
      }
      if (keepCh) {
        let keepStCh = (keepCh.stages || []).find(s => !isStageCompleted(prog, keepCh.id, s.id)) || (keepCh.stages || [])[0] || null;
        prog.currentPhaseId = keepCh.id;
        prog.currentStageId = keepStCh ? keepStCh.id : null;
      } else {
        prog.currentPhaseId = null;
        prog.currentStageId = null;
      }
      setProgress(prog);
      rebuilt = true;
    }
  }
  return rebuilt;
}

// 官方劫持检测：boot ready 之前落地的 assistant 消息 = 官方自动开场发言 -> 删
async function purgeOfficialHijack() {
  try {
    const count = await tavo.message.count();
    if (!count) return 0;
    const msgs = await tavo.message.find([0, Math.min(count, 20) - 1]);
    let deleted = 0;
    for (const m of (msgs || [])) {
      if (m && m.role === 'assistant' && !(m.hidden)) {
        // 只删 boot 期间产生的（boot 标记存在之前的旧消息不动）
        const boot = readBoot();
        if (boot.status === 'ready' && boot.openingDone) break; // 已就绪：不删
        try { await tavo.message.delete(m.id); deleted++; } catch (e) {}
      }
    }
    return deleted;
  } catch (e) { return 0; }
}


// 开场白完整流程（对齐 开场白.md 设计）
// 流程：故事初始化开始 → 禁止和清理tavo开场白 → 故事初始化完毕 → 
//       获取开场白配置 → 调用发言插件生成台词 → 语音生成 → 语音播放 → 进入编排
async function story_start_init(boot) {
    try {
          //    禁止和清理 tavo 自己的开场白
          //    切换到 natural 模式 + 清空 overrideScenario，阻断官方 scenario 开场
          try {
            await _retry(() => tavo.chat.update({ responseMode: 'natural', overrideScenario: '' }), 'step0 chat.update', 4);
            console.log('[event_manager][tf_story_game] │ ✅ 已禁止和清理tavo自己的开场白');
          } catch (e) {
            console.warn('[event_manager][tf_story_game][opening] 禁止开场白失败', e);
          }

          // 3. 故事初始化完毕
          console.log('[event_manager][tf_story_game] │ ✅ 故事初始化完毕');
          // 注意：openingDone 不能用于判断开场白是否完成，如果false ，生成的开场白会被删除
          boot.openingDone = true;
          boot.status ='ready';
          // 写到 boot 对应的tavo 变量
          writeBoot(boot);
          console.log('[event_manager][tf_story_game] message:added！！！status{}, openingDone{}",', boot.status, boot.openingDone);
    } catch (e) {}
}


async function playChapterOpening(boot) {
  console.log('[event_manager][tf_story_game] ─── 开场白流程 ──────────────────────────');
  // 1. 找到当前章节的开场白配置
  const ch = await getCurrChapter();
  console.log('[event_manager][tf_story_game] │ ✅ 找到当前章节的开场白配置 ch:', ch);
  if (!ch) return 0;

  const role = ch.openingRole || '旁白';
  let text = ch.openingLine || '';

  console.log('[event_manager][tf_story_game] │ ✅ 获取开场白: $openingRole="' + role + '" $openingText="' + (text.slice(0, 40) || '(空)') + '"');

    // 5. 调用发言插
  if (!text) {
      console.log(ch);
       text="进入故事";
      console.log('[event_manager][tf_story_game] error 播放开场白失败，开场白内容为空,策略：依然发送给发言器',text);

  }

  console.log('[event_manager][tf_story_game] ─── 开场白流程-通知发言器 ──────────────────────────');
  // 委托发言插件处理：window.tf_story_emit 触发，speaker 用 window.tf_story_on 监听
  window.tf_story_emit('opening', { role: role, text: text });
  console.log('[event_manager][tf_story_game]  sent window.tf_story_emit  opening',window.tf_story_emit);
  // 3. 返回播了几条（speaker 插件 append 后才算）
  return 1;
}
async function getCurrChapter(){
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const progress = getProgress();

    const idx = Math.min(progress.currentChapterIndex || 0, chapters.length - 1);
    console.log("[tf_story_game]| 获取当前章节索引 progress:", progress.currentChapterIndex);
    return  chapters[idx];
}

// chat:opened 触发时 tavo 内部可能未 ready，报 "internal error, try again"
// 重试 3 次，每次间隔 500ms
async function _retry(fn, label, maxTries) {
  let lastErr = null;
  for (let i = 1; i <= maxTries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e && e.message) || String(e);
      const retriable = /internal error|try again|could not complete|not ready/i.test(msg);
      if (!retriable || i === maxTries) throw e;
      console.warn('[event_manager][tf_story_game] ' + label + ' retry ' + i + '/' + (maxTries-1) + ': ' + msg);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

// =========================================================================
// 遮蔽层 + 开始按钮
// =========================================================================
let _startBtnEl = null;

function showStartButton(start_story) {
  hideStartButton(); // 防止重复
  // 隐藏 HTML 模板里的 boot 遮蔽层（避免和 start-overlay 叠加出现两层遮蔽）
  try { document.getElementById('tf-boot-overlay').style.display = 'none'; } catch (e) {}

  const overlay = document.createElement('div');
  overlay.id = 'tf-story-start-overlay';
  overlay.style.cssText = [
    'position:fixed','top:0','left:0','right:0','bottom:0',
    'background:rgba(0,0,0,0.88)','z-index:9999',
    'display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'font-family:"PingFang SC","Microsoft YaHei",sans-serif',
    'pointer-events:all',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = '第 1 章';
  title.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.55);letter-spacing:4px;margin-bottom:10px;';

  const name = document.createElement('div');
  name.textContent = '穿越成山大王';
  name.style.cssText = 'font-size:28px;font-weight:700;color:#fff;letter-spacing:3px;margin-bottom:60px;';

  const btn = document.createElement('button');
  btn.textContent = '开始';
  overlay.id = 'tf-story-start-btn';
  btn.class ='tf-story-start-btn';
  btn.style.cssText = [
    'padding:14px 64px','font-size:18px','font-weight:700',
    'color:#fff','background:linear-gradient(135deg,#e8c97a,#c9943a)',
    'border:none','border-radius:40px','cursor:pointer',
    'letter-spacing:6px','transition:all 0.2s ease',
    'box-shadow:0 4px 20px rgba(200,148,58,0.4)',
  ].join(';');
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.06)';
    btn.style.boxShadow = '0 6px 28px rgba(200,148,58,0.6)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 4px 20px rgba(200,148,58,0.4)';
  });

  overlay.appendChild(title);
  overlay.appendChild(name);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
  _startBtnEl = overlay;

  btn.addEventListener('click', function onClick() {
    btn.removeEventListener('click', onClick);
    // 淡出
    overlay.style.transition = 'opacity 0.5s ease';
    overlay.style.opacity = '0';
    // setTimeout(() => { hideStartButton(); if (onStart) onStart(); }, 500);
    setTimeout(() => { hideStartButton(); if (start_story) start_story(); }, 500);
  });
}


function hideStartButton() {
  if (_startBtnEl && _startBtnEl.parentNode) {
    _startBtnEl.parentNode.removeChild(_startBtnEl);
  }
  _startBtnEl = null;
}

// =========================================================================
// Boot 序列
// =========================================================================

// 完整 Boot 序列（5 阶段：uninitialized/reset/resumption_start -> data_loaded -> ready）
async function bootSequence() {
  const myGuard = ++_bootGuard;
  console.log('[event_manager][tf_story_game][boot] start, myGuard=' + myGuard);
  let chatId = null;
  console.log('[event_manager][tf_story_game][boot] 1 tavo.chat.curren');
  try { const c = await tavo.chat.current(); chatId = c && c.id; console.log('[event_manager][tf_story_game][boot] chatId=' + chatId); } catch (e) { console.warn('[event_manager][tf_story_game][boot] chat.current failed', e); }
  _currentChatId = chatId;

  // 0) 立刻切到 natural 模式 + 清空 overrideScenario，阻断官方 scenario 默认开场
  // chat:opened 触发时 tavo 内部可能未 ready，报 "internal error, try again"，重试
  console.log('[event_manager][tf_story_game][boot] 2 tavo.chat.update');
  try {
    await _retry(() => tavo.chat.update({ responseMode: 'natural', overrideScenario: '' }), 'step0 chat.update', 4);
    console.log('[event_manager][tf_story_game][boot] step0 natural mode set');
  } catch (e) { console.warn('[event_manager][tf_story_game][boot] step0 chat.update failed', e); }

  console.log('[event_manager][tf_story_game][boot] 3 readBoot');
  const boot = readBoot();
  let count = 0;
  try {
    count = await _retry(() => tavo.message.count(), 'message.count', 4);
    console.log('[event_manager][tf_story_game][boot] message count=' + count);
  } catch (e) { console.warn('[event_manager][tf_story_game][boot] count failed', e); }

  console.log('[event_manager][tf_story_game][boot] 4 readChatVar');
  // 关键判定：chat_reset 清空 chat scope 变量但保留 global。
  // 「chat scope 的 boot 镜像是否还在」是判断「是否刚 reset」的可靠信号：
  //   - chat boot 丢失 + global 数据在       => 刚 reset（reset 后 tavo 可能自动插 1 条消息，count 不可靠）
  //   - chat boot 在 + status ready + 有消息 => 正常继聊
  //   - global 数据都没有                    => 全新故事
  let sessionStage;
  const chatBoot = readChatVar(BOOT_NS);
  const globalHasData = (() => {
    // 读 global 的 tf_story_db_{chat_id}.edit（带 chat_id）
    const editVar = chatId ? ('tf_story_db_' + chatId + '.edit') : 'tf_story.edit';
    const gv = (() => { try { let g = tavo.get(editVar, 'global'); let i=0; while (g && typeof g==='object' && 'value' in g && i<5){g=g.value;i++;} return g; } catch(e){return null;} })();
    return !!(gv && typeof gv === 'object' && Array.isArray(gv.chapters) && gv.chapters.length);
  })();

  if (!globalHasData) {
    sessionStage = 'uninitialized';            // 故事从未初始化（global 空）
  } else if (!chatBoot) {
    sessionStage = 'reset';                    // 刚 reset：chat boot 被清，global 还在
  } else if (chatBoot.status === 'ready' && count > 0) {
    sessionStage = 'resumption_start';         // 正常继聊
  } else {
    sessionStage = 'reset';                    // 兜底：global 有数据但状态异常
  }
  console.log('[event_manager][tf_story_game][boot] sessionStage=' + sessionStage + ' globalHasData=' + globalHasData + ' chatBoot=' + (chatBoot ? chatBoot.status : 'null') + ' count=' + count);

  writeBoot({ status: 'loading', stage: sessionStage, chatId, openedAt: Date.now(), openingDone: false, sessionType: sessionStage });
  notifyBootStage(sessionStage, '检测会话：' + sessionStage);

  const restored = restoreStaticData();
  console.log('[event_manager][tf_story_game][boot][restoreStaticData] restored=' + restored);
  notifyBootStage(sessionStage, '恢复静态数据' + (restored ? '（global -> chat）' : '（无 global 备份）'));

  const rebuilt = rebuildDynamicData();
  console.log('[event_manager][tf_story_game][boot] rebuilt=' + rebuilt);

  if (sessionStage !== 'resumption_start') {
    const purged = await purgeOfficialHijack();
    if (purged > 0) console.log('[event_manager][tf_story_game][boot] purged ' + purged + ' official hijack');
  }

  writeBoot({ status: 'loading', stage: 'data_loaded', chatId, openedAt: Date.now(), openingDone: false, sessionType: sessionStage, restored, rebuilt });
  notifyBootStage('data_loaded', '数据已加载，准备开场白…');

  // 编排模式必须在开场白之前应用（speaker 插件的 generation:prepare 需要读到 orchestration='plugin'）
  if (sessionStage !== 'resumption_start') {
    await applyOrchestrationMode();
  }

  if (sessionStage !== 'resumption_start') {
    // 非继聊：先显示遮蔽层 + 开始按钮，等用户点击后再触发开场白
    _bootState = 'waiting_start';
    notifyBootStage('waiting_start', '点击「开始」进入第一章');

    setTimeout(() => {
          // start_story fun
          showStartButton(function () {
            console.log('[event_manager][tf_story_game][boot] 用户点击开始，触发开场白…');
            _bootState = 'opening';
            // notifyBootStage('opening', '开场白生成中…');
            const boot = readBoot();

            writeBoot(boot);
            _bootState = 'ready';
            notifyBootStage('ready', '故事已就绪');
            // setTimeout(function () { notifyBootStage('ready', ''); }, 400);
            story_start_init(boot);

            // 注意：openingDone 不能用于判断开场白是否完成，如果false ，生成的开场白会被删除
            setTimeout(function () {
               console.log('[event_manager][tf_story_game][boot] playChapterOpening start...');
               playChapterOpening(boot).then(played => {
               console.log('[event_manager][tf_story_game][boot] playChapterOpening result=' + played);
              // 开场白执行完毕后再标记 openingDone=true，防止提前返回
             }).catch(e => { console.warn('[event_manager][tf_story_game][boot] playChapterOpening failed', e); });
            }, 400);

          });

      }, 500);

  }

  // openingDone：reset/uninitialized 等按钮点击后再写（在 playChapterOpening.then 里）
  // resumption_start 直接写（开场白已由历史消息承载，openingDone 在上一轮已设为 true 或直接跳到这里）
  if (sessionStage === 'resumption_start') {
    const finalBoot = { status: 'ready', stage: 'ready', chatId, openedAt: Date.now(), openingDone: true, sessionType: sessionStage, restored, rebuilt, readyAt: Date.now() };
    writeBoot(finalBoot);
    _bootState = 'ready';
    notifyBootStage('ready', '故事已就绪');
    setTimeout(function () { notifyBootStage('ready', ''); }, 400);
  }

  console.log('[event_manager][tf_story_game][boot] DONE sessionType=' + sessionStage + ' restored=' + restored + ' rebuilt=' + rebuilt);

  return sessionStage;
}

// boot 未就绪时拦截所有生成（阻止官方开场白/第一个角色自动发言）
// 注意：_bootState='opening' 时不拦截，放行给 speaker 插件接管开场白生成
_safeOn('generation:prepare', async (event) => {
  if (_bootState !== 'ready' && _bootState !== 'opening') {
    try { event.text = ''; } catch (e) {}
    return;
  }
  // tmm 就绪检查：只打日志，不再阻断（插件加载顺序不确定，阻断会导致编排永远无法启动）
  const tmm = readChatVar('tmm');
  if (!tmm || typeof tmm !== 'object' || !('summary' in tmm)) {
    console.warn('[event_manager][tf_story_game][gen:prepare] tmm not ready yet (memory_manager still initializing)');
    // 不再阻断生成！让编排继续
  } else {
    console.log('[event_manager][tf_story_game][gen:prepare] tmm ready, generation allowed');
  }
});

// 官方首条消息落地即删（message:added 里做二次保险）
_safeOn('message:added', async (event) => {
  const msg = event && event.message;
  if (!msg || msg.role !== 'assistant') return;
  const boot = readBoot();
  // boot ready 且开场白已播 -> 正常消息
  console.log('[event_manager][tf_story_game] message:added！！！status{}, openingDone{}",', boot.status, boot.openingDone);
  if (boot.status === 'ready' && boot.openingDone === true) return;
  // 否则视为官方劫持 -> 删除
  // 但要小心：我们自己的 playChapterOpening 也会 append assistant 消息，
  // 用 openingDone 标记区分（playChapterOpening append 前先标记后写入会来不及，
  // 所以 append 前先把内存 _bootState 设为 opening）
  if (_bootState === 'opening') return; // 自己的开场白
  try {
    await tavo.message.delete(msg.id);
    console.log('[event_manager][tf_story_game] deleted official hijack message！！！', msg.id);
  } catch (e) {}
});

_safeOn('chat:opened', async () => {
  // Boot 序列接管：数据恢复 -> 官方劫持清理 -> 开场白 -> 编排应用
  console.log('[event_manager][tf_story_game] Boot 序列接管：数据恢复 -> 官方劫持清理 -> 开场白 -> 编排应用');
  await bootSequence();

  // 章节修复（仅补全缺失字段，绝不清空/丢弃已有章节 —— 静态故事数据受保护）
  const cur = getEdit();
  let repaired = false;
  if (cur.chapters && cur.chapters.length) {
    cur.chapters = cur.chapters.map((ch) => {
      const c = (ch && typeof ch === 'object') ? { ...ch } : { title: '未命名章节' };
      if (typeof c.title !== 'string' || !c.title) { c.title = '未命名章节'; repaired = true; }
      if (typeof c.content !== 'string') { c.content = ''; repaired = true; }
      if (typeof c.openingRole !== 'string') { c.openingRole = '旁白'; repaired = true; }
      if (typeof c.openingLine !== 'string') c.openingLine = '';
      if (typeof c.successCondition !== 'string') c.successCondition = '';
      if (typeof c.background !== 'string') c.background = '';
      if (!Array.isArray(c.events)) c.events = [];
      return c;
    });
    if (repaired) setEdit(cur);
  }

  // lineCount 只读 tf_story_setting.edit，不写回 _edit

  // 进度时间戳更新（不重置章节进度等动态数值，仅刷新时间）
  const progress = getProgress();
  progress.updatedAt = Date.now();
  setProgress(progress);
  console.log('[event_manager][tf_story_game] Boot 序列接管：数据恢复 -> 官方劫持清理 -> 开场白 -> 编排应用 end');
});

// 判定器入口：每轮对话后评估章节结局（仅 boot ready 后生效）
_safeOn('message:added', async (event) => {
  if (!event || !event.message) return;
  const msg = event.message;
  console.log('[event_manager][tf_story_game][msg:added] role=' + msg.role + ' content=' + JSON.stringify((msg.content||'').slice(0,60)));
  if (msg.role !== 'user') return; // 只在用户发言后判定
  // boot 未完成时不判定（避免官方劫持阶段误判）
  const boot = readBoot();
  console.log('[event_manager][tf_story_game][msg:added] ★ 用户发言 boot.status=' + (boot&&boot.status) + ' openingDone=' + (boot&&boot.openingDone));
  if (!boot || boot.status !== 'ready' || !boot.openingDone) {
    console.warn('[event_manager][tf_story_game][msg:added] ✗ judge blocked: boot not ready');
    return;
  }
  try {
    let count = 0;
    try { count = await tavo.message.count(); } catch (e) {}

    // ===== 全链路 TRACE LOG =====
    const progress = getProgress();
    const edit = getEdit();
    const chapters = edit.chapters || [];
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx] || null;
    const phases = progress.phases || [];
    const phaseIdx = Math.max(0, progress.currentPhase || 0);
    const eventIdx = Math.max(0, progress.currentEvent || 0);
    const curPhase = phases[phaseIdx] || null;
    const curEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx] || null) : null;
    const nextEvent = (curPhase && curPhase.events) ? (curPhase.events[eventIdx + 1] || null) : null;

    console.log('[event_manager]══════════════════════════════════════════');
    console.log('[event_manager][tf_story_game] ┌─── 全链路 TRACE ───────────────────');
    console.log('[event_manager][tf_story_game] │ 📝 用户输入: ' + JSON.stringify((msg.content||'').slice(0,80)));
    console.log('[event_manager][tf_story_game] │ 📚 章节状态: 第' + (idx+1) + '/' + chapters.length + '章'
      + (chapter ? '「' + chapter.title + '」' : '(无)'));
    if (chapter && chapter.successCondition) {
      console.log('[event_manager][tf_story_game] │ 📋 完成条件: ' + chapter.successCondition.slice(0,100));
    }
    console.log('[event_manager][tf_story_game] │ 📊 事件进度: Phase=' + phaseIdx + '(' + (curPhase?curPhase.name:'无') + ')'
      + ' / Event=' + eventIdx + '(' + (curEvent?curEvent.name:'无') + ')'
      + ' / next=' + (nextEvent?nextEvent.name:'无'));
    console.log('[event_manager][tf_story_game] │    phases总数=' + phases.length
      + ' completedChapters=[' + (progress.completedChapters||[]).map(i=>i+1).join(',') + ']'
      + ' pendingChapterId=' + progress.pendingChapterId
      + ' storyCompleted=' + progress.storyCompleted
      + ' freeMode=' + progress.sessionFreeMode);
    console.log('[event_manager][tf_story_game] │ 🔄 触发: judgeAndAdvance (messageCount=' + count + ')');
    console.log('[event_manager][tf_story_game] └─────────────────────────────────────');

    await judgeAndAdvance({ content: msg.content || '', messageCount: count });

    // ===== judgeAndAdvance 完成后 TRACE =====
    const progressAfter = getProgress();
    const phasesAfter = progressAfter.phases || [];
    const phaseIdxAfter = Math.max(0, progressAfter.currentPhase || 0);
    const eventIdxAfter = Math.max(0, progressAfter.currentEvent || 0);
    const curPhaseAfter = phasesAfter[phaseIdxAfter] || null;
    const curEventAfter = (curPhaseAfter && curPhaseAfter.events) ? (curPhaseAfter.events[eventIdxAfter] || null) : null;
    console.log('[event_manager]══════════════════════════════════════════');
    console.log('[event_manager][tf_story_game] ┌─── judgeAndAdvance 结果 ─────────────');
    console.log('[event_manager][tf_story_game] │ ✅ 章节: ' + (idx+1) + '/' + chapters.length
      + (progressAfter.pendingChapterId ? ' → pending切第' + (progressAfter.pendingChapterId+1) + '章' : '')
      + (progressAfter.storyCompleted ? ' 故事完结!' : ''));
    console.log('[event_manager][tf_story_game] │ 📊 事件进度(后): Phase=' + phaseIdxAfter + '(' + (curPhaseAfter?curPhaseAfter.name:'无') + ')'
      + ' / Event=' + eventIdxAfter + '(' + (curEventAfter?curEventAfter.name:'无') + ')');
    console.log('[event_manager][tf_story_game] │    pendingChapterId=' + progressAfter.pendingChapterId
      + ' failedAttempts=' + progressAfter.failedAttempts);
    console.log('[event_manager][tf_story_game] └─────────────────────────────────────');
    console.log('[event_manager]══════════════════════════════════════════');
  } catch (e) {
    console.warn('[event_manager][tf_story_game] judge failed', e);
  }
});

// 整章推进（对齐 judgeAndAdvance 的 success 分支 pendingChapterId 语义）
// 有下一章时设置 pendingChapterId，下一轮 judgeAndAdvance 阶段0执行真正切换
async function manualChapterAdvance(chapters, idx, progress) {
  const nextIdx = idx + 1;
  if (nextIdx >= chapters.length) {
    // 故事完结：直接切换
    progress.storyCompleted = true;
    progress.sessionFreeMode = (cfgGet('autoFreeMode', true) !== false);
    progress.currentChapterIndex = nextIdx;
    progress.currentPhase = 0;
    progress.currentEvent = 0;
    progress.completedPhases = [];
      progress.completedEvents = [];
    progress.updatedAt = Date.now();
    setProgress(progress);
    syncChapterIndex(nextIdx);
    tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));
    try {
      await tavo.message.append({
        content: '【故事完结】所有章节已完成。' + (progress.sessionFreeMode ? ' 进入自由模式，用户可继续对话，无需推进章节。' : ''),
        hidden: false,
      });
    } catch (e) {}
  } else {
    // 有下一章：设置 pendingChapterId（下一轮 judgeAndAdvance 阶段0执行真正切换）
    progress.pendingChapterId = nextIdx;
    progress.updatedAt = Date.now();
    setProgress(progress);
    const nextCh = chapters[nextIdx];
    tavo.utils.toast('✅ 第 ' + (idx + 1) + ' 章完成！下一章将在下一轮对话开始时切换');
    console.log('[event_manager][tf_story_game][manual] pendingChapterId=' + nextIdx + ' (will switch next round)');
  }
}

// 手动推进指令：@事件进度检测 下个事件 / @下个事件 / @下一个事件 / @下个章节 / @下一个章节
// 先取消原发送，再整章推进（与判定成功分支一致，确保指令真正生效）。
async function advanceManually(rawText) {
  try {
    if (cfgGet('enabled', true) === false) return;
    const progress = getProgress();
    if (progress.storyCompleted) {
      tavo.utils.toast('故事已完结（自由模式），无需推进');
      return;
    }
    const edit = getEdit();
    const chapters = edit.chapters || [];
    if (!chapters.length) { tavo.utils.toast('无章节数据'); return; }
    const idx = progress.currentChapterIndex || 0;
    const chapter = chapters[idx];
    if (!chapter) { tavo.utils.toast('无当前章节'); return; }
    await manualChapterAdvance(chapters, idx, progress);
  } catch (e) {
    console.warn('[event_manager][tf_story_game] manual advance failed', e);
    tavo.utils.toast('推进失败：' + (e && e.message ? e.message : e));
  }
}

_safeOn('input:beforeSend', async (event) => {
  if (cfgGet('enabled', true) === false) return;
  const text = String((event && event.text) || '').trim();
  (function clearInputNow() {
    try {
      if (typeof tavo.input?.set === 'function') tavo.input.set('')
      const candidates = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
      let cleared = false;
      candidates.forEach(el => {
        if (el.offsetParent !== null && !el.readOnly) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = ''; cleared = true; }
          else { el.innerText = ''; el.textContent = ''; cleared = true; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      if (cleared) console.log('[event_manager][tmm] input cleared (sync)');
    } catch (e) { /* ignore */ }
  })();

  const boot = readBoot();
  const tmm = readChatVar('tmm');
  const tmmOk = !!(tmm && typeof tmm === 'object' && ('summary' in tmm));
  console.log('[event_manager][tf_story_game][input:beforeSend] ★ _bootState=' + _bootState + ' boot.status=' + (boot && boot.status) + ' openingDone=' + (boot && boot.openingDone) + ' tmm_ok=' + tmmOk);

  // 故事加载门：boot 未 ready（数据未加载 / 开场白未播）时禁止一切用户发言
  if (_bootState !== 'ready') {
    console.log('[event_manager][tf_story_game][input:beforeSend] ✗ blocked: _bootState=' + _bootState);
    try { if (event && typeof event.cancel === 'function') event.cancel('故事加载中…'); } catch (e) {}
    tavo.utils.toast('⏳ 故事加载中，请稍候…');
    return;
  }
  if (!boot || boot.status !== 'ready' || !boot.openingDone) {
    console.log('[event_manager][tf_story_game][input:beforeSend] ✗ blocked: boot.status=' + (boot && boot.status) + ' openingDone=' + (boot && boot.openingDone));
    try { if (event && typeof event.cancel === 'function') event.cancel('故事加载中…'); } catch (e) {}
    tavo.utils.toast('⏳ 故事加载中，请稍候…');
    return;
  }

  // tmm 就绪检查：只打日志，不阻断（插件加载顺序不确定，阻断会导致用户无法发言）
  if (!tmmOk) {
    console.warn('[event_manager][tf_story_game][input:beforeSend] tmm not ready yet, proceeding anyway');
  }

  if (!/^@(事件进度检测\s*下个?事件|下个?事件|下个?章节)/.test(text)) return;
  try { if (event && typeof event.cancel === 'function') event.cancel(); } catch (e) {}
  tavo.utils.toast('事件推进指令处理中…');
  advanceManually(text).catch(err => console.warn('[event_manager][tf_story_game] manual advance failed', err));
});

// =========================================================================
// 事件进度 LLM（对齐 toonflow story-event-progress Agent）
// 替代纯 +1 规则的 advanceEventProgress，用 LLM 判断当前事件是否结束
// =========================================================================

// 对齐 toonflow fixDB.prompts.ts _PROMPT_STORY_EVENT_PROGRESS
const PROMPT_STORY_EVENT_PROGRESS = `你是事件进度检测器。你只判断"当前事件是否结束、现在进行到哪一步"，不判断章节是否成功或失败。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"
## 任务
根据当前事件、当前进度和最近 10 条台词，判断：
- 当前事件是否已经结束
- 当前事件当前应处于什么状态
- 当前事件应该如何总结当前进度
- 如果事件是要求某个角色说个台词，那么他说了给类似的台词这个事件就是结束
- 你倾向于宽松地认为事件已经结束，除非事件里有强硬的说一定要完成些什么事情。
- 如果事件是要求用户回应什么的，那么不说话也是一种回应，输入"."也是一种回应

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
"." 就是明确的发言和行动。应该判定为已完成用户发言阶段！！！
模型禁止返回类似的判定：【"reason": "当前阶段是用户发言阶段，用户虽然多次输入'.'但根据事件流程仍在等待用户做出明确的发言或行动来决定下一步方向，因此事件尚未结束，继续等待用户输入"】
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。
- 此时，\`event_status\` 应判定为 \`active\`，表示系统可以继续推进剧情，而不是 \`waiting_input\`。

## 约束
1. 只判断当前事件，不判断章节整体成败
2. 不要自己编造新剧情
3. recent_dialogue 里的"用户"才代表真实用户发言
4. 不能把单个数字误判成"输入了多次"
5. 如果事件还没达成，只能 ended=false
6. 用户输入 "." 是跳过，不是迷茫，不需要引导。

## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块。

字段固定为：
- ended: boolean
- event_status: "active" | "waiting_input" | "completed"
- progress_summary: string
- progress_facts: string[]
- reason: string

## 判定规则
- ended=true：代表当前事件已经完成，系统应切到下一个事件
- ended=false：代表当前事件仍未完成，系统继续停留在当前事件
- event_status=waiting_input：代表当前事件还需要用户输入
- event_status=active：代表当前事件仍在推进，但还没轮到用户
- event_status=completed：只在 ended=true 时使用

## 用户发言阶段完成判定（重要）
当 current_stage.label 含"用户发言"且需要判定该阶段是否完成时：
- 用户**任何**非空、非纯标点的输入都算已发言（"." 视为跳过表达，也算完成）
- 不要把"用户发言"理解为"用户必须下达具体动作指令"——表达意愿、提问、感叹、命令、沉默跳过都属于"发言"
- 用户一旦在该阶段留下任何有效输入，ended=true、event_status=active，让系统推进剧情
- 不要因为"剧情还没发生具体变化"就判定用户还没发言——那是编排师的事，不是你的事
- 若用户**连续多轮**都被判 waiting_input 但实际已多次输入，应主动结束该阶段，避免死循环

## 输出示例
{"ended":false,"event_status":"waiting_input","progress_summary":"当前事件仍在等待用户补充角色名称、性别和年龄","progress_facts":["用户尚未提供完整角色信息","当前仅完成开场引导","需要继续等待用户输入"],"reason":"当前事件目标尚未完成，仍需用户继续提供信息"}
`;

// 构建事件进度检测输入快照（对齐官方 buildEventProgressInputSnapshot）
async function buildEventProgressSnapshot(chapter, progress, latestMessageContent, latestMessageRole) {
  const phases = progress.phases || [];
  normalizePhasesEvents(phases);
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const phase = phases[phaseIdx] || {};
  const events = phase.events || [];
  const curEv = events[eventIdx] || {};
  const nextEv = events[eventIdx + 1] || null;
  const isUserPhase = /用户发言/.test(curEv.name || '');
  const isUserNode = /用户发言/.test(curEv.name || '');

  // recent_dialogue: 最近 10 条
  let recentDialogue = [];
  try {
    const cnt = await tavo.message.count();
    if (cnt > 0) {
      const msgs = tavo.message.find([Math.max(0, cnt - 10), cnt]) || [];
      // Build charIdMap
      let _charMap = {};
      try {
        const _chat = await tavo.chat.current();
        for (const c of ((_chat && _chat.characters) || [])) {
          if (c && c.id !== undefined && c.name) _charMap[c.id] = c.name;
        }
      } catch (_e) {}
      recentDialogue = msgs.map(m => {
        let role = '旁白', role_type = 'narrator';
        if (m.role === 'user') { role = '用户'; role_type = 'player'; }
        else if (m.role === 'assistant' && m.characterId !== undefined && _charMap[m.characterId]) { role = _charMap[m.characterId]; role_type = 'npc'; }
        return {
          role: role,
          role_type: role_type,
          content: String(m.content || '').replace(/<[^>]+>/g, '').slice(0, 160000000),
        };
      });
    }
  } catch (e) {}

  // current_stage（tavo 没有 runtimeOutline，简化版）
  const currentStage = {
    index: eventIdx,
    label: curEv.name || '事件',
    kind: isUserNode ? 'user' : 'scene',
    summary: curEv.name || '',
    user_speak_required: isUserNode ? true : null,
  };
  const nextStage = nextEv ? {
    index: eventIdx + 1,
    label: nextEv.name || '',
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    summary: nextEv.name || '',
  } : null;

  // next_event
  const nextEvent = nextEv ? {
    index: eventIdx + 2,
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    label: nextEv.name || '',
    summary: nextEv.name || '',
  } : null;

  // 计算 user_speak_count（用户发言轮数）
  const userSpeakCount = recentDialogue.filter(m => m.role === '用户').length;

  // 提取事件详细内容
  const eventWindow3 = extractEventContent(chapter?.content || '', phase.name || '', curEv.name || '');

  return {
     chapter: { id: chapter.id || (idx || 0), title: chapter.title || '' ,content: chapter?.content || '',},
    current_event: {
      id: curEv.id || '',
      index: eventIdx + 1,
      kind: isUserNode ? 'user' : 'scene',
      flow: isUserPhase ? 'user_phase' : 'chapter_content',
      status: isUserPhase ? 'waiting_input' : 'active',
      label: curEv.label || curEv.name || '',
      summary: (curEv.targetSummary || curEv.name || ''),
      targetSummary: curEv.targetSummary || '',
      body: curEv.body || '',
      facts: [phase.label || phase.name || '', curEv.targetSummary || curEv.name || ''].filter(Boolean),
      window: eventWindow3,
    },
    current_progress: {
      phase_id: phase.id || phase.name || '',
      phase_label: phase.label || phase.name || '',
      phase_targetSummary: phase.targetSummary || '',
      phase_index: phaseIdx,
      stage_index: eventIdx,
      total_stages: events.length,
      user_node_status: isUserPhase ? 'waiting' : 'idle',
      completed_events: [],
      user_speak_count: userSpeakCount,
      user_speak_required: isUserNode ? true : null,
    },
    current_stage: currentStage,
    next_stage: nextStage,
    next_event: nextEvent,
    phase_transition_hint: '',
    latest_message: {
      role: latestMessageRole || '用户',
      role_type: 'player',
      event_type: 'on_message',
      content: (latestMessageContent || '').replace(/<[^>]+>/g, '').slice(0, 200),
    },
    recent_dialogue: recentDialogue,
  };
}

// 调用 LLM 判断事件进度（对齐官方 evaluateEventProgressByAi）
async function evaluateEventProgressByAi(chapter, progress, latestMessageContent, latestMessageRole) {
  try {
    const snapshot = await buildEventProgressSnapshot(chapter, progress, latestMessageContent, latestMessageRole);
    const userPrompt = JSON.stringify(snapshot, null, 2);
    const llmMode = (window.tf_llm && window.tf_llm.callDirect) ? '接管' : 'tavo原生';

    const rawText = llmMode === '接管'
      ? await window.tf_llm.callDirect(PROMPT_STORY_EVENT_PROGRESS + '\n\n' + userPrompt, { maxCompletionTokens: 400 })
      : await tavo.generate(PROMPT_STORY_EVENT_PROGRESS + '\n\n' + userPrompt, { context: false, settings: { maxCompletionTokens: 400 } });

    const cleaned = (rawText || '').trim()
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<[^>]+>/g, '');
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    let jsonText = fence ? fence[1].trim() : cleaned;
    // 修复：LLM 输出 JSON 可能不完整（末尾被截断）或包含尾部注释，从第一个 { 开始解析
    if (!fence) {
      const firstBrace = jsonText.indexOf('{');
      if (firstBrace >= 0) jsonText = jsonText.slice(firstBrace);
    }
    // 容错解析：若 JSON.parse 失败，尝试正则提取关键字段
    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch (e) {
      const endedMatch = cleaned.match(/"ended"\s*:\s*(true|false)/i);
      const resultMatch = cleaned.match(/"result"\s*:\s*"([^"]+)"/);
      const statusMatch = cleaned.match(/"event_status"\s*:\s*"([^"]+)"/);
      if (endedMatch) {
        obj = {
          ended: endedMatch[1].toLowerCase() === 'true',
          event_status: statusMatch ? statusMatch[1] : 'active',
          result: resultMatch ? resultMatch[1] : 'continue',
          progress_summary: '',
          progress_facts: [],
          reason: 'parsed_fallback (incomplete JSON)',
        };
      } else if (resultMatch) {
        obj = {
          result: resultMatch[1],
          matched_rule: null,
          reason: 'parsed_fallback',
          next_chapter_id: null,
          guide_summary: '',
          guide_facts: [],
        };
      } else {
        throw e;
      }
    }
    console.log('[event_manager][tf_story_game] 🤖 [event_progress] LLM调用 → ended=' + obj.ended + ' status=' + obj.event_status);
    console.log('[event_manager][tf_story_game]    reason=' + (obj.reason || '').slice(0, 100));
    console.log('[event_manager][tf_story_game]    progress_summary=' + (obj.progress_summary || '').slice(0, 80));
    console.log('[event_manager][tf_story_game]    progress_facts=' + JSON.stringify((obj.progress_facts||[]).slice(0,3)));
    return {
      ended: !!(obj.ended),
      event_status: obj.event_status || 'active',
      progress_summary: obj.progress_summary || '',
      progress_facts: Array.isArray(obj.progress_facts) ? obj.progress_facts : [],
      reason: obj.reason || '',
    };
  } catch (e) {
    console.warn('[event_manager][tf_story_game][event_progress] LLM 调用失败，回退到规则:', e.message);
    return null;
  }
}

// =========================================================================
// 事件进度推进（纯 LLM 驱动，对齐 toonflow-game applyAiEventProgressResolution）
//
// 核心逻辑：
// 1. 每轮都调 LLM 判断当前事件是否结束（无硬编码规则）
// 2. LLM 判 ended=true → 标记 phase 完成，推进到下一个 phase
// 3. LLM 判 ended=false → 不推进
// 4. 跟踪已完成的 phase（progress.completedPhases 数组）
// =========================================================================

function _isPhaseCompleted(completedPhases, phaseName) {
  return (completedPhases || []).includes(phaseName);
}

function _markPhaseCompleted(progress, phaseIdx, phaseName) {
  if (!progress.completedPhases) progress.completedPhases = [];
  if (!progress.completedPhases.includes(phaseName)) {
    progress.completedPhases.push(phaseName);
  }
  // 同步写 phase.state = '[s]'（UI 直接读，不靠 currentPhase 推断）
  if (progress.phases && progress.phases[phaseIdx]) {
    progress.phases[phaseIdx].state = '[s]';
  }
  if (!progress.completedEvents) progress.completedEvents = [];
  const marker = 'phase:' + phaseIdx;
  if (!progress.completedEvents.includes(marker)) {
    progress.completedEvents.push(marker);
  }
}

// 找下一个未完成的 phase（跳过"非事件"和已完成的）
function _resolveNextPhase(phases, completedPhases, currentIndex) {
  for (let i = currentIndex + 1; i < phases.length; i++) {
    const p = phases[i];
    const name = p.name || '';
    if (/^非事件/.test(name)) continue;
    if (_isPhaseCompleted(completedPhases, name)) continue;
    return { phase: p, index: i };
  }
  return { phase: null, index: -1 };
}

function _isUserPhase(phase) {
  if (!phase || !phase.events) return false;
  return phase.events.some(e => /用户发言/.test(e.name || ''));
}

// 纯 LLM 驱动的事件进度推进（每轮都调 LLM，无硬编码规则）
async function applySessionUserEventProgress(chapter, progress, latestMessageContent, latestMessageRole, precomputedResolution) {
  const phases = progress.phases || [];
  if (!phases.length) return { advanced: false };

  if (!progress.completedPhases) progress.completedPhases = [];
  if (!progress.completedEvents) progress.completedEvents = [];

  let pi = Math.max(0, progress.currentPhase || 0);
  const phase = phases[pi];
  if (!phase) return { advanced: false };

  const phaseName = phase.name || '';

  // 每轮都调 LLM 判断当前事件是否结束（纯 LLM 驱动，无硬编码规则）
  const resolution = precomputedResolution || await evaluateEventProgressByAi(chapter, progress, latestMessageContent, latestMessageRole);
  if (!resolution) {
    console.log('[event_manager][tf_story_game][event_progress] LLM 不可用，事件不推进');
    return { advanced: false };
  }

    // 多条件判断（对齐 toonflow）
  const _sum2 = (resolution.progress_summary) || '';
  const _sumComplete = /(已完成.*推进至|已完成.*等待|已完成.*进入|场景.*阶段|阶段.*阶段|推进到.*阶段)/i.test(_sum2);
  if (typeof progress.vars !== 'object' || progress.vars === null) progress.vars = {};
  if (progress.vars.eventStallCount === undefined || progress.vars.eventStallCount === null) progress.vars.eventStallCount = 0;
  const _isStall2 = String(resolution.event_status || '').trim() === 'waiting_input' && !resolution.ended;
  const _newStall2 = _isStall2 ? (progress.vars.eventStallCount + 1) : 0;
  progress.vars.eventStallCount = _newStall2;
  const _stallForce2 = _newStall2 >= 5;
  if (_stallForce2) progress.vars.eventStallCount = 0;
  const _shouldAdvance2 = !!(resolution.ended || _sumComplete || _stallForce2);
  console.log('[event_manager][tf_story_game][event_progress] shouldAdvance=' + _shouldAdvance2 + ' summarySays=' + _sumComplete + ' stall=' + _newStall2);
  if (!_shouldAdvance2) {
    console.log('[event_manager][tf_story_game][event_progress] LLM ended=false (not forced): ' + (resolution.reason || '').slice(0, 80));
    return { advanced: false };
  }
  if (!resolution.ended) resolution.ended = true;

  if (resolution.ended) {

    console.log('[event_manager][tf_story_game][event_progress] LLM ended=true: ' + (resolution.reason || '').slice(0, 80));
    _markPhaseCompleted(progress, pi, phaseName);

    const next = _resolveNextPhase(phases, progress.completedPhases, pi);
    if (next.phase) {
      progress.currentPhase = next.index;
      progress.currentEvent = 0;
      const enteredUser = _isUserPhase(next.phase);
      console.log('[event_manager][tf_story_game][event_progress] 推进到 phase[' + next.index + ']="' + (next.phase.name || '') + '"' + (enteredUser ? ' (等待用户)' : ''));
      progress.updatedAt = Date.now();
      return { advanced: true, enteredUserPhase: enteredUser };
    } else {
      progress.currentPhase = phases.length;
      progress.currentEvent = 0;
      console.log('[event_manager][tf_story_game][event_progress] 所有 phase 已完成');
      progress.updatedAt = Date.now();
      return { advanced: true, enteredUserPhase: false };
    }
  }

  console.log('[event_manager][tf_story_game][event_progress] LLM ended=false: ' + (resolution.reason || '').slice(0, 80));
  return { advanced: false };
}

// =========================================================================
// 章节判定 LLM（对齐 toonflow story-chapter Agent）
// 在 evaluateChapterOutcome 基础上增强：优先用 LLM，失败时回退启发式
// =========================================================================

// 对齐 toonflow fixDB.prompts.ts _PROMPT_STORY_CHAPTER
const PROMPT_STORY_CHAPTER = `你是章节判定器。你只判断当前章节是否成功、失败或继续，以及是否进入下一章。
你只是状态机，不是剧情导演！禁止猜测用户的意图，禁止认为用户输入 "." 或无效字符是因为"迷茫"或"需要引导"。
## 任务
根据用户提供的章节信息、当前事件状态和运行态数据，判断章节是否应该结束。

## 关键规则：关于用户输入 "."
- 用户输入 "." 是一个明确的**跳过指令**。
- 它代表用户不想进行当前互动，希望剧情自动推进。
- 当检测到用户输入为 "." 时，应认为当前需要用户回应的阶段已经**被用户主动跳过并完成**。

## 特别注意
用户指的是台词（recent_dialogue）里用户： recent_dialogue 数据里的 "role": "用户"
用户输入："2", 不是代表输入了两次！！！
## 入参说明
current_event：当前事件
next_event：该章节的下一事件，用于判断是否需要引导。一般来说没有下一事件，才需要result="guide"
## 输出格式
必须只输出一个 JSON 对象，不要解释，不要代码块，不要 markdown 格式。

字段固定为：
- result: string - 只能是 "continue" /"guide"/ "success" / "failed"
- matched_rule: string | null - 命中的规则标识，未命中时为 null
- reason: string - 判定原因说明
- next_chapter_id: number | null - 下一章 ID，无则为 null
- guide_summary: string - 当 result="guide" 时的引导摘要，说明如何满足结束条件
- guide_facts: string[] - 当 result="guide" 时的引导事实列表（1-3条）

## 输出规则
- 当 result="continue" 时，无须给出 guide_summary和 guide_facts.代表的是继续该章节的事件推进
- 当 result="guide" 时，必须给出 guide_summary 和 1~3 条 guide_facts，说明下一步如何满足结束条件
- 当 result="success" 或 "failed" 时，guide_summary 置空串，guide_facts 置空数组

## 输出示例

result=guide:
{"result":"guide","matched_rule":null,"reason":"用户尚未输入名称、性别、年龄，未满足结束条件","next_chapter_id":null,"guide_summary":"需要引导用户输入角色名称、性别和年龄","guide_facts":["用户尚未提供角色基本信息","需要询问用户角色名称","需要询问用户角色性别和年龄"]}
result=continue:
{
  "result": "continue",
  "matched_rule": null,
  "reason": "当前站队场景需要用户回应西游孙悟空的提问，用户尚未完成回应，事件未完成，未达到章节完成条件",
  "next_chapter_id": null,
  "guide_summary": "暂无",
  "guide_facts": [
    "暂无"
  ]
}
`;

// 构建章节判定输入快照
// build chapter judge input snapshot (align to toonflow-game-app)
async function buildChapterJudgeSnapshot(chapter, progress, latestMessageContent, recentDialogue) {
  const phases = progress.phases || [];
  const phaseIdx = Math.max(0, progress.currentPhase || 0);
  const eventIdx = Math.max(0, progress.currentEvent || 0);
  const phase = phases[phaseIdx] || {};
  const events = phase.events || [];
  const curEv = events[eventIdx] || {};
  const nextEv = events[eventIdx + 1] || null;
  const isUserNode = /用户发言/.test(curEv.name || '');

  // ending_rules from runtimeOutline
  const runtimeOutline = chapter && chapter.runtimeOutline;
  const endingRules = runtimeOutline && runtimeOutline.endingRules ? runtimeOutline.endingRules : null;

  const nextEventInfo = nextEv ? {
    index: eventIdx + 2,
    kind: /用户发言/.test(nextEv.name || '') ? 'user' : 'scene',
    label: nextEv.name || '',
    summary: nextEv.summary || nextEv.name || '',
    transition_hint: nextEv.transitionHint || '',
  } : null;

  // read global background
  const edit = getEdit();
  const worldGlobalBackground = (edit.globalBackground || '').slice(0, 500);

  // recent_dialogue as object array (align to toonflow-game-app)
  let recentDialogueList = [];
  if (Array.isArray(recentDialogue)) {
    recentDialogueList = recentDialogue.map(item => ({
      role: item.role || 'user',
      role_type: item.role_type || (item.role === 'user' ? 'player' : 'npc'),
      content: String(item.content || '').replace(/<[^>]+>/g, '').slice(0, 160),
    })).filter(item => item.content);
  } else if (typeof recentDialogue === 'string') {
    recentDialogueList = String(recentDialogue || '').split(/\n/).filter(Boolean).slice(-10).map(line => {
      const colonIdx = line.indexOf(':');
      return {
        role: colonIdx > 0 ? line.slice(0, colonIdx).trim() : 'user',
        role_type: colonIdx > 0 ? 'npc' : 'player',
        content: colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line,
      };
    });
  }

  // current_event.status from curEv.state or progress
  const curEventStatus = curEv.state || (curEv.status || 'active');

  return {
    chapter: {
      title: chapter?.title || '未命名章节',
      completion_condition: chapter?.successCondition || null,
      ending_rules: endingRules,
      content: (chapter?.content || '').slice(0, 500),
    },
    world_intro: (edit.intro || '').slice(0, 300),
    world_global_background: worldGlobalBackground,
    current_event: {
      id: curEv.id || '',
      index: eventIdx + 1,
      kind: isUserNode ? 'user' : 'scene',
      flow: curEv.flow || 'chapter_content',
      status: curEventStatus,
      label: curEv.label || curEv.name || '',
      summary: curEv.targetSummary || curEv.summary || curEv.name || '现场',
      targetSummary: curEv.targetSummary || '',
      body: curEv.body || '',
      facts: Array.isArray(curEv.facts) ? curEv.facts : ([phase.label || phase.name || '', curEv.targetSummary || curEv.name || '']).filter(Boolean),
    },
    next_event: nextEventInfo,
    runtime_state: {
      completed_events: progress.completedEvents || [],
      message_content: String(latestMessageContent || '').replace(/<[^>]+>/g, '').slice(0, 200),
      event_type: 'on_message',
    },
    recent_dialogue: recentDialogueList,
  };
}
// 调用 LLM 判断章节结局（对齐官方 evaluateChapterOutcomeByAi）
async function evaluateChapterOutcomeByAi(chapter, progress, latestMessageContent) {
  if (!chapter) return null;
  const cond = chapter.successCondition;
  if (!cond || !String(cond).trim()) return null; // 无条件 = 不判

  try {
    // recent_dialogue（最近 10 条）
    let recentDialogue = [];
    try {
      const cnt = await tavo.message.count();
      if (cnt > 0) {
        const msgs = tavo.message.find([Math.max(0, cnt - 10), cnt]) || [];
        // Build charIdMap
        let _charMap = {};
        try {
          const _chat = await tavo.chat.current();
          for (const c of ((_chat && _chat.characters) || [])) {
            if (c && c.id !== undefined && c.name) _charMap[c.id] = c.name;
          }
        } catch (_e) {}
        recentDialogue = msgs.map(m => {
          let role = '旁白', role_type = 'narrator';
          if (m.role === 'user') { role = '用户'; role_type = 'player'; }
          else if (m.role === 'assistant' && m.characterId !== undefined && _charMap[m.characterId]) { role = _charMap[m.characterId]; role_type = 'npc'; }
          return {
            role: role,
            role_type: role_type,
            content: String(m.content || '').replace(/<[^>]+>/g, '').slice(0, 160),
          };
        });
      }
    } catch (e) {}

    const snapshot = await buildChapterJudgeSnapshot(chapter, progress, latestMessageContent, recentDialogue);
    const userPrompt = JSON.stringify(snapshot, null, 2);
    const llmMode = (window.tf_llm && window.tf_llm.callDirect) ? '接管' : 'tavo原生';

    const rawText = llmMode === '接管'
      ? await window.tf_llm.callDirect(PROMPT_STORY_CHAPTER + '\n\n' + userPrompt, { maxCompletionTokens: 400 })
      : await tavo.generate(PROMPT_STORY_CHAPTER + '\n\n' + userPrompt, { context: false, settings: { maxCompletionTokens: 400 } });

    const cleaned = (rawText || '').trim()
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<[^>]+>/g, '');
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    let jsonText = fence ? fence[1].trim() : cleaned;
    // 修复：LLM 输出 JSON 可能不完整（末尾被截断）或包含尾部注释，从第一个 { 开始解析
    if (!fence) {
      const firstBrace = jsonText.indexOf('{');
      if (firstBrace >= 0) jsonText = jsonText.slice(firstBrace);
    }
    // 容错解析：若 JSON.parse 失败，尝试正则提取关键字段
    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch (e) {
      const endedMatch = cleaned.match(/"ended"\s*:\s*(true|false)/i);
      const resultMatch = cleaned.match(/"result"\s*:\s*"([^"]+)"/);
      const statusMatch = cleaned.match(/"event_status"\s*:\s*"([^"]+)"/);
      if (endedMatch) {
        obj = {
          ended: endedMatch[1].toLowerCase() === 'true',
          event_status: statusMatch ? statusMatch[1] : 'active',
          result: resultMatch ? resultMatch[1] : 'continue',
          progress_summary: '',
          progress_facts: [],
          reason: 'parsed_fallback (incomplete JSON)',
        };
      } else if (resultMatch) {
        obj = {
          result: resultMatch[1],
          matched_rule: null,
          reason: 'parsed_fallback',
          next_chapter_id: null,
          guide_summary: '',
          guide_facts: [],
        };
      } else {
        throw e;
      }
    }
    console.log('[event_manager][tf_story_game] 🤖 [chapter_judge] LLM调用 → result=' + obj.result + ' matched_rule=' + (obj.matched_rule||'null'));
    console.log('[event_manager][tf_story_game]    reason=' + (obj.reason || '').slice(0, 120));
    if (obj.result === 'guide') {
      console.log('[event_manager][tf_story_game]    guide_summary=' + (obj.guide_summary || '').slice(0, 80));
      console.log('[event_manager][tf_story_game]    guide_facts=' + JSON.stringify((obj.guide_facts||[]).slice(0,3)));
    }
    console.log('[event_manager][tf_story_game][chapter_judge] LLM 调用 obj:', obj)
    return {
      result: obj.result || 'continue',
      matched_rule: obj.matched_rule || null,
      reason: obj.reason || '',
      next_chapter_id: obj.next_chapter_id || null,
      guide_summary: obj.guide_summary || '',
      guide_facts: Array.isArray(obj.guide_facts) ? obj.guide_facts : [],
    };
  } catch (e) {
    console.warn('[event_manager][tf_story_game][chapter_judge] LLM 调用失败，回退到启发式:', e.message);
    return null;
  }
}

// =========================================================================
// 桥接：面板 -> entry（sidebar 事件做通道）
// =========================================================================

_safeOnSide('tf-story-save-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  tavo.utils.toast('章节列表已保存（' + (edit.chapters || []).length + ' 章）');
});

_safeOnSide('tf-story-publish-edit', async () => {
  const edit = getEdit();
  if (!edit) { tavo.utils.toast('无编辑数据'); return; }
  const r = await syncEditToWorldbook(edit);
  tavo.utils.toast(r.ok ? ('已发布（' + r.count + ' 条常量）') : ('发布失败：' + r.msg));
});

_safeOnSide('tf-story-apply-mode', async () => {
  await applyOrchestrationMode();
  tavo.utils.toast('编排模式已按配置应用');
});

// 进入自由模式（剧情完结后）
_safeOnSide('tf-story-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = true;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已进入自由模式');
});

// 退出自由模式（回到正常判定）
_safeOnSide('tf-story-exit-free-mode', async () => {
  const p = getProgress();
  p.sessionFreeMode = false;
  p.updatedAt = Date.now();
  setProgress(p);
  tavo.utils.toast('已退出自由模式');
});

// 重置故事进度
_safeOnSide('tf-story-reset', async () => {
  const p = defaultProgress();
  setProgress(p);
  tavo.utils.toast('故事进度已重置');
});

// =========================================================================
// 对外 API（供其他插件如 multi_character_stage 调用）
// =========================================================================
(function () {
  try {
    if (typeof window === 'undefined') return;
    // 编排前调用：快速返回章节+事件状态，同步 tf_progress 到最新
    window.tfStoryJudge = {
      checkAndAdvance: tfStoryJudge_checkAndAdvance,
      checkChapterDone: tfStoryJudge_checkChapterDone,
      checkChapterDoneLLM: tfStoryJudge_checkChapterDoneLLM,
    };
    window.tfEventProgress = {
      advance: tfEventProgress_advance,
    };
    // 新结构 API（对齐 toonflow-game-app runtimeOutline）
    window.tfRuntime = {
      // 读最新 progress（自动派生 phases[] + currentPhase/currentEvent，供老 plugins 读）
      getProgress: () => {
        try {
          const raw = tavo.get(progressNs(), 'chat');
          let v = raw, guard = 0;
          while (v && typeof v === 'object' && v.found !== undefined && 'value' in v && guard < 5) { v = v.value; guard++; }
          if (v && typeof v === 'object') syncLegacyProgressFields(v);
          return v || null;
        } catch (e) { return null; }
      },
      // 获取当前 phase/stage（优先新指针）
      getCurrentPhaseStage: () => {
        try {
          const prog = window.tfRuntime.getProgress();
          return getCurrentPhaseStage(prog);
        } catch (e) { return { phase: null, stage: null, phaseIdx: 0, stageIdx: 0 }; }
      },
      // 推进到下一个 stage（按 currentPhaseId/currentStageId）
      advance: () => {
        try {
          const prog = window.tfRuntime.getProgress();
          if (!prog) return false;
          advanceEventProgress(prog);
          tavo.set(progressNs(), prog, 'chat');
          return true;
        } catch (e) { return false; }
      },
    };
    // 全局面板刷新函数（mcs 调用）
    window.tfStoryPanel_refresh = function(reason) {
      try {
        if (typeof window._tfPanel_refresh === 'function') {
          window._tfPanel_refresh(reason);
        } else if (typeof window.tfStoryPanel !== 'undefined' && window.tfStoryPanel.refresh) {
          window.tfStoryPanel.refresh();
        }
      } catch (e) {}
    };
    //console.log('[event_manager][tf_story_game] ✅ window.tfStoryJudge 已注册');
  } catch (e) {
    console.warn('[event_manager][tf_story_game] window.tfStoryJudge 注册失败', e);
  }
})();

(function () {
/**
 * console-tag v2.1 - TavoJS Plugin Edition (Fixed)
 * Black/Whitelist log filter based on [tag] labels
 * Compatible with TavoJS WebView (no module.exports)
 */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ConsoleTag = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // === Tag Extractor ===
  function extractTags(msg) {
    if (typeof msg !== 'string') return [];
    var tags = [];
    var idx = 0;
    while (idx < msg.length) {
      var open = msg.indexOf('[', idx);
      if (open === -1) break;
      // FIX: [ must be at current idx position.
      // If open > idx, there's non-whitespace content before [ -> stop parsing.
      if (open !== idx) break;
      var close = msg.indexOf(']', open);
      if (close === -1) break;
      var tag = msg.slice(open + 1, close).trim();
      if (tag) tags.push(tag);
      idx = close + 1;
      while (idx < msg.length && /\s/.test(msg[idx])) idx++;
    }
    return tags;
  }

  // === Wildcard Matcher ===
  function matchRule(tag, rule) {
    if (rule === '*') return true;
    if (rule === tag) return true;
    if (rule.includes('*')) {
      var regex = new RegExp('^' + rule.replace(/\*/g, '.*') + '$');
      return regex.test(tag);
    }
    return false;
  }

  function matchAny(tags, rules) {
    if (!rules || rules.length === 0) return false;
    for (var i = 0; i < tags.length; i++) {
      for (var j = 0; j < rules.length; j++) {
        if (matchRule(tags[i], rules[j])) return true;
      }
    }
    return false;
  }

  // === Levels ===
  var LEVELS = { all: 0, debug: 1, info: 2, log: 2, warn: 3, error: 4, silent: 5 };

  // === ConsoleTag Class ===
  function ConsoleTag(options) {
    options = options || {};
    this.mode = options.mode || 'blacklist';
    this.tags = Array.isArray(options.tags) ? options.tags : [];
    this.minLevel = LEVELS[options.minLevel] != null ? LEVELS[options.minLevel] : LEVELS.debug;
    this.color = options.color !== false;
    this.timestamp = !!options.timestamp;
    this.rawConsole = options.rawConsole || (typeof console !== 'undefined' ? console : {});
    this._levelColors = this._initColors();
  }

  ConsoleTag.prototype._initColors = function () {
    if (!this.color) return {};
    var isTTY = this.rawConsole.stderr && this.rawConsole.stderr.isTTY;
    if (!isTTY) return {};
    return {
      log: '\x1b[37m', info: '\x1b[36m', warn: '\x1b[33m',
      error: '\x1b[31m', debug: '\x1b[90m', timestamp: '\x1b[90m', reset: '\x1b[0m',
    };
  };

  ConsoleTag.prototype.shouldLog = function (msg, level) {
    var msgLevel = LEVELS[level] != null ? LEVELS[level] : LEVELS.info;
    if (msgLevel < this.minLevel) return false;
    if (this.tags.length > 0) {
      var tags = extractTags(msg);
      var matched = matchAny(tags, this.tags);
      if (this.mode === 'whitelist') {
        if (!matched) return false;
      } else {
        if (matched) return false;
      }
    }
    return true;
  };

  ConsoleTag.prototype._formatPrefix = function (level) {
    var colors = this._levelColors;
    var prefix = '';
    if (this.timestamp) {
      var time = new Date().toISOString().substring(11, 23);
      prefix += colors.timestamp ? colors.timestamp + time + colors.reset : time;
      prefix += ' ';
    }
    prefix += '[' + level.toUpperCase() + '] ';
    if (colors[level]) {
      prefix = colors[level] + prefix + colors.reset;
    }
    return prefix;
  };

  ConsoleTag.prototype._formatValue = function (val) {
    if (val != null && typeof val === 'object') {
      try { return JSON.stringify(val, null, 2); } catch (e) { return String(val); }
    }
    return String(val);
  };

  ConsoleTag.prototype.log = function () {
    var args = Array.prototype.slice.call(arguments);
    if (!this.shouldLog(String(args[0] || ''), 'log')) return;
    var prefix = this._formatPrefix('log');
    this.rawConsole.log(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.info = function () {
    var args = Array.prototype.slice.call(arguments);
    if (!this.shouldLog(String(args[0] || ''), 'info')) return;
    var prefix = this._formatPrefix('info');
    this.rawConsole.info(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.warn = function () {
    var args = Array.prototype.slice.call(arguments);
    if (!this.shouldLog(String(args[0] || ''), 'warn')) return;
    var prefix = this._formatPrefix('warn');
    this.rawConsole.warn(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.error = function () {
    var args = Array.prototype.slice.call(arguments);
    if (!this.shouldLog(String(args[0] || ''), 'error')) return;
    var prefix = this._formatPrefix('error');
    this.rawConsole.error(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.debug = function () {
    var args = Array.prototype.slice.call(arguments);
    if (!this.shouldLog(String(args[0] || ''), 'debug')) return;
    var prefix = this._formatPrefix('debug');
    this.rawConsole.debug(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.force = function () {
    var args = Array.prototype.slice.call(arguments);
    var prefix = this._formatPrefix('log');
    this.rawConsole.log(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.forceError = function () {
    var args = Array.prototype.slice.call(arguments);
    var prefix = this._formatPrefix('error');
    this.rawConsole.error(prefix + args.map(this._formatValue.bind(this)).join(' '));
  };

  ConsoleTag.prototype.configure = function (partial) {
    if (partial.mode !== undefined) this.mode = partial.mode;
    if (partial.tags !== undefined) this.tags = Array.isArray(partial.tags) ? partial.tags : [];
    if (partial.minLevel !== undefined) this.minLevel = LEVELS[partial.minLevel] != null ? LEVELS[partial.minLevel] : LEVELS.debug;
    if (partial.color !== undefined) { this.color = partial.color; this._levelColors = this._initColors(); }
    if (partial.timestamp !== undefined) this.timestamp = partial.timestamp;
  };

  ConsoleTag.prototype.printStatus = function () {
    var levelName = Object.keys(LEVELS).find(function (k) { return LEVELS[k] === this.minLevel; }.bind(this));
    // FIX: use this.rawConsole.log instead of console.log to avoid recursive filtering
    this.rawConsole.log('=== ConsoleTag Status ===');
    this.rawConsole.log('Mode:     ', this.mode);
    this.rawConsole.log('Tags:     ', this.tags.length ? this.tags.join(', ') : '(all)');
    this.rawConsole.log('MinLevel: ', levelName);
    this.rawConsole.log('Color:    ', this.color);
    this.rawConsole.log('Time:     ', this.timestamp);
    this.rawConsole.log('=======================');
  };

  // === Global Patch ===
  var _originalConsole = null;
  var _instance = null;

  function patchConsole(options) {
    options = options || {};
    if (!_originalConsole) {
      _originalConsole = Object.assign({}, console);
    }
    _instance = new ConsoleTag(Object.assign({}, options, { rawConsole: _originalConsole }));
    console = {
      log: function () { _instance.log.apply(_instance, arguments); },
      info: function () { _instance.info.apply(_instance, arguments); },
      warn: function () { _instance.warn.apply(_instance, arguments); },
      error: function () { _instance.error.apply(_instance, arguments); },
      debug: function () { _instance.debug.apply(_instance, arguments); },
      trace: function () {
        if (!_instance.shouldLog(String(arguments[0] || ''), 'log')) return;
        _originalConsole.trace.apply(_originalConsole, arguments);
      },
      count: function () { _originalConsole.count.apply(_originalConsole, arguments); },
      time: function () { _originalConsole.time.apply(_originalConsole, arguments); },
      timeEnd: function () { _originalConsole.timeEnd.apply(_originalConsole, arguments); },
    };
    return _instance;
  }

  function restoreConsole() {
    if (_originalConsole) {
      console = _originalConsole;
      _originalConsole = null;
      _instance = null;
    }
  }

  function getInstance() { return _instance; }

  return {
    ConsoleTag: ConsoleTag,
    create: function (options) { return new ConsoleTag(options); },
    patchConsole: patchConsole,
    restoreConsole: restoreConsole,
    getInstance: getInstance,
    extractTags: extractTags,
    matchRule: matchRule,
    LEVELS: LEVELS,
  };
});

// look at [md/currdesign/logic/logtag/logtag.md]
// var whitelist =['event_manager', 'memory_manager'];
//var blacklist =['memory_manager']
var whitelist =['_llmJudgeEventProgress'];
ConsoleTag.patchConsole({
  // mode:'whitelist'/'blacklist'
  mode: 'whitelist',
  tags: whitelist,
  minLevel: 'info',
});
//例子：
//console.log('[event_manager] ok');  // 输出
//console.log('[speaker] hello');      // 静默（白名单未命中）

// 强制输出（绕过过滤，用于关键日志）
//logger.force('[FATAL] 系统崩溃，无法恢复');
})();