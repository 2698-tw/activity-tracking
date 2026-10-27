/* ---------------- Alliance Roster card (#roster) ---------------- */
// The roster the 2698 Data Extractor bookmark keeps (docs/extractor.js): every time an alliance is
// read in the game, that alliance's rows are updated on the Worker (api/roster-update), matched by
// UID there; players missing from a read are kept and marked Left. This page only shows it
// (api/roster), with no UIDs: search, filter, sort.

(function () {
  const R = { rows: null, reads: {}, ally: '', cls: '', away: false, sort: 'power', asc: false, loading: false };
  const ALLIANCES = ['698N', '698S', '698W', '698C', '698X'];
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const ago = ms => {
    if (!ms) return '—';
    const m = (Date.now() - ms) / 60000;
    return m < 5 ? 'now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  const day = s => s ? new Date(s * 1000).toISOString().slice(0, 10) : '';
  const rankText = r => r >= 6 ? 'R4 ★' : r ? 'R' + r : '';

  async function load() {
    if (R.loading) return;
    R.loading = true; draw();
    try {
      const r = await fetch(API_BASE + '/roster', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      R.rows = j.rows || []; R.reads = j.reads || {}; R.err = '';
    } catch (e) { R.err = 'The roster could not be loaded: ' + (e.message || e); }
    R.loading = false; draw();
  }

  function draw() {
    const box = $('rosterView');
    if (!box) return;
    const q = fold($('rosterQ').value), now = Date.now() / 1000;
    $('rosterReads').innerHTML = ALLIANCES.map(a => `<span><span class="rtag t${a}">${a}</span> ${R.reads[a] ? 'read ' + ago(R.reads[a]) : '<span class="rdim">not read yet</span>'}</span>`).join('');
    const rows = (R.rows || []).filter(r => (!q || fold(r.name).includes(q) || fold(r.search).includes(q))
      && (!R.ally || r.alliance === R.ally) && (!R.cls || r.cls === R.cls) && (!R.away || now - r.last > 3 * 86400));
    $('rosterChips').innerHTML =
      ['', ...ALLIANCES].map(a => `<button type="button" class="rchip ${R.ally === a ? 'on' : ''}" data-a="${a}">${a || 'All alliances'}</button>`).join('') +
      ['CE', 'MM'].map(c => `<button type="button" class="rchip ${R.cls === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('') +
      `<button type="button" class="rchip ${R.away ? 'on' : ''}" data-w="1">Away 3+ days</button>` +
      (R.rows ? `<span class="rcount">${rows.length} of ${R.rows.length} players</span>` : '');
    if (R.err) { box.innerHTML = `<p class="rnote">${esc(R.err)}</p>`; return; }
    if (!R.rows) { box.innerHTML = '<p class="rnote">Loading…</p>'; return; }
    if (!R.rows.length) { box.innerHTML = '<p class="rnote">Nothing yet. Read an alliance with the 2698 Data Extractor bookmark in the game, and its members appear here.</p>'; return; }
    const k = R.sort, dir = R.asc ? 1 : -1, text = ['name', 'alliance', 'cls', 'status'].includes(k);
    rows.sort((a, b) => text ? String(a[k]).localeCompare(String(b[k])) * dir : ((a[k] || 0) - (b[k] || 0)) * dir);
    const cols = [['name', 'Name'], ['alliance', 'Alliance'], ['rank', 'Rank'], ['power', 'Power'], ['cls', 'MM/CE'], ['join', 'Joined', 'hs'], ['last', 'Last online'], ['status', 'Status', 'hs']];
    box.innerHTML = `<table class="rtable"><thead><tr>${cols.map(([c, l, h]) => `<th class="${h || ''}" data-k="${c}">${l}${R.sort === c ? (R.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.status === 'Left' ? 'left' : ''}">
        <td>${esc(r.name)}${r.search && r.search !== r.name ? ` <span class="rdim">(${esc(r.search)})</span>` : ''}</td>
        <td><span class="rtag t${r.alliance}">${r.alliance}</span></td><td>${rankText(r.rank)}</td>
        <td class="n">${r.power ? (r.power / 1e6).toFixed(1) + 'M' : ''}</td><td class="${r.cls || 'rdim'}">${r.cls || '—'}</td>
        <td class="hs">${day(r.join)}</td><td>${r.online ? '<span class="rdot"></span>now' : ago(r.last * 1000)}</td>
        <td class="hs">${r.status === 'Left' ? `Left ${day(r.leftAt / 1000)}` : 'Active'}</td></tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('th').forEach(th => th.onclick = () => { const c = th.dataset.k; R.asc = R.sort === c ? !R.asc : c === 'name'; R.sort = c; draw(); });
  }

  $('rosterChips').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if ('a' in b.dataset) R.ally = b.dataset.a;
    else if ('c' in b.dataset) R.cls = R.cls === b.dataset.c ? '' : b.dataset.c;
    else if ('w' in b.dataset) R.away = !R.away;
    draw();
  };
  $('rosterQ').oninput = draw;
  $('rosterReload').onclick = load;
  // load whenever the view is opened
  const maybe = () => { if (location.hash === '#roster') load(); };
  addEventListener('hashchange', maybe);
  maybe();
})();
