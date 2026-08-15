# adb logcat 看原生日志
不用改任何东西。WebView 的 JS 报错、Flutter 层日志，全打在 logcat 里。插件里 console.log 如果 Tavo 转发了，也能在这里看到。

bash
adb logcat -c                          # 先清屏
adb logcat | grep -iE "chromium|flutter|tavo|console"   # 只看相关的