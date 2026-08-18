#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""找未配对 { 的行号"""
import sys

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    code = f.read()

depth_brace = 0
in_str = None
in_line_comment = False
in_block_comment = False
in_regex = False
i = 0
brace_stack = []

while i < len(code):
    ch = code[i]
    line = code[:i].count('\n') + 1

    if in_line_comment:
        if ch == '\n': in_line_comment = False
        i += 1; continue
    if in_block_comment:
        if ch == '*' and i+1 < len(code) and code[i+1] == '/':
            in_block_comment = False; i += 2; continue
        i += 1; continue
    if in_str:
        if ch == '\\': i += 2; continue
        if ch == in_str: in_str = None
        i += 1; continue
    if in_regex:
        if ch == '\\': i += 2; continue
        if ch == '/':
            in_regex = False; i += 1
            while i < len(code) and code[i].isalpha(): i += 1
            continue
        if ch == '[':
            i += 1
            while i < len(code) and code[i] != ']':
                if code[i] == '\\': i += 2; continue
                i += 1
            i += 1; continue
        i += 1; continue

    if ch == '/' and i+1 < len(code):
        nxt = code[i+1]
        if nxt == '/': in_line_comment = True; i += 2; continue
        if nxt == '*': in_block_comment = True; i += 2; continue
        j = i - 1
        while j >= 0 and code[j] in ' \t\r\n': j -= 1
        prev_ch = code[j] if j >= 0 else ''
        if prev_ch == '' or prev_ch in '(,=![!&|;{}~?:+-*/<>':
            in_regex = True; i += 1; continue
        i += 1; continue

    if ch in ('"', "'", '`'):
        in_str = ch; i += 1; continue

    if ch == '{':
        depth_brace += 1
        brace_stack.append(line)
    elif ch == '}':
        depth_brace -= 1
        if brace_stack: brace_stack.pop()
    i += 1

print('unclosed { at lines:', brace_stack)