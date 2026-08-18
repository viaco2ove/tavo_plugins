这就是 Python CLI 工具分发的标准做法——通过 console_scripts 入口点，安装后直接在终端用命令名调用。下面讲清楚怎么做。

核心原理

Python 的 pip install 支持注册"入口点"（entry points）。你在项目配置里声明：

当用户执行 tavo_plugins 时，实际调用 tavo_plugins.cli:main 这个函数

pip 安装后会自动在系统 PATH 里生成一个可执行脚本（Windows 下是 .exe），用户就能全局调用了。

项目结构

tavo_plugins/
├── pyproject.toml          # 项目配置（推荐用这个）
├── src/
│   └── tavo_plugins/
│       ├── init.py
│       ├── cli.py          # CLI 入口
│       └── commands/       # 子命令模块
│           ├── init.py
│           ├── init.py
│           ├── build.py
│           └── deploy.py
└── README.md

第一步：写 CLI 入口（cli.py）

src/tavo_plugins/cli.py
import click

@click.group()
@click.version_option(version="0.1.0")
def main():
    """Tavo 插件管理工具"""
    pass

@main.command()
@click.argument("name")
@click.option("--template", "-t", default="default", help="模板类型")
def init(name, template):
    """初始化一个新插件项目"""
    click.echo(f"正在创建插件: {name} (模板: {template})")

@main.command()
@click.option("--watch", "-w", is_flag=True, help="监听文件变化")
def build(watch):
    """构建插件"""
    click.echo("构建中..." if not watch else "监听模式中...")

@main.command()
@click.option("--env", "-e", default="production", help="部署环境")
def deploy(env):
    """部署插件"""
    click.echo(f"部署到 {env}...")

if name == "main":
    main()

第二步：配置 pyproject.toml（关键）

[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = "tavo-plugins"
version = "0.1.0"
description = "Tavo 插件管理工具"
requires-python = ">=3.8"
dependencies = [
    "click>=8.0",
]

⭐ 这一行是核心：注册全局命令
[project.scripts]
tavo_plugins = "tavo_plugins.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[project.scripts] 这一节就是魔法所在：

tavo_plugins = "tavo_plugins.cli:main"
^^^^^^^^^^^^    ^^^^^^^^^^^^^^^^^^^^
终端命令名        模块路径:函数名

第三步：安装

开发阶段（本地调试）

在项目根目录执行，-e 表示可编辑模式（改代码立即生效）
pip install -e .

发布后（用户安装）

pip install tavo-plugins

第四步：使用

安装完成后，任何目录下都能直接用：

 tavo_plugins --help

Usage: tavo_plugins [OPTIONS] COMMAND [ARGS]...

  Tavo 插件管理工具

Options:
  --version  Show the version and exit.
  --help     Show this message and exit.

Commands:
  init    初始化一个新插件项目
  build   构建插件
  deploy  部署插件

 tavo_plugins init my-plugin --template react
正在创建插件: my-plugin (模板: react)

 tavo_plugins build --watch
监听模式中...

 tavo_plugins --version
tavo_plugins, version 0.1.0

发布到 PyPI（让别人也能 pip install）

安装构建工具
pip install build twine

打包
python -m build

上传到 PyPI
twine upload dist/*

上传后，全世界任何人都能 pip install tavo-plugins 然后直接 tavo_plugins xxx 调用。

常见问题
问题   解决方案
安装后提示 command not found   检查 Python 的 Scripts 目录是否在 PATH 中（Windows 通常是 %APPDATA%PythonPython3xScripts）

改了代码没生效   确认用了 pip install -e .（可编辑模式），否则每次改完要重新 install

想卸载   pip uninstall tavo-plugins

总结一下就是三步：写 CLI 逻辑 → 在 pyproject.toml 里注册 [project.scripts] → pip install -e .。之后 tavo_plugins 就是一个正经的全局命令了。需要我帮你把这个项目骨架搭出来吗？