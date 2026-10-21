/* ---------------- Kartz: reading the Ranking list ---------------- */
// How a Kartz recording becomes rows. Loaded after the main script, and built from its parts: the
// same frame choice and crop, the same prompt, roster matching and table.
//
//   1. Sample, as soon as the recording is picked. It needs no roster and no form, and costs no
//      tokens, so it runs while Submitter, Alliance and Day are filled in. The video is decoded
//      directly (decode.js) — unaffected by Low Power Mode, autoplay rules or a hidden tab — and
//      only where that is not possible does the older sampler play it (extractFrames).
//   2. Pack. Each sampled frame is already cropped to the moving list (no header, no pinned own-row
//      card). Its avatars are cut out too, keeping the rank and the name/points columns, and two
//      frames go side by side in one image: about 30 images for a list of 150, not 192 bands.
//   3. Read. Four requests at once, the prompt first (instructions, roster, reference sheet — the
//      same every time, so Gemini charges it at the cached rate when it has seen it recently), and
//      each row answered as a short array rather than an object repeating its field names.
//   4. Fill. Ranks are numbered without gaps, so any missing rank is known, and so is roughly when
//      it was on screen: between the moments its neighbours were read. Frames from there, a
//      quarter of a second apart, are packed the same way and asked about in one request.
//
// Measured on a 153-player recording: every rank found, about 50,000 tokens (the old way was about
// 223,000), 12–15 seconds from Extract with the sampling already done.

const KZ = { budget: 64, perImage: 2, perRequest: 8, rank: [0.00, 0.20], text: [0.36, 0.92] };
const kzImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });

/* 1. sample */
let kzSampling = null;                   // { file, promise, secs, mode, why }
function kzSample(f) {
  if (kzSampling && kzSampling.file === f) return kzSampling.promise;
  const job = { file: f, t0: Date.now() };
  kzSampling = job;
  const note = m => { if (kzSampling === job && !$('go').disabled) log(m); };
  note('reading the recording…');
  job.promise = (async () => {
    let frames;
    try {
      frames = await dcExtract(f, KZ.budget, p => note(`reading the recording… ${Math.round(p * 100)}%`));
    } catch (e) {
      job.why = e.message;               // no WebCodecs, or a format this browser cannot decode
      frames = await extractFrames(f, KZ.budget, p => note(`reading the recording… ${Math.round(p * 100)}%`), 1);
      frames.mode = extractFrames.mode;
    }
    if (!frames.length) throw new Error('no frames could be taken from this recording');
    job.secs = (Date.now() - job.t0) / 1000;
    job.mode = frames.mode;
    note(`recording read (${frames.length} frames, ${job.secs.toFixed(1)}s) — ready to Extract`);
    return frames;
  })();
  job.promise.catch(e => note('✗ ' + e.message));
  return job.promise;
}

/* 2. pack */
async function kzPack(frames) {
  const imgs = await Promise.all(frames.map(b => kzImg('data:image/jpeg;base64,' + b)));
  const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  const rx0 = Math.round(KZ.rank[0] * w), rx1 = Math.round(KZ.rank[1] * w);
  const tx0 = Math.round(KZ.text[0] * w), tx1 = Math.round(KZ.text[1] * w);
  const gap = 10, between = 16, pw = (rx1 - rx0) + gap + (tx1 - tx0);
  const out = [];
  for (let i = 0; i < imgs.length; i += KZ.perImage) {
    const set = imgs.slice(i, i + KZ.perImage);
    const c = Object.assign(document.createElement('canvas'),
      { width: pw * set.length + between * (set.length - 1), height: h });
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, h);
    set.forEach((im, k) => {
      const at = k * (pw + between);
      x.drawImage(im, rx0, 0, rx1 - rx0, h, at, 0, rx1 - rx0, h);
      x.drawImage(im, tx0, 0, tx1 - tx0, h, at + (rx1 - rx0) + gap, 0, tx1 - tx0, h);
    });
    out.push({ data: c.toDataURL('image/jpeg', 0.85).split(',')[1], t: frames.times ? frames.times[i] : null });
  }
  return out;
}

/* 3. read */
// The page's own prompt for frames, told what these images now are, with the short row format.
function kzPrompt() {
  const p = buildPrompt(false).replace(
    'These are frames from a screen recording of a mobile game leaderboard called "Ranking".',
    `These are frames from a screen recording of a mobile game leaderboard called "Ranking", cropped
to the list. The players' avatar pictures have been cut out, so each row shows the rank number on the
left and, to its right, the player name with "Contribution (Pt): <number>" beneath it. Each image
holds ${KZ.perImage} frames side by side: read the left frame, then the right one.`);
  const a = p.indexOf('as a single JSON array, one object per row:');
  const b = p.indexOf('\n', p.indexOf('{"rank":', a));
  return p.slice(0, a) + `as a single JSON array with one small array per row, the five values in this order:
["<rank>", "<roster_name: a name copied exactly from the ROSTER, or empty if none>", "<seen: the name as actually drawn on screen>", "<points>", "<img>"]
For example: ["12", "Woody (South)", "Woody", "5430", "3"]` + p.slice(b);
}
// The short rows back into the objects the rest of the page reads (as parseJSON makes them). An
// answer cut off at the output limit keeps every whole row before the cut.
function kzParse(text) {
  let list;
  try { list = JSON.parse(text); } catch {
    list = (text.match(/\[[^\[\]]*\]/g) || []).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  }
  const num = v => { const m = String(v ?? '').replace(/[,\s]/g, '').match(/-?\d+/); return m ? +m[0] : null; };
  // the model sometimes writes the word null (or none) for a value it means to leave empty
  const val = v => (v == null || /^(null|none|n\/a|-)$/i.test(String(v).trim()) ? '' : String(v).trim());
  const rows = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!Array.isArray(a) || a.length < 4) continue;
    const r = { rank: num(a[0]), roster_name: val(a[1]) || null, seen: val(a[2]), points: num(a[3]), img: num(a[4]) };
    r.name = r.plain = r.seen || r.roster_name || '';
    if (typeof r.points === 'number' && r.name) rows.push(r);
  }
  return rows;
}
// Images in requests of KZ.perRequest, all at once. Each row is tagged with the run-wide index of
// the image it came from (`frame`), which the gap fill uses to know when a rank was on screen.
async function kzAsk(images, usage, extra = '') {
  const sheet = $('sheetimg').checked ? rosterSheet(currentRoster()) : null;
  const prompt = kzPrompt() + extra;
  const groups = [];
  for (let i = 0; i < images.length; i += KZ.perRequest) groups.push(images.slice(i, i + KZ.perRequest));
  const one = async (g, gi) => {
    const parts = [{ text: prompt },
      ...(sheet ? [{ inline_data: { mime_type: 'image/jpeg', data: sheet } }] : []),
      ...g.map(im => ({ inline_data: { mime_type: 'image/jpeg', data: im.data } }))];
    const r = await withFallback(async model => {
      const res = await fetch(MODEL_BASE + '/' + encodeURIComponent(model), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: {
          temperature: 0, maxOutputTokens: 32768, seed: 7, ...KARTZ.config,
          responseMimeType: 'application/json',
          responseSchema: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } },
        } }),
      });
      if (!res.ok) throw new Error(res.status + ': ' + (await res.text()).slice(0, 300));
      return res.json();
    }, modelChain(), () => {}, true);
    const u = r.usageMetadata || {};
    usage.prompt += u.promptTokenCount || 0;
    usage.cached += u.cachedContentTokenCount || 0;
    usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    usage.total += u.totalTokenCount || 0;
    usage.requests++;
    const text = r.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return kzParse(text).map((row, i, all) => {
      let k = row.img > 0 ? row.img - 1 - (sheet ? 1 : 0) : -1;
      if (!(k >= 0 && k < g.length)) k = Math.round(all.length > 1 ? i / (all.length - 1) * (g.length - 1) : 0);
      return Object.assign(row, { frame: gi * KZ.perRequest + k });
    });
  };
  return (await Promise.all(groups.map(one))).flat();
}

/* 4. fill */
async function kzFill(sightings, times, duration, file, usage) {
  const when = new Map();                  // rank -> the moments it was read
  for (const s of sightings) {
    if (!(s.rank > 0)) continue;
    const t = s.frame != null ? times[s.frame] : null;
    if (!when.has(s.rank)) when.set(s.rank, []);
    if (t != null) when.get(s.rank).push(t);
  }
  if (!when.size) return { asked: 0, found: 0, rows: [] };
  const top = Math.max(...when.keys()), ranges = [];
  for (let k = 1; k <= top; k++) {
    if (when.has(k)) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === k - 1) last[1] = k; else ranges.push([k, k]);
  }
  if (!ranges.length) return { asked: 0, found: 0, rows: [] };
  const todo = ranges.slice(0, GAP_MAX);
  const missing = todo.reduce((n, [a, b]) => n + b - a + 1, 0);
  log(`filling ${missing} missing rank${missing > 1 ? 's' : ''}…`);
  const near = (from, step) => {
    for (let k = from, i = 0; i < GAP_REACH; k += step, i++) {
      const ts = when.get(k);
      if (ts && ts.length) return step < 0 ? Math.max(...ts) : Math.min(...ts);
    }
    return null;
  };
  const moments = todo.flatMap(([a, b]) => {
    let t0 = near(a - 1, -1) ?? 0, t1 = near(b + 1, 1) ?? duration;
    if (t1 < t0) [t0, t1] = [t1, t0];
    t0 = Math.max(0, t0 - 0.3); t1 = Math.min(duration, t1 + 0.3);
    // a frame every quarter second across the stretch (5 to 12 of them): rows can be on screen for
    // only a moment — the top of a list is often visible for a third of a second between Control
    // Center closing and the first flick — and five frames spread over two seconds miss it
    const count = Math.max(GAP_MOMENTS, Math.min(12, Math.round((t1 - t0) / 0.25) + 1));
    return Array.from({ length: count }, (_, i) => t0 + (t1 - t0) * i / (count - 1));
  });
  const shots = (await grabStrips(file, moments, 1)).flat();
  const want = todo.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(', ');
  const got = (await kzAsk(await kzPack(shots), usage, `

These images were taken to find rows the first reading missed. Report ONLY the rows ranked ${want},
and nothing else.`).catch(() => []))      // a failed fill leaves the gap reported, as before
    .filter(r => todo.some(([a, b]) => r.rank >= a && r.rank <= b));
  return { asked: missing, found: new Set(got.map(r => r.rank)).size, rows: got };
}

/* Extract */
$('go').onclick = async () => {
  $('go').disabled = true; $('out').classList.add('hide');
  const usage = { requests: 0, prompt: 0, cached: 0, output: 0, total: 0 };
  try {
    startVideoUpload(videoFile);       // normally already under way since the file was chosen
    const t0 = Date.now();
    // the roster and the (usually finished) sampling at the same time
    const sampled = kzSample(videoFile);
    log('reading the recording…'); setProg(0.1);
    const [roster, frames] = await Promise.all([freshRoster(), sampled]);
    index = buildIndex(roster);
    skipIndex = buildIndex(skippedRoster());
    aliases = store.get('aliases') || {};
    const images = await kzPack(frames);
    log(`${frames.length} frames → ${images.length} images — reading…`); setProg(0.4);
    let sightings = await kzAsk(images, usage);
    setProg(0.8);
    sightings = dropForeignRows(sightings);
    const fill = await kzFill(sightings, images.map(p => p.t), frames.duration, videoFile, usage);
    sightings = sightings.concat(fill.rows);
    const base = consolidate(sightings, images.length);
    rows = base.map(makeMatcher(index, skipIndex, aliases));
    // Two rows resolving to one player means at least one of them is wrong, and neither the
    // model nor the fuzzy match can tell which. Neither keeps the match; both carry their own
    // names on, flagged for confirmation like anything else.
    const claims = new Map();
    for (const r of rows) {
      if (!r.match || r.skipped) continue;
      const k = fold(r.match.search);
      if (!claims.has(k)) claims.set(k, []);
      claims.get(k).push(r);
    }
    for (const [, group] of claims) {
      if (group.length < 2) continue;
      for (const r of group) { r.match = null; r.pick = ''; r.score = 0; }
    }
    // The rank the game printed is the rank; a gap in the numbering stays a gap, shown by the
    // banner, rather than renumbering everyone below it.
    let n = 0;
    for (const r of rows) {
      if (r.skipped) { r.rank = null; continue; }
      r.rank = r.seenRank > 0 ? r.seenRank : ++n;
      if (r.rank > n) n = r.rank;
    }
    render(roster);
    log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${sightings.length} readings → ${rows.length} players`
        + (fill.asked ? ` · gap fill found ${fill.found} of ${fill.asked}` : '')
        + ` · ${Math.round(usage.total / 1000)}k tokens`);
    setProg(1);
  } catch (e) {
    const m = e.message;
    log(/\b429\b/.test(m) && /quota|per day/i.test(m)
      ? '✗ The Gemini key has used up its allowance for now. Wait a while, or check the key\'s billing.'
      : '✗ ' + m);
  }
  $('go').disabled = !videoFile;
};
