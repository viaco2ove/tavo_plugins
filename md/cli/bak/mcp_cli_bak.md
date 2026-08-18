# MCP CLI - tavo 工具链统一规范

所有通过 tavo MCP Server 操作 tavo 的 CLI 脚本，遵循统一规范。
POSIX/GNU 短选项约定见 [标准化cli.md](../标准化cli.md)。

---

## 一、CLI 清单

| CLI 脚本 | 用途 | 文档 |
|---------|------|------|
| `story_sync_all.py` | 故事完整安装：角色卡 + 世界书 + 群聊 + 章节 + 立绘 + 插件 | [story_sync_all.md](../story_sync_all.md) |
| `plugin_install.py` | 单个/批量插件安装 + 校验 | （待补） |
| `story_sync.py` | 旧版通用故事同步（仅角色+世界书+群聊） | story_sync/README.md |
| `chapter_sync.py` | 章节增删改查（chat 变量 `tf_story.edit.chapters`） | chapter_sync.py 头部 |
| `sprites_import.py` | 立绘资源上传（兼容版） | sprites_import.py 头部 |
| `story_sprite_background.py` | 立绘 + 章节背景上传 | story_sprite_background.py 头部 |

---

## 二、CLI 标准规范

### 2.1 参数风格（POSIX/GNU）

所有 CLI **必须**遵循：

```bash
python <script>.py [选项] <位置参数>
```

| 短 | 长 | 用途 |
|----|---|------|
| `-h` | `--help` | 显示帮助 |
| `-n` | `--dry-run` | 预演模式，不实际写入（POSIX 标准） |
| `-f` | `--force` | 强制操作，跳过确认（POSIX 标准） |
| `-c` | `--check` | 仅连通性检查 |
| `-v` | `--verbose` | 详细输出 |

| 参数 | 说明 |
|------|------|
| 位置参数 | 通常是故事目录 / chat_id / 配置 JSON 路径，**必填** |
| `--skip-X` | 跳过某步骤（章节/插件/立绘/语音等） |
| `--chat-id N` | 指定已有群聊 ID |
| `--url URL` | 覆盖 `.env` 的 `tavo_mcp_url` |
| `--token TOKEN` | 覆盖 `.env` 的 `tavo_mcp_toekn` |

**退出码**（POSIX）：
- 0 = 成功
- 1 = 通用错误（连接失败、MCP 错误）
- 2 = 参数错误（argparse 自动）
- 130 = Ctrl+C 中断

### 2.2 输出格式

- 章节用 `===`：`=== 同步角色卡 ===`
- 步骤用 `[]`：`[config]` / `[persona]` / `[char]` / `[chat]` / `[worldbook]` / `[chapter]` / `[sprite]` / `[plugin]`
- 操作动词：`复用` / `创建` / `更新` / `dry 创建` / `dry 跳过`
- 错误：抛 `RuntimeError` 带 MCP 完整错误 JSON
- 中文乱码：Windows GBK bash 会出现乱码，建议用 `PYTHONIOENCODING=utf-8` 或 `chcp 65001`

### 2.3 .env 读取

**所有 CLI 都要从项目根 `.env` 读连接**：

```python
def load_env():
    env = {}
    for path in [os.path.join(ROOT, ".env"), ".env"]:
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def resolve(args):
    env = load_env()
    url = args.url or env.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        print("缺少 MCP 配置：--url/--token 或 .env", file=sys.stderr)
        sys.exit(1)
    return url.rstrip("/"), token
```

> ⚠️ 键名是 `tavo_mcp_toekn`（历史拼写，**不是** `token`），但兼容 `tavo_mcp_token`。

### 2.4 MCP RPC 封装（标准模式）

```python
def rpc(http_url, token, method, arguments, timeout=120):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        http_url, data=data,
        headers={"Content-Type": "application/json; charset=utf-8",
                 "Authorization": "Bearer " + token},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败: %s" % e)
    if "error" in body:
        raise RuntimeError("MCP Error: %s" % json.dumps(body["error"], ensure_ascii=False))
    return body.get("result", {})

def unwrap(result):
    """MCP 返回 {content: [{text: '...'}]} → dict"""
    raw = result or {}
    try:
        content = raw.get("content", [])
        if content and isinstance(content, list):
            return json.loads(content[0].get("text", "{}"))
    except Exception:
        pass
    return raw
```

### 2.5 search 解析

所有 search 类 MCP（`tavo_character_search` / `tavo_lorebook_search` / `tavo_persona_search` / `tavo_chat_search`）统一返回：

```json
{"items": [{"id": ..., "name": ..., ...}, ...]}
```

用统一 helper：

```python
def _parse_search_result(result):
    r = unwrap(result) if isinstance(result, dict) else result
    if isinstance(r, dict):
        return r.get("items", r.get("lorebooks", []))
    if isinstance(r, list):
        return r
    return []
```

---

## 三、关键实现细节（所有 CLI 都要遵守）

### 3.1 avatar 不能直接传 base64

tavo 的角色卡 / persona 接收 `avatar` 字段时**只能**接 `files/global/<name>.<ext>` 路径引用。

正确流程：
1. 先 `tavo_file_save(name="<name>.<ext>", scope="global")` 上传原图 → 返回 `files/global/<name>.<ext>` 引用路径
2. 把引用路径写进 card 的 `data.avatar` 字段

```python
# avatar_ref 是 files/global/xxx.png 引用，不是 base64
card = {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": {
        "name": name,
        "description": ...,
        "firstMes": ...,
        "personality": ...,
        "roleType": "npc",
        "avatar": avatar_ref,  # ← files/global/xxx.png
    }
}
```

### 3.2 character_import_card 参数

```json
{"card": {"spec": "chara_card_v3", "spec_version": "3.0", "data": {...}}}
```

**不是** `{"characterJson": "..."}`，也**不是** `{"card": {...}}` 直接平铺。

### 3.3 persona 字段限制

`tavo_persona_create` 只支持：`name` / `description` / `avatar` / `active`。
**不要**传 `firstMes` / `personality`（会报 `persona.firstMes must be a supported persona field`）。

### 3.4 lorebook 参数

`tavo_lorebook_create` 参数格式：
```json
{"lorebook": {"name": "...", "entries": [...]}}
```

`tavo_lorebook_update`：`{"id": <int>, "lorebook": {"entries": [...]}}` —— `id` 必须是整数。

### 3.5 chat 参数

`tavo_chat_create` / `tavo_chat_update` 参数格式：
```json
{"chat": {"name": "...", "characterIds": [<int>, ...], "lorebookIds": [...], "personaId": <int>, "responseMode": "natural"}}
```

**注意**：
- `characterIds` / `lorebookIds` / `personaId` 必须是**正整数**（不是字符串）
- `tavo_chat_create` 时 `characterIds` **不能为空数组**

### 3.6 file_save 流程

- `tavo_file_save` 无论 `scope` 是 `chat` 还是 `global` 都要传 `chatId`
- 所以建群聊前没法上传文件 → 必须**先建群聊**拿 chatId 再传文件

### 3.7 群聊先建再绑

avatar 上传 + 角色卡导入都需要 chatId，所以流程必须是：

```
1. 建群聊（可空角色）拿 chatId
2. 上传 avatar（files/global 引用）
3. 导入角色卡（带 avatar 引用）
4. 重绑群聊（characterIds + lorebookIds + personaId）
```

### 3.8 插件安装

```python
def _build_plugin_zip(plugin_dir):
    """打包插件目录为 zip base64"""
    import zipfile, io as _io
    _SKIP = {".git", "__pycache__", "node_modules"}
    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in _SKIP]
            for f in files:
                if f.endswith(".pyc") or f == ".DS_Store":
                    continue
                p = os.path.join(base, f)
                rel = os.path.relpath(p, plugin_dir).replace(os.sep, "/")
                z.write(p, rel)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def plugin_install(http_url, token, plugin_id, zip_b64, overwrite=True):
    r = rpc(http_url, token, "tavo_plugin_install",
            {"pluginId": plugin_id, "zipBase64": zip_b64, "overwrite": overwrite})
    return unwrap(r)
```

---

## 四、调试技巧

### 4.1 Windows GBK 乱码

```bash
# 输出含中文时设环境变量
PYTHONIOENCODING=utf-8 python script.py ...

# 或临时切 bash 到 UTF-8
chcp 65001
```

### 4.2 跑一个最小测试看 MCP 返回结构

`script/tavo_mcp_use/story_sync/test_search.py`（用于调试 search 返回）：
```python
import urllib.request, json
url, token = 'http://127.0.0.1:7347/mcp', 'YOUR_TOKEN'
payload = json.dumps({
    'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
    'params': {'name': 'tavo_character_search', 'arguments': {'query': 'test'}}
}).encode('utf-8')
req = urllib.request.Request(url, data=payload,
    headers={'Content-Type': 'application/json; charset=utf-8',
             'Authorization': 'Bearer ' + token})
with urllib.request.urlopen(req, timeout=15) as r:
    body = json.loads(r.read().decode('utf-8'))
print(json.dumps(body, ensure_ascii=False, indent=2)[:500])
```

### 4.3 已知 MCP 错误码

| 错误 | 原因 | 修复 |
|------|------|------|
| `Expected object card` | 参数名/格式错 | 改用 `{"card": {...}}` |
| `chat.characterIds[0] must be a positive integer` | id 是字符串 | 转 int |
| `chat.characterIds must be a non-empty array` | 创建群聊时为空 | 先占位再建 |
| `chat.personaId must be a positive integer` | personaId 是字符串 | 转 int |
| `Expected positive integer chatId` | file_save 的 chatId 无效 | 先建群聊拿 chatId |
| `persona.firstMes must be a supported persona field` | persona 字段多了 | 只传 name/description/avatar/active |
| `Expected positive integer id` | lorebook id 不是整数 | `int(lorebook_id)` |
| `lorebook create must wrap entries in lorebook object` | lorebook 参数错 | 用 `{"lorebook": {...}}` |

---

## 五、tavo MCP 工具列表（速查）

| MCP 名 | 用途 | 关键参数 |
|--------|------|---------|
| `tavo_plugin_install` | 安装/更新插件 | `pluginId, zipBase64, overwrite` |
| `tavo_plugin_set_enabled` | 启用/禁用插件 | `pluginId, enabled` |
| `tavo_plugin_search` | 搜索已装插件 | `query` |
| `tavo_character_search` | 搜索角色 | `query` |
| `tavo_character_import_card` | 创建/导入角色卡 | `card={spec, spec_version, data}` |
| `tavo_persona_search` | 搜索玩家身份 | `query` |
| `tavo_persona_create` | 创建玩家身份 | `persona={name, description, avatar, active}` |
| `tavo_persona_set_active` | 激活 persona | `id` |
| `tavo_lorebook_search` | 搜索世界书 | `query` |
| `tavo_lorebook_create` | 创建世界书 | `lorebook={name, entries}` |
| `tavo_lorebook_update` | 更新世界书 | `id, lorebook={entries}` |
| `tavo_chat_search` | 搜索群聊 | `query` |
| `tavo_chat_create` | 创建群聊 | `chat={name, characterIds, lorebookIds, personaId, responseMode}` |
| `tavo_chat_update` | 更新群聊 | `id, chat={...}` |
| `tavo_chat_get` | 获取群聊详情 | `chatId` |
| `tavo_file_save` | 上传文件 | `chatId, name, content(base64), options={scope, encoding}` |
| `tavo_variable_get` | 读取变量 | `scope, chatId, name` |
| `tavo_variable_set` | 写入变量 | `scope, chatId, name, value` |

> 完整列表见 `script/_tavo_tools_list.json`。