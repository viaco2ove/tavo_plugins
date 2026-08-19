#!/usr/bin/env python3
# 把扩展后的 tf_llm 变量推到 tavo（global + chat 双写，对齐插件 saveLlmConfig）
import json, requests

# 读取 .env
env = {}
for line in open('.env', encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()

URL = env['tavo_mcp_url']
TOKEN = env['tavo_mcp_toekn']

TF_LLM = {
    "enabled": True,
    "apiUrl": "",
    "apiKey": "",
    "apiMode": "",
    "model": "",
    "reasoningEffort": "minimal",
    "temperature": 0.3,
    "topP": 0.5,
    "topK": None,
    "maxTokens": 1500,
    "memoryLength": 20,
    "stream": True,
}

def call(name, arguments):
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    r = requests.post(URL, json=payload,
                      headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
                      timeout=30)
    try:
        return r.json()
    except Exception:
        return {"raw": r.text, "status": r.status_code}

# global
print("== set global.tf_llm ==")
print(json.dumps(call('tavo_variable_set', {'scope': 'global', 'name': 'tf_llm', 'value': json.dumps(TF_LLM)}), ensure_ascii=False)[:300])

# chat 1（双写）
print("\n== set chat(1).tf_llm ==")
print(json.dumps(call('tavo_variable_set', {'scope': 'chat', 'chatId': 1, 'name': 'tf_llm', 'value': json.dumps(TF_LLM)}), ensure_ascii=False)[:300])
