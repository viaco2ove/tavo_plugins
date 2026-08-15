Android 系统中，每个 App 的 WebView 都需要在代码中单独调用 WebView.setWebContentsDebuggingEnabled(true) 才能被检测到
或者root 后进行别的操作。可以在pc 上安装个虚拟机 然后进行模拟
或者反编译
[README.md](../../debug/README.md)

# Chrome 远程调试安卓h5
`chrome://inspect/#devices`
然后点击inspect 或者 inspect fallback
![img.png](img.png)

## 没有看见inspect？
没有看见设备？等个几分钟再说

原因：很有可能是设备被占用了。例如android studio 和Chrome DevTools 互相占用
解除占用：
1. 重启 ADB 服务（最有效）
   这是解决设备不显示问题的第一选择：
```
adb kill-server
adb start-server
adb devices
```

刷新chrome://inspect/#devices页面

2.手机的仅充电<->传输 ,有问题就换成另一个模式。
直到device
(base) PS C:\Users\viaco> adb devices
List of devices attached
3B65CS012RH00000        device
emulator-5554   device

3.chrome://inspect/#devices 
没有看见设备？等个几分钟再说

## 其他问题？
自己研究吧！