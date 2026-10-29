/* ---------------- Admin: the pill at the top right, and the admin page (#admin) ---------------- */
// The pill asks for the password (the Worker's SHARED_PASS secret) and, once it is right, turns on
// admin mode: the cards (cards.js) become editable and the admin page holds the settings, Sheets,
// backup and History. Every change is made by the Worker (api/admin), which checks the password
// each time and keeps the change in History so it can be undone. The settings themselves (api/settings)
// are read by every visitor: alliances, each card's title, columns and defaults, the home page.

window.Admin = (function () {
  const A = { on: false, settings: null, ready: null };
  const subs = [];
  const emit = kind => subs.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } });
  A.subscribe = fn => subs.push(fn);

  // the same defaults the Worker has (cleanSettings in worker.js), used until the Worker answers
  const col = (k, label) => ({ k, label, show: true });
  const DEFAULTS = {
    alliances: ['698N', '698S', '698W', '698C'],
    cards: {
      wb: { title: 'Whitebeard ranking', sort: 'last', filter: '', fmt: 'full', unitFilters: false, cols: [col('name', 'Name'), col('ally', 'Alliance'), col('@dates', 'Date columns')] },
      st: { title: 'Snow Train', sort: 'cp1', filter: '', fmt: 'M', unitFilters: true,
            cols: [col('name', 'Name'), col('cp1', 'March CP 1'), col('u1', 'Unit 1'), col('cp2', 'March CP 2'), col('u2', 'Unit 2'), col('cp3', 'March CP 3'), col('u3', 'Unit 3'), col('ally', 'Alliance'), col('@dates', 'Date columns')] },
      ro: { title: 'Alliance roster', sort: 'power', filter: '', fmt: 'M', unitFilters: false,
            cols: [col('name', 'Name'), col('alliance', 'Alliance'), col('rank', 'Rank'), col('power', 'Power'), col('cls', 'MM/CE'), col('join', 'Joined'), col('last', 'Last online'), col('status', 'Status')] },
      et: { title: 'Energy Tower', sort: 'best', filter: '', fmt: 'M', unitFilters: false, cols: [col('name', 'Name'), col('best', 'Best March CP'), col('ally', 'Alliance'), col('@dates', 'Date columns')] },
    },
    home: { title: '2698 Data Extractor', banner: '2698', cards: [] },
    sheets: {},
    bookmark: { members: true, wb: true, st: true, et: true },
    highlight: {
      missed: { on: true, days: 2, color: 'red', cards: ['wb', 'st', 'et'] },
      away: { on: true, days: 3, color: 'amber', cards: ['ro'] },
      fresh: { on: true, days: 7, color: 'green', cards: ['ro', 'wb', 'st', 'et'] },
    },
  };
  // the highlight rules: what each marks, and the cards it can go on
  const HL = {
    missed: { name: 'Missed days', hint: n => `Players missing from the last ${n} days in a row (or more)`, cards: ['wb', 'st', 'et'] },
    away: { name: 'Away', hint: n => `Last online more than ${n} days ago (also the Away chip)`, cards: ['ro'] },
    fresh: { name: 'New players', hint: n => `First seen in the last ${n} days`, cards: ['ro', 'wb', 'st', 'et'] },
  };
  const HL_COLORS = ['red', 'amber', 'green', 'blue', 'purple'];
  const SHEET_NAMES = { kartz: 'Kartz ranking (Send on the Kartz page)', cp: 'Base CP (Alliance Rosters, RawData-CP)', ranking: 'Whitebeard ranking (bookmark Send)', snowtrain: 'Snow Train (bookmark Send)', energytower: 'Energy Tower (bookmark Send)' };
  const HOME_NAMES = { kartz: 'Kartz ranking', cp: 'Alliance roster', wb: 'Whitebeard ranking', st: 'Snow Train', et: 'Energy Tower' };
  const BOOKMARK_NAMES = { members: 'Alliance members', wb: 'Whitebeard ranking', st: 'Snow Train', et: 'Energy Tower' };
  const CARD_NAMES = { wb: 'Whitebeard', st: 'Snow Train', ro: 'Alliance roster', et: 'Energy Tower' };

  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  try { const s = JSON.parse(store.get('site.settings')); if (s && s.cards) A.settings = s; } catch {}
  if (!A.settings) A.settings = DEFAULTS;

  async function post(path, body, pass) {
    const headers = { 'content-type': 'application/json' };
    if (pass) headers['x-kartz-pass'] = pass;
    const r = await fetch(API_BASE + path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'The Worker answered ' + r.status), { status: r.status });
    return j;
  }
  A.ready = post('/settings').then(s => setSettings(s)).catch(e => console.warn('settings:', e.message));
  function setSettings(s) {
    if (!s || !s.cards) return;
    A.settings = s;
    store.set('site.settings', JSON.stringify(s));
    applyHome();
    emit('settings');
  }

  // a change through the Worker, with what it was for History
  A.call = async (op, body, note) => {
    const pass = store.get('adminPass');
    if (!pass) { lock(); throw new Error('Admin mode is off.'); }
    try { return await post('/admin', { op, ...body, note }, pass); }
    catch (e) {
      if (e.status === 403) { lock(); toast('✗ ' + e.message + ' Admin mode is off.'); }
      throw e;
    }
  };
  // the settings changed by `fn` on a copy, saved, and in use everywhere once the Worker has them
  A.saveSettings = async (fn, note) => {
    const next = structuredClone(A.settings);
    fn(next);
    const res = await A.call('settings', { settings: next }, note);
    setSettings(res.settings);
    done(res);
    return res;
  };
  A.undo = async id => {
    try { const r = await A.call('undo', { id }); toast(r.undone === 1 ? 'Undone' : `Undid ${r.undone} changes`); }
    catch (e) { toast('✗ ' + e.message); }
    A.ready = post('/settings').then(setSettings).catch(() => {});
    await A.ready;
    emit('data');
  };
  // a saved change: a toast with Undo
  function done(res) {
    if (res && res.entry) toast('Saved · ' + res.entry.what, res.entry.id);
    else toast('Nothing changed');
    if (page === 'history') drawPage();
  }
  A.done = done;

  /* ---- toast, modal, popover ---- */
  let toastEl, toastTimer;
  function toast(msg, undoId) {
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.className = 'atoast';
      toastEl.innerHTML = '<span></span><button type="button">Undo</button>';
      document.body.appendChild(toastEl);
    }
    toastEl.firstChild.textContent = msg;
    const b = toastEl.lastChild;
    b.style.display = undoId ? '' : 'none';
    toastEl.classList.toggle('plain', !undoId);           // no Undo: the same space on both sides
    b.onclick = () => { toastEl.classList.remove('on'); A.undo(undoId); };
    toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), undoId ? 6000 : 3500);
  }
  A.toast = toast;
  function modal(html, wide) {
    closePop();
    const s = document.createElement('div'); s.className = 'ascrim';
    s.innerHTML = `<div class="amodal ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
    document.body.appendChild(s);
    const m = s.firstChild;
    m.close = () => s.remove();
    s.onmousedown = e => { if (e.target === s) m.close(); };
    s.onkeydown = e => { if (e.key === 'Escape') m.close(); };
    setTimeout(() => { const f = m.querySelector('input:not([type=checkbox]),select'); if (f) f.focus(); }, 30);
    return m;
  }
  A.modal = modal;
  A.confirm = (title, body, yes = 'Remove', danger = true) => new Promise(res => {
    const m = modal(`<h3>${title}</h3><p>${body}</p><div class="arow"><button type="button" class="abtn" data-n>Cancel</button><button type="button" class="abtn ${danger ? 'danger' : 'pri'}" data-y>${yes}</button></div>`);
    m.querySelector('[data-n]').onclick = () => { m.close(); res(false); };
    m.querySelector('[data-y]').onclick = () => { m.close(); res(true); };
  });
  // a button kept busy while its change is saved
  A.busy = async (btn, work) => {
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try { return await work(); } finally { btn.disabled = false; btn.textContent = t; }
  };
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  A.popover = (anchor, items) => {
    closePop();
    pop = document.createElement('div'); pop.className = 'apop';
    pop.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.label}</button>`).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (scrollY + r.bottom + 4) + 'px';
    pop.style.left = Math.max(8, Math.min(scrollX + r.left, scrollX + innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.onclick = e => { const b = e.target.closest('button'); if (!b) return; closePop(); items[b.dataset.i].run(); };
  };
  addEventListener('mousedown', e => { if (pop && !pop.contains(e.target)) closePop(); });

  /* ---- the pill: one in the home banner, one in the header ---- */
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
  const pills = [];
  for (const id of ['themeHome', 'theme']) {
    const t = $(id); if (!t) continue;
    const p = document.createElement('div'); p.className = 'apill';
    t.parentNode.insertBefore(p, t);
    p.onclick = e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (b.dataset.p === 'open') unlock();
      else if (b.dataset.p === 'page') location.hash = '#admin';
      else { lock(); toast('Admin mode is off'); }
    };
    pills.push(p);
  }
  function drawPills() {
    for (const p of pills) {
      p.classList.toggle('on', A.on);
      p.innerHTML = A.on ? `<button type="button" data-p="page" title="Admin settings and History" aria-label="Admin settings">${OPEN}<span class="t">Admin</span></button><button type="button" data-p="exit" class="x">Exit</button>`
                         : `<button type="button" data-p="open" title="Admin" aria-label="Admin">${LOCK}<span class="t">Admin</span></button>`;
    }
  }
  function setOn(on) {
    if (A.on === on) return;
    A.on = on; drawPills(); drawPage(); emit('admin');
  }
  function lock() { store.set('adminPass', null); setOn(false); }
  A.lock = lock;
  function unlock() {
    const m = modal(`<div class="alock">${LOCK}</div><h3>Admin</h3>
      <p>Enter the admin password to edit rows, columns, filters and settings.</p>
      <form><label>Password<input type="password" autocomplete="current-password"></label><p class="aerr"></p>
      <div class="arow"><button type="button" class="abtn" data-n>Cancel</button><button class="abtn pri">Unlock</button></div></form>`);
    m.querySelector('[data-n]').onclick = m.close;
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const pass = m.querySelector('input').value, err = m.querySelector('.aerr'), go = m.querySelector('.pri');
      const shake = msg => { err.textContent = msg; m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); };
      if (!pass) return shake('Type the password.');
      go.disabled = true; go.textContent = 'Checking…';
      try {
        await post('/admin', { op: 'check' }, pass);
        store.set('adminPass', pass); m.close(); setOn(true); toast('Admin mode on');
      } catch (x) { shake(x.message); m.querySelector('input').select(); }
      go.disabled = false; go.textContent = 'Unlock';
    };
  }
  A.unlock = unlock;
  // still unlocked from before (the Worker checks the password again with each change)
  if (store.get('adminPass')) A.on = true;
  store.set('cardPass', null);                // the date ✎'s old saved password, now part of admin mode
  drawPills();

  /* ---- the home page from the settings ---- */
  function applyHome() {
    const h = A.settings.home;
    if (!h || !h.cards || !h.cards.length) return;
    const t = document.getElementById('bandTitle'); if (t) t.textContent = h.title;
    const t2 = document.querySelector('.top .brand h1'); if (t2) t2.textContent = h.title;
    const box = document.querySelector('.homecards');
    let prev = null;
    for (const c of h.cards) {
      const el = box && box.querySelector(`.hcard[data-card="${c.id}"]`); if (!el) continue;
      // in the order set, moving a card only when it's out of place (a move replays its slide-in)
      const at = prev ? prev.nextElementSibling : box.firstElementChild;
      if (at !== el) box.insertBefore(el, at);
      prev = el;
      if (el.hidden !== !c.show) el.hidden = !c.show;
      const b = el.querySelector('b'); if (b.textContent !== c.title) b.textContent = c.title;
      const o = el.querySelector('.open');
      if (o) { if (o.getAttribute('href') !== c.link) o.href = c.link; if (o.hidden !== !c.link) o.hidden = !c.link; }
    }
  }
  applyHome();

  /* ---- the admin page (#admin) ---- */
  const PAGES = [['cols', 'Filters & columns'], ['home', 'Home page'], ['sheets', 'Sheets & backup'], ['history', 'History']];
  let page = 'cols', log = null;
  const view = $('adminView'), tabs = $('adminTabs');
  function drawPage() {
    if (!view || location.hash !== '#admin') return;
    if (!A.on) {
      tabs.innerHTML = '';
      view.innerHTML = `<div class="apanel"><h2>Admin</h2><p class="ahint">This page is for the site's admin. Unlock it with the password to change the cards, the settings and the Sheets the bookmark sends to.</p><button type="button" class="abtn pri" data-unlock>Unlock</button></div>`;
      view.querySelector('[data-unlock]').onclick = unlock;
      return;
    }
    tabs.innerHTML = PAGES.map(([k, l]) => `<button type="button" class="rchip ${page === k ? 'on' : ''}" data-pg="${k}">${l}</button>`).join('');
    view.onchange = view.onclick = null;
    ({ cols: colsPage, home: homePage, sheets: sheetsPage, history: historyPage })[page]();
  }
  if (tabs) tabs.onclick = e => { const b = e.target.closest('[data-pg]'); if (b) { page = b.dataset.pg; drawPage(); } };
  addEventListener('hashchange', drawPage);
  A.subscribe(k => { if (k !== 'admin') drawPage(); });
  // a settings change from a field on the page: saved, else put back
  const save = (fn, note) => A.saveSettings(fn, note).catch(e => { toast('✗ ' + e.message); drawPage(); });
  const arrows = (attr, i, n, first = 0) => `<button type="button" class="abtn sm" data-${attr}u="${i}" ${i > first ? '' : 'disabled'} aria-label="Up">↑</button><button type="button" class="abtn sm" data-${attr}d="${i}" ${i >= first && i < n - 1 ? '' : 'disabled'} aria-label="Down">↓</button>`;
  const swap = (list, i, j) => { [list[i], list[j]] = [list[j], list[i]]; };

  /* ---- highlights: the rules the cards mark players by ---- */
  const hlOf = k => ({ ...DEFAULTS.highlight[k], ...((A.settings.highlight || {})[k] || {}) });
  function highlights() {
    return `<div class="apanel"><h2>Highlights</h2><p class="ahint">Marks on the cards for everyone to see. Each rule: on or off, its number of days, its colour and the cards it goes on.</p><div class="alist">
      ${Object.entries(HL).map(([k, h]) => { const r = hlOf(k); return `<div class="ali wrapline">
        <label class="acheck"><input type="checkbox" data-hl="${k}" data-hf="on" ${r.on ? 'checked' : ''}> <b>${h.name}</b></label>
        <input type="number" data-hl="${k}" data-hf="days" value="${r.days}" min="1" max="365" class="tiny" aria-label="Days"> days
        <select data-hl="${k}" data-hf="color" class="hlpick">${HL_COLORS.map(c => `<option value="${c}" ${r.color === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select>
        <span class="hl hl-${r.color}">${k === 'missed' ? 'missed ' + r.days : k === 'fresh' ? 'new' : 'away'}</span>
        ${h.cards.length > 1 ? h.cards.map(c => `<label class="acheck"><input type="checkbox" data-hl="${k}" data-hc="${c}" ${r.cards.includes(c) ? 'checked' : ''}> ${CARD_NAMES[c]}</label>`).join('') : `<span class="ahint">${CARD_NAMES[h.cards[0]]}</span>`}
        <p class="ahint" style="flex-basis:100%;margin:0">${h.hint(r.days)}</p></div>`; }).join('')}</div></div>`;
  }
  function hlChange(t, d) {
    const k = d.hl, r = hlOf(k), h = HL[k];
    let next = { ...r }, from, to;
    if (d.hc) { next.cards = h.cards.filter(c => c === d.hc ? t.checked : r.cards.includes(c)); from = r.cards.includes(d.hc) ? 'on' : 'off'; to = t.checked ? 'on' : 'off'; }
    else if (d.hf === 'on') { next.on = t.checked; from = r.on ? 'on' : 'off'; to = t.checked ? 'on' : 'off'; }
    else if (d.hf === 'days') { const n = Math.round(+t.value); if (!(n >= 1 && n <= 365)) { t.value = r.days; return; } next.days = n; from = r.days + ' days'; to = n + ' days'; }
    else { next.color = t.value; from = r.color; to = t.value; }
    const what = d.hc ? `${h.name} on ${CARD_NAMES[d.hc]}` : d.hf === 'on' ? h.name : `${h.name} · ${d.hf}`;
    return save(n => { n.highlight = { ...DEFAULTS.highlight, ...n.highlight, [k]: next }; }, { what: `Highlights · ${what}`, from, to });
  }

  function colsPage() {
    const S = A.settings, AL = S.alliances;
    const tag = a => `<span class="rtag t${esc(a)}">${esc(a)}</span>`;
    const card = c => {
      const C = S.cards[c];
      const sorts = C.cols.filter(x => x.k !== '@dates').map(x => [x.k, x.label]).concat(c === 'ro' ? [] : [['last', 'Latest date']]);
      const filters = ['', ...AL, ...(c === 'ro' ? [] : ['OTHER'])];
      return `<div class="apanel"><h2>${CARD_NAMES[c]} card</h2>
        <div class="alist">
          <div class="ali"><span class="alab">Card title</span><input type="text" data-c="${c}" data-f="title" value="${esc(C.title)}" maxlength="40"></div>
          <div class="ali"><span class="alab">Default sort</span><select data-c="${c}" data-f="sort">${sorts.map(([k, l]) => `<option value="${k}" ${C.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="ali"><span class="alab">Default filter</span><select data-c="${c}" data-f="filter">${filters.map(a => `<option value="${esc(a)}" ${C.filter === a ? 'selected' : ''}>${a === 'OTHER' ? 'Other' : esc(a) || 'Everyone'}</option>`).join('')}</select></div>
          <div class="ali"><span class="alab">Numbers</span><select data-c="${c}" data-f="fmt">${[['M', c === 'ro' ? '812.0M' : '256M'], ['k', '256,158k'], ['full', '256,158,825']].map(([k, l]) => `<option value="${k}" ${C.fmt === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          ${c === 'st' ? `<div class="ali"><span class="alab">Unit filters</span><label class="acheck"><input type="checkbox" data-c="st" data-f="unitFilters" ${C.unitFilters ? 'checked' : ''}> Army / Navy / Air Force chips</label></div>` : ''}
        </div>
        <h2 class="asub">Columns</h2><p class="ahint">Tick to show, type to rename, arrows to move. Name stays first.</p>
        <div class="alist">${C.cols.map((x, i) => `<div class="ali">
          <input type="checkbox" data-c="${c}" data-cs="${i}" ${x.show ? 'checked' : ''} ${x.k === 'name' ? 'disabled' : ''} aria-label="Show">
          <input type="text" data-c="${c}" data-cl="${i}" value="${esc(x.label)}" maxlength="30" ${x.k === '@dates' ? 'disabled title="Each date is its own column"' : ''}>
          ${x.k === 'name' ? '' : arrows('c' + c, i, C.cols.length, 1)}</div>`).join('')}</div></div>`;
    };
    view.innerHTML = `<div class="apanel"><h2>Alliances</h2>
      <p class="ahint">The filter chips on every card, in this order. Renaming one renames it on every player too. The bookmark still labels its own reads 698N, 698S, 698W and 698C.</p>
      <div class="alist">${AL.map((a, i) => `<div class="ali">${tag(a)}<input type="text" data-ar="${i}" value="${esc(a)}" maxlength="12">${arrows('a', i, AL.length)}<button type="button" class="abtn sm" data-ax="${i}" ${AL.length > 1 ? '' : 'disabled'}>Remove</button></div>`).join('')}
        <div class="ali"><input type="text" data-an placeholder="New alliance tag" maxlength="12"><button type="button" class="abtn sm pri" data-aadd>Add</button></div></div></div>
      ${highlights()}
      <div class="acols">${['wb', 'st', 'et', 'ro'].map(card).join('')}</div>`;
    view.onchange = async e => {
      const t = e.target, d = t.dataset, c = d.c, C = c && S.cards[c];
      if (d.hl) return hlChange(t, d);
      if (d.ar) {
        const from = AL[d.ar], to = t.value.trim();
        if (!to || to === from) { t.value = from; return; }
        try { const r = await A.call('alliance-rename', { from, to }, { what: 'Renamed alliance', from, to }); await reloadSettings(); done(r); emit('data'); }
        catch (x) { toast('✗ ' + x.message); drawPage(); }
        return;
      }
      if (d.f) {
        const v = t.type === 'checkbox' ? t.checked : t.value.trim(), label = { title: 'title', sort: 'default sort', filter: 'default filter', fmt: 'number format', unitFilters: 'unit filters' }[d.f];
        const show = x => d.f === 'sort' ? (sorts(c).find(s => s[0] === x) || [, x])[1] : d.f === 'filter' ? (x === 'OTHER' ? 'Other' : x || 'Everyone') : String(x);
        if (d.f === 'title' && !v) { t.value = C.title; return; }
        return save(n => { n.cards[c][d.f] = v; }, { what: `${CARD_NAMES[c]} · ${label}`, from: show(C[d.f]), to: show(v) });
      }
      if (d.cs) { const x = C.cols[d.cs]; return save(n => { n.cards[c].cols[d.cs].show = t.checked; }, { what: `${CARD_NAMES[c]} · ${x.label} column`, from: x.show ? 'shown' : 'hidden', to: t.checked ? 'shown' : 'hidden' }); }
      if (d.cl) { const x = C.cols[d.cl], v = t.value.trim(); if (!v) { t.value = x.label; return; } return save(n => { n.cards[c].cols[d.cl].label = v; }, { what: `${CARD_NAMES[c]} · renamed column`, from: x.label, to: v }); }
    };
    const sorts = c => S.cards[c].cols.filter(x => x.k !== '@dates').map(x => [x.k, x.label]).concat([['last', 'Latest date']]);
    view.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset;
      for (const c of ['wb', 'st', 'et', 'ro']) {
        const u = d['c' + c + 'u'], dn = d['c' + c + 'd'];
        if (u == null && dn == null) continue;
        const L = S.cards[c].cols, i = +(u ?? dn), j = u != null ? i - 1 : i + 1;
        return save(n => swap(n.cards[c].cols, i, j), { what: `${CARD_NAMES[c]} · moved ${L[i].label} ${u != null ? 'left' : 'right'}`, from: `place ${i + 1}`, to: `place ${j + 1}` });
      }
      if (d.au || d.ad) { const i = +(d.au ?? d.ad), j = d.au ? i - 1 : i + 1; return save(n => swap(n.alliances, i, j), { what: `Alliances · moved ${AL[i]}`, from: `place ${i + 1}`, to: `place ${j + 1}` }); }
      if (d.ax) {
        const a = AL[d.ax];
        if (await A.confirm(`Remove ${esc(a)}?`, `${esc(a)} stops being a filter chip. Its players stay: under Other on Whitebeard, Snow Train and Energy Tower.`))
          save(n => { n.alliances.splice(d.ax, 1); }, { what: 'Removed alliance', from: a, to: '—' });
        return;
      }
      if ('aadd' in d) {
        const v = view.querySelector('[data-an]').value.trim();
        if (!v || AL.includes(v)) return toast(v ? v + ' is already there' : 'Type the tag first');
        save(n => { n.alliances.push(v); }, { what: 'Added alliance', from: '—', to: v });
      }
    };
  }
  async function reloadSettings() { setSettings(await post('/settings')); }

  function homePage() {
    const H = A.settings.home;
    view.innerHTML = `<div class="apanel"><h2>Home page</h2><div class="alist">
        <div class="ali"><span class="alab">Site title</span><!-- the name in the banner and the header --><input type="text" data-h="title" value="${esc(H.title)}" maxlength="60"></div></div></div>
      <div class="apanel"><h2>Cards</h2><p class="ahint">Show or hide, the title, the Open in Sheets link, and the order.</p><div class="alist">
      ${H.cards.map((x, i) => `<div class="ali wrapline"><input type="checkbox" data-hs="${i}" ${x.show ? 'checked' : ''} aria-label="Show on the home page">
        <input type="text" data-ht="${i}" value="${esc(x.title)}" maxlength="40" class="short">
        <input type="url" data-hl="${i}" value="${esc(x.link)}" class="long">${arrows('h', i, H.cards.length)}</div>`).join('')}</div>
      <p class="ahint" style="margin-top:12px"><a href="./">Open the home page ↗</a></p></div>
      <div class="apanel"><h2>Bookmark</h2><p class="ahint">The sections the 2698 Data Extractor bookmark shows in the game. A hidden one keeps its saved reads and comes back when ticked again; it takes effect the next time the bookmark is opened.</p><div class="alist">
      ${Object.entries(BOOKMARK_NAMES).map(([k, l]) => `<div class="ali"><label class="acheck"><input type="checkbox" data-bm="${k}" ${(A.settings.bookmark || {})[k] !== false ? 'checked' : ''}> ${l}</label></div>`).join('')}</div></div>`;
    view.onchange = e => {
      const t = e.target, d = t.dataset, v = t.value.trim();
      if (d.bm) return save(n => { n.bookmark = { ...DEFAULTS.bookmark, ...n.bookmark, [d.bm]: t.checked }; }, { what: `Bookmark · ${BOOKMARK_NAMES[d.bm]}`, from: t.checked ? 'hidden' : 'shown', to: t.checked ? 'shown' : 'hidden' });
      if (d.h === 'title') { if (!v) { t.value = H.title; return; } return save(n => { n.home.title = v; }, { what: 'Home · site title', from: H.title, to: v }); }
      if (d.hs) { const x = H.cards[d.hs]; return save(n => { n.home.cards[d.hs].show = t.checked; }, { what: `Home · ${x.title} card`, from: x.show ? 'shown' : 'hidden', to: t.checked ? 'shown' : 'hidden' }); }
      if (d.ht) { const x = H.cards[d.ht]; if (!v) { t.value = x.title; return; } return save(n => { n.home.cards[d.ht].title = v; }, { what: `Home · ${HOME_NAMES[x.id]} card title`, from: x.title, to: v }); }
      if (d.hl) { const x = H.cards[d.hl]; if (!/^https:\/\/\S+$/.test(v)) { toast('The link must start with https://'); t.value = x.link; return; } return save(n => { n.home.cards[d.hl].link = v; }, { what: `Home · ${x.title} link`, from: x.link, to: v }); }
    };
    view.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const u = b.dataset.hu, dn = b.dataset.hd; if (u == null && dn == null) return;
      const C = H.cards, i = +(u ?? dn), j = u != null ? i - 1 : i + 1;
      save(n => swap(n.home.cards, i, j), { what: `Home · moved ${C[i].title} ${u != null ? 'up' : 'down'}`, from: `place ${i + 1}`, to: `place ${j + 1}` });
    };
  }

  function sheetsPage() {
    const T = A.settings.sheets;
    const link = t => t.id ? `https://docs.google.com/spreadsheets/d/${t.id}/edit#gid=${t.gid}` : '';
    view.innerHTML = `<div class="apanel"><h2>Where each Send goes</h2>
      <p class="ahint">Paste the link of the tab to send to (it carries the spreadsheet and the tab). The Worker tries it before saving: the spreadsheet must be shared with its service account as Editor. The columns written stay the same. Rows already in a sheet are changed in Google Sheets itself.</p>
      <div class="alist">${Object.keys(SHEET_NAMES).filter(k => T[k]).map(k => `<div class="asheet">
        <b>${SHEET_NAMES[k]}</b>
        <div class="ali"><input type="url" data-sl="${k}" value="${esc(link(T[k]))}" placeholder="No sheet yet — paste a tab's link" class="long"><button type="button" class="abtn sm pri" data-ss="${k}">Save</button>${T[k].id ? `<a class="abtn sm" href="${esc(link(T[k]))}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>
        <p class="aerr" data-se="${k}"></p></div>`).join('')}</div></div>
      <div class="apanel"><h2>Backup</h2><p class="ahint">Every card's data and every setting in one file. Restoring puts all of it back as it was in the file (History can undo that too).</p>
        <div class="ali"><button type="button" class="abtn pri" data-bk>Download backup</button><label class="abtn">Restore from a backup…<input type="file" accept=".json,application/json" data-rs hidden></label></div></div>`;
    view.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ss) {
        const k = b.dataset.ss, raw = view.querySelector(`[data-sl="${k}"]`).value.trim(), err = view.querySelector(`[data-se="${k}"]`);
        const id = (raw.match(/\/d\/([\w-]{20,})/) || [, /^[\w-]{20,}$/.test(raw) ? raw : ''])[1], gm = raw.match(/[#&?]gid=(\d+)/);
        if (!id) { err.textContent = 'That is not a Google Sheets link.'; return; }
        const gid = gm ? +gm[1] : T[k].id === id ? T[k].gid : 0;
        if (id === T[k].id && gid === T[k].gid) { err.textContent = 'That is where it goes already.'; return; }
        err.textContent = 'Trying the sheet…';
        try {
          await A.busy(b, () => A.saveSettings(n => {
            n.sheets[k] = { id, gid };
            // the Energy Tower's home card has no Open in Sheets link until its sheet is set
            const h = k === 'energytower' && n.home.cards.find(c => c.id === 'et');
            if (h && !h.link) h.link = link({ id, gid });
          }, { what: `Sheets · ${SHEET_NAMES[k]}`, from: T[k].id ? `${T[k].id.slice(0, 10)}… tab ${T[k].gid}` : 'none', to: `${id.slice(0, 10)}… tab ${gid}` }));
        } catch (x) { err.textContent = '✗ ' + x.message; }
        return;
      }
      if ('bk' in b.dataset) {
        try {
          const r = await A.busy(b, () => A.call('backup'));
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
          a.download = `2698-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (x) { toast('✗ ' + x.message); }
      }
    };
    view.onchange = async e => {
      const t = e.target; if (!('rs' in t.dataset) || !t.files[0]) return;
      const f = t.files[0]; t.value = '';
      let b;
      try { b = JSON.parse(await f.text()); if (!b || b.site !== '2698' || !b.data) throw 0; }
      catch { toast('✗ That is not a backup of this site'); return; }
      if (!await A.confirm('Restore this backup?', `Every card and setting goes back to how it was on ${esc(new Date(b.at).toLocaleString())}. Reads and changes since then are replaced. History can undo it.`, 'Restore')) return;
      try { const r = await A.call('restore', { data: b.data }, { what: 'Restored a backup', from: 'as it was', to: f.name }); await reloadSettings(); done(r); emit('data'); }
      catch (x) { toast('✗ ' + x.message); }
    };
  }

  async function historyPage() {
    view.innerHTML = '<div class="apanel"><h2>History</h2><p class="ahint">Loading…</p></div>';
    try { log = (await A.call('log')).log; } catch (e) { view.innerHTML = `<div class="apanel"><p class="aerr">${esc(e.message)}</p></div>`; return; }
    if (page !== 'history') return;
    const tm = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    view.innerHTML = `<div class="apanel"><h2>History</h2>
      <p class="ahint">Every admin change, newest first (the last ${log.length >= 100 ? 100 : log.length}). Undo goes back to just before that change, undoing the later ones too. It also takes back what the bookmark read since then on the same cards.</p>
      ${log.length ? `<div class="alog">${log.map((x, i) => `<div class="alogi"><time>${tm(x.t)}</time><div class="awhat">${esc(x.what)}${x.from || x.to ? `<div class="aov"><s>${esc(x.from || '—')}</s> → <ins>${esc(x.to || '—')}</ins></div>` : ''}</div>
        <button type="button" class="abtn sm" data-u="${esc(x.id)}" data-i="${i}">${i ? `Undo to here (${i + 1})` : 'Undo'}</button></div>`).join('')}</div>`
      : '<p class="ahint" style="margin:0">No changes yet.</p>'}</div>`;
    view.onclick = async e => {
      const b = e.target.closest('[data-u]'); if (!b) return;
      const n = +b.dataset.i + 1;
      if (n > 1 && !await A.confirm(`Undo ${n} changes?`, 'This one and every change after it.', 'Undo', false)) return;
      await A.busy(b, () => A.undo(b.dataset.u));
    };
  }

  return A;
})();
