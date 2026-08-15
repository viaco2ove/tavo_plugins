/**
 * mock_tavo.js
 *
 * 在浏览器中独立测试插件 UI 时使用的 Tavo API 模拟层。
 * 提供与真实 Tavo JS API 相同的接口签名，数据存在内存/localStorage。
 *
 * 用法：在浏览器中打开 test_harness.html，它会自动加载本文件 + 你的插件 HTML。
 */
(function (global) {
  'use strict';

  var _store = {};          // 内存变量存储 { key: value }
  var _listeners = {};      // 事件监听器 { eventName: [fn, fn] }
  var _sidebarActions = {}; // { actionId: fn }
  var _messages = [];       // 模拟消息列表
  var _chats = [];          // 模拟聊天列表
  var _currentChatId = null;

  // 持久化到 localStorage（方便刷新后恢复）
  function persist() {
    try {
      localStorage.setItem('__mock_tavo_store', JSON.stringify(_store));
      localStorage.setItem('__mock_tavo_messages', JSON.stringify(_messages));
    } catch (e) {}
  }
  function restore() {
    try {
      var s = localStorage.getItem('__mock_tavo_store');
      if (s) _store = JSON.parse(s);
      var m = localStorage.getItem('__mock_tavo_messages');
      if (m) _messages = JSON.parse(m);
    } catch (e) {}
  }
  restore();

  function log(method, args) {
    console.log('%c[tavo.mock]', 'color:#ff9966', method, args);
  }

  var mockTavo = {
    // ===== 变量存储 =====
    get: function (key) {
      var v = _store[key];
      log('get', { key: key, value: v });
      return v;
    },
    set: function (key, value, scope) {
      _store[key] = value;
      log('set', { key: key, value: value, scope: scope });
      persist();
    },

    // ===== 消息 API =====
    message: {
      count: async function () { return _messages.length; },
      find: async function (range) {
        if (Array.isArray(range) && range.length === 2) {
          var start = range[0], end = range[1];
          return _messages.slice(start, end + 1);
        }
        return _messages.slice();
      },
      update: async function (msg) {
        var idx = _messages.findIndex(function (m) { return m.id === msg.id; });
        if (idx >= 0) {
          _messages[idx] = Object.assign(_messages[idx], msg);
          persist();
        }
        log('message.update', { id: msg.id, hidden: msg.hidden });
      },
      add: async function (msg) {
        msg.id = msg.id || ('msg_' + Date.now());
        msg.timestamp = msg.timestamp || Date.now();
        _messages.push(msg);
        persist();
        // 触发 message:added 事件
        fireEvent('message:added', { message: msg });
        return msg;
      },
      clear: function () { _messages = []; persist(); },
      all: function () { return _messages.slice(); }
    },

    // ===== 聊天 API =====
    chat: {
      current: async function () {
        return {
          id: _currentChatId || 'mock-chat-001',
          title: 'Mock Chat',
          theme: { id: 1 }
        };
      },
      list: async function () { return _chats; }
    },

    // ===== 主题 API =====
    theme: {
      get: async function (id) {
        return {
          id: id,
          userBubble: { color: '#7B68EE' },
          characterBubble: { color: '#FF6B6B' },
          name: 'Mock Theme'
        };
      }
    },

    // ===== 生成 API =====
    generate: async function (opts) {
      log('generate', opts);
      return { text: '这是一条模拟的 AI 回复。', role: 'character' };
    },

    // ===== 输入 API =====
    input: {
      send: async function (text) {
        log('input.send', text);
        var msg = { id: 'msg_' + Date.now(), role: 'user', text: text, hidden: false };
        _messages.push(msg);
        persist();
        fireEvent('message:added', { message: msg });
      }
    },

    // ===== 插件 API =====
    plugin: {
      on: function (eventName, handler) {
        if (!_listeners[eventName]) _listeners[eventName] = [];
        _listeners[eventName].push(handler);
        log('plugin.on', eventName);
      },
      off: function (eventName, handler) {
        if (!_listeners[eventName]) return;
        var idx = _listeners[eventName].indexOf(handler);
        if (idx >= 0) _listeners[eventName].splice(idx, 1);
      },
      onSidebarAction: function (actionId, handler) {
        _sidebarActions[actionId] = handler;
        log('plugin.onSidebarAction', actionId);
      },
      onInputAction: function (actionId, handler) {
        log('plugin.onInputAction', actionId);
      },
      i18n: {
        t: function (key) { return key; },
        locale: function () { return 'zh-CN'; },
        onChange: function (handler) { /* no-op in mock */ }
      }
    },

    // ===== 工具 API =====
    utils: {
      preview: function (html) {
        var w = window.open('', '_blank');
        if (w) w.document.write(html);
      }
    },

    // ===== 文件 API =====
    file: {
      import: async function () {
        return { name: 'mock_file.txt', content: 'mock content' };
      },
      export: async function (name, content) {
        var blob = new Blob([content], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
      }
    },

    // ===== Mock 辅助方法（仅测试用） =====
    __mock: {
      fireEvent: fireEvent,
      getStore: function () { return _store; },
      getMessages: function () { return _messages; },
      addMessage: async function (role, text) {
        var msg = { id: 'msg_' + Date.now(), role: role, text: text, hidden: false };
        _messages.push(msg);
        persist();
        fireEvent('message:added', { message: msg });
        return msg;
      },
      reset: function () {
        _store = {}; _messages = []; _listeners = {}; _sidebarActions = {};
        localStorage.removeItem('__mock_tavo_store');
        localStorage.removeItem('__mock_tavo_messages');
        console.log('[tavo.mock] 已重置所有 mock 数据');
      }
    }
  };

  function fireEvent(eventName, event) {
    var handlers = _listeners[eventName];
    if (!handlers) return;
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](event); } catch (e) { console.error('[tavo.mock] 事件处理错误:', e); }
    }
  }

  // 注入到全局
  global.tavo = mockTavo;
  console.log('%c[tavo.mock] Tavo API mock 已加载', 'color:#ff9966;font-weight:bold');
  console.log('[tavo.mock] 可用方法: tavo.get/set, tavo.message.*, tavo.chat.*, tavo.theme.*, tavo.generate, tavo.input.send, tavo.plugin.*');
  console.log('[tavo.mock] 辅助: tavo.__mock.addMessage(role, text), tavo.__mock.fireEvent(name, evt), tavo.__mock.reset()');
})(typeof window !== 'undefined' ? window : this);
