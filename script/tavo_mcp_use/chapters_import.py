#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
chapters_import.py - 从故事缓存目录导入章节到 tavo（静态数据同步）

读取 <story_dir>/chapters/*.json（Toonflow 章节格式），转成 tavo 插件的
tf_story.edit.chapters 结构并写入群聊变量。同时可发布 intro/globalBackground。

章节 JSON 格式（.cache/story/xxx/chapters/chapter_N.json）：
  title, sort, openingRole, openingText, completionCondition, background, backgroundPrompt, content

关于背景图（重要）
----------------
`backgroundPrompt` 是给 AI 生图的提示词（调用 tavo_image_generate），NOT 图片路径。
`background` 字段（若有）是故事源里的本地图片路径（如 image/bg.jpg）。

本脚本把"真实可用的背景图路径"写入 edit.chapters[i].background，流程如下（--bg 控制）：
  auto（默认）: 优先上传本地 background 图（最稳、不耗生图额度）；本地没有则调 tavo_image_generate 生图
  local       : 只上传本地 background 图，绝不调生图
  generate    : 只调 tavo_image_generate 从 backgroundPrompt 生图（需 tavo 已配置图像后端）
  skip        : 不动 background（仅保留 backgroundPrompt 文本）

背景图落库用 tavo_file_save，返回 files/<scope>/<name> 虚拟路径（面板可渲染）。
生图端点不可用时（AVD 常报 Unsupported resource type: imageEndpoint），generate/auto 会
清晰告警并继续，绝不崩整个导入、也绝不把提示词当路径写进去。

用法：
  python chapters_import.py 8 <story_dir>                         # 导入章节（auto：有本地图就传本地）
  python chapters_import.py 8 <story_dir> --bg generate          # 强制用 backgroundPrompt AI 生图
  python chapters_import.py 8 <story_dir> --bg local --with-intro
  python chapters_import.py 8 <story_dir> --dry                  # 预览（不写库、不生图）
  python chapters_import.py 8 <story_dir> --force-bg             # 强制重传/重生背景图
"""
import os
import sys
import json
import base64
import argparse
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # = tavo_plugins（含 .env）


def load_env(path):
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def resolve_auth(args):
    env = load_env(os.path.join(ROOT, ".env"))
    url = args.url or env.get("tavo_mcp_url")
    token = args.token or env.get("tavo_mcp_toekn") or env.get("tavo_mcp_token")
    if not url or not token:
        sys.exit("缺少 MCP 配置（--url/--token 或 .env）")
    return url.rstrip("/"), token


def rpc(url, token, method, arguments, timeout=120):
    """发 tools/call，返回工具内部 JSON（自动解 content[0].text 包裹）。"""
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": method, "arguments": arguments}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + token},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:400]
        except Exception:
            pass
        raise RuntimeError("MCP HTTP %s: %s" % (e.code, detail))
    except urllib.error.URLError as e:
        raise RuntimeError("MCP 连接失败（Server 是否启用？URL/IP 是否正确？）: %s" % e)
    if "error" in body:
        raise RuntimeError(body["error"].get("message", "MCP error"))
    return content_text(body.get("result", {}))


def content_text(result):
    """MCP 工具结果通常是 {'content':[{'type':'text','text':'{...json...}'}]}；
    取第一个 text 块尝试 JSON 解析，拿不到就原样返回。"""
    if not isinstance(result, dict):
        return result
    content = result.get("content")
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                t = c.get("text", "")
                try:
                    return json.loads(t)
                except Exception:
                    if t.startswith("files/") or "data:" in t:
                        return t
                    return result
    return result


def var_get(url, token, chat_id, name):
    """读 chat 变量，正确解包 tavo 的 {found, value} 包装（global 优先，回退 chat）。"""
    try:
        r = rpc(url, token, "tavo_variable_get", {"scope": "global", "name": name})
        v = r.get("value") if isinstance(r, dict) and "value" in r else None
        if isinstance(v, dict) and v.get("chapters") is not None:
            return v
    except Exception:
        pass
    r = rpc(url, token, "tavo_variable_get", {"scope": "chat", "chatId": chat_id, "name": name})
    if isinstance(r, dict) and "value" in r:
        return r.get("value")
    return r if isinstance(r, dict) else {}


def var_set(url, token, chat_id, name, value):
    """双写：global + chat scope。tavo_chat_reset 会清 chat，但 global 不受影响。"""
    r1 = r2 = None
    try:
        r1 = rpc(url, token, "tavo_variable_set", {"scope": "global", "name": name, "value": value})
    except Exception as e:
        r1 = {"__error": str(e)}
    try:
        r2 = rpc(url, token, "tavo_variable_set", {"scope": "chat", "chatId": chat_id, "name": name, "value": value})
    except Exception as e:
        r2 = {"__error": str(e)}
    return {"global": r1, "chat": r2}


# ---------------------------------------------------------------------------
# 背景图处理
# ---------------------------------------------------------------------------
def b64_of(abs_path):
    with open(abs_path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def extract_path(result):
    """从 tavo_image_generate / tavo_file_save 的返回里抽出 files/... 路径。"""
    if isinstance(result, str):
        if result.startswith("files/"):
            return result
        return None
    if not isinstance(result, dict):
        return None
    if isinstance(result.get("path"), str) and result["path"].startswith("files/"):
        return result["path"]
    for key in ("file", "artifact", "image"):
        sub = result.get(key)
        if isinstance(sub, dict) and isinstance(sub.get("path"), str) and sub["path"].startswith("files/"):
            return sub["path"]
    # content 块里可能直接是路径文本
    content = result.get("content")
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                t = c.get("text", "")
                if t.startswith("files/"):
                    return t
    return None


def extract_b64(result):
    """从 tavo_image_generate 的返回里抽 base64 / dataUrl（若它没直接给 path）。"""
    if not isinstance(result, dict):
        return None
    content = result.get("content")
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                t = c.get("text", "")
                if t.startswith("data:"):
                    return t.split("base64,", 1)[-1]
    for key in ("data", "base64", "content_b64", "image"):
        v = result.get(key)
        if isinstance(v, str) and len(v) > 100:
            return v.split("base64,", 1)[-1]
    return None


def file_save_bytes(url, token, chat_id, name, b64, scope, dry, timeout=180):
    """上传 base64 图片到 tavo，返回 files/<scope>/<name> 路径。"""
    if dry:
        return "files/%s/%s" % (scope, name)
    res = rpc(url, token, "tavo_file_save",
              {"chatId": chat_id, "name": name,
               "content": b64, "options": {"scope": scope, "encoding": "base64"}},
              timeout=timeout)
    path = extract_path(res)
    if not path:
        raise RuntimeError("tavo_file_save 未返回 path：%s" % json.dumps(res, ensure_ascii=False)[:200])
    return path


def image_generate(url, token, chat_id, prompt, name, scope, dry, timeout=300):
    """调 tavo_image_generate 从提示词生图，返回 files/<scope>/<name> 路径。

    端点不可用时抛 RuntimeError（由调用方决定降级/告警）。"""
    if dry:
        return "files/%s/%s" % (scope, name)
    res = rpc(url, token, "tavo_image_generate",
              {"chatId": chat_id, "prompt": prompt,
               "options": {"saveAs": name, "scope": scope, "aspectRatio": "16:9"}},
              timeout=timeout)
    path = extract_path(res)
    if path:
        return path
    b64 = extract_b64(res)
    if b64:
        return file_save_bytes(url, token, chat_id, name, b64, scope, dry)
    raise RuntimeError("tavo_image_generate 未返回路径/图片数据: %s" % json.dumps(res, ensure_ascii=False)[:300])


def find_local_bg(story_dir, base, declared_bg):
    """按约定找章节本地背景图：image/<base>_background.<ext> 优先，其次源 JSON 的 background 路径。"""
    for ext in ("png", "jpg", "jpeg", "webp"):
        p = os.path.join(story_dir, "image", "%s_background.%s" % (base, ext))
        if os.path.isfile(p):
            return p
    if declared_bg:
        cand = [declared_bg,
                os.path.join(story_dir, declared_bg),
                os.path.join(story_dir, "image", os.path.basename(declared_bg))]
        for c in cand:
            if os.path.isfile(c):
                return c
    return None


def resolve_background(url, token, chat_id, ch, story_dir, bg_mode, bg_scope, dry, force,
                       existing_bg):
    """返回 (background_path, note)。background_path 为空串表示无背景。"""
    prompt = ch.get("backgroundPrompt") or ""
    base = ch.get("_base", "chapter")
    declared_bg = ch.get("background") or ""  # 源 JSON 的本地图路径（非 tavo 路径）

    # 已存在且非强制 -> 直接复用，避免重复生图/上传
    if existing_bg and not force:
        return existing_bg, "复用已有背景 %s" % existing_bg

    if bg_mode == "skip":
        return "", "skip（不处理背景）"

    # 1) 本地图上传（local / auto 走这里）
    if bg_mode in ("local", "auto"):
        local = find_local_bg(story_dir, base, declared_bg)
        if local:
            ext = os.path.splitext(local)[1].lstrip(".") or "png"
            fname = "%s_background.%s" % (base, ext)
            try:
                b64 = b64_of(local)
                path = file_save_bytes(url, token, chat_id, fname, b64, bg_scope, dry)
                return path, "上传本地图 %s -> %s" % (os.path.basename(local), path)
            except Exception as e:
                return "", "本地图上传失败: %s" % e
        if bg_mode == "local":
            return "", "local 模式且无本地图，跳过"

    # 2) AI 生图（generate / auto 走到这里）
    if bg_mode in ("generate", "auto"):
        if not prompt:
            return "", "无 backgroundPrompt，无法生图"
        fname = "%s_bg_gen.png" % base
        try:
            path = image_generate(url, token, chat_id, prompt, fname, bg_scope, dry)
            return path, "AI 生图(tavo_image_generate) -> %s" % path
        except Exception as e:
            return "", "AI 生图失败（端点不可用？）: %s" % e

    return "", "未设置背景"


def load_chapters(story_dir):
    """读取 chapters/*.json，按 sort 排序，转成插件 chapters 结构（不含背景图路径，背景稍后解析）。"""
    ch_dir = os.path.join(story_dir, "chapters")
    if not os.path.isdir(ch_dir):
        sys.exit("章节目录不存在: %s" % ch_dir)
    out = []
    for fn in sorted(os.listdir(ch_dir)):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(ch_dir, fn)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            print("  [跳过] %s 解析失败: %s" % (fn, e))
            continue
        base = os.path.splitext(fn)[0]
        out.append({
            "_base": base,
            "title": d.get("title") or fn,
            "sort": int(d.get("sort") or 0),
            "openingRole": d.get("openingRole") or "旁白",
            "openingLine": d.get("openingText") or "",
            "background": d.get("background") or "",        # 本地源图路径（非 tavo）
            "backgroundPrompt": d.get("backgroundPrompt") or "",
            "content": d.get("content") or "",
            "successCondition": d.get("completionCondition") or "",
            "conditionVisible": True,
            "entryCondition": "",
            "musicAutoPlay": False,
            "events": [],
        })
    out.sort(key=lambda c: c.get("sort", 0))
    return out


def main():
    ap = argparse.ArgumentParser(description="从故事缓存导入章节到 tavo（含背景图生成/上传）")
    ap.add_argument("chat_id", type=int, help="群聊 chatId")
    ap.add_argument("story_dir", help="故事目录（含 chapters/）")
    ap.add_argument("--bg", choices=["auto", "local", "generate", "skip"], default="auto",
                    help="背景图来源：auto=优先本地图/无则生图(默认) local=只上传本地图 "
                         "generate=只AI生图 skip=不动背景")
    ap.add_argument("--bg-scope", choices=["chat", "global"], default="chat",
                    help="背景图存储作用域（默认 chat；global 更抗 tavo_chat_reset）")
    ap.add_argument("--force-bg", action="store_true", help="强制重传/重生背景图（忽略已有）")
    ap.add_argument("--with-intro", action="store_true", help="同时写简介+全局背景（读 story_sync_config.json）")
    ap.add_argument("--reset-progress", action="store_true", help="同时重置 tf_progress（动态数据重构）")
    ap.add_argument("--dry", action="store_true", help="预览不写入、不生图")
    ap.add_argument("--url", default=None)
    ap.add_argument("--token", default=None)
    args = ap.parse_args()

    url, token = resolve_auth(args)
    story_dir = os.path.abspath(args.story_dir)
    if not os.path.isdir(story_dir):
        sys.exit("故事目录不存在: %s" % story_dir)

    chapters = load_chapters(story_dir)
    print("[导入] %s -> chat %s  (bg=%s, scope=%s)" % (story_dir, args.chat_id, args.bg, args.bg_scope))
    print("  章节数: %d" % len(chapters))

    # dry 模式：全程不联网，背景图据本地图/生成预测，直接打印
    if args.dry:
        for c in chapters:
            bg, note = resolve_background(
                url, token, args.chat_id, c, story_dir, args.bg, args.bg_scope,
                True, args.force_bg, "")
            c["background"] = bg
            print("    - %s | bg=%s | %s" % (c["title"], (bg or "（无）"), note))
        print("[DRY] 未写入、未生图")
        return

    # 读现有 edit，保留已存背景与各章节其它字段
    existing_edit = var_get(url, token, args.chat_id, "tf_story.edit")
    if not isinstance(existing_edit, dict):
        existing_edit = {}
    existing_chapters = existing_edit.get("chapters") or []
    existing_bg_map = {}
    for ec in existing_chapters:
        if isinstance(ec, dict) and ec.get("title"):
            existing_bg_map[ec["title"]] = ec.get("background") or ""

    for c in chapters:
        bg, note = resolve_background(
            url, token, args.chat_id, c, story_dir, args.bg, args.bg_scope,
            args.dry, args.force_bg, existing_bg_map.get(c["title"], ""))
        c["background"] = bg
        c["_bg_note"] = note
        print("    - %s | bg=%s | %s" % (c["title"], (bg or "（无）"), note))

    if args.dry:
        print("[DRY] 未写入")
        return

    # 读现有 edit（保留 intro/globalBackground 等）
    edit = var_get(url, token, args.chat_id, "tf_story.edit")
    if not isinstance(edit, dict):
        edit = {}

    if args.with_intro:
        cfg_path = os.path.join(story_dir, "story_sync_config.json")
        if os.path.isfile(cfg_path):
            cfg = json.load(open(cfg_path, encoding="utf-8"))
            if cfg.get("persona", {}).get("description"):
                edit["intro"] = cfg["persona"]["description"][:300]
            wb = cfg.get("worldbook", {})
            if wb.get("intro"):
                edit["globalBackground"] = wb["intro"]
            print("  [简介/背景] 已从 story_sync_config.json 填充")
        else:
            print("  [警告] 无 story_sync_config.json，保留原 intro/globalBackground")

    edit["chapters"] = chapters
    var_set(url, token, args.chat_id, "tf_story.edit", edit)
    print("  [tf_story.edit] 已写入（%d 章）" % len(chapters))

    if args.reset_progress:
        progress = {
            "currentChapterIndex": 0, "completedChapters": [], "failedAttempts": 0,
            "sessionFreeMode": False, "storyCompleted": False,
            "currentPhase": 0, "currentEvent": 0, "phases": [],
            "startedAt": 0, "updatedAt": 0,
        }
        var_set(url, token, args.chat_id, "tf_progress", progress)
        print("  [tf_progress] 已重置（动态数据重构）")

    print("✅ 完成")


if __name__ == "__main__":
    main()
