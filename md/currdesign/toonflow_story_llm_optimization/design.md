# 开发plugins/toonflow_story_llm_optimization  
 增加思考程度配置（信息面板的故事配置里）默认为minimal（gobal） 。
 接口调用和解析也有完全接管。其他插件的对llm 返回的处理也完全看齐    
 
## [fail]插件获取：更多- 模型设置 的参数？发现无法获取官方变量。 apiurl apikey apimode 也是！
默认为
回复令牌限制：1500
记忆长度：20
温度：0.3
Top-P：0.5
Top-K：None
流式传输:开

## 变量设计
reasoningEffort:none/minimal/low/medium/high
默认值为"minimal"

tf_llm（镜像 tavo「更多-模型设置」——官方变量读不到，故插件自建）：
```json
{
  "enabled": true,
  "apiUrl": "",
  "apiKey": "",
  "apiMode": "",
  "model": "",
  "reasoningEffort": "minimal",
  "temperature": 0.3,
  "topP": 0.5,
  "topK": null,
  "maxTokens": 1500,
  "memoryLength": 20,
  "stream": true
}
```

# toonflow_story_event_manager 增加思考程度配置
llm思考程度: none/minimal/low/medium/high
toonflow_story_event_manager的
<div class="tf-card__title">llm插件配置</div>
点击后打开 llm配置配置面板

# 调用接口时
获取api配置：apikey,apiurl，模型
模型设置：回复令牌限制，记忆长度（台词条数），温度，Top-P，Top-K，流式传输
tf_llm:reasoningEffort
插件适配器命中的,进行完全接管。插件自己调用接口！：
https://api.minimaxi.com/v1
https://api.siliconflow.cn
https://dashscope.aliyuncs.com/compatible-mode/v1
https://ark.cn-beijing.volces.com/api/v3
https://api.openai.com/v1
https://generativelanguage.googleapis.com/v1beta
https://ai.t8star.cn/v1
https://dashscope.aliyuncs.com/compatible-mode/v1

其他apiurl，增加reasoningEffort参数后 给回tavo 自己处理。

