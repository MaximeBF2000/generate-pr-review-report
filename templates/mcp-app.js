// MCP Apps view bridge (https://modelcontextprotocol.io/docs/extensions/apps).
// Inlined into the report page when an agent host (Claude, Codex, VS Code…)
// shows it as an MCP app. It speaks the protocol's JSON-RPC over postMessage
// directly, so the page stays a single self-contained file with no bundler.
(() => {
  const PROTOCOL_VERSION = '2026-01-26';
  const HTML_META_KEY = 'generate-pr-review-report/html';
  const root = document.documentElement;
  root.classList.add('mcp-app');
  const pending = new Map();
  let nextId = 1;
  let host = { capabilities: {}, context: {} };
  let current = null; // { html, fileName } of the report on screen

  // ---------- JSON-RPC over postMessage ----------
  const post = (message) => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const notify = (method, params) => post({ method, params });
  function request(method, params) {
    const id = nextId++;
    post({ id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id != null && !msg.method) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || 'Request failed'));
      else waiter.resolve(msg.result);
      return;
    }
    switch (msg.method) {
      case 'ui/notifications/tool-result': onToolResult(msg.params || {}); break;
      case 'ui/notifications/tool-cancelled': showMessage('The report tool was cancelled.'); break;
      case 'ui/notifications/host-context-changed': applyHostContext(msg.params || {}); break;
      case 'ui/resource-teardown': post({ id: msg.id, result: {} }); break;
      case 'ping': if (msg.id != null) post({ id: msg.id, result: {} }); break;
      default:
        // Answer any other request so the host never waits on us.
        if (msg.id != null) post({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  });

  // ---------- Host context: theme and display mode ----------
  function applyHostContext(ctx) {
    host.context = { ...host.context, ...ctx };
    if (ctx.theme === 'light' || ctx.theme === 'dark') {
      root.dataset.theme = ctx.theme;
      window.prReport.syncViewControls();
    }
    const modes = host.context.availableDisplayModes || [];
    const fullscreen = document.querySelector('[data-action="app-fullscreen"]');
    fullscreen.hidden = !modes.includes('fullscreen');
    const on = host.context.displayMode === 'fullscreen';
    fullscreen.setAttribute('aria-pressed', String(on));
    fullscreen.title = on ? 'Exit full screen' : 'Expand to full screen';
    fullscreen.setAttribute('aria-label', fullscreen.title);
  }

  // ---------- Showing a report ----------
  function showMessage(text, isError = false) {
    const main = document.querySelector('main.app');
    main.innerHTML = `<div class="app-loading${isError ? ' error' : ''}"><span class="spinner" aria-hidden="true"></span><p></p></div>`;
    main.querySelector('p').textContent = text;
  }

  async function onToolResult(result) {
    const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result.isError) { showMessage(text || 'The report could not be generated.', true); return; }
    let html = result._meta && result._meta[HTML_META_KEY];
    const info = result.structuredContent || {};
    // Some hosts do not pass the result's _meta to the app: fetch the HTML
    // through the app-only tool instead.
    if (!html && info.reportId) {
      try {
        const fetched = await request('tools/call', { name: 'get_pr_review_report_html', arguments: { reportId: info.reportId } });
        html = fetched && fetched._meta && fetched._meta[HTML_META_KEY];
      } catch {}
    }
    if (!html) { showMessage(text || 'No report was returned.', true); return; }
    showReport(html, info.fileName || 'review-report.html');
  }

  // Moves the report's content into this page (same template, so the styles
  // and the interaction script already match) and runs its script again.
  function showReport(html, fileName) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main.app');
    const data = doc.getElementById('review-data');
    if (!main || !data) { showMessage('This file is not a report made by generate-pr-review-report.', true); return; }
    document.querySelector('main.app').innerHTML = main.innerHTML;
    document.getElementById('review-data').textContent = data.textContent;
    document.title = doc.title;
    const time = doc.querySelector('time.generated');
    const here = document.querySelector('time.generated');
    if (time && here) { here.textContent = time.textContent; here.setAttribute('datetime', time.getAttribute('datetime') || ''); }
    const size = doc.documentElement.dataset.size;
    if (size) root.dataset.size = size;
    // The host's theme wins over the one the report was generated with.
    const theme = host.context.theme || doc.documentElement.dataset.theme;
    if (theme) root.dataset.theme = theme;
    current = { html, fileName };
    document.querySelector('[data-action="app-download"]').hidden = !host.capabilities.downloadFile;
    window.prReport.load();
  }

  // ---------- Buttons and links ----------
  document.addEventListener('click', async (event) => {
    // The sandbox blocks new windows: ask the host to open links instead.
    const link = event.target.closest('a[href]');
    if (link && /^(https?:|mailto:)/i.test(link.getAttribute('href'))) {
      event.preventDefault();
      try { await request('ui/open-link', { url: link.href }); } catch { window.prReport.toast('The host did not open the link.'); }
      return;
    }
    const target = event.target.closest('[data-action^="app-"]');
    if (!target) return;
    if (target.dataset.action === 'app-fullscreen') {
      const mode = host.context.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
      try { applyHostContext({ displayMode: (await request('ui/request-display-mode', { mode })).mode }); } catch {}
    } else if (target.dataset.action === 'app-download' && current) {
      try {
        const res = await request('ui/download-file', { contents: [{ type: 'resource', resource: { uri: `file:///${encodeURIComponent(current.fileName)}`, mimeType: 'text/html', text: current.html } }] });
        if (res && res.isError) window.prReport.toast('Download cancelled.');
      } catch { window.prReport.toast('The host could not download the file.'); }
    }
  });

  // ---------- Size: let the host fit the frame to the report ----------
  let sizeTimer, lastSize = '';
  const sendSize = () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      // Measure the body, not the viewport, so the frame can shrink again.
      const box = document.body.getBoundingClientRect();
      const width = Math.ceil(box.width), height = Math.ceil(box.height);
      if (`${width}x${height}` === lastSize) return;
      lastSize = `${width}x${height}`;
      notify('ui/notifications/size-changed', { width, height });
    }, 60);
  };
  new ResizeObserver(sendSize).observe(document.body);

  // ---------- Handshake ----------
  request('ui/initialize', {
    appInfo: { name: 'generate-pr-review-report', version: '1' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: PROTOCOL_VERSION,
  }).then((res) => {
    host = { capabilities: (res && res.hostCapabilities) || {}, context: {} };
    applyHostContext((res && res.hostContext) || {});
    notify('ui/notifications/initialized', {});
    sendSize();
  }).catch(() => showMessage('Could not connect to the agent host.', true));
})();
