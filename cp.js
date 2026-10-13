/* ---------------- Base CP tab ---------------- */
// A second extractor on the same page, for the alliance member list rather than the Ranking
// board. Each member card has an avatar, a gender symbol and the name beside it, then
// "Level: 100" and "CP: 98.4M". The output is two columns — In-game Name and Base CP.
//
// Loaded after the main script and built out of its parts: the same frame sampler, the same
// Worker and retry (on Gemini rather than Ollama — see cpCallModel), the same roster and the same matcher (makeMatcher) deciding who
// each card is. Only the question put to the model and the table differ, so the two tabs
// cannot drift apart in how they read a recording or name a player.

let cpFile = null, cpRows = [], cpHeaders = [];

/* tabs */
function showTab(name) {
  document.querySelectorAll('.tabs .tab').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  $('tab-kartz').classList.toggle('hide', name !== 'kartz');
  $('tab-cp').classList.toggle('hide', name !== 'cp');
  closeMenu();
  // in the address, so a link or a reload lands on the same tab
  history.replaceState(null, '', name === 'cp' ? '#cp' : location.pathname + location.search);
}
document.querySelectorAll('.tabs .tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
showTab(location.hash === '#cp' ? 'cp' : 'kartz');

/* setup and file */
$('cpPull').onclick = () => pullNow($('cpPull'), 'cpLog');
$('cpDrop').onclick = () => $('cpFile').click();
$('cpFile').onchange = e => cpPick(e.target.files[0]);
['dragover', 'dragenter'].forEach(ev => $('cpDrop').addEventListener(ev, e => {
  e.preventDefault(); $('cpDrop').classList.add('on'); }));
['dragleave', 'drop'].forEach(ev => $('cpDrop').addEventListener(ev, e => {
  e.preventDefault(); $('cpDrop').classList.remove('on'); }));
$('cpDrop').addEventListener('drop', e => cpPick(e.dataTransfer.files[0]));
function cpPick(f) {
  if (!f) return;
  cpFile = f;
  $('cpFileName').textContent = f.name + '  ·  ' + (f.size / 1e6).toFixed(0) + ' MB';
  refreshState();
}
refreshState();                      // the main script ran it before this file existed

/* model */
// The roster goes in exactly as it does on the Ranking tab — "sheet name = name as drawn" —
// because choosing which known player a card shows is far easier than transcribing a stylised
// name, and the matcher checks the model's choice against what was drawn either way.
function cpPrompt() {
  const names = currentRoster().map(r => {
    const a = (r.search || '').trim(), b = (r.ingame || '').trim();
    if (!a) return '';
    return (b && b !== a) ? `${a} = ${b}` : a;
  }).filter(Boolean);
  return `These are frames from a screen recording of a mobile game's alliance member list.
Each member is a card with a square avatar picture on the left. To the right of the avatar is a
gender symbol (♂ or ♀) followed by the player's name, then a line "Level: <n>", then a line
"CP: <value>", for example "CP: 98.4M" or "CP: 103M". Cards sit in two columns, and headers
such as "R3 14 / 114" separate the rank groups.

The members are drawn from the known roster below. Nearly every card is one of these people.
For any name that is stylised, decorative, symbolic or in unusual Unicode, do not read it
character by character: compare its overall shape with the roster and answer with the member
it looks like. Still fill in "seen" with your honest literal reading of what is drawn — a
person checks the match against it, so never copy the roster name into "seen".

Known players (${names.length}), written as "sheet name = name as drawn in the game".
The cards show the RIGHT-hand form. Match what is on screen against those, then answer with the
LEFT-hand sheet name. Where only one name is listed, the two forms are identical.
This list is reference material — never report a word from it as a card you saw.
${names.join(', ')}

Return one JSON object with two lists:
{"cards": [ {"roster_name": "<a name copied exactly from the ROSTER, or null>", "seen": "<the name as drawn>", "cp": "<the text after CP:, e.g. 98.4M>"}, ... ],
 "headers": [ {"group": "<R1 to R5>", "size": "<the number after the slash>", "first_card": "<the name on the first card directly below the header, as drawn>"}, ... ]}

"cards" holds every member card you can read across ALL the images, in the order you see them.
"headers" holds the group headers that are actually visible: bars reading
"R<n>  <online> / <size>" — the group (R1 to R5), how many are online, and after the slash the
group's size. Leave "headers" empty when none is visible.

Rules:
- "roster_name" MUST be copied character-for-character from the list above, or be null if you
  are genuinely confident this player is not on it. Never invent a spelling.
- "seen" is the name exactly as drawn, including emoji, symbols and decorations that are part
  of the name (a ⚒ or 💯 beside the letters belongs to the name). Leave out the ♂/♀ symbol.
- "cp" is copied exactly, including its decimal point and unit letter: "56.3M", "103M". Most
  CP values have one digit after a small decimal point — look for it, and never drop it:
  "56.3M" written as "563M" is wrong by ten times.
- The same member appears in several frames. List every sighting; do not deduplicate.
- Ignore the "Level" line, "Online" / "2 hr ago" labels and Manage buttons.
- If a card is cut off at an edge so that its name or CP cannot be read fully, skip it.
- Write emoji and symbols as the characters themselves (🌹, ⚡, Ø). Never as HTML entities such
  as &#127801; or escape codes.
- Output raw JSON only. No markdown fence, no commentary.`;
}
// Cards and group headers in separate lists. Mixed into one list, with neither kind's fields
// required, the model split every card in two — a name in one object, its CP in the next.
const CP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          roster_name: { type: 'STRING' },
          seen:        { type: 'STRING' },
          cp:          { type: 'STRING' },
        },
        required: ['seen', 'cp'],
      },
    },
    headers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          group:      { type: 'STRING' },
          size:       { type: 'STRING' },
          first_card: { type: 'STRING' },
        },
        required: ['group', 'size'],
      },
    },
  },
  required: ['cards', 'headers'],
};

// "98.4M" -> 98.4, in millions, which is how the roster's CP column is kept (64, 73.9).
// A comma followed by one or two digits is a decimal point written the European way — "56,3M"
// is 56.3, not 563. A CP in millions never needs a thousands separator.
function cpValue(s) {
  const m = String(s ?? '').replace(/\s/g, '').match(/(\d[\d,]*(?:\.\d+)?)([KMBT]?)/i);
  if (!m) return null;
  const digits = /^\d+,\d{1,2}$/.test(m[1]) ? m[1].replace(',', '.') : m[1].replace(/,/g, '');
  const n = parseFloat(digits);
  const scale = { K: 1e-3, M: 1, B: 1e3, T: 1e6 }[m[2].toUpperCase()] ?? 1e-6;
  return +(n * scale).toFixed(3);
}

// This tab runs on Gemini, through the Worker's /api/gemini route, where the key lives; the
// Ranking tab stays on Ollama. The key is on the paid tier (4,000 requests and 4M tokens a
// minute), so there is no pacing: every batch goes out at once, and a run is done in about the
// time of its slowest answer — measured at 13 seconds end to end, 7 of them the model.
//
// gemini-3.1-flash-lite, the same model as the Kartz tab. (2.5-flash-lite is refused outright
// for this key: "no longer available to new users", 404.)
//
// What is watched instead of the rate is the run's total, which should stay under 250,000
// tokens; it is logged after each run. Measured on a 165-image member list:
//   full image detail    259k — images 181k (~1,100 each), roster+prompt 63k, output 15k
//   medium image detail  170k — images ~90k, the rest the same
// Medium was no worse, and on that run better: every CP decimal still read correctly, 3 rows
// to confirm instead of 6, and one card full detail misread as 100 came back as its real 87.
// (Both on 3.5-flash-lite. On 3.1-flash-lite, minimal thinking and medium detail: 168k, 8 s end
// to end, 161 members, 157 matched, 4 to confirm, every spot-checked CP exact.)
//
// 16 images a request: at 24 the decimal points went missing, and below 16 the roster, which
// goes with every request, starts to cost more than the images saved by medium detail.
const CP_MODEL = 'gemini-3.1-flash-lite';
const CP_BATCH = 16;
// minimal thinking: on 3.1 the "low" level spent ~8k thinking tokens a request on the Kartz tab
const CP_CONFIG = { thinkingConfig: { thinkingLevel: 'minimal' }, mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' };
const CP_RUN_BUDGET = 250000;

async function cpCallModel(frames) {
  const batches = [];
  for (let i = 0; i < frames.length; i += CP_BATCH) batches.push(frames.slice(i, i + CP_BATCH));
  const spec = { prompt: cpPrompt(), schema: CP_SCHEMA, parse: cpParse, config: CP_CONFIG };
  let done = 0;
  cpCallModel.tokens = 0; cpCallModel.slowest = 0;
  const one = async (b, bi) => {
    const got = await withFallback(async m => {
      const call = { ...spec };          // its own, so its usage is not another request's
      const t0 = Date.now();
      const got = await callProxy(b, m, API_BASE + '/gemini', call);
      cpCallModel.tokens += call.usage || 0;
      cpCallModel.slowest = Math.max(cpCallModel.slowest, Date.now() - t0);
      return got;
    }, [CP_MODEL], () => {}, true);
    done++; setProg(0.5 + 0.5 * done / batches.length);
    log(`read ${done} of ${batches.length} batches…`);
    // The batch number keeps the list order: batches finish in any order, frames do not. A header
    // is placed just before the card it names as the first below it; failing that, at the head of
    // its batch, which is where a header is first seen as the list scrolls up past it.
    const cards = got.filter(s => !s.header).map((s, i) => ({ ...s, order: bi * 1e4 + i }));
    const heads = got.filter(s => s.header).map(h => {
      const j = h.first ? cards.findIndex(c => c.seen === h.first || fold(c.seen) === fold(h.first)) : -1;
      return { ...h, order: j >= 0 ? cards[j].order - 0.5 : bi * 1e4 - 0.5 };
    });
    return [...cards, ...heads];
  };
  return (await inTurn(batches, one, batches.length)).flat();
}

// Gemini sometimes writes non-ASCII characters as HTML entities — "Martha &#127801;" for
// Martha🌹, "x&#216;&#162;x" for xØ¢x — even inside JSON. The reading is right; only the
// spelling is wrong, and it stops every such name matching the roster. Turn them back into
// characters before anything else sees them.
const CP_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function cpDecode(s) {
  // "&#119982; &#8499; &#8499;" is one three-glyph name: the spaces are the entity writer's,
  // not the player's, so they go before decoding
  return String(s ?? '').replace(/(&#x?[0-9a-f]+;)\s+(?=&#)/gi, '$1')
                        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return CP_ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
  });
}

// Row objects one at a time, as on the Ranking tab, so a reply cut off mid-array keeps
// everything before the cut.
function cpParse(text) {
  const objs = text.match(/\{[^{}]*\}/g) || [];
  const out = [];
  for (const o of objs) {
    try {
      const r = JSON.parse(o);
      const group = !r.seen && String(r.group || '').toUpperCase().match(/R[1-5]/);
      if (group) {
        const total = parseInt(String(r.size ?? '').replace(/\D/g, ''), 10);
        out.push({ header: group[0], total: total > 0 ? total : null,
                   first: cpDecode(r.first_card).trim() });
        continue;
      }
      const seen = cpDecode(r.seen || r.roster_name).trim();
      // a CP put in the wrong field is still the card's CP
      const cp = cpValue(r.cp ?? Object.values(r).find(v => /^\s*\d[\d.,]*\s*[KMB]\s*$/i.test(String(v))));
      // a name that decoded to nothing but replacement characters is not a reading
      if (seen && /[^�\s?]/.test(seen) && cp !== null && cp > 0)
        out.push({ seen, claim: cpDecode(r.roster_name).trim(), cp });
    } catch { /* half-written object at the cut */ }
  }
  if (!out.length && !objs.length && !/^\s*[\[{]/.test(text.trim()))
    throw new Error('model returned no readable rows:\n' + text.slice(0, 200));
  return out;
}

/* consolidation */
// Sightings of one card are gathered into a group first, then the group is identified — the
// same order the Ranking tab uses, so every reading of a card counts towards naming it. There
// is no rank to group by here, so the key is the drawn name, and groups whose names are close
// (similar once folded, or one the start of the other: W💤 and W💤ᶻᶻ) and whose CP agrees are
// folded together.
// The CP of one card across its sightings. A reading that lost its decimal point is exactly
// ten times another reading of the same card, and the one with the point is the right one —
// the point can be missed, it is never invented.
function cpBest(values) {
  const have = new Set(values.map(v => +v.toFixed(3)));
  return mode(values.map(v => have.has(+(v / 10).toFixed(3)) ? +(v / 10).toFixed(3) : v));
}
function cpGroups(sightings) {
  const byName = new Map();
  for (const s of sightings) {
    if (!byName.has(s.seen)) byName.set(s.seen, []);
    byName.get(s.seen).push(s);
  }
  const groups = [...byName.values()]
    .map(g => ({ items: g, cp: cpBest(g.map(x => x.cp)) }))
    .sort((a, b) => b.items.length - a.items.length);
  const kept = [];
  for (const g of groups) {
    const a = g.items[0].seen, k = fold(a);
    const into = kept.find(h => {
      if (h.cp !== g.cp) return false;
      const b = h.items[0].seen;
      // the CP already agrees to the decimal, so the names need only be close: ŧanjirŏ and
      // łanjiroơ are one player read twice
      return (k && sim(k, fold(b)) >= 0.7) || a.startsWith(b) || b.startsWith(a);
    });
    if (into) into.items.push(...g.items); else kept.push(g);
  }
  // shaped like a Ranking row, which is what makeMatcher reads
  return kept.map(({ items }) => {
    const claims = items.map(x => x.claim).filter(Boolean);
    const name = mode(items.map(x => x.seen));
    return {
      name, plain: name,
      obs: [...new Set(items.map(x => x.seen))],
      claims: [...new Set(claims)],
      pick_: claims.length ? mode(claims) : '',
      cp: cpBest(items.map(x => x.cp)),
      seen: items.length,
      order: Math.min(...items.map(x => x.order)),
    };
  });
}
function cpIdentify(groups, roster) {
  const rows = groups.map(makeMatcher(buildIndex(roster), [], store.get('aliases') || {}));
  // Two cards resolving to one player. Where the CP agrees they are one card read two ways,
  // and become one row. Where it does not, at least one of them is wrong and nothing here can
  // say which — so, as on the Ranking tab, neither keeps the match and both are raised.
  const byPlayer = new Map();
  for (const r of rows) {
    if (!r.match) continue;
    const k = fold(r.match.search) || r.match.search;
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push(r);
  }
  const gone = new Set();
  for (const [, group] of byPlayer) {
    if (group.length < 2) continue;
    if (group.every(r => r.cp === group[0].cp)) {
      const [first, ...rest] = group.sort((a, b) => a.order - b.order);
      for (const r of rest) {
        first.seen += r.seen;
        first.obs = [...new Set([...first.obs, ...r.obs])];
        gone.add(r);
      }
    } else for (const r of group) { r.match = null; r.pick = ''; r.score = 0; }
  }
  // A card read two ways, where one reading matched and the other did not: DƐƐ left for you,
  // 𝒟ℰℰ matched to Dee, both 75.6 — one card, counted twice, which the group headers then showed
  // as one member too many. An unmatched card joins a matched one when the CP agrees exactly, and
  // only one matched card has it, and its reading passes the same plausibility test the matcher
  // uses for the model's own claims. Two different players sharing a CP are both matched already,
  // so they never meet this.
  for (const r of rows) {
    if (r.match || gone.has(r)) continue;
    const same = rows.filter(o => o.match && !gone.has(o) && o.cp === r.cp);
    if (same.length !== 1) continue;
    const into = same[0];
    if (!(r.obs || [r.name]).some(o => claimPlausible(o, into.match))) continue;
    into.seen += r.seen;
    into.obs = [...new Set([...into.obs, ...(r.obs || [])])];
    into.order = Math.min(into.order, r.order);
    gone.add(r);
  }
  const out = rows.filter(r => !gone.has(r)).sort((a, b) => a.order - b.order);
  // A card whose every reading dropped the point has no dotted reading to be corrected by, and
  // lands at ten times its CP: 563 among players in the 40s to 140s. A whole number more than
  // 3.5 times the list's median is taken as that, divided by ten, and shown with what was read
  // so it can be checked. Real CPs that far above an alliance's middle do not occur in practice.
  const cps = out.map(r => r.cp).filter(v => v > 0).sort((a, b) => a - b);
  const median = cps[cps.length >> 1] || 0;
  if (cps.length >= 8)
    for (const r of out)
      if (Number.isInteger(r.cp) && r.cp >= 100 && r.cp > median * 3.5) {
        r.cpRead = r.cp;
        r.cp = +(r.cp / 10).toFixed(1);
      }
  return out;
}

/* run */
$('cpGo').onclick = async () => {
  $('cpGo').disabled = true; $('cpOut').classList.add('hide');
  logEl = 'cpLog'; progEl = 'cpProg';
  try {
    const roster = currentRoster();
    if (!roster.length) throw new Error('No roster loaded — press Pull / Update Alliance Roster.');
    log('decoding video…'); setProg(0);
    const spentBefore = callProxy.spent || 0;
    const frames = await extractFrames(cpFile, +$('sens').value,
      (p, n) => { setProg(p * 0.5); log(`sampling video — ${n} frames kept`); });
    if (!frames.length) throw new Error('no frames captured');
    $('cpStrip').innerHTML = frames.slice(0, 24)
      .map(f => `<img src="data:image/jpeg;base64,${f}">`).join('');
    log(`${frames.length} frames — sending…`);
    const sightings = await cpCallModel(frames);
    cpHeaders = sightings.filter(s => s.header);
    const cards = sightings.filter(s => !s.header);
    cpRows = cpIdentify(cpGroups(cards), roster);
    cpRender();
    const t = (callProxy.spent || 0) - spentBefore;
    const short = cpCount().list.reduce((n, g) => n + Math.max(0, (g.total || 0) - g.found), 0);
    log(`done — ${cards.length} readings → ${cpRows.length} members · `
        + (short ? `${short} fewer than the group headers say · ` : '')
        + `${Math.round(t / 1000)}k tokens · slowest answer ${Math.round(cpCallModel.slowest / 1000)}s`
        + (t > CP_RUN_BUDGET ? ' (over the 250k budget)' : ''));
    setProg(1);
  } catch (e) { log('✗ ' + e.message); }
  logEl = 'log'; progEl = 'prog';
  refreshState();
};

/* output */
// The same row controls as the Ranking tab: a matched name can be changed with ✎, an
// unmatched one either ticked as right as drawn or searched for in the roster, and any row
// thrown out with ✕. The name that goes out is outName's — the roster's in-game form.
const cpOpen = r => !r.dropped && (r.editing || (!r.match && !r.confirmed && !r.pick));
// Checking the run against the list's own headers. Member cards carry no rank, so a card the
// run never read leaves no hole to point at — but every group header states the group's size,
// "R3 14 / 114", so each group's cards can be counted against it. A card belongs to the last
// header before its first sighting in list order. Cards above the first header seen (a recording
// that starts just below one) are counted but cannot be checked.
function cpCount() {
  const byName = new Map();
  for (const h of cpHeaders) {
    const g = byName.get(h.header) || { name: h.header, order: Infinity, totals: [], found: 0 };
    g.order = Math.min(g.order, h.order);
    if (h.total) g.totals.push(h.total);
    byName.set(h.header, g);
  }
  const list = [...byName.values()].sort((a, b) => a.order - b.order)
    .map(g => ({ ...g, total: g.totals.length ? mode(g.totals) : null }));
  let above = 0;
  for (const r of cpRows) {
    if (r.dropped) continue;
    let g = null;
    for (const h of list) if (h.order <= r.order) g = h;
    if (g) g.found++; else above++;
  }
  return { list, above };
}
function cpRender() {
  closeMenu();
  const kept = cpRows.filter(r => !r.dropped).length;
  const need = cpRows.filter(cpOpen).length;
  const matched = cpRows.filter(r => !r.dropped && r.match).length;
  const { list, above } = cpCount();
  const checked = list.filter(g => g.total);
  const short = checked.filter(g => g.found < g.total), over = checked.filter(g => g.found > g.total);
  $('cpVerdict').innerHTML = `<div class="${need ? 'warnbox' : 'okbox'}">${kept} members`
    + ` &middot; ${matched} matched to the roster`
    + (need ? ` &middot; <strong>${need} to confirm below</strong>` : '') + '</div>'
    + (checked.length ? `<div class="${short.length || over.length ? 'warnbox' : 'okbox'}">`
        + (above ? `${above} above the first header (not checked) &middot; ` : '')
        + checked.map(g => `${esc(g.name)}: ${g.found} of ${g.total}`).join(' &middot; ')
        + (short.length ? `<br><strong>${short.map(g => `${g.total - g.found} missing from ${esc(g.name)}`)
            .join(', ')}</strong> — that stretch was not read in full; record it again more slowly.` : '')
        + (over.length ? `<br>${over.map(g => `${esc(g.name)} has ${g.found - g.total} more than its header`)
            .join(', ')} — probably a card read twice under two names; look for a near-duplicate.` : '')
        + '</div>' : '');
  $('cpTbl').innerHTML = '<thead><tr><th>#</th><th>Name in video</th><th>In-game Name</th>'
    + '<th>Base CP</th><th></th><th></th></tr></thead><tbody>'
    + cpRows.map((r, i) => {
        const green = r.match || r.confirmed;
        return `<tr class="${green || r.pick ? 'ok' : 'new'}${r.dropped ? ' drop' : ''}">
        <td>${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td>${!r.editing
              ? `<span class="${green || r.pick ? 'named' : 'asdrawn'}">${esc(outName(r))}</span>`
                + `<button class="pencil" data-i="${i}" title="change this name">✎</button>`
                + (!green && !r.pick ? `<button class="ghost tickok" data-i="${i}"`
                    + ` title="this name is right as it is"`
                    + ` style="width:auto;padding:4px 9px;margin-left:6px">✓</button>` : '')
              : `<input class="pickbox" data-i="${i}" placeholder="type to search…"
                        value="${esc(outName(r))}" spellcheck="false">`}</td>
        <td>${r.cp}${r.cpRead ? ` <span class="note" title="the decimal point was missed">`
              + `read ${r.cpRead}</span>` : ''}</td>
        <td>${r.match ? `<span class="pill p-ok">${r.near1 ? '1 char' : 'exact'}</span>`
            : r.confirmed || r.pick ? '<span class="pill p-ok">confirmed</span>'
                                    : '<span class="pill p-new">confirm</span>'}</td>
        <td><button class="ghost cpdrop" data-i="${i}"
                    title="${r.dropped ? 'bring this row back' : 'not a real row'}"
                    style="width:auto;padding:4px 9px">${r.dropped ? '↺' : '✕'}</button></td>
      </tr>`; }).join('') + '</tbody>';
  const tbl = $('cpTbl');
  tbl.querySelectorAll('.pencil').forEach(b => b.onclick = () => {
    cpRows[+b.dataset.i].editing = true;
    cpRender();
    const box = tbl.querySelector(`.pickbox[data-i="${b.dataset.i}"]`);
    if (box) { box.focus(); box.select(); }
  });
  tbl.querySelectorAll('.tickok').forEach(b => b.onclick = () => {
    cpRows[+b.dataset.i].confirmed = true;
    cpRender();
  });
  tbl.querySelectorAll('.pickbox').forEach(inp => {
    const r = cpRows[+inp.dataset.i];
    wirePicker(inp, (v, committed) => {
      if (!committed) return;
      // choosing here is the answer: it replaces whatever the matcher decided
      Object.assign(r, { pick: v, match: null, editing: false, confirmed: true });
      closeMenu();
      setTimeout(cpRender, 0);
    });
    // Leaving the box without choosing puts the row back as it was. The menu's own clicks
    // keep focus in the box, so a blur means somewhere else was clicked.
    inp.onblur = () => setTimeout(() => {
      if (r.editing && document.activeElement !== inp) { r.editing = false; cpRender(); }
    }, 150);
  });
  tbl.querySelectorAll('.cpdrop').forEach(b => b.onclick = () => {
    const r = cpRows[+b.dataset.i];
    r.dropped = !r.dropped;
    if (r.dropped) r.editing = false;
    cpRender();
  });
  $('cpOut').classList.remove('hide');
  cpRefreshSend();
}

const CP_HEADERS = ['In-game Name', 'Base CP'];
const cpOut = () => cpRows.filter(r => !r.dropped).map(r => [outName(r), r.cp]);
$('cpCopy').onclick = async () => {
  const tsv = cpOut().map(r => r.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    flash($('cpCopy'), `Copied ${cpOut().length} rows ✓`);
  } catch { prompt('Copy these rows:', tsv); }
};
$('cpCsv').onclick = () => {
  const csv = CP_HEADERS.join(',') + '\n'
    + cpOut().map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `base-cp-${new Date().toLocaleDateString('en-CA')}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
  flash($('cpCsv'), 'Downloaded ✓');
};
// The same store as the Ranking tab's button, so a name fixed on either tab is recognised on
// both from then on. An alliance already filed with the name is kept.
$('cpLearn').onclick = () => {
  const a = store.get('aliases') || {};
  let n = 0;
  for (const r of cpRows) {
    if (r.match || !r.pick || r.dropped) continue;
    const key = aliasKey(r.plain || r.name), had = a[key];
    a[key] = { name: r.pick, alliance: (had && typeof had === 'object' && had.alliance) || '' };
    n++;
  }
  store.set('aliases', a);
  logEl = 'cpLog';
  log(n ? `remembered ${n} name${n > 1 ? 's' : ''} — they will match automatically next time`
        : 'nothing new to remember');
  logEl = 'log';
  flash($('cpLearn'), n ? `Remembered ${n} ✓` : 'Nothing new');
};

/* ---------------- send to sheet ---------------- */
// Alliance Rosters, columns A to I: cp_load_date, cp_submitter, cp_search_name, cp_ign_name,
// cp_alliance, then four CP columns — base, march 1, march 2, march 3. A recording is of one of
// those, so the CP type says which column the run's numbers go in and the other three are left
// empty. The Worker holds where Alliance Rosters is; the page only names the target.
const CP_ROSTERS_TAB =
  'https://docs.google.com/spreadsheets/d/1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8/edit#gid=237521468';

// Submitter and Alliance are the Kartz tab's own, kept in step both ways: whoever is sending
// is the same person on either tab, and the device remembers them once. The CP type is not
// remembered — it starts empty on every visit, so a run cannot go to last time's column by habit.
for (const [mine, theirs] of [['cpSubmitter', 'submitter'], ['cpAlliance', 'alliance']]) {
  $(mine).value = $(theirs).value;
  for (const ev of ['change', 'input']) {
    $(mine).addEventListener(ev, () => {
      $(theirs).value = $(mine).value;
      store.set(theirs, $(mine).value);
      if (rows.length) render(lastRoster);
      cpRefreshSend();
    });
    $(theirs).addEventListener(ev, () => { $(mine).value = $(theirs).value; cpRefreshSend(); });
  }
}
wireSubmitter($('cpSubmitter'));
$('cpType').addEventListener('change', () => cpRefreshSend());

function cpSheetRows() {
  const stamp = loadStamp(new Date()), col = $('cpType').value;
  return cpRows.filter(r => !r.dropped).map(r => {
    const p = outPlayer(r), cps = ['', '', '', ''];
    if (col !== '') cps[+col] = r.cp;
    return [stamp, $('cpSubmitter').value.trim(), p.search, p.ingame, $('cpAlliance').value, ...cps];
  });
}
// Same rule as the Kartz tab: nothing goes while a name is undecided or a field is empty.
function cpSendBlockers() {
  const out = [];
  const open = cpRows.filter(cpOpen).length;
  if (open) out.push(`${open} row${open > 1 ? 's' : ''} to confirm`);
  const missing = [['cpSubmitter', 'submitter'], ['cpAlliance', 'alliance'], ['cpType', 'CP type']]
    .filter(([id]) => !$(id).value.trim()).map(([, name]) => name);
  if (missing.length) out.push('choose a ' + missing.join(', '));
  if (!cpRows.some(r => !r.dropped)) out.push('no rows to send');
  return out;
}
// what identifies a send: every cell but the stamp, which moves with the clock
const cpSendKey = (values = cpSheetRows()) => JSON.stringify(values.map(v => v.slice(1)));
let cpSending = false, cpLastSent = '', cpSentLabel = '';
function cpRefreshSend() {
  const why = cpSendBlockers();
  const n = cpRows.filter(r => !r.dropped).length;
  $('cpSend').disabled = why.length > 0 || cpSending;
  // once sent, the button says where the rows went, until the rows change
  const sent = !cpSending && cpLastSent && cpSendKey() === cpLastSent;
  if (!cpSending) $('cpSend').textContent = sent ? cpSentLabel : `Send ${n} row${n === 1 ? '' : 's'} to sheet`;
  $('cpSend').classList.toggle('done', !!sent);
  $('cpSheetLink').classList.toggle('hide', !sent);
  $('cpSendNote').textContent = why.length ? 'Before sending: ' + why.join(' · ') : '';
}
$('cpSend').onclick = async () => {
  if (cpSendBlockers().length) return cpRefreshSend();
  const values = cpSheetRows();
  const key = cpSendKey(values);
  if (key === cpLastSent
      && !confirm('These exact rows were already sent to the sheet. Send them again?')) return;
  cpSending = true; $('cpSend').disabled = true; $('cpSend').textContent = 'Sending…';
  logEl = 'cpLog';
  try {
    const r = await fetch(API_BASE + '/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'cp', values }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `sheet refused the rows (${r.status})`);
    log(`appended ${values.length} rows to ${j.book || 'Alliance Rosters'}${j.range ? ' at ' + j.range : ''}`);
    cpLastSent = key;
    cpSentLabel = `Sent ${values.length} row${values.length === 1 ? '' : 's'} to `
                + `${j.book || 'Alliance Rosters'} → ${j.tab || 'sheet'}`;
    // straight to the rows just written, colon and all: Sheets reads it from the #fragment
    const cells = (j.range || '').replace(/^.*!/, '');
    $('cpSheetLink').href = CP_ROSTERS_TAB + (/^[A-Z]+\d+(:[A-Z]+\d+)?$/.test(cells) ? '&range=' + cells : '');
  } catch (e) { log('✗ ' + e.message); }
  logEl = 'log';
  cpSending = false;
  cpRefreshSend();
};
