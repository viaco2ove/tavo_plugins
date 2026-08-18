tavo cli 命令使用
# 忽略path 的方式，激活的 python 里安装了就行
`python -m tavo_plugins --help`

# `tavo` 命令全局可用
需要配置path 加入 python 路径

获得当前的python 路径
```
python -m pip --version
```

powershell
```
# 方式B：临时加到当前会话 PATH
$env:PATH += ";D:\ProgramData\miniconda3\Scripts"
```
