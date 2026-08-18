#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MCP JSON-RPC 客户端封装"""
import json
import os
import urllib.request
import urllib.error


class McpClient:
    def __init__(self, url=None, token=None, env_path=None):
        self.url = url or os.environ.get("TAVO_MCP_URL", "")
        self.token = token or os.environ.get("TAVO_MCP_TOKEN", "") or os.environ.get("TAVO_MCP_TOEKN", "")
        if env_path:
            for line in open(env_path, encoding="utf-8"):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "tavo_mcp_url":
                    self.url = self.url or v
                elif k in ("tavo_mcp_token", "tavo_mcp_toekn"):
                    self.token = self.token or v

        if not self.url or not self.token:
            raise RuntimeError("缺少 MCP 配置：url 和 token（传参或 .env 文件）")

    def call(self, method, arguments=None, timeout=120):
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": method, "arguments": arguments or {}},
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.url, data=data,
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.token},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            raise RuntimeError(f"MCP 连接失败: {e}")
        if "error" in body:
            raise RuntimeError(f"MCP Error: {json.dumps(body['error'], ensure_ascii=False)}")
        return body.get("result", {})

    def unwrap(self, result):
        """解析 MCP 返回：{content: [{text: '...'}]} → dict/list/str"""
        raw = result or {}
        try:
            content = raw.get("content", [])
            if content and isinstance(content, list):
                text = content[0].get("text", "{}")
                parsed = json.loads(text)
                # 直接返回 list 不包一层
                return parsed
        except Exception:
            pass
        if isinstance(raw, dict):
            return raw
        return raw

    def get(self, method, arguments=None):
        return self.unwrap(self.call(method, arguments))

    def plugin_list(self):
        return self.get("tavo_plugin_search", {"query": "", "limit": 100})

    def plugin_install(self, plugin_id, zip_b64, overwrite=True):
        return self.call("tavo_plugin_install", {
            "pluginId": plugin_id, "zipBase64": zip_b64, "overwrite": overwrite,
        })

    def plugin_set_enabled(self, plugin_id, enabled=True):
        return self.call("tavo_plugin_set_enabled", {
            "pluginId": plugin_id, "enabled": enabled,
        })

    def file_save(self, chat_id, name, content_b64, scope="chat"):
        return self.unwrap(self.call("tavo_file_save", {
            "chatId": chat_id, "name": name, "content": content_b64,
            "options": {"scope": scope, "encoding": "base64"},
        }))

    def variable_set(self, chat_id, name, value, scope="chat"):
        args = {"scope": scope, "name": name, "value": value}
        if scope == "chat":
            args["chatId"] = chat_id
        return self.call("tavo_variable_set", args)

    def variable_get(self, chat_id, name, scope="chat"):
        args = {"scope": scope, "name": name}
        if scope == "chat":
            args["chatId"] = chat_id
        return self.get("tavo_variable_get", args)

    def character_search(self, query, limit=5):
        return self.get("tavo_character_search", {"query": query, "limit": limit})

    def character_import_card(self, card):
        return self.unwrap(self.call("tavo_character_import_card", {"card": card}))

    def persona_create(self, persona):
        return self.unwrap(self.call("tavo_persona_create", {"persona": persona}))

    def persona_search(self, query, limit=5):
        return self.get("tavo_persona_search", {"query": query, "limit": limit})

    def persona_set_active(self, persona_id):
        return self.call("tavo_persona_set_active", {"id": persona_id})

    def lorebook_search(self, query, limit=5):
        return self.get("tavo_lorebook_search", {"query": query, "limit": limit})

    def lorebook_create(self, name, entries):
        return self.unwrap(self.call("tavo_lorebook_create", {
            "lorebook": {"Name": name, "entries": entries}
        }))

    def lorebook_update(self, lorebook_id, entries):
        lid = int(lorebook_id) if str(lorebook_id).isdigit() else lorebook_id
        return self.call("tavo_lorebook_update", {
            "id": lid, "lorebook": {"entries": entries},
        })

    def chat_create(self, chat_dict):
        return self.unwrap(self.call("tavo_chat_create", {"chat": chat_dict}))

    def chat_update(self, chat_id, **kwargs):
        return self.call("tavo_chat_update", {"id": chat_id, "chat": kwargs})

    def chat_get(self, chat_id):
        return self.get("tavo_chat_get", {"chatId": chat_id})

    def chat_search(self, query, limit=5):
        return self.get("tavo_chat_search", {"query": query, "limit": limit})