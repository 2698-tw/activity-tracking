/* ---------------- Whitebeard (#whitebeard) and Snow Train (#snowtrain) cards ---------------- */
// Every Whitebeard read and every Snow Train Unit Details read the 2698 Data Extractor bookmark makes
// (docs/extractor.js) is sent to the Worker (api/wb-update, api/st-update) and kept under its UTC
// date: a read on a new day adds a column, another read the same day replaces that day's. These
// pages only show it (api/wb, api/st), with no UIDs.

function dayCard(o) {
  const W = { rows: null, dates: [], ally: '', type: '', sort: '', asc: false, loading: false };
  const ALLIANCES = ['698N', '698S', '698W', '698C'], TYPES = ['Army', 'Navy', 'Air Force'];
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const head = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const el = k => $(o.id + k);

  async function load() {
    if (W.loading) return;
    W.loading = true; draw();
    try {
      const r = await fetch(API_BASE + o.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      W.rows = j.rows || []; W.dates = j.dates || []; W.err = '';
      if (!W.dates.includes(W.sort) && !['name', 'ally', 'type', 'best'].includes(W.sort)) { W.sort = o.presence ? 'best' : W.dates[W.dates.length - 1] || 'name'; W.asc = W.sort === 'name'; }
    } catch (e) { W.err = `The ${o.title} could not be loaded: ` + (e.message || e); }
    W.loading = false; draw();
    el('View').scrollLeft = 1e6;                 // the latest day in view
  }

  function draw() {
    const box = el('View');
    if (!box) return;
    const q = fold(el('Q').value), last = W.dates[W.dates.length - 1];
    el('Reads').textContent = W.rows ? `${W.rows.length} players · ${W.dates.length} ${W.dates.length === 1 ? 'day' : 'days'}` + (last ? ` · last read ${head(last)}` : '') : '';
    const rows = (W.rows || []).filter(r => (!q || fold(r.name).includes(q)) &&
      (!W.ally || (W.ally === 'OTHER' ? !ALLIANCES.includes(r.ally) : r.ally === W.ally)) && (!W.type || r.type === W.type));
    el('Chips').innerHTML =
      ['', ...ALLIANCES, 'OTHER'].map(a => `<button type="button" class="rchip ${W.ally === a ? 'on' : ''}" data-a="${a}">${a === 'OTHER' ? 'Other' : a || 'Everyone'}</button>`).join('') +
      (o.types ? TYPES.map(t => `<button type="button" class="rchip ${W.type === t ? 'on' : ''}" data-t="${t}">${t}</button>`).join('') : '') +
      (W.rows ? `<span class="rcount">${rows.length} of ${W.rows.length} players</span>` : '');
    if (W.err) { box.innerHTML = `<p class="rnote">${esc(W.err)}</p>`; return; }
    if (!W.rows) { box.innerHTML = '<p class="rnote">Loading…</p>'; return; }
    if (!W.rows.length) { box.innerHTML = `<p class="rnote">${o.empty}</p>`; return; }
    const k = W.sort, dir = W.asc ? 1 : -1;
    // a date column sorts by points (Whitebeard) or by on/off the train (Snow Train), then by name
    const val = (r, c) => c === 'best' ? r.best || 0 : o.presence ? (r.pts[c] != null ? 1 : 0) : r.pts[c] ?? -1;
    rows.sort((a, b) => ['name', 'ally', 'type'].includes(k) ? String(a[k]).localeCompare(String(b[k])) * dir
      : (val(a, k) - val(b, k)) * dir || (o.presence ? (b.best || 0) - (a.best || 0) : 0));
    const arrow = c => W.sort === c ? (W.asc ? ' ▲' : ' ▼') : '';
    const allyCell = r => `<td>${r.ally ? `<span class="rtag t${esc(r.ally)}">${esc(r.ally)}</span>` : '<span class="rdim">—</span>'}</td>`;
    box.innerHTML = `<table class="rtable wbtable"><thead><tr><th data-k="name">Name${arrow('name')}</th>` +
      (o.presence ? `<th class="d" data-k="best">March CP${arrow('best')}</th>` : '') +
      (o.types ? `<th data-k="type">Unit${arrow('type')}</th>` : '') +
      `<th data-k="ally">Alliance${arrow('ally')}</th>` +
      W.dates.map(d => `<th class="d" data-k="${d}">${head(d)}${arrow(d)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => `<tr><td>${esc(r.name)}</td>` +
        (o.presence ? `<td class="n">${r.best ? o.fmt(r.best) : '<span class="rdim">—</span>'}</td>` : '') +
        (o.types ? `<td>${r.type ? `<span class="unit u${r.type.replace(" ", "")}">${esc(r.type)}</span>` : '<span class="rdim">—</span>'}</td>` : '') + allyCell(r) +
        W.dates.map(d => o.presence
          ? `<td class="n">${r.pts[d] != null ? '<span class="yes">Yes</span>' : '<span class="rdim">No</span>'}</td>`
          : `<td class="n">${r.pts[d] == null ? '<span class="rdim">—</span>' : o.fmt(r.pts[d])}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>';
    box.querySelectorAll('th').forEach(th => th.onclick = () => { const c = th.dataset.k; W.asc = W.sort === c ? !W.asc : ['name', 'ally', 'type'].includes(c); W.sort = c; draw(); });
  }

  el('Chips').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if ('a' in b.dataset) W.ally = b.dataset.a; else W.type = W.type === b.dataset.t ? '' : b.dataset.t;
    draw();
  };
  el('Q').oninput = draw;
  el('Reload').onclick = load;
  // load whenever the view is opened
  const maybe = () => { if (location.hash === o.hash) load(); };
  addEventListener('hashchange', maybe);
  maybe();
}

dayCard({ id: 'wb', api: '/wb', hash: '#whitebeard', title: 'Whitebeard ranking', fmt: v => v.toLocaleString('en-US'),
  empty: 'Nothing yet. Read the Whitebeard ranking with the 2698 Data Extractor bookmark in the game, and it appears here.' });
// Name, March CP (the highest read, in millions as the game shows it: 256,158,825 → 256M), Unit,
// Alliance, then Yes / No per day: on a train that day or not
dayCard({ id: 'st', api: '/st', hash: '#snowtrain', title: 'Snow Train', types: true, presence: true, fmt: v => Math.round(v / 1e6) + 'M',
  empty: 'Nothing yet. Open a Snow Train\'s Unit Details in the game and tap Read on the 2698 Data Extractor bookmark, and it appears here.' });
