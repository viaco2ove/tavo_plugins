# 标准化cli
CLI 工具就是在终端（cmd / PowerShell / Terminal）里执行的程序。要"标准化"你的 CLI 工具，核心是遵循 POSIX 标准 和 GNU 扩展约定，让用户用起来像 git、docker 一样自然。下面从规范、设计、实现三个层面来讲。

规范来源：POSIX + GNU

CLI 的"标准化"主要来自两套约定：

POSIX 标准：定义了短选项格式——单字母 + 单横线（如 -h），多个无参数选项可合并（-abc = -a -b -c）
GNU 扩展：引入双横线长选项（如 --help、--verbose），更具可读性，每个短选项都有对应的长选项

两者结合就是现代 CLI 工具的通用语法。

标准参数约定

以下是业界公认的"通用语言"，你的工具应该遵循：
短选项   长选项   用途
-h   --help   显示帮助信息

-v   --version   显示版本号

-f   --force   强制操作，跳过确认

-q   --quiet   静默模式

-o   --output   指定输出文件

-n   --dry-run   预览模式，不实际执行

--verbose   详细输出

--json   输出机器可读的 JSON 格式

⚠️ 关键原则：不要重载这些字母。比如 -h 永远是 help，不要拿来表示 "hidden" 或 "host"。

命名与设计规则

短选项（-）
只能是单个字母（a-z, A-Z）
可合并：ls -la = ls -l -a
用于高频操作

长选项（--）
用小写 + 连字符（kebab-case）：--dry-run，不要用 --dryRun 或 --dry_run
用于低频或复杂选项，自解释性强
布尔选项用 --no- 前缀取反：--color / --no-color

特殊分隔符 --
单独的 -- 表示选项结束，后面全部当作普通参数
用途：处理以 - 开头的文件名，如 rm -- -tmp

帮助信息的设计

--help 的输出是 CLI 的"脸面"，应该包含：

 mytool --help

Usage: mytool <command> [options]

管理项目的创建、构建和部署

Commands:
  init <name>    创建新项目
  build          构建项目
  deploy         部署到生产环境

Options:
  -v, --verbose  输出详细日志
  -h, --help     显示帮助
  --version      显示版本

Examples:
   mytool init my-project --template react
   mytool build --watch
   mytool deploy --env production

要点：先展示用法示例，用户最想"复制粘贴直接跑"。

退出码规范

CLI 工具常被脚本和 CI/CD 调用，退出码必须准确：
退出码   含义
0   成功

1   通用错误

2   参数错误（POSIX 约定）

各语言推荐框架

不要手动解析参数，用成熟框架：
语言   推荐框架   代表项目
Go   Cobra   kubectl, docker, gh, hugo

Python   Click / Typer   大量数据/AI工具

Node.js   Commander.js   前端工具链

Rust   clap   ripgrep, fd

Java   Apache Commons CLI / picocli   企业级工具

C#   System.CommandLine   dotnet CLI

这些框架自动生成 --help、校验参数、处理短/长选项映射，你只需声明选项即可。

快速示例（Python + Click）

import click

@click.command()
@click.option('--name', '-n', required=True, help='项目名称')
@click.option('--template', '-t', default='react', help='模板类型')
@click.option('--dry-run', is_flag=True, help='预览模式')
def init(name, template, dry_run):
    """创建新项目"""
    if dry_run:
        click.echo(f"[预览] 将创建项目 {name}（模板: {template}）")
    else:
        click.echo(f"正在创建项目 {name}...")

if name == 'main':
    init()

运行效果：

$ python cli.py --help
Usage: cli.py [OPTIONS]

  创建新项目

Options:
  -n, --name TEXT      项目名称  [required]
  -t, --template TEXT  模板类型  [default: react]
  --dry-run            预览模式
  --help               显示帮助

总结

标准化 CLI 的核心就是：遵循 POSIX/GNU 约定 + 使用成熟框架。做到这几点，你的工具就能让用户"不用看文档也能猜到会怎么用"。