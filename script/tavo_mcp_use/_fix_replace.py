import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace("tavo.get('tf_story.edit', 'chat')", "readChatVar('tf_story.edit')")
s = s.replace("tavo.get('tf_progress.sessionFreeMode')", "!!(readChatVar('tf_progress')||{}).sessionFreeMode")
s = s.replace("tavo.get('mcs_free_mode_seen')", "readChatVar('mcs_free_mode_seen')")
open(p, "w", encoding="utf-8").write(s)
leftover = s.count("tavo.get('tf_story") + s.count("tavo.get('tf_progress") + s.count("tavo.get('mcs_free")
print("leftover tavo.get story/progress/mcs:", leftover)
print("readChatVar occurrences:", s.count("readChatVar("))
