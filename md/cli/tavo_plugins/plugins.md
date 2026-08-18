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

## 重新安装全部插件，直接 base64 传给 tavo MCP 安装，不落盘。
tavo plugins --install-all  

## 安装并生成 tpg 文件到 plugins_tpg/
tavo plugins --install-all --keep-tpg


## 重新安装部分插件
tavo plugins --install "toonflow_story_debug_eruda,toonflow_story_event_manager"