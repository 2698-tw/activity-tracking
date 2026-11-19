(function () {
  const BOOK = 'https://docs.google.com/spreadsheets/d/1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE/export?format=csv&gid=';
  const CSV = BOOK + '1243524383', ROSTER = BOOK + '767166123';
  const AL = ['698W', '698N', '698S', '698C'];
  const DAYS = ['Day 1', 'Day 4', 'Day 7'];
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const S = { ally: '', sort: 'm0', asc: false, open: null };
  let rows = null, months = [], loading = false, avail = 600;
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
  const fin = m => m ? m.s[2] : null;
  const val = (x, k) => k === 'name' ? x.name : k === 'ally' ? x.ally : fin(x.m[months[+k.slice(1)]]);
  function cell(m) {
    if (!m) return `<td class="ks hs0 none">—</td>`;
    const c = m.s[2];
    return `<td class="ks"><span class="kv${c == null ? ' nod7' : ''}">${c ?? '—'}</span></td>`;
  }
  const short = m => { const x = /^([A-Z][a-z]{2})(\d\d)$/.exec(m); return x ? x[1] + ' ' + x[2] : m; };
  let gid = 0;
  function chart(x) {
    const M = [...months].reverse(), me = M.map(mon => fin(x.m[mon]));
    const narrow = innerWidth < 640, W = narrow ? Math.max(Math.min(avail - 24, 600), M.length * 46) : Math.max(300, M.length * 88), H = narrow ? 150 : 170, L = 14, R = 14, T = 24, B = 26;
    const got = me.filter(v => v != null), hi = Math.max(0, ...got), lo = Math.min(hi, ...got), span = Math.max(hi - lo, hi * 0.15, 20);
    const floor = Math.max(0, lo - span * 0.7), top = hi + span * 0.3, base = H - B;
    const X = i => M.length === 1 ? W / 2 : L + 24 + i * (W - L - R - 48) / (M.length - 1), Y = v => T + (base - T) * (1 - (v - floor) / (top - floor || 1));
    const gap = M.length > 1 ? (W - L - R - 48) / (M.length - 1) : W, room = gap >= 82;
    const segs = []; let cur = [];
    me.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
    if (cur.length) segs.push(cur);
    const curve = sg => sg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    const id = 'kzg' + (++gid);
    let prev = null;
    const labels = me.map((v, i) => {
      if (v == null) return `<text x="${X(i)}" y="${base - 6}" class="m">—</text>`;
      const ch = prev == null ? null : v - prev; prev = v;
      const tag = room && ch ? `<tspan class="${ch > 0 ? 'up' : 'down'}" dx="4">(${ch > 0 ? '▲ ' + ch : '▼ ' + -ch})</tspan>` : '';
      return `<circle cx="${X(i)}" cy="${Y(v)}" r="${i === me.length - 1 ? 5 : 3.5}" class="me"/><text x="${X(i)}" y="${Y(v) - 10}" class="v">${v}${tag}</text>`;
    }).join('');
    return `<div class="kchart"><svg viewBox="0 0 ${W} ${H}" style="min-width:${narrow ? W : Math.min(W, 520)}px">` +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fb59a" stop-opacity=".35"/><stop offset="1" stop-color="#2fb59a" stop-opacity="0"/></linearGradient></defs>` +
      segs.map(sg => `<path d="${curve(sg)}L${sg[sg.length - 1][0].toFixed(1)} ${base}L${sg[0][0].toFixed(1)} ${base}Z" fill="url(#${id})" class="fill"/><path d="${curve(sg)}" class="me"/>`).join('') +
      labels + M.map((mon, i) => `<text x="${X(i)}" y="${H - 7}" class="m">${short(mon)}</text>`).join('') + `</svg></div>`;
  }
  function detail(x) {
    const scored = months.filter(mon => fin(x.m[mon]) != null);
    let best = null;
    for (const mon of scored) { const v = fin(x.m[mon]); if (!best || v > best[0]) best = [v, mon]; }
    const last = scored[0], prev = scored[1], lv = last ? fin(x.m[last]) : null, ch = prev ? lv - fin(x.m[prev]) : null;
    const badge = !ch ? '' : `<span class="kch ${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲ ' + ch : '▼ ' + -ch}</span>`;
    const head = `<div class="khead"><div class="kbig"><b>${lv ?? '—'}</b>${badge}<small>${last ? monName(last) : 'No Day 7 score yet'}</small></div>` +
      (best ? `<div class="kbest"><b>${best[0]}</b><span>Best score · ${monName(best[1])}</span></div>` : '') + `</div>`;
    return `<div class="detin" style="width:${avail}px">${head}${chart(x)}</div>`;
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
    const view = $('kzView'), keep = view.scrollLeft;
    avail = Math.max(260, view.clientWidth - 28);
    const order = months.map((mon, i) => [mon, i]).reverse();
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
