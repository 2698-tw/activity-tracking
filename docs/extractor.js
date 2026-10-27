/* 2698 Data Extractor (docs/extractor.js): the in-game panel the "2698 Data Extractor" bookmark loads.
 *
 * Runs on the Top War web game (h5.topwargame.com). Two lists:
 *   Alliance members: 698N, 698S, 698W, 698C. Each is opened with the game's own Members call
 *     (UIManager.OpenUI(AllianceMemberPopup, <alliance id>), what the Members button runs), read once
 *     the game has it, and closed again. MM/CE comes from the Alliance Rosters sheet (api/roster-class).
 *   Whitebeard ranking: opened with the event's own Ranking call, every page loaded the way scrolling
 *     to the end loads it, then sent like the Whitebeard bookmark (api/game-ranking).
 * Nothing here sends anything to the game: the game makes its own usual requests for what it opens.
 * Reads are kept on this device (localStorage) so the next read can show who joined and who left.
 * UIDs are used only to match players between reads; they are never shown, copied or sent.
 */
(function () {
  'use strict';
  if (window.__x2698 && window.__x2698.toggle) { window.__x2698.toggle(); return; }

  var API = 'https://data-collection.jk06nm04.workers.dev/api';
  var SHEET = 'https://docs.google.com/spreadsheets/d/12m3Eh6Xd-LWJ9mFakmEejKNpYYqm2ll-3UCx_TeBxyc/edit#gid=0';
  // alliance ids, from the game's Alliance CP ranking (2026-10-27)
  var ALLY = { '698N': 500245787, '698S': 500245801, '698W': 500246524, '698C': 500247242 };
  var MAIN = ['698N', '698W', '698S', '698C'];
  var STORE = 'x2698.v1';

  if (!window.cc || !window.__require) { alert('2698 Data Extractor: open the Top War web game (h5.topwargame.com) first.'); return; }

  /* ---------------- the game ---------------- */
  function req(n) { try { return window.__require(n); } catch (e) { return null; } }
  function ui() { var m = req('UIManager'); return m && m.default && m.default.Instance(); }
  function win(key) { var m = req('UIDataInfo'); return m && m.UIDataInfo && m.UIDataInfo[key]; }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var between = function (lo, hi) { return lo + Math.random() * (hi - lo); };
  function pop() { return cc.find('UICanvas/PopLayer'); }
  function findComp(test) {
    var hit = null;
    (function walk(n) {
      if (hit || !n || !n.activeInHierarchy) return;
      var cs = n._components || [];
      for (var i = 0; i < cs.length; i++) if (test(cs[i])) { hit = cs[i]; return; }
      (n.children || []).forEach(walk);
    })(pop());
    return hit;
  }
  var parse = function (x) { if (typeof x !== 'string') return x || {}; try { return JSON.parse(x); } catch (e) { return {}; } };
  var memberList = function (c) { return Array.isArray(c._dataList) && c._dataList[0] && 'joinTime' in c._dataList[0]; };

  // one alliance's member list: open it, wait for it, read it, close it
  async function readAlliance(tag) {
    var U = ui(), W = win('AllianceMemberPopup');
    if (!U || !W) throw new Error('the game has changed: no member window found');
    var before = findComp(memberList), old = before && before._dataList;
    if (before) { try { U.CloseUI(W); } catch (e) {} await wait(300); }
    U.OpenUI(W, ALLY[tag]);
    var comp = null, t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      await wait(200);
      comp = findComp(memberList);
      if (comp && comp._dataList !== old && comp._dataList.length) break;
      comp = null;
    }
    if (!comp) throw new Error(tag + ': the member list did not load');
    await wait(300);                                     // let a second page of the list arrive, if any
    var list = comp._dataList.map(function (m) {
      var p = parse(m.playerInfo);
      return { uid: String(m.uid), name: String(m.name || p.username || ''), rank: Number(m.rank) || 0,
               power: Number(m.power) || 0, level: Number(m.level) || 0, join: Number(m.joinTime) || 0,
               last: Number(m.lastShowTime) || 0, online: !!m.isOnline };
    });
    try { U.CloseUI(W); } catch (e) {}
    return list;
  }

  // the Whitebeard ranking: open it with the event's own call, then every page
  function wbKey() { var m = req('UIDataInfo'); return m ? Object.keys(m.UIDataInfo).filter(function (k) { return /CBRankView$/.test(k); }).pop() : null; }
  function wbList() {
    var hit = null;
    (function walk(n) {
      if (hit || !n || !n.activeInHierarchy) return;
      (n._components || []).forEach(function (c) {
        if (!hit && Array.isArray(c._rankList) && c._rankList[0] && 'score' in c._rankList[0]) hit = c;
      });
      (n.children || []).forEach(walk);
    })(cc.director.getScene());
    return hit;
  }
  function labels() {
    var out = [];
    (function walk(n) { if (!n || !n.activeInHierarchy) return; (n._components || []).forEach(function (c) { if (c instanceof cc.Label && c.string) out.push([n.name, c.string]); }); (n.children || []).forEach(walk); })(cc.director.getScene());
    return out;
  }
  async function readWhitebeard(progress) {
    var owner = wbList();
    if (!owner) {
      var key = wbKey(), U = ui();
      if (!key || !U) throw new Error('no Whitebeard ranking in the game right now');
      U.OpenUI(win(key));
      for (var t0 = Date.now(); !owner && Date.now() - t0 < 12000;) { await wait(250); owner = wbList(); }
      if (!owner) throw new Error('the Whitebeard ranking did not load — is the event running?');
    }
    var list = owner._rankList, scroller = owner.node.getComponentInChildren(cc.ScrollView);
    var L = labels(), m = L.map(function (l) { return l[1].match(/^([\d,]+)\s+Commanders/); }).filter(Boolean)[0];
    var want = m ? Number(m[1].replace(/,/g, '')) : Infinity;
    var title = 'Whitebeard ranking';
    // the rest of the list, a page at a time: glide to the end and say it got there, as a finger
    // scroll does; the game asks for its next page itself. Uneven, like a quick flick through.
    for (var stuck = 0; scroller && list.length < want && stuck < 2;) {
      var n0 = list.length, glide = between(0.2, 0.45);
      scroller.scrollToBottom(glide);
      await wait(glide * 1000 + 50);
      scroller.node.emit('scroll-to-bottom', scroller);
      for (var t1 = Date.now(); list.length === n0 && Date.now() - t1 < 6000;) await wait(150);
      stuck = list.length === n0 ? stuck + 1 : 0;
      progress(list.length, want);
      await wait(Math.random() < 0.12 ? between(1000, 2000) : between(250, 900));
    }
    var rows = list.map(function (e) {
      var p = parse(e.playerInfo);
      return { rank: Number(e.rank), name: String(p.username || p.nickname || ''), points: Number(e.score), ally: String(e.allianceTag || '') };
    }).filter(function (r) { return isFinite(r.rank) && isFinite(r.points); }).sort(function (a, b) { return a.rank - b.rank; });
    return { title: title, want: want, rows: rows };
  }

  /* ---------------- saved reads and MM/CE ---------------- */
  var S = (function () { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  S.members = S.members || {}; S.prev = S.prev || {};
  // only the four alliances: a read of another one saved by an earlier version is dropped
  [S.members, S.prev].forEach(function (o) { Object.keys(o).forEach(function (t) { if (!ALLY[t]) delete o[t]; }); });
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ members: S.members, prev: S.prev, wb: S.wb || null })); } catch (e) {} }
  var fold = function (s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, ''); };
  // MM/CE from the roster. Names repeat ("Woody" is 698S's in-game name and 698C's search name; 698S
  // has two Gikeys), so the candidates are tried in order: in-game name in the player's own alliance,
  // search name in it, then either name anywhere, then a looser match that ignores fancy letters.
  // Where one step still finds several players, the one whose Base CP is nearest the power wins.
  var CLASS = null;
  function loadClasses() {
    return fetch(API + '/roster-class', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('roster ' + r.status)); })
      .then(function (j) {
        CLASS = { keys: {} };
        var add = function (k, row) { if (!k) return; (CLASS.keys[k] = CLASS.keys[k] || []).push(row); };
        // r: [search name, in-game name, alliance, MM/CE, Base CP in millions]
        (j.rows || []).forEach(function (r) {
          var row = { cls: r[3], cp: Number(r[4]) || 0, search: r[0] || r[1] };
          add('ia|' + r[2] + '|' + r[1], row); add('sa|' + r[2] + '|' + r[0], row); add('i|' + r[1], row); add('s|' + r[0], row);
          var seenF = {};
          [r[1], r[0]].forEach(function (n) { var f = fold(n); if (f && !seenF[f]) { seenF[f] = 1; add('fa|' + r[2] + '|' + f, row); add('f|' + f, row); } });
        });
      })
      .catch(function () { CLASS = { keys: {}, failed: true }; });
  }
  function matchOf(name, ally, power) {
    if (!CLASS) return null;
    var k = CLASS.keys, f = fold(name), cp = (power || 0) / 1e6;
    var order = ['ia|' + ally + '|' + name, 'sa|' + ally + '|' + name, 'i|' + name, 's|' + name].concat(f ? ['fa|' + ally + '|' + f, 'f|' + f] : []);
    for (var i = 0; i < order.length; i++) {
      var c = k[order[i]];
      if (!c) continue;
      return c.length === 1 ? c[0] : c.slice().sort(function (a, b) { return Math.abs(a.cp - cp) - Math.abs(b.cp - cp); })[0];
    }
    return null;
  }
  function classOf(name, ally, power) { var m = matchOf(name, ally, power); return m ? m.cls : ''; }
  // the roster's search name, as the Base CP tab sends it; the in-game name when the roster has none
  function searchOf(name, ally, power) { var m = matchOf(name, ally, power); return (m && m.search) || name; }
  var READY = loadClasses();

  // one alliance read into the site's Alliance Roster card (api/roster-update): its rows are updated
  // in place, matched by UID on the Worker; players missing from the read are marked Left there
  function pushRoster(tag, list) {
    var members = list.map(function (m) {
      return { uid: m.uid, name: m.name, search: searchOf(m.name, tag, m.power), rank: m.rank, power: m.power, level: m.level,
               join: m.join, last: m.last, online: m.online, cls: classOf(m.name, tag, m.power) };
    });
    return fetch(API + '/roster-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alliance: tag, members: members }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }

  /* ---------------- the panel ---------------- */
  var host = document.createElement('div');
  host.id = 'x2698';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' +
    '*{box-sizing:border-box}' +
    '.app{all:initial;position:absolute;inset:12px;max-width:1080px;margin:0 auto;display:flex;flex-direction:column;pointer-events:auto;' +
      'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f3f3f7;background:rgba(22,22,30,.97);border-radius:18px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1);overflow:hidden}' +
    '.top{display:flex;align-items:center;gap:10px;padding:12px 14px 8px;flex-wrap:wrap}' +
    '.top b{font-size:15.5px}' +
    '.tabs{display:flex;gap:4px;background:rgba(255,255,255,.06);border-radius:999px;padding:3px}' +
    '.tabs button{border:0;background:none;color:rgba(235,235,245,.6);font:inherit;font-weight:600;padding:6px 14px;border-radius:999px;cursor:pointer}' +
    '.tabs button.on{background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b);color:#fff}' +
    '.search{flex:1;min-width:160px;display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.08);border-radius:999px;padding:6px 14px}' +
    '.search input{flex:1;min-width:0;border:0;outline:0;background:none;color:inherit;font:inherit}' +
    '.x{border:0;background:rgba(255,255,255,.1);color:#bbb;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;flex:none}' +
    '.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 14px 8px}' +
    '.chip{border:0;background:rgba(255,255,255,.08);color:inherit;border-radius:999px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}' +
    '.chip.on{background:rgba(195,20,65,.35);box-shadow:inset 0 0 0 1px #e0457b}' +
    '.go{border:0;border-radius:999px;padding:7px 14px;font:inherit;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b)}' +
    '.go.ghost{background:rgba(255,255,255,.12)}' +
    '.go:disabled{opacity:.5;cursor:default}' +
    '.msg{font-size:12.5px;color:rgba(235,235,245,.65);padding:0 14px 6px;min-height:1.2em}' +
    '.msg a{color:#9ec5ff}' +
    '.body{flex:1;overflow:auto;padding:0 14px 14px}' +
    'table{width:100%;border-collapse:collapse;font-size:13.5px}' +
    'th{position:sticky;top:0;background:#20212c;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:rgba(235,235,245,.6);padding:8px 10px;cursor:pointer;white-space:nowrap}' +
    'td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap}' +
    'td.n{text-align:right;font-variant-numeric:tabular-nums}' +
    '.dim{color:rgba(235,235,245,.45)}' +
    '.tag{display:inline-block;border-radius:6px;padding:1px 7px;font-size:12px;font-weight:700;background:#333}' +
    '.t698N{background:#22324f;color:#9ec5ff}.t698S{background:#3b2340;color:#e9a8ff}.t698W{background:#203d33;color:#7ee2a8}.t698C{background:#45321b;color:#ffc078}.t698X{background:#3a3a3a;color:#ddd}' +
    '.CE{color:#ff9f6b;font-weight:700}.MM{color:#9ec5ff;font-weight:700}' +
    '.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#7ee2a8;margin-right:6px}' +
    '.chg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;padding:0 14px 8px}' +
    '.plus{color:#7ee2a8}.minus{color:#ff7a7a}' +
    'select{background:rgba(255,255,255,.1);color:inherit;border:0;border-radius:999px;padding:6px 12px;font:inherit}' +
    'select option{color:#111}' +
    '@media (max-width:640px){.app{inset:4px;border-radius:14px}.hs{display:none}}' +
    '</style>' +
    '<div class="app"><div class="top"><b>2698 Data Extractor</b>' +
    '<div class="tabs"><button data-t="members" class="on">Alliance members</button><button data-t="wb">Whitebeard</button></div>' +
    '<label class="search"><span>🔍</span><input id="q" placeholder="Search a name"></label><button class="x" id="close" title="Close">×</button></div>' +
    '<div class="bar" id="bar"></div><div class="msg" id="msg"></div><div class="chg" id="chg"></div><div class="body" id="body"></div></div>';
  document.body.appendChild(host);
  var $ = function (s) { return root.querySelector(s); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function tagEl(t) { var s = el('span', 'tag t' + t, t || '—'); return s; }
  function msg(t, link) { var m = $('#msg'); m.textContent = t; if (link) { m.appendChild(document.createElement('br')); var a = el('a', '', 'Open in Sheets ↗'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; m.appendChild(a); } }
  var busy = false;
  var V = { tab: 'members', ally: '', cls: '', away: false, sort: 'power', asc: false, wbFilter: 'ALL4', wb: S.wb || null };   // the last Whitebeard read, kept like the member lists

  $('#close').onclick = function () { host.style.display = 'none'; };
  window.__x2698 = { toggle: function () { host.style.display = host.style.display === 'none' ? '' : 'none'; } };
  root.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () { V.tab = b.dataset.t; root.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); render(); };
  });
  $('#q').oninput = function () { render(); };

  var ago = function (ts) {
    if (!ts) return '—'; var m = (Date.now() / 1000 - ts) / 60;
    return m < 5 ? 'now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  var day = function (ts) { return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : ''; };
  var rankText = function (r) { return r >= 6 ? 'R4 ★' : r ? 'R' + r : ''; };
  var pm = function (p) { return p ? (p / 1e6).toFixed(1) + 'M' : ''; };

  function allMembers() {
    var out = [];
    Object.keys(S.members).forEach(function (tag) { (S.members[tag].list || []).forEach(function (m) { out.push(Object.assign({ ally: tag, cls: classOf(m.name, tag, m.power) }, m)); }); });
    return out;
  }

  /* members tab */
  function membersBar() {
    var bar = $('#bar'); bar.textContent = '';
    Object.keys(ALLY).forEach(function (t) {
      var b = el('button', 'go ghost', 'Read ' + t); b.disabled = busy;
      var have = S.members[t]; if (have) b.title = have.list.length + ' members, read ' + ago(have.at / 1000);
      b.onclick = function () { run([t]); }; bar.appendChild(b);
    });
    var all = el('button', 'go', 'Read all four'); all.disabled = busy; all.onclick = function () { run(Object.keys(ALLY)); }; bar.appendChild(all);
    var csv = el('button', 'go ghost', 'Download CSV'); csv.onclick = downloadMembers; bar.appendChild(csv);
    var n = cpRows().length;
    var send = el('button', 'go', 'Send Base CP to sheet (' + n + ')'); send.disabled = busy || !n;
    send.title = 'Base CP of ' + (V.ally || 'every alliance read') + ' to Alliance Rosters → RawData-CP';
    send.onclick = sendCp; bar.appendChild(send);
    bar.appendChild(el('span', 'dim', ''));
    var f = el('div', ''); f.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;width:100%';
    [''].concat(Object.keys(ALLY)).forEach(function (t) { var c = el('button', 'chip' + (V.ally === t ? ' on' : ''), t || 'All alliances'); c.onclick = function () { V.ally = t; render(); }; f.appendChild(c); });
    ['CE', 'MM'].forEach(function (k) { var c = el('button', 'chip' + (V.cls === k ? ' on' : ''), k); c.onclick = function () { V.cls = V.cls === k ? '' : k; render(); }; f.appendChild(c); });
    var aw = el('button', 'chip' + (V.away ? ' on' : ''), 'Away 3+ days'); aw.onclick = function () { V.away = !V.away; render(); }; f.appendChild(aw);
    bar.appendChild(f);
  }
  function changes() {
    var box = $('#chg'); box.textContent = '';
    if (V.tab !== 'members') return;
    Object.keys(S.members).forEach(function (t) {
      var now = S.members[t], before = S.prev[t];
      if (!before) return;
      var was = {}, is = {};
      before.list.forEach(function (m) { was[m.uid] = m; }); now.list.forEach(function (m) { is[m.uid] = m; });
      var joined = now.list.filter(function (m) { return !was[m.uid]; }).map(function (m) { return m.name; });
      var left = before.list.filter(function (m) { return !is[m.uid]; }).map(function (m) { return m.name; });
      if (!joined.length && !left.length) return;
      var d = el('div', '');
      d.appendChild(tagEl(t)); d.appendChild(document.createTextNode(' since ' + day(before.at / 1000) + ': '));
      if (joined.length) d.appendChild(el('span', 'plus', '+ ' + joined.join(', ') + '  '));
      if (left.length) d.appendChild(el('span', 'minus', '− ' + left.join(', ')));
      box.appendChild(d);
    });
  }
  function membersTable() {
    var q = fold($('#q').value), now = Date.now() / 1000;
    var rows = allMembers().filter(function (m) {
      return (!q || fold(m.name).indexOf(q) >= 0) && (!V.ally || m.ally === V.ally) && (!V.cls || m.cls === V.cls) && (!V.away || now - m.last > 3 * 86400);
    });
    var k = V.sort, dir = V.asc ? 1 : -1;
    rows.sort(function (a, b) { var x = a[k], y = b[k]; if (k === 'name' || k === 'ally' || k === 'cls') { x = String(x); y = String(y); return x.localeCompare(y) * dir; } return ((x || 0) - (y || 0)) * dir; });
    var cols = [['name', 'Name'], ['ally', 'Alliance'], ['rank', 'Rank'], ['power', 'Power'], ['cls', 'MM/CE'], ['join', 'Joined', 'hs'], ['last', 'Last online']];
    var t = el('table'), head = el('tr');
    cols.forEach(function (c) { var th = el('th', c[2] || '', c[1] + (V.sort === c[0] ? (V.asc ? ' ▲' : ' ▼') : '')); th.onclick = function () { V.asc = V.sort === c[0] ? !V.asc : c[0] === 'name'; V.sort = c[0]; render(); }; head.appendChild(th); });
    var th = el('thead'); th.appendChild(head); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (m) {
      var tr = el('tr');
      tr.appendChild(el('td', '', m.name));
      var a = el('td'); a.appendChild(tagEl(m.ally)); tr.appendChild(a);
      tr.appendChild(el('td', '', rankText(m.rank)));
      tr.appendChild(el('td', 'n', pm(m.power)));
      tr.appendChild(el('td', m.cls || 'dim', m.cls || '—'));
      tr.appendChild(el('td', 'hs', day(m.join)));
      var l = el('td', '', ''); if (m.online) l.appendChild(el('span', 'dot')); l.appendChild(document.createTextNode(m.online ? 'now' : ago(m.last))); tr.appendChild(l);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var body = $('#body'); body.textContent = '';
    if (!Object.keys(S.members).length) body.appendChild(el('p', 'dim', 'No alliance read yet. Tap Read 698S (or Read all four): the game opens each member list, the extractor reads it and closes it again.'));
    else body.appendChild(t);
    var tot = allMembers().length;
    $('#bar').querySelector('span.dim').textContent = rows.length + ' of ' + tot + ' shown' + (CLASS && CLASS.failed ? ' · MM/CE: roster unavailable' : '');
  }
  var cardNotes = [];
  async function run(tags) {
    if (busy) return; busy = true; render(); cardNotes = [];
    try {
      for (var i = 0; i < tags.length; i++) {
        var t = tags[i];
        msg('Reading ' + t + '… (' + (i + 1) + ' of ' + tags.length + ')');
        var list = await readAlliance(t);
        if (S.members[t]) S.prev[t] = S.members[t];
        S.members[t] = { at: Date.now(), list: list };
        save(); render();
        await READY;
        try { var u = await pushRoster(t, list); cardNotes.push(t + ': ' + u.added + ' new, ' + u.left + ' left' + (u.rejoined ? ', ' + u.rejoined + ' back' : '')); }
        catch (e) { cardNotes.push(t + ': card not updated (' + (e.message || e) + ')'); }
        if (i < tags.length - 1) await wait(between(1200, 2600));   // a person's pause between alliances
      }
      msg('Read ' + tags.join(', ') + ' — ' + tags.reduce(function (s, t) { return s + S.members[t].list.length; }, 0) + ' members. Roster card: ' + cardNotes.join(' · '));
    } catch (e) { msg('✗ ' + (e.message || e)); }
    busy = false; render();
  }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadMembers() {
    var rows = allMembers();
    var lines = [['Name', 'Alliance', 'Rank', 'Power', 'MM/CE', 'Joined', 'Last online'].join(',')].concat(rows.map(function (m) {
      return [m.name, m.ally, rankText(m.rank), m.power, m.cls, day(m.join), m.online ? 'now' : day(m.last)].map(csvCell).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    a.download = 'alliance-members-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* Base CP to Alliance Rosters → RawData-CP, in the Base CP tab's format (cp.js cpSheetRows):
     date, submitter ("Data Extractor"), search name, in-game name, alliance, base CP in millions rounded
     (171,460,968 → 171) */
  var SUBMITTER = 'Data Extractor';                     // the submitter column: where the rows came from
  function stamp(at) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (at.getMonth() + 1) + '/' + at.getDate() + '/' + at.getFullYear() + ' ' + p(at.getHours()) + ':' + p(at.getMinutes()) + ':' + p(at.getSeconds());
  }
  // the alliance chosen above (all of them when none is), whatever the other filters
  function cpRows() {
    return allMembers().filter(function (m) { return !V.ally || m.ally === V.ally; });
  }
  async function sendCp() {
    var at = stamp(new Date());
    var rows = cpRows().map(function (m) { return [at, SUBMITTER, searchOf(m.name, m.ally, m.power), m.name, m.ally, Math.round(m.power / 1e6)]; });
    if (!rows.length) return;
    busy = true; render(); msg('Sending ' + rows.length + ' Base CP rows…');
    try {
      var r = await fetch(API + '/game-cp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: rows }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j.error && j.error.message) || j.error || 'the sheet did not accept it (' + r.status + ')');
      msg('✓ ' + Number(j.rows || rows.length).toLocaleString() + ' Base CP rows added to ' + (j.tab || 'RawData-CP') + '.',
          'https://docs.google.com/spreadsheets/d/1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8/edit#gid=237521468');
    } catch (e) { msg('✗ ' + (e.message || e)); }
    busy = false; render();
  }

  /* whitebeard tab */
  function wbChosen() {
    if (!V.wb) return [];
    var allyOrder = function (t) { return t ? (MAIN.indexOf(t) + 1 || 99) : 100; };
    return V.wb.rows.filter(function (r) { return V.wbFilter === 'ALL4' ? MAIN.indexOf(r.ally) >= 0 : MAIN.indexOf(r.ally) < 0; })
      .sort(function (a, b) { return allyOrder(a.ally) - allyOrder(b.ally) || a.ally.localeCompare(b.ally) || a.rank - b.rank; });
  }
  function wbBar() {
    var bar = $('#bar'); bar.textContent = '';
    var r = el('button', 'go', V.wb ? 'Read again' : 'Read Whitebeard ranking'); r.disabled = busy; r.onclick = runWb; bar.appendChild(r);
    if (V.wb) {
      var s = el('select'); var four = V.wb.rows.filter(function (x) { return MAIN.indexOf(x.ally) >= 0; }).length;
      [['ALL4', '698N, W, S, C (' + four + ')'], ['OTHER', 'Other (' + (V.wb.rows.length - four) + ')']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; s.appendChild(op); });
      s.value = V.wbFilter; s.onchange = function () { V.wbFilter = s.value; render(); }; bar.appendChild(s);
      var send = el('button', 'go', 'Send to sheet'); send.disabled = busy; send.onclick = sendWb; bar.appendChild(send);
      bar.appendChild(el('span', 'dim', V.wb.title + ' · ' + V.wb.rows.length + (V.wb.want > 0 ? ' of ' + V.wb.want : '') + ' players'
        + (V.wb.at ? ' · read ' + ago(V.wb.at / 1000) : '')));
    }
  }
  function wbTable() {
    var body = $('#body'); body.textContent = '';
    if (!V.wb) { body.appendChild(el('p', 'dim', 'Tap Read Whitebeard ranking: the game opens the ranking, every page is loaded the way scrolling to the end loads it (about 25 seconds), and the list appears here.')); return; }
    var q = fold($('#q').value);
    var rows = wbChosen().filter(function (r) { return !q || fold(r.name).indexOf(q) >= 0; });
    var t = el('table'), h = el('tr');
    ['#', 'Name', 'Alliance', 'Points', 'Game rank'].forEach(function (c, i) { h.appendChild(el('th', i === 4 ? 'hs' : '', c)); });
    var th = el('thead'); th.appendChild(h); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (r, i) {
      var tr = el('tr'); tr.appendChild(el('td', 'dim', String(i + 1))); tr.appendChild(el('td', '', r.name));
      var a = el('td'); a.appendChild(tagEl(r.ally)); tr.appendChild(a);
      tr.appendChild(el('td', 'n', r.points.toLocaleString())); tr.appendChild(el('td', 'n hs dim', String(r.rank)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); body.appendChild(t);
  }
  async function runWb() {
    if (busy) return; busy = true; render();
    try {
      msg('Opening the Whitebeard ranking…');
      V.wb = await readWhitebeard(function (n, want) { msg('Loading… ' + n + (isFinite(want) ? ' of ' + want : '')); });
      V.wb.at = Date.now();
      if (!isFinite(V.wb.want)) V.wb.want = null;            // unknown total: saved as null, not Infinity
      S.wb = V.wb; save();
      msg(V.wb.rows.length < V.wb.want && isFinite(V.wb.want) ? 'Loaded ' + V.wb.rows.length + ' of ' + V.wb.want + ' — some pages did not arrive; Read again to retry.' : 'Loaded all ' + V.wb.rows.length + ' players.');
    } catch (e) { msg('✗ ' + (e.message || e)); }
    busy = false; render();
  }
  async function sendWb() {
    var rows = wbChosen().map(function (r) { return [r.name.slice(0, 80), r.points, r.ally.slice(0, 20)]; });
    if (!rows.length) return;
    busy = true; render(); msg('Sending…');
    try {
      var r = await fetch(API + '/game-ranking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: rows }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || 'the sheet did not accept it (' + r.status + ')');
      msg('✓ ' + Number(j.rows).toLocaleString() + ' rows added, dated ' + j.date + '.', j.link || SHEET);
    } catch (e) { msg('✗ ' + (e.message || e)); }
    busy = false; render();
  }

  function render() {
    if (V.tab === 'members') { membersBar(); membersTable(); } else { wbBar(); wbTable(); }
    changes();
  }
  render();
  READY.then(render);
})();
