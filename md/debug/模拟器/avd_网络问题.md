# 模拟器无法访问的问题
换了路由等原因可能会导致无法访问网络
- 测试：是否可以打开 插件中心，不能那就是基本是这个原因了
- 解决重启模拟器，进入tavo 打开mcp 服务后，重新转接tcp 


# 如何在不重启的情况下恢复模拟器的网络访问能力？
有五种方案？[avd_网络问题.分析.md](avd_%E7%BD%91%E7%BB%9C%E9%97%AE%E9%A2%98.%E5%88%86%E6%9E%90.md)
结果是不行？

# 那么能不能一个更好的模拟器，或者配置或者命令启动
指定 DNS
emulator -avd Pixel_8_Pro -dns-server 223.5.5.5,114.114.114.114

C:\Users\xxx\.android\avd\Pixel_8_Pro_4.avd\config.ini
加入或修改：
`
dns1=223.5.5.5
dns2=114.114.114.114
`
桥接模式（进阶，彻底绕开 slirp）
emulator -avd Pixel_8_Pro -netfast -qemu -net nic -net bridge,br=br0

路线二：换模拟器
Genymotion（推荐试试）
Genymotion 底层用的是 VirtualBox 而不是 QEMU slirp，网络栈更健壮，宿主机换网后 VirtualBox 的 NAT 会自动重建，不会出现你遇到的"QEMU NAT 表卡死"问题。
优点：网络稳定、启动快、支持桥接/Host-only/NAT 多种模式、有免费个人版
缺点：设备型号有限（不像 AVD 可以自定义任意配置）、Google Play 需要手动装
MuMu 模拟器 / 雷电模拟器
这类国产模拟器底层也是 VirtualBox，网络方面比原生 AVD 稳定得多，而且自带"一键修复网络"功能。但它们更偏游戏/应用测试，开发调试（adb、端口转发）的支持不如 AVD 和 Genymotion。
