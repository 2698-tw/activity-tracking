(function () {
  const K = 'last:', AT = 'lastat:';
  const read = k => { try { return localStorage.getItem(K + k); } catch { return null; } };
  function keep(k, text) {
    try { localStorage.setItem(K + k, text); }
    catch {
      try { Object.keys(localStorage).filter(x => x.startsWith(K) && x !== K + k).forEach(x => localStorage.removeItem(x)); localStorage.setItem(K + k, text); } catch {}
    }
  }
  const flying = new Map();
  function post(url) {
    const was = read(url);
    let now = null;
    try { now = was ? JSON.parse(was) : null; } catch {}
    const out = { now, same: false };
    let ask = flying.get(url);
    if (!ask) {
      ask = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(async r => {
          const text = await r.text();
          let j = null; try { j = JSON.parse(text); } catch {}
          if (!r.ok) throw new Error((j && j.error) || 'The Worker answered ' + r.status);
          if (!j) throw new Error('The Worker\'s answer could not be read');
          keep(url, text);
          try { localStorage.setItem(AT + url, String(Date.now())); } catch {}
          return { j, text };
        })
        .finally(() => setTimeout(() => flying.delete(url), 0));
      flying.set(url, ask);
    }
    out.next = ask.then(({ j, text }) => { out.same = text === was; return j; });
    return out;
  }
  const num = { get: k => Number(read(k)) || 0, set: (k, v) => keep(k, String(v)) };
  function warm(urls, ms) {
    for (const url of urls) {
      let at = 0; try { at = Number(localStorage.getItem(AT + url)) || 0; } catch {}
      if (Date.now() - at < ms && read(url)) continue;
      post(url).next.catch(() => {});
    }
  }
  window.Last = { post, num, warm };
})();
