/* 2698 Data Extractor (docs/extractor.js): the in-game panel the "2698 Data Extractor" bookmark loads.
 *
 * Runs on the Top War web game (h5.topwargame.com). Two lists:
 *   Alliance members: 698N, 698S, 698W, 698C. Each is opened with the game's own Members call
 *     (UIManager.OpenUI(AllianceMemberPopup, <alliance id>), what the Members button runs), read once
 *     the game has it, and closed again. MM/CE comes from the Alliance Rosters sheet (api/roster-class).
 *   Whitebeard ranking: opened with the event's own Ranking call, every page loaded the way scrolling
 *     to the end loads it, then sent like the Whitebeard bookmark (api/game-ranking).
 *   Snow Train: the Snow Train screen opened as its building opens it, then its own Our Defence button;
 *     sent to SS P2 Snow Train (api/game-snowtrain).
 *   Energy Tower: its Unit Details, opened as the tower's own Unit Details button opens them; the
 *     site's Energy Tower card (api/et-update) and its sheet (api/game-energytower). Its Rankings,
 *     opened as the event's Rankings button opens them, give each player's points for the card's
 *     date columns (api/et-points).
 *   Mammoth Assault: its View Queues, opened with the Mammoth Assault screen's own View Queues button;
 *     the site's Mammoth Assault card (api/ma-update) and its sheet (api/ma-send).
 *   Neutral City: its Points Log, opened with the Neutral City tab's own Record button, every battle date's
 *     every page, for all and for each city fought in (its city picker); and the round's cities. For the site's Neutral City page (api/nc-read);
 *     Send puts the latest battle's players in SS P2 Neutral City (api/nc-send).
 *   Fame: the Neutral City Treasury's Member List (Distribute Rewards → Select one) sorted by Fame (last round), every
 *     page, straight to the Fame sheet (api/fame-send). Nothing is picked or distributed.
 * The panel is buttons only. Each alliance read updates the site's Alliance roster card
 * (api/roster-update) and each Whitebeard read the site's Whitebeard card (api/wb-update).
 * Nothing here sends anything to the game: the game makes its own usual requests for what it opens.
 * Reads are kept on this device (localStorage), so Send works after the game is reloaded.
 * UIDs go only to the Worker, to match players between reads; they are never shown or copied.
 */
(function () {
  'use strict';
  // GitHub Pages' cache keeps the old copy of this file for up to ten minutes after an update, whatever
  // the bookmark's ?_= says; the Worker serves the same file (wrangler.toml, [assets]) uncached. So a
  // copy the bookmark loaded from Pages loads the Worker's instead, and runs itself only if that fails.
  var me = (document.currentScript && document.currentScript.src) || '', viaPages = window.__x2698pages;
  window.__x2698pages = 0;
  if (/\.github\.io\//.test(me) && !viaPages) {
    var w = document.createElement('script');
    w.src = 'https://data-collection.jk06nm04.workers.dev/extractor.js?_=' + Date.now();
    w.onerror = function () { window.__x2698pages = 1; var p = document.createElement('script'); p.src = me; document.body.appendChild(p); };
    document.body.appendChild(w);
    return;
  }

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
    // always Defeat Ranking → Warzone Ranking: the window keeps the tab it was last left on, and one
    // already open is read as it is. The tab is tapped the way a finger does (its own handler loads it).
    if (owner.toggleBaseNode && owner.toggleBaseNode.active) {
      var tap = async function (t) {
        await wait(between(300, 700)); t.check();
        for (var t2 = Date.now(); Date.now() - t2 < 10000; await wait(150)) if (owner._rankList.length) break;
        await wait(300);
      };
      if (owner._pageType !== 0 && owner.toggleList[0]) await tap(owner.toggleList[0]);
      if (owner._pageSubType !== 2 && owner.toggleSubList[2]) await tap(owner.toggleSubList[2]);
      if (owner._pageType !== 0 || owner._pageSubType !== 2) throw new Error('could not switch the ranking to Defeat Ranking → Warzone Ranking');
    }
    var list = owner._rankList, scroller = owner.node.getComponentInChildren(cc.ScrollView);
    var L = labels(), m = L.map(function (l) { return l[1].match(/^([\d,]+)\s+Commanders/); }).filter(Boolean)[0];
    var want = m ? Number(m[1].replace(/,/g, '')) : Infinity;
    var title = 'Whitebeard ranking';
    // the rest of the list, a page at a time: glide to the end and say it got there, as a finger
    // scroll does; the game asks for its next page itself. Uneven, like a quick flick through.
    // The list is done when the game's request for a page comes back with nothing new (the ranking has
    // no count on screen any more): the game's network keeps each request it is waiting on.
    var net = req('NetMgr'), ids = req('NRequestIdV2');
    net = net && (net.default || net).NET;
    var rid = ids && ids.NRequestIdV2 && ids.NRequestIdV2.SERIES_FROST_MONSTER_CLEANUP_RANK;
    var pending = net && net.findRequest && rid != null ? function () { return !!net.findRequest(function (a) { return a && a.pack && a.pack.c === rid; }); } : null;
    for (var stuck = 0; scroller && list.length < want && stuck < (pending ? 1 : 2);) {
      var n0 = list.length, glide = between(0.2, 0.45), saw = false;
      scroller.scrollToBottom(glide);
      await wait(glide * 1000 + 50);
      scroller.node.emit('scroll-to-bottom', scroller);
      for (var t1 = Date.now(); list.length === n0 && Date.now() - t1 < 6000; await wait(100)) {
        if (!pending) continue;
        var p1 = pending(); saw = saw || p1;
        if ((saw && !p1) || (!saw && Date.now() - t1 > 1500)) break;      // answered with nothing new, or never asked
      }
      stuck = list.length === n0 ? stuck + 1 : 0;
      progress(list.length, want);
      await wait(Math.random() < 0.12 ? between(1000, 2000) : between(250, 900));
    }
    // only this warzone's players, in case a World or Sector list is showing after all: those are mostly
    // other warzones. A few are expected here: a player who moved away keeps the score earned in this one.
    var dc = req('DataCenter'), me = dc && dc.DATA && dc.DATA.UserData, sid = me && me.OriginServerId;
    var away = sid == null ? 0 : list.filter(function (e) { return e.sid != null && Number(e.sid) !== Number(sid); }).length;
    if (away > list.length * 0.1)
      throw new Error('the ranking shows other warzones too — pick Warzone Ranking in the window and tap Read again');
    var rows = list.map(function (e) {
      var p = parse(e.playerInfo);
      return { rank: Number(e.rank), uid: String(e.uid || p.uid || ''), name: String(p.username || p.nickname || ''), points: Number(e.score), ally: String(e.allianceTag || '') };
    }).filter(function (r) { return isFinite(r.rank) && isFinite(r.points); }).sort(function (a, b) { return a.rank - b.rank; });
    return { title: title, want: want, rows: rows };
  }

  // the Snow Train's Unit Details, as the Snow Train building opens them: the Snow Train screen
  // (OpenUI(CQ26TransportMainPanel), what tapping the building runs), then its own Our Defence button
  // (the current train, or the last one), read, and both closed again. A Unit Details window already
  // open is read as it is and left open. The game loads the whole list when the window opens.
  var troopsPanel = function () { return findComp(function (c) { return /TrainTroopsInfoPanel$/.test(c.__classname__ || '') && Array.isArray(c._infoList); }); };
  var trainScreen = function () { return findComp(function (c) { return c.__classname__ === 'CQ26TransportMainContent'; }); };
  async function readSnowTrain(step) {
    var panel = troopsPanel(), opened = [];
    if (!panel || !panel._infoList.length) {
      var U = ui(), WS = win('CQ26TransportMainPanel'), WT = win('CQ26TrainTroopsInfoPanel');
      if (!U || !WS || !WT) throw new Error('no Snow Train in the game right now');
      var screen = trainScreen();
      if (!screen) { step('Opening the Snow Train…', .1); U.OpenUI(WS); opened.push(WS); }
      for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) {
        screen = trainScreen();
        if (screen && screen._data && (screen._data.curTrain || screen._data.lastTrain)) break;
        screen = null;
      }
      if (!screen) { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); throw new Error('the Snow Train did not load — is the event running?'); }
      await wait(between(400, 900));                     // a person's pause before tapping Our Defence
      step('Opening Our Defence…', .3);
      screen.onClickOurDefence(); opened.unshift(WT);
      for (var t1 = Date.now(); Date.now() - t1 < 12000; await wait(200)) { panel = troopsPanel(); if (panel && panel._infoList.length) break; panel = null; }
      await wait(400);                                   // let a late page of the list arrive, if any
    }
    var close = function () { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); };
    if (!panel) { close(); throw new Error('the Unit Details did not load'); }
    var list = panel._infoList.slice();
    close();
    return list.map(function (e) {
      var p = parse(e.playerInfo);
      return { uid: String(e.uid || ''), name: String(p.username || p.nickname || ''), ally: String(e.aTag || ''), power: Number(e.power) || 0,
               type: marchType(e.armys) };
    });
  }
  // the Energy Tower's Unit Details: OpenUI(CQ26ArkWorldTroopPanel), what the tower's Unit Details
  // button runs (the window loads this warzone's players for the event the game has open), read, and
  // closed again. A Unit Details window already open is read as it is and left open. The game gives no
  // alliance here; the Worker fills it in from the roster card.
  var towerPanel = function () { return findComp(function (c) { return c.__classname__ === 'CQ26ArkWorldTroopPanel' && Array.isArray(c._infoList); }); };
  async function readEnergyTower(step) {
    var panel = towerPanel(), opened = [], U = ui();
    if (!panel || !panel._infoList.length) {
      var WT = win('CQ26ArkWorldTroopPanel'), m = req('CQ26Controller'), C = m && m.CQ26Controller && m.CQ26Controller.getInstance();
      if (!U || !WT || !C || !C.arkData || C.arkData.cid == null) throw new Error('no Energy Tower in the game right now — open the event once, then try again');
      if (!panel) { step('Opening the Unit Details…', .15); U.OpenUI(WT); opened.push(WT); }
      for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) { panel = towerPanel(); if (panel && panel._infoList.length) break; panel = null; }
      await wait(400);                                   // let a late page of the list arrive, if any
    }
    var close = function () { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); };
    if (!panel) { close(); throw new Error('the Unit Details did not load, or no one has joined the tower yet'); }
    var list = panel._infoList.slice();
    close();
    return list.map(function (e) {
      var p = parse(e.playerInfo);
      return { uid: String(e.uid || ''), name: String(p.username || p.nickname || ''), ally: String(e.aTag || ''), power: Number(e.power) || 0 };
    });
  }

  // the Mammoth Assault's View Queues: the Energy Building opened on its Mammoth Assault tab
  // (OpenUI(CQ26TowerUnionPanel, 1), as the event's card opens it), or that tab tapped if the building
  // is open on another one, then the screen's own View Queues button (onClickLookTroop, which opens
  // CQ26DBTroopsInfoPanel), read, and what was opened closed again. A View Queues window already open
  // is read as it is and left open. One march per player; the game gives no alliance
  // here, so the Worker fills it in from the roster card, as for the Energy Tower.
  var queuesPanel = function () { return findComp(function (c) { return c.__classname__ === 'CQ26DBTroopsInfoPanel' && Array.isArray(c._marchArray); }); };
  var mammothScreen = function () { return findComp(function (c) { return c.__classname__ === 'CQ26DBMainComponent'; }); };
  var energyBuilding = function () { return findComp(function (c) { return c.__classname__ === 'CQ26TowerUnionPanel' && Array.isArray(c.toggleList); }); };
  var longText = function (v) {                          // the game's 64-bit numbers ({_low, _high} or {low, high})
    if (v == null) return '';
    if (typeof v !== 'object') return String(v);
    var lo = '_low' in v ? v._low : v.low, hi = '_high' in v ? v._high : v.high;
    return lo == null ? String(v) : String(hi * 4294967296 + (lo >>> 0));
  };
  async function readMammoth(step) {
    var panel = queuesPanel(), opened = [], U = ui();
    if (!panel || !panel._marchArray.length) {
      var screen = mammothScreen(), WQ = win('CQ26DBTroopsInfoPanel'), WB = win('CQ26TowerUnionPanel');
      if (!U || !WQ || !WB) throw new Error('no Mammoth Assault in the game right now');
      if (!screen) {
        var bld = energyBuilding();
        step('Opening Mammoth Assault…', .08);
        if (!bld) { U.OpenUI(WB, 1); opened.push(WB); }
        else { var tg = bld.toggleList[1]; if (tg && tg.check) tg.check(); else bld.onClickToggle(null, '1'); }
        for (var t2 = Date.now(); Date.now() - t2 < 12000; await wait(200)) { screen = mammothScreen(); if (screen && screen._serInfo) break; screen = null; }
        if (!screen) { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); throw new Error('Mammoth Assault did not load — is the event running?'); }
      }
      if (!panel) {
        await wait(between(300, 700));                   // a person's pause before tapping View Queues
        step('Opening View Queues…', .15); screen.onClickLookTroop(); opened.unshift(WQ);
      }
      for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) { panel = queuesPanel(); if (panel && panel._marchArray.length) break; panel = null; }
      await wait(400);                                   // let a late page of the list arrive, if any
    }
    var close = function () { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); };
    if (!panel) { close(); throw new Error('View Queues did not load, or no one is in the garrison yet'); }
    var list = panel._marchArray.slice();
    close();
    return list.map(function (e) {
      var p = parse(e.playerInfo), tv = e.troopView || {};
      return { uid: longText(e.uid), name: String(p.username || p.nickname || ''), ally: '', power: Number(longText(tv.battlePower)) || 0 };
    }).filter(function (r) { return r.name || r.uid; });
  }

  // The season's events for the site's home page: each section's own stage times, from the season
  // state the game already holds and the Energy Building's three event tabs (opened, read and closed
  // again like Read garrison). Only the current round's are known to the game; the site shifts them
  // to the later rounds. Neutral City, Monster Feast, Realm, Storm Duel, Desolate Tundra and Whitebeard
  // show only a countdown in their sections, so theirs come from the season's own timetable, every round.
  var timeNode = function () { return findComp(function (c) { return c.__classname__ === 'CQ26TowerTimeNode' && Array.isArray(c._data) && c._data.length; }); };
  var secs = function (v) { var n = Number(longText(v)); return n > 1e11 ? Math.round(n / 1000) : n; };
  async function readEvents(step) {
    var m = req('CQ26Controller'), C = m && m.CQ26Controller && m.CQ26Controller.getInstance();
    var cfg = C && C.activityCfg, now = Date.now() / 1000;
    if (!cfg || !C.status || !(cfg.roundCfg || []).length) throw new Error('no Seal Stone season in the game right now');
    var T = (req('TableManager') || {}).TABLE, TN = (req('TableName') || {}).TableName, L = (req('LocalManager') || {}).LOCAL;
    if (!T || !TN || !L) throw new Error('the game has changed: no timetable found');
    var rounds = cfg.roundCfg.map(function (r) { return { round: r.round, st: r.roundBeginSec, et: r.roundEndSec }; });
    var cur = rounds.filter(function (r) { return r.round === C.status.round; })[0]
      || rounds.filter(function (r) { return r.st <= now && now < r.et; })[0] || rounds[0];
    var events = [];
    var add = function (id, round, stages) {
      stages = stages.filter(function (s) { return s[1] > 1.7e9 && s[2] >= s[1]; });
      if (stages.length) events.push({ id: id, round: round, stages: stages });
    };
    // the timetable: minutes from the season's start, by the type of each row
    rounds.forEach(function (r) {
      var rows = T.getTableByKeyFromBuffer(TN.series_frost_calendar_time, 'group', cfg.cfg.timeGroup, 'round_id', r.round) || [];
      var at = {}; rows.forEach(function (x) { at[x.type] = [cfg.cfg.roundBeginSec + x.beginTime * 60, cfg.cfg.roundBeginSec + x.endTime * 60]; });
      var st = function (name, ty) { return at[ty] ? [name, at[ty][0], at[ty][1]] : null; };
      var pick = function (a) { return a.filter(Boolean); };
      add('wb', r.round, pick([st('Open', 1)]));
      add('tundra', r.round, pick([st('Expansion', 11)]));
      add('feast', r.round, pick([st('Preparation', 37), st('Feast', 14)]));
      add('nc', r.round, pick([st('Declaration', 17), st('Publicity', 18), st('Battle', 19)]));
      add('realm', r.round, pick([st('Preparation', 20), st('Team-Up', 21), st('Battle', 22), st('Round settlement', 24)]));
      add('storm', r.round, pick([st('Matchmaking', 26), st('Publicity', 27), st('Selection', 28), st('Trial matchmaking', 29),
        st('Trial publicity', 30), st('Zone selection', 31), st('Preparation', 32), st('Battle', 33)]));
      // the Frost Crystal Contest: the timetable's block, its battle from the section when it is this round's
      if (at[12]) {
        var wl = C.wlBattleData && C.wlBattleData.status, fight = at[12][1] - 3600;
        if (r === cur && wl && secs(wl.timeFightStart) > at[12][0]) fight = secs(wl.timeFightStart);
        add('frost', r.round, [['Preview', r.st, at[12][0]], ['Ready', at[12][0], fight], ['Battle', fight, at[12][1]]]);
      }
    });
    // the Blizzard: once a season
    var bz = C.info && C.info.temperatureInfo && secs(C.info.temperatureInfo.blizzardBeginSec);
    if (bz) add('blizzard', 0, [['Starts', bz, bz]]);
    // the Energy Building's tabs: 1 Mammoth Assault, 2 Snow Train, 3 Defend Energy
    var U = ui(), WB = win('CQ26TowerUnionPanel'), opened = false, bld = energyBuilding();
    if (U && WB) {
      try {
        if (!bld) { step('Opening the Energy Building…', .15); U.OpenUI(WB, 1); opened = true; }
        for (var t0 = Date.now(); Date.now() - t0 < 12000 && !(bld = energyBuilding()); await wait(200));
        if (!bld) throw new Error('the Energy Building did not open');
        var tab = async function (i) {
          var tg = bld.toggleList[i]; if (tg && tg.check) tg.check(); else bld.onClickToggle(null, String(i));
          await wait(between(500, 900));
        };
        await tab(1); step('Reading Mammoth Assault…', .3);
        var ma = null;
        for (var t1 = Date.now(); Date.now() - t1 < 8000; await wait(200)) { var s1 = mammothScreen(); ma = s1 && s1._serInfo && s1._serInfo.thisTurnInfo; if (ma) break; }
        if (ma) add('ma', cur.round, [['Preparation', secs(ma.timeTurnStart), secs(ma.timeStrikeStart)], ['Assault', secs(ma.timeStrikeStart), secs(ma.timeTurnEnd)]]);
        var used = [];                                 // each tab has its own stage bar
        var stages = async function (i, id, label) {
          await tab(i); step('Reading ' + label + '…', i === 2 ? .5 : .7);
          for (var t2 = Date.now(); Date.now() - t2 < 8000; await wait(200)) {
            var n = timeNode(), d = n && n._data;
            if (d && d[0] && d[0].startTime >= cur.st - 60 && d[0].startTime < cur.et && used.indexOf(n) < 0) {
              used.push(n);
              add(id, cur.round, d.slice().sort(function (a, b) { return a.startTime - b.startTime; })
                .map(function (x) { return [String(L.getText(x.title) || x.title).replace(/^\s+|\s+$/g, '').replace(/ Stage$/, ''), secs(x.startTime), secs(x.endTime)]; }));
              return;
            }
          }
        };
        await stages(2, 'st', 'Snow Train');
        await stages(3, 'et', 'Defend Energy');
      } finally { if (opened) try { U.CloseUI(WB); } catch (e) {} }
    }
    if (!events.length) throw new Error('no event times found');
    return { rounds: rounds, round: cur.round, events: events };
  }

  // The Frost Crystal Contest's battlefields for the site's Frost page: the contest's own map (its tab in
  // the Event Center, opened as the season screen's Desolate Tundra card opens it), then each server
  // looked up on the warzone map (readServerTop), one after another at a person's pace.
  var compNamed = function (name) {
    var hit = null;
    (function walk(n) {
      if (!n || !n.activeInHierarchy) return;
      (n._components || []).forEach(function (c) { if (c.__classname__ === name) hit = c; });
      (n.children || []).forEach(walk);
    })(cc.director.getScene());
    return hit;
  };
  async function readFrostMap(step, then) {
    var U = ui(), WM = win('CQ26MainPanel'), WA = win('ActivityPanelNew'), opened = [];
    var map = function () { var c = compNamed('CQ26WLBMainContent'); return c && c._data && c._data.dLandInfoList ? c : null; };
    var close = function () { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); };
    try {
      if (!map()) {
        if (!U || !WM || !WA) throw new Error('no Seal Stone season in the game right now');
        step('Opening the contest\'s map…', .02);
        var A = compNamed('ActivityComponent'), M = compNamed('CQ26MainPanel');
        if (!A) {
          if (!M) { U.OpenUI(WM); opened.unshift(WM); }
          for (var t0 = Date.now(); Date.now() - t0 < 10000 && !(M = compNamed('CQ26MainPanel')); await wait(200));
          if (!M) throw new Error('the season screen did not open');
          await wait(between(400, 800));
          M.onClickWasteLand(); opened.unshift(WA);
          for (var t1 = Date.now(); Date.now() - t1 < 10000 && !(A = compNamed('ActivityComponent')); await wait(200));
          if (!A) throw new Error('the Event Center did not open');
          await wait(between(500, 900));
        }
        // the Frost Crystal Contest's tab: the one that shows the contest's map (the tabs are drawn a moment
        // after the Event Center opens)
        var tabs = [];
        for (var t3 = Date.now(); Date.now() - t3 < 6000 && !tabs.length && !map(); await wait(200))
          (function walk(n) { (n._components || []).forEach(function (c) { if (c.__classname__ === 'ActivityToggleCellComponent') tabs.push(c._activityId); }); (n.children || []).forEach(walk); })(A.node);
        for (var i = 0; i < tabs.length && !map(); i++) {
          A.toggleClick(tabs[i]);
          for (var t2 = Date.now(); Date.now() - t2 < 4000 && !map(); await wait(200));
        }
      }
      var c = map();
      if (!c) throw new Error('the Frost Crystal Contest map did not load — is the contest on?');
      if (then) return await then(c);                         // a battle read, with the contest open
      return c._data.dLandInfoList.map(function (b) {
        return (b.mineInfoList || []).map(function (m) { return String(m.serverId); }).filter(function (s) { return /^\d{1,5}$/.test(s) && s !== '0'; });
      }).filter(function (f) { return f.length; });
    } finally { close(); }
  }
  // The battle, during the contest's hour, as its screens show it: from the contest open, its Status (every
  // battlefield and who holds each mine, masked holders' real names included, as the game sends them), then
  // its Ranking (servers by crystals) and that Ranking's Individual tab (our warzone's players by score, every page).
  // Each opened with the game's own button, read and closed again.
  async function readBattle(step) {
    var U = ui(), WF = win('CQ26WLBFightPanel'), WR = win('CQ26WLBRankPanel');
    if (!U || !WF || !WR) throw new Error('the game has changed: no contest Status or Ranking found');
    var uname = function (x) { var p = parse(x); return String(p.username || p.nickname || '').slice(0, 40); };
    var num = function (v) { return Number(longText(v)) || 0; };
    return readFrostMap(step, async function (contest) {
      var out = { status: [], servers: [], players: [] };
      await wait(between(600, 1200));
      // Status: fresh from its own request when it opens
      step('Opening Status…', .3);
      contest.onFightInfoClick();
      try {
        var F = null;
        for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) {
          F = compNamed('CQ26WLBFightInfoNode');
          if (F && F._wDatas && F._wDatas.length && F._wDatas[0].fight) break; F = null;
        }
        if (!F) throw new Error('Status did not load — is the battle on?');
        out.status = F._wDatas.map(function (w) {
          var f = w.fight || {}, me = f.selfForceFightingInfo || {}, spotOf = {};
          (w.info.mineInfoList || []).forEach(function (m) { spotOf[m.specId] = Number(m.serverId) || 0; });   // each mine's server spot, by its id
          return { servers: (w.info.mineInfoList || []).map(function (m) { return Number(m.serverId) || 0; }),
            players: f.totalPlayerCount || 0, masked: f.totalGhostCount || 0, freeOre: f.freeOreCount || 0,
            us: { players: me.playerCount || 0, masked: me.ghostCount || 0, crystals: num(me.cncPower), rate: num(me.cncPowerRate) },
            mines: (f.mineFightingInfoList || []).map(function (m) {
              return { spot: spotOf[m.specId] || 0, server: Number(m.occupyForceId) || 0, players: m.occupyPlayerCount || 0, masked: !!m.occupyGhostEnable,
                name: m.occupyTopPlayerInfo ? uname(m.occupyTopPlayerInfo) : '', power: num(m.occupyTopPlayerPower), uid: longText(m.occupyTopUid) };
            }) };
        });
        await wait(between(1500, 3000));                 // a moment to look
      } finally { try { U.CloseUI(WF); } catch (e) {} }
      await wait(between(600, 1200));
      // the Ranking: its servers, then its Individual tab
      step('Opening the Ranking…', .6);
      contest.onRankClick();
      try {
        var list = function (k) { var P = compNamed('CQ26WLBRankPanel'), L = P && P[k]; return L && Array.isArray(L.rankList) ? L : null; };
        var got = async function (k) {
          for (var t1 = Date.now(); Date.now() - t1 < 8000; await wait(200)) { var L = list(k); if (L && !L._isRequesting && (L.rankList.length || Date.now() - t1 > 4000)) return L; }
          return list(k);
        };
        var S0 = await got('serverComp');
        out.servers = (S0 ? S0.rankList : []).map(function (r) { return { rank: r.rank || 0, server: Number(r.serverId) || 0, crystals: num(r.cncPower) }; });
        await wait(between(1200, 2500));
        step('Reading the Individual Ranking…', .8);
        var P = compNamed('CQ26WLBRankPanel'); P.onTabClick(null, '1');
        var P0 = await got('playerComp');
        // every page of it, 30 at a time, the way scrolling to the end of the list loads the next
        for (var pg = 0; P0 && pg < 40; pg++) {
          var had = P0.rankList.length;
          step('Reading the Individual Ranking… ' + had + ' players', .8);
          await wait(between(500, 1100));
          P0.scrollToBottomEvent();
          for (var t2 = Date.now(); Date.now() - t2 < 6000 && (P0._isRequesting || P0.rankList.length === had); await wait(200));
          if (P0.rankList.length === had) break;
        }
        out.players = (P0 ? P0.rankList : []).map(function (r) {
          return { rank: r.rank || 0, server: Number(r.serverId) || 0, masked: !!r.ghostEnable, name: r.playerInfo ? uname(r.playerInfo) : '',
            score: num(r.score), uid: longText(r.uid) };
        });
        await wait(between(800, 1500));
      } finally { try { U.CloseUI(WR); } catch (e) {} }
      return out;
    });
  }

  // Neutral City, after a battle: the season screen's Neutral City card (the Event Center at its Neutral City
  // tab), then that tab's Record button: the Points Log, one tab per battle date, each date's every page read the
  // way scrolling to the end loads it, for All and then each city in its picker (the cities we fought in). Then the round's cities as the game has them, once its battle is over
  // (until the next round's battle, the cities are that round's). Everything opened is closed again.
  // have: the dates the site has saved already; those are skipped, except the newest in the Points Log (read again)
  async function readNeutral(step, have) {
    var U = ui(), WM = win('CQ26MainPanel'), WA = win('ActivityPanelNew'), WS = win('CQ25NeutralScorePanel'), CN = req('CQ26NeutralController');
    if (!U || !WM || !WA || !WS || !CN) throw new Error('no Neutral City in the game right now');
    var ctl = CN.default.getInstance(), opened = [];
    var uname = function (x) { var p = parse(x); return String(p.username || p.nickname || '').slice(0, 40); };
    var num = function (v) { return Number(longText(v)) || 0; };
    var utc = function (t) { return new Date(t * 1000).toISOString().slice(0, 10); };
    var days = {}, cities = {}, summary = null;
    try {
      var N = compNamed('CQ26NeutralMain');
      if (!N) {
        var M = compNamed('CQ26MainPanel');
        if (!M) {
          step('Opening the season screen…', .02);
          U.OpenUI(WM); opened.unshift(WM);
          for (var t0 = Date.now(); Date.now() - t0 < 10000 && !(M = compNamed('CQ26MainPanel')); await wait(200));
          if (!M) throw new Error('the season screen did not open');
          await wait(between(400, 800));
        }
        step('Opening Neutral City…', .05);
        M.onClickNeutralCity(); opened.unshift(WA);
        for (var t1 = Date.now(); Date.now() - t1 < 10000 && !(N = compNamed('CQ26NeutralMain')); await wait(200));
        if (!N) throw new Error('the Neutral City tab did not open');
        await wait(between(600, 1100));
      }
      step('Opening the Points Log…', .1);
      N.onRecordClick(); opened.unshift(WS);
      var P = null;
      for (var t2 = Date.now(); Date.now() - t2 < 10000; await wait(200)) {
        P = compNamed('CQ25NeutralScorePanel');
        if (P && Array.isArray(P._times) && (!P._times.length || (Array.isArray(P._data) && !P._isRequesting && Date.now() - t2 > 1500))) break;
        P = null;
      }
      if (!P) throw new Error('the Points Log did not open');
      var times = P._times.slice(), newest = times.map(utc).sort().pop(), skipped = [];
      for (var i = 0; i < times.length; i++) {
        var d = utc(times[i]);
        if (d !== newest && have && have[d]) { skipped.push(d); continue; }
        if (P._curTabIdx !== i) {
          await wait(between(900, 1600));
          var before = P._data;
          P.onTabClick(null, String(i));
          for (var t3 = Date.now(); Date.now() - t3 < 8000 && (P._isRequesting || P._data === before); await wait(200));
        }
        // the picker's cities for this date (the first is All); All first, then each city as picking it does
        var picks = (P._timesMap && P._timesMap.get && P._timesMap.get(times[i])) || [], cityNum = {};
        Object.keys((ctl.getMainInfo() || {}).city || {}).forEach(function (k) { var c = ctl.getMainInfo().city[k]; cityNum[c.cityId] = c.showNum; });
        for (var j = 0; j < Math.max(picks.length, 1); j++) {
          var id = picks[j] ? picks[j].id : 0, label = id ? String(cityNum[id] || (String(picks[j].msg).match(/\d+$/) || [''])[0]) : '';
          if (id && !label) continue;
          if (P._selectIdx !== id) {
            await wait(between(900, 1600));
            P.onSelectClose(); P._selectIdx = id; P.requestData(true);      // what picking it in the city picker runs
            await wait(300);
            for (var t5 = Date.now(); Date.now() - t5 < 8000 && (P._isRequesting || !P._data.length); await wait(200));
          }
          // every page, 30 at a time: glide the list to its end, as a finger scroll does, and load the next the
          // way reaching the end does. Done when a request comes back with nothing new.
          if (P.scrollview) P.scrollview.scrollToTop(0);
          for (var pg = 0; pg < 100; pg++) {
            var had = P._data.length, saw4 = false;
            step('Reading the Points Log, ' + dayText(d) + (label ? ', city ' + label : '') + '… ' + had + ' players',
              .15 + .65 * (i + (j + 1) / Math.max(picks.length, 1)) / times.length);
            await wait(between(500, 1100));
            if (P.scrollview) { var g4 = between(0.2, 0.45); P.scrollview.scrollToBottom(g4); await wait(g4 * 1000 + 50); }
            P.scrollToBottomEvent();
            for (var t4 = Date.now(); Date.now() - t4 < 6000 && P._data.length === had; await wait(100)) {
              saw4 = saw4 || P._isRequesting;
              if ((saw4 && !P._isRequesting) || (!saw4 && Date.now() - t4 > 1500)) break;
            }
            if (P._data.length === had) break;
          }
          // the UID only for the Worker to find each player's alliance in the roster; it keeps none
          var rows = P._data.map(function (r) { return [uname(r.playerInfo), num(r.score), longText(r.uid)]; }).filter(function (r) { return r[0]; });
          if (id) { (cities[d] = cities[d] || {})[label] = rows; } else days[d] = rows;
        }
        if (P._selectIdx !== 0) { await wait(between(600, 1000)); P.onSelectClose(); P._selectIdx = 0; P.requestData(true); }   // back to All
      }
      await wait(between(800, 1500));                  // a moment to look
      // the round's cities: who holds each, the servers' ranking there, and ours where we fought
      var stt = ctl.getStatus(), m = ctl.getMainInfo(), now = Date.now() / 1000;
      if (stt && m && m.city && stt.fightEndTime && now >= stt.fightEndTime) {
        step('Reading the cities…', .85);
        summary = {
          day: utc(stt.fightBeginTime), round: stt.round, score: num(m.score),
          cities: Object.keys(m.city).map(function (k) {
            var c = m.city[k], b = ctl.getFightBattleInfoByCityId(c.cityId);
            return { n: c.showNum, own: c.mSid || 0, rk: c.rankSid || [], fight: c.fightSid || [],
              us: b ? { score: num(b.score), rank: b.rank || 0, st: b.outerBuildNum || 0, hub: b.innerBuildNum || 0 } : null };
          }),
          declared: (m.selfToOtherCity || []).filter(function (x) { return x.round === stt.round && (x.result === 1 || x.result === 2); })
            .map(function (x) { return { n: x.showNum, won: x.result === 1 }; }),
        };
      }
    } finally { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); }
    if (!Object.keys(days).length && !summary) throw new Error('no Neutral City battle yet');
    return { days: days, cities: cities, summary: summary, skipped: skipped || [] };
  }

  // Fame (last round): the Neutral City Treasury's Member List (Distribute Rewards → Select one), as an official sees it,
  // sorted by Fame, every page loaded the way scrolling to the end does. Opened from wherever the treasury is: the
  // Member List itself, Distribute Rewards (its Select one), or the treasury (its Distribute Rewards). Nothing is picked
  // or distributed (the list's OK is never pressed), and what was opened is closed again. The date: the round's battle
  // once it is over, else the newest battle the site has (the round before).
  async function readFame(step) {
    var U = ui(), opened = [], CN = req('CQ26NeutralController');
    var S = compNamed('CQ26TreasureHouseSelectPlayer');
    try {
      if (!S) {
        var R = compNamed('CQ26TreasureHouseSendRewardPanel');
        if (!R) {
          var H = compNamed('CQ26TreasureHousePanel');
          if (!H) throw new Error('open the Neutral City Treasury first (Event Center → Neutral City Treasury)');
          step('Opening Distribute Rewards…', .05);
          H.onClickSendReward(); opened.unshift(win('CQ26TreasureHouseSendRewardPanel'));
          for (var t0 = Date.now(); Date.now() - t0 < 10000 && !(R = compNamed('CQ26TreasureHouseSendRewardPanel')); await wait(200));
          if (!R) throw new Error('Distribute Rewards did not open (only officials can open it)');
          await wait(between(900, 1500));
        }
        step('Opening the Member List…', .1);
        R.onClickSelectPlayer(null, '1'); opened.unshift(win('CQ26TreasureHouseSelectPlayer'));
        for (var t1 = Date.now(); Date.now() - t1 < 10000 && !(S = compNamed('CQ26TreasureHouseSelectPlayer')); await wait(200));
        if (!S) throw new Error('the Member List did not open: pick a reward in Distribute Rewards first');
        await wait(between(700, 1200));
      }
      if (S._toggleIndex !== 3) {
        step('Sorting by Fame…', .15);
        S.onClickRankToggle(null, '3');                  // what tapping Fame (last round) runs
        await wait(300);
      }
      for (var t2 = Date.now(); Date.now() - t2 < 8000 && (S._isLoadingData || !(S._rankInfoList || []).length); await wait(200));
      if (!(S._rankInfoList || []).length) throw new Error('the Member List is empty');
      for (var pg = 0; pg < 200 && !S._isLoadAllDataFinish; pg++) {
        var had = S._rankInfoList.length;
        step('Reading Fame… ' + had + ' players', Math.min(.85, .2 + pg * .02));
        await wait(between(500, 1100));
        S.scrollToBottomEvent();
        for (var t3 = Date.now(); Date.now() - t3 < 6000 && (S._isLoadingData || S._rankInfoList.length === had); await wait(150))
          if (!S._isLoadingData && Date.now() - t3 > 1500) break;
        if (S._rankInfoList.length === had) break;
      }
      var parse1 = function (x) { try { return JSON.parse(x) || {}; } catch (e) { return {}; } };
      // the UID only for the Worker to find each player in the roster; it writes the Player ID, never the UID
      var rows = S._rankInfoList.map(function (r) { var p = parse1(r.sendPlayerInfo);
        return [String(p.username || p.nickname || '').slice(0, 40), Number(r.score) || 0, Number(r.power) || 0, Number(r.rank) || 0, r.isSend ? 1 : 0, String(longText(r.uid) || '')]; })
        .filter(function (r) { return r[0]; });
      await wait(between(600, 1100));                   // a moment to look
    } finally { opened.forEach(function (w) { try { if (w) U.CloseUI(w); } catch (e) {} }); }
    var utc = function (t) { return new Date(t * 1000).toISOString().slice(0, 10); };
    var stt = CN && CN.default.getInstance().getStatus(), now = Date.now() / 1000, day = '', round = 0;
    if (stt && stt.fightEndTime && now >= stt.fightEndTime) { day = utc(stt.fightBeginTime); round = stt.round || 0; }
    else {
      round = stt && stt.round ? stt.round - 1 : 0;
      try { var g = await postJson('/nc-read', {}); day = Object.keys(g.days || {}).filter(function (d) { return d <= new Date().toISOString().slice(0, 10); }).sort().pop() || ''; } catch (e) {}
    }
    return { day: day || new Date().toISOString().slice(0, 10), round: round, rows: rows };
  }

  // One server the way a person looks it up: tapped on the warzone map (the game asks for its briefing
  // and opens its warzone card), a moment to look, then the card's Individual CP Ranking button. Its
  // top 20 read, then the ranking and the card closed again. map: the open warzone map.
  async function readServerTop(map, sid) {
    var U = ui(), WC = win('WorldServerTheaterPanel'), WR = win('WorldServerPowerRank');
    if (!U || !WC || !WR || !map.m_data || !map.m_data[sid]) throw new Error('S' + sid + ' is not on the warzone map');
    try {
      map.clickCity(Number(sid));
      var card = null;
      for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) {
        card = compNamed('WorldServerTheaterPanel');
        if (card && card.m_data && Number(card.m_data.serverId) === Number(sid)) break;
        card = null;
      }
      if (!card) throw new Error('S' + sid + '\'s warzone card did not open');
      await wait(between(600, 1400));
      card.onClickPlayerRank();
      // its list once loaded (players moved from another server keep that server's number, so not by that)
      for (var t1 = Date.now(); Date.now() - t1 < 12000; await wait(200)) {
        var R = compNamed('WorldServerPowerRank');
        if (R && Number(R.m_serverId) === Number(sid) && R._rankList && R._rankList.length) {
          var top = R._rankList.slice(0, 20).map(function (e) {
            var p = parse(e.playerInfo);
            return [String(p.username || p.nickname || '').slice(0, 40), Number(longText(e.val || e.power)) || 0];
          });
          await wait(between(400, 900));
          return top;
        }
      }
      throw new Error('S' + sid + '\'s ranking did not load');
    } finally {
      try { U.CloseUI(WR); } catch (e) {}
      await wait(between(200, 400));
      try { U.CloseUI(WC); } catch (e) {}
    }
  }
  // the warzone map, opened if it is not (then closed again by the caller)
  async function warzoneMap() {
    var map = compNamed('WorldServerListPanel'), W = win('WorldServerListPanel'), opened = false;
    var ready = function () { return map && map.m_data && Object.keys(map.m_data).length; };
    if (!ready()) {
      if (!W) throw new Error('the game has changed: no warzone map found');
      if (!map) { ui().OpenUI(W); opened = true; }
      for (var t0 = Date.now(); Date.now() - t0 < 12000 && !ready(); await wait(200)) map = compNamed('WorldServerListPanel');
      if (!ready()) { if (opened) try { ui().CloseUI(W); } catch (e) {} throw new Error('the warzone map did not open'); }
      await wait(between(800, 1500));
    }
    return { map: map, close: function () { if (opened) try { ui().CloseUI(W); } catch (e) {} } };
  }
  // the contest's date, for the Frost page's date tabs: the day (UTC) its battle starts, as the game has it
  function contestDay() {
    var m = req('CQ26Controller'), C = m && m.CQ26Controller && m.CQ26Controller.getInstance();
    var st = C && C.wlBattleData && C.wlBattleData.status, t = st ? secs(st.timeFightStart) : 0;
    return new Date(t > 1.7e9 ? t * 1000 : Date.now()).toISOString().slice(0, 10);
  }
  // a person's pause between servers: 2 to 5 seconds, now and then longer
  var restBetween = function () { return wait(Math.random() < .12 ? between(6000, 10000) : between(2000, 5000)); };

  // the Energy Tower's Rankings: OpenUI(CQ26ArkRankPop), what the event's Rankings button runs (the
  // game loads the ranking for the event it has open), read, and closed again; one already open is
  // read as it is and left open. Only this warzone's players: the game's own Your Warzone filter.
  var rankPop = function () { return findComp(function (c) { return c.__classname__ === 'CQ26ArkRankPop'; }); };
  async function readEnergyPoints(step) {
    var pop = rankPop(), opened = [], U = ui();
    var dc = req('DataCenter'), me = dc && dc.DATA && dc.DATA.UserData, sid = me && me.OriginServerId;
    if (sid == null) throw new Error('the game has not loaded your warzone yet');
    var have = function () { return pop && pop._data && Array.isArray(pop._data.rankInfo); };
    if (!have()) {
      var WR = win('CQ26ArkRankPop'), m = req('CQ26Controller'), C = m && m.CQ26Controller && m.CQ26Controller.getInstance();
      if (!U || !WR || !C || !C.arkData || C.arkData.cid == null) throw new Error('no Energy Tower in the game right now — open the event once, then try again');
      if (!pop) { step('Opening the Rankings…', .15); U.OpenUI(WR); opened.push(WR); }
      for (var t0 = Date.now(); Date.now() - t0 < 12000; await wait(200)) { pop = rankPop(); if (have()) break; }
      await wait(300);
    }
    var close = function () { opened.forEach(function (w) { try { U.CloseUI(w); } catch (e) {} }); };
    if (!have()) { close(); throw new Error('the Rankings did not load'); }
    var list = pop._data.rankInfo.filter(function (e) { return Number(e.sid) === Number(sid); });
    close();
    if (!list.length) throw new Error('no one from your warzone has points yet');
    return list.map(function (e) {
      var p = parse(e.playerInfo);
      return { uid: String(e.uid || ''), name: String(p.username || p.nickname || ''), points: Number(e.score) || 0 };
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
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ members: S.members, prev: S.prev, wb: S.wb || null, st: S.st || null, et: S.et || null, etp: S.etp || null, ma: S.ma || null, ev: S.ev || null, fr: S.fr || null, fb: S.fb || null, nc: S.nc || null })); } catch (e) {} }
  var fold = function (s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, ''); };
  // MM/CE from the roster. Names repeat ("Woody" is 698S's in-game name and 698C's search name; 698S
  // has two Gikeys), so the candidates are tried in order: in-game name in the player's own alliance,
  // search name in it, then either name anywhere, then a looser match that ignores fancy letters.
  // Where one step still finds several players, the one whose Base CP is nearest the power wins.
  var CLASS = null;
  // The roster sheet's in-game names carry a tag where two players share a name, for the sheets' look-ups:
  // "Killua.C", "Gikey 2", "Skadi2". untag gives the name as the game has it ("Killua", "Gikey", "Skadi"), or ''.
  // A tagged row is found under the name without its tag too, next to the rows with that name exactly, but only where its
  // Base CP is near the player's power ("Thor3" is a player of its own, not a tagged Thor); the Base CP then picks.
  function untag(n) { var m = /^(.*\D)\s?[2-9]$/.exec(n || '') || /^(.+)\.[A-Za-z]$/.exec(n || ''); return m ? m[1].trim() : ''; }
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
          var bare = untag(r[1]); if (bare) { add('ba|' + r[2] + '|' + bare, row); add('b|' + bare, row); }
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
    var near = function (row) { return cp > 0 && row.cp > 0 && Math.abs(row.cp - cp) <= 0.25 * cp; };
    var bare = { 0: 'ba|' + ally + '|' + name, 2: 'b|' + name };    // the tagged rows, with the in-game name steps
    for (var i = 0; i < order.length; i++) {
      var c = (k[order[i]] || []).concat(bare[i] ? (k[bare[i]] || []).filter(near) : []);
      if (!c.length) continue;
      return c.length === 1 ? c[0] : c.slice().sort(function (a, b) { return Math.abs(a.cp - cp) - Math.abs(b.cp - cp); })[0];
    }
    return null;
  }
  function classOf(name, ally, power) { var m = matchOf(name, ally, power); return m ? m.cls : ''; }
  // the roster's search name, as the Base CP tab sends it; the in-game name when the roster has none
  function searchOf(name, ally, power) { var m = matchOf(name, ally, power); return (m && m.search) || name; }
  // the roster card's search name: '' when the sheet has no row for the player (a new in-game name not yet in it), so
  // the Worker keeps the search name they had rather than taking the new in-game name
  function matchedSearch(name, ally, power) { var m = matchOf(name, ally, power); return (m && m.search) || ''; }
  var READY = loadClasses();

  // one alliance read into the site's Alliance Roster card (api/roster-update): its rows are updated
  // in place, matched by UID on the Worker; players missing from the read are marked Left there
  function pushRoster(tag, list) {
    var members = list.map(function (m) {
      return { uid: m.uid, name: m.name, search: matchedSearch(m.name, tag, m.power), rank: m.rank, power: m.power, level: m.level,
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
    '[hidden]{display:none!important}' +
    'h3{margin:12px 2px 7px;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:rgba(235,235,245,.6);font-weight:700}' +
    '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
    '@media (max-width:380px){.grid{grid-template-columns:repeat(2,1fr)}}' +
    '.stack{display:grid;gap:8px;margin-top:8px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}' +
    'select{width:100%;background:rgba(255,255,255,.08);color:inherit;border:0;border-radius:12px;padding:9px 12px;font:inherit}' +
    'select option{color:#111}' +
    // the sections picker: which of the panel's sections this device shows
    '.pick{margin:4px 0 2px}' +
    '.pickbtn{display:flex;align-items:center;gap:10px;width:100%;border:0;border-radius:12px;padding:8px 12px;background:rgba(255,255,255,.08);color:inherit;font:inherit;cursor:pointer;text-align:left}' +
    '.pickbtn:hover{background:rgba(255,255,255,.11)}' +
    '.pickbtn .pl{flex:1;min-width:0}.pickbtn .pl small{display:block;font-size:10.5px;color:rgba(235,235,245,.6)}' +
    '.pickbtn .pl b{display:block;font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.pickbtn svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:.7;transition:transform .2s}' +
    '.pick.open .pickbtn svg{transform:rotate(180deg)}' +
    '.pickmenu{margin-top:6px;padding:6px;border-radius:14px;background:#2b2b38;' +
      'box-shadow:0 16px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);display:none;transform-origin:top center}' +
    '.pick.open .pickmenu{display:block;animation:menuin .16s ease-out}@keyframes menuin{from{opacity:0;transform:translateY(-4px) scale(.98)}}' +
    '.opt{display:flex;align-items:center;gap:11px;width:100%;border:0;border-radius:10px;padding:9px 10px;background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer;text-align:left}' +
    '.opt:hover{background:rgba(255,255,255,.07)}' +
    '.opt .bx{width:19px;height:19px;flex:none;border-radius:6px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.28);display:grid;place-items:center;transition:background .15s,box-shadow .15s}' +
    '.opt .bx svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.6);transition:opacity .15s,transform .15s}' +
    '.opt.on .bx{background:linear-gradient(135deg,#c31441,#e0457b);box-shadow:none}.opt.on .bx svg{opacity:1;transform:none}' +
    '.opt.some .bx{background:linear-gradient(135deg,#c31441,#e0457b);box-shadow:none}.opt.some .bx svg{display:none}.opt.some .bx::after{content:"";width:9px;height:2.5px;border-radius:2px;background:#fff}' +
    '.opt.all{font-weight:700}.sep{height:1px;margin:4px 6px;background:rgba(255,255,255,.08)}' +
    '.pickempty{margin:12px 2px 0;color:rgba(235,235,245,.6);font-size:13px}' +
    '.act{position:relative;overflow:hidden;isolation:isolate;border:0;border-radius:14px;padding:10px 11px;min-height:58px;text-align:left;' +
      'background:rgba(255,255,255,.07);color:inherit;font:inherit;cursor:pointer;transition:transform .15s,background .3s,opacity .3s}' +
    '.act:active{transform:scale(.97)}' +
    '.act.main{background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b)}' +
    '.act .t{display:block;font-weight:800;font-size:15px;position:relative}' +
    // a Mac draws the system font a lot heavier than Windows does: thinner strokes, and a step lighter
    '.app{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
    '.mac .act .t,.mac .top b{font-weight:700}.mac h3{font-weight:600}' +
    '.act .s{display:block;font-size:11.5px;color:rgba(235,235,245,.6);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}.act .s:empty::before{content:"\\a0"}' +
    '.act.main .s{color:rgba(255,255,255,.75)}' +
    '.grid .act{padding:10px 9px}' +
    '.grid .act .t{white-space:nowrap;font-size:14.5px;padding-right:16px}' +
    '.grid .act .t::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:2px;background:var(--c)}' +
    '.act[data-a="698N"]{--c:#9ec5ff}.act[data-a="698S"]{--c:#e9a8ff}.act[data-a="698W"]{--c:#7ee2a8}.act[data-a="698C"]{--c:#ffc078}' +
    '.app.locked .act:not(.busy),.app.locked select{opacity:.45;pointer-events:none}' +
    '.wbsel{display:grid;grid-template-columns:1fr;gap:8px}' +
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
    '<div class="app' + (/Mac/.test(navigator.platform || navigator.userAgent) ? ' mac' : '') + '"><div class="top" title="Drag to move"><img class="logo" alt="" src="https://2698-tw.github.io/activity-tracking/icon.png"><b>2698 Data Extractor</b><button class="x" id="close" title="Close">×</button></div>' +
    '<div class="pick" id="pick"><button type="button" class="pickbtn" id="pickBtn" aria-haspopup="true" aria-expanded="false"><span class="pl"><small>Show</small><b id="pickLbl">Everything</b></span>' +
      '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="pickmenu" id="pickMenu" role="menu"></div></div>' +
    '<p class="pickempty" id="pickEmpty" hidden>Nothing shown. Pick what to read above.</p>' +
    '<div data-sec="members"><h3>Alliance members</h3><div class="grid">' +
      Object.keys(ALLY).map(function (t) { return act('a' + t, '', t, 'not read', t); }).join('') + '</div>' +
    '<div class="row2">' + act('all', 'main', 'Read all four', 'Updates the roster card') +
      act('cp', 'send', 'Send to sheet', 'Read an alliance first') + '</div>' +
    '<div class="row2"><div class="wbsel"><select id="rround" aria-label="Practice Round sheet">' +
      [2, 3, 4].map(function (n) { return '<option value="' + n + '">Practice Round ' + n + '</option>'; }).join('') + '</select></div>' +
      act('rsh', 'send', 'Roster to sheet', 'Input-Roster of that round') + '</div></div>' +
    '<div data-sec="wb"><h3>Whitebeard ranking</h3><div class="wbsel"><select id="who"><option value="ALL4">698N, W, S, C</option><option value="OTHER">Other</option></select></div>' +
    '<div class="row2">' + act('wb', 'main', 'Read', 'Loads every rank') + act('wbs', 'send', 'Send to sheet', 'Read it first') + '</div></div>' +
    '<div data-sec="st"><h3>Snow Train</h3>' +
    '<div class="row2">' + act('snow', 'main', 'Read garrison', '') + act('snows', 'send', 'Send to sheet', "Today's card") + '</div></div>' +
    '<div data-sec="et"><h3>Energy Tower</h3>' +
    '<div class="row2">' + act('tower', 'main', 'Read garrison', '') + act('towers', 'send', 'Send to sheet', "Today's card") + '</div>' +
    '<div class="row2">' + act('towerp', 'main', 'Read points', '') + '</div></div>' +
    '<div data-sec="ma"><h3>Mammoth Assault</h3>' +
    '<div class="row2">' + act('mam', 'main', 'Read garrison', '') + act('mams', 'send', 'Send to sheet', "Today's card") + '</div></div>' +
    '<div data-sec="ev"><h3>Events</h3>' +
    '<div class="row2">' + act('evr', 'main', 'Read events', 'For the home page') + '</div></div>' +
    '<div data-sec="frost"><h3>Frost Crystal Contest</h3>' +
    '<div class="row2">' + act('frr', 'main', 'Read battlefields', 'For the Frost page') + act('frb', 'main', 'Read battle', 'At the battle\'s end') + '</div>' +
    '<div class="row2">' + act('frs', 'send', 'Send to sheet', 'The latest battle') + '</div></div>' +
    '<div data-sec="nc"><h3>Neutral City</h3>' +
    '<div class="row2">' + act('ncr', 'main', 'Read Neutral City', 'After a battle') + act('ncs', 'send', 'Send to sheet', 'The latest battle') + '</div>' +
    '<div class="stack">' + act('fmr', 'main', 'Read Fame', 'Treasury → Distribute Rewards · to the Fame sheet') + '</div></div>' +
    '<div class="status idle" id="st"><span class="si"></span><span class="tx">Ready. Tap a button to start.</span></div></div>';
  document.body.appendChild(host);
  var $ = function (s) { return root.querySelector(s); };
  var app = $('.app'), st = $('#st');
  var busy = false;

  // the sections set in the site's admin view (Home page → Bookmark): the last ones known right away,
  // then the site's own
  // Within those, the Show picker at the top picks which this device shows, kept on this device.
  var SECS = 'x2698.sections', PICK = 'x2698.pick', allowed = {};
  var picked = (function () { try { return JSON.parse(localStorage.getItem(PICK)) || {}; } catch (e) { return {}; } })();
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function sections(b) {
    if (b) allowed = b;
    var secs = [].slice.call(root.querySelectorAll('[data-sec]')), shown = [], can = [];
    secs.forEach(function (d) {
      var ok = allowed[d.dataset.sec] !== false, on = ok && picked[d.dataset.sec] !== false;
      d.hidden = !on;
      if (ok) can.push(d);
      if (on) shown.push(d.querySelector('h3').textContent);
    });
    $('#pickLbl').textContent = shown.length === can.length ? 'Everything' : shown.length ? shown.join(', ') : 'Nothing';
    $('#pickEmpty').hidden = shown.length > 0;
    var n = shown.length, menu = $('#pickMenu');
    menu.innerHTML = '<button type="button" class="opt all' + (n === can.length ? ' on' : n ? ' some' : '') + '" data-k="*"><span class="bx">' + CHECK + '</span>Everything</button><div class="sep"></div>' +
      can.map(function (d) {
        var k = d.dataset.sec;
        return '<button type="button" class="opt' + (picked[k] !== false ? ' on' : '') + '" data-k="' + k + '"><span class="bx">' + CHECK + '</span>' + d.querySelector('h3').textContent + '</button>';
      }).join('');
    if (!$('#pick').classList.contains('open')) refit();   // not while picking: the menu would move under the pointer
  }
  $('#pickBtn').onclick = function (e) {
    e.stopPropagation();
    var o = $('#pick').classList.toggle('open');
    this.setAttribute('aria-expanded', o);
    if (!o) refit();
  };
  $('#pickMenu').onclick = function (e) {
    e.stopPropagation();
    var b = e.target.closest('.opt'); if (!b) return;
    var k = b.dataset.k, keys = [].map.call(root.querySelectorAll('[data-sec]'), function (d) { return d.dataset.sec; })
      .filter(function (s) { return allowed[s] !== false; });
    if (k === '*') { var all = keys.every(function (s) { return picked[s] !== false; }); keys.forEach(function (s) { picked[s] = !all; }); }
    else picked[k] = picked[k] === false;
    try { localStorage.setItem(PICK, JSON.stringify(picked)); } catch (e2) {}
    sections();
  };
  app.addEventListener('click', function () {
    if (!$('#pick').classList.contains('open')) return;
    $('#pick').classList.remove('open'); $('#pickBtn').setAttribute('aria-expanded', 'false'); refit();
  });
  try { sections(JSON.parse(localStorage.getItem(SECS))); } catch (e) {}
  if (!$('#pickMenu').firstChild) sections();
  fetch(API + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) { if (s && s.bookmark) { sections(s.bookmark); try { localStorage.setItem(SECS, JSON.stringify(s.bookmark)); } catch (e) {} } })
    .catch(function () {});
  var V = { wbFilter: 'ALL4', wb: S.wb || null };   // the last Whitebeard read, kept like the member lists

  // closing only hides the panel: a read that is running carries on, and the bookmark brings it back
  $('#close').onclick = function () { host.style.display = 'none'; };

  // the header moves the panel; where it was left is remembered on this device
  // The panel's size on screen, as at 100% on a computer: the browser's own zoom on this page is undone
  // (Chrome on a Mac at 110% made it a tenth bigger), and a window too short for it shrinks it further,
  // down to 70%. Z is that zoom; inside the panel's layer every length is the screen's divided by Z.
  var Z = 1;
  function fit() {
    var page = outerWidth && innerWidth ? outerWidth / innerWidth : 1;        // the browser's zoom, near enough
    var undo = page > 1.04 && page < 3 ? 1 / page : 1;
    host.style.zoom = 1;
    var tall = app.scrollHeight + 24;
    Z = Math.max(.7, Math.min(undo, innerHeight / tall));
    host.style.zoom = Z;
  }
  fit();
  // sized again where it is, kept on screen: after the window changes, or sections are shown or hidden
  function refit() {
    var r = app.getBoundingClientRect(), moved = app.style.transform === 'none';
    app.style.maxHeight = ''; fit();
    if (moved) place(r.left, r.top);
  }
  var POS = 'x2698.pos';
  function place(x, y) {                                          // x, y: on screen
    var w = app.offsetWidth, h = app.offsetHeight, W = innerWidth / Z, H = innerHeight / Z;
    x = Math.max(4, Math.min(W - w - 4, x / Z)); y = Math.max(4, Math.min(H - Math.min(h, 60) - 4, y / Z));
    app.style.left = x + 'px'; app.style.top = y + 'px'; app.style.transform = 'none';
    app.style.maxHeight = (H - y - 8) + 'px';                     // scrolls inside rather than running off the bottom
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
    // sized again, and kept on screen, when the window or the browser's zoom changes
    addEventListener('resize', refit);
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
    if (!wbs.classList.contains('busy')) { wbs.classList.remove('done'); sub(wbs, V.wb ? wbChosen().length + ' players' + (V.wb.day ? ' · ' + dayText(V.wb.day) : '') : 'Read it first'); }
    var stb = $('#snow'), sts = $('#snows');
    if (!stb.classList.contains('busy') && !stb.classList.contains('err')) sub(stb, S.st ? S.st.rows.length + ' players · ' + ago(S.st.at / 1000) : '');
    if (!sts.classList.contains('busy') && !sts.classList.contains('done')) sub(sts, "Today's card");
    var etb = $('#tower'), ets = $('#towers');
    if (!etb.classList.contains('busy') && !etb.classList.contains('err')) sub(etb, S.et ? S.et.rows.length + ' players · ' + ago(S.et.at / 1000) : '');
    if (!ets.classList.contains('busy') && !ets.classList.contains('done')) sub(ets, "Today's card");
    var mab = $('#mam'), mas = $('#mams');
    if (!mab.classList.contains('busy') && !mab.classList.contains('err')) sub(mab, S.ma ? S.ma.rows.length + ' players · ' + ago(S.ma.at / 1000) : '');
    if (!mas.classList.contains('busy') && !mas.classList.contains('done')) sub(mas, "Today's card");
    var evb = $('#evr');
    if (!evb.classList.contains('busy') && !evb.classList.contains('err')) sub(evb, S.ev ? S.ev.n + ' events · ' + ago(S.ev.at / 1000) : 'For the home page');
    var frb = $('#frr');
    if (!frb.classList.contains('busy') && !frb.classList.contains('err')) sub(frb, S.fr ? S.fr.n + ' servers · ' + ago(S.fr.at / 1000) : 'For the Frost page');
    var ncb = $('#ncr');
    if (!ncb.classList.contains('busy') && !ncb.classList.contains('err')) sub(ncb, S.nc ? S.nc.n + ' players · ' + ago(S.nc.at / 1000) : 'After a battle');
    var etp = $('#towerp');
    if (!etp.classList.contains('busy') && !etp.classList.contains('err')) sub(etp, S.etp ? S.etp.n + ' players · ' + ago(S.etp.at / 1000) : '');
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
  // every player read goes to the site's Whitebeard card, into its one column, the Practice Round (api/wb-update)
  function pushWb(rows, day) {
    var body = rows.map(function (r) { return { uid: r.uid, name: r.name, ally: r.ally, points: r.points }; });
    return fetch(API + '/wb-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: day, rows: body }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  // a read's date (UTC): the sheet's rows are dated with it; the card keeps every read in one column
  var wbDay = function () { return new Date().toISOString().slice(0, 10); };
  var dayText = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  $('#wb').onclick = async function () {
    if (busy) return;
    var day = wbDay();
    lock(true);
    var b = $('#wb'); start(b); sub(b, 'opening…');
    status('work', 'Opening the Whitebeard ranking…', .04);
    try {
      var read = await readWhitebeard(function (n, want) {
        var f = isFinite(want) && want ? Math.min(1, n / want) : .5;
        setP(b, .06 + .8 * f); sub(b, n + (isFinite(want) ? ' / ' + want : ''));
        status('work', 'Loading every rank… <b>' + n + '</b>' + (isFinite(want) ? ' of ' + want : ''), .06 + .8 * f);
      });
      read.at = Date.now(); read.day = day;
      if (!isFinite(read.want)) read.want = null;            // unknown total: saved as null, not Infinity
      V.wb = read; S.wb = read; save();
      setP(b, .9); sub(b, 'saving…');
      status('work', 'Updating the Whitebeard card…', .92);
      var card;
      try { await pushWb(read.rows, day); card = 'Card: the Practice Round updated'; }
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
    if (!V.wb.day) return nudge(b, 'No date on this read<small>Tap Read again.</small>');
    if (!rows.length) return nudge(b, 'Nobody to send<small>No player in this read matches ' + (V.wbFilter === 'ALL4' ? '698N, W, S, C' : 'Other') + '.</small>');
    var j = await sendTo(b, '/game-ranking', { rows: rows, date: V.wb.day }, rows.length + ' Whitebeard rows');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Whitebeard ranking sent<small>' + Number(j.rows).toLocaleString() + ' rows added, dated ' + esc(j.date) +
      ' · <a href="' + esc(j.link || SHEET) + '" target="_blank" rel="noopener">Open in Sheets ↗</a></small>');
  };

  /* Snow Train: the open Unit Details window to the site's card (api/st-update), and on Send to SS P2
     Snow Train as Date, Name, March CP, Unit Type, Alliance, Garrisoned?: today's column as the card has
     it, every read of the day combined and everyone on the card not there as No (api/st-send); the four
     alliances first, then everyone else */
  $('#snow').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#snow'); start(b); sub(b, 'opening…');
    try {
      var rows = await readSnowTrain(function (t, p) { status('work', t, p); setP(b, p); });
      status('work', 'Read <b>' + rows.length + '</b> players', .5);
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
    var j = await sendTo(b, '/st-send', {}, 'today\'s Snow Train');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Snow Train sent<small>dated ' + esc(j.date) + where(j) + '</small>');
  };

  /* Energy Tower: its Unit Details to the site's card (api/et-update), which sends back each player's
     alliance from the roster card, and on Send to the Energy Tower sheet (api/game-energytower) as
     Date, Name, March CP, Alliance, Points: today's column as the card has it, every read of the day
     combined (api/et-send), so it does not matter which device made the reads */
  $('#tower').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#tower'); start(b); sub(b, 'opening…');
    try {
      var rows = await readEnergyTower(function (t, p) { status('work', t, p); setP(b, p); });
      status('work', 'Read <b>' + rows.length + '</b> players', .5);
      S.et = { at: Date.now(), rows: rows }; save(); $('#towers').classList.remove('done');
      setP(b, .6); sub(b, 'saving…');
      status('work', 'Updating the Energy Tower card…', .7);
      var card;
      try {
        var u = await postJson('/et-update', { rows: rows.map(function (r) { return { uid: r.uid, name: r.name, ally: r.ally, points: r.power }; }) });
        (u.allies || []).forEach(function (a, i) { if (a && rows[i]) rows[i].ally = a; });
        save();
        card = (u.merged ? 'Card: added to today\'s column' : 'Card: new column added') + ' (' + u.day + ' UTC)';
      } catch (e) { card = 'Card not updated (' + esc(e.message || e) + ')'; }
      setP(b, 1); finish(b, true); sub(b, rows.length + ' players · now');
      status('ok', 'Energy Tower read · ' + rows.length + ' players<small>' + card + ' · tap Send to sheet for its sheet.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Nothing read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };
  $('#towers').onclick = async function () {
    if (busy) return;
    var b = $('#towers');
    var j = await sendTo(b, '/et-send', {}, 'today\'s Energy Tower');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Energy Tower sent<small>dated ' + esc(j.date) + where(j) + '</small>');
  };

  /* Mammoth Assault: its View Queues to the site's card (api/ma-update), which fills in each player's
     alliance from the roster card, and on Send to its sheet as Date, Name, March CP, Alliance,
     Garrisoned?: today's column as the card has it, every read of the day combined and everyone on the
     card not there as No (api/ma-send) */
  $('#mam').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#mam'); start(b); sub(b, 'opening…');
    try {
      var rows = await readMammoth(function (t, p) { status('work', t, p); setP(b, p); });
      status('work', 'Read <b>' + rows.length + '</b> players', .5);
      S.ma = { at: Date.now(), rows: rows }; save(); $('#mams').classList.remove('done');
      setP(b, .6); sub(b, 'saving…');
      status('work', 'Updating the Mammoth Assault card…', .7);
      var card;
      try {
        var u = await postJson('/ma-update', { rows: rows.map(function (r) { return { uid: r.uid, name: r.name, ally: r.ally, points: r.power }; }) });
        (u.allies || []).forEach(function (a, i) { if (a && rows[i]) rows[i].ally = a; });
        save();
        card = (u.merged ? 'Card: added to today\'s column' : 'Card: new column added') + ' (' + u.day + ' UTC)';
      } catch (e) { card = 'Card not updated (' + esc(e.message || e) + ')'; }
      setP(b, 1); finish(b, true); sub(b, rows.length + ' players · now');
      status('ok', 'Mammoth Assault read · ' + rows.length + ' players<small>' + card + ' · tap Send to sheet for its sheet.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Nothing read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };
  $('#mams').onclick = async function () {
    if (busy) return;
    var b = $('#mams');
    var j = await sendTo(b, '/ma-send', {}, 'today\'s Mammoth Assault');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Mammoth Assault sent<small>dated ' + esc(j.date) + where(j) + '</small>');
  };

  /* Events: every section's stage times to the site's home page (api/schedule) */
  $('#evr').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#evr'); start(b); sub(b, 'reading…');
    try {
      var ev = await readEvents(function (t, p) { status('work', t, p); setP(b, p); });
      setP(b, .85); sub(b, 'saving…'); status('work', 'Saving <b>' + ev.events.length + '</b> events for the home page…', .9);
      await postJson('/schedule', ev);
      S.ev = { at: Date.now(), n: ev.events.length }; save();
      setP(b, 1); finish(b, true); sub(b, ev.events.length + ' events · now');
      status('ok', 'Events saved · round ' + ev.round + '<small>' + ev.events.length + ' events and their stages, on the site\'s home page for everyone.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Events not saved<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  /* Read battle: the battle as it stands (tapped at its end, for the final result), saved under the
     contest's date in place of any read before (api/frost-battle); the Worker names masked players of ours
     from the roster and keeps no UIDs. */
  $('#frb').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#frb'); start(b); sub(b, 'reading…');
    try {
      var bt = await readBattle(function (t, p) { status('work', t, p); setP(b, p); });
      setP(b, .92); sub(b, 'saving…'); status('work', 'Saving the battle…', .95);
      var j = await postJson('/frost-battle', { day: contestDay(), status: bt.status, servers: bt.servers, players: bt.players });
      var us = bt.servers.filter(function (x) { return x.server === 2698; })[0];
      S.fb = { at: Date.now() }; save();
      setP(b, 1); finish(b, true); sub(b, 'read · now');
      status('ok', 'Battle read' + (us ? ' · S2698 #' + us.rank + ', ' + us.crystals.toLocaleString() + ' crystals' : '') +
        '<small>' + bt.status.length + ' battlefields, ' + bt.servers.length + ' servers, ' + bt.players.length + ' players · on the Frost page\'s Battle tab.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Battle not read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  /* Frost Crystal Contest: the contest's map and every server's top 20 to the site's Frost page
     (api/frost-read), each server looked up on the warzone map as a person would, a few seconds apart
     (two to three minutes for 35). A server that does not load is tried once more at the end, then left out. */
  $('#frr').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#frr'); start(b); sub(b, 'reading…');
    try {
      var fields = await readFrostMap(function (t, p) { status('work', t, p); setP(b, p); });
      var all = [].concat.apply([], fields), servers = {}, miss = [];
      status('work', 'Map read · <b>' + fields.length + '</b> battlefields, <b>' + all.length + '</b> servers · opening the warzone map…', .05);
      await wait(between(800, 1500));
      var wz = await warzoneMap();
      var go = async function (list, again) {
        for (var i = 0; i < list.length; i++) {
          var s = list[i], n = Object.keys(servers).length;
          status('work', 'Reading S' + s + ' <small>' + (n + 1) + ' of ' + all.length + (again ? ' · trying again' : '') + '</small>', .05 + .85 * n / all.length);
          setP(b, .05 + .85 * n / all.length); sub(b, (n + 1) + ' of ' + all.length);
          try { servers[s] = await readServerTop(wz.map, s); } catch (e) { if (!again) miss.push(s); }
          if (i < list.length - 1 || (!again && miss.length)) await restBetween();
        }
      };
      try {
        await go(all, false);
        if (miss.length) await go(miss.splice(0), true);
      } finally { wz.close(); }
      var got = Object.keys(servers).length;
      if (!got) throw new Error('no server\'s ranking loaded');
      setP(b, .92); sub(b, 'saving…'); status('work', 'Saving <b>' + got + '</b> servers for the Frost page…', .95);
      await postJson('/frost-read', { day: contestDay(), fields: fields, servers: servers });
      S.fr = { at: Date.now(), n: got }; save();
      var left = all.filter(function (s) { return !servers[s]; });
      setP(b, 1); finish(b, true); sub(b, got + ' servers · now');
      status('ok', 'Battlefields read · ' + got + ' of ' + all.length + ' servers · ' + contestDay() + '<small>' +
        (left.length ? 'Not loaded: ' + left.map(function (s) { return 'S' + s; }).join(', ') + '. ' : '') + 'On the site\'s Frost page for everyone.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Battlefields not read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  /* Read Neutral City: every battle date's Points Log and the round's cities to the site's Neutral City page
     (api/nc-read), each date replacing the one read before. No UIDs are sent. */
  $('#ncr').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#ncr'); start(b); sub(b, 'reading…');
    try {
      var saved = {};
      try { var g = await postJson('/nc-read', {}); Object.keys(g.days || {}).forEach(function (d) { if ((g.days[d].players || []).length) saved[d] = 1; }); } catch (e) {}
      var r = await readNeutral(function (t, p) { status('work', t, p); setP(b, p); }, saved), skipped = r.skipped; delete r.skipped;
      var ds = Object.keys(r.days).sort(), last = ds.length ? r.days[ds[ds.length - 1]].length : 0;
      setP(b, .92); sub(b, 'saving…'); status('work', 'Saving for the Neutral City page…', .95);
      await postJson('/nc-read', r);
      S.nc = { at: Date.now(), n: last }; save();
      setP(b, 1); finish(b, true); sub(b, last + ' players · now');
      status('ok', 'Neutral City read · ' + ds.length + ' ' + (ds.length === 1 ? 'battle' : 'battles') + '<small>' +
        (ds.length ? last + ' players on ' + dayText(ds[ds.length - 1]) + '. ' : '') +
        (skipped.length ? 'Already saved, not read again: ' + skipped.map(dayText).join(', ') + '. ' : '') +
        (r.summary ? 'Round ' + r.summary.round + '\'s cities read. ' : 'Cities not read: the round\'s battle is not over. ') + 'On the site\'s Neutral City page.</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Neutral City not read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  // where a send went (the Worker's sent, skipped and errors): each sheet with its rows and a link, then what was not sent
  function where(j) {
    var out = (j.sent || [{ to: 'the sheet', rows: j.rows, link: j.link }]).map(function (x) {
      return '<br>' + esc(x.to) + ': ' + Number(x.rows).toLocaleString() + ' rows' + (x.replaced ? ' (in place of ' + Number(x.replaced) + ' sent before)' : '') +
        ' · <a href="' + esc(x.link) + '" target="_blank" rel="noopener">Open ↗</a>' + (x.summaryError ? ' · Summary not sorted: ' + esc(x.summaryError) : '');
    }).join('');
    return out + (j.skipped || []).concat(j.errors || []).map(function (x) { return '<br>Not sent: ' + esc(x); }).join('');
  }
  // The Round sheet's Crystal tab (api/frost-send) and Input-Roster tab (api/roster-send): the Worker writes them from what
  // the site has (the Frost page's latest battle, the roster card), each row ending with the player's id
  $('#frs').onclick = async function () {
    if (busy) return;
    var b = $('#frs');
    var j = await sendTo(b, '/frost-send', {}, 'the latest Frost Crystal battle');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Frost Crystal sent<small>dated ' + esc(j.date) + where(j) + '</small>');
  };
  $('#rsh').onclick = async function () {
    if (busy) return;
    var b = $('#rsh');
    var n = Number($('#rround').value);
    var j = await sendTo(b, '/roster-send', { round: n }, 'the roster to Practice Round ' + n);
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' players · now');
    status('ok', 'Roster sent<small>' + Number(j.updated).toLocaleString() + ' updated, ' + Number(j.added).toLocaleString() + ' new at the end' +
      (j.left ? ', ' + Number(j.left).toLocaleString() + ' no longer in the four alliances' : '') + where(j) + '</small>');
  };

  // Roster to sheet's round: today's (the admin view's pick for today, else the season's schedule), changeable before a send
  fetch(API + '/round-of', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: new Date().toISOString().slice(0, 10) }) })
    .then(function (r) { return r.json(); }).then(function (j) { if (j && j.round) $('#rround').value = String(j.round); }).catch(function () {});

  $('#ncs').onclick = async function () {
    if (busy) return;
    var b = $('#ncs');
    var j = await sendTo(b, '/nc-send', {}, 'the latest Neutral City battle');
    if (!j) return;
    sub(b, 'Sent ' + Number(j.rows) + ' rows · now');
    status('ok', 'Neutral City sent<small>dated ' + esc(j.date) + where(j) + '</small>');
  };

  /* Read Fame: the treasury's Member List by Fame (last round), straight to the Fame sheet (api/fame-send) */
  $('#fmr').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#fmr'); start(b); sub(b, 'reading…');
    try {
      var r = await readFame(function (t, p) { status('work', t, p); setP(b, p); });
      setP(b, .9); sub(b, 'sending…'); status('work', 'Sending ' + r.rows.length + ' players to the Fame sheet…', .92);
      var j = await postJson('/fame-send', r);
      setP(b, 1); finish(b, true); sub(b, r.rows.length + ' players · now');
      status('ok', 'Fame sent<small>' + r.rows.length + ' players, Round ' + r.round + ', dated ' + esc(dayText(j.date || r.day)) + where(j) + '</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Fame not read<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  /* Energy Tower points: its Rankings to the site's card (api/et-points), each player's points in
     that day's column (column E of the sheet on Send) */
  $('#towerp').onclick = async function () {
    if (busy) return; lock(true);
    var b = $('#towerp'); start(b); sub(b, 'opening…');
    try {
      var rows = await readEnergyPoints(function (t, p) { status('work', t, p); setP(b, p); });
      status('work', 'Read <b>' + rows.length + '</b> players', .5);
      setP(b, .6); sub(b, 'saving…');
      status('work', 'Updating the Energy Tower card…', .7);
      var u = await postJson('/et-points', { rows: rows });
      S.etp = { at: Date.now(), n: rows.length }; save(); $('#towers').classList.remove('done');
      setP(b, 1); finish(b, true); sub(b, rows.length + ' players · now');
      status('ok', 'Energy Tower points read · ' + rows.length + ' players<small>Card: points in the ' + esc(u.day) + ' UTC column' +
        (u.added ? ' · ' + Number(u.added) + ' new on the card' : '') + '</small>');
    } catch (e) {
      finish(b, false); sub(b, 'tap to try again');
      status('bad', 'Points not saved<small>' + esc(e.message || e) + '</small>');
    }
    lock(false); refresh();
  };

  refresh();
  READY.then(refresh);
})();
