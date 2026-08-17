# tavo 官方的语音生成？
支持的平台比较受限，然后只支持预设音色，不支持克隆音色

# toonflow_story_voice 插件
配置克隆音色api和apikey 和模型。（语音生成模型直接用对应的模型无需配置）
只做克隆音色效果。绑定当前故事（对话）的角色的音色文件到gobal 变量。 提供音色文件上传功能

# 音色文件mcp 绑定和上传
story_sync_voice.py 同步音色文件的角色绑定

# 语音api mcp 设置
读取env文件中的配置,然后用mcp 设置 到gobal 变量
`
#voice_platform=xiaomimimo/aliyun/tavo
voice_platform=xiaomimimo
voice_platform_apikey=xxx
`

# 具体业务
看齐 toonflow game 的业务就行，例如怎么缓存voiceid,切换平台后怎么处理。voiceid 过期怎么处理
xiaomimimo: 的模型固定为：mimo-v2.5-tts-voiceclone 和mimo-v2.5-tts
aliyun: 阿里云固定为：voice-enrollment->cosyvoice-v3-plus
tavo: 就是tavo 自己怎么配置的就是什么。约等于不用toonflow_story_voice插件。而是tavo 官方的语音生成。
