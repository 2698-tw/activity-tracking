/* ---------------- The cards: Whitebeard (#whitebeard), Snow Train (#snowtrain), Energy Tower (#energytower), Alliance roster (#roster) ---------------- */
// What the 2698 Data Extractor bookmark (docs/extractor.js) reads in the game, kept on the Worker:
//  - Whitebeard: each read under its UTC date (api/wb-update), a column per day.
//  - Snow Train: each Unit Details read the same way (api/st-update); March CP 1, 2, 3 are a player's
//    best per unit type, in the order the types first appeared; each day is Yes / No.
//  - Alliance roster: each alliance read updates its rows (api/roster-update); players missing from a
//    read stay, marked Left.
// These pages show it (api/wb, api/st, api/roster) with no UIDs: each row carries only an id the
// Worker made from it. Titles, columns, default sort and filter and the number format come from the
// settings (admin.js). In admin mode every cell, row and date column can be changed (api/admin).

(function () {
  const TYPES = ['Army', 'Navy', 'Air Force'];
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const head = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ago = ms => {
    if (!ms) return '—';
    const m = (Date.now() - ms) / 60000;
    return m < 5 ? 'now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  const day = s => s ? new Date(s * 1000).toISOString().slice(0, 10) : '';
  const rankText = r => r >= 6 ? 'R4 ★' : r ? 'R' + r : '';
  // "340M", "600k", "1,234" or "1234" → a number (NaN if it is none of those)
  const parseNum = s => { const m = String(s).trim().replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kKmM]?)$/); return m ? +m[1] * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : NaN; };
  const asTypes = (v, type) => v == null ? {} : typeof v === 'number' ? { [type || '']: v } : { ...v };
  const allyTag = a => a ? `<span class="rtag t${esc(a)}">${esc(a)}</span>` : '<span class="rdim">—</span>';
  const unitTag = t => t ? `<span class="unit u${t.replace(' ', '')}">${esc(t)}</span>` : '';
  const dim = '<span class="rdim">—</span>';

  // Every card: each player's search name, looked up by the in-game name the bookmark read: first in the
  // Alliance Rosters tab, then in the Base CP sends (RawData-CP), which are updated more often. Both tabs
  // are tried with the name and alliance before either is tried with the name alone, so a name another
  // alliance also has ("Woody") never takes that one's search name; each time the exact name first, then
  // one written without the fancy letters. The bookmark's own is kept where neither tab has the player.
  let names = null, namesAt = 0;
  // [in-game name, alliance, search name, weak], oldest first: the newest wins, and an unmatched send
  // ("No Name Match", weak) never replaces a real search name
  function nameMap(list) {
    const m = new Map(), weakKeys = new Set();
    for (const [name, ally, search, weak] of list || []) for (const k of [name + '|' + ally, name, '~' + fold(name) + '|' + ally, '~' + fold(name)]) {
      if (weak && m.has(k) && !weakKeys.has(k)) continue;
      m.set(k, search); weak ? weakKeys.add(k) : weakKeys.delete(k);
    }
    return m;
  }
  const withAlly = (m, r) => { const a = r.alliance ?? r.ally; return m.get(r.name + '|' + a) || m.get('~' + fold(r.name) + '|' + a); };
  const byName = (m, r) => m.get(r.name) || (fold(r.name) !== '' && m.get('~' + fold(r.name)));
  async function searchNames(rows) {
    if (!names || Date.now() - namesAt > 10 * 60 * 1000) {   // the sheet changes; asked again after a while
      namesAt = Date.now();
      names = fetch(API_BASE + '/search-names', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(r => r.ok ? r.json() : Promise.reject()).catch(() => { namesAt = 0; return {}; })   // asked again next time
        .then(j => [nameMap(j.roster), nameMap(j.raw)]);
    }
    const [roster, raw] = await names;
    for (const r of rows) {
      const s = withAlly(roster, r) || withAlly(raw, r) || byName(roster, r) || byName(raw, r);
      if (s) r.search = s;
    }
  }

  function makeCard(o) {
    const W = { rows: null, dates: [], reads: {}, moves: [], view: 'list', ally: null, type: '', cls: '', away: false, sort: null, asc: false, loading: false, err: '', flash: '' };
    const sel = new Set();
    const el = k => $(o.el + k);
    const cfg = () => Admin.settings.cards[o.id];
    const dated = o.id !== 'ro', allyKey = o.id === 'ro' ? 'alliance' : 'ally';
    const fmt = v => {
      const f = cfg().fmt;
      return f === 'M' ? (o.id === 'ro' ? (v / 1e6).toFixed(1) : Math.round(v / 1e6)) + 'M' : f === 'k' ? Math.round(v / 1e3).toLocaleString('en-US') + 'k' : Math.round(v).toLocaleString('en-US');
    };
    const byId = id => (W.rows || []).find(r => r.id === id);

    // Snow Train: March CP n and its unit, the best per unit type in the order the types first appeared
    const bests = r => r.bests || [];
    const cp = (r, n) => (bests(r)[n - 1] || [])[1] || 0, unit = (r, n) => (bests(r)[n - 1] || [])[0] || '';
    const top = r => Math.max(0, ...bests(r).map(b => b[1]));
    const dayTypes = (r, d) => asTypes(r.pts[d], r.type);

    // Each column: its value for sorting (and CSV), its cell, and how admin mode edits it
    const DEF = {
      name: { text: 1, val: r => r.name, cell: r => esc(r.name) + (r.search && r.search !== r.name ? ` <span class="rdim">(${esc(r.search)})</span>` : ''), edit: 'text' },
      // from the roster card for a player on it (Left once they have left), else the card's own read
      ally: { text: 1, val: r => r.ally, cell: r => allyTag(r.ally), edit: 'ally' },
      alliance: { text: 1, val: r => r.alliance, cell: r => allyTag(r.alliance), edit: 'ally' },
      rank: { val: r => r.rank || 0, cell: r => rankText(r.rank), edit: 'rank' },
      power: { n: 1, val: r => r.power || 0, cell: r => r.power ? fmt(r.power) : '', edit: 'big' },
      cls: { text: 1, val: r => r.cls || '', cell: r => r.cls || '—', cls: r => r.cls || 'rdim', edit: 'cls' },
      join: { hs: 1, val: r => r.join || 0, cell: r => day(r.join), edit: 'date' },
      last: { val: r => r.online ? Infinity : r.last || 0, cell: r => r.online ? '<span class="rdot"></span>now' : ago(r.last * 1000), edit: 'date' },
      status: { text: 1, hs: 1, val: r => r.status, cell: r => r.status === 'Left' ? `Left ${day(r.leftAt / 1000)}` : 'Active', edit: 'status' },
      // Energy Tower: the highest March CP over the days there are (edited through the days)
      best: { n: 1, val: r => Math.max(0, ...Object.values(r.pts || {})), cell: r => { const b = Math.max(0, ...Object.values(r.pts || {})); return b ? fmt(b) : dim; } },
    };
    for (const n of [1, 2, 3]) {
      DEF['cp' + n] = { n: 1, val: r => cp(r, n), cell: r => cp(r, n) ? fmt(cp(r, n)) : dim, edit: 'big' };
      DEF['u' + n] = { text: 1, val: r => unit(r, n), cell: r => unitTag(unit(r, n)) || (Admin.on ? dim : ''), edit: 'unit' };
    }
    const dateDef = d => o.id === 'st'
      ? { n: 1, val: r => r.pts[d] != null ? 1 : 0, cell: r => r.pts[d] != null ? '<span class="yes">Yes</span>' : '<span class="rdim">No</span>', edit: 'toggle' }
      : { n: 1, val: r => r.pts[d] ?? -1, cell: r => r.pts[d] == null ? dim : fmt(r.pts[d]), edit: o.id === 'et' ? 'big' : 'num' };
    const defOf = k => /^\d{4}-/.test(k) ? dateDef(k) : DEF[k];
    const columns = () => {
      const out = [];
      for (const c of cfg().cols) if (c.show) {
        if (c.k === '@dates') { if (dated) W.dates.forEach(d => out.push({ k: d, label: head(d), date: 1 })); }
        else if (DEF[c.k]) out.push(c);
      }
      return out;
    };

    async function load() {
      if (W.loading) return;
      W.loading = true; draw();
      try {
        const [r] = await Promise.all([fetch(API_BASE + o.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), Admin.ready]);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.status);
        W.rows = j.rows || []; W.dates = j.dates || []; W.reads = j.reads || {}; W.moves = j.moves || []; W.err = '';
        await searchNames(W.rows);                                 // every card: the roster's search names
        for (const id of [...sel]) if (!byId(id)) sel.delete(id);
      } catch (e) { W.err = `The ${cfg().title} could not be loaded: ` + (e.message || e); }
      W.loading = false; draw();
      if (dated && !W.flash) el('View').scrollLeft = 1e6;          // the latest day in view
    }
    // the card's defaults from the settings, until a chip or a header is clicked
    function defaults() {
      const C = cfg();
      if (W.ally === null) W.ally = C.filter;
      if (W.sort === null) { W.sort = C.sort === 'last' ? W.dates[W.dates.length - 1] || 'name' : C.sort; W.asc = !!(DEF[W.sort] && DEF[W.sort].text); }
    }

    /* ---- highlights (admin → Filters & columns → Highlights) ---- */
    const rule = k => { const h = (Admin.settings.highlight || {})[k]; return h && h.on && h.cards.includes(o.id) ? h : null; };
    const DAY = 864e5;
    // days in a row, up to the latest, a player is missing from (only once they have been on a day)
    const missedRun = r => { if (!Object.keys(r.pts || {}).length) return 0; let n = 0; for (let i = W.dates.length - 1; i >= 0 && r.pts[W.dates[i]] == null; i--) n++; return n; };
    // new: first seen within the rule's days, and not on the card from its start (its first day, or the
    // roster's first read), when everyone was new
    function isNew(r, days) {
      if (o.id === 'ro') {
        const first = Math.min(...W.rows.map(x => x.firstAt || Infinity));
        return !!r.firstAt && Date.now() - r.firstAt < days * DAY && r.firstAt - first > DAY / 2;
      }
      const ds = Object.keys(r.pts || {}).sort();
      return !!ds.length && ds[0] !== W.dates[0] && Date.now() - Date.parse(ds[0] + 'T00:00:00Z') < days * DAY;
    }
    const isAway = (r, days) => r.status !== 'Left' && !r.online && r.last && Date.now() / 1000 - r.last > days * 86400;
    function badges(r) {
      let out = '';
      const m = rule('missed'), f = rule('fresh');
      if (m) { const n = missedRun(r); if (n >= m.days) out += ` <span class="hl hl-${m.color}" title="Not on the last ${n} ${n === 1 ? 'day' : 'days'}">missed ${n}</span>`; }
      if (f && isNew(r, f.days)) out += ` <span class="hl hl-${f.color}" title="New in the last ${f.days} days">new</span>`;
      return out;
    }
    const awayDays = () => { const a = (Admin.settings.highlight || {}).away; return a && a.days || 3; };

    function draw() {
      const box = el('View');
      if (!box) return;
      const C = cfg(), AL = Admin.settings.alliances, admin = Admin.on;
      $(o.tab).querySelector('.rhead b').textContent = C.title;
      $(o.tab).querySelector('.rapp').classList.toggle('admin', admin);
      drawAdminBar();
      if (W.rows) defaults();
      const q = fold(el('Q').value), now = Date.now() / 1000;
      el('Reads').innerHTML = o.id === 'ro'
        ? AL.map(a => `<span><span class="rtag t${esc(a)}">${esc(a)}</span> ${W.reads[a] ? 'read ' + ago(W.reads[a]) : '<span class="rdim">not read yet</span>'}${admin ? ` <button type="button" class="rgo mini" data-reset="${esc(a)}">Reset</button><button type="button" class="rgo mini" data-wipe="${esc(a)}">Wipe</button>` : ''}</span>`).join('')
        : W.rows ? `${W.rows.length} players · ${W.dates.length} ${W.dates.length === 1 ? 'day' : 'days'}` + (W.dates.length ? ` · last read ${head(W.dates[W.dates.length - 1])}` : '') : '';
      if (o.id === 'ro' && W.view === 'moves') return drawMoves(box, q);
      const rows = (W.rows || []).filter(r => (!q || fold(r.name).includes(q) || (r.search && fold(r.search).includes(q))) &&
        (!W.ally || (W.ally === 'OTHER' ? !AL.includes(r[allyKey]) : r[allyKey] === W.ally)) &&
        (!W.type || bests(r).some(b => b[0] === W.type)) && (!W.cls || r.cls === W.cls) && (!W.away || now - r.last > awayDays() * 86400));
      el('Chips').innerHTML =
        ['', ...AL, ...(o.id === 'ro' ? [] : ['OTHER'])].map(a => `<button type="button" class="rchip ${W.ally === a ? 'on' : ''}" data-a="${esc(a)}">${a === 'OTHER' ? 'Other' : esc(a) || (o.id === 'ro' ? 'All alliances' : 'Everyone')}</button>`).join('') +
        (o.id === 'st' && C.unitFilters ? TYPES.map(t => `<button type="button" class="rchip ${W.type === t ? 'on' : ''}" data-t="${t}">${t}</button>`).join('') : '') +
        (o.id === 'ro' ? ['CE', 'MM'].map(c => `<button type="button" class="rchip ${W.cls === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('') +
          `<button type="button" class="rchip ${W.away ? 'on' : ''}" data-w="1">Away ${awayDays()}+ days</button>` : '') +
        (W.rows ? `<span class="rcount">${rows.length} of ${W.rows.length} players</span>` : '');
      if (o.id === 'ro') el('Chips').insertAdjacentHTML('afterbegin', views());
      drawBulk();
      if (W.err) { box.innerHTML = `<p class="rnote">${esc(W.err)}</p>`; return; }
      if (!W.rows) { box.innerHTML = '<p class="rnote">Loading…</p>'; return; }
      if (!W.rows.length && !admin) { box.innerHTML = `<p class="rnote">${o.empty}</p>`; return; }
      const cols = columns(), k = W.sort, dir = W.asc ? 1 : -1, d = defOf(k) || DEF.name;
      rows.sort((a, b) => (d.text ? String(d.val(a) ?? '').localeCompare(String(d.val(b) ?? '')) : d.val(a) - d.val(b)) * dir || (o.id === 'st' ? top(b) - top(a) : 0));
      const arrow = c => W.sort === c ? (W.asc ? ' ▲' : ' ▼') : '';
      const game = admin && o.id === 'ro' ? { name: 1, alliance: 1, rank: 1, power: 1, join: 1, last: 1, status: 1 } : {};
      box.innerHTML = `<table class="rtable wbtable"><thead><tr>${cols.map(c => {
        const f = defOf(c.k);
        return `<th class="${c.k === 'name' ? 'nm' : ''} ${f.n ? 'd' : ''} ${f.hs ? 'hs' : ''}" data-k="${c.k}">${esc(c.label)}${arrow(c.k)}` +
          (game[c.k] ? '<span class="gamef" title="The next read from the game replaces an edit here">⚠</span>' : '') +
          (admin && c.date ? `<button type="button" class="dedit" data-d="${c.k}" title="Change date, clear or remove">✎</button>` : '') + '</th>';
      }).join('')}</tr></thead><tbody>${rows.map(r => `<tr data-id="${esc(r.id)}" class="${r.status === 'Left' ? 'left' : ''} ${sel.has(r.id) ? 'sel' : ''} ${W.flash === r.id ? 'flash' : ''}">${cols.map(c => {
        const f = defOf(c.k), ed = admin && f.edit ? (f.edit === 'toggle' ? 'tog' : 'ed') : '';
        if (c.k === 'name') return `<td class="nm ${ed}" data-k="name">${admin ? `<input type="checkbox" class="rsel" data-sel="${esc(r.id)}" ${sel.has(r.id) ? 'checked' : ''} aria-label="Select">` : ''}<span class="nmv">${f.cell(r)}</span>${badges(r)}${admin ? `<button type="button" class="rdots" data-row="${esc(r.id)}" title="Row actions">⋯</button>` : ''}</td>`;
        return `<td class="${f.n ? 'n' : ''} ${f.hs ? 'hs' : ''} ${f.cls ? f.cls(r) : ''} ${ed}" data-k="${c.k}">${f.cell(r)}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="rdim">${W.rows.length ? 'No players match.' : 'No players yet: add one with + Player.'}</td></tr>`}</tbody></table>`;
      const aw = rule('away');
      if (aw) box.querySelectorAll('tbody tr[data-id]').forEach(tr => { const r = byId(tr.dataset.id), td = tr.querySelector('td[data-k="last"]'); if (r && td && isAway(r, aw.days)) td.classList.add('hlc', 'hl-' + aw.color); });
      if (W.flash) { const tr = box.querySelector('tr.flash'); if (tr) tr.scrollIntoView({ block: 'center' }); W.flash = ''; }
    }

    /* ---- the roster's History: each alliance change the reads found, newest first ---- */
    const views = () => `<span class="rseg">${[['list', 'Players'], ['moves', 'History']].map(([v, l]) => `<button type="button" class="rchip ${W.view === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</span>`;
    function drawMoves(box, q) {
      const AL = Admin.settings.alliances, admin = Admin.on;
      const searchOf = name => (W.rows.find(r => r.name === name) || {}).search;
      const tag = a => a === null ? '<span class="rtag tNew">New</span>' : a === '' ? '<span class="rtag tLeft">No alliance</span>' : allyTag(a);
      const list = W.moves.filter(x => (!W.ally || x.from === W.ally || x.to === W.ally) &&
        (!q || fold(x.name).includes(q) || fold(searchOf(x.name) || '').includes(q)));
      el('Chips').innerHTML = views() + ['', ...AL].map(a => `<button type="button" class="rchip ${W.ally === a ? 'on' : ''}" data-a="${esc(a)}">${esc(a) || 'All alliances'}</button>`).join('') +
        (W.rows ? `<span class="rcount">${list.length} ${list.length === 1 ? 'change' : 'changes'}</span>` : '');
      if (bulk) { bulk.classList.remove('on'); bulk.innerHTML = ''; }
      if (W.err) { box.innerHTML = `<p class="rnote">${esc(W.err)}</p>`; return; }
      if (!W.rows) { box.innerHTML = '<p class="rnote">Loading…</p>'; return; }
      if (!W.moves.length) { box.innerHTML = '<p class="rnote">No alliance changes yet. Each read of an alliance adds who joined, moved or left since the last one.</p>'; return; }
      const when = at => { const d = new Date(at); return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} <span class="rdim">· ${ago(at)}</span>`; };
      box.innerHTML = `<table class="rtable mvtable"><thead><tr><th>When</th><th class="nm">Name</th><th>Change</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>${list.map(x => {
        const s = searchOf(x.name);
        return `<tr><td>${when(x.at)}</td><td class="nm">${esc(x.name)}${s && s !== x.name ? ` <span class="rdim">(${esc(s)})</span>` : ''}</td>
          <td>${tag(x.from)} <span class="rdim">→</span> ${tag(x.to)}</td>${admin ? `<td><button type="button" class="rgo mini" data-mv="${esc(x.m)}" title="Take this off History">✕</button></td>` : ''}</tr>`;
      }).join('') || '<tr><td colspan="4" class="rdim">No changes match.</td></tr>'}</tbody></table>`;
    }

    /* ---- admin: the header buttons, the bulk bar, the note ---- */
    let bar, bulk, note;
    function drawAdminBar() {
      const rapp = $(o.tab).querySelector('.rapp');
      if (!bar) {
        bar = document.createElement('span'); bar.className = 'radm';
        el('Reload').before(bar);
        bulk = document.createElement('div'); bulk.className = 'rbulk';
        el('Chips').after(bulk);
        note = document.createElement('div'); note.className = 'rfoot radmnote';
        rapp.appendChild(note);                      // at the bottom of the card
      }
      bar.innerHTML = Admin.on ? `<button type="button" class="rgo pink" data-act="add">+ Player</button>${dated ? '<button type="button" class="rgo pink" data-act="adddate">+ Date</button>' : ''}${o.id === 'ro' ? '<button type="button" class="rgo" data-act="sendro">Send to sheet</button>' : ''}<button type="button" class="rgo" data-act="csv">Export CSV</button>` : '';
      note.hidden = !Admin.on;
      note.innerHTML = 'Admin: click a cell to change it · ⋯ for a player · ✎ on a date for its column (and to send that day to the sheet again) · tick players to change several at once. Every change is in History and can be undone.' +
        (o.id === 'ro' ? ' ⚠ columns come from the game: its next read of that alliance replaces an edit (MM/CE edits stay).' : ' Names come from the game: its next read replaces an edit. Alliances of players on the Alliance roster card come from there: changing one here changes it on the roster, and every card follows.');
    }
    function drawBulk() {
      if (!bulk) return;
      bulk.classList.toggle('on', Admin.on && sel.size > 0);
      if (!Admin.on || !sel.size) { bulk.innerHTML = ''; return; }
      bulk.innerHTML = `<b>${sel.size} selected</b>
        <select data-bulk><option value="">Set alliance…</option>${Admin.settings.alliances.map(a => `<option>${esc(a)}</option>`).join('')}${o.id === 'ro' ? '' : '<option value="-">(no alliance)</option>'}</select>
        ${o.id === 'ro' ? '' : `<button type="button" class="rgo" data-act="merge" ${sel.size < 2 ? 'disabled' : ''}>Merge</button>`}
        <button type="button" class="rgo danger" data-act="bulkdel">Delete</button><button type="button" class="rgo" data-act="clear">Clear</button>`;
    }

    // a change through the Worker; the card is read again afterwards either way
    async function run(op, body, note) {
      try { const res = await Admin.call(op, { card: o.id, ...body }, note); Admin.done(res); await load(); return res; }
      catch (e) { Admin.toast('✗ ' + e.message); await load(); return null; }
    }
    const names = ids => ids.map(id => (byId(id) || {}).name).filter(Boolean);
    const list = (xs, n = 3) => xs.length > n ? xs.slice(0, n).join(', ') + ` and ${xs.length - n} more` : xs.join(', ');

    /* ---- editing a cell in place ---- */
    function edit(td) {
      const tr = td.closest('tr'), r = byId(tr.dataset.id), k = td.dataset.k, f = defOf(k);
      if (!r || !f || !f.edit || td.querySelector('.cellin')) return;
      if (f.edit === 'toggle') return toggleDay(r, k);
      if (f.edit === 'ally' && r.left) return Admin.toast(`${r.name} has left the alliances — change it on the Alliance roster card.`);
      const AL = Admin.settings.alliances, opts = (list, cur) => `<select class="cellin">${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const cur = k === 'name' ? r.name : f.val(r);
      let html;
      if (f.edit === 'ally') html = opts([...(o.id === 'ro' || r.roster ? [] : [['', '(no alliance)']]), ...AL.map(a => [a, a]), ...(cur && !AL.includes(cur) ? [[cur, cur]] : [])], cur || '');
      else if (f.edit === 'unit') html = opts([['', '— (remove)'], ...TYPES.map(t => [t, t])], cur);
      else if (f.edit === 'cls') html = opts([['', '—'], ['MM', 'MM'], ['CE', 'CE']], cur);
      else if (f.edit === 'status') html = opts([['Active', 'Active'], ['Left', 'Left']], cur);
      else if (f.edit === 'rank') html = opts([[1, 'R1'], [2, 'R2'], [3, 'R3'], [4, 'R4'], [5, 'R5'], [6, 'R4 ★']], cur);
      else if (f.edit === 'date') html = `<input type="date" class="cellin" value="${k === 'last' ? day(r.last) : day(r.join)}">`;
      else {
        const shown = f.edit === 'big' ? (cur > 0 ? Math.round(cur / 1e6) + 'M' : '') : f.edit === 'num' ? (cur === -1 ? '' : cur) : cur;
        html = `<input class="cellin" value="${esc(shown)}" placeholder="${f.edit === 'text' ? '' : 'empty = clear'}">`;
      }
      const target = k === 'name' ? td.querySelector('.nmv') : td, keep = target.innerHTML;
      target.innerHTML = html;
      const inp = target.firstChild;
      inp.focus(); if (inp.select) inp.select();
      let over = false;
      const finish = async ok => {
        if (over) return; over = true;
        const v = inp.value.trim();
        if (!ok || !(await commit(r, k, v, cur))) target.innerHTML = keep;
      };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); };
      inp.onblur = () => finish(true);
      if (inp.tagName === 'SELECT') inp.onchange = () => finish(true);
      inp.onclick = e => e.stopPropagation();
    }
    // the change a cell's new value makes; false when there is nothing to save
    async function commit(r, k, v, cur) {
      const label = (cfg().cols.find(c => c.k === k) || {}).label || head(k), who = r.name;
      const show = x => x === '' || x == null || x === -1 || x === 0 ? '—' : typeof x === 'number' && x >= 1e4 ? fmt(x) : String(x);
      if (k === 'name') { if (!v || v === cur) return false; run('row-set', { id: r.id, field: 'name', value: v }, { what: `Renamed ${cur}`, from: cur, to: v }); return true; }
      if (k === 'ally' || k === 'alliance') { if (v === (cur || '')) return false; run('row-set', { id: r.id, field: k, value: v }, { what: `${who} · alliance`, from: cur || '—', to: v || '—' }); return true; }
      if (/^\d{4}-/.test(k)) {                                     // Whitebeard points (Energy Tower March CP) on a day
        let n = v === '' ? null : parseNum(v);
        if (n !== null && !isFinite(n)) { Admin.toast('Not a number: ' + v); return false; }
        if (o.id === 'et' && n !== null && n < 1e5) n *= 1e6;        // "79" means 79M
        if ((n ?? -1) === cur) return false;
        run('cell-set', { id: r.id, day: k, value: n }, { what: `${who} · ${head(k)}`, from: show(cur), to: show(n) }); return true;
      }
      if (/^cp\d$/.test(k) || /^u\d$/.test(k)) {                    // Snow Train March CP n / Unit n
        const i = +k.slice(-1) - 1, b = bests(r).map(x => x.slice());
        if (k[0] === 'c') {
          if (v === '') { if (!b[i]) return false; b.splice(i, 1); }
          else {
            let n = parseNum(v); if (!isFinite(n)) { Admin.toast('Not a number: ' + v); return false; }
            if (n < 1e5) n *= 1e6;                                  // "340" means 340M
            if (b[i]) { if (n === b[i][1]) return false; b[i][1] = n; }
            else { const t = TYPES.find(t => !b.some(x => x[0] === t)); if (!t) return false; b.push([t, n]); }
          }
        } else {
          if (v === (b[i] || [])[0] || (!v && !b[i])) return false;
          if (!v) b.splice(i, 1);
          else if (b.some((x, j) => x[0] === v && j !== i)) { Admin.toast(`${who} already has a ${v} March CP: use ⋯ → Reorder`); return false; }
          else if (b[i]) b[i][0] = v; else b.push([v, 0]);
        }
        const txt = list => list.map(x => fmt(x[1]) + ' ' + x[0]).join(', ') || '—';
        run('bests-set', { id: r.id, bests: b }, { what: `${who} · ${label}`, from: txt(bests(r)), to: txt(b) }); return true;
      }
      if (k === 'power') {
        let n = parseNum(v); if (!isFinite(n)) { Admin.toast('Not a number: ' + v); return false; }
        if (n < 1e5) n *= 1e6; if (n === cur) return false;
        run('row-set', { id: r.id, field: 'power', value: n }, { what: `${who} · Power`, from: show(cur), to: show(n) }); return true;
      }
      if (k === 'join' || k === 'last') {
        if (!v || v === day(k === 'last' ? r.last : r.join)) return false;
        const s = Math.floor(Date.parse(v + 'T12:00:00Z') / 1000); if (!isFinite(s)) return false;
        run('row-set', { id: r.id, field: k, value: s }, { what: `${who} · ${label}`, from: day(r[k]) || '—', to: v }); return true;
      }
      if (k === 'rank') { if (+v === cur) return false; run('row-set', { id: r.id, field: 'rank', value: +v }, { what: `${who} · Rank`, from: rankText(cur) || '—', to: rankText(+v) }); return true; }
      if (v === (cur || '')) return false;
      run('row-set', { id: r.id, field: k, value: v }, { what: `${who} · ${label}`, from: cur || '—', to: v || '—' }); return true;
    }
    // Snow Train: on a train that day or not
    function toggleDay(r, d) {
      if (r.pts[d] != null) return run('days-set', { id: r.id, days: { [d]: null } }, { what: `${r.name} · ${head(d)}`, from: 'Yes', to: 'No' });
      const b = bests(r)[0];
      if (!b) { Admin.toast(`Give ${r.name} a March CP first, or use ⋯ → Edit day values`); return; }
      run('days-set', { id: r.id, days: { [d]: { [b[0]]: b[1] } } }, { what: `${r.name} · ${head(d)}`, from: 'No', to: 'Yes' });
    }

    /* ---- a player's ⋯ ---- */
    function rowMenu(btn) {
      const r = byId(btn.dataset.row); if (!r) return;
      const items = [{ label: '✏️ Rename', run: () => edit(btn.closest('td')) }];
      if (o.id !== 'ro') items.push({ label: '🔀 Merge with another player…', run: () => mergeDialog([r.id]) });
      if (o.id === 'st') items.push('-',
        { label: '📅 Edit day values…', run: () => dayValues(r) },
        { label: '↕️ Reorder March CP 1–3…', run: () => reorder(r) },
        { label: '↺ Work out March CP from the days', run: () => {
          const b = recalc(r), txt = list => list.map(x => fmt(x[1]) + ' ' + x[0]).join(', ') || '—';
          run('bests-set', { id: r.id, bests: b }, { what: `${r.name} · March CP from the days`, from: txt(bests(r)), to: txt(b) });
        } });
      if (o.id === 'ro') items.push('-', { label: r.status === 'Left' ? '↩︎ Mark Active' : '🚪 Mark as Left', run: () => commit(r, 'status', r.status === 'Left' ? 'Active' : 'Left', r.status) });
      items.push('-', { label: '🗑 Delete player', danger: true, run: async () => {
        if (await Admin.confirm(`Delete ${esc(r.name)}?`, `Removes ${esc(r.name)}${dated ? ' and all their days' : ''} from the ${esc(cfg().title)} card.${o.id === 'ro' ? ' The next read of their alliance adds them back if they are still in it.' : ''} History can undo it.`, 'Delete'))
          run('row-delete', { ids: [r.id] }, { what: `Deleted ${r.name}`, from: r.name, to: '—' });
      } });
      Admin.popover(btn, items);
    }
    // March CP 1–3 from the player's days: the best per unit type, in the order they first appear
    function recalc(r) {
      const b = [];
      for (const d of W.dates) for (const [t, v] of Object.entries(dayTypes(r, d))) {
        if (!TYPES.includes(t)) continue;
        const x = b.find(y => y[0] === t); if (x) x[1] = Math.max(x[1], v); else b.push([t, v]);
      }
      return b;
    }
    function mergeDialog(ids) {
      const pick = ids.map(byId).filter(Boolean), many = pick.length > 1;
      const opt = x => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x[allyKey] || '—')})</option>`;
      const pool = W.rows.filter(x => !ids.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name));
      const m = Admin.modal(`<h3>Merge players</h3>
        <p>${many ? `Make these ${pick.length} into one.` : `Make <b>${esc(pick[0].name)}</b> and another player one.`} Their days are joined; where both have a value the higher one stays. Later reads of either count for the one kept.</p>
        ${many ? `<p>${esc(list(pick.map(x => x.name), 6))}</p>` : `<label>Merge with<input type="search" data-f placeholder="Search a name"><select data-w size="6">${pool.map(opt).join('')}</select></label>`}
        <label>Keep the name of<select data-n></select></label>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Merge</button></div>`);
      const w = m.querySelector('[data-w]'), n = m.querySelector('[data-n]');
      const group = () => many ? pick : [pick[0], byId(w.value)].filter(Boolean);
      const fill = () => { n.innerHTML = group().map(opt).join(''); };
      if (!many) {
        w.selectedIndex = 0; w.onchange = fill;
        m.querySelector('[data-f]').oninput = e => { const q = fold(e.target.value); w.innerHTML = pool.filter(x => !q || fold(x.name).includes(q)).map(opt).join(''); w.selectedIndex = 0; fill(); };
      }
      fill();
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => {
        const g = group(), keep = byId(n.value);
        if (g.length < 2 || !keep) return Admin.toast('Pick a player to merge with');
        const others = g.filter(x => x !== keep);
        m.close(); sel.clear();
        run('merge', { keep: keep.id, ids: others.map(x => x.id) }, { what: `Merged ${list(others.map(x => x.name))} into ${keep.name}`, from: g.map(x => x.name).join(' + '), to: keep.name });
      };
    }
    function dayValues(r) {
      if (!W.dates.length) return Admin.toast('There are no date columns yet');
      const m = Admin.modal(`<h3>${esc(r.name)} · day values</h3><p>March CP per unit type on each day, e.g. 340M. Empty: not on a train that day with that type.</p>
        <div class="agridw"><table class="agrid"><tr><th>Date</th>${TYPES.map(t => `<th>${t}</th>`).join('')}</tr>
        ${W.dates.map(d => `<tr><td>${head(d)}</td>${TYPES.map(t => { const v = dayTypes(r, d)[t]; return `<td><input data-d="${d}" data-t="${t}" value="${v ? Math.round(v / 1e6) + 'M' : ''}" inputmode="decimal"></td>`; }).join('')}</tr>`).join('')}</table></div>
        <label class="acheck"><input type="checkbox" data-re checked> Also work out March CP 1–3 again from these days</label>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Save</button></div>`, true);
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => {
        const days = {};
        for (const d of W.dates) days[d] = null;
        for (const i of m.querySelectorAll('[data-d]')) {
          if (!i.value.trim()) continue;
          let n = parseNum(i.value); if (!isFinite(n)) return Admin.toast('Not a number: ' + i.value);
          if (n < 1e5) n *= 1e6;
          (days[i.dataset.d] = days[i.dataset.d] || {})[i.dataset.t] = n;
        }
        const was = W.dates.filter(d => r.pts[d] != null).length, now = Object.values(days).filter(Boolean).length;
        m.close();
        run('days-set', { id: r.id, days, recalc: m.querySelector('[data-re]').checked }, { what: `${r.name} · day values`, from: `${was} days`, to: `${now} days` });
      };
    }
    function reorder(r) {
      let b = bests(r).map(x => x.slice());
      if (b.length < 2) return Admin.toast(`${r.name} has one March CP: nothing to reorder`);
      const m = Admin.modal(`<h3>${esc(r.name)} · March CP order</h3><p>Which unit type shows as March CP 1, 2 and 3.</p><div class="alist" data-l></div>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Save</button></div>`);
      const paint = () => { m.querySelector('[data-l]').innerHTML = b.map((x, i) => `<div class="ali"><b class="alab">March CP ${i + 1}</b>${unitTag(x[0])} ${fmt(x[1])}<span style="flex:1"></span>
        <button type="button" class="abtn sm" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button type="button" class="abtn sm" data-dn="${i}" ${i < b.length - 1 ? '' : 'disabled'}>↓</button></div>`).join(''); };
      paint();
      m.querySelector('[data-l]').onclick = e => {
        const u = e.target.dataset.up, d = e.target.dataset.dn;
        if (u) { [b[u - 1], b[u]] = [b[u], b[u - 1]]; paint(); }
        if (d) { [b[+d + 1], b[d]] = [b[d], b[+d + 1]]; paint(); }
      };
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => { m.close(); run('bests-set', { id: r.id, bests: b }, { what: `${r.name} · March CP order`, from: bests(r).map(x => x[0]).join(' › '), to: b.map(x => x[0]).join(' › ') }); };
    }

    /* ---- a day sent to the card's sheet again (admin), for a Send that was forgotten or went wrong ---- */
    // Rows as the bookmark's Send makes them, with each player's alliance as the card shows it
    const SEND = { wb: ['/game-ranking', 'ranking'], st: ['/game-snowtrain', 'snowtrain'], et: ['/game-energytower', 'energytower'] };
    const ours = r => Admin.settings.alliances.includes(r[allyKey]);
    const allyOrder = r => { const i = Admin.settings.alliances.indexOf(r[allyKey]); return i < 0 ? 99 : i; };
    const inGroup = who => r => who === 'all' || (who === 'ours') === ours(r);
    function dayRows(d, who) {
      const pts = r => o.id === 'st' ? Math.max(0, ...Object.values(dayTypes(r, d))) : r.pts[d];
      const M = v => Math.round(v / 1e6) + 'M', nm = r => r.name.slice(0, 80), al = r => String(r.ally || '').slice(0, 20);
      return W.rows.filter(r => r.pts[d] != null).filter(inGroup(who))
        .sort((a, b) => allyOrder(a) - allyOrder(b) || String(a.ally).localeCompare(String(b.ally)) || pts(b) - pts(a))
        .flatMap(r => o.id === 'wb' ? [[nm(r), r.pts[d], al(r)]]
          : o.id === 'et' ? [[nm(r), M(r.pts[d]), al(r)]]
          : Object.entries(dayTypes(r, d)).map(([t, v]) => [nm(r), M(v), al(r), TYPES.includes(t) ? t : '']));
    }
    // a send from a dialog: its button busy while it goes, then what was written and a link to it
    async function sendRows(m, path, body, title) {
      const y = m.querySelector('[data-y]'), err = m.querySelector('[data-e]');
      y.disabled = true; y.textContent = 'Sending…'; err.textContent = '';
      try {
        const r = await fetch(API_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j.error && j.error.message) || j.error || 'the sheet did not accept it (' + r.status + ')');
        const link = j.link || `https://docs.google.com/spreadsheets/d/${j.id}/edit#gid=${j.gid}`;
        m.innerHTML = `<h3>Sent</h3><p>${Number(j.rows).toLocaleString()} ${Number(j.rows) === 1 ? 'row' : 'rows'} added to the ${esc(title)} sheet${j.date ? `, dated ${esc(j.date)}` : ''}.</p>
          <div class="arow"><a class="abtn" href="${esc(link)}" target="_blank" rel="noopener">Open in Sheets ↗</a><button type="button" class="abtn pri" data-x>Done</button></div>`;
        m.querySelector('[data-x]').onclick = m.close;
      } catch (e) { err.textContent = "✗ Couldn't send: " + (e.message || e); y.disabled = false; y.textContent = 'Send to sheet'; }
    }
    function sendDay(d) {
      const [path, sheet] = SEND[o.id], title = cfg().title, t = Admin.settings.sheets[sheet];
      if (!t || !t.id) return Admin.toast(`No sheet is set for the ${title} yet — add one in Admin → Sheets & backup.`);
      const have = W.rows.filter(r => r.pts[d] != null), n = who => have.filter(inGroup(who)).length;
      if (!have.length) return Admin.toast(`Nobody in ${head(d)}`);
      const m = Admin.modal(`<h3>Send ${head(d)} to the sheet</h3>
        <p>Adds that day's rows below the ones already in the ${esc(title)} sheet, dated ${d}. Rows sent before stay as they are, so check the day isn't there already.</p>
        <label>Players<select>${[['ours', 'Our alliances'], ['other', 'Everyone else'], ['all', 'Everyone']].map(([v, l]) => `<option value="${v}">${l} (${n(v)})</option>`).join('')}</select></label>
        <p class="aerr" data-e></p>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Send to sheet</button></div>`);
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => {
        const rows = dayRows(d, m.querySelector('select').value);
        if (!rows.length) { m.querySelector('[data-e]').textContent = 'Nobody to send in that group.'; return; }
        sendRows(m, path, { rows, date: d }, title);
      };
    }
    // the roster card has no days: every Active player's Base CP now, as the bookmark's Send makes it
    function sendRoster() {
      const AL = Admin.settings.alliances, list = W.rows.filter(r => r.status !== 'Left' && AL.includes(r.alliance));
      if (!list.length) return Admin.toast('Nobody to send');
      const m = Admin.modal(`<h3>Send the roster to the sheet</h3>
        <p>Adds ${list.length} ${list.length === 1 ? 'row' : 'rows'}, every Active player's Base CP, to Alliance Rosters › RawData-CP, dated now. Rows sent before stay as they are.</p>
        <p class="aerr" data-e></p>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Send to sheet</button></div>`);
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => {
        const at = new Date(), p = x => String(x).padStart(2, '0');
        const stamp = `${at.getMonth() + 1}/${at.getDate()}/${at.getFullYear()} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
        const rows = list.slice().sort((a, b) => allyOrder(a) - allyOrder(b) || b.power - a.power)
          .map(r => [stamp, 'Data Extractor', (r.search || r.name).slice(0, 80), r.name.slice(0, 80), r.alliance, Math.round(r.power / 1e6)]);
        sendRows(m, '/game-cp', { rows }, 'Base CP');
      };
    }

    /* ---- a date column's ✎ ---- */
    function dateMenu(btn) {
      const d = btn.dataset.d, title = cfg().title;
      Admin.popover(btn, [
        ...(SEND[o.id] ? [{ label: '📤 Send this day to sheet…', run: () => sendDay(d) }, '-'] : []),
        { label: '📅 Change date…', run: () => {
          const m = Admin.modal(`<h3>Change ${head(d)} ${d.slice(0, 4)}</h3><p>If the new date already has a column, the two become one (each player's higher value stays).</p>
            <label>New date<input type="date" value="${d}"></label><div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Change date</button></div>`);
          m.querySelector('[data-x]').onclick = m.close;
          m.querySelector('[data-y]').onclick = () => {
            const to = m.querySelector('input').value;
            if (!to || to === d) return Admin.toast('Pick a different date');
            m.close(); run('day-move', { day: d, to }, { what: `${title} · moved a column`, from: head(d), to: head(to) });
          };
        } },
        { label: '🧹 Clear every value in it', run: async () => {
          if (await Admin.confirm(`Clear ${head(d)}?`, `Keeps the column but empties it.${o.id === 'st' ? ' March CP 1–3 are worked out again from the days left.' : ''}`, 'Clear'))
            run('day-clear', { day: d }, { what: `${title} · cleared ${head(d)}`, from: 'values', to: 'empty' });
        } },
        '-',
        { label: '🗑 Remove column', danger: true, run: async () => {
          if (await Admin.confirm(`Remove ${head(d)}?`, `Removes the ${head(d)} column from the ${esc(title)} card.${o.id === 'st' ? ' March CP 1–3 are worked out again from the days left.' : ''} History can undo it.`))
            run('day-delete', { day: d }, { what: `${title} · removed a column`, from: head(d), to: '—' });
        } }]);
    }

    function exportCsv() {
      const cols = columns(), q = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;
      const rows = [...el('View').querySelectorAll('tbody tr[data-id]')].map(tr => byId(tr.dataset.id)).filter(Boolean);
      const cell = (r, k) => {
        const f = defOf(k), v = f.val(r);
        if (/^\d{4}-/.test(k)) return o.id === 'st' ? (v ? 'Yes' : 'No') : v === -1 ? '' : v;
        if (k === 'join' || k === 'last') return k === 'last' && r.online ? 'now' : day(k === 'last' ? r.last : r.join);
        if (k === 'rank') return rankText(r.rank);
        if (k === 'status') return f.cell(r);
        return v === 0 && /^cp/.test(k) ? '' : v ?? '';
      };
      const csv = [cols.map(c => q(c.date ? c.k : c.label)).join(',')].concat(rows.map(r => cols.map(c => q(cell(r, c.k))).join(','))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = `${cfg().title.replace(/[^\w]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      Admin.toast(`Downloaded ${rows.length} rows`);
    }
    function addPlayer() {
      const AL = Admin.settings.alliances;
      const m = Admin.modal(`<h3>Add a player</h3><p>${dated ? 'They start with no days; click their cells to fill them in.' : 'The next read of their alliance marks them Left if the game does not list them.'}</p>
        <label>Name<input type="text" data-n maxlength="60"></label>
        <label>Alliance<select data-a>${o.id === 'ro' ? '' : '<option value="">(no alliance)</option>'}${AL.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Add</button></div>`);
      m.querySelector('[data-x]').onclick = m.close;
      const go = async () => {
        const name = m.querySelector('[data-n]').value.trim(), ally = m.querySelector('[data-a]').value;
        if (!name) return Admin.toast('Type a name');
        m.close();
        el('Q').value = ''; el('Q').dispatchEvent(new Event('input')); W.ally = '';
        const res = await run('row-add', { name, ally }, { what: `${cfg().title} · added ${name}`, from: '—', to: name });
        if (res && res.id) { W.flash = res.id; draw(); }
      };
      m.querySelector('[data-y]').onclick = go;
      m.querySelector('[data-n]').onkeydown = e => { if (e.key === 'Enter') go(); };
    }
    function addDate() {
      const m = Admin.modal(`<h3>Add a date column</h3><p>An empty column; click its cells to fill them in.</p>
        <label>Date (UTC)<input type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <div class="arow"><button type="button" class="abtn" data-x>Cancel</button><button type="button" class="abtn pri" data-y>Add</button></div>`);
      m.querySelector('[data-x]').onclick = m.close;
      m.querySelector('[data-y]').onclick = () => {
        const d = m.querySelector('input').value;
        if (!d) return; if (W.dates.includes(d)) return Admin.toast('That date already has a column');
        m.close(); run('day-add', { day: d }, { what: `${cfg().title} · added a column`, from: '—', to: head(d) });
      };
    }

    /* ---- clicks ---- */
    const rapp = $(o.tab).querySelector('.rapp');
    rapp.addEventListener('click', async e => {
      const t = e.target, b = t.closest('button'), d = b ? b.dataset : {};
      if (b && b.classList.contains('rchip')) {
        if ('v' in d) { W.view = d.v; W.ally = W.view === 'moves' ? '' : null; defaults(); }
        else if ('a' in d) W.ally = d.a; else if ('t' in d) W.type = W.type === d.t ? '' : d.t;
        else if ('c' in d) W.cls = W.cls === d.c ? '' : d.c; else if ('w' in d) W.away = !W.away;
        return draw();
      }
      if (Admin.on) {
        if (t.dataset.sel) { t.checked ? sel.add(t.dataset.sel) : sel.delete(t.dataset.sel); t.closest('tr').classList.toggle('sel', t.checked); return drawBulk(); }
        if (d.row) return rowMenu(b);
        if (d.d) { e.stopPropagation(); return dateMenu(b); }
        if (d.reset) return run('roster-reads', { ally: d.reset, action: 'reset' }, { what: `Roster · ${d.reset} read time reset`, from: ago(W.reads[d.reset]), to: 'not read yet' });
        if (d.wipe) {
          const n = W.rows.filter(r => r.alliance === d.wipe).length;
          if (await Admin.confirm(`Wipe ${esc(d.wipe)}?`, `Removes all ${n} ${esc(d.wipe)} players from the roster card, so the next read starts it afresh. History can undo it.`, 'Wipe'))
            run('roster-reads', { ally: d.wipe, action: 'wipe' }, { what: `Roster · wiped ${d.wipe}`, from: `${n} players`, to: '0' });
          return;
        }
        if (d.act === 'add') return addPlayer();
        if (d.act === 'adddate') return addDate();
        if (d.act === 'csv') return exportCsv();
        if (d.act === 'sendro') return sendRoster();
        if (d.mv) {
          const x = W.moves.find(y => y.m === d.mv), tx = a => a === null ? 'New' : a || 'No alliance';
          if (x && await Admin.confirm('Take this off History?', `${esc(x.name)}: ${esc(tx(x.from))} → ${esc(tx(x.to))}, from the Alliance roster card's History. History (admin) can undo it.`, 'Remove'))
            run('move-delete', { m: x.m }, { what: `Roster · removed a change from History`, from: `${x.name}: ${tx(x.from)} → ${tx(x.to)}`, to: '—' });
          return;
        }
        if (d.act === 'clear') { sel.clear(); return draw(); }
        if (d.act === 'merge') return mergeDialog([...sel]);
        if (d.act === 'bulkdel') {
          const ids = [...sel], nm = names(ids);
          if (await Admin.confirm(`Delete ${ids.length} players?`, `${esc(list(nm, 6))}: removed from the ${esc(cfg().title)} card. History can undo it.`, 'Delete')) {
            sel.clear(); run('row-delete', { ids }, { what: `${cfg().title} · deleted ${ids.length} players`, from: list(nm), to: '—' });
          }
          return;
        }
        const td = t.closest('td');
        if (td && !b && (td.classList.contains('ed') || td.classList.contains('tog')) && t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return edit(td);
      }
      const th = t.closest('th');
      if (th && !b && th.dataset.k) {
        const c = th.dataset.k, f = defOf(c);
        W.asc = W.sort === c ? !W.asc : !!(f && f.text); W.sort = c; draw();
      }
    });
    rapp.addEventListener('change', e => {
      const s = e.target; if (!('bulk' in s.dataset) || !s.value) return;
      const ally = s.value === '-' ? '' : s.value, ids = [...sel], nm = names(ids);
      sel.clear();
      run('bulk-ally', { ids, ally }, { what: `${cfg().title} · ${ids.length} players to ${ally || 'no alliance'}`, from: list(nm), to: ally || '—' });
    });
    // the search box: a ✕ to empty it, shown once something is typed
    const q = el('Q'), clear = document.createElement('button');
    clear.type = 'button'; clear.className = 'rclear'; clear.textContent = '✕'; clear.title = 'Clear the search'; clear.setAttribute('aria-label', 'Clear the search'); clear.hidden = true;
    q.after(clear);
    q.oninput = () => { clear.hidden = !q.value; draw(); };
    clear.onclick = e => { e.preventDefault(); q.value = ''; clear.hidden = true; draw(); q.focus(); };
    el('Reload').onclick = load;
    const visible = () => location.hash === o.hash;
    Admin.subscribe(kind => {
      if (kind === 'settings') { W.sort = null; W.ally = null; }
      if (kind === 'admin' && !Admin.on) sel.clear();
      if (kind === 'data' && visible()) load(); else draw();
    });
    // load whenever the view is opened
    const maybe = () => { if (visible()) load(); };
    addEventListener('hashchange', maybe);
    maybe();
  }

  makeCard({ id: 'wb', el: 'wb', tab: 'tab-wb', api: '/wb', hash: '#whitebeard',
    empty: 'Nothing yet. Read the Whitebeard ranking with the 2698 Data Extractor bookmark in the game, and it appears here.' });
  makeCard({ id: 'st', el: 'st', tab: 'tab-st', api: '/st', hash: '#snowtrain',
    empty: 'Nothing yet. Open a Snow Train\'s Unit Details in the game and tap Read on the 2698 Data Extractor bookmark, and it appears here.' });
  makeCard({ id: 'et', el: 'et', tab: 'tab-et', api: '/et', hash: '#energytower',
    empty: 'Nothing yet. Tap Read under Energy Tower on the 2698 Data Extractor bookmark in the game, and it appears here.' });
  makeCard({ id: 'ro', el: 'roster', tab: 'tab-roster', api: '/roster', hash: '#roster',
    empty: 'Nothing yet. Read an alliance with the 2698 Data Extractor bookmark in the game, and its members appear here.' });
})();
