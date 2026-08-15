# Tavo 插件调试指南（Eruda 注入方案）

> 适用场景：Tavo 是 Android App（包名 `app.bitbear.tav`，开发者 Bitbear Limited），
> 插件 UI 通过 `htmlFragments` 机制以 HTML 字符串形式注入聊天页 DOM（共享同一个 WebView 上下文）。
> 本机只能改自己的插件代码，**改不了 Tavo 本身**。

---

## 一、为什么常规的 WebView 调试用不了

Tavo 是**商店发布的 release 版** App，已经确认：

- `dumpsys package app.bitbear.tav` → `flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]`，**没有 DEBUGGABLE**
- 设备 `uid=2000(shell)`，无 su → **未 root**

由此三条"原生层"调试路线全死：

| 路线 | 死因 |
|------|------|
| `chrome://inspect/#devices` | 需要 App `debuggable=true` 或被 root 才能看到 WebView。Tavo 两项都不满足 |
| Frida attach | 非 root 设备上，Frida 只能 ptrace `debuggable=true` 的 App。Tavo 非 debuggable，attach 不上 |
| `adb logcat` | 抓了 35 秒，Tavo 进程（pid 23688）**一行日志都没吐**——release 版 WebView 的 console 不转发到 logcat，完全静默 |

> 想让上面三条复活，唯一办法是**反编译 APK**（`apktool` 解包 → smali 加 `WebView.setWebContentsDebuggingEnabled(true)` + manifest 设 `debuggable=true` → 重签名 → 卸载重装，会清 Tavo 本地数据）。代价大，只在确实需要真断点时才走。详见 `ChromeDev.md`。

**结论**：在不反编译的前提下，唯一能在真机上调试插件 UI/JS 的办法，是**在自己插件里注入 Eruda**（Eruda 是纯 JS 库，不需要任何原生开关）。

---

## 二、Eruda 是什么、能调试个啥

Eruda 是一个**用 JS 画在页面里的迷你 DevTools**。把它内联进插件 HTML，Tavo 加载插件时它就在 WebView 里自动初始化，页面右下角浮出一个调试图标，点开就是面板。

| 能干 | 干不了 |
|------|--------|
| **Console**：看插件 `console.log`/报错堆栈，可直接输 JS 执行 | **没有断点单步**（无 Sources 面板） |
| **Elements**：点选插件 DOM、实时改 CSS 看效果 | 碰不到 Tavo 原生层 |
| **Network**：看插件发起的请求（含 `tavo.*` API 调用） | 看不到 Tavo 内部状态 |
| **Resources / Info**：看 localStorage、页面元信息 | — |

**局限**：它是"观察 + 现场改"工具，不是断点调试器。如果插件不报错、不发起请求、只是静态展示，那确实没什么可看——它的价值只在"插件在真机上行为异常"时（DOM 没渲染、样式不对、事件没触发），让你在真机现场直接查。

---

## 三、注入脚本：`debug/inject_eruda_pack.py`

`.tpg` 本质上是 **ZIP**。Tavo 的 `htmlFragments` 把 HTML 字符串注入 DOM，`<script src="xxx.js">` 的相对路径解析不了（base URL 不是插件包），**所以必须把 `eruda.min.js` 整个内联到 `<script>` 里**才能执行。脚本自动完成这一步。

### 依赖
- `debug/eruda.min.js`（已下载，464KB；如需更新：`curl -sL -o eruda.min.js https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js`）

### 用法
```bash
# 方式 A：直接输出 .tpg（手动传到手机 / 从文件安装）
python debug/inject_eruda_pack.py plugins/toonflow_story_style toonflow_story_style_eruda.tpg

# 方式 B（推荐）：输出目录，配合 MCP 直接安装，不用手动传文件
python debug/inject_eruda_pack.py plugins/toonflow_story_style --outdir debug/_build_style_eruda
```

脚本做的事：
1. 把 `eruda.min.js` 全文读进来
2. 遍历插件目录所有 `.html`，在**最前面**内联插入两块 `<script>`：Eruda 本体 + `eruda.init({...})` 初始化
3. 自动打印诊断日志：`tavo API` 是否可用、`[id^="tf-"]` 插件元素数量等
4. 其他文件（manifest.json、entry.js、png 等）原样复制

> 注入的 init 配置打开了 `console / elements / network / resources / info / settings` 六个面板，`autoScale:true`，半透明主题。

---

## 四、通过 MCP 安装（关键：不用手动传文件）

Tavo 内置 **MCP Server**，提供 `tavo_plugin_install` 等工具。比 `adb push` + 手机手动安装省事得多。

### 前置
1. 手机上 Tavo → **设置 → MCP Server → 启用**（默认关闭）
2. 确认手机当前 IP，更新 `tavo_plugins/.env` 的 `tavo_mcp_url`
   - ⚠️ **IP 会变**：公司网段曾是 `10.10.2.208`，家庭 WiFi 实测 `192.168.31.219`。以 `adb shell ip addr show wlan0` 为准
   - `.env` 字段拼写：`tavo_mcp_toekn`（注意是 `toekn`，不是 token）

### 安装命令
```bash
# 安装 Eruda 注入版目录（pluginId 从 manifest.json 自动读取）
python script/tavo_mcp_use/plugin_install.py debug/_build_style_eruda
```

脚本流程：`build_zip` 打包目录 → base64 → 调 `tavo_plugin_install{pluginId, zipBase64, overwrite:true}` → `tavo_plugin_set_enabled{enabled:true}` → `tavo_plugin_get` 确认。

成功输出示例：
```
=== com.toonflow.story-style  (气泡样式) ===
  install: ok=True version=1.1.2 enabled=True
  get: name=气泡样式 version=1.1.2 enabled=True
```

其他常用参数：
```bash
python script/tavo_mcp_use/plugin_install.py --all          # 安装 plugins/ 下全部
python script/tavo_mcp_use/plugin_install.py --list         # 列出已安装
python script/tavo_mcp_use/plugin_install.py <dir> --check-only   # 只打包校验不安装
```

---

## 五、在真机上验证

1. 手机打开 Tavo → 进**任意聊天页**
2. 看页面**右下角**是否出现 Eruda 悬浮图标（蓝色小齿轮/气泡）
3. 点开 → **Console** 看插件 `console.log` / 报错；**Elements** 点插件 DOM 改 CSS；**Network** 看请求
4. 把 Console 里的报错/日志截出来，就能定位插件在真机上的真实行为

---

## 六、完整工作流（推荐）

```
改插件代码
   → debug/inject_eruda_pack.py <插件> --outdir debug/_build_<名>   （内联 Eruda）
   → script/tavo_mcp_use/plugin_install.py debug/_build_<名>         （MCP 装进 Tavo）
   → 手机打开 Tavo 聊天页 → Eruda 面板看 Console/Elements/Network
```

日常确认插件跑没跑，也可以只用 **Tavo 内置 JS 控制台**（设置 → 聊天设置 → JavaScript 控制台开启），在插件里埋 `console.log` 看输出，零依赖但只能看日志（详见 `Tavo 内置 JS 控制台.md`）。

---

## 七、环境速查

| 项 | 值 |
|----|----|
| Tavo 包名 | `app.bitbear.tav` |
| Tavo debuggable | 否（release 版） |
| 设备 root | 否 |
| adb 路径 | `D:\tools\adb\platform-tools\adb.exe` |
| MCP 端口 | `7347`，路径 `/mcp`，Bearer Token 见 `.env` |
| MCP 配置 | `tavo_plugins/.env`：`tavo_mcp_url` / `tavo_mcp_toekn` |
| Eruda 版 | `3.4.1`（内联文件 `debug/eruda.min.js`，464KB） |
| 调试文件总目录 | `tavo_plugins/debug/`（`inject_eruda_pack.py`、`eruda.min.js`、`README.md`） |
