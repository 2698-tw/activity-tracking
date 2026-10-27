/* 2698 Data Extractor (docs/extractor.js): the in-game panel the "2698 Data Extractor" bookmark loads.
 *
 * Runs on the Top War web game (h5.topwargame.com). Two lists:
 *   Alliance members: 698N, 698S, 698W, 698C. Each is opened with the game's own Members call
 *     (UIManager.OpenUI(AllianceMemberPopup, <alliance id>), what the Members button runs), read once
 *     the game has it, and closed again. MM/CE comes from the Alliance Rosters sheet (api/roster-class).
 *   Whitebeard ranking: opened with the event's own Ranking call, every page loaded the way scrolling
 *     to the end loads it, then sent like the Whitebeard bookmark (api/game-ranking).
 * The panel is buttons only. Each alliance read updates the site's Alliance roster card
 * (api/roster-update) and each Whitebeard read the site's Whitebeard card (api/wb-update).
 * Nothing here sends anything to the game: the game makes its own usual requests for what it opens.
 * Reads are kept on this device (localStorage), so Send works after the game is reloaded.
 * UIDs go only to the Worker, to match players between reads; they are never shown or copied.
 */
(function () {
  'use strict';
  // The bookmark hides a panel that is showing without downloading anything. Otherwise this, the
  // copy just downloaded, takes the place of one already on the page, so an update shows up without
  // reloading the game; but a panel in the middle of a read is only shown again, and left alone.
  var oldHost = document.getElementById('x2698');
  if (oldHost && window.__x2698 && window.__x2698.toggle) {
    if (oldHost.style.display !== 'none' || (window.__x2698.busy && window.__x2698.busy())) { oldHost.style.display = ''; return; }
    oldHost.remove();
  }

  var API = 'https://data-collection.jk06nm04.workers.dev/api';
  var SHEET = 'https://docs.google.com/spreadsheets/d/12m3Eh6Xd-LWJ9mFakmEejKNpYYqm2ll-3UCx_TeBxyc/edit#gid=0';
  // alliance ids, from the game's Alliance CP ranking (2026-10-27)
  var ALLY = { '698N': 500245787, '698S': 500245801, '698W': 500246524, '698C': 500247242 };
  var MAIN = ['698N', '698W', '698S', '698C'];
  var STORE = 'x2698.v1';

  // anywhere but the game, open the site in a new tab instead, or here if the browser blocks that (the
  // bookmark itself does this too; this covers bookmarks saved before it did). On the game's own page
  // before the game has loaded, just say so.
  if (!/(^|\.)topwargame\.com$/.test(location.hostname)) {
    var site = 'https://2698-tw.github.io/activity-tracking/';
    if (!window.open(site, '_blank')) location.href = site;
    return;
  }
  if (!window.cc || !window.__require) { alert('2698 Data Extractor: the game has not finished loading yet. Try again in a moment.'); return; }

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
      return { rank: Number(e.rank), uid: String(e.uid || p.uid || ''), name: String(p.username || p.nickname || ''), points: Number(e.score), ally: String(e.allianceTag || '') };
    }).filter(function (r) { return isFinite(r.rank) && isFinite(r.points); }).sort(function (a, b) { return a.rank - b.rank; });
    return { title: title, want: want, rows: rows };
  }

  // the Snow Train's Unit Details: read from the window you have open (it needs the train you chose,
  // so it is not opened from here). The game loads the whole list when the window opens.
  async function readSnowTrain() {
    var panel = null;
    for (var t0 = Date.now(); Date.now() - t0 < 3000; await wait(200)) {
      panel = findComp(function (c) { return /TrainTroopsInfoPanel$/.test(c.__classname__ || '') && Array.isArray(c._infoList); });
      if (panel && panel._infoList.length) break;
    }
    if (!panel) throw new Error('Open a Snow Train\'s Unit Details window first, then tap Read.');
    if (!panel._infoList.length) throw new Error('The Unit Details list is empty.');
    return panel._infoList.map(function (e) {
      var p = parse(e.playerInfo);
      return { uid: String(e.uid || ''), name: String(p.username || p.nickname || ''), ally: String(e.aTag || ''), power: Number(e.power) || 0,
               type: marchType(e.armys) };
    });
  }
  // what a march is, by the units most of its slots hold: the game's unit table types them 101 army,
  // 201 navy, 301 air force (a mech or two of another kind does not change it)
  var UNIT = { 101: 'Army', 201: 'Navy', 301: 'Air Force' };
  function armyTable() {
    var m = req('TableManager'), C = m && (Object.keys(m).map(function (k) { return m[k]; }).filter(function (v) { return v && typeof v.getInst === 'function'; })[0]);
    var map = C && C.getInst()._tableMap, t = map && (map.get ? map.get('army') : map.army);
    return function (id) {
      if (!t) return null;
      var ds = [t, t._data, t.data, t._dataMap, t._map];
      for (var i = 0; i < ds.length; i++) { var d = ds[i]; if (!d) continue; var r = (d.get && d.get(id)) || d[id]; if (r) return r; }
      return null;
    };
  }
  var unitOf = null;
  function marchType(armys) {
    unitOf = unitOf || armyTable();
    var n = {}, best = '', most = 0;
    (armys || []).forEach(function (a) { var r = unitOf(a.armyId), ty = r && UNIT[r.type]; if (ty) n[ty] = (n[ty] || 0) + 1; });
    Object.keys(n).forEach(function (ty) { if (n[ty] > most) { most = n[ty]; best = ty; } });
    return best;
  }

  /* ---------------- saved reads and MM/CE ---------------- */
  var S = (function () { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  S.members = S.members || {}; S.prev = S.prev || {};
  // only the four alliances: a read of another one saved by an earlier version is dropped
  [S.members, S.prev].forEach(function (o) { Object.keys(o).forEach(function (t) { if (!ALLY[t]) delete o[t]; }); });
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ members: S.members, prev: S.prev, wb: S.wb || null, st: S.st || null })); } catch (e) {} }
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
  // Buttons only: what was read goes to the site (the Alliance roster and Whitebeard cards) and the
  // sheets, not into a table here. Each button shows its own progress ring; the pill at the bottom
  // says what is happening.
  var host = document.createElement('div');
  host.id = 'x2698';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  var root = host.attachShadow({ mode: 'open' });
  var RING = '<svg class="ic" viewBox="0 0 24 24"><circle class="trk" cx="12" cy="12" r="9"/><circle class="prg" cx="12" cy="12" r="9"/>' +
    '<path class="plane" d="M3 11.5 20 4l-4.5 16-4-6.5z"/><path class="chk" d="M7.5 12.5l3 3 6-6.5"/><path class="crs" d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>';
  function act(id, cls, title, sub, data) {
    return '<button class="act ' + cls + '" id="' + id + '"' + (data ? ' data-a="' + data + '"' : '') + '><span class="fill"></span>' + RING +
      '<span class="t">' + title + '</span><span class="s">' + sub + '</span></button>';
  }
  root.innerHTML = '<style>' +
    '*{box-sizing:border-box}' +
    '.app{all:initial;display:block;box-sizing:border-box;position:absolute;top:12px;left:50%;transform:translateX(-50%);width:min(440px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;pointer-events:auto;' +
      'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f3f3f7;background:rgba(22,22,30,.97);border-radius:19px;padding:12px 14px 14px;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1)}' +
    '.top{display:flex;align-items:center;gap:10px;margin:-12px -14px 4px;padding:12px 14px 4px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}' +
    '.top.drag{cursor:grabbing}' +
    '.logo{width:28px;height:28px;border-radius:8px;flex:none;object-fit:cover;background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b);-webkit-user-drag:none;pointer-events:none}' +
    '.top b{font-size:15.5px;flex:1}' +
    '.x{border:0;background:rgba(255,255,255,.1);color:#bbb;width:28px;height:28px;border-radius:50%;font-size:16px;cursor:pointer;flex:none}' +
    'h3{margin:12px 2px 7px;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:rgba(235,235,245,.6);font-weight:700}' +
    '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
    '@media (max-width:380px){.grid{grid-template-columns:repeat(2,1fr)}}' +
    '.stack{display:grid;gap:8px;margin-top:8px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}' +
    'select{width:100%;background:rgba(255,255,255,.08);color:inherit;border:0;border-radius:12px;padding:9px 12px;font:inherit}' +
    'select option{color:#111}' +
    '.act{position:relative;overflow:hidden;isolation:isolate;border:0;border-radius:14px;padding:10px 11px;min-height:58px;text-align:left;' +
      'background:rgba(255,255,255,.07);color:inherit;font:inherit;cursor:pointer;transition:transform .15s,background .3s,opacity .3s}' +
    '.act:active{transform:scale(.97)}' +
    '.act.main{background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b)}' +
    '.act .t{display:block;font-weight:800;font-size:15px;position:relative}' +
    '.act .s{display:block;font-size:11.5px;color:rgba(235,235,245,.6);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}' +
    '.act.main .s{color:rgba(255,255,255,.75)}' +
    '.grid .act{padding:10px 9px}' +
    '.grid .act .t{white-space:nowrap;font-size:14.5px;padding-right:16px}' +
    '.grid .act .t::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:2px;background:var(--c)}' +
    '.act[data-a="698N"]{--c:#9ec5ff}.act[data-a="698S"]{--c:#e9a8ff}.act[data-a="698W"]{--c:#7ee2a8}.act[data-a="698C"]{--c:#ffc078}' +
    '.app.locked .act:not(.busy),.app.locked select{opacity:.45;pointer-events:none}' +
    '.ic{position:absolute;right:9px;top:9px;width:22px;height:22px;overflow:visible}' +
    '.grid .ic{width:14px;height:14px;right:7px;top:9px}' +
    '.ic circle{fill:none;stroke-width:2.4}.ic .trk{stroke:rgba(255,255,255,.12)}' +
    '.ic .prg{stroke:#e0457b;stroke-linecap:round;stroke-dasharray:56.55;stroke-dashoffset:56.55;transform:rotate(-90deg);transform-origin:12px 12px;transition:stroke-dashoffset .25s,stroke .3s}' +
    '.act.main .ic .prg{stroke:#fff}' +
    '.ic path{fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:20;stroke-dashoffset:20}' +
    '.ic .chk{stroke:#7ee2a8}.ic .crs{stroke:#ff7a7a}' +
    '.act.done .ic .prg{stroke:#7ee2a8;stroke-dashoffset:0}.act.done .ic .chk{animation:draw .45s .1s ease-out forwards}' +
    '.act.err .ic .prg{stroke:#ff7a7a;stroke-dashoffset:0}.act.err .ic .crs{animation:draw .35s ease-out forwards}' +
    '.act.err{animation:shake .45s}' +
    '@keyframes draw{to{stroke-dashoffset:0}}' +
    '@keyframes shake{20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}' +
    '.act .fill{position:absolute;inset:0;z-index:-1;opacity:0;pointer-events:none}' +
    '.ic .plane{display:none;fill:#fff;stroke:none;stroke-dasharray:none;transform-origin:12px 12px;transition:transform .6s cubic-bezier(.5,-.4,.7,1),opacity .6s}' +
    '.act.send .plane{display:block}.act.send .trk,.act.send .prg{display:none}' +
    '.act.send.busy .plane{animation:bob .7s ease-in-out infinite}' +
    '.act.send.done .plane{transform:translate(26px,-26px) rotate(-10deg) scale(.6);opacity:0}' +
    '.act.send.done .chk{animation-delay:.45s}.act.send.err .plane{opacity:0}' +
    '@keyframes bob{50%{transform:translate(2px,-3px) rotate(-6deg)}}' +
    // the ring: a light runs round the busy button's edge
    '.act.busy .fill{opacity:1;inset:-60%;background:conic-gradient(from 0deg,transparent 0 62%,#e0457b 82%,#fff 88%,transparent 92%);animation:rot 1.1s linear infinite}' +
    '.act.busy::after{content:"";position:absolute;inset:2px;border-radius:12px;background:#1d1e28;z-index:-1}' +
    '.act.main.busy::after{background:linear-gradient(135deg,#5c1325,#9e1035 60%,#b8365f)}' +
    '.act.done{box-shadow:inset 0 0 0 1.5px rgba(126,226,168,.55)}' +
    '@keyframes rot{to{transform:rotate(360deg)}}' +
    '.spark{position:absolute;width:6px;height:6px;border-radius:50%;pointer-events:none;z-index:5;animation:fly .7s ease-out forwards}' +
    '@keyframes fly{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}' +
    // the status pill
    '.status{position:relative;overflow:hidden;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:10px;margin-top:14px;padding:9px 12px;border-radius:14px;' +
      'background:rgba(255,255,255,.06);font-size:13px;min-height:42px;transition:background .3s}' +
    '.status .si{width:18px;height:18px;flex:none;position:relative}' +
    '.status.work::before{content:"";position:absolute;top:0;bottom:0;left:0;width:55%;pointer-events:none;' +
      'background:linear-gradient(90deg,transparent,rgba(224,69,123,.18),transparent);animation:sweep 2.6s ease-in-out infinite}' +
    '@keyframes sweep{from{transform:translateX(-100%)}to{transform:translateX(200%)}}' +
    '.status .si i{display:none}' +
    '.status.idle .si::before{content:"";position:absolute;inset:5px;border-radius:50%;background:rgba(255,255,255,.3)}' +
    '.status.work .si{display:flex;align-items:center;justify-content:center;gap:3px}' +
    '.status.work .si i{display:block;width:4.5px;height:4.5px;border-radius:50%;background:#e0457b;animation:wave 1.1s ease-in-out infinite}' +
    '.status.work .si i:nth-child(2){animation-delay:.15s}.status.work .si i:nth-child(3){animation-delay:.3s}' +
    '@keyframes wave{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}' +
    '.pb{position:absolute;left:0;right:0;bottom:0;height:2.5px;background:rgba(255,255,255,.06);opacity:0;transition:opacity .3s}' +
    '.status.work .pb{opacity:1}' +
    '.pb b{display:block;height:100%;width:0;border-radius:0 2px 2px 0;background:linear-gradient(90deg,#c31441,#e0457b);box-shadow:0 0 8px #e0457b;transition:width .6s cubic-bezier(.4,0,.2,1)}' +
    '.status.ok{background:rgba(126,226,168,.12)}' +
    '.status.ok .si::before,.status.bad .si::before{position:absolute;inset:0;display:grid;place-items:center;border-radius:50%;font-weight:900;font-size:12px;animation:pop .4s cubic-bezier(.3,1.6,.5,1)}' +
    '.status.ok .si::before{content:"✓";background:#7ee2a8;color:#10301f}' +
    '.status.bad{background:rgba(255,122,122,.12)}' +
    '.status.bad .si::before{content:"!";background:#ff7a7a;color:#3a0f0f}' +
    '@keyframes pop{from{transform:scale(0)}}' +
    '.status .tx{flex:1;min-width:0}' +
    '.status .tx small{display:block;color:rgba(235,235,245,.6);font-size:11.5px}' +
    '.status a{color:#9ec5ff}' +
    '.tx-in{animation:txin .35s ease}@keyframes txin{from{opacity:0;transform:translateY(5px)}}' +
    '</style>' +
    '<div class="app"><div class="top" title="Drag to move"><img class="logo" alt="" src="https://2698-tw.github.io/activity-tracking/icon.png"><b>2698 Data Extractor</b><button class="x" id="close" title="Close">×</button></div>' +
    '<h3>Alliance members</h3><div class="grid">' +
      Object.keys(ALLY).map(function (t) { return act('a' + t, '', t, 'not read', t); }).join('') + '</div>' +
    '<div class="stack">' + act('all', 'main', 'Read all four', 'Updates the roster card on the site') +
      act('cp', 'send', 'Send Base CP to sheet', 'Read an alliance first') + '</div>' +
    '<h3>Whitebeard ranking</h3><select id="who"><option value="ALL4">698N, W, S, C</option><option value="OTHER">Other</option></select>' +
    '<div class="row2">' + act('wb', 'main', 'Read', 'Loads every rank') + act('wbs', 'send', 'Send to sheet', 'Read it first') + '</div>' +
    '<h3>Snow Train</h3>' +
    '<div class="row2">' + act('snow', 'main', 'Read', 'Open Unit Details first') + act('snows', 'send', 'Send to sheet', 'Read it first') + '</div>' +
    '<div class="status idle" id="st"><span class="si"></span><span class="tx">Ready. Tap a button to start.</span></div></div>';
  document.body.appendChild(host);
  var $ = function (s) { return root.querySelector(s); };
  var app = $('.app'), st = $('#st');
  var busy = false;
  var V = { wbFilter: 'ALL4', wb: S.wb || null };   // the last Whitebeard read, kept like the member lists

  // closing only hides the panel: a read that is running carries on, and the bookmark brings it back
  $('#close').onclick = function () { host.style.display = 'none'; };

  // the header moves the panel; where it was left is remembered on this device
  var POS = 'x2698.pos';
  function place(x, y) {
    var w = app.offsetWidth, h = app.offsetHeight;
    x = Math.max(4, Math.min(innerWidth - w - 4, x)); y = Math.max(4, Math.min(innerHeight - Math.min(h, 60) - 4, y));
    app.style.left = x + 'px'; app.style.top = y + 'px'; app.style.transform = 'none';
    app.style.maxHeight = (innerHeight - y - 8) + 'px';         // scrolls inside rather than running off the bottom
    return [x, y];
  }
  try { var saved = JSON.parse(localStorage.getItem(POS)); if (saved) place(saved[0], saved[1]); } catch (e) {}
  (function () {
    var top = $('.top'), from = null;
    top.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || e.button > 0) return;
      var r = app.getBoundingClientRect();
      from = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      top.setPointerCapture(e.pointerId); top.classList.add('drag'); e.preventDefault();
    });
    top.addEventListener('pointermove', function (e) { if (from) place(e.clientX - from.dx, e.clientY - from.dy); });
    function drop(e) {
      if (!from) return; from = null; top.classList.remove('drag');
      var r = app.getBoundingClientRect();
      try { localStorage.setItem(POS, JSON.stringify([Math.round(r.left), Math.round(r.top)])); } catch (x) {}
    }
    top.addEventListener('pointerup', drop); top.addEventListener('pointercancel', drop);
    // keep it on screen when the window gets smaller
    addEventListener('resize', function () { if (app.style.transform === 'none') place(parseFloat(app.style.left), parseFloat(app.style.top)); });
  })();
  window.__x2698 = { toggle: function () { host.style.display = host.style.display === 'none' ? '' : 'none'; }, busy: function () { return busy; } };
  $('#who').onchange = function () { V.wbFilter = $('#who').value; refresh(); };

  var ago = function (ts) {
    if (!ts) return '—'; var m = (Date.now() / 1000 - ts) / 60;
    return m < 5 ? 'now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  var agoShort = function (ts) {
    var m = (Date.now() / 1000 - ts) / 60;
    return m < 5 ? 'now' : m < 60 ? Math.round(m) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* the buttons' looks */
  function setP(b, p) { b.querySelector('.prg').style.strokeDashoffset = 56.55 * (1 - p); }
  function sub(b, text) { b.querySelector('.s').textContent = text; }
  function start(b) { b.classList.remove('done', 'err'); b.classList.add('busy'); setP(b, 0); }
  function finish(b, ok) {
    b.classList.remove('busy'); void b.offsetWidth; b.classList.add(ok ? 'done' : 'err');
    if (ok) burst(b);
  }
  function lock(on) { busy = on; app.classList.toggle('locked', on); }
  function burst(b) {
    var r = b.getBoundingClientRect(), f = app.getBoundingClientRect();
    var cx = r.right - f.left + app.scrollLeft - 18, cy = r.top - f.top + app.scrollTop + 18;
    var colors = ['#7ee2a8', '#e0457b', '#ffc078', '#9ec5ff', '#fff'];
    for (var i = 0; i < 14; i++) {
      var s = document.createElement('span'), a = Math.random() * Math.PI * 2, d = 22 + Math.random() * 34;
      s.className = 'spark';
      s.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;background:' + colors[i % 5] + ';--dx:' + Math.cos(a) * d + 'px;--dy:' + Math.sin(a) * d + 'px';
      app.appendChild(s); setTimeout(s.remove.bind(s), 800);
    }
  }
  // the pill is built once per state; while working only its text and bar change, and the text
  // fades in only when the step changes (not on every count)
  function status(kind, html, p) {
    if (kind !== 'work' || st.dataset.kind !== 'work') {
      st.className = 'status ' + kind; st.dataset.kind = kind; st.dataset.key = '';
      st.innerHTML = '<span class="si"><i></i><i></i><i></i></span><span class="tx"></span><span class="pb"><b></b></span>';
    }
    var tx = st.querySelector('.tx'), key = html.replace(/<b>\d+<\/b>|\d+ of \d+ · /g, '#');
    tx.innerHTML = html;
    if (key !== st.dataset.key) { st.dataset.key = key; tx.classList.remove('tx-in'); void tx.offsetWidth; tx.classList.add('tx-in'); }
    if (p != null) st.querySelector('.pb b').style.width = (p * 100).toFixed(1) + '%';
  }
  function nudge(b, html) { b.classList.remove('err'); void b.offsetWidth; b.classList.add('err'); setTimeout(function () { b.classList.remove('err'); }, 600); status('bad', html); }
  // what each button says when nothing is running: the last read of each list, kept on this device
  function refresh() {
    Object.keys(ALLY).forEach(function (t) {
      var b = $('#a' + t), have = S.members[t];
      if (!b.classList.contains('busy') && !b.classList.contains('err')) sub(b, have ? have.list.length + ' · ' + agoShort(have.at / 1000) : 'not read');
    });
    var n = cpRows().length, cp = $('#cp');
    if (!cp.classList.contains('done') && !cp.classList.contains('busy')) sub(cp, n ? n + ' players ready' : 'Read an alliance first');
    var wb = $('#wb'), wbs = $('#wbs');
    if (!wb.classList.contains('busy') && !wb.classList.contains('err')) sub(wb, V.wb ? V.wb.rows.length + ' players · ' + ago(V.wb.at / 1000) : 'Loads every rank');
    if (!wbs.classList.contains('busy')) { wbs.classList.remove('done'); sub(wbs, V.wb ? wbChosen().length + ' players ready' : 'Read it first'); }
    var stb = $('#snow'), sts = $('#snows');
    if (!stb.classList.contains('busy') && !stb.classList.contains('err')) sub(stb, S.st ? S.st.rows.length + ' players · ' + ago(S.st.at / 1000) : 'Open Unit Details first');
    if (!sts.classList.contains('busy') && !sts.classList.contains('done')) sub(sts, S.st ? S.st.rows.length + ' players ready' : 'Read it first');
  }

  /* reading alliances */
  async function run(tags, all) {
    if (busy) return; lock(true);
    var notes = [], total = 0;
    if (all) start(all);
    try {
      for (var i = 0; i < tags.length; i++) {
        var t = tags[i], b = $('#a' + t), pre = tags.length > 1 ? (i + 1) + ' of ' + tags.length + ' · ' : '';
        var at = function (p) { return (i + p) / tags.length; };
        start(b); sub(b, 'opening…');
        if (all) sub(all, (i + 1) + ' of ' + tags.length + ' · ' + t);
        status('work', pre + 'Opening the ' + t + ' member list…', at(.05));
        // the list arrives in one go, so the ring creeps while the game fetches it
        var p = .05, creep = setInterval(function () { p = Math.min(.6, p + .04); setP(b, p); if (all) setP(all, at(p)); }, 200);
        var list;
        try { list = await readAlliance(t); }
        catch (e) { clearInterval(creep); finish(b, false); sub(b, 'tap to try again'); throw e; }
        clearInterval(creep);
        if (S.members[t]) S.prev[t] = S.members[t];
        S.members[t] = { at: Date.now(), list: list };
        save();
        setP(b, .7); sub(b, 'matching…'); if (all) setP(all, at(.7));
        status('work', pre + t + ': <b>' + list.length + '</b> members · matching MM/CE…', at(.7));
        await READY;
        setP(b, .85); sub(b, 'saving…'); if (all) setP(all, at(.85));
        status('work', pre + 'Updating the roster card…', at(.85));
        try { var u = await pushRoster(t, list); notes.push(t + ': ' + u.added + ' new, ' + u.left + ' left' + (u.rejoined ? ', ' + u.rejoined + ' back' : '')); }
        catch (e) { notes.push(t + ': card not updated (' + (e.message || e) + ')'); }
        setP(b, 1); finish(b, true); sub(b, list.length + ' · now'); total += list.length;
        if (all) setP(all, at(1));
        status('work', pre + t + ' done', at(1));
        if (i < tags.length - 1) await wait(between(1200, 2600));   // a person's pause between alliances
      }
      if (all) { finish(all, true); sub(all, 'All four read · now'); }
      status('ok', (tags.length > 1 ? 'All four alliances read · ' + total + ' members' : tags[0] + ': ' + total + ' members read') +
        '<small>Roster card: ' + esc(notes.join(' · ')) + (CLASS && CLASS.failed ? ' · MM/CE: roster unavailable' : '') + '</small>');
    } catch (e) {
      if (all) { finish(all, false); sub(all, 'Stopped · tap to try again'); }
      status('bad', 'The read didn\'t finish<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  }
  Object.keys(ALLY).forEach(function (t) { $('#a' + t).onclick = function () { run([t]); }; });
  $('#all').onclick = function () { run(Object.keys(ALLY), $('#all')); };

  /* Base CP to Alliance Rosters → RawData-CP, in the Base CP tab's format (cp.js cpSheetRows):
     date, submitter ("Data Extractor"), search name, in-game name, alliance, base CP in millions rounded
     (171,460,968 → 171) */
  var SUBMITTER = 'Data Extractor';                     // the submitter column: where the rows came from
  function stamp(at) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (at.getMonth() + 1) + '/' + at.getDate() + '/' + at.getFullYear() + ' ' + p(at.getHours()) + ':' + p(at.getMinutes()) + ':' + p(at.getSeconds());
  }
  // every alliance read, the last read of each
  function cpRows() {
    var out = [];
    Object.keys(S.members).forEach(function (tag) { (S.members[tag].list || []).forEach(function (m) { out.push({ name: m.name, ally: tag, power: m.power }); }); });
    return out;
  }
  // a send: the plane bobs while it goes, flies off when the sheet has it
  async function sendTo(b, path, body, what) {
    lock(true); start(b); sub(b, 'sending…');
    var p = .05, creep = setInterval(function () { p = Math.min(.9, p + .06); status('work', 'Sending ' + what + '…', p); }, 200);
    status('work', 'Sending ' + what + '…', p);
    try {
      var r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j.error && j.error.message) || j.error || 'the sheet did not accept it (' + r.status + ')');
      clearInterval(creep); status('work', 'Sending ' + what + '…', 1);
      finish(b, true); return j;
    } catch (e) {
      clearInterval(creep); finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Couldn\'t send ' + what + '<small>' + esc(e.message || e) + '. Nothing was written.</small>');
      return null;
    } finally { lock(false); }
  }
  $('#cp').onclick = async function () {
    if (busy) return;
    var b = $('#cp'), at = stamp(new Date());
    var rows = cpRows().map(function (m) { return [at, SUBMITTER, searchOf(m.name, m.ally, m.power), m.name, m.ally, Math.round(m.power / 1e6)]; });
    if (!rows.length) return nudge(b, 'Nothing to send yet<small>Read an alliance first.</small>');
    await READY;
    var j = await sendTo(b, '/game-cp', { rows: rows }, rows.length + ' Base CP rows');
    if (!j) return;
    var n = Number(j.rows || rows.length);
    sub(b, 'Sent ' + n + ' rows · now');
    status('ok', 'Base CP sent<small>' + n.toLocaleString() + ' rows added to ' + esc(j.tab || 'RawData-CP') +
      ' · <a href="https://docs.google.com/spreadsheets/d/1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8/edit#gid=237521468" target="_blank" rel="noopener">Open in Sheets ↗</a></small>');
  };

  /* Whitebeard */
  function wbChosen() {
    if (!V.wb) return [];
    var allyOrder = function (t) { return t ? (MAIN.indexOf(t) + 1 || 99) : 100; };
    return V.wb.rows.filter(function (r) { return V.wbFilter === 'ALL4' ? MAIN.indexOf(r.ally) >= 0 : MAIN.indexOf(r.ally) < 0; })
      .sort(function (a, b) { return allyOrder(a.ally) - allyOrder(b.ally) || a.ally.localeCompare(b.ally) || a.rank - b.rank; });
  }
  function postJson(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  // every player read goes to the site's Whitebeard card, under today's UTC date (api/wb-update)
  function pushWb(rows) {
    var body = rows.map(function (r) { return { uid: r.uid, name: r.name, ally: r.ally, points: r.points }; });
    return fetch(API + '/wb-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: body }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  $('#wb').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#wb'); start(b); sub(b, 'opening…');
    status('work', 'Opening the Whitebeard ranking…', .04);
    try {
      var read = await readWhitebeard(function (n, want) {
        var f = isFinite(want) && want ? Math.min(1, n / want) : .5;
        setP(b, .06 + .8 * f); sub(b, n + (isFinite(want) ? ' / ' + want : ''));
        status('work', 'Loading every rank… <b>' + n + '</b>' + (isFinite(want) ? ' of ' + want : ''), .06 + .8 * f);
      });
      read.at = Date.now();
      if (!isFinite(read.want)) read.want = null;            // unknown total: saved as null, not Infinity
      V.wb = read; S.wb = read; save();
      setP(b, .9); sub(b, 'saving…');
      status('work', 'Updating the Whitebeard card…', .92);
      var card;
      try { var u = await pushWb(read.rows); card = (u.replaced ? 'Card: today\'s column updated' : 'Card: new column added') + ' (' + u.day + ' UTC)'; }
      catch (e) { card = 'Card not updated (' + esc(e.message || e) + ')'; }
      setP(b, 1); finish(b, true); sub(b, read.rows.length + ' players · now');
      var short = read.want && read.rows.length < read.want;
      status('ok', (short ? 'Loaded ' + read.rows.length + ' of ' + read.want + ' — some pages did not arrive' : 'Whitebeard ranking read · ' + read.rows.length + ' players') + '<small>' + card + '</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'The ranking didn\'t finish<small>' + esc(e.message || e) + (V.wb ? ' The last saved read is kept.' : '') + '</small>');
    }
    lock(false); refresh();
  };
  $('#wbs').onclick = async function () {
    if (busy) return;
    var b = $('#wbs'), rows = wbChosen().map(function (r) { return [r.name.slice(0, 80), r.points, r.ally.slice(0, 20)]; });
    if (!V.wb) return nudge(b, 'Nothing to send yet<small>Read the Whitebeard ranking first.</small>');
    if (!rows.length) return nudge(b, 'Nobody to send<small>No player in this read matches ' + (V.wbFilter === 'ALL4' ? '698N, W, S, C' : 'Other') + '.</small>');
    var j = await sendTo(b, '/game-ranking', { rows: rows }, rows.length + ' Whitebeard rows');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Whitebeard ranking sent<small>' + Number(j.rows).toLocaleString() + ' rows added, dated ' + esc(j.date) +
      ' · <a href="' + esc(j.link || SHEET) + '" target="_blank" rel="noopener">Open in Sheets ↗</a></small>');
  };

  /* Snow Train: the open Unit Details window to SS P2 Snow Train (api/game-snowtrain), as Date, Name,
     March CP, Unit Type, Alliance; the four alliances first, then everyone else */
  $('#snow').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#snow'); start(b); sub(b, 'reading…');
    status('work', 'Reading the Unit Details…', .3); setP(b, .3);
    try {
      var rows = await readSnowTrain();
      S.st = { at: Date.now(), rows: rows }; save(); $('#snows').classList.remove('done');
      setP(b, .6); sub(b, 'saving…');
      status('work', 'Updating the Snow Train card…', .7);
      // every player read goes to the site's Snow Train card, under today's UTC date (api/st-update)
      var card;
      try {
        var u = await postJson('/st-update', { rows: rows.map(function (r) { return { uid: r.uid, name: r.name, ally: r.ally, points: r.power, type: r.type }; }) });
        card = (u.merged ? 'Card: added to today\'s column' : 'Card: new column added') + ' (' + u.day + ' UTC)';
      } catch (e) { card = 'Card not updated (' + esc(e.message || e) + ')'; }
      setP(b, 1); finish(b, true); sub(b, rows.length + ' players · now');
      status('ok', 'Snow Train read · ' + rows.length + ' players<small>' + card + ' · tap Send to sheet for SS P2 Snow Train.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Nothing read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };
  $('#snows').onclick = async function () {
    if (busy) return;
    var b = $('#snows');
    if (!S.st) return nudge(b, 'Nothing to send yet<small>Open a Snow Train\'s Unit Details and tap Read first.</small>');
    var order = function (t) { return MAIN.indexOf(t) >= 0 ? MAIN.indexOf(t) : 99; };
    var rows = S.st.rows.slice().sort(function (a, c) { return order(a.ally) - order(c.ally) || a.ally.localeCompare(c.ally) || c.power - a.power; })
      .map(function (r) { return [r.name.slice(0, 80), Math.round(r.power / 1e6) + 'M', r.ally.slice(0, 20), r.type || '']; });   // 256,158,825 → 256M
    var j = await sendTo(b, '/game-snowtrain', { rows: rows }, rows.length + ' Snow Train rows');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Snow Train sent<small>' + Number(j.rows).toLocaleString() + ' rows added, dated ' + esc(j.date) +
      ' · <a href="' + esc(j.link) + '" target="_blank" rel="noopener">Open in Sheets ↗</a></small>');
  };

  refresh();
  READY.then(refresh);
})();
