指定 DNS
emulator -avd Pixel_8_Pro -dns-server 223.5.5.5,114.114.114.114

C:\Users\xxx\.android\avd\Pixel_8_Pro_4.avd\config.ini
加入或修改：
`
dns1=223.5.5.5
dns2=114.114.114.114
`


@echo off
emulator -avd Pixel_8_Pro -dns-server 223.5.5.5,114.114.114.114 -netdelay none -netspeed full