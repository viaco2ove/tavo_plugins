#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MCS current_event 对齐 toonflow：读 tf_progress.phases[].events[].state"""
import subprocess

with open('plugins/toonflow_story_multi_character_stage/entry.js', encoding='utf-8') as f:
    code = f.read()

# ---- 1. 读 phase/event 状态（插在 eventFacts 定义之后） ----
OLD_EFACTS = "  const eventFacts = chapter?.content\n    ? chapter.content.split('\\n').filter(l => l.trim()).slice(0, 3).map(l => l.trim())\n    : [];\n\n  // turn_state"
NEW_EFACTS = """  const eventFacts = chapter?.content
    ? chapter.content.split('\\n').filter(l => l.trim()).slice(0, 3).map(l => l.trim())
    : [];

  // 对齐 toonflow：读 tf_progress.phases[currentPhase].events[currentEvent]
  const phases = (readChatVar('tf_progress') || {}).phases || [];
  const phaseIdx = Math.max(0, (readChatVar('tf_progress') || {}).currentPhase || 0);
  const eventIdx = Math.max(0, (readChatVar('tf_progress') || {}).currentEvent || 0);
  const phase = phases[phaseIdx] || {};
  const events = phase.events || [];
  const curEv = events[eventIdx] || {};
  const nextEv = events[eventIdx + 1] || null;
  const isUserNode = /用户发言|用户/.test(curEv.name || '');
  const evDigest = {
    index: eventIdx + 1,
    kind: isUserNode ? 'user' : 'scene',
    state: curEv.state || 'active',
    summary: (phase.title || '') + (curEv.name ? ' > ' + curEv.name : ''),
    facts: [
      phase.name || chapterTitle,
      curEv.name || '',
    ].filter(Boolean),
  };
  const nextEvInfo = nextEv ? { index: eventIdx + 2, name: nextEv.name } : null;

  // turn_state"""
if OLD_EFACTS in code:
    code = code.replace(OLD_EFACTS, NEW_EFACTS, 1)
    print("P1: phase/event reading added")
else:
    print("P1: NOT found")
    # debug
    idx = code.find('eventFacts')
    print("  'eventFacts' at", idx)
    print("  context:", repr(code[idx-5:idx+80]))

# ---- 2. prompt 里 current_event 加 eventDigest 字段 ----
# 找 "- facts: [..." 的行，在其后加 eventDigest 字段
OLD_PROMPT_FACTS = """  current_event:
- summary: "${eventSummary}"
- facts: [${eventFacts.map(f => '"' + f + '"').join(', ')}]
${freeMode ? '- flow: "free_runtime"' : ''}
- turn_state:"""
NEW_PROMPT_FACTS = """  current_event:
- summary: "${evDigest.summary || eventSummary}"
- event_index: ${evDigest.index}
- event_kind: ${evDigest.kind}
- event_state: ${evDigest.state}
- facts: [${evDigest.facts.map(f => '"' + f + '"').join(', ')}]
${nextEvInfo ? '- next_event: "' + nextEvInfo.name + '"' : ''}
${freeMode ? '- flow: "free_runtime"' : ''}

  turn_state:"""
if OLD_PROMPT_FACTS in code:
    code = code.replace(OLD_PROMPT_FACTS, NEW_PROMPT_FACTS, 1)
    print("P2: eventDigest fields added to prompt")
else:
    print("P2: OLD_PROMPT_FACTS not found")
    # debug
    idx = code.find('current_event:')
    print("  'current_event' at", idx)
    print("  next 200:", repr(code[idx:idx+300]))

with open('plugins/toonflow_story_multi_character_stage/entry.js', 'w', encoding='utf-8') as f:
    f.write(code)

r = subprocess.run(['node', '-e', 'var fs=require("fs");var c=fs.readFileSync("plugins/toonflow_story_multi_character_stage/entry.js","utf8");try{new Function(c);console.log("OK")}catch(e){console.error("ERR:"+e.message);}'], capture_output=True)
print("Syntax:", r.stdout.decode('utf-8', errors='replace').strip() or r.stderr.decode('utf-8', errors='replace').strip()[:100])