#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('plugins/toonflow_story_multi_character_stage/entry.js', encoding='utf-8', errors='replace') as f:
    code = f.read()

changes = 0

# ============================================================
# Patch 1: Add extractThinking helper (after the stripTags definition in input:beforeSend)
# We insert it before "// 解析编排 JSON"
# ============================================================
OLD_INJECTION_POINT = "      // 解析编排 JSON"
NEW_CODE = """      // extractThinking: MINIMAX 的 <think>...</think> 标签内是推理，外面是正文
      // 返回 { thinking: '...', body: '...' }
      const extractThinking = (s) => {
        const text = s || '';
        const RE = /<thinking>([\\s\\S]*?)<\\/thinking>|<thought>([\\s\\S]*?)<\\/thought>|<reasoning>([\\s\\S]*?)<\\/reasoning>|<noworking>([\\s\\S]*?)<\\/noworking>|<ciano>([\\s\\S]*?)<\\/ciano>|<talk>([\\s\\S]*?)<\\/talk>|<think>([\\s\\S]*?)<\\/think>/gi;
        let thinking = '', m;
        RE.lastIndex = 0;
        while ((m = RE.exec(text)) !== null) {
          thinking += m[1]||m[2]||m[3]||m[4]||m[5]||m[6]||m[7]||'';
        }
        const body = text.replace(RE,'').replace(/<[^>]+>/gi,'').trim();
        return { thinking: thinking.trim(), body };
      };

      // 解析编排 JSON"""
if OLD_INJECTION_POINT in code:
    code = code.replace(OLD_INJECTION_POINT, NEW_CODE, 1)
    changes += 1
    print("P1: extractThinking added")
else:
    print("P1: injection point NOT found")

# ============================================================
# Patch 2: Fix stage-2 rawContent handling (replace old thinkingBlock with new logic)
# Old: rawContent -> stripTags -> content -> thinkingBlock + content append
# New: rawContent -> extractThinking -> content -> if(thinking){folding div + content} append
# ============================================================
OLD_STAGE2 = (
    "      const rawContent = (speakerRaw || '').trim();\n"
    "      console.log('[mcs] 阶段二原始: ' + rawContent.slice(0, 200));\n"
    "      const content = stripTags(rawContent).replace(/^[\"']|[\"']$/g, '').trim();\n"
    "      console.log('[mcs] 阶段二台词: ' + JSON.stringify(content.slice(0, 80)));\n"
    "\n"
    "      // 4. 查角色 id 并 append\n"
)
NEW_STAGE2 = (
    "      const rawContent = (speakerRaw || '').trim();\n"
    "      console.log('[mcs] 阶段二原始: ' + rawContent.slice(0, 300));\n"
    "\n"
    "      // 分离思考（MINIMAX 标签内）和正文，标签只删不删内容\n"
    "      const { thinking, body } = extractThinking(rawContent);\n"
    "      const content = body.replace(/^[\"']|[\"']$/g, '').trim();\n"
    "      console.log('[mcs] 阶段二台词: ' + JSON.stringify(content.slice(0, 80)));\n"
    "\n"
    "      // 4. 查角色 id 并 append\n"
)
if OLD_STAGE2 in code:
    code = code.replace(OLD_STAGE2, NEW_STAGE2, 1)
    changes += 1
    print("P2: stage-2 rawContent -> extractThinking fixed")
else:
    print("P2: OLD_STAGE2 not found")

# ============================================================
# Patch 3: Fix thinkingBlock - replace thinkingBlock + content append
# Old: thinkingBlock div + content in single append
# New: if(thinking) { folding div + content } append; else { content } append
# ============================================================
OLD_BLOCK = (
    "      // 思考内容包成可折叠 div（tavo 支持 HTML 渲染）\n"
    "      const thinkingBlock = thinking\n"
    "        ? '<div class=\"tf-thinking-collapsed\" style=\"cursor:pointer;color:#888;font-size:0.85em;margin-bottom:6px\">思考...<div style=\"display:none;padding:8px 0;color:#666\">'\n"
    "            + thinking.replace(/<\\/div>/g, '&lt;/div&gt;')\n"
    "            + '</div></div>'\n"
    "        : '';\n"
    "      await tavo.message.append({\n"
    "        role: 'assistant',\n"
    "        characterId: charId || undefined,\n"
    "        characterName: speaker,\n"
    "        content: thinkingBlock + content,\n"
    "        hidden: false,\n"
    "      });\n"
)
NEW_BLOCK = (
    "      // 台词正文单独 append，思考用可折叠 div（点击「思考...」展开）\n"
    "      if (thinking) {\n"
    "        const esc = thinking.replace(/<\\/div>/gi, '&lt;/div&gt;');\n"
    "        const block = '<div style=\"cursor:pointer;color:#888;font-size:0.85em\" onclick=\"var d=this.querySelector(\\'div\\');d.style.display=d.style.display===\\'none\\'?\\'block\\':\\'none\\'\">&gt;思考...<div style=\"display:none;padding:8px 0;color:#666\">' + esc + '</div></div>';\n"
    "        await tavo.message.append({ role: 'assistant', characterId: charId || undefined, characterName: speaker, content: block + content, hidden: false });\n"
    "      } else {\n"
    "        await tavo.message.append({ role: 'assistant', characterId: charId || undefined, characterName: speaker, content: content, hidden: false });\n"
    "      }\n"
)
if OLD_BLOCK in code:
    code = code.replace(OLD_BLOCK, NEW_BLOCK, 1)
    changes += 1
    print("P3: thinkingBlock fixed")
else:
    print("P3: OLD_BLOCK not found")
    # Debug: find relevant lines
    for line in code.split('\n'):
        if 'thinkingBlock' in line or '折叠' in line or 'tf-thinking' in line:
            print("   Found:", repr(line[:80]))

# ============================================================
# Patch 4: Fix sprite plugin tavo.file.url - name must be bare filename
# ============================================================
sprite_path = 'plugins/toonflow_story_sprite_background/entry.js'
with open(sprite_path, encoding='utf-8', errors='replace') as f:
    sprite = f.read()

OLD_RESOLVE = (
    "  if (path.startsWith('files/')) {\n"
    "    // tavo.file.url(name, scope) 需要两个参数\n"
    "    // 文件存在 chat scope，name 只需文件名（不含 files/chat/ 前缀）\n"
    "    const name = path.split('/').pop() || path;\n"
    "    let url = '';\n"
    "    try { url = tavo.file.url(name, 'chat') || path; } catch(e) { url = path; }\n"
    "    console.log('[sprite] resolveUrl(' + path + ') name=' + name + ' -> ' + url);\n"
    "    return url;\n"
    "  }"
)
NEW_RESOLVE = (
    "  if (path.startsWith('files/')) {\n"
    "    // tavo.file.url(name, scope) 需要两个参数：name=纯文件名（不含路径），scope='chat'|'global'\n"
    "    const name = path.split('/').pop() || path;\n"
    "    let url = '';\n"
    "    try { url = tavo.file.url(name, 'chat') || tavo.file.url(path, 'chat') || path; } catch(e) { url = path; }\n"
    "    console.log('[sprite] resolveUrl(' + path + ') name=' + name + ' -> ' + url);\n"
    "    return url;\n"
    "  }"
)
if OLD_RESOLVE in sprite:
    sprite = sprite.replace(OLD_RESOLVE, NEW_RESOLVE, 1)
    print("P4: sprite resolveUrl fixed")
else:
    print("P4: sprite resolveUrl pattern not found")
    # Find actual resolveUrl
    for line in sprite.split('\n'):
        if 'tavo.file.url' in line and 'resolveUrl' not in line:
            print("   Found:", repr(line[:80]))

with open(sprite_path, 'w', encoding='utf-8', errors='replace') as f:
    f.write(sprite)

print(f"\nTotal MCS changes: {changes}")

# Verify MCS syntax
with open('plugins/toonflow_story_multi_character_stage/entry.js', encoding='utf-8', errors='replace') as f:
    final = f.read()
try:
    compile(final, 'entry.js', 'exec')
    print("Python syntax OK")
except SyntaxError as e:
    print("Python syntax error:", e)

with open('plugins/toonflow_story_multi_character_stage/entry.js', 'w', encoding='utf-8', errors='replace') as f:
    f.write(final)
print("Files written")

# Verify MCS syntax using node
import subprocess
result = subprocess.run(['node', '-e',
    'var fs=require("fs");var c=fs.readFileSync("plugins/toonflow_story_multi_character_stage/entry.js","utf8");try{new Function(c);console.log("OK")}catch(e){console.error("ERR:"+e.message);}'],
    capture_output=True, text=True)
print("MCS syntax:", result.stdout.decode('utf-8', errors='replace').strip())
err = result.stderr.decode('utf-8', errors='replace').strip()
if err: print("MCS stderr:", err[:200])
