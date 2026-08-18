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
