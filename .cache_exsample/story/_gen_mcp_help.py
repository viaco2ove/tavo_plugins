# -*- coding: utf-8 -*-
import json, csv, os

SRC = r"D:\Users\viaco\tools\Toonflow-game\tavo_plugins\.cache\story\_tavo_tools_list.json"
OUTDIR = r"D:\Users\viaco\tools\Toonflow-game\tavo_plugins\md\tavo_help\mcp_help"

tools = json.load(open(SRC, encoding="utf-8"))

# ---- 分类 ----
def category(name):
    if name in ("tavo_status", "tavo_app_version", "tavo_app_version_number"):
        return "系统状态"
    if name.startswith("tavo_file_"):
        return "文件存储"
    if name.startswith("tavo_character_"):
        return "角色"
    if name.startswith("tavo_lorebook_"):
        return "世界书"
    if name.startswith("tavo_regex_"):
        return "正则脚本"
    if name.startswith("tavo_preset_"):
        return "生成预设"
    if name.startswith("tavo_persona_"):
        return "用户人格"
    if name.startswith("tavo_chat_") or name.startswith("tavo_current_chat_"):
        return "对话/群聊"
    if name.startswith("tavo_theme_"):
        return "对话主题"
    if name.startswith("tavo_message_"):
        return "消息"
    if name.startswith("tavo_variable_"):
        return "变量"
    if name.startswith("tavo_memory_"):
        return "长期记忆"
    if name.startswith("tavo_input_"):
        return "输入框"
    if name in ("tavo_generate", "tavo_image_generate", "tavo_tts_play", "tavo_tts_stop"):
        return "生成与语音"
    if name.startswith("tavo_plugin_"):
        return "插件"
    return "其他"

# ---- 中文用途（特殊工具精确说明，CRUD 用模板）----
CN = {
    "tavo_status": "返回 Tavo MCP 服务器状态及各类数据仓库资产数量（角色/世界书/对话等计数）。",
    "tavo_app_version": "读取 Tavo 对外展示的版本号字符串。",
    "tavo_app_version_number": "读取 Tavo 的数值构建号（build number）。",
    "tavo_file_save": "在当前对话作用域或全局作用域中保存文件内容。",
    "tavo_file_load": "从对话作用域或全局作用域读取文件内容。",
    "tavo_file_delete": "从对话/全局作用域删除文件。",
    "tavo_file_exists": "检查某文件在对话/全局作用域中是否存在。",
    "tavo_file_list": "列出对话/全局作用域中的文件元数据（分页）。",

    "tavo_character_import_card": "导入完整 CCv2/CCv3 或 SillyTavern 角色卡，及卡片内嵌的世界书/正则数据。",
    "tavo_lorebook_entry_upsert": "新增或替换单条世界书 entry（兼容 CCv3/SillyTavern 形态）。",
    "tavo_lorebook_entry_delete": "删除世界书中的单条 entry。",
    "tavo_regex_entry_upsert": "新增或替换单条正则脚本 entry。",
    "tavo_regex_entry_delete": "删除单条正则脚本 entry。",
    "tavo_regex_test": "在本地测试正则脚本是否按预期匹配/替换。",

    "tavo_preset_entry_upsert": "新增或替换单条生成预设 entry。",
    "tavo_preset_entry_delete": "删除单条生成预设 entry。",
    "tavo_preset_set_active": "将某个生成预设设为当前激活预设。",
    "tavo_persona_set_active": "将某个人格设为当前激活人格（用户侧身份）。",

    "tavo_chat_search": "按显示标题搜索对话。",
    "tavo_chat_get": "按 id 读取单个对话的完整信息。",
    "tavo_chat_create": "由角色/人格 id 创建一个对话（群聊）。",
    "tavo_chat_update": "更新对话的元数据、成员列表与覆盖设置。",
    "tavo_chat_delete": "删除对话（含底层 provider 的清理）。",
    "tavo_chat_copy": "复制对话（走 provider 克隆逻辑）。",
    "tavo_chat_reset": "重置对话的消息与状态。",
    "tavo_current_chat_get": "读取当前激活的对话。",
    "tavo_current_chat_set": "设置当前激活的对话。",

    "tavo_theme_search": "搜索或列出对话主题。",
    "tavo_theme_get": "按 id 读取一个完整对话主题。",
    "tavo_theme_create": "创建自定义对话主题。",
    "tavo_theme_update": "递归 patch 自定义对话主题。",
    "tavo_theme_import": "导入对话级 .thm 主题包（可指定冲突处理策略）。",
    "tavo_theme_export": "将对话主题导出到该对话的内部文件存储。",
    "tavo_theme_delete": "删除自定义对话主题（需显式确认重试）。",

    "tavo_message_find": "按范围/角色/可见性/说话人/内容等条件筛选消息。",
    "tavo_message_get": "按稳定 id 或漂移索引读取单条消息（id 优先）。",
    "tavo_message_count": "统计某对话中的消息数量。",
    "tavo_message_append": "追加一条用户或助手消息（需提供内容）。",
    "tavo_message_update": "按 id 或索引更新消息内容/推理过程/可见性。",
    "tavo_message_delete": "按 id 或索引删除消息。",

    "tavo_variable_list": "列出某个作用域（全局/对话/消息）下完整的变量树。",
    "tavo_variable_get": "按路径从指定作用域读取一个变量。",
    "tavo_variable_set": "在指定作用域设置一个原始 JSON 变量值。",
    "tavo_variable_update": "在指定作用域浅合并对象变量，或替换其他类型值。",
    "tavo_variable_unset": "从指定作用域移除一个变量路径。",

    "tavo_memory_get": "读取对话的长期记忆，含是否启用注入。",
    "tavo_memory_update": "更新长期记忆的启用状态，或整体替换记忆条目。",
    "tavo_memory_append": "在不替换已有条目的前提下追加一条或多条长期记忆。",

    "tavo_input_get": "读取当前激活对话输入框的现有文本。",
    "tavo_input_set": "替换当前激活对话输入框的文本。",
    "tavo_input_append": "向当前激活对话输入框追加文本。",
    "tavo_input_clear": "清空当前激活对话输入框。",
    "tavo_input_send": "将输入框内容经输入钩子与正常对话流程发送（不等待生成完成）。",

    "tavo_generate": "对对话执行一次非流式文本生成（MCP 生成不弹确认框）。",
    "tavo_image_generate": "为对话生成一张图片并保存为持久 Tavo 文件（不弹确认框）。",
    "tavo_tts_play": "用指定角色/人格语音播放文本（不弹确认框，入队即返回）。",
    "tavo_tts_stop": "停止当前播放并清空全局 TTS 队列。",

    "tavo_plugin_search": "按 id/名称/描述搜索已安装插件。",
    "tavo_plugin_get": "读取单个已安装插件（含 manifest 与配置）。",
    "tavo_plugin_package": "将插件源码文件打包成可安装的 zip。",
    "tavo_plugin_install": "从 zipBase64 字符串或本地 zipPath 安装插件。",
    "tavo_plugin_uninstall": "卸载一个已安装插件。",
    "tavo_plugin_set_enabled": "启用或禁用某个已安装插件。",
    "tavo_plugin_set_config": "设置插件的一个配置项。",
    "tavo_plugin_reset_config": "将插件某个配置重置为 manifest 默认值。",
    "tavo_plugin_validate_manifest": "在打包/安装前校验插件 manifest 对象。",
    "tavo_plugin_get_runtime_contributions": "列出已启用插件向 Tavo 暴露的运行时贡献。",
}

def crud_cn(name, kind_cn):
    if name.endswith("_search"):
        return f"按名称搜索{kind_cn}资产（未知 id 时先调用它定位）。"
    if name.endswith("_get"):
        return f"按 id 读取单个{kind_cn}资产（更新前先读取以保留未知字段）。"
    if name.endswith("_create"):
        return f"新建一个{kind_cn}资产。"
    if name.endswith("_update"):
        return f"更新一个{kind_cn}资产（建议先 get 以保留未修改字段）。"
    if name.endswith("_delete"):
        return f"删除一个{kind_cn}资产。"
    if name.endswith("_import"):
        return f"从外部格式导入{kind_cn}（如 CCv3/SillyTavern 等）。"
    return ""

def cn_of(name):
    if name in CN:
        return CN[name]
    # CRUD 模板：先去掉 tavo_ 前缀，按 _ 拆分的首段判断资源类型
    seg = name[len("tavo_"):]
    prefix = seg.split("_")[0]
    kind_map = {
        "character": "角色", "lorebook": "世界书", "regex": "正则脚本",
        "preset": "生成预设", "persona": "用户人格", "chat": "对话",
        "theme": "主题", "message": "消息", "variable": "变量",
        "memory": "长期记忆", "input": "输入框", "file": "文件",
        "plugin": "插件", "status": "状态",
    }
    return crud_cn(name, kind_map.get(prefix, "资产"))

# 补全每条工具的分类与中文
rows = []
for t in tools:
    name = t["name"]
    cat = category(name)
    cn = cn_of(name)
    rows.append({"name": name, "category": cat, "desc_en": t.get("description", ""), "desc_cn": cn})

# 分类顺序
cat_order = ["系统状态", "文件存储", "角色", "世界书", "正则脚本", "生成预设",
             "用户人格", "对话/群聊", "对话主题", "消息", "变量", "长期记忆",
             "输入框", "生成与语音", "插件", "其他"]
rows.sort(key=lambda r: (cat_order.index(r["category"]) if r["category"] in cat_order else 99, r["name"]))

os.makedirs(OUTDIR, exist_ok=True)

# ---- 写 CSV ----
csv_path = os.path.join(OUTDIR, "mcp_help.csv")
with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["工具名", "分类", "用途说明(中文)", "英文说明"])
    for r in rows:
        w.writerow([r["name"], r["category"], r["desc_cn"], r["desc_en"]])
print("CSV ->", csv_path, "rows:", len(rows))

# ---- 写 MD ----
md_path = os.path.join(OUTDIR, "mcp_help.md")
lines = []
lines.append("# Tavo MCP 工具清单")
lines.append("")
lines.append(f"> 自动整理自 Tavo MCP Server `tools/list`（共 **{len(rows)}** 个工具）。")
lines.append(">")
lines.append("> 连接地址见 `tavo_plugins/.env` 的 `tavo_mcp_url`；调用需在 `Authorization: Bearer <token>` 头中带 `tavo_mcp_toekn`。")
lines.append("")
lines.append("## 分类速览")
lines.append("")
lines.append("| 分类 | 工具数 | 典型用途 |")
lines.append("| --- | --- | --- |")
overview = {
    "系统状态": "查服务器状态与版本",
    "文件存储": "在对话/全局范围存取文件",
    "角色": "增删改查角色卡（CCv3/SillyTavern）",
    "世界书": "管理 lorebook 及其 entry",
    "正则脚本": "管理 regex 脚本与单条 entry、测试",
    "生成预设": "管理生成参数预设，可设激活",
    "用户人格": "管理用户侧人格/身份，可设激活",
    "对话/群聊": "创建并管理对话，绑定角色与世界书",
    "对话主题": "管理对话外观主题",
    "消息": "读取/追加/更新/删除对话消息",
    "变量": "在全局/对话/消息作用域读写变量",
    "长期记忆": "管理对话长期记忆（含注入开关）",
    "输入框": "读写/发送当前对话输入框",
    "生成与语音": "文本/图片生成、TTS 播放",
    "插件": "安装/打包/配置/校验插件",
}
by_cat = {}
for r in rows:
    by_cat.setdefault(r["category"], []).append(r)
for c in cat_order:
    if c in by_cat:
        lines.append(f"| {c} | {len(by_cat[c])} | {overview.get(c, '')} |")
lines.append("")
lines.append("---")
lines.append("")
lines.append("## 详细清单（按分类）")
lines.append("")
for c in cat_order:
    if c not in by_cat:
        continue
    lines.append(f"### {c}（{len(by_cat[c])}）")
    lines.append("")
    lines.append("| 工具名 | 用途 |")
    lines.append("| --- | --- |")
    for r in by_cat[c]:
        lines.append(f"| `{r['name']}` | {r['desc_cn']} |")
    lines.append("")

md_text = "\n".join(lines)
open(md_path, "w", encoding="utf-8").write(md_text)
print("MD  ->", md_path, "lines:", len(lines))
