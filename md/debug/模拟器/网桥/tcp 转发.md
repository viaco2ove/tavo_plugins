# tavo mcp端口进行 tcp 转发    
# 转发到 http://127.0.0.1:7347/mcp
adb -s emulator-5554 forward tcp:7347 tcp:7347
