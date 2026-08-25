---
name: checker_html
description: 验证 HTML 文件的标签平衡。当用户要求检查 HTML 标签平衡、报告 div 不匹配问题、定位未闭合标签时使用。
---

# HTML 标签平衡检查

检查指定 HTML 文件的开/闭标签是否平衡（特别是 div），快速定位未闭合或多闭合的位置。

## 使用方式

```bash
node "D:/Users/viaco/tools/Toonflow-game/tavo_plugins/.claude/skills/checker_html/checker.mjs" <html_file_path> [<html_file_path> ...]
```

## 实现

脚本逻辑：
1. 跳过 `<script>...</script>` 和 `<style>...</style>` 块
2. 跳过 HTML 注释 `<!-- ... -->`
3. 跳过字符串字面量（`"..."` `'...'`）里的尖括号
4. 识别 void 元素：`area base br col embed hr img input link meta param source track wbr`
5. 自闭合标签 `/>` 不入栈
6. 维护一个 tag 栈，每个开标签入栈，每个闭标签出栈
7. 报告：
   - 栈未空 → 哪些标签没闭合
   - 闭标签但栈空 → 哪些标签多闭合
   - 嵌套错误（标签不匹配）

## 输出

按行号列出所有问题，每条包含：
- 文件名
- 行号
- 问题描述（如 "Unclosed <div> at line 123, opened at line 45"）

