#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描 JS 文件括号配对（跳过字符串/注释/模板/正则）"""
import sys

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    code = f.read()

depth_brace = 0
depth_paren = 0
depth_bracket = 0
in_str = None
in_line_comment = False
in_block_comment = False
in_regex = False
i = 0
prev_significant = ''
errors = []

while i < len(code):
    ch = code[i]
    line = code[:i].count('\n') + 1

    # 注释
    if in_line_comment:
        if ch == '\n':
            in_line_comment = False
        i += 1
        continue
    if in_block_comment:
        if ch == '*' and i+1 < len(code) and code[i+1] == '/':
            in_block_comment = False
            i += 2
            continue
        i += 1
        continue

    # 字符串
    if in_str:
        if ch == '\\':
            i += 2
            continue
        if ch == in_str:
            in_str = None
        i += 1
        continue

    # 正则字面量（简化：在 = ( , [ 等之后以 / 开头视为正则）
    if in_regex:
        if ch == '\\':
            i += 2
            continue
        if ch == '/':
            in_regex = False
            # 跳过 flags
            i += 1
            while i < len(code) and code[i].isalpha():
                i += 1
            continue
        # 字符类 [...]
        if ch == '[':
            # 跳到 ]
            i += 1
            while i < len(code) and code[i] != ']':
                if code[i] == '\\':
                    i += 2
                    continue
                i += 1
            i += 1
            continue
        i += 1
        continue

    # 检测注释/字符串/正则开始
    if ch == '/' and i+1 < len(code):
        nxt = code[i+1]
        if nxt == '/':
            in_line_comment = True
            i += 2
            continue
        if nxt == '*':
            in_block_comment = True
            i += 2
            continue
        # 可能是正则：看前面非空白字符
        # 简化：如果前面是 ( , = [ ! & | ; { } 或开头，则是正则
        j = i - 1
        while j >= 0 and code[j] in ' \t\r\n':
            j -= 1
        prev_ch = code[j] if j >= 0 else ''
        if prev_ch in '' or prev_ch in '(,=![!&|;{}~?:+-*/<>':
            in_regex = True
            i += 1
            continue
        # 否则是除号
        i += 1
        continue

    if ch in ('"', "'", '`'):
        in_str = ch
        i += 1
        continue

    if ch == '{':
        depth_brace += 1
    elif ch == '}':
        depth_brace -= 1
        if depth_brace < 0:
            errors.append(('extra }', line))
            depth_brace = 0
    elif ch == '(':
        depth_paren += 1
    elif ch == ')':
        depth_paren -= 1
        if depth_paren < 0:
            errors.append(('extra )', line))
            depth_paren = 0
    elif ch == '[':
        depth_bracket += 1
    elif ch == ']':
        depth_bracket -= 1
        if depth_bracket < 0:
            errors.append(('extra ]', line))
            depth_bracket = 0

    if not ch.isspace():
        prev_significant = ch
    i += 1

print('final depth: brace=%d paren=%d bracket=%d' % (depth_brace, depth_paren, depth_bracket))
print('errors:', errors[:10])
