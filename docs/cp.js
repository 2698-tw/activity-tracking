/* ---------------- Base CP tab ---------------- */
// A second extractor on the same page, for the alliance member list rather than the Ranking
// board. Each member card has an avatar, a gender symbol and the name beside it, then
// "Level: 100" and "CP: 98.4M". The output is two columns — In-game Name and Base CP.
//
// Loaded after the main script and built out of its parts: the same frame sampler, the same
// Worker and retry (on Gemini rather than Ollama — see cpCallModel), the same roster and the same matcher (makeMatcher) deciding who
// each card is. Only the question put to the model and the table differ, so the two tabs
// cannot drift apart in how they read a recording or name a player.

let cpFile = null, cpRows = [];

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

Return every member card you can read across ALL the images as a single JSON array, one object
per card:
{"roster_name": "<a name copied exactly from the ROSTER, or null>", "seen": "<the name as drawn>", "cp": "<the text after CP:, e.g. 98.4M>"}

Rules:
- "roster_name" MUST be copied character-for-character from the list above, or be null if you
  are genuinely confident this player is not on it. Never invent a spelling.
- "seen" is the name exactly as drawn, including emoji, symbols and decorations that are part
  of the name (a ⚒ or 💯 beside the letters belongs to the name). Leave out the ♂/♀ symbol.
- "cp" keeps its unit letter (K, M or B) exactly as shown.
- The same member appears in several frames. List every sighting; do not deduplicate.
- Ignore rank headers, the "Level" line, "Online" / "2 hr ago" labels and Manage buttons.
- If a card is cut off at an edge so that its name or CP cannot be read fully, skip it.
- Write emoji and symbols as the characters themselves (🌹, ⚡, Ø). Never as HTML entities such
  as &#127801; or escape codes.
- Output raw JSON only. No markdown fence, no commentary.`;
}
const CP_SCHEMA = {
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
};

// "98.4M" -> 98.4, in millions, which is how the roster's CP column is kept (64, 73.9).
function cpValue(s) {
  const m = String(s ?? '').replace(/\s/g, '').match(/(\d[\d,]*(?:\.\d+)?)([KMBT]?)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const scale = { K: 1e-3, M: 1, B: 1e3, T: 1e6 }[m[2].toUpperCase()] ?? 1e-6;
  return +(n * scale).toFixed(3);
}

// This tab runs on Gemini, through the Worker's /api/gemini route, where the key lives; the
// Ranking tab stays on Ollama. Gemini's allowance is 15 requests and 250,000 tokens a minute,
// both rolling, so the gate below meters both and a request waits until the minute has room.
// The key's daily cap, if it has one, is not metered here: withFallback reports it when hit.
//
// 24 images a request. Every request carries the whole roster (~6,500 tokens), so fewer, larger
// batches keep that repetition down: 192 images come to 8 requests and about 265,000 tokens,
// which is one minute's allowance and a few seconds of the next. Smaller batches read a little
// more carefully but spend the minute on roster text instead of pictures.
const CP_MODEL = 'gemini-3.5-flash-lite';
const CP_BATCH = 24, CP_PARALLEL = 4, CP_RPM = 14, CP_TPM = 240000;  // a little under 15 / 250k
const cpGate = (() => {
  const win = [];                      // { t, tokens } for the last minute
  return async tokens => {
    for (;;) {
      const now = Date.now();
      while (win.length && now - win[0].t > 60000) win.shift();
      const used = win.reduce((n, e) => n + e.tokens, 0);
      if (!win.length || (win.length < CP_RPM && used + tokens <= CP_TPM)) {
        const entry = { t: now, tokens };
        win.push(entry);
        // a refused request gives back its tokens but still counts as a request
        return { settle: a => { if (a > 0) entry.tokens = a; }, refund: () => { entry.tokens = 0; } };
      }
      log(`waiting for Gemini's per-minute allowance…`);
      await new Promise(r => setTimeout(r, 1000));
    }
  };
})();

async function cpCallModel(frames) {
  const B = CP_BATCH;
  const batches = [];
  for (let i = 0; i < frames.length; i += B) batches.push(frames.slice(i, i + B));
  const spec = { prompt: cpPrompt(), schema: CP_SCHEMA, parse: cpParse };
  const promptTokens = Math.ceil(spec.prompt.length / CHARS_PER_TOKEN);
  let done = 0;
  const one = async (b, bi) => {
    const got = await withFallback(async m => {
      const lease = await cpGate(b.length * IMG_TOKENS + promptTokens);
      try {
        const got = await callProxy(b, m, API_BASE + '/gemini', spec);
        lease.settle(callProxy.lastUsage);
        return got;
      } catch (e) { lease.refund(); throw e; }
    }, [CP_MODEL], () => {}, true);
    done++; setProg(0.5 + 0.5 * done / batches.length);
    log(`read ${done} of ${batches.length} batches…`);
    // the batch number keeps the list order: batches finish in any order, frames do not
    return got.map((s, i) => ({ ...s, order: bi * 1e4 + i }));
  };
  return (await inTurn(batches, one, CP_PARALLEL)).flat();
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
      const seen = cpDecode(r.seen || r.roster_name).trim();
      const cp = cpValue(r.cp);
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
function cpGroups(sightings) {
  const byName = new Map();
  for (const s of sightings) {
    if (!byName.has(s.seen)) byName.set(s.seen, []);
    byName.get(s.seen).push(s);
  }
  const groups = [...byName.values()]
    .map(g => ({ items: g, cp: mode(g.map(x => x.cp)) }))
    .sort((a, b) => b.items.length - a.items.length);
  const kept = [];
  for (const g of groups) {
    const a = g.items[0].seen, k = fold(a);
    const into = kept.find(h => {
      if (h.cp !== g.cp) return false;
      const b = h.items[0].seen;
      return (k && sim(k, fold(b)) >= 0.8) || a.startsWith(b) || b.startsWith(a);
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
      cp: mode(items.map(x => x.cp)),
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
  return rows.filter(r => !gone.has(r)).sort((a, b) => a.order - b.order);
}

/* run */
$('cpGo').onclick = async () => {
  $('cpGo').disabled = true; $('cpOut').classList.add('hide');
  logEl = 'cpLog'; progEl = 'cpProg';
  try {
    const roster = currentRoster();
    if (!roster.length) throw new Error('No roster loaded — press Pull / Update Alliance Roster.');
    log('decoding video…'); setProg(0);
    const frames = await extractFrames(cpFile, +$('sens').value,
      (p, n) => { setProg(p * 0.5); log(`sampling video — ${n} frames kept`); });
    if (!frames.length) throw new Error('no frames captured');
    $('cpStrip').innerHTML = frames.slice(0, 24)
      .map(f => `<img src="data:image/jpeg;base64,${f}">`).join('');
    log(`${frames.length} frames — sending…`);
    const sightings = await cpCallModel(frames);
    cpRows = cpIdentify(cpGroups(sightings), roster);
    cpRender();
    log(`done — ${sightings.length} readings → ${cpRows.length} members`);
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
function cpRender() {
  closeMenu();
  const kept = cpRows.filter(r => !r.dropped).length;
  const need = cpRows.filter(cpOpen).length;
  const matched = cpRows.filter(r => !r.dropped && r.match).length;
  $('cpVerdict').innerHTML = `<div class="${need ? 'warnbox' : 'okbox'}">${kept} members`
    + ` &middot; ${matched} matched to the roster`
    + (need ? ` &middot; <strong>${need} to confirm below</strong>` : '') + '</div>';
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
        <td>${r.cp}</td>
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
