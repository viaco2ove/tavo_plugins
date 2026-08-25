# logtag 
日志标签的意思
帮散乱的日志进行管理。一般来说还要加 是否输出日志的控制。 输出什么logtag 的控制。 tavo 插件暂时不做这个限制。

# logtag list
[{pluginName}][{funName}][{stepName}][{parmName}]

## pluginName:插件名称
- event_manager
- llm_optimization
- memory_manager
- multi-character_stage
- speaker
- sprite_background
- style
- voice

代码实现：
console.log('[event_manager]...
console.error('[event_manager]...
console.warn('[event_manager]...
如：console.log('[event_manager][tf_story_game][writeBoot] [tf_story.boot]: ' + JSON.stringify(b));

## funName:功能名称
- event_manager_fun
- llm_optimization_fun
- memory_manager_fun
- multi-character_stage_fun
- speaker_fun
- sprite_background_fun
- style_fun
- voice_fun
- event_llm

# stepName:步骤名称
....


# parmName:参数名称
[变量列表.global.md](../%E5%8F%98%E9%87%8F%E8%AE%BE%E8%AE%A1/%E5%8F%98%E9%87%8F%E5%88%97%E8%A1%A8.global.md)
[变量列表.chat.md](../%E5%8F%98%E9%87%8F%E8%AE%BE%E8%AE%A1/%E5%8F%98%E9%87%8F%E5%88%97%E8%A1%A8.chat.md)
[变量列表.tavoself.md](../%E5%8F%98%E9%87%8F%E8%AE%BE%E8%AE%A1/%E5%8F%98%E9%87%8F%E5%88%97%E8%A1%A8.tavoself.md)

- tf_sprites

# 例子
console.log('[multi-character_stage][setWorldbookState] [mcs_wb_state]: ' + JSON.stringify(state));
console.log('[multi-character_stage] [mcs_free_mode_seen]');
console.log('[event_manager][tf_story_game][writeBoot] [tf_story.boot]: ' + JSON.stringify(b));
console.log('[memory_manager][memory_manager_fun]' );
console.log('[memory_manager][tmm_story_static]' );
speaker
console.log('[speaker][tmm_story_static]' );
console.log('[speaker]',ORCH_FLAG);
sprite_background_fun
console.log('sprite_background_fun]['+name+']set');


#  toast
tavo.utils.toast('🎉 故事已完结！' + (progress.sessionFreeMode ? '已进入自由模式' : ''));