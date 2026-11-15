(function () {
  const fmt = n => Number(n).toLocaleString('en-US');
  const AL = ['698W', '698N', '698S', '698C'];
  const S = { ally: '', sort: 'tot', asc: false };
  let FM = null, TOP = 1, COLS = [], RK = new Map();
  const fold = s => String(s || '').normalize('NFKC').toLowerCase();
  function setup() {
    TOP = Math.max(...FM.map(r => r[4])) || 1;
    RK = new Map([...FM].sort((a, b) => b[4] - a[4] || b[3] - a[3]).map((r, i) => [r, i + 1]));
    COLS = [
      { k: 'rk', label: '#', n: 1, asc: 1, val: r => RK.get(r) },
      { k: 'name', label: 'Player', text: 1, val: r => r[0] },
      { k: 'ally', label: 'Alliance', text: 1, val: r => r[2] },
      { k: 'r1', label: 'R1 Fame', n: 1, hs: 1, val: r => r[5] },
      { k: 'r2', label: 'R2 Fame', n: 1, hs: 1, val: r => r[6] },
      { k: 'r3', label: 'R3 Fame', n: 1, hs: 1, val: r => r[7] },
      { k: 'r4', label: 'R4 Fame', n: 1, hs: 1, val: r => r[8] },
      { k: 'tot', label: 'Total Fame', n: 1, val: r => r[4], cls: 'tot' },
      { k: 'pct', label: '% of Top', n: 1, val: r => r[4] / TOP, cell: r => (r[4] / TOP * 100).toFixed(1) + '%', cls: 'pct' },
      { k: 'merit', label: 'Merit', n: 1, val: r => r[3] },
    ];
  }
  function draw() {
    if (!FM) return;
    const q = fold($('fmQ').value.trim());
    const rows = FM.filter(r => (!q || fold(r[0]).includes(q) || fold(r[1]).includes(q)) &&
      (!S.ally || (S.ally === 'OTHER' ? !AL.includes(r[2]) : r[2] === S.ally)));
    $('fmChips').innerHTML = ['', ...AL, 'OTHER'].map(a => `<button type="button" class="rchip ${S.ally === a ? 'on' : ''}" data-a="${a}">${a === 'OTHER' ? 'Other' : a || 'Everyone'}</button>`).join('')
      + `<span class="rcount">${rows.length} of ${FM.length} players</span>`;
    const c = COLS.find(x => x.k === S.sort), dir = S.asc ? 1 : -1;
    rows.sort((a, b) => (c.text ? String(c.val(a)).localeCompare(String(c.val(b))) : c.val(a) - c.val(b)) * dir || b[4] - a[4] || b[3] - a[3]);
    const arrow = k => S.sort === k ? (S.asc ? ' ▲' : ' ▼') : '';
    const tag = a => a ? `<span class="rtag t${esc(a)}">${esc(a)}</span>` : '<span class="rdim">—</span>';
    $('fmView').innerHTML = `<table class="rtable wbtable fmtable"><thead><tr>${COLS.map(x => `<th class="${x.k === 'name' ? 'nm' : x.k === 'rk' ? 'rk' : ''} ${x.n ? 'd' : ''} ${x.hs ? 'hs' : ''}" data-k="${x.k}">${x.label}${arrow(x.k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${COLS.map(x => {
        if (x.k === 'name') return `<td class="nm"><span class="nmv">${esc(r[0])}</span></td>`;
        if (x.k === 'rk') return `<td class="rk">${RK.get(r)}</td>`;
        if (x.k === 'ally') return `<td>${tag(r[2])}</td>`;
        const v = x.val(r);
        return `<td class="n ${x.hs ? 'hs' : ''} ${x.cls || ''} ${!v ? 'rdim' : ''}">${x.cell ? x.cell(r) : fmt(v)}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${COLS.length}" class="rdim">No players match.</td></tr>`}</tbody></table>`;
  }
  let loading = false;
  function load() {
    if (FM || loading) return;
    loading = true;
    $('fmView').innerHTML = '<p class="rdim">Loading…</p>';
    const s = document.createElement('script');
    s.src = 'fame-data.js?v=1';
    s.onload = () => { FM = window.FM || []; setup(); draw(); };
    s.onerror = () => { loading = false; $('fmView').innerHTML = '<p class="rdim">Could not load the list. Try again.</p>'; };
    document.head.appendChild(s);
  }
  $('fmChips').onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; S.ally = b.dataset.a; draw(); };
  $('fmView').onclick = e => { const th = e.target.closest('th[data-k]'); if (!th) return; const k = th.dataset.k; if (S.sort === k) S.asc = !S.asc; else { S.sort = k; { const c = COLS.find(x => x.k === k); S.asc = !!(c.text || c.asc); } } draw(); };
  $('fmQ').oninput = draw;
  addEventListener('viewchange', e => { if (e.detail === 'fame') load(); });
  if (location.hash === '#fame') load();
})();
