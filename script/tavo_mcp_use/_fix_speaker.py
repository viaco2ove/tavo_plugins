# -*- coding: utf-8 -*-
"""把 speaker/entry.js 里未解包的 tavo.get 全部换成 readChatVar。"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P = os.path.join(ROOT, 'plugins', 'toonflow_story_speaker', 'entry.js')

with io.open(P, 'r', encoding='utf-8') as f:
    src = f.read()

pairs = [
    ("tavo.get('tf_story.edit', 'chat') || {}", "readChatVar('tf_story.edit') || {}"),
    ("story = tavo.get('tmm_story', 'chat');", "story = readChatVar('tmm_story') || readChatVar('tmm_story_static');"),
    ("prog = tavo.get('tf_progress', 'chat');", "prog = readChatVar('tf_progress');"),
    ("!!tavo.get('tf_progress.sessionFreeMode')", "!!(readChatVar('tf_progress') || {}).sessionFreeMode"),
]

for old, new in pairs:
    n = src.count(old)
    src = src.replace(old, new)
    print('replaced', n, 'x', old)

with io.open(P, 'w', encoding='utf-8') as f:
    f.write(src)

left = [l for l in src.splitlines() if 'tavo.get(' in l]
print('remaining tavo.get lines:', len(left))
for l in left:
    print('  ', l.strip())
print('readChatVar occurrences:', src.count('readChatVar('))
