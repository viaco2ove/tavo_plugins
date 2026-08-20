# avd 安卓模拟器开机卡住
## 推荐：
在 Device Manager 中点 编辑（铅笔图标）
点 Show Advanced Settings
向下找到 Emulated Performance → Graphics
把 Automatic 或 Hardware 改成 Software - GLES 2.0
## 不行再
Wipe Data（清除数据）
在 Android Studio 中操作：
打开 Device Manager（Tools → Device Manager）
找到 Pixel_8_Pro，点右边的 三个点 ⋮
选 Wipe Data
再重新启动