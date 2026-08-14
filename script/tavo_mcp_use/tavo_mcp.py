#!/usr/bin/env python3
"""
tavo_mcp_use - 通过 tavo MCP Server 操作 tavo 的脚本

用法:
1. 先在 tavo 中开启 MCP Server (设置 -> MCP Server)
2. 复制连接配置到这里
3. 运行脚本创建故事、角色等

示例:
    python tavo_mcp.py create-worldbook "斗破苍穹" chapters.json
    python tavo_mcp.py create-chat "萧炎篇" char_ids.json
"""

import json
import argparse
import requests
from typing import Optional, Dict, Any, List

class TavoMCP:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }

    def _post(self, endpoint: str, data: dict) -> dict:
        """发送 JSON-RPC 请求"""
        url = f"{self.base_url}{endpoint}"
        resp = requests.post(url, json=data, headers=self.headers, timeout=30)
        resp.raise_for_status()
        result = resp.json()
        if 'error' in result:
            raise Exception(f"MCP Error: {result['error']}")
        return result.get('result', {})

    # ========== Lorebook (世界书) ==========
    def create_lorebook(self, name: str, entries: List[dict]) -> int:
        """创建世界书，返回 lorebook ID"""
        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_lorebook_create',
                'arguments': {
                    'lorebook': {
                        'name': name,
                        'entries': entries,
                    }
                }
            }
        })
        return result.get('lorebook_id')

    def get_lorebook(self, lorebook_id: int) -> dict:
        """获取世界书详情"""
        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 2,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_lorebook_get',
                'arguments': {'lorebook_id': lorebook_id}
            }
        })
        return result

    def update_lorebook(self, lorebook_id: int, entries: List[dict]) -> None:
        """更新世界书"""
        self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 3,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_lorebook_update',
                'arguments': {
                    'lorebook': {
                        'id': lorebook_id,
                        'name': '',
                        'entries': entries,
                    }
                }
            }
        })

    # ========== Character (角色) ==========
    def create_character(self, name: str, first_mes: str, description: str = '',
                       personality: str = '') -> int:
        """创建角色，返回 character ID"""
        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 10,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_character_create',
                'arguments': {
                    'character': {
                        'name': name,
                        'first_mes': first_mes,
                        'description': description,
                        'personality': personality,
                    }
                }
            }
        })
        return result.get('character_id')

    def get_character(self, character_id: int) -> dict:
        """获取角色详情"""
        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 11,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_character_get',
                'arguments': {'character_id': character_id}
            }
        })
        return result

    # ========== Chat (聊天) ==========
    def create_chat(self, name: str, character_ids: List[int],
                    lorebook_ids: Optional[List[int]] = None) -> int:
        """创建聊天，返回 chat ID"""
        chat_data = {
            'name': name,
            'character_ids': character_ids,
        }
        if lorebook_ids:
            chat_data['lorebook_ids'] = lorebook_ids

        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 20,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_chat_create',
                'arguments': {'chat': chat_data}
            }
        })
        return result.get('chat_id')

    def update_chat(self, chat_id: int, **kwargs) -> None:
        """更新聊天设置"""
        self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 21,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_chat_update',
                'arguments': {
                    'chat_id': chat_id,
                    'updates': kwargs
                }
            }
        })

    def list_chats(self) -> List[dict]:
        """列出所有聊天"""
        result = self._post('/mcp', {
            'jsonrpc': '2.0',
            'id': 22,
            'method': 'tools/call',
            'params': {
                'name': 'tavo_chat_list',
                'arguments': {}
            }
        })
        return result.get('chats', [])


def build_story_entries(story_data: dict) -> List[dict]:
    """构建故事世界书 entries"""
    entries = []

    # 世界规则 (constant)
    if 'world_rules' in story_data:
        entries.append({
            'name': '世界规则',
            'content': story_data['world_rules'],
            'strategy': 'constant',
            'enabled': True,
        })

    # 章节 (keyword)
    for i, chapter in enumerate(story_data.get('chapters', [])):
        entry = {
            'name': chapter['name'],
            'content': chapter.get('content', ''),
            'strategy': 'keyword',
            'enabled': i == 0,  # 只有第一章启用
        }
        if 'keywords' in chapter:
            entry['keywords'] = chapter['keywords']
        if 'completion_condition' in chapter:
            entry['content'] += f"\n\n【完成条件】{chapter['completion_condition']}"
        entries.append(entry)

    return entries


def cmd_create_worldbook(mcp: TavoMCP, args):
    """创建世界书"""
    with open(args.file, 'r', encoding='utf-8') as f:
        story_data = json.load(f)

    entries = build_story_entries(story_data)
    lorebook_id = mcp.create_lorebook(args.name or story_data.get('name', '未命名故事'), entries)

    print(f"世界书创建成功! ID: {lorebook_id}")
    return lorebook_id


def cmd_create_chat(mcp: TavoMCP, args):
    """创建群聊"""
    # 读取角色 ID
    with open(args.chars, 'r', encoding='utf-8') as f:
        char_ids = json.load(f)

    # 读取世界书 ID (可选)
    lorebook_ids = None
    if args.worldbook:
        lorebook_ids = [int(args.worldbook)]

    chat_id = mcp.create_chat(
        name=args.name,
        character_ids=char_ids,
        lorebook_ids=lorebook_ids,
    )

    print(f"群聊创建成功! ID: {chat_id}")

    # 设置 responseMode
    if args.mode:
        mcp.update_chat(chat_id, response_mode=args.mode)

    return chat_id


def cmd_create_character(mcp: TavoMCP, args):
    """创建角色"""
    with open(args.file, 'r', encoding='utf-8') as f:
        char_data = json.load(f)

    char_id = mcp.create_character(
        name=char_data['name'],
        first_mes=char_data.get('first_mes', '你好'),
        description=char_data.get('description', ''),
        personality=char_data.get('personality', ''),
    )

    print(f"角色创建成功! ID: {char_id}")
    return char_id


def cmd_list(mcp: TavoMCP, args):
    """列出资源"""
    if args.type == 'chats':
        chats = mcp.list_chats()
        for chat in chats:
            print(f"  [{chat['id']}] {chat['name']}")
    elif args.type == 'characters':
        # 需要实现 list_characters
        print("TODO: list characters")
    elif args.type == 'lorebooks':
        # 需要实现 list_lorebooks
        print("TODO: list lorebooks")


def main():
    parser = argparse.ArgumentParser(description='tavo MCP 操作工具')
    parser.add_argument('--url', default='http://localhost:7347/mcp',
                       help='MCP Server URL')
    parser.add_argument('--token', required=True,
                       help='MCP Bearer Token')

    sub = parser.add_subparsers(dest='cmd')

    # create-worldbook
    wb = sub.add_parser('create-worldbook', help='创建世界书')
    wb.add_argument('name', help='世界书名称')
    wb.add_argument('file', help='故事 JSON 文件')
    wb.set_defaults(func=cmd_create_worldbook)

    # create-chat
    ch = sub.add_parser('create-chat', help='创建群聊')
    ch.add_argument('name', help='聊天名称')
    ch.add_argument('chars', help='角色 ID JSON 文件')
    ch.add_argument('--worldbook', help='世界书 ID')
    ch.add_argument('--mode', help='回复模式 (scenario/natural/manual)')
    ch.set_defaults(func=cmd_create_chat)

    # create-character
    cr = sub.add_parser('create-character', help='创建角色')
    cr.add_argument('file', help='角色 JSON 文件')
    cr.set_defaults(func=cmd_create_character)

    # list
    ls = sub.add_parser('list', help='列出资源')
    ls.add_argument('type', choices=['chats', 'characters', 'lorebooks'])
    ls.set_defaults(func=cmd_list)

    args = parser.parse_args()

    if not hasattr(args, 'func'):
        parser.print_help()
        return

    mcp = TavoMCP(args.url, args.token)
    args.func(mcp, args)


if __name__ == '__main__':
    main()
