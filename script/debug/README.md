# Tavo 插件调试方案

## 核心问题：为什么 chrome://inspect/#devices 大概率不行？

`chrome://inspect/#devices` 是 Chrome 用来调试 **Android 设备上的浏览器/WebView** 的工具，依赖 USB ADB 连接 + Chrome DevTools Protocol (CDP) 端点。

关键前提：**Android 的 WebView 默认不暴露 CDP**。App 必须显式调用 `WebView.setWebContentsDebuggingEnabled(true)` 才会被 chrome://inspect 发现。这个开关是**原生层 API，插件（跑在 WebView 的 JS 层）无法开启**。

- Tavo 是 **Android App**，聊天界面通过内嵌 WebView 渲染，插件 HTML 片段注入到这个 WebView 的 DOM 中
- 商店发布的 **release 版默认不开调试开关** → chrome://inspect 看不到
- 只有 Tavo 是 debug 版/测试包，或者用**反编译 APK 加开关重新打包**（见下文"终极方案"），chrome://inspect 才能看到

## 三条实际可行的调试路线

---

### 方案 A：Eruda 注入（推荐 - 在 Tavo 内调试）

Eruda 是一个纯前端实现的「页面内 DevTools」，提供 Console、Elements、Network 面板，不依赖 CDP，在任何 WebView 里都能运行。

**用法**：在插件 HTML 的 `<script>` 最前面加载：

```html
<script src="https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js"></script>
<script>eruda.init();</script>
```

或者用项目里的封装（支持 CDN 失败自动降级）：
```html
<script src="../../debug/eruda_loader.js"></script>
```

**优点**：直接在 Tavo 内运行，能检查真实 DOM、真实 tavo API 调用、真实事件流
**缺点**：需要插件重新打包安装；CDN 依赖网络（可用内联版本解决）

---

### 方案 B：独立浏览器测试台（开发阶段推荐）

用 `debug/test_harness.html` 在 Chrome/Edge 中打开，它提供：
- Mock Tavo API（`mock_tavo.js`）—— 模拟 `tavo.get/set`、`tavo.message.*`、`tavo.plugin.on` 等
- 左侧控制面板：加载插件、模拟消息、触发事件、查看变量
- 右侧渲染区：模拟 Tavo 聊天页面，插件 HTML 挂载于此
- 一键注入 Eruda

**用法**：
1. 本地服务器已启动：`http://127.0.0.1:18923/debug/test_harness.html`
2. 选择插件 → 点击「加载插件」
3. 用控制面板模拟消息、事件，观察插件反应
4. F12 打开浏览器原生 DevTools 做完整调试

**优点**：Chrome 原生 DevTools 全功能（断点、Performance、Memory）
**缺点**：tavo API 是 mock 的，集成行为（真实消息流、主题色等）需要回 Tavo 验证

---

### 方案 C：Tavo 内置 JS 控制台

Tavo 文档（JavaScript API 页面）提到：
> "可以在侧边栏的 JavaScript 控制台中查看日志"

这是 Tavo 自带的日志查看器。在插件代码中用 `console.log/error` 输出，然后在 Tavo 侧边栏查看。

**优点**：无需额外工具，直接在 Tavo 内查看
**缺点**：功能有限（只有日志查看，没有 Elements/Network 面板）

---

## 调试策略建议

| 阶段 | 推荐方案 | 说明 |
|------|---------|------|
| UI 布局 / CSS 开发 | 方案 B（浏览器测试台） | Chrome DevTools 全功能，快速迭代 |
| tavo API 调用逻辑 | 方案 B + mock_tavo.js | 模拟消息/事件，验证逻辑分支 |
| 集成测试（真实环境） | 方案 A（Eruda 注入） | 在真实 Tavo 中检查 DOM 和 API |
| 日常日志查看 | 方案 C（Tavo 内置控制台） | 快速确认 console 输出 |
| 生产排查 | 方案 A + 方案 C | Eruda 看 DOM，控制台看日志 |
| 需要断点调试（终极） | 反编译 APK 开 WebView 调试 | 见下文 |

---

## 终极方案：反编译 APK 打开 WebView 调试开关（唯一能拿到完整 DevTools 的路）

如果 Eruda 的 Console/Elements 不够用，想要 chrome://inspect 的完整 DevTools（断点、Network、Performance）：

1. 拿到 Tavo 的 APK（从安装来源导出：`adb shell pm path <包名>` 或用 MT管理器/APK提取器）
2. `apktool d tavo.apk -o tavo_src` 反编译
3. 在 smali 里找到 WebView 初始化/创建的代码，插入一行：
   ```smali
   invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V
   const/4 v0, 0x1
   ```
   （更简单：直接在 application 的 onCreate 里加）
4. `apktool b tavo_src -o tavo_debug.apk` 重新打包
5. 用 `apksigner`/MT管理器重新签名
6. 卸载原版（**会清数据**）→ 安装签名版 → 连 USB 打开 chrome://inspect

**代价**：每次 Tavo 更新都要重来一遍；签名不一致会清掉聊天数据；部分 App 有签名/完整性校验会闪退。适合"深度调试期"临时用。

## 文件清单

```
debug/
├── eruda_loader.js     # Eruda 注入封装（CDN + 降级）
├── mock_tavo.js       # Tavo API 模拟层（内存/localStorage）
└── test_harness.html   # 独立浏览器调试台（加载插件 + 模拟控制面板）
```
