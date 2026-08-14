# tavo 插件

## tavo javascript-api
- https://docs.tavoai.dev/cn/guides/javascript-api/
- https://docs.tavoai.dev/cn/guides/plugin-development/
- https://docs.tavoai.dev/cn/guides/plugins/
- https://docs.tavoai.dev/cn/guides/mcp-server/

## 插件中心
https://hub.tavoai.dev/?lang=zh-CN

## 上传插件

### 打包插件

```powershell
cd plugins/toonflow_story_memory_manager
powershell -File build.ps1
```

插件打包后生成 `.tpg` 文件（本质是 zip 格式）。

### 上传到插件中心

**方式一：网页上传**
1. 登录 https://hub.tavoai.dev/?lang=zh-CN
2. 进入"我的插件"页面
3. 上传 `.tpg` 文件

**方式二：API 上传（开发用）**

需要在 `.env` 文件中配置 `sid`：
```bash
sid=your-sid-here
```

然后执行上传：
```bash
cd plugins
SID=$(grep sid .env | cut -d= -f2)
curl -X POST "https://hub.tavo.cc/api/v1/creator/plugins/check-package?lang=zh-CN" \
  -H "accept: */*" \
  -H "content-type: multipart/form-data" \
  -H "origin: https://hub.tavoai.dev" \
  -H "referer: https://hub.tavoai.dev/account/plugins" \
  -H "x-sid: $SID" \
  -F "plugin_file=@toonflow_story_memory_manager.tpg"
```

返回示例：
```json
{
  "file_name": "toonflow_story_memory_manager.tpg",
  "size": 17991,
  "sha256": "...",
  "package_id": "com.toonflow.story-memory-manager",
  "name": "故事记忆管理器",
  "version": "1.0.0",
  "author": "viaco",
  ...
}
```
### 发布插件,不发布就等于不上传。没有记录的
curl 'https://hub.tavo.cc/api/v1/creator/plugins?lang=zh-CN' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundary03ZAJAKbklBLI9e6' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/new' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}' \
  --data-raw $'------WebKitFormBoundary03ZAJAKbklBLI9e6\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"name":"Toonflow-角色编排","external_url":null,"description":"基于群聊的场景模式编排，动态指定发言者。"}\r\n------WebKitFormBoundary03ZAJAKbklBLI9e6\r\nContent-Disposition: form-data; name="plugin_file"; filename="toonflow_story_multi_character_stage.tpg"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n------WebKitFormBoundary03ZAJAKbklBLI9e6--\r\n'

### 常见错误

- `manifest_cover_invalid` - manifest.json 中 cover 引用的文件不存在，需要打包时包含 cover.png
- `x-sid missing` - 需要先登录获取 sid

### 安装插件到 tavo

1. 将 `.tpg` 文件传输到手机
2. 打开 tavo → 设置 → 插件管理 → 从本地文件安装

### 调试技巧

- 插件安装后可在 tavo 设置中查看日志输出
- 修改插件后需要重新安装（先卸载再安装）


## 其他接口
### 获得插件信息
curl 'https://hub.tavo.cc/api/v1/creator/plugins/6a7f0cbd4364bff66349c0fe?lang=zh-CN' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/6a7f0cbd4364bff66349c0fe/edit' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}'


### 更新版本（版本需大于已发布版本）
curl 'https://hub.tavo.cc/api/v1/creator/plugins/6a7f0cbd4364bff66349c0fe/check-package?lang=zh-CN' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundaryozpfa3B7r569qBn5' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/6a7f0cbd4364bff66349c0fe/edit' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}' \
  --data-raw $'------WebKitFormBoundaryozpfa3B7r569qBn5\r\nContent-Disposition: form-data; name="plugin_file"; filename="toonflow_story_style.tpg"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n------WebKitFormBoundaryozpfa3B7r569qBn5--\r\n'


### 更新后的保存修改
curl 'https://hub.tavo.cc/api/v1/creator/plugins/6a7f0cbd4364bff66349c0fe/publish?lang=zh-CN' \
  -X 'PATCH' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundaryEQpAU8jk9dKSAtuT' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/6a7f0cbd4364bff66349c0fe/edit' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}' \
  --data-raw $'------WebKitFormBoundaryEQpAU8jk9dKSAtuT\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"name":"气泡样式","external_url":null,"description":"单条/多条显示模式 + 气泡透明度调节；其他样式跟随聊天主题。"}\r\n------WebKitFormBoundaryEQpAU8jk9dKSAtuT\r\nContent-Disposition: form-data; name="plugin_file"; filename="toonflow_story_style.tpg"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n------WebKitFormBoundaryEQpAU8jk9dKSAtuT--\r\n'

### 下架插件（不想更新版本那就下架然后删除再上传发布）
curl 'https://hub.tavo.cc/api/v1/creator/plugins/6a7f0cbd4364bff66349c0fe/unpublish?lang=zh-CN' \
  -X 'POST' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'content-length: 0' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/6a7f0cbd4364bff66349c0fe/edit' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}'

### 删除插件
curl 'https://hub.tavo.cc/api/v1/creator/plugins/6a7f0cbd4364bff66349c0fe?lang=zh-CN' \
  -X 'DELETE' \
  -H 'accept: */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'origin: https://hub.tavoai.dev' \
  -H 'priority: u=1, i' \
  -H 'referer: https://hub.tavoai.dev/account/plugins/6a7f0cbd4364bff66349c0fe/edit' \
  -H 'sec-ch-ua: "Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: cross-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36' \
  -H 'x-sid: {sid}'