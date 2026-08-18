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

## 批量安装

`sync` 命令内置了批量安装 `plugins/` 下所有插件的功能：

```bash
tavo sync ".cache/story/xxx" --skip-chapters --skip-sprite
```

这会跳过立绘和章节同步，只安装所有插件。
