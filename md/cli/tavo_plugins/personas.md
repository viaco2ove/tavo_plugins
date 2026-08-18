# tavo personas — persona 管理

列出、搜索或删除 Tavo 中的 persona（用户身份）。

## 基本用法

```bash
# 列出全部 persona
tavo personas

# 搜索 persona
tavo personas 纯小白
```

## 选项

| 选项 | 说明 |
|------|------|
| `QUERY` | 搜索关键词（留空则列出全部） |
| `-d, --delete ID` | 删除指定 ID 的 persona |
| `-e, --env PATH` | 指定 .env 文件路径 |

## 示例

### 列出全部 persona

```bash
tavo personas
```

输出：
```
找到 4 个 persona：
  [P1] User
  [P2] 纯小白
  [P3] 纯小白
  [P4] 纯小白
```

> 注意：Tavo 可能为 persona 分配了 ID 1（User）和多个同名 persona。

### 搜索 persona

```bash
tavo personas 纯小白
```

### 删除单个 persona

```bash
tavo personas --delete 4
```

会提示确认：
```
确认删除 persona ID=4？此操作不可撤销 [y/N]:
```

## 与 characters 的区别

| 命令 | 管理范围 |
|------|---------|
| `tavo characters` | 普通角色卡（Npc） |
| `tavo personas` | 用户身份（persona） |

- 角色卡（character）：故事中的 NPC、旁白等
- persona：当前登录用户的身份设定

## 清理重复 persona 的典型流程

```bash
# 1. 列出全部 persona
tavo personas

# 2. 删除重复的（保留一个）
tavo personas --delete 4
tavo personas --delete 3
```
