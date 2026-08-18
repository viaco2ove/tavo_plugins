# tavo install — 安装插件

将本地插件目录打包安装到 Tavo。
tavo cli 命令使用
[tavo_run.md](tavo_run.md)
## 基本用法

```bash
tavo install plugins/插件目录名
```

## 选项

| 选项 | 说明 |
|------|------|
| `PLUGIN_DIR` | 插件目录路径（必填） |
| `--enable / --no-enable` | 安装后是否启用（默认启用） |
| `-e, --env PATH` | 指定 .env 文件路径 |

## 示例

```bash
# 安装单个插件
tavo install plugins/toonflow_story_multi_character_stage

# 安装但不启用
tavo install plugins/xxx --no-enable
```

## 工作原理

1. 读取插件目录下的 `manifest.json`，获取 `pluginId`
2. 将目录打包为 zip（排除 `.git`、`__pycache__`、`node_modules`）
3. 调用 MCP `tavo_plugin_install` 上传安装
4. 如 `--enable`，调用 `tavo_plugin_set_enabled`

## 批量安装全部插件

### 方法 1：shell 循环（推荐）

```bash
# Linux / macOS / Git Bash
for d in plugins/*/; do
  echo "==> $d"
  python -m tavo_plugins install "$d"
done

# PowerShell
Get-ChildItem plugins -Directory | ForEach-Object {
  Write-Host "==> $_"
  python -m tavo_plugins install $_.FullName
}
```

### 方法 2：通过 sync 命令

`sync` 在同步过程中会顺便扫描 `plugins/` 目录批量安装：

```bash
python -m tavo_plugins sync ".cache/story/故事名" --skip-chapters --skip-sprite
```

跳过章节和立绘，只批量装插件。

### 注意事项

- 每个插件独立打包上传，几百 KB 也要 1-2 秒
- 批量装 7 个插件大约 10-15 秒
- `tavo` 已有同名插件会自动覆盖（`overwrite=True`）
- 安装失败不会中断，继续装下一个
