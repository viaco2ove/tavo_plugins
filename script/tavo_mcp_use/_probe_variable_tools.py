#!/usr/bin/env python3
"""探测 tavo MCP 的全部工具：tools/list + 尝试变量相关调用。

用途：确认 MCP 能否枚举 tavo 自身的变量（chat/global 作用域已存在的变量实例）。
"""
import json
import sys
import os
import requests

# 读 .env
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
env = {}
with open(ENV_PATH, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

BASE = env.get('tavo_mcp_url', 'http://127.0.0.1:7347/mcp')
TOKEN = env.get('tavo_mcp_toekn', '')
HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}


def rpc(method, params, idx=1):
    resp = requests.post(BASE, json={
        'jsonrpc': '2.0', 'id': idx, 'method': method, 'params': params
    }, headers=HEADERS, timeout=30)
    return resp.json()


def main():
    # 1) tools/list
    try:
        r = rpc('tools/list', {})
    except Exception as e:
        print(f'❌ 连接失败: {e}')
        sys.exit(1)
    if 'error' in r:
        print(f'❌ tools/list 错误: {r["error"]}')
        sys.exit(1)

    tools = r.get('result', {}).get('tools', [])
    print(f'✅ 连接成功: {BASE}')
    print(f'共 {len(tools)} 个工具:\n')
    for t in tools:
        name = t.get('name', '?')
        desc = (t.get('description', '') or '').split('\n')[0][:80]
        print(f'  {name:40s} {desc}')

    # 2) 找变量相关工具
    var_tools = [t['name'] for t in tools if 'variable' in t['name'].lower()]
    print(f'\n变量相关工具: {var_tools}')

    # 3) 打印变量相关工具的完整 schema
    for t in tools:
        if 'variable' in t['name'].lower():
            print(f'\n=== {t["name"]} schema ===')
            print(json.dumps(t.get('inputSchema', {}), ensure_ascii=False, indent=2))

    # 4) resources/list 看有没有资源暴露
    try:
        r2 = rpc('resources/list', {}, 2)
        if 'result' in r2:
            res = r2['result'].get('resources', [])
            print(f'\n=== resources ({len(res)}) ===')
            for x in res[:20]:
                print(' ', x)
        else:
            print(f'\nresources/list 不支持: {r2.get("error")}')
    except Exception as e:
        print(f'\nresources/list 异常: {e}')


if __name__ == '__main__':
    main()
