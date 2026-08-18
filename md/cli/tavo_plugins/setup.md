# 安装与环境配置

tavo cli 命令使用
[tavo_run.md](tavo_run.md)
## 环境要求

- Python 3.8+
- 网络能访问 Tavo MCP 服务

## 安装

```bash
cd tavo_plugins
pip install -e .
```

查出python路径 list
```cmd
where python
```
```powershell
where.exe python
```

获得当前的python 路径
```
python -m pip --version
```

[tavo_run.md](tavo_run.md)


## 验证安装

```bash
tavo --help
```

## .env 配置

在 `tavo_plugins/` 目录下创建 `.env` 文件：

```env
TAVO_MCP_URL=http://localhost:38685/mcp
TAVO_MCP_TOKEN=你的token
```

### 获取 Token

1. 打开 Tavo 应用
2. 进入「设置」→「开发者选项」或「MCP」
3. 复制 Token

### 验证连接

```bash
# 列出插件（会检测 MCP 连通性）
tavo plugins
```

如果出现 `MCP 连接失败`，检查：
- URL 是否正确
- Token 是否有效
- Tavo 应用是否运行中

## 自定义 .env 路径

默认在当前目录查找，也可显式指定：

```bash
tavo -e /path/to/.env plugins
tavo --env /path/to/.env sync .cache/story/xxx
```

## Python 环境说明

如果系统有多个 Python 版本，确保 pip 安装到的 Python 和运行 `tavo` 的 Python 是同一个：

```bash
# 查看 tavo 使用的 Python
which tavo

# 或直接用 python 模块运行
python -m tavo_plugins --help
```

## 卸载

```bash
pip uninstall tavo-plugins
```
