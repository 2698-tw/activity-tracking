(function () {
  const me = document.currentScript, page = me && me.dataset.page;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  let id = '';
  try {
    id = localStorage.getItem('site.vid') || '';
    if (!/^[0-9a-f]{32}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('site.vid', id);
    }
  } catch { return; }
  const ua = navigator.userAgent;
  const dev = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'phone' : 'computer';
  const api = location.hostname.endsWith('.workers.dev') ? '/api' : 'https://data-collection.jk06nm04.workers.dev/api';
  let last = '', lastAt = 0;
  const hit = p => {
    if (p === last && Date.now() - lastAt < 2000) return;
    last = p; lastAt = Date.now();
    try { fetch(api + '/hit', { method: 'POST', keepalive: true, headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ p, v: id, d: dev }) }).catch(() => {}); } catch {}
  };
  if (page) { if (window.top === window.self) hit(page); return; }
  addEventListener('viewchange', e => { if (e.detail && e.detail !== 'admin') hit(e.detail); });
})();
