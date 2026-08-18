# tavo plugins — 列出已安装插件

查看 Tavo 中当前已安装的所有插件及其状态。
tavo cli 命令使用
[tavo_run.md](tavo_run.md)
## 基本用法

```bash
tavo plugins
```

## 输出示例

```
已安装插件:
  [+] Toonflow-角色编排 v2.0.4 (com.toonflow.multi-character-stage)
  [+] Toonflow-立绘背景人像 v1.0.0 (com.toonflow.story-sprite-background)
  [-] Toonflow-LLM优化器 v1.0.0 (com.toonflow.llm-optimization)
```

`[+]` 表示已启用，`[-]` 表示已禁用。

## 通用选项

| 选项 | 说明 |
|------|------|
| `-e, --env PATH` | 指定 .env 文件路径 |

## 安装全部插件（自动生成 tpg 到 plugins_tpg/）

每次安装都会把 tpg 文件保存到 `plugins_tpg/<name>-<version>.tpg`（除非加 `--no-tpg`）。

```bash
python -m tavo_plugins plugins --install-all
```

## 安装部分插件

```bash
python -m tavo_plugins plugins --install "toonflow_story_debug_eruda,toonflow_story_event_manager"
```

## 选项

| 选项 | 说明 |
|------|------|
| `--no-tpg` | 不生成 tpg 文件（默认每次都生成） |
| `--tpg-dir PATH` | tpg 输出目录（默认 plugins_tpg/） |
| `--enable / --no-enable` | 安装后是否启用（默认启用） |