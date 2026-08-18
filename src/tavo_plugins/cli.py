#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tavo CLI 入口"""
import os
import sys
import click
import json as _json

CLI_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CLI_ROOT)

from tavo_plugins.lib.mcp_client import McpClient


def resolve_client(env_path=None):
    """从 .env 解析 MCP 连接，返回 McpClient"""
    if env_path is None:
        for base in [os.getcwd(), os.path.dirname(CLI_ROOT)]:
            p = os.path.join(base, ".env")
            if os.path.isfile(p):
                env_path = p
                break
    client = McpClient(env_path=env_path)
    try:
        client.call("tavo_plugin_search", {"query": "", "limit": 1})
    except Exception as e:
        click.secho(f"[ERR] MCP 连接失败: {e}", fg="red", err=True)
        sys.exit(1)
    return client


@click.group()
@click.option("--env", "-e", type=click.Path(exists=True), help=".env 文件路径")
@click.pass_context
def main(ctx, env):
    """Tavo 插件管理 & 故事同步 CLI"""
    ctx.ensure_object(dict)
    ctx.obj["env_path"] = env


@main.command()
@click.option("--install-all", is_flag=True, help="批量安装 plugins/ 下所有插件")
@click.option("--install", "-i", help="安装指定的插件目录（逗号分隔）")
@click.option("--plugins-dir", default="plugins", show_default=True, help="插件目录根")
@click.option("--keep-tpg", is_flag=True, help="同时把生成的 tpg 文件保存到 plugins_tpg/")
@click.option("--tpg-dir", default="plugins_tpg", show_default=True, help="tpg 文件输出目录")
@click.option("--enable/--no-enable", default=True, help="安装后启用")
@click.pass_context
def plugins(ctx, install_all, install, plugins_dir, keep_tpg, tpg_dir, enable):
    """列出 / 安装插件

    不带参数：列出已安装插件
    --install-all：批量安装 plugins/ 下所有插件
    --install "plugin1,plugin2"：安装指定的插件目录
    """
    if install_all or install:
        import zipfile, io, base64

        client = resolve_client(ctx.obj["env_path"])
        if install_all:
            targets = sorted(p for p in os.listdir(plugins_dir)
                            if os.path.isdir(os.path.join(plugins_dir, p)))
        else:
            targets = [n.strip() for n in install.split(",") if n.strip()]
        if not targets:
            click.secho("没有找到插件", fg="yellow")
            return

        ok_count = 0; fail_count = 0
        for tname in targets:
            pdir = os.path.join(plugins_dir, tname)
            mp = os.path.join(pdir, "manifest.json")
            if not os.path.isfile(mp):
                click.secho(f"[SKIP] {tname}: 无 manifest.json", fg="yellow")
                continue
            with open(mp, encoding="utf-8") as f:
                plugin_id = _json.load(f).get("id")
            if not plugin_id:
                click.secho(f"[SKIP] {tname}: 无 id", fg="yellow")
                continue
            buf = io.BytesIO()
            skip = {".git", "__pycache__", "node_modules"}
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for base, dirs, files in os.walk(pdir):
                    dirs[:] = [d for d in dirs if d not in skip]
                    for fn in files:
                        if fn.endswith(".pyc") or fn == ".DS_Store":
                            continue
                        fp = os.path.join(base, fn)
                        rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                        z.write(fp, rel)
            zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

            # --keep-tpg：保存到 plugins_tpg/<name>-<ver>.tpg
            if keep_tpg:
                os.makedirs(tpg_dir, exist_ok=True)
                version = "0.0.0"
                mp = os.path.join(pdir, "manifest.json")
                try:
                    with open(mp, encoding="utf-8") as mf:
                        version = _json.load(mf).get("version", "0.0.0")
                except Exception:
                    pass
                tpg_path = os.path.join(tpg_dir, f"{tname}-{version}.tpg")
                with open(tpg_path, "wb") as f:
                    f.write(base64.b64decode(zip_b64))
                click.echo(f"  [TPG] 已保存: {tpg_path}")
            try:
                r = client.plugin_install(plugin_id, zip_b64)
                # unwrap MCP 返回（content[0].text）
                rr = r.get("content", [{}])[0].get("text", "{}")
                import json as __json
                try:
                    rd = __json.loads(rr)
                except Exception:
                    rd = {}
                ok = rd.get("ok", False)
                if ok in (True, "true"):
                    if enable:
                        client.plugin_set_enabled(plugin_id, True)
                    click.secho(f"[OK] {tname} ({plugin_id}) v{rd.get('version','?')}", fg="green")
                    ok_count += 1
                else:
                    click.secho(f"[ERR] {tname}: {rd or r}", fg="red")
                    fail_count += 1
            except Exception as e:
                click.secho(f"[ERR] {tname}: {e}", fg="red")
                fail_count += 1
        click.echo(f"--- 完成：{ok_count} 成功 / {fail_count} 失败 ---")
        return

    # 默认：列出已安装
    client = resolve_client(ctx.obj["env_path"])
    click.secho("已安装插件:", bold=True)
    result = client.plugin_list()
    items = result.get("items", []) if isinstance(result, dict) else result
    for p in items:
        pid = p.get("pluginId") or p.get("id", "")
        name = p.get("name", "")
        ver = p.get("version", "")
        enabled = p.get("enabled", False)
        click.echo(f"  [{'+' if enabled else '-'}] {name} v{ver} ({pid})")


@main.command()
@click.argument("plugin_dir", type=click.Path(exists=True))
@click.option("--enable/--no-enable", default=True, help="安装后启用")
@click.pass_context
def install(ctx, plugin_dir, enable):
    """安装插件（传入插件目录）"""
    import zipfile
    import io
    import base64

    client = resolve_client(ctx.obj["env_path"])
    manifest_path = os.path.join(plugin_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        click.secho("[ERR] 未找到 manifest.json", fg="red")
        return

    with open(manifest_path, encoding="utf-8") as f:
        manifest = _json.load(f)
    plugin_id = manifest.get("id")
    if not plugin_id:
        click.secho("[ERR] manifest.json 缺少 id 字段", fg="red")
        return

    buf = io.BytesIO()
    skip = {".git", "__pycache__", "node_modules"}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(plugin_dir):
            dirs[:] = [d for d in dirs if d not in skip]
            for fn in files:
                if fn.endswith(".pyc") or fn == ".DS_Store":
                    continue
                fp = os.path.join(base, fn)
                rel = os.path.relpath(fp, plugin_dir).replace(os.sep, "/")
                z.write(fp, rel)
    zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    click.echo(f"安装 {plugin_id} ...")
    r = client.plugin_install(plugin_id, zip_b64)
    ok = r.get("ok", False)
    if ok in (True, "true"):
        click.secho(f"[OK] 安装成功 v{r.get('version','?')}", fg="green")
        if enable:
            client.plugin_set_enabled(plugin_id, True)
            click.echo("  已启用")
    else:
        click.secho(f"[ERR] 安装失败: {r}", fg="red")


@main.command()
@click.argument("story_dir", required=False, type=click.Path(exists=True))
@click.option("--story-json", type=click.Path(exists=True),
              help="从 story.json 控制同步（支持 --all / --force / --duplicate-delete / --clean-cache）")
@click.option("--force", "-f", is_flag=True, help="强制重新导入角色卡")
@click.option("--all", "sync_all", is_flag=True, help="完整同步（含世界书）")
@click.option("--duplicate-delete", is_flag=True, help="同名去重")
@click.option("--clean-cache", is_flag=True, help="清空 sync_cache 后同步")
@click.option("--skip-sprite", is_flag=True, help="跳过立绘同步")
@click.option("--skip-chapters", is_flag=True, help="跳过章节同步")
@click.option("--skip-plugins", is_flag=True, help="跳过插件安装")
@click.option("--chat-id", type=int, help="指定已有群聊 ID")
@click.option("--reuse-ids", type=click.Path(exists=True), help="角色ID映射 JSON 文件")
@click.pass_context
def sync(ctx, story_dir, story_json, force, sync_all, duplicate_delete, clean_cache,
         skip_sprite, skip_chapters, skip_plugins, chat_id, reuse_ids):
    """同步故事到 Tavo（角色+立绘+章节+插件+世界书）

    两种模式：
    - story_dir: 直接传故事目录路径（向后兼容）
    - --story-json: 从 story.json 读取完整配置
    """
    from tavo_plugins.commands.sync_story import sync_story
    from tavo_plugins.commands.sync_story_json import sync_from_story_json

    # 模式 1: --story-json
    if story_json:
        client = resolve_client(ctx.obj["env_path"])
        click.echo(f"[SYNC] 从 story.json 同步: {story_json}")
        sync_from_story_json(
            client, story_json,
            force=force or sync_all,
            duplicate_delete=duplicate_delete,
            clean_cache=clean_cache,
            skip_sprite=skip_sprite,
            skip_chapters=skip_chapters,
            skip_plugins=skip_plugins,
            chat_id=chat_id,
            echo=click.echo,
        )
        return

    # 模式 2: story_dir（向后兼容）
    if not story_dir:
        click.secho("[ERR] 必须传 STORY_DIR 或 --story-json", fg="red")
        return

    reuse_map = None
    if reuse_ids:
        with open(reuse_ids, encoding="utf-8") as f:
            reuse_map = _json.load(f)
        click.echo(f"  reuse IDs from: {reuse_ids}")

    client = resolve_client(ctx.obj["env_path"])
    click.echo(f"[SYNC] 开始同步: {story_dir}")
    if force:
        click.secho("  [WARN] force 模式: 重新导入所有角色", fg="yellow")
    sync_story(client, story_dir, force=force or sync_all,
               skip_sprite=skip_sprite, skip_chapters=skip_chapters,
               skip_plugins=skip_plugins, chat_id=chat_id,
               reuse_ids=reuse_map, echo=click.echo)


@main.command()
@click.option("--scope", "-s", default="chat", type=click.Choice(["chat", "global"]),
              help="变量作用域")
@click.argument("name")
@click.argument("value", required=False)
@click.pass_context
def var(ctx, scope, name, value):
    """读取或写入变量"""
    client = resolve_client(ctx.obj["env_path"])

    if value is None:
        r = client.variable_get(chat_id=1, name=name, scope=scope)
        if isinstance(r, dict) and r.get("found"):
            click.echo(_json.dumps(r.get("value"), ensure_ascii=False, indent=2))
        else:
            click.secho(f"变量 {name} 不存在", fg="yellow")
    else:
        try:
            val = _json.loads(value)
        except Exception:
            val = value
        client.variable_set(chat_id=1, name=name, value=val, scope=scope)
        click.secho(f"[OK] 已写入 {name}", fg="green")


@main.command()
@click.argument("query", required=False, default="")
@click.option("--delete", "-d", type=int, help="按 ID 删除单个角色")
@click.option("--delete-all", is_flag=True, help="删除全部角色（需确认）")
@click.pass_context
def characters(ctx, query, delete, delete_all):
    """列出、搜索或删除角色卡

    不带参数：列出所有角色
    --delete ID：删除指定 ID 的角色
    --delete-all：删除全部角色（带确认提示）"""
    client = resolve_client(ctx.obj["env_path"])

    def search_chars(q):
        return client.get("tavo_character_search", {"query": q, "limit": 100})

    def confirm(prompt):
        return click.confirm(prompt)

    if delete is not None:
        if not confirm(f"确认删除角色 ID={delete}？此操作不可撤销"):
            click.echo("已取消")
            return
        r = client.call("tavo_character_delete", {"id": delete})
        ok = r.get("ok", False) or r.get("content", [{}])[0].get("text", "") == "true"
        if ok:
            click.secho(f"[OK] 已删除角色 ID={delete}", fg="green")
        else:
            click.secho(f"[ERR] 删除失败: {r}", fg="red")
        return

    if delete_all:
        # 先列出所有
        result = search_chars("")
        items = result if isinstance(result, list) else result.get("items", [])
        if not items:
            click.echo("没有角色")
            return
        click.secho(f"将删除以下 {len(items)} 个角色：", fg="yellow")
        for it in items:
            click.echo(f"  [{it.get('id')}] {it.get('name')}")
        if not confirm("确认删除全部？此操作不可撤销"):
            click.echo("已取消")
            return
        ok_count = 0
        for it in items:
            cid = it.get("id")
            if cid:
                try:
                    client.call("tavo_character_delete", {"id": cid})
                    click.echo(f"  [OK] 删除 ID={cid}")
                    ok_count += 1
                except Exception as e:
                    click.secho(f"  [ERR] ID={cid}: {e}", fg="red")
        click.secho(f"[OK] 共删除 {ok_count}/{len(items)} 个角色", fg="green")
        return

    # 列出/搜索
    result = search_chars(query)
    items = result if isinstance(result, list) else result.get("items", [])
    if not items:
        click.echo("没有找到角色")
        return
    click.secho(f"找到 {len(items)} 个角色：", bold=True)
    for it in items:
        cid = it.get("id")
        name = it.get("name", "")
        kind = it.get("kind", "character")
        if kind == "persona":
            click.echo(f"  [P{id}] {name} (persona)")
        else:
            click.echo(f"  [{cid}] {name}")


@main.command()
@click.argument("query", required=False, default="")
@click.option("--delete", "-d", type=int, help="按 ID 删除 persona")
@click.pass_context
def personas(ctx, query, delete):
    """列出、搜索或删除 persona

    不带参数：列出所有 persona
    --delete ID：删除指定 ID 的 persona"""
    client = resolve_client(ctx.obj["env_path"])

    if delete is not None:
        if not click.confirm(f"确认删除 persona ID={delete}？此操作不可撤销"):
            click.echo("已取消")
            return
        r = client.call("tavo_persona_delete", {"id": delete})
        ok = r.get("ok", False) or r.get("content", [{}])[0].get("text", "") == "true"
        if ok:
            click.secho(f"[OK] 已删除 persona ID={delete}", fg="green")
        else:
            click.secho(f"[ERR] 删除失败: {r}", fg="red")
        return

    result = client.get("tavo_persona_search", {"query": query, "limit": 100})
    items = result if isinstance(result, list) else result.get("items", [])
    if not items:
        click.echo("没有找到 persona")
        return
    click.secho(f"找到 {len(items)} 个 persona：", bold=True)
    for it in items:
        pid = it.get("id")
        name = it.get("name", "")
        click.echo(f"  [P{pid}] {name}")


if __name__ == "__main__":
    main(obj={})
