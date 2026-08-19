#!/usr/bin/env python3
"""遍历 chat id 1..30 拉 chat 变量树 + message 作用域抽样。"""
import json
import os
import requests

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
_idx = [0]


def call(name, arguments):
    _idx[0] += 1
    resp = requests.post(BASE, json={
        'jsonrpc': '2.0', 'id': _idx[0], 'method': 'tools/call',
        'params': {'name': name, 'arguments': arguments}
    }, headers=HEADERS, timeout=60)
    r = resp.json()
    if 'error' in r:
        raise Exception(r['error'])
    result = r['result']
    if result.get('isError'):
        texts = result.get('content', [])
        raise Exception(''.join(c.get('text', '') for c in texts)[:200])
    texts = result.get('content', [])
    for c in texts:
        if c.get('type') == 'text':
            try:
                return json.loads(c['text'])
            except Exception:
                return c['text']
    return result


def main():
    out = {}

    # 1) 当前 chat
    try:
        cur = call('tavo_current_chat_get', {})
        out['current_chat'] = cur
        print('当前 chat:', json.dumps(cur, ensure_ascii=False)[:300])
    except Exception as e:
        print('current_chat_get 失败:', e)
        out['current_chat'] = {'error': str(e)}

    # 2) 遍历 chat id
    out['chats'] = {}
    for cid in range(1, 31):
        try:
            chat = call('tavo_chat_get', {'id': cid})
            title = chat.get('name') or chat.get('title') or '?'
        except Exception:
            continue  # 不存在的 chat
        print(f'\nchat {cid}: {title}')
        entry = {'title': title}
        try:
            entry['variables'] = call('tavo_variable_list', {'scope': 'chat', 'chatId': cid})
            keys = list(entry['variables'].get('variables', {}).keys()) if isinstance(entry['variables'], dict) else entry['variables']
            print(f'  变量 keys: {keys}')
        except Exception as e:
            entry['variables_error'] = str(e)
            print(f'  变量失败: {str(e)[:120]}')
        out['chats'][cid] = entry

    # 3) message 作用域抽样（chat 1，取最后一条消息）
    try:
        msgs = call('tavo_message_count', {'chatId': 1})
        print('\nchat 1 消息数:', msgs)
        n = msgs.get('count', 0) if isinstance(msgs, dict) else msgs
        if n:
            mv = call('tavo_variable_list', {'scope': 'message', 'chatId': 1, 'index': n - 1})
            out['message_sample_chat1'] = mv
            print('message 变量:', json.dumps(mv, ensure_ascii=False)[:500])
    except Exception as e:
        print('message 作用域抽样失败:', e)
        out['message_sample_chat1'] = {'error': str(e)}

    with open(os.path.join(os.path.dirname(__file__), '_variables_dump.json'), 'r+', encoding='utf-8') as f:
        old = json.load(f)
    old.update(out)
    with open(os.path.join(os.path.dirname(__file__), '_variables_dump.json'), 'w', encoding='utf-8') as f:
        json.dump(old, f, ensure_ascii=False, indent=2)
    print('\n已合并保存到 _variables_dump.json')


if __name__ == '__main__':
    main()
