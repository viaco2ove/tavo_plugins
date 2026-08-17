# 调整前重启后的插件重载业务
特点 聊天重启后的故事加载和插件加载 时机不对。

```
[INFO] [eruda-debug] injected into SELF iframe
[INFO] [eruda-debug] plugin entry loaded
[INFO] [tf_story] register confirm: plugin.on=function
[INFO] [tf_story][hookProbe] ✓ generation:prepare registered OK
[WARNING] [tf_story][hookProbe] ✗ generation:before failed: Unsupported plugin event: generation:before
[WARNING] [tf_story][hookProbe] ✗ generation:after failed: Unsupported plugin event: generation:after
[WARNING] [tf_story][hookProbe] ✗ generation:start failed: Unsupported plugin event: generation:start
[WARNING] [tf_story][hookProbe] ✗ generation:end failed: Unsupported plugin event: generation:end
[INFO] [tf_story][hookProbe] ✓ input:beforeSend registered OK
[WARNING] [tf_story][hookProbe] ✗ input:before failed: Unsupported plugin event: input:before
[WARNING] [tf_story][hookProbe] ✗ input failed: Unsupported plugin event: input
[INFO] [tf_story][hookProbe] ✓ chat:opened registered OK
[INFO] [tf_story][hookProbe] ✓ chat:reset registered OK
[INFO] [tf_story][hookProbe] ✓ chat:closed registered OK
[INFO] [tf_story][hookProbe] ✓ message:added registered OK
[INFO] [tf_story][hookProbe] ✓ message:beforeSend registered OK
[INFO] [tf_story][hookProbe] ✓ message:before registered OK
[WARNING] [tf_story][hookProbe] ✗ plugin:beforeLoad failed: Unsupported plugin event: plugin:beforeLoad
[WARNING] [tf_story][hookProbe] ✗ plugin:load failed: Unsupported plugin event: plugin:load
[WARNING] [tf_story][hookProbe] ✗ plugin:ready failed: Unsupported plugin event: plugin:ready
[INFO] [tf_story][boot] start, myGuard=1
[INFO] [tf_story][boot] chatId=3
[INFO] [tf_story][boot] step0 natural mode set
[INFO] [tf_story][boot] toast shown
[INFO] ========== Boot 开始前变量预检 ==========
[INFO] [tf_story][preCheck] tf_story.boot | global:✓ 9键 | chat:✗空
[INFO] [tf_story][preCheck] tf_story.edit | global:✓ 5键 | chat:✗空
[INFO] [tf_story][preCheck] tf_progress | global:✓ 10键 | chat:✗空
[INFO] [tf_story][preCheck] tmm | global:✓ 7键 | chat:✓ 7键
[INFO] [tf_story][preCheck] tmm_story | global:✗空 | chat:✗空
[INFO] [tf_story][preCheck] tmm_story_static | global:✓ 3键 | chat:✗空
[INFO] =========================================
[INFO] [tf_story][boot] message count=0
[INFO] [tf_story][boot] sessionStage=reset globalHasData=true chatBoot=null count=0
[INFO] [tf_story][writeBoot] global tf_story.boot ✓ status=loading
[INFO] [tf_story][writeBoot] chat tf_story.boot ✓ status=loading
[INFO] [tf_story][restoreStatic] tf_story.edit chat 为空，从 global 恢复…
[INFO] [tf_story][restoreStatic] tf_story.edit global.found=undefined keys=5
[INFO] [tf_story][restoreStatic] ✓ tf_story.edit 已从 global 恢复到 chat，5 键
[INFO] [tf_story][restoreStatic] skip tmm_story_static (chat 有数据，3 键)
[INFO] [tf_story][boot] restored=true
[INFO] [tf_story][readVarAnyScope] tf_progress from global ✓ keys=10
[INFO] [tf_story][rebuild] tf_progress 读取: found=yes keys=10
[INFO] [tf_story][readVarAnyScope] tf_story.edit from global ✓ keys=5
[INFO] [tf_story][boot] rebuilt=false
[INFO] [tf_story][writeBoot] global tf_story.boot ✓ status=loading
[INFO] [tf_story][writeBoot] chat tf_story.boot ✓ status=loading
[INFO] [tf_story][writeBoot] global tf_story.boot ✓ status=loading
[INFO] [tf_story][writeBoot] chat tf_story.boot ✓ status=loading
[INFO] [tf_story] opening played 3 messages
[INFO] [tf_story][boot] playChapterOpening result=3
[INFO] [tf_story][writeBoot] global tf_story.boot ✓ status=ready
[INFO] [tf_story][writeBoot] chat tf_story.boot ✓ status=ready
[INFO] [tf_story][boot] DONE sessionType=reset restored=true rebuilt=false
[INFO] ========== Boot 完成后变量验证 ==========
[INFO] [tf_story][verify] tf_story.boot | global:✓ 9键 | chat:✓ 9键
[INFO] [tf_story][verify] tf_story.edit | global:✓ 5键 | chat:✓ 5键
[INFO] [tf_story][verify] tf_progress | global:✓ 10键 | chat:✗空
[INFO] [tf_story][verify] tmm | global:✓ 7键 | chat:✓ 7键
[INFO] [tf_story][verify] tmm_story | global:✗空 | chat:✓ 3键
[INFO] [tf_story][verify] tmm_story_static | global:✓ 3键 | chat:✓ 3键
[INFO] =========================================
[INFO] [tf_story][setProgress] calling writeVarDual with tf_progress, keys=currentChapterIndex,completedChapters,failedAttempts,sessionFreeMode,storyCompleted,currentPhase,currentEvent,phases,startedAt,updatedAt
[INFO] [tf_story][writeVarDual] chat tf_progress ✓
[INFO] [tf_story][writeVarDual] global tf_progress ✓
[INFO] [tf_story][input:beforeSend] ★ user trying to send | _bootState=ready | boot.status=ready | openingDone=false | tmm_ok=true
[INFO] [tf_story][input:beforeSend] ✗ blocked: boot.status=ready openingDone=false
```

# 调整前重启后的插件重载业务
重启聊天实际是个摧毁式的过程。但是重建过程是凌乱的，无序的
我们的插件让他变的有序。

toonflow_story_event_manager 作为 这个重启过程的控制器。
他被重载后的第一件事：弹窗 “故事加载中”
然后是等待，等待所有插件都加载，而不是直接去设置已经加载好 然后再硬等待0.5秒。
加载插件后，开始加载静态数据，然后重构动态数据。
一直到全部都加载后才设置为已经初始化，然后再去加载开场白。
