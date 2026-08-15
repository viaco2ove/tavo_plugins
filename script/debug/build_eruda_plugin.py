#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_eruda_plugin.py - 生成"独立 Eruda 调试插件"

把 Eruda 调试面板做成一个独立 Tavo 插件（不污染业务插件）。
核心思路：插件 iframe 与宿主同源（sandbox.js 直接访问 window.parent.tav），
因此把 Eruda 注入到 window.parent.document，使 Eruda 的 Elements 能看到
【整个 WebView】（宿主聊天页 + 所有插件 iframe），而不只是本插件 iframe。

用法:
  python debug/build_eruda_plugin.py
  -> 生成 plugins/toonflow_story_debug_eruda/
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # tavo_plugins
ERUDA_SRC = os.path.join(ROOT, "debug", "eruda.min.js")
OUT_DIR = os.path.join(ROOT, "plugins", "toonflow_story_debug_eruda")

PLUGIN_ID = "com.toonflow.story-debug-eruda"
PLUGIN_VERSION = "1.0.0"


def main():
    if not os.path.isfile(ERUDA_SRC):
        raise SystemExit("缺少 debug/eruda.min.js，请先下载 Eruda")
    eruda = open(ERUDA_SRC, "r", encoding="utf-8").read()
    # 转成合法的 JS 字符串字面量（json.dumps 会正确转义引号/反斜杠/换行）
    eruda_js_str = json.dumps(eruda)

    os.makedirs(os.path.join(OUT_DIR, "ui"), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "locales"), exist_ok=True)

    # ---- manifest.json ----
    manifest = {
        "specVersion": 2,
        "id": PLUGIN_ID,
        "name": {"$t": "plugin.name"},
        "version": PLUGIN_VERSION,
        "minAppVersion": "1.0.0",
        "entry": "entry.js",
        "author": "viaco",
        "description": {"$t": "plugin.description"},
        "localization": {
            "defaultLocale": "zh-CN",
            "resources": {
                "en": "locales/en.json",
                "zh-CN": "locales/zh-CN.json",
            },
        },
        "permissions": [],
        "contributes": {
            "htmlFragments": [
                {
                    "id": "eruda-debug-panel",
                    "src": "ui/eruda_debug.html",
                    "mount": "/chat/body/start",
                }
            ]
        },
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # ---- locales ----
    zh = {
        "plugin.name": "Eruda 调试面板",
        "plugin.description": "在聊天页注入 Eruda 开发者工具，用于调试插件与查看 WebView 内容（宿主聊天页 + 所有插件）。",
    }
    en = {
        "plugin.name": "Eruda Debug Panel",
        "plugin.description": "Inject Eruda devtools into chat page to debug plugins and inspect the whole WebView (host chat + all plugins).",
    }
    with open(os.path.join(OUT_DIR, "locales", "zh-CN.json"), "w", encoding="utf-8") as f:
        json.dump(zh, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT_DIR, "locales", "en.json"), "w", encoding="utf-8") as f:
        json.dump(en, f, ensure_ascii=False, indent=2)

    # ---- entry.js（占位，逻辑全在 html 片段）----
    entry = (
        "// Eruda debug plugin entry. All logic lives in ui/eruda_debug.html.\n"
        "console.log('[eruda-debug] plugin entry loaded');\n"
    )
    with open(os.path.join(OUT_DIR, "entry.js"), "w", encoding="utf-8") as f:
        f.write(entry)

    # ---- ui/eruda_debug.html（注入 Eruda 到宿主 document）----
    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;width:0;height:0;overflow:hidden;">
<script>
(function(){
  var ERUDA_SRC = __ERUDA_SRC__;
  function boot(targetWindow, targetDoc, label){
    try {
      var s = targetDoc.createElement('script');
      s.textContent = ERUDA_SRC;
      (targetDoc.head || targetDoc.documentElement).appendChild(s);
      var s2 = targetDoc.createElement('script');
      s2.textContent = "try{if(window.eruda){window.eruda.init({tool:['console','elements','network','resources','info','snippets']});window.eruda.show();}}catch(e){console.error('[eruda-debug] init fail',e);}";
      (targetDoc.head || targetDoc.documentElement).appendChild(s2);
      console.log('[eruda-debug] injected into ' + label);
    } catch(e) {
      console.error('[eruda-debug] inject into ' + label + ' failed', e);
    }
  }
  try {
    var p = window.parent;
    if (p && p !== window) {
      if (p.__erudaDebugInjected) {
        console.log('[eruda-debug] already injected into parent, skip');
      } else {
        p.__erudaDebugInjected = true;
        boot(p, p.document, 'PARENT (whole webview)');
      }
    } else {
      boot(window, document, 'SELF iframe');
    }
  } catch(e) {
    // 跨域或 CSP 阻止访问 parent -> 退回到自身 iframe
    console.error('[eruda-debug] cannot reach parent, fallback to self', e);
    boot(window, document, 'SELF iframe (fallback)');
  }
})();
</script>
</body>
</html>
"""
    html = html.replace("__ERUDA_SRC__", eruda_js_str)
    with open(os.path.join(OUT_DIR, "ui", "eruda_debug.html"), "w", encoding="utf-8") as f:
        f.write(html)

    print("[OK] 生成独立 Eruda 插件: %s" % OUT_DIR)
    print("     manifest.json / entry.js / locales/* / ui/eruda_debug.html")
    print("     Eruda 内联大小: %.1f KB" % (len(eruda) / 1024))
    print("     注入目标: window.parent.document（整页 WebView）")


if __name__ == "__main__":
    main()
