/* ---------------- Whitebeard ranking card (#whitebeard) ---------------- */
// Every Whitebeard read the 2698 Data Extractor bookmark makes (docs/extractor.js) is sent to the
// Worker (api/wb-update) and kept under its UTC date: a read on a new day adds a column, another
// read the same day replaces that day's. This page only shows it (api/wb), with no UIDs.

(function () {
  const W = { rows: null, dates: [], ally: '', sort: '', asc: false, loading: false };
  const ALLIANCES = ['698N', '698S', '698W', '698C'];
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const head = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  async function load() {
    if (W.loading) return;
    W.loading = true; draw();
    try {
      const r = await fetch(API_BASE + '/wb', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      W.rows = j.rows || []; W.dates = j.dates || []; W.err = '';
      if (!W.dates.includes(W.sort) && W.sort !== 'name' && W.sort !== 'ally') { W.sort = W.dates[W.dates.length - 1] || 'name'; W.asc = W.sort === 'name'; }
    } catch (e) { W.err = 'The Whitebeard ranking could not be loaded: ' + (e.message || e); }
    W.loading = false; draw();
    $('wbView').scrollLeft = 1e6;                 // the latest day in view
  }

  function draw() {
    const box = $('wbView');
    if (!box) return;
    const q = fold($('wbQ').value), last = W.dates[W.dates.length - 1];
    $('wbReads').textContent = W.rows ? `${W.rows.length} players · ${W.dates.length} ${W.dates.length === 1 ? 'day' : 'days'}` + (last ? ` · last read ${head(last)}` : '') : '';
    const rows = (W.rows || []).filter(r => (!q || fold(r.name).includes(q)) &&
      (!W.ally || (W.ally === 'OTHER' ? !ALLIANCES.includes(r.ally) : r.ally === W.ally)));
    $('wbChips').innerHTML =
      ['', ...ALLIANCES, 'OTHER'].map(a => `<button type="button" class="rchip ${W.ally === a ? 'on' : ''}" data-a="${a}">${a === 'OTHER' ? 'Other' : a || 'Everyone'}</button>`).join('') +
      (W.rows ? `<span class="rcount">${rows.length} of ${W.rows.length} players</span>` : '');
    if (W.err) { box.innerHTML = `<p class="rnote">${esc(W.err)}</p>`; return; }
    if (!W.rows) { box.innerHTML = '<p class="rnote">Loading…</p>'; return; }
    if (!W.rows.length) { box.innerHTML = '<p class="rnote">Nothing yet. Read the Whitebeard ranking with the 2698 Data Extractor bookmark in the game, and it appears here.</p>'; return; }
    const k = W.sort, dir = W.asc ? 1 : -1;
    rows.sort((a, b) => k === 'name' || k === 'ally' ? String(a[k]).localeCompare(String(b[k])) * dir : ((a.pts[k] ?? -1) - (b.pts[k] ?? -1)) * dir);
    const arrow = c => W.sort === c ? (W.asc ? ' ▲' : ' ▼') : '';
    box.innerHTML = `<table class="rtable wbtable"><thead><tr><th data-k="name">Name${arrow('name')}</th><th data-k="ally">Alliance${arrow('ally')}</th>` +
      W.dates.map(d => `<th class="d" data-k="${d}">${head(d)}${arrow(d)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.ally ? `<span class="rtag t${esc(r.ally)}">${esc(r.ally)}</span>` : '<span class="rdim">—</span>'}</td>` +
        W.dates.map(d => `<td class="n">${r.pts[d] == null ? '<span class="rdim">—</span>' : r.pts[d].toLocaleString('en-US')}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>';
    box.querySelectorAll('th').forEach(th => th.onclick = () => { const c = th.dataset.k; W.asc = W.sort === c ? !W.asc : c === 'name' || c === 'ally'; W.sort = c; draw(); });
  }

  $('wbChips').onclick = e => { const b = e.target.closest('button'); if (!b) return; W.ally = b.dataset.a; draw(); };
  $('wbQ').oninput = draw;
  $('wbReload').onclick = load;
  // load whenever the view is opened
  const maybe = () => { if (location.hash === '#whitebeard') load(); };
  addEventListener('hashchange', maybe);
  maybe();
})();
