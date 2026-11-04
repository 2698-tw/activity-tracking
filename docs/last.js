/* ---------------- The last answer to each of the Worker's lists, kept in this browser ---------------- */
// Every view shows what it showed last time at once (Last.post(...).now), then the Worker's fresh answer
// when it comes (.next), redrawn only when it changed (.same). The site and the pages in its frames
// (frost.html, nc.html, player.html) share it, so a list one of them asked for is there for the others.
// Only what the pages show anyway is kept (no UIDs: the Worker never sends them). A browser that keeps
// nothing (a private window, blocked storage) simply waits for the Worker, as before.
(function () {
  const K = 'last:';
  const read = k => { try { return localStorage.getItem(K + k); } catch { return null; } };
  function keep(k, text) {
    try { localStorage.setItem(K + k, text); }
    catch {      // full: the other lists make room (they come back on their next visit)
      try { Object.keys(localStorage).filter(x => x.startsWith(K) && x !== K + k).forEach(x => localStorage.removeItem(x)); localStorage.setItem(K + k, text); } catch {}
    }
  }
  // the same request twice at once (two cards, a card and a frame) asks the Worker once
  const flying = new Map();
  // url → { now: the last answer or null, next: the fresh answer (rejects with the Worker's error), same: whether it was the last one }
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
          return { j, text };
        })
        .finally(() => setTimeout(() => flying.delete(url), 0));
      flying.set(url, ask);
    }
    out.next = ask.then(({ j, text }) => { out.same = text === was; return j; });
    return out;
  }
  // a number kept between visits (a frame's last height)
  const num = { get: k => Number(read(k)) || 0, set: (k, v) => keep(k, String(v)) };
  window.Last = { post, num };
})();
