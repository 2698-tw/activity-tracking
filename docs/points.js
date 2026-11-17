(function () {
  const fmt = n => Number(n).toLocaleString('en-US');
  const AL = ['698W', '698N', '698S', '698C'];
  const EV12 = ['Snow Train', 'Energy Tower', 'Mammoth Assault', 'Frost Crystal', 'Neutral City'];
  const EV34 = ['Snow Train', 'Energy Tower', 'Mammoth Assault', 'Storm Duel'];
  const GARRISON = new Set(['Snow Train', 'Mammoth Assault']);
  const MAXR = [5, 5, 4, 4];
  const S = { ally: '', tier: 0, sort: 'rank', asc: true, open: null };
  let rows = null, TOPFAME = 1;
  const rp = r => r ? r.slice(0, -1).filter(v => v > 0).length : 0;
  const fold = s => String(s || '').normalize('NFKC').toLowerCase();
  const tag = a => a ? `<span class="rtag t${esc(a)}">${esc(a)}</span>` : '<span class="rdim">—</span>';
  const tierTag = t => t ? `<span class="tier t${t}">Tier ${t}</span>` : '';
  const COLS = [
    { k: 'rank', label: '#', cls: 'rk', val: x => x.rank, asc: 1 },
    { k: 'name', label: 'Player', cls: 'nm', val: x => x.name, text: 1 },
    { k: 'ally', label: 'Alliance', cls: 'ac', val: x => x.ally, text: 1 },
    { k: 'r1', label: 'R1', cls: 'hs', val: x => x.rps[0] },
    { k: 'r2', label: 'R2', cls: 'hs', val: x => x.rps[1] },
    { k: 'r3', label: 'R3', cls: 'hs', val: x => x.rps[2] },
    { k: 'r4', label: 'R4', cls: 'hs', val: x => x.rps[3] },
    { k: 'wb', label: 'WB', cls: 'hs', val: x => x.wb },
    { k: 'score', label: 'Points', cls: '', val: x => x.score },
    { k: 'fame', label: 'Fame', cls: 'wd', val: x => x.fame },
    { k: 'pct', label: '% of Top', cls: 'wd', val: x => x.fame },
    { k: 'tier', label: 'Reward', cls: 'tc', val: x => x.tier ? 3 - x.tier : 0 },
  ];
  function setup(P) {
    TOPFAME = Math.max(...P.map(p => p[9])) || 1;
    rows = P.map((p, i) => {
      const r = [p[4], p[5], p[6], p[7]], rps = r.map(rp);
      return { rank: i + 1, name: p[0], search: p[1], ally: p[2], r, rps, wb: p[8], fame: p[9], merits: p[10], tier: p[11], swap: p[12], wblv: p[13], score: rps.reduce((a, b) => a + b, 0) + p[8] };
    });
  }
  const LABEL = { 'Mammoth Assault': 'Mammoth', 'Frost Crystal': 'Crystal' };
  const SHORT = { 'Neutral City': 'NC', 'Energy Tower': 'ET' };
  function detail(x) {
    const card = i => {
      const r = x.r[i], ev = i < 2 ? EV12 : EV34;
      if (!r) return `<div class="rc off"><div class="rh"><b>Round ${i + 1}</b><span class="pill">—</span></div><div class="miss">Not on the roster this round</div></div>`;
      const full = x.rps[i] === MAXR[i];
      return `<div class="rc"><div class="rh"><b>Round ${i + 1}</b><span class="pill${full ? ' ok' : ' bad'}">${x.rps[i]}/${MAXR[i]}</span></div><ul>` + ev.map((e, j) => {
        const v = r[j], ok = v > 0, val = ok && !GARRISON.has(e) ? `<em>${fmt(v)}</em>` : '';
        return `<li class="${ok ? 'y' : 'n'}"><i>${ok ? '✓' : '✕'}</i><span>${SHORT[e] ? `<b class="lf">${LABEL[e] || e}</b><b class="ls">${SHORT[e]}</b>` : LABEL[e] || e}</span>${val}</li>`;
      }).join('') + `</ul><div class="rf"><span>Fame</span><b>${fmt(r[r.length - 1])}</b></div></div>`;
    };
    const stat = (k, v) => `<div class="st"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="detin"><div class="rg">${[0, 1, 2, 3].map(card).join('')}</div><div class="sum">` +
      stat('Whitebeard', `<span class="wblv${x.wblv >= 100 ? ' ok' : ' bad'}">${x.wblv == null ? 'Not in ranking' : 'Lv ' + x.wblv}</span>`) + stat('Total fame', fmt(x.fame)) + stat('% of top', (x.fame / TOPFAME * 100).toFixed(1) + '%') +
      stat('Merits', fmt(x.merits)) + (x.tier ? stat('Reward', tierTag(x.tier)) : '') + `</div></div>`;
  }
  function draw() {
    if (!rows) return;
    const q = fold($('ptQ').value.trim());
    const list = rows.filter(x => (!q || fold(x.name).includes(q) || fold(x.search).includes(q)) &&
      (!S.ally || (S.ally === 'OTHER' ? !AL.includes(x.ally) : x.ally === S.ally)) && (!S.tier || x.tier === S.tier));
    $('ptChips').innerHTML = ['', ...AL, 'OTHER'].map(a => `<button type="button" class="rchip ${S.ally === a ? 'on' : ''}" data-a="${a}">${a === 'OTHER' ? 'Other' : a || 'Everyone'}</button>`).join('') +
      [1, 2].map(t => `<button type="button" class="rchip ${S.tier === t ? 'on' : ''}" data-t="${t}">Tier ${t}</button>`).join('') +
      `<span class="rcount">${list.length} of ${rows.length} players</span>`;
    const c = COLS.find(k => k.k === S.sort), dir = S.asc ? 1 : -1;
    list.sort((a, b) => (c.text ? String(c.val(a)).localeCompare(String(c.val(b))) : c.val(a) - c.val(b)) * dir || a.rank - b.rank);
    const arrow = k => S.sort === k ? (S.asc ? ' ▲' : ' ▼') : '';
    $('ptView').innerHTML = `<table class="rtable wbtable pttable"><thead><tr>${COLS.map(k => `<th class="${k.cls} ${k.cls === 'hs' || k.cls === 'wd' || k.k === 'score' ? 'd' : ''}" data-k="${k.k}">${k.label}${arrow(k.k)}</th>`).join('')}</tr></thead><tbody>` +
      (list.map(x => {
        const open = S.open === x.rank;
        return `<tr class="pr${open ? ' open' : ''}" data-r="${x.rank}"><td class="rk">${x.rank}</td><td class="nm"><span class="nmv">${esc(x.name)}</span><br>${tag(x.ally)}${x.swap ? ` <span class="swap">${esc(x.swap)}</span>` : ''}</td><td class="ac">${tag(x.ally)}</td>` +
          x.rps.map((v, i) => `<td class="rp hs ${!x.r[i] ? 'none' : v === MAXR[i] ? 'full' : 'part'}">${x.r[i] ? v : '—'}</td>`).join('') +
          `<td class="wbv hs ${x.wb ? '' : 'rdim'}">${x.wb}</td>` +
          `<td class="sc"><span class="v">${x.score}</span><span class="of">/19</span>${tierTag(x.tier)}</td>` +
          `<td class="fm wd">${fmt(x.fame)}</td><td class="pc wd">${(x.fame / TOPFAME * 100).toFixed(1)}%</td>` +
          `<td class="tc">${tierTag(x.tier)}</td></tr>` + (open ? `<tr class="det"><td colspan="${COLS.length}">${detail(x)}</td></tr>` : '');
      }).join('') || `<tr><td colspan="${COLS.length}" class="rdim">No players match.</td></tr>`) + `</tbody></table>`;
  }
  let loading = false;
  function load() {
    if (rows || loading) return;
    loading = true;
    $('ptView').innerHTML = '<p class="rdim">Loading…</p>';
    const s = document.createElement('script');
    s.src = 'points-data.js?v=2';
    s.onload = () => { setup(window.PTS || []); draw(); };
    s.onerror = () => { loading = false; $('ptView').innerHTML = '<p class="rdim">Could not load the list. Try again.</p>'; };
    document.head.appendChild(s);
  }
  $('ptChips').onclick = e => {
    const b = e.target.closest('[data-a],[data-t]'); if (!b) return;
    if (b.dataset.t) S.tier = S.tier === +b.dataset.t ? 0 : +b.dataset.t; else S.ally = b.dataset.a;
    draw();
  };
  $('ptView').onclick = e => {
    const th = e.target.closest('th[data-k]');
    if (th) { const k = th.dataset.k, c = COLS.find(x => x.k === k); if (S.sort === k) S.asc = !S.asc; else { S.sort = k; S.asc = !!(c.text || c.asc); } draw(); return; }
    const tr = e.target.closest('tr.pr'); if (!tr) return;
    S.open = S.open === +tr.dataset.r ? null : +tr.dataset.r; draw();
  };
  $('ptQ').oninput = draw;
  addEventListener('viewchange', e => { if (e.detail === 'points') load(); });
  if (location.hash === '#points') load();
})();
