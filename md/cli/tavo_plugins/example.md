# no_modify
# tavo cli 命令使用
[tavo_run.md](../tavo_run.md)

# 实例
## 同步故事
python -m tavo_plugins sync ".cache/story/谁让这个山大王修仙的" --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json" --skip-plugins
## story.json 控制的故事同步：
story.json 说明
{
  "story_sync_mode": "--all --force --duplicate-delete  --clean-cache",
  "story_sync_file": ".cache/story/谁让这个山大王修仙的/story_sync_config.json"
}
--all 代表完全同步：角色，角色头像,角色立绘，角色音色文件,章节和章节结束条件,开场白，世界书 etc
--force 代表强力模式的同步
--duplicate-delete 代表同名查重只留一个（角色，角色头像,角色立绘，角色音色文件，章节和章节结束条件,开场白，世界书 etc）
--clean-cache 开始同步时清掉 "story_sync_cache" 里的缓存文件
story_sync_file 故事文件夹
story_sync_cache 故事同步过程的缓存数据，如角色id 等。

# 插件
## 已安装插件
python -m tavo_plugins plugins
# 只安装（无 tpg 文件），直接 base64 传给 tavo MCP 安装，不落盘。
python -m tavo_plugins plugins --install-all  --no-tpg

# 安装 + 保存 tpg 文件
python -m tavo_plugins plugins --install-all 

### 重新安装部分插件
tavo plugins --install "toonflow_story_debug_eruda,toonflow_story_event_manager"