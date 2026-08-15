# -*- coding: utf-8 -*-
"""抽取 HTML 内联 <script> 到临时 .js 并用 node --check 校验语法。"""
import io, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NODE = r'C:\Users\viaco\.workbuddy\binaries\node\versions\22.22.2\node.exe'

TARGETS = [
    'plugins/toonflow_story_event_manager/ui/story_panel.html',
    'plugins/toonflow_story_memory_manager/ui/panel.html',
    'plugins/toonflow_story_multi_character_stage/ui/orchestration_panel.html',
    'plugins/toonflow_story_style/ui/story_style_panel.html',
]

ok = True
for rel in TARGETS:
    p = os.path.join(ROOT, rel.replace('/', os.sep))
    with io.open(p, 'r', encoding='utf-8') as f:
        html = f.read()
    blocks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)
    if not blocks:
        print('NO-SCRIPT', rel)
        continue
    for i, b in enumerate(blocks):
        tmp = os.path.join(tempfile.gettempdir(), 'tfchk_%s_%d.js' % (os.path.basename(p).replace('.', '_'), i))
        with io.open(tmp, 'w', encoding='utf-8') as f:
            f.write(b)
        r = subprocess.run([NODE, '--check', tmp], capture_output=True, text=True, encoding='utf-8', errors='replace')
        tag = 'OK  ' if r.returncode == 0 else 'FAIL'
        if r.returncode != 0:
            ok = False
        print('%s %s [script #%d]' % (tag, rel, i))
        if r.returncode != 0:
            print((r.stderr or '')[:1200])
        try:
            os.remove(tmp)
        except OSError:
            pass

print('ALL OK' if ok else 'HAS FAILURES')
sys.exit(0 if ok else 1)
