# 模拟器无法访问网络的问题

换了路由 / WiFi 之后，AVD 内的应用经常出不去外网。

## 现象

- 模拟器内 `ping 8.8.8.8` 100% 丢包
- 模拟器内 `ping api.minimaxi.com` → `unknown host`
- 但模拟器内 `ping 10.0.2.2`（QEMU 给宿主机看的假网关）通
- 模拟器内 `getprop sys.boot_completed` = 1，eth0 状态 UP
- 宿主机 `ping` 外部 API 完全正常
- adb 转发（如 `tcp:7347 → tcp:7347`）正常
- tavo WebView 里 fetch 外网接口报 `Failed to fetch`（TypeError），不走 mcp 通道

## 根因

模拟器的对外网络是 QEMU user-mode networking（slirp）模拟的，**和 emulator.exe 进程绑死**。宿主机换路由/WiFi 之后：

- QEMU 进程里旧的"出口网卡绑定"还指向已消失的宿主机 IP
- 它**不会**自动重新扫描宿主网卡 / 重新建立 NAT 出口
- 任何流量发到 `10.0.2.2`（QEMU 网关）后就被卡住，QEMU 自己也没法转出去

只有在 QEMU 进程退出再起时，slirp 才会重新初始化、重新发现宿主网络。

## 确认方法

```powershell
# 1. 模拟器内部
adb -s emulator-5554 shell "ping -c 2 -W 2 10.0.2.2"   # 通 → QEMU 入口 OK
adb -s emulator-5554 shell "ping -c 2 -W 2 8.8.8.8"     # 100% 丢 → QEMU 出不去
adb -s emulator-5554 shell "ping -c 2 -W 2 10.10.3.1"   # 100% 丢 → 宿主机真实网关也丢

# 2. 宿主机
ping api.minimaxi.com                                     # 通 → 宿主机网络本身没问题
```

`10.0.2.2` 通 + `8.8.8.8` 丢 = 100% 是这个 QEMU NAT 桥失效。

## "不重启" 是否可能

| 方案 | 结果 |
|------|------|
| `adb -s emulator-5554 reboot` | ❌ QEMU 进程没退出，NAT 不会重建；而且重启后路由表都重建了，eth0 短暂不可达 |
| 切飞行模式 `cmd connectivity airplane-mode enable/disable` | ❌ 只是 Android 内部重拨号，跟 QEMU 无关 |
| `svc wifi disable/enable` / `svc data disable/enable` | ❌ 同上 |
| `ip link set eth0 down/up` | ❌ adb shell 权限不够（`Permission denied`） |
| `cmd connectivity reset` | ❌ Android 11+ 砍了这个命令 |
| QEMU monitor 发命令重置网络 | ❌ 你的 AVD 启动命令是 `emulator -avd Pixel_8_Pro`，没带 `-monitor` 也没带 `-qmp`，没端口可连 |
| `adb forward` 重新建一次 | ❌ 这是 host→AVD 端口转发，跟出网无关 |

**结论：架构上堵死，没有干净的不重启方案。** QEMU 进程必须重建。

## "接近不重启" 的折中（推荐）

杀掉 emulator.exe + qemu-system-x86_64.exe，用 `Start-Process` 后台重拉 AVD。AVD 进程是新的但 snapshot/数据/聊天记录都保留，窗口黑屏几秒后恢复。

```powershell
# 1. 查 PID
Get-Process | Where-Object { $_.ProcessName -in 'emulator','qemu-system-x86_64' } |
  Select-Object Id, ProcessName, StartTime | Format-Table

# 2. 杀进程
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "$env:ANDROID_HOME\emulator;$env:ANDROID_HOME\platform-tools;$env:PATH"
Stop-Process -Id <emulator_pid>, <qemu_pid> -Force

# 3. 后台拉起（窗口独立，不会阻塞当前 shell）
Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" `
              -ArgumentList "-avd Pixel_8_Pro" `
              -WindowStyle Normal

# 4. 等 boot
for ($i=0; $i -lt 30; $i++) {
  $b = adb -s emulator-5554 shell getprop sys.boot_completed 2>$null
  if ($b -eq '1') { break }
  Start-Sleep -Seconds 5
}

# 5. 重建 mcp 端口转发（如果之前在用）
adb -s emulator-5554 forward tcp:7347 tcp:7347

# 6. 验证外网
adb -s emulator-5554 shell "ping -c 2 8.8.8.8"   # 应该通了
```

## 长期建议

- 启动 AVD 时加上 `-monitor tcp:127.0.0.1:4444,server,nowait` 或 `-qmp tcp:127.0.0.1:4445,server,nowait`，以后可以从 QEMU monitor 里 `hostfwd_add / slirp_reconnect` 之类的命令试着恢复，不用杀进程
- 宿主机用固定 IP / 固定 DNS，避免换路由时 QEMU 绑定的 IP 突然消失
- 模拟器内应用的关键外网调用（如 llm-optimization 插件）加一个 fallback 通道，QEMU NAT 失效时直接走 tavo 内部桥（如果 tavo 自己有出网能力）
