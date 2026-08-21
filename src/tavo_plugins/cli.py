#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tavo CLI"""
import os
import sys
import click
import json as _json

CLI_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CLI_ROOT)

from tavo_plugins.lib.mcp_client import McpClient


def resolve_client(env_path=None):
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
        click.secho("[ERR] MCP failed: " + str(e), fg="red", err=True)
        sys.exit(1)
    return client


@click.group()
@click.option("--env", "-e", type=click.Path(exists=True), help=".env path")
@click.pass_context
def main(ctx, env):
    ctx.ensure_object(dict)
    ctx.obj["env_path"] = env


@main.command()
@click.option("--install-all", is_flag=True, help="Install all plugins in plugins/")
@click.option("--install", "-i", help="Install specified plugins (comma-separated)")
@click.option("--plugins-dir", default="plugins", help="Plugin root")
@click.option("--tpg-dir", default="plugins_tpg", help="TPG output dir")
@click.option("--no-tpg", is_flag=True, help="Don't save tpg files")
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.option("--hub", is_flag=True, help="Upload to hub")
@click.option("--upload", is_flag=True, help="Upload mode")
@click.option("--duplicate-delete", is_flag=True, help="Delete existing before upload")
@click.option("--upver", is_flag=True, help="Bump version before upload")
@click.option("--all", "all_plugins", is_flag=True, help="Process all plugins")
@click.option("--force", is_flag=True, help="Force")
@click.pass_context
def plugins(ctx, install_all, install, plugins_dir, tpg_dir, no_tpg, enable, hub, upload, duplicate_delete, upver, all_plugins, force):
    """List / install plugins / upload to hub"""

    # Hub upload mode
    if hub and upload:
        import zipfile, io, base64, subprocess

        def run_py(args, timeout=60):
            env = {**os.environ}
            env["PYTHONIOENCODING"] = "utf-8"
            try:
                r = subprocess.run(
                    [sys.executable] + args,
                    capture_output=True, timeout=timeout, env=env
                )
                return r.returncode, r.stdout.decode("utf-8", errors="replace"), r.stderr.decode("utf-8", errors="replace")
            except subprocess.TimeoutExpired:
                return -1, "", "timeout"
            except Exception as e:
                return -1, "", str(e)

        hub_script = os.path.join(CLI_ROOT, "..", "script", "tavo_pluginhub", "pluginhub.py")
        plugin_dirs = sorted(p for p in os.listdir(plugins_dir)
                            if os.path.isdir(os.path.join(plugins_dir, p))
                            and not p.startswith("."))
        if not plugin_dirs:
            click.echo("No plugins found")
            return

        # Bump versions
        if upver:
            click.echo("Bumping versions...")
            for tname in plugin_dirs:
                mp = os.path.join(plugins_dir, tname, "manifest.json")
                if not os.path.isfile(mp):
                    continue
                with open(mp, encoding="utf-8") as f:
                    m = _json.load(f)
                ver = m.get("version", "0.0.0")
                parts = ver.split(".")
                if len(parts) == 3:
                    parts[2] = str(int(parts[2]) + 1)
                    new_ver = ".".join(parts)
                else:
                    new_ver = "0.0.1"
                m["version"] = new_ver
                with open(mp, "w", encoding="utf-8") as f:
                    _json.dump(m, f, ensure_ascii=False, indent=2)
                click.echo("  " + tname + ": " + ver + " -> " + new_ver)

        # Get hub plugin list
        click.echo("Getting hub plugin list...")
        hub_map = {}
        try:
            code, stdout, stderr = run_py([hub_script, "list"])
            if code == 0:
                for line in stdout.split("\n"):
                    parts = line.split()
                    if len(parts) >= 5:
                        hub_id = parts[0]
                        pkg_id = parts[1]
                        hub_map[pkg_id] = hub_id
                click.echo("Found " + str(len(hub_map)) + " plugins on hub")
        except Exception as e:
            click.echo("Failed to get hub list: " + str(e))
            hub_map = {}

        skip_dirs = {".git", "__pycache__", "node_modules"}

        for tname in plugin_dirs:
            pdir = os.path.join(plugins_dir, tname)
            mp = os.path.join(pdir, "manifest.json")
            if not os.path.isfile(mp):
                click.echo("[SKIP] " + tname + ": no manifest.json")
                continue
            with open(mp, encoding="utf-8") as f:
                manifest = _json.load(f)
            plugin_id = manifest.get("id")
            version = manifest.get("version", "0.0.0")
            if not plugin_id:
                click.echo("[SKIP] " + tname + ": no id")
                continue

            # Build zip
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for base, dirs, files in os.walk(pdir):
                    dirs[:] = [d for d in dirs if d not in skip_dirs]
                    for fn in files:
                        if fn.endswith(".pyc") or fn == ".DS_Store":
                            continue
                        fp = os.path.join(base, fn)
                        rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                        z.write(fp, rel)
            tpg_data = buf.getvalue()

            # Save tpg
            if not no_tpg:
                os.makedirs(tpg_dir, exist_ok=True)
                tpg_path = os.path.join(tpg_dir, tname + "-" + version + ".tpg")
                with open(tpg_path, "wb") as f:
                    f.write(tpg_data)
                click.echo("  [TPG] saved: " + tpg_path)

            # Get hub_id
            hub_id = hub_map.get(plugin_id)

            if hub_id and duplicate_delete:
                click.echo("  [DEL] deleting " + tname + " (" + hub_id + ")...")
                try:
                    run_py([hub_script, "delete", hub_id, "--yes"])
                except Exception as e:
                    click.echo("  [WARN] delete failed: " + str(e))

            # Upload
            click.echo("  [UP] uploading " + tname + " v" + version + "...")
            tmp_tpg = os.path.join(plugins_dir, tname + ".tpg")
            with open(tmp_tpg, "wb") as f:
                f.write(tpg_data)

            action = "update" if hub_id else "publish"
            cmd_args = [action, hub_id, tmp_tpg] if hub_id else [action, tmp_tpg]
            code, stdout, stderr = run_py([hub_script] + cmd_args)
            os.remove(tmp_tpg)

            if code == 0:
                click.echo("[OK] " + tname + " v" + version + " " + action + "ed")
            else:
                err_msg = (stderr or stdout).encode("ascii", "replace").decode("ascii")
                if "already exists" in err_msg:
                    # Auto bump version and retry
                    ver = manifest.get("version", "0.0.0")
                    parts = ver.split(".")
                    if len(parts) == 3:
                        parts[2] = str(int(parts[2]) + 1)
                        new_ver = ".".join(parts)
                    else:
                        new_ver = "0.0.1"
                    manifest["version"] = new_ver
                    with open(mp, "w", encoding="utf-8") as f:
                        _json.dump(manifest, f, ensure_ascii=False, indent=2)
                    # Rebuild
                    buf = io.BytesIO()
                    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                        for base, dirs, files in os.walk(pdir):
                            dirs[:] = [d for d in dirs if d not in skip_dirs]
                            for fn in files:
                                if fn.endswith(".pyc") or fn == ".DS_Store":
                                    continue
                                fp = os.path.join(base, fn)
                                rel = os.path.relpath(fp, pdir).replace(os.sep, "/")
                                z.write(fp, rel)
                    tpg_data = buf.getvalue()
                    tmp_tpg2 = os.path.join(plugins_dir, tname + "_v2.tpg")
                    with open(tmp_tpg2, "wb") as f:
                        f.write(tpg_data)
                    if hub_id:
                        code2, out2, err2 = run_py([hub_script, "update", hub_id, tmp_tpg2])
                    else:
                        code2, out2, err2 = run_py([hub_script, "publish", tmp_tpg2])
                    os.remove(tmp_tpg2)
                    if code2 == 0:
                        click.echo("[OK] " + tname + " v" + new_ver + " (auto-bumped) " + action + "ed")
                    else:
                        click.echo("[FAIL] " + tname + ": " + (err2 or out2))
                else:
                    click.echo("[FAIL] " + tname + ": " + err_msg)

        click.echo("--- Done ---")
        return

    # Install mode
    if install_all or install:
        import zipfile, io, base64

        client = resolve_client(ctx.obj["env_path"])
        if install_all:
            targets = sorted(p for p in os.listdir(plugins_dir)
                            if os.path.isdir(os.path.join(plugins_dir, p)))
        else:
            targets = [n.strip() for n in install.split(",") if n.strip()]
        if not targets:
            click.echo("No plugins found")
            return

        ok_count = 0; fail_count = 0
        for tname in targets:
            pdir = os.path.join(plugins_dir, tname)
            mp = os.path.join(pdir, "manifest.json")
            if not os.path.isfile(mp):
                click.echo("[SKIP] " + tname + ": no manifest.json")
                continue
            with open(mp, encoding="utf-8") as f:
                plugin_id = _json.load(f).get("id")
            if not plugin_id:
                click.echo("[SKIP] " + tname + ": no id")
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

            if not no_tpg:
                os.makedirs(tpg_dir, exist_ok=True)
                version = "0.0.0"
                try:
                    with open(mp, encoding="utf-8") as mf:
                        version = _json.load(mf).get("version", "0.0.0")
                except Exception:
                    pass
                tpg_path = os.path.join(tpg_dir, tname + "-" + version + ".tpg")
                with open(tpg_path, "wb") as f:
                    f.write(base64.b64decode(zip_b64))
                click.echo("  [TPG] saved: " + tpg_path)
            try:
                r = client.plugin_install(plugin_id, zip_b64)
                rr = r.get("content", [{}])[0].get("text", "{}")
                try:
                    rd = _json.loads(rr)
                except Exception:
                    rd = {}
                ok = rd.get("ok", False)
                if ok in (True, "true"):
                    if enable:
                        client.plugin_set_enabled(plugin_id, True)
                    click.secho("[OK] " + tname + " (" + plugin_id + ") v" + rd.get("version", "?"), fg="green")
                    ok_count += 1
                else:
                    click.secho("[ERR] " + tname + ": " + str(rd or r), fg="red")
                    fail_count += 1
            except Exception as e:
                click.secho("[ERR] " + tname + ": " + str(e), fg="red")
                fail_count += 1
        click.echo("--- Done: " + str(ok_count) + " ok / " + str(fail_count) + " failed ---")
        return

    # List installed
    client = resolve_client(ctx.obj["env_path"])
    click.secho("Installed plugins:", bold=True)
    result = client.plugin_list()
    items = result.get("items", []) if isinstance(result, dict) else result
    for p in items:
        pid = p.get("pluginId") or p.get("id", "")
        name = p.get("name", "")
        ver = p.get("version", "")
        enabled = p.get("enabled", False)
        click.echo("  [" + ("+" if enabled else "-") + "] " + name + " v" + ver + " (" + pid + ")")


@main.command()
@click.argument("plugin_dir", type=click.Path(exists=True))
@click.option("--enable/--no-enable", default=True, help="Enable after install")
@click.pass_context
def install(ctx, plugin_dir, enable):
    """Install plugin from directory"""
    import zipfile, io, base64

    client = resolve_client(ctx.obj["env_path"])
    manifest_path = os.path.join(plugin_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        click.secho("[ERR] manifest.json not found", fg="red")
        return

    with open(manifest_path, encoding="utf-8") as f:
        manifest = _json.load(f)
    plugin_id = manifest.get("id")
    if not plugin_id:
        click.secho("[ERR] manifest.json missing id", fg="red")
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

    click.echo("Installing " + plugin_id + " ...")
    r = client.plugin_install(plugin_id, zip_b64)
    ok = r.get("ok", False)
    if ok in (True, "true"):
        click.secho("[OK] Installed v" + r.get("version", "?"), fg="green")
        if enable:
            client.plugin_set_enabled(plugin_id, True)
            click.echo("  Enabled")
    else:
        click.secho("[ERR] Install failed: " + str(r), fg="red")


@main.command(name="sync")
@click.argument("story_dir", required=False, type=click.Path(exists=True))
@click.option("--story-json", type=click.Path(exists=True), help="story.json path")
@click.option("--reuse-ids", help="Reuse character IDs from file")
@click.option("--duplicate-delete", is_flag=True, help="Delete duplicates before sync")
@click.option("--clean-cache", is_flag=True, help="Clean cache before sync")
@click.option("--skip-plugins", is_flag=True, help="Skip plugins")
@click.option("--skip-sprite", is_flag=True, help="Skip sprite sync")
@click.option("--skip-chapters", is_flag=True, help="Skip chapters sync")
@click.option("--full", is_flag=True, help="Full sync (characters, avatars, sprites, chapters, worldbooks)")
@click.option("--force", "-F", is_flag=True, help="Force")
@click.option("--chat-id", type=int, help="Specify existing chat ID, don't create new")
def sync_cmd(story_dir, story_json, reuse_ids, duplicate_delete, clean_cache, skip_plugins,
             skip_sprite, skip_chapters, full, force, chat_id):
    """Sync story to Tavo"""
    import subprocess
    # If --story-json given, read it and use config
    if story_json:
        config_dir = None
        config_file = None
        story_mode_args = []
        try:
            with open(story_json, "r", encoding="utf-8") as f:
                cfg = _json.load(f)
            config_file = cfg.get("story_sync_file")
            if config_file:
                config_dir = os.path.dirname(os.path.abspath(config_file))
                if not story_dir:
                    story_dir = config_dir
            # Parse story_sync_mode: "--all --force --duplicate-delete --clean-cache"
            # 修 Bug #4: 同时接受 "-clean-cache" 单横线（容错老配置）
            mode_str = cfg.get("story_sync_mode", "")
            if mode_str:
                story_mode_args = []
                for a in mode_str.split():
                    if a.startswith("--"):
                        story_mode_args.append(a)
                    elif a.startswith("-") and len(a) > 1 and a[1] != "-":
                        # "-clean-cache" → "--clean-cache"
                        story_mode_args.append("-" + a)
        except Exception as e:
            click.echo("[ERR] failed to read story.json: " + str(e))
            return

    sync_script = os.path.join(CLI_ROOT, "..", "script", "tavo_mcp_use", "story_sync", "story_sync_all.py")
    if not os.path.exists(sync_script):
        click.echo("[ERR] story_sync_all.py not found")
        return
    args = [sys.executable, sync_script]
    if story_dir:
        args.append(story_dir)
    else:
        args.append(".cache/story")
    if skip_plugins:
        args.append("--skip-plugins")
    if skip_sprite:
        args.append("--skip-sprite")
    if skip_chapters:
        args.append("--skip-chapters")
    if chat_id is not None:
        args.append("--chat-id")
        args.append(str(chat_id))
    if duplicate_delete or "--duplicate-delete" in story_mode_args:
        args.append("--duplicate-delete")
    if clean_cache or "--clean-cache" in story_mode_args:
        args.append("--clean-cache")
    if force or full or "--force" in story_mode_args or "--all" in story_mode_args:
        args.append("--force")
    for a in story_mode_args:
        if a == '--all':
            continue
        if a not in args:
            args.append(a)
    result = subprocess.run(args, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    sys.exit(result.returncode)


@main.command(name="characters")
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
            click.echo(f"  [P{cid}] {name} (persona)")
        else:
            click.echo(f"  [{cid}] {name}")


@main.command(name="personas")
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
        click.echo(f"  [{pid}] {name}")


if __name__ == "__main__":
    main()
