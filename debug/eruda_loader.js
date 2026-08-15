/**
 * eruda_loader.js
 *
 * 在 Tavo WebView 内部注入一个完整的开发者工具面板（Eruda）。
 * 用法：在插件 HTML 片段的 <script> 最前面加一行：
 *   <script src="../../debug/eruda_loader.js"></script>
 * 或直接把本文件内容内联到 <script> 标签中。
 *
 * Eruda 是一个纯前端实现的 Console / Elements / Network / Resources 面板，
 * 不依赖 Chrome DevTools Protocol，在任何 WebView 里都能跑。
 * 官网：https://eruda.liriliri.io/
 */
(function () {
  if (window.__erudaLoaded) return;
  window.__erudaLoaded = true;

  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js';
  s.onload = function () {
    if (typeof eruda === 'undefined') {
      console.error('[eruda_loader] eruda undefined after load');
      return;
    }
    eruda.init({
      tool: ['console', 'elements', 'network', 'resources', 'info', 'settings'],
      autoScale: true,
      defaults: {
        displaySize: 50,
        transparency: 0.9,
        theme: 'auto'
      }
    });
    console.log('%c[eruda] DevTools ready', 'color:#7cb3ff;font-weight:bold');
    console.log('[eruda] 当前页面 URL:', location.href);
    console.log('[eruda] tavo API:', typeof tavo !== 'undefined' ? 'available' : 'NOT available');
    console.log('[eruda] 检测到的插件元素:',
      document.querySelectorAll('[id^="tf-"]').length, '个');
  };
  s.onerror = function () {
    console.error('[eruda_loader] CDN 加载失败，尝试备用源...');
    var s2 = document.createElement('script');
    s2.src = 'https://unpkg.com/eruda@3.4.1/eruda.min.js';
    s2.onload = function () {
      eruda.init({ tool: ['console', 'elements', 'network'] });
      console.log('[eruda] DevTools ready (unpkg fallback)');
    };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
})();
