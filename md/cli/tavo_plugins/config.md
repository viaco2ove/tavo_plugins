# .env 配置和角色 ID 映射
tavo cli 命令使用
[tavo_run.md](tavo_run.md)
## .env 文件

`tavo` CLI 通过 `.env` 文件连接 Tavo MCP 服务。

### 位置

默认在以下位置按顺序查找：
1. 当前执行命令的目录
2. `tavo_plugins/` 目录

也可以用 `-e` / `--env` 显式指定：

```bash
tavo -e /path/to/.env sync .cache/story/xxx
```

### 字段说明

```env
TAVO_MCP_URL=http://localhost:38685/mcp
TAVO_MCP_TOKEN=你的token
```

| 字段 | 说明 |
|------|------|
| `TAVO_MCP_URL` | Tavo MCP 服务地址 |
| `TAVO_MCP_TOKEN` | 认证 Token |

### 获取方法

1. 打开 Tavo 应用
2. 进入「设置」→「开发者选项」或「MCP」
3. 复制 URL 和 Token

### 验证连接

```bash
tavo plugins
```

如果输出 `MCP 连接失败`，检查：
- URL 是否正确（包含 `/mcp` 后缀）
- Token 是否过期或被重置
- Tavo 应用是否运行

---

## 角色 ID 映射

### 什么是角色 ID 映射

每次执行 `tavo sync`，角色卡会在 Tavo 中产生记录。如果不使用 ID 映射：

- 首次 sync → 创建角色，ID = 26, 27, 28...
- 再次 sync → 再创建一批，ID = 38, 39, 40...（重复角色）

ID 映射文件告诉 CLI：「红缥缈的 ID 是 26，不是新建一个」。

### 映射文件格式

```json
{
  "纯小白": 2,
  "红缥缈": 26,
  "白锦儿": 27,
  "李玄风": 28,
  "陆青山": 29,
  "云火月": 30,
  "林月": 31,
  "琳琅": 32,
  "冷素心": 33,
  "苍山道人": 34,
  "某女子": 35,
  "某男子": 36
}
```

- **纯小白** 是 persona，ID 通常较小
- **红缥缈 ~ 某男子** 是 NPC，ID 从 26 开始

### 使用方法


```bash
tavo sync ".cache/story/故事名" \
  --reuse-ids ".cache/story/故事名/char_ids.json"
```

### 生成映射文件

**方法1**：首次 sync 后，从 `tavo var tf_sprites` 输出中提取：

```bash
# 导出当前 tf_sprites
tavo var tf_sprites > sprites.json

# 手动编辑，提取 name -> id 映射
```

**方法2**：通过 Tavo UI 查看角色列表，复制 ID，手动编写 JSON。

**方法3**：直接查看 Tavo 中的角色搜索结果：

```bash
# 搜索每个角色，记录 ID，手动写 char_ids.json
```

### 复用映射文件

首次 sync 后，映射文件会保存在故事目录下。下次 sync 继续使用：

```bash
# 第二次及以后同步（角色、立绘不变，只更新章节）
tavo sync ".cache/story/谁让这个山大王修仙的" \
  --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json"
```

### 什么时候需要 `--force`

`--reuse-ids` 和 `--force` 是两个独立选项：

- `--reuse-ids`：复用指定 ID，不再搜索/新建
- `--force`：忽略复用逻辑，强制新建（一般不需要）

只有当角色描述有重大更新（如新加大量背景设定），才可能需要 `--force` 重新导入。

### 映射文件的存放位置

建议放在故事目录下，随故事一起管理：

```
.cache/story/谁让这个山大王修仙的/
├── story_sync_config.json   # 同步配置
├── char_ids.json            # 角色 ID 映射
├── avatars/                 # 头像
├── chapters/                # 章节
└── ...
```
