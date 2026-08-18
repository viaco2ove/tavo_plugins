#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import subprocess

with open('plugins/toonflow_story_multi_character_stage/entry.js', encoding='utf-8') as f:
    lines = f.readlines()

OUT = []
i = 0
while i < len(lines):
    line = lines[i]

    # P-A: Add extractThinking helper before "// 解析编排 JSON"
    if '// 解析编排 JSON' in line and 'extractThinking' not in lines[i-1]:
        OUT.append('      // extractThinking: MINIMAX 的 <thinking> 标签内是推理，外面是正文\n')
        OUT.append('      // 返回 { thinking: "...", body: "..." }\n')
        OUT.append("      const extractThinking = (s) => {\n")
        OUT.append("        const t = s || '';\n")
        OUT.append("        const RE = /<thinking>([\\s\\S]*?)<\\/thinking>|<thought>([\\s\\S]*?)<\\/thought>|<reasoning>([\\s\\S]*?)<\\/reasoning>|<noworking>([\\s\\S]*?)<\\/noworking>|<ciano>([\\s\\S]*?)<\\/ciano>|<talk>([\\s\\S]*?)<\\/talk>|<think>([\\s\\S]*?)<\\/think>/gi;\n")
        OUT.append("        let think = '', m;\n")
        OUT.append("        RE.lastIndex = 0;\n")
        OUT.append("        while ((m = RE.exec(t)) !== null) { think += m[1]||m[2]||m[3]||m[4]||m[5]||m[6]||m[7]||''; }\n")
        OUT.append("        const body = t.replace(RE,'').replace(/<[^>]+>/gi,'').trim();\n")
        OUT.append("        return { thinking: think.trim(), body };\n")
        OUT.append("      };\n")
        OUT.append("\n")
        OUT.append(line)
        i += 1
        continue

    # P-B: stage-2 settings (remove temperature 0.7, raise maxTokens)
    if 'temperature: 0.7' in line:
        OUT.append('        settings: { maxCompletionTokens: 1500 },\n')
        i += 1
        continue

    # P-C: stage-2 rawContent -> extractThinking
    if 'stripTags(rawContent)' in line:
        # Skip this stripTags line - we already have extractThinking above
        # (already injected by P-A when we hit this line)
        i += 1
        continue

    # P-D: console.log for rawContent -> show rawContent
    if "console.log('[mcs] 阶段二原始: ' + rawContent" in line:
        OUT.append(line)  # keep the log line
        i += 1
        continue

    # P-E: after rawContent log, inject extractThinking call
    if "[mcs] 阶段二原始" in line and 'rawContent' in line:
        # Next line should be the old content replacement - skip it
        OUT.append(line)
        i += 1
        # Next line is old content line, skip it
        if i < len(lines) and '.trim();' in lines[i]:
            i += 1
        continue

    # P-F: append block with thinking div
    if 'content: thinkingBlock + content,' in line:
        # Replace the whole block
        OUT.append("      // 台词正文单独 append，思考用可折叠 div\n")
        OUT.append("      if (thinking) {\n")
        OUT.append("        const esc = thinking.replace(/<\\/div>/gi, '&lt;/div&gt;');\n")
        OUT.append("        const block = '<div style=\"cursor:pointer;color:#888;font-size:0.85em\" onclick=\"var d=this.querySelector(String.fromCharCode(100));d.style.display=d.style.display==String.fromCharCode(39)+String.fromCharCode(110)+String.fromCharCode(111)+String.fromCharCode(110)+String.fromCharCode(101)+String.fromCharCode(39)?String.fromCharCode(39)+String.fromCharCode(98)+String.fromCharCode(108)+String.fromCharCode(111)+String.fromCharCode(99)+String.fromCharCode(107)+String.fromCharCode(39):String.fromCharCode(39)+String.fromCharCode(110)+String.fromCharCode(111)+String.fromCharCode(110)+String.fromCharCode(101)+String.fromCharCode(39)>"思考...<div style=\"display:none;padding:8px 0;color:#666\">' + esc + '</div></div>';\n")
        OUT.append("        await tavo.message.append({ role: 'assistant', characterId: charId || undefined, characterName: speaker, content: block + content, hidden: false });\n")
        OUT.append("      } else {\n")
        OUT.append("        await tavo.message.append({ role: 'assistant', characterId: charId || undefined, characterName: speaker, content: content, hidden: false });\n")
        OUT.append("      }\n")
        # Skip the old block lines
        while i < len(lines) and lines[i].strip() not in ('});', ''):
            i += 1
        if i < len(lines) and lines[i].strip() == '});':
            i += 1  # skip closing
        continue

    OUT.append(line)
    i += 1

print(f"Total lines: {len(lines)} -> {len(OUT)}")

with open('plugins/toonflow_story_multi_character_stage/entry.js', 'w', encoding='utf-8') as f:
    f.writelines(OUT)

r = subprocess.run(['node', 'check_syntax.js'], capture_output=True)
out = r.stdout.decode('utf-8', errors='replace').strip()
err = r.stderr.decode('utf-8', errors='replace').strip()
print('Syntax:', out or err)
if 'ERR' in err: print('Details:', err[:300])