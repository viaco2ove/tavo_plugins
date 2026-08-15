# tavo_pluginhub - 插件中心管理脚本

管理 hub.tavo.cc 上发布的插件：列表 / 详情 / 发布 / 更新版本 / 下架 / 删除。

## 前置

`.env` 里配置 `sid=xxx`（从 hub.tavoai.dev 登录后取）。

## 常用命令

```bash
cd script/tavo_pluginhub

# 列出我发布的插件
python pluginhub.py list

# 校验包（不落库）
python pluginhub.py check ../../plugins/toonflow_story_speaker.tpg

# 发布新插件（metadata 自动从 tpg 里的 manifest.json 读取）
python pluginhub.py publish ../../plugins/toonflow_story_speaker.tpg

# 更新已有插件的新版本（两步合一：check-package + publish）
python pluginhub.py update <plugin_id> ../../plugins/toonflow_story_speaker.tpg

# 详情 / 下架 / 删除
python pluginhub.py info <plugin_id>
python pluginhub.py unpublish <plugin_id>
python pluginhub.py delete <plugin_id> --yes
```

## 一键更新全部插件

```bash
# 打包 + 逐个 update（先 list 拿到各插件 _id）
python pluginhub.py list
```

## API 端点对应

| 命令 | HTTP | 路径 |
|------|------|------|
| list | GET | `/api/v1/creator/plugins` |
| info | GET | `/api/v1/creator/plugins/{id}` |
| check | POST | `/{id}/check-package`（不带 id 为纯校验） |
| publish | POST | `/api/v1/creator/plugins`（metadata + plugin_file） |
| update | POST+PATCH | `/{id}/check-package` 然后 `/{id}/publish` |
| unpublish | POST | `/{id}/unpublish` |
| delete | DELETE | `/{id}` |