# Tavo MCP 工具清单

> 自动整理自 Tavo MCP Server `tools/list`（共 **95** 个工具）。
>
> 连接地址见 `tavo_plugins/.env` 的 `tavo_mcp_url`；调用需在 `Authorization: Bearer <token>` 头中带 `tavo_mcp_toekn`。

## 分类速览

| 分类 | 工具数 | 典型用途 |
| --- | --- | --- |
| 系统状态 | 3 | 查服务器状态与版本 |
| 文件存储 | 5 | 在对话/全局范围存取文件 |
| 角色 | 6 | 增删改查角色卡（CCv3/SillyTavern） |
| 世界书 | 8 | 管理 lorebook 及其 entry |
| 正则脚本 | 9 | 管理 regex 脚本与单条 entry、测试 |
| 生成预设 | 9 | 管理生成参数预设，可设激活 |
| 用户人格 | 6 | 管理用户侧人格/身份，可设激活 |
| 对话/群聊 | 9 | 创建并管理对话，绑定角色与世界书 |
| 对话主题 | 7 | 管理对话外观主题 |
| 消息 | 6 | 读取/追加/更新/删除对话消息 |
| 变量 | 5 | 在全局/对话/消息作用域读写变量 |
| 长期记忆 | 3 | 管理对话长期记忆（含注入开关） |
| 输入框 | 5 | 读写/发送当前对话输入框 |
| 生成与语音 | 4 | 文本/图片生成、TTS 播放 |
| 插件 | 10 | 安装/打包/配置/校验插件 |

---

## 详细清单（按分类）

### 系统状态（3）

| 工具名 | 用途 |
| --- | --- |
| `tavo_app_version` | 读取 Tavo 对外展示的版本号字符串。 |
| `tavo_app_version_number` | 读取 Tavo 的数值构建号（build number）。 |
| `tavo_status` | 返回 Tavo MCP 服务器状态及各类数据仓库资产数量（角色/世界书/对话等计数）。 |

### 文件存储（5）

| 工具名 | 用途 |
| --- | --- |
| `tavo_file_delete` | 从对话/全局作用域删除文件。 |
| `tavo_file_exists` | 检查某文件在对话/全局作用域中是否存在。 |
| `tavo_file_list` | 列出对话/全局作用域中的文件元数据（分页）。 |
| `tavo_file_load` | 从对话作用域或全局作用域读取文件内容。 |
| `tavo_file_save` | 在当前对话作用域或全局作用域中保存文件内容。 |

### 角色（6）

| 工具名 | 用途 |
| --- | --- |
| `tavo_character_create` | 新建一个角色资产。 |
| `tavo_character_delete` | 删除一个角色资产。 |
| `tavo_character_get` | 按 id 读取单个角色资产（更新前先读取以保留未知字段）。 |
| `tavo_character_import_card` | 导入完整 CCv2/CCv3 或 SillyTavern 角色卡，及卡片内嵌的世界书/正则数据。 |
| `tavo_character_search` | 按名称搜索角色资产（未知 id 时先调用它定位）。 |
| `tavo_character_update` | 更新一个角色资产（建议先 get 以保留未修改字段）。 |

### 世界书（8）

| 工具名 | 用途 |
| --- | --- |
| `tavo_lorebook_create` | 新建一个世界书资产。 |
| `tavo_lorebook_delete` | 删除一个世界书资产。 |
| `tavo_lorebook_entry_delete` | 删除世界书中的单条 entry。 |
| `tavo_lorebook_entry_upsert` | 新增或替换单条世界书 entry（兼容 CCv3/SillyTavern 形态）。 |
| `tavo_lorebook_get` | 按 id 读取单个世界书资产（更新前先读取以保留未知字段）。 |
| `tavo_lorebook_import` | 从外部格式导入世界书（如 CCv3/SillyTavern 等）。 |
| `tavo_lorebook_search` | 按名称搜索世界书资产（未知 id 时先调用它定位）。 |
| `tavo_lorebook_update` | 更新一个世界书资产（建议先 get 以保留未修改字段）。 |

### 正则脚本（9）

| 工具名 | 用途 |
| --- | --- |
| `tavo_regex_create` | 新建一个正则脚本资产。 |
| `tavo_regex_delete` | 删除一个正则脚本资产。 |
| `tavo_regex_entry_delete` | 删除单条正则脚本 entry。 |
| `tavo_regex_entry_upsert` | 新增或替换单条正则脚本 entry。 |
| `tavo_regex_get` | 按 id 读取单个正则脚本资产（更新前先读取以保留未知字段）。 |
| `tavo_regex_import` | 从外部格式导入正则脚本（如 CCv3/SillyTavern 等）。 |
| `tavo_regex_search` | 按名称搜索正则脚本资产（未知 id 时先调用它定位）。 |
| `tavo_regex_test` | 在本地测试正则脚本是否按预期匹配/替换。 |
| `tavo_regex_update` | 更新一个正则脚本资产（建议先 get 以保留未修改字段）。 |

### 生成预设（9）

| 工具名 | 用途 |
| --- | --- |
| `tavo_preset_create` | 新建一个生成预设资产。 |
| `tavo_preset_delete` | 删除一个生成预设资产。 |
| `tavo_preset_entry_delete` | 删除单条生成预设 entry。 |
| `tavo_preset_entry_upsert` | 新增或替换单条生成预设 entry。 |
| `tavo_preset_get` | 按 id 读取单个生成预设资产（更新前先读取以保留未知字段）。 |
| `tavo_preset_import` | 从外部格式导入生成预设（如 CCv3/SillyTavern 等）。 |
| `tavo_preset_search` | 按名称搜索生成预设资产（未知 id 时先调用它定位）。 |
| `tavo_preset_set_active` | 将某个生成预设设为当前激活预设。 |
| `tavo_preset_update` | 更新一个生成预设资产（建议先 get 以保留未修改字段）。 |

### 用户人格（6）

| 工具名 | 用途 |
| --- | --- |
| `tavo_persona_create` | 新建一个用户人格资产。 |
| `tavo_persona_delete` | 删除一个用户人格资产。 |
| `tavo_persona_get` | 按 id 读取单个用户人格资产（更新前先读取以保留未知字段）。 |
| `tavo_persona_search` | 按名称搜索用户人格资产（未知 id 时先调用它定位）。 |
| `tavo_persona_set_active` | 将某个人格设为当前激活人格（用户侧身份）。 |
| `tavo_persona_update` | 更新一个用户人格资产（建议先 get 以保留未修改字段）。 |

### 对话/群聊（9）

| 工具名 | 用途 |
| --- | --- |
| `tavo_chat_copy` | 复制对话（走 provider 克隆逻辑）。 |
| `tavo_chat_create` | 由角色/人格 id 创建一个对话（群聊）。 |
| `tavo_chat_delete` | 删除对话（含底层 provider 的清理）。 |
| `tavo_chat_get` | 按 id 读取单个对话的完整信息。 |
| `tavo_chat_reset` | 重置对话的消息与状态。 |
| `tavo_chat_search` | 按显示标题搜索对话。 |
| `tavo_chat_update` | 更新对话的元数据、成员列表与覆盖设置。 |
| `tavo_current_chat_get` | 读取当前激活的对话。 |
| `tavo_current_chat_set` | 设置当前激活的对话。 |

### 对话主题（7）

| 工具名 | 用途 |
| --- | --- |
| `tavo_theme_create` | 创建自定义对话主题。 |
| `tavo_theme_delete` | 删除自定义对话主题（需显式确认重试）。 |
| `tavo_theme_export` | 将对话主题导出到该对话的内部文件存储。 |
| `tavo_theme_get` | 按 id 读取一个完整对话主题。 |
| `tavo_theme_import` | 导入对话级 .thm 主题包（可指定冲突处理策略）。 |
| `tavo_theme_search` | 搜索或列出对话主题。 |
| `tavo_theme_update` | 递归 patch 自定义对话主题。 |

### 消息（6）

| 工具名 | 用途 |
| --- | --- |
| `tavo_message_append` | 追加一条用户或助手消息（需提供内容）。 |
| `tavo_message_count` | 统计某对话中的消息数量。 |
| `tavo_message_delete` | 按 id 或索引删除消息。 |
| `tavo_message_find` | 按范围/角色/可见性/说话人/内容等条件筛选消息。 |
| `tavo_message_get` | 按稳定 id 或漂移索引读取单条消息（id 优先）。 |
| `tavo_message_update` | 按 id 或索引更新消息内容/推理过程/可见性。 |

### 变量（5）

| 工具名 | 用途 |
| --- | --- |
| `tavo_variable_get` | 按路径从指定作用域读取一个变量。 |
| `tavo_variable_list` | 列出某个作用域（全局/对话/消息）下完整的变量树。 |
| `tavo_variable_set` | 在指定作用域设置一个原始 JSON 变量值。 |
| `tavo_variable_unset` | 从指定作用域移除一个变量路径。 |
| `tavo_variable_update` | 在指定作用域浅合并对象变量，或替换其他类型值。 |

### 长期记忆（3）

| 工具名 | 用途 |
| --- | --- |
| `tavo_memory_append` | 在不替换已有条目的前提下追加一条或多条长期记忆。 |
| `tavo_memory_get` | 读取对话的长期记忆，含是否启用注入。 |
| `tavo_memory_update` | 更新长期记忆的启用状态，或整体替换记忆条目。 |

### 输入框（5）

| 工具名 | 用途 |
| --- | --- |
| `tavo_input_append` | 向当前激活对话输入框追加文本。 |
| `tavo_input_clear` | 清空当前激活对话输入框。 |
| `tavo_input_get` | 读取当前激活对话输入框的现有文本。 |
| `tavo_input_send` | 将输入框内容经输入钩子与正常对话流程发送（不等待生成完成）。 |
| `tavo_input_set` | 替换当前激活对话输入框的文本。 |

### 生成与语音（4）

| 工具名 | 用途 |
| --- | --- |
| `tavo_generate` | 对对话执行一次非流式文本生成（MCP 生成不弹确认框）。 |
| `tavo_image_generate` | 为对话生成一张图片并保存为持久 Tavo 文件（不弹确认框）。 |
| `tavo_tts_play` | 用指定角色/人格语音播放文本（不弹确认框，入队即返回）。 |
| `tavo_tts_stop` | 停止当前播放并清空全局 TTS 队列。 |

### 插件（10）

| 工具名 | 用途 |
| --- | --- |
| `tavo_plugin_get` | 读取单个已安装插件（含 manifest 与配置）。 |
| `tavo_plugin_get_runtime_contributions` | 列出已启用插件向 Tavo 暴露的运行时贡献。 |
| `tavo_plugin_install` | 从 zipBase64 字符串或本地 zipPath 安装插件。 |
| `tavo_plugin_package` | 将插件源码文件打包成可安装的 zip。 |
| `tavo_plugin_reset_config` | 将插件某个配置重置为 manifest 默认值。 |
| `tavo_plugin_search` | 按 id/名称/描述搜索已安装插件。 |
| `tavo_plugin_set_config` | 设置插件的一个配置项。 |
| `tavo_plugin_set_enabled` | 启用或禁用某个已安装插件。 |
| `tavo_plugin_uninstall` | 卸载一个已安装插件。 |
| `tavo_plugin_validate_manifest` | 在打包/安装前校验插件 manifest 对象。 |
