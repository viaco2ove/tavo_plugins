# 反编译 Tavo APK 开启 WebView 调试（chrome://inspect 真断点）

> 适用：想拿到 **chrome://inspect 完整 DevTools**（断点单步 / Network / Elements / Performance）
> 前置结论：Tavo 是 **Flutter + Dart** 的 release 版，非 debuggable、设备未 root。
> 因此 `chrome://inspect` / Frida / `adb logcat` 三条原生路全死（详见 `ChromeDev.md` 与 `Eruda_debug.md`）。
> 唯一能"复活" chrome://inspect 的办法：**改 APK 本身**，强行打开 WebView 调试开关。

---

## 一、原理

Android 的 WebView 调试开关由两条规则决定（满足任一即可被 `chrome://inspect` 发现）：

1. **App `debuggable=true`** → WebView 自动开启 WebContents 调试（系统层默认行为）
2. **代码调用 `WebView.setWebContentsDebuggingEnabled(true)`** → 强制开启，无视 debuggable

Tavo 的聊天页跑在真实 `android.webkit.WebView` 里（APK 内 `assets/flutter_assets/assets/dist/index.html` 就是宿主页，由 Flutter 的 WebView 平台视图承载）。所以我们只要让 Tavo 满足上面任一条件，chrome://inspect 就能看到它的 WebView，拿到完整 DevTools。

> 注：Tavo 内嵌了 `libfastdev_quickjs_runtime.so`（QuickJS），那是插件 JS 的另一运行环境；但**聊天 UI（bundle.min.js + index.html）是标准 WebView**，受上述规则约束。

---

## 二、代价与风险（务必先读）

| 风险 | 说明 |
|------|------|
| **清数据** | 重签名后签名与原版不同 → 必须 `adb uninstall` 再装 → **Tavo 全部本地数据清空**（聊天记录、已装插件、设置） |
| **可能启动崩溃** | Flutter App 常有运行时签名/完整性校验（Play Integrity 等）。重签后若校验失败，Tavo 可能直接闪退或报"环境异常" |
| **每次更新重来** | Tavo 一发版，需重新 pull → 反编译 → 改 → 签 → 装，循环 |
| **耗时** | 首次需下载 apktool，反编译(48MB APK) + 回编 + 签名约几分钟 |

**结论**：这是"杀招"，仅在确实需要真断点时才用。日常排查优先用 `Eruda_debug.md`（注入 Eruda，不动 Tavo、不丢数据）。

---

## 三、本机环境（已确认）

| 工具 | 状态 | 路径 |
|------|------|------|
| `apksigner` | ✅ 已有 | `D:/Android/Sdk/build-tools/34.0.0/apksigner.bat`（34/35/36/37 均存在） |
| `keytool` | ✅ 已有 | `D:/Program Files/Java/jdk1.8.0_161/bin/keytool.exe`（或 JDK17） |
| `adb` | ✅ 已有 | `D:/tools/adb/platform-tools/adb.exe` |
| `apktool` | ❌ 需下载 | 见步骤四 |
| Java | ✅ 已有 | JDK8 / JDK17 |

---

## 四、步骤

### 4.1 准备 apktool

```bash
# 下载 apktool.jar（最新 2.x）到 D:/tools/apktool/
mkdir -p D:/tools/apktool
curl -sL -o D:/tools/apktool/apktool.jar https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar
# 用法封装（可选）：建 D:/tools/apktool/apktool.bat
#   @echo off
#   java -jar "%~dp0apktool.jar" %*
```

> 若 GitHub 下载慢，可用镜像：`https://bitbucket.org/iBotPeaches/apktool/downloads/apktool_2.11.1.jar`

### 4.2 反编译

```bash
APK=D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/tavo_base.apk
OUT=D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/apktool_out
java -jar D:/tools/apktool/apktool.jar d -o "%OUT%" "%APK%"
```

产出 `apktool_out/`：含 `AndroidManifest.xml`（已反编译为可读 XML）、`smali/`（`classes.dex` 反编译的 Dalvik 字节码）、`assets/`、`res/` 等。

### 4.3 改 manifest：加 debuggable=true（核心）

编辑 `apktool_out/AndroidManifest.xml`，在 `<application ...>` 标签内加属性：

```xml
<application
    android:debuggable="true"
    ... (原有属性保留) >
```

> 这一步通常**单独就够**让 chrome://inspect 看到 WebView。下一步 smali 注入是兜底。

### 4.4 （兜底）smali 注入 setWebContentsDebuggingEnabled(true)

若 4.3 后 chrome://inspect 仍看不到，再补这一步：

1. 找 Application 子类：在 `apktool_out/smali/` 搜 `extends Landroid/app/Application;` 或搜 `onCreate` 中较早执行的 `attachBaseContext`
2. 在该方法**最前面**插入（用未被占用的寄存器，示例用 `v0`）：

```
    invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V
```

完整片段示例（在 `onCreate` 开头）：
```smali
.method public onCreate()V
    .locals 1
    # >>> 注入开始 >>>
    const/4 v0, 0x1
    invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V
    # <<< 注入结束 <<<
    invoke-super {p0}, Landroid/app/Application;->onCreate()V
    ...
.end method
```

> ⚠️ 寄存器冲突：若 `v0` 在该方法已用，改用方法里明显空闲的寄存器（看 `.locals N` 和已有 `vN` 使用）。写错寄存器会回编失败或运行崩溃。

### 4.5 回编

```bash
java -jar D:/tools/apktool/apktool.jar b -o "D:/.../tavo_debug.apk" "%OUT%"
```

### 4.6 生成签名 keystore（一次性）

```bash
"D:/Program Files/Java/jdk1.8.0_161/bin/keytool.exe" -genkeypair ^
  -alias tavo_debug -keyalg RSA -keysize 2048 -validity 3650 ^
  -keystore D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/debug.keystore ^
  -storepass tavo123 -keypass tavo123
# 按提示填姓名/组织等（可全回车跳过）
```

### 4.7 签名

```bash
D:/Android/Sdk/build-tools/34.0.0/apksigner.bat sign ^
  --ks D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/debug.keystore ^
  --ks-pass pass:tavo123 --key-pass pass:tavo123 ^
  --out D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/tavo_debug_signed.apk ^
  D:/Users/viaco/tools/Toonflow-game/tavo_plugins/debug/tavo_app_webview/tavo_debug.apk
```

### 4.8 安装（⚠️ 会清数据）

```bash
adb uninstall app.bitbear.tav          # 先卸原版（签名不同，必须卸）
adb install "D:/.../tavo_debug_signed.apk"
```

### 4.9 验证

1. 手机打开 Tavo → 进聊天页
2. 桌面 Chrome 打开 `chrome://inspect/#devices`，勾选 "Discover USB devices"
3. 等几秒 → 列表应出现 `app.bitbear.tav` 或 `WebView` 条目
4. 点 **inspect** → 完整 DevTools：Sources 断点 / Network 请求 / Elements DOM 全有

---

## 五、故障排查

| 现象 | 原因 / 对策 |
|------|------------|
| chrome://inspect 仍无 Tavo | 确认 4.3 已加 `debuggable=true` 且回编成功；再补 4.4 smali 注入；确认 Tavo 进程在跑 |
| Tavo 安装后闪退 / 报"环境异常" | 命中运行时签名校验。对策：搜索 `apktool_out/smali/` 里 `getPackageInfo`/`signatures`/`PackageManager` 相关校验逻辑尝试 patch；或放弃此路 |
| apksigner 报 `no keystore` | 确认 4.6 keystore 路径、密码与 4.7 一致 |
| 回编失败 `register X is used` | smali 寄存器冲突，回到 4.4 换空闲寄存器 |
| 看不到 WebView 子进程 | 确认 Tavo 确实进到含 WebView 的页面（聊天页），部分页面可能不是 WebView |

---

## 六、替代方案：Android 模拟器（不损真机数据）

若不想清真机 Tavo 数据，可用 Android Studio AVD 起一个**可 root / eng 版**模拟器：

- 模拟器能 root → 装 frida-server → 运行时 hook `setWebContentsDebuggingEnabled(true)`（比改 APK 轻，不重签、不丢数据）
- 或在模拟器里装改过的 debug APK，验证通过后再决定动真机

缺点：Tavo 可能需要账号登录 / 设备绑定，模拟器环境能否跑通未知。

---

## 七、一句话总结

**改 `AndroidManifest.xml` 加 `android:debuggable="true"` → apktool 回编 → 自签 → 重装（清数据）→ chrome://inspect 拿真断点。** 代价是清 Tavo 数据 + 可能撞签名校验。日常优先 Eruda，真要断点才走这条。
