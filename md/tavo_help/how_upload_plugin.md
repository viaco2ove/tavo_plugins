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

### 常见错误

- `manifest_cover_invalid` - manifest.json 中 cover 引用的文件不存在，需要打包时包含 cover.png
- `x-sid missing` - 需要先登录获取 sid

### 安装插件到 tavo

1. 将 `.tpg` 文件传输到手机
2. 打开 tavo → 设置 → 插件管理 → 从本地文件安装

### 调试技巧

- 插件安装后可在 tavo 设置中查看日志输出
- 修改插件后需要重新安装（先卸载再安装）