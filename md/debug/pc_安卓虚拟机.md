# PC调试 Tavo插件，两条路选哪条?
1 A.Android Studio AVD模拟器(推荐)
2 B.本地宿主页面+手写mock桥

# PC 调试方案选项：

Android 模拟器（AVD / Genymotion / MuMu / 雷电）—— 模拟器里可 root，Tavo 装 debuggable 版本或反编译版，chrome://inspect 可用。最贴近真机。
WSA（Windows Subsystem for Android）—— 微软已停止支持（2024年3月停止支持，2025年3月终止），不推荐。
浏览器测试台（我们已经有 debug/test_harness.html）—— 桌面 Chrome 模拟 Tavo 环境，F12 全功能 DevTools。但 mock_tavo.js 是手写的，不完整。
本地宿主页面 + 真实插件加载——把抽出的 index.html + bundle.min.js + sandbox.js 搭一个本地 WebView 容器，在 Chrome 里跑真 Tavo 宿主，挂真实插件，F12 全功能。这个我之前没考虑，但这是最有价值的——用 Tavo 真实宿主代码 + 真实插件，跑在 Chrome 里，调试就是真 DevTools。


[ChromeDev.md](ChromeDev.md)

# avd
AVD（Android Virtual Device）是 Google 官方提供的 Android 虚拟设备工具，集成在 Android Studio 中，主要用于 Android 应用开发和测试。下面从多个维度将它与其他主流虚拟机/模拟器进行对比。
## AVD 的优点
官方原生，兼容性最强：作为 Google 官方工具，AVD 拥有最快的系统版本更新速度，始终提供最新的 Android SDK 和 API 支持，是测试最新 Android 特性的首选。
高度可定制：支持从屏幕尺寸、分辨率、RAM、CPU 架构（x86_32、x86_64、ARM、MIPS）到系统版本的全方位自定义配置，能模拟手机、平板、Wear OS、TV 及 Automotive OS 等多种设备形态。
与 Android Studio 深度集成：无需额外安装，可直接在开发环境中一键运行和调试应用，支持传感器模拟（重力感应、GPS）、电话/短信模拟等复杂场景。
支持硬件加速：可通过 HAXM（Intel）或 Hypervisor（AMD）等虚拟化技术提升性能，选择 x86_64 镜像时效果显著。
适合自动化测试：提供命令行工具（avdmanager、emulator），方便集成到 CI/CD 流水线中。

人话：你完全可以叫 workbuddy 等ai 工具帮你在AVD 安装程序和配置程序和点击操作。并且自动化测试。
## AVD 的缺点
启动速度慢：相比 Genymotion 等第三方工具，AVD 的冷启动时间明显更长。
资源占用大：对 CPU、内存等系统资源消耗较高，在低配机器上容易出现卡顿。
运行稳定性波动：在高负载场景下可能出现卡顿或崩溃，体验不如部分第三方模拟器流畅。
图形性能有限：部分虚拟设备使用软件图形渲染，图形密集型应用的性能会打折扣。
UI 交互体验一般：与真机相比，操作手感略显生硬。


[avd 命令.md](avd%20%E5%91%BD%E4%BB%A4.md)