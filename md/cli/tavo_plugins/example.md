# 实例
## 同步故事
python -m tavo_plugins sync ".cache/story/谁让这个山大王修仙的" --reuse-ids ".cache/story/谁让这个山大王修仙的/char_ids.json" --skip-plugins
## story.json 控制的故事同步：
python -m tavo_plugins sync --story-json "story.json"
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