# tavo var — 读写变量

读取或写入 Tavo 的 chat/global 变量。

tavo cli 命令使用
[tavo_run.md](tavo_run.md)
## 基本用法

```bash
# 读取变量
tavo var tf_sprites

# 写入变量
tavo var tf_sprites '{"key": "value"}'
```

## 选项

| 选项 | 说明 |
|------|------|
| `NAME` | 变量名（必填） |
| `VALUE` | 要写入的值（JSON 字符串或普通文本，留空则读取） |
| `-s, --scope` | 作用域：`chat`（默认）或 `global` |
| `-e, --env PATH` | 指定 .env 文件路径 |

## 作用域说明

- **chat**：变量绑定到当前群聊，切换群聊后数据独立
- **global**：全局变量，所有群聊共享

部分变量（如 `tf_sprites`）通常同时写入两个 scope。

## 示例

### 读取 tf_sprites

```bash
tavo var tf_sprites
```

输出（格式化 JSON）：
```json
{
  "byName": {
    "红缥缈": {
      "id": 26,
      "fg": "files/chat/sprite_fg_26.png",
      "bg": "files/chat/sprite_bg_26.png"
    }
  }
}
```

### 写入字符串值

```bash
tavo var tf_sprite_persona_name 纯小白
```

### 写入 JSON 值

```bash
tavo var tf_sprites '{"byName": {"红缥缈": {"id": 26}}}'
```

### 写入 global scope

```bash
tavo var --scope global tf_sprites '{"byName": {...}}'
```

### 读取 global scope

```bash
tavo var --scope global tf_progress
```

## 常用变量

| 变量名 | 说明 |
|--------|------|
| `tf_sprites` | 角色立绘映射（byName + byId） |
| `tf_sprite_persona_name` | persona 角色名（默认纯小白） |
| `tf_chapter_backgrounds` | 章节背景图映射 |
| `tf_sprite_fallback_bg` | 兜底背景图路径 |
| `tf_story.edit` | 章节内容和状态 |
| `tf_progress` | 当前事件进度（phase/event 索引） |

## JSON 简写

如果值是简单字符串，可以直接写：

```bash
tavo var my_var hello
```

如果是 JSON，必须用引号包裹：

```bash
tavo var my_obj '{"name": "test", "value": 123}'
```
