// Upcoming events on the home page: each section's stage times for the Seal Stone season, read in the
// game by the bookmark (Read events) and kept by the Worker (api/schedule). The game knows the Energy
// Building events' stages for the current round only, so later rounds get them shifted by the rounds'
// own start times, marked "expected" until a read in that round replaces them. Times are shown in the
// viewer's own time zone.
(function () {
  const API = location.hostname.endsWith('.workers.dev') ? '/api' : 'https://data-collection.jk06nm04.workers.dev/api';
  const CACHE = 'site.events';
  const INFO = {
    wb: ['Disruptive Whitebeard', 'g', '#whitebeard'], st: ['Snow Train', 'g', '#snowtrain'],
    et: ['Defend Energy', 'g', '#energytower'], ma: ['Mammoth Assault', 'g', '#mammoth'],
    tundra: ['Desolate Tundra', 'b', ''], frost: ['Frost Crystal Contest', 'b', '#frost'],
    feast: ['Monster Feast', 'b', ''], nc: ['Neutral City', 'o', ''], realm: ['Realm', 'p', ''],
    storm: ['Storm Duel', 'r', ''], blizzard: ['Blizzard', 'r', ''],
  };
  const COL = { g: '#22c55e', b: '#3b82f6', o: '#f59e0b', p: '#a855f7', r: '#ef4444' };
  const SHIFT = ['st', 'et', 'ma'];                      // the Energy Building's events, read for one round only
  const QUIET = /^(Settlement|Reward|Preview)$/;          // stages that don't make an event "on"
  const list = document.getElementById('evList'), rnd = document.getElementById('evRound'), box = document.getElementById('events');
  if (!list) return;
  const shut = new Set();                                // events whose stages were folded away
  let data = null, EV = [], all = false;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TZ = (() => { try { return new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName').value; } catch { return ''; } })();
  const tm = t => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayKey = t => new Date(t * 1000).toDateString();
  const dayName = t => new Date(t * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const wd = t => new Date(t * 1000).toLocaleDateString([], { weekday: 'short' });
  const when = (a, b) => b - a >= 86400 ? `${dayName(a)} – ${dayName(b)}` : a === b ? `${wd(a)} ${tm(a)}`
    : `${wd(a)} ${tm(a)} – ${dayKey(a) !== dayKey(b) ? wd(b) + ' ' : ''}${tm(b)}`;
  function left(s) {
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  }

  // the saved read as a list of events, the current round's Energy Building events carried to later rounds
  function build(d) {
    const out = [];
    const start = r => (d.rounds.find(x => x.round === r) || {}).st;
    for (const e of d.events) out.push({ ...e, est: false });
    for (const e of d.events) {
      if (!SHIFT.includes(e.id) || !start(e.round) || d.events.some(x => x.id === e.id && x.round > e.round)) continue;
      for (const r of d.rounds) {
        if (r.round <= e.round) continue;
        const dt = r.st - start(e.round);
        out.push({ id: e.id, round: r.round, est: true, stages: e.stages.map(([s, a, b]) => [s, a + dt, b + dt]) });
      }
    }
    return out.map(e => {
      const [n, c, href] = INFO[e.id] || [e.id, 'b', ''];
      const stages = e.stages.map(([s, st, et]) => ({ s, st, et }));
      const busy = stages.filter(s => !QUIET.test(s.s)), use = busy.length ? busy : stages;
      return { n, c, href, est: e.est, key: `${e.id}|${e.round}`, stages, st: use[0].st, et: Math.max(use.at(-1).et, use[0].st) };
    });
  }

  function draw() {
    if (!data) return;
    const now = Date.now() / 1000, today = dayKey(now), tmr = dayKey(now + 86400);
    const cur = data.rounds.find(r => r.st <= now && now < r.et), last = data.rounds.at(-1);
    rnd.textContent = cur ? `Round ${cur.round}/${data.rounds.length} · ends in ${left(cur.et - now)}`
      : now < data.rounds[0].st ? `Round 1 in ${left(data.rounds[0].st - now)}` : 'Season over';
    const row = e => {
      const cs = e.stages.find(s => s.st <= now && now < s.et), next = e.stages.find(s => s.st > now);
      const on = now >= e.st && now < e.et && cs && !QUIET.test(cs.s);
      const s = on ? `${esc(cs.s)} · ends in ${left(cs.et - now)}` : next ? `${e.stages.length > 1 ? esc(next.s) + ' · ' : ''}in ${left(next.st - now)}` : '';
      const multi = e.stages.length > 1, x = !shut.has(e.key);
      let h = `<div class="ev${on ? ' live' : ''}${multi ? ' tog' : ''}" data-k="${esc(e.key)}" style="--c:${COL[e.c]}"><i></i>` +
        `<span class="n">${esc(e.n)}${e.href ? ` <a class="go2" href="${e.href}" title="Open">↗</a>` : ''}` +
        `<small>${when(e.st, e.et)}${e.est ? ' · expected' : ''}</small></span><span class="s">${s}</span></div>`;
      if (multi && x) h += `<ol class="stages" style="--c:${COL[e.c]}">` + e.stages.map(t =>
        `<li class="${now >= t.et ? 'done' : now >= t.st ? 'now' : ''}"><b>${esc(t.s)}</b><span>${when(t.st, t.et)}</span></li>`).join('') + `</ol>`;
      return h;
    };
    const live = EV.filter(e => e.st <= now && now < e.et).sort((a, b) => a.et - b.et);
    const later = EV.filter(e => e.st > now).sort((a, b) => a.st - b.st);
    const soon = all ? later : later.filter(e => e.st < now + 4 * 86400);
    let h = live.length ? `<div class="evday today">Happening now</div>` + live.map(row).join('') : '', d = '';
    for (const e of soon) {
      const k = dayKey(e.st);
      if (k !== d) { d = k; h += `<div class="evday${k === today ? ' today' : ''}">${k === today ? 'Later today' : k === tmr ? 'Tomorrow · ' + dayName(e.st) : dayName(e.st)}</div>`; }
      h += row(e);
    }
    if (!live.length && !soon.length) h += `<p class="evnote">Nothing coming up${now > last.et ? ': the season is over' : ''}.</p>`;
    const more = later.length - later.filter(e => e.st < now + 4 * 86400).length;
    if (more || all) h += `<button type="button" class="evmore" id="evMore">${all ? 'Show less' : `Show ${more} more`}</button>`;
    h += `<p class="evnote">Times are in your time zone${TZ ? ` (${esc(TZ)})` : ''}. Tap an event to fold its stages away.</p>`;
    list.innerHTML = h;
  }

  function use(d) {
    if (!d || !Array.isArray(d.events) || !Array.isArray(d.rounds) || !d.rounds.length) return false;
    data = d; EV = build(d); box.hidden = false; draw(); return true;
  }
  list.addEventListener('click', ev => {
    if (ev.target.closest('a')) return;
    if (ev.target.id === 'evMore') { all = !all; return draw(); }
    const r = ev.target.closest('.ev.tog'); if (!r) return;
    const k = r.dataset.k, x = !!r.nextElementSibling && r.nextElementSibling.matches('ol.stages');
    if (x) shut.add(k); else shut.delete(k);
    draw();
  });

  // the last copy at once, then the Worker's
  try { use(JSON.parse(localStorage.getItem(CACHE))); } catch {}
  if (!data) list.innerHTML = '<p class="evnote">Loading…</p>';
  fetch(API + '/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (use(d)) { try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch {} }
      else if (!data) list.innerHTML = '<p class="evnote">No events yet. Tap <b>Read events</b> in the bookmark, in the game, to add them.</p>';
    })
    .catch(() => { if (!data) list.innerHTML = '<p class="evnote">Couldn\'t load the events. Try reloading the page.</p>'; });
  setInterval(draw, 30000);
})();
