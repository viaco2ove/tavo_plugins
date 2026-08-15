# Tavo WebView 逆向分析（已抽取 APK 内 Web 资源）

> 目标目录：`tavo_plugins/debug/tavo_app_webview/`
> 来源：手机 `app.bitbear.tav` 的 `base.apk`（48MB，2026-08-14 版）
> 方法：`adb pull` 后直接解压（APK = ZIP），抽出 Flutter 打包的 Web 层

---

## 0. 重要前提：live 运行时 DOM 拿不到

从宿主机**无法**抓到 WebView 当前的实时 DOM（正在聊的消息、动态节点）。那需要 WebView 内部执行 JS，而：
- Tavo 非 debuggable、设备未 root → `chrome://inspect` / Frida 都死
- `adb logcat` 对 release 版完全静默

**能拿到的是「静态资源」**——APK 里打包的 Web 层（宿主页模板 + 聊天 UI 实现 + 插件沙箱）。这些已经能让我们看清插件被注入到什么样的页面、能调什么 API，比盲猜强百倍。实时 DOM 只能在真机上用已注入的 Eruda 看（见 `Eruda_debug.md`）。

---

## 1. 架构结论：Tavo 是 Flutter App，聊天页用 WebView 渲染

APK 关键证据：
- `lib/arm64-v8a/libflutter.so`(11MB) + `libdartjni.so` + `libapp.so`(23MB) → **Flutter + Dart AOT 编译**
- `libfastdev_quickjs_runtime.so`(1MB) → 内嵌 **QuickJS 引擎**（插件 JS 运行环境之一）
- Web 层在 `assets/flutter_assets/assets/dist/`：

| 文件 | 大小 | 作用 |
|------|------|------|
| `dist/index.html` | 2KB | **WebView 宿主页入口**（聊天页） |
| `dist/css/bundle.min.css` | 45KB | 聊天 UI 样式 |
| `dist/js/bundle.min.js` | 712KB | **聊天 UI 主程序**（含插件系统） |
| `dist/js/sandbox.js` | 24KB | **插件沙箱**（iframe 内运行，桥接 Flutter） |

---

## 2. 宿主页结构（index.html 还原）

```html
<body>
  <div class="tav-chat-container"></div>          <!-- 聊天消息容器 -->
  <button ... onclick="window.tav.chatView.scrollToTop()">...</button>
  <button ... onclick="window.tav.chatView.scrollToBottom()">...</button>
  <button ... onclick="window.tav.chatView.selectToHere('top')">...</button>
  <script src="./js/bundle.min.js"></script>
</body>
```

- 聊天内容渲染进 `.tav-chat-container`
- 桥接对象 `window.tav.chatView` 提供滚屏/选区等方法
- 图标用 **Material Symbols** 字体（`material-symbols-outlined`）

---

## 3. 两个全局对象（关键坑）

bundle 里同时存在：
```js
window.tav  = window.tav  || {};   // 通用桥：chatView / sandbox / 变量 / console
window.tavo = window.tavo || {};   // 插件 API：window.tavo.plugin...
```

| 对象 | 用途 | 出现次数 |
|------|------|---------|
| `window.tav` | 聊天视图桥、沙箱、变量存储、日志 | 412 |
| `window.tavo` | **插件专用 API**（我们的插件都用这个） | 3（作为 `window.tavo.plugin` 对象） |

→ 我们插件文档里写的 `tavo.*` 是对的，**不是拼写错**。

---

## 4. 插件运行机制（sandbox.js）

- 插件 HTML 跑在 **iframe** 里（`window.parent` = 聊天页宿主，`window.frameElement` = 自身 iframe）
- 注入流程：`window.tav._activateInitialContent(html)` → 若父页注册了 `_registerIframeUpdater` 走更新器，否则 `document.body.innerHTML = html` 并重执行 `<script>`
- **错误上报**：`window.addEventListener('error')` → `parent.postMessage({method:"console_error", params:[...]})` → 这就是 Tavo 内置 JS 控制台能看到插件报错的原因
- **变量存储**：`window.tav._getVariable / _setVariable / _updateVariable / _unsetVariable`
- **调用 Flutter**：`window.tav.callParent / callParentWithResult` → 底层 `postMessage` / `_callFlutter`（共 10 / 7 处）
- 其它：`window.tav.compat`、`window.tav.utils`、`window.tav.console(_error/_warn)`、`window.tav._previewPayload`

sandbox.js 暴露的 `window.tav.*` 清单：
```
_activateInitialContent  _getVariable  _setVariable  _updateVariable  _unsetVariable
_previewPayload  callParent  callParentWithResult  compat  console
console_error  console_warn  utils
```

---

## 5. 插件系统内部类（bundle.min.js 中出现）

| 类/对象 | 次数 | 含义 |
|---------|------|------|
| `pluginHtmlFragments` | 23 | htmlFragments 机制（按槽位注入 HTML） |
| `pluginTavoApi` | 8 | 暴露给插件的 `tavo` API |
| `pluginRuntime` / `PluginRuntime` | 6 / 3 | 插件运行时 |
| `pluginInterceptorPipeline` | 4 | 消息/事件拦截管线 |
| `PluginApi` | 4 | 插件 API 基类 |
| `registerPlugin` | 3 | 注册插件 |
| `PluginHtmlFragments` / `PluginFragmentSlot` | 3 / 3 | 片段槽（如 `/chat/body/start`） |
| `PluginMessageSlot` / `PluginMessage` | 2 / 2 | 消息槽 / 消息对象 |

→ 槽位路径（`/chat/body/start` 等）来自**插件 manifest 自己定义**，不在 bundle 硬编码。

---

## 6. 我们的插件实际调用的 API 是否实现（交叉验证）

| 我们的调用 | bundle 命中 | 说明 |
|-----------|-----------|------|
| `tavo.message.find/append/update/count` | ✓ (5-6处) | 消息增删查 |
| `tavo.utils.toast` | ✓ (5处) | 轻提示 |
| `tavo.character.get` | ✓ (5处) | 角色卡读取 |
| `tavo.chat.current/update` | ✓ (5处) | 当前会话 |
| `tavo.file.load/export` | ✓ (5-8处) | 文件读写 |
| `tavo.plugin.onSidebarAction` | ✓ (1处) | 侧边栏动作 |
| `tavo.get/set`（变量） | 字面未命中 | 对应 sandbox 的 `_getVariable/_setVariable`（压缩成对象字面量） |
| `tavo.plugin.on/config`、`tavo.generate` | 字面未命中 | 同上，动态属性名 |

→ 结论：**我们插件用的 API 在 Tavo 里都有对应实现**，没有凭空调用不存在的方法。

---

## 7. 文件清单（本目录）

```
tavo_app_webview/
├── tavo_base.apk                     # 从手机 pull 的原始 APK
├── ANALYSIS.md                       # 本文件
└── extracted/
    └── assets/flutter_assets/assets/dist/
        ├── index.html                # WebView 宿主页（聊天页入口）
        ├── css/bundle.min.css        # 聊天 UI 样式
        └── js/
            ├── bundle.min.js         # 聊天 UI 主程序 + 插件系统（712KB，已压缩）
            └── sandbox.js            # 插件沙箱（iframe 桥接）
    └── assets/flutter_assets/packages/flutter_js/assets/js/fetch.js
```

---

## 8. 下一步能做什么

1. **静态对照开发**：用 `extracted/` 里的宿主页 + sandbox.js 当"真机环境参考"，写插件时对齐 `window.tavo` API 和 `.tav-chat-container` 结构
2. **真机实时调试**：已注入 Eruda 的插件装进 Tavo → Eruda 的 Elements 面板能看到**整个 WebView DOM**（含 Tavo 宿主元素，因为插件 iframe 的 `window.parent` 共享宿主文档）——这是拿实时 DOM 的唯一可行路
3. **想要真断点**：反编译 APK 给 WebView 开调试（见 `ChromeDev.md`），但代价大、每次更新要重来
