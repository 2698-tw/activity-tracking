(function () {
  const BOOK = 'https://docs.google.com/spreadsheets/d/1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE/export?format=csv&gid=';
  const CSV = BOOK + '1243524383', ROSTER = BOOK + '767166123';
  const AL = ['698W', '698N', '698S', '698C'];
  const DAYS = ['Day 1', 'Day 4', 'Day 7'];
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const S = { ally: '', sort: 'm0', asc: false, open: null };
  let rows = null, months = [], loading = false;
  const fold = s => String(s || '').normalize('NFKC').toLowerCase();
  const tag = a => a ? `<span class="rtag t${esc(a)}">${esc(a)}</span>` : '<span class="rdim">—</span>';
  const monKey = m => { const x = /^([A-Z][a-z]{2})(\d\d)$/.exec(m); return x ? (2000 + +x[2]) * 12 + MON[x[1]] : 0; };
  const monName = m => { const x = /^([A-Z][a-z]{2})(\d\d)$/.exec(m); return x ? x[1] + ' 20' + x[2] : m; };
  const when = s => { const d = new Date(s); return isNaN(d) ? 0 : d.getTime(); };
  function parse(text) {
    const out = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); out.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f || row.length) { row.push(f); out.push(row); }
    return out;
  }
  function setup(csv, roster) {
    const P = new Map(), seen = new Set();
    let latest = 0;
    for (const c of parse(csv).slice(1)) {
      const [, , load, , search, ign, ally, mon, dayName, rank, score, pid] = c;
      const d = DAYS.indexOf(dayName); if (d < 0 || !mon || !(search || ign)) continue;
      const k = pid || 's:' + fold(search), t = when(load);
      latest = Math.max(latest, t); seen.add(mon);
      let p = P.get(k);
      if (!p) P.set(k, p = { name: ign || search, search, ally, t: -1, m: {} });
      if (t >= p.t) { p.t = t; p.name = ign || search; p.search = search; p.ally = ally; }
      const m = p.m[mon] || (p.m[mon] = { s: [null, null, null], r: [null, null, null] });
      m.s[d] = score === '' ? null : +score; m.r[d] = rank === '' ? null : +rank;
    }
    months = [...seen].sort((a, b) => monKey(b) - monKey(a));
    rows = [];
    for (const c of parse(roster)) {
      const search = (c[0] || '').trim(), ign = (c[1] || '').trim(), ally = (c[2] || '').trim(), pid = (c[9] || '').trim();
      if (!search || /^search\s*name/i.test(search)) continue;
      const p = (/^[0-9a-f]{16}$/.test(pid) && P.get(pid)) || P.get('s:' + fold(search));
      rows.push({ name: ign || search, search, ally, m: p ? p.m : {} });
    }
    const pill = $('kzUpd');
    if (latest) { const d = new Date(latest); pill.hidden = false; pill.innerHTML = `Updated <span>${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}</span>`; }
  }
  const fin = m => m ? (m.s[2] ?? m.s[1] ?? m.s[0]) : null;
  const val = (x, k) => k === 'name' ? x.name : k === 'ally' ? x.ally : fin(x.m[months[+k.slice(1)]]);
  function cell(m) {
    if (!m) return `<td class="ks hs0 none">—</td>`;
    const c = m.s[2];
    return `<td class="ks"><span class="kv${c == null ? ' nod7' : ''}">${c ?? '—'}</span></td>`;
  }
  function detail(x) {
    const played = months.filter(mon => x.m[mon]);
    let best = null;
    for (const mon of played) { const v = fin(x.m[mon]); if (v != null && (!best || v > best[0])) best = [v, mon]; }
    const stat = (k, v) => `<div class="st"><span>${k}</span><b>${v}</b></div>`;
    const td = (v, i) => `<span${i === 2 ? ' class="f"' : ''}>${v ?? '<i>–</i>'}</span>`;
    const tab = `<div class="kmon"><b>Month</b>${DAYS.map(d => `<b>${d}</b>`).join('')}` +
      [...months].reverse().map(mon => { const m = x.m[mon]; return `<span class="mo${m ? '' : ' off'}">${monName(mon)}</span>${m ? m.s.map(td).join('') : '<span class="none">No scores</span>'}`; }).join('') + `</div>`;
    return `<div class="detin">${tab}<div class="sum">` +
      stat('Best', best ? `${best[0]} <span class="rdim">${monName(best[1])}</span>` : '—') + stat('Months played', `${played.length} of ${months.length}`) +
      `</div></div>`;
  }
  function draw() {
    if (!rows) return;
    const q = fold($('kzQ').value.trim());
    const list = rows.filter(x => (!q || fold(x.name).includes(q) || fold(x.search).includes(q)) && (!S.ally || x.ally === S.ally));
    $('kzChips').innerHTML = ['', ...AL].map(a => `<button type="button" class="rchip ${S.ally === a ? 'on' : ''}" data-a="${a}">${a || 'Everyone'}</button>`).join('') +
      `<span class="rcount">${list.length} players · ${months.length} month${months.length === 1 ? '' : 's'}</span>`;
    const text = S.sort === 'name' || S.sort === 'ally', dir = S.asc ? 1 : -1;
    const cmp = (a, b) => { const va = val(a, S.sort), vb = val(b, S.sort); if (text) return String(va).localeCompare(String(vb)) * dir; if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (va - vb) * dir; };
    list.sort((a, b) => cmp(a, b) || months.reduce((s, _, i) => s || (val(b, 'm' + i) ?? -1) - (val(a, 'm' + i) ?? -1), 0) || a.name.localeCompare(b.name));
    const arrow = k => S.sort === k ? (S.asc ? ' ▲' : ' ▼') : '';
    const cols = 3 + months.length;
    const view = $('kzView'), keep = view.scrollLeft, order = months.map((mon, i) => [mon, i]).reverse();
    view.innerHTML = `<table class="rtable wbtable pttable kztable"><thead><tr><th class="rk">#</th><th class="nm" data-k="name">Player${arrow('name')}</th><th class="ac" data-k="ally">Alliance${arrow('ally')}</th>` +
      order.map(([mon, i]) => `<th class="d" data-k="m${i}">${monName(mon)}${arrow('m' + i)}</th>`).join('') + `</tr></thead><tbody>` +
      (list.map((x, i) => {
        const id = x.search + '|' + x.name, open = S.open === id;
        return `<tr class="pr${open ? ' open' : ''}" data-id="${esc(id)}"><td class="rk">${i + 1}</td><td class="nm">${esc(x.name)}${x.ally ? `<br><span class="rtag kal t${esc(x.ally)}">${esc(x.ally)}</span>` : ''}</td><td class="ac">${tag(x.ally)}</td>${order.map(([mon]) => cell(x.m[mon])).join('')}</tr>` +
          (open ? `<tr class="det"><td colspan="${cols}">${detail(x)}</td></tr>` : '');
      }).join('') || `<tr><td colspan="${cols}" class="rdim">No players match.</td></tr>`) + `</tbody></table>`;
    view.scrollLeft = S.toEnd ? view.scrollWidth : keep;
    S.toEnd = false;
  }
  const toEnd = () => { S.toEnd = true; draw(); };
  async function load(again) {
    if ((rows && !again) || loading) return;
    loading = true;
    if (!rows) $('kzView').innerHTML = '<div class="rskel" aria-label="Loading">' + '<i></i>'.repeat(12) + '</div>';
    try {
      const [a, b] = await Promise.all([CSV, ROSTER].map(u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.text(); })));
      setup(a, b); toEnd();
    } catch (e) { if (!rows) $('kzView').innerHTML = '<p class="rdim" style="padding:12px 14px">Could not load the scores. Try Reload.</p>'; }
    loading = false;
  }
  $('kzChips').onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; S.ally = b.dataset.a; toEnd(); };
  $('kzView').onclick = e => {
    const th = e.target.closest('th[data-k]');
    if (th) { const k = th.dataset.k; if (S.sort === k) S.asc = !S.asc; else { S.sort = k; S.asc = k === 'name' || k === 'ally'; } draw(); return; }
    const tr = e.target.closest('tr.pr'); if (!tr) return;
    S.open = S.open === tr.dataset.id ? null : tr.dataset.id; draw();
  };
  $('kzQ').oninput = toEnd;
  $('kzReload').onclick = () => load(true);
  addEventListener('viewchange', e => { if (e.detail === 'kartzscores') load(); });
  if (location.hash === '#kartzscores') load();
})();
