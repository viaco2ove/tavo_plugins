# tavo characters — 角色卡管理

列出、搜索或删除 Tavo 中的角色卡（不含 persona）。

## 基本用法

```bash
# 列出全部角色
tavo characters

# 搜索角色
tavo characters 红缥缈
```

## 选项

| 选项 | 说明 |
|------|------|
| `QUERY` | 搜索关键词（留空则列出全部） |
| `-d, --delete ID` | 删除指定 ID 的角色 |
| `--delete-all` | 删除全部角色（需确认） |
| `-e, --env PATH` | 指定 .env 文件路径 |

## 示例

### 列出全部角色

```bash
tavo characters
```

输出：
```
找到 49 个角色：
  [26] 红缥缈
  [27] 白锦儿
  [28] 李玄风
  ...
```

### 搜索角色

```bash
tavo characters 白
```

输出：
```
找到 2 个角色：
  [27] 白锦儿
  [35] 某女子
```

### 删除单个角色

```bash
tavo characters --delete 38
```

会提示确认：
```
确认删除角色 ID=38？此操作不可撤销 [y/N]:
```

### 删除全部角色

```bash
tavo characters --delete-all
```

先列出将要删除的所有角色，再要求确认：
```
将删除以下 49 个角色：
  [2] 红缥缈
  [3] 白锦儿
  ...
确认删除全部？此操作不可撤销 [y/N]:
```

输入 `y` 开始逐个删除，最后报告成功数量。

## 清理重复角色的典型流程

如果同步时产生了重复角色（如 id=2/14/26/38 各4份）：

```bash
# 1. 列出全部，找到要保留的原始 ID（通常是最小的那个）
tavo characters

# 2. 删除全部重复
tavo characters --delete-all
```

> 注意：删除后角色无法恢复，确认好再操作。
