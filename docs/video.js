/* ---------------- TEST: Kartz from the whole video, read by Gemini (test.html only) ---------------- */
// No frames are taken on the phone at all. The recording goes straight from the page to Gemini's
// file storage, and Gemini watches it:
//
//   1. Upload. The Worker opens an upload session with the key and hands back only the session's
//      link; the page sends the video to Google directly, in pieces, so its size is no concern
//      (Gemini takes files up to 2 GB). Backblaze, for the copy in Drive, follows in the background
//      once Gemini has it, so the two do not split the phone's upload speed.
//   2. Read. One request: the prompt first (instructions, roster, reference sheet — the same every
//      time, so Gemini's automatic caching charges it at the cached rate), then the video, sampled
//      at a chosen frame rate and level of detail. Every row comes back with the moment it was read.
//   3. Check. A Kartz board numbers its ranks 1, 2, 3 … without a gap, so any rank missing from the
//      answer is known, and so is where it should have been: between the moments its neighbours
//      were read. Only that stretch of video is asked about again, at a much higher frame rate.
//   4. Everything after the reading is the live page's own: the foreign-row filter, consolidation
//      by rank, roster matching and the table.

const GV = { model: MODEL, fps: 2, res: 'MEDIA_RESOLUTION_HIGH', gaps: true, gapFps: 10 };
const gvEl = id => document.getElementById(id);
const gvSleep = ms => new Promise(r => setTimeout(r, ms));
const gvPost = async (path, body) => {
  const r = await fetch(API_BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j.error || `${path} failed (${r.status})`);
  return j;
};

/* 1. upload */
let gvUp = null;                         // { file, promise, g (Gemini's file), secs }
function gvStatus(m) { gvEl('gvUpLog').textContent = m; }
async function gvUpload(f) {
  const t0 = Date.now();
  const type = /^video\//.test(f.type) ? f.type : 'video/quicktime';
  const s = await gvPost('/gemini-upload-start', { size: f.size, type, name: f.name });
  // pieces of about 16 MB, a whole number of the session's granularity; a piece that fails is
  // sent again, so a dropped connection costs one piece rather than the whole video
  const piece = Math.max(1, Math.round(16 * 1024 * 1024 / s.granularity)) * s.granularity;
  let off = 0, done = null;
  while (off < f.size) {
    const end = Math.min(f.size, off + piece), last = end >= f.size;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(s.url, {
          method: 'POST',
          headers: { 'x-goog-upload-command': last ? 'upload, finalize' : 'upload', 'x-goog-upload-offset': String(off) },
          body: f.slice(off, end),
        });
        if (!r.ok) throw new Error(`Gemini refused part of the upload (${r.status}) ${(await r.text()).slice(0, 160)}`);
        if (last) done = await r.json();
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await gvSleep(1500 * (attempt + 1));
      }
    }
    off = end;
    gvStatus(`sending to Gemini… ${Math.round((off / f.size) * 100)}%`);
  }
  const g = done && done.file;
  if (!g || !g.uri) throw new Error('Gemini did not confirm the upload');
  return { ...g, secs: (Date.now() - t0) / 1000 };
}
// Picking a recording starts the upload straight away, Gemini first and Backblaze after it.
const gvToBackblaze = startVideoUpload;
startVideoUpload = f => {
  if (!f || (gvUp && gvUp.file === f)) return;
  gvUp = { file: f };
  gvStatus('sending to Gemini…');
  gvUp.promise = gvUpload(f)
    .then(g => {
      gvUp.g = g;
      gvStatus(`with Gemini in ${g.secs.toFixed(1)}s (${(f.size / 1e6).toFixed(1)} MB) — Backblaze copy following in the background`);
      return g;
    })
    .catch(e => { gvStatus('✗ ' + e.message); throw e; })
    .finally(() => gvToBackblaze(f));
  gvUp.promise.catch(() => {});
};
// A test run is not a real one: the recording is not copied on to the Drive folder from this page.
saveAfterSend = async () => {};

// Gemini works through an uploaded video before it can be read; wait until it says ACTIVE.
async function gvReady(g) {
  for (let i = 0; i < 160; i++) {
    const f = await gvPost('/gemini-file', { name: g.name });
    if (f.state === 'ACTIVE') return f;
    if (f.state === 'FAILED') throw new Error('Gemini could not process this video');
    await gvSleep(1500);
  }
  throw new Error('Gemini took too long to process the video');
}

/* 2. read */
const GV_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      rank: { type: 'STRING' }, roster_name: { type: 'STRING' }, seen: { type: 'STRING' },
      points: { type: 'STRING' }, t: { type: 'STRING' },
    },
    required: ['rank', 'seen', 'points', 't'],
  },
};
// The live page's own prompt, in its video form, with each row's image number swapped for the
// moment in the video it was read at.
function gvPrompt(only) {
  let p = buildPrompt(true, true)
    .replace('"points": <int>, "img": <int>}', '"points": <int>, "t": "<MM:SS>"}')
    .replace('- "img" is which image the row was read from, counting every image in this request from 1.',
             '- "t" is the moment in the video, as MM:SS (for example 00:14), at which you read this row.');
  if (only) p += `\n- This is a short clip from the middle of the list. Report ONLY ranks ${only[0]} to ${only[1]}; ignore every other row.`;
  return p;
}
const gvSec = t => {
  const m = String(t ?? '').match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
  return m ? (+(m[1] || 0)) * 60 + +m[2] : null;
};
const gvSecs = s => `${Math.max(0, s).toFixed(1)}s`;
async function gvAsk(g, meta, only, usage) {
  const sheet = rosterSheet(currentRoster());
  const parts = [
    { text: gvPrompt(only) },
    ...(sheet ? [{ inline_data: { mime_type: 'image/jpeg', data: sheet } }] : []),
    { file_data: { mime_type: g.mimeType, file_uri: g.uri }, videoMetadata: meta },
  ];
  const config = {
    temperature: 0, maxOutputTokens: 32768, seed: 7,
    thinkingConfig: { thinkingLevel: 'minimal' }, mediaResolution: GV.res,
    responseMimeType: 'application/json', responseSchema: GV_SCHEMA,
  };
  const send = async cfg => fetch(MODEL_BASE + '/' + encodeURIComponent(GV.model), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: cfg }),
  });
  const t0 = Date.now();
  let r = await send(config);
  if (r.status === 400) {
    // a model that does not take minimal thinking: ask again with its own default
    const why = await r.text();
    if (!/thinking/i.test(why)) throw new Error('400: ' + why.slice(0, 300));
    const { thinkingConfig, ...rest } = config;
    r = await send(rest);
  }
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json(), u = j.usageMetadata || {};
  usage.requests++;
  usage.prompt += u.promptTokenCount || 0;
  usage.cached += u.cachedContentTokenCount || 0;
  usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  usage.total += u.totalTokenCount || 0;
  usage.slowest = Math.max(usage.slowest, Date.now() - t0);
  const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return parseJSON(text);
}

/* 3. check, and read only what is missing again */
function gvGaps(read) {
  const at = new Map();                     // rank -> the moments it was read
  for (const r of read) {
    const s = gvSec(r.t);
    if (r.rank > 0 && s != null) at.set(r.rank, [...(at.get(r.rank) || []), s]);
  }
  const max = Math.max(0, ...at.keys());
  const gaps = [];
  for (let k = 1; k <= max; k++) {
    if (at.has(k)) continue;
    let e = k;
    while (e + 1 <= max && !at.has(e + 1)) e++;
    const before = [...at.keys()].filter(x => x < k).sort((a, b) => b - a)[0];
    const after = [...at.keys()].filter(x => x > e).sort((a, b) => a - b)[0];
    const t0 = before != null ? Math.max(...at.get(before)) : 0;
    const t1 = after != null ? Math.min(...at.get(after)) : t0 + 6;
    // a little either side: the missing rows were on screen just after the one above was read
    gaps.push({ from: k, to: e, start: Math.max(0, Math.min(t0, t1) - 1), end: Math.max(t0, t1) + 1 });
    k = e;
  }
  return { gaps, max, seen: at.size };
}

/* the test page's controls */
function gvReadControls() {
  GV.model = gvEl('gvModel').value || MODEL;
  GV.fps = +gvEl('gvFps').value;
  GV.res = gvEl('gvRes').value;
  GV.gaps = gvEl('gvGaps').checked;
  GV.gapFps = +gvEl('gvGapFps').value;
}
gvEl('gvModels').onclick = async () => {
  gvEl('gvModels').disabled = true;
  try {
    const { models } = await gvPost('/gemini-models');
    const keep = models.filter(m => /gemini/i.test(m.name) && !/embed|tts|image|audio|live|veo|imagen/i.test(m.name));
    const cur = gvEl('gvModel').value;
    gvEl('gvModel').innerHTML = keep.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
    gvEl('gvModel').value = keep.some(m => m.name === cur) ? cur : MODEL;
    gvEl('gvModelNote').textContent = `${keep.length} Gemini models available to this key`;
  } catch (e) { gvEl('gvModelNote').textContent = '✗ ' + e.message; }
  gvEl('gvModels').disabled = false;
};

$('go').onclick = async () => {
  $('go').disabled = true; $('out').classList.add('hide');
  const usage = { requests: 0, prompt: 0, cached: 0, output: 0, total: 0, slowest: 0 };
  try {
    gvReadControls();
    const t0 = Date.now();
    const roster = await freshRoster();
    index = buildIndex(roster);
    skipIndex = buildIndex(skippedRoster());
    aliases = store.get('aliases') || {};
    startVideoUpload(videoFile);              // normally already under way since the file was chosen
    log('waiting for the upload to Gemini…'); setProg(0.05);
    const g = await gvUp.promise;
    const tUp = Date.now();
    log('Gemini is processing the video…'); setProg(0.15);
    await gvReady(g);
    const tReady = Date.now();
    log(`reading the video at ${GV.fps} frame(s) a second with ${GV.model}…`); setProg(0.3);
    let read = await gvAsk(g, { fps: GV.fps }, null, usage);
    const tRead = Date.now();
    const first = gvGaps(read);
    let filled = 0;
    if (GV.gaps && first.gaps.length) {
      log(`${first.gaps.length} stretch(es) missing — reading just those again at ${GV.gapFps} frames a second…`); setProg(0.7);
      const extra = await Promise.all(first.gaps.map(gp =>
        gvAsk(g, { fps: GV.gapFps, startOffset: gvSecs(gp.start), endOffset: gvSecs(gp.end) }, [gp.from, gp.to], usage)
          .catch(e => { log('✗ re-read failed: ' + e.message); return []; })));
      const want = new Set(first.gaps.flatMap(gp => Array.from({ length: gp.to - gp.from + 1 }, (_, i) => gp.from + i)));
      const got = extra.flat().filter(r => want.has(r.rank));
      filled = new Set(got.map(r => r.rank)).size;
      read = read.concat(got);
    }
    const sightings = dropForeignRows(read);
    const base = consolidate(sightings, 1);
    rows = base.map(makeMatcher(index, skipIndex, aliases));
    const claims = new Map();
    for (const r of rows) {
      if (!r.match || r.skipped) continue;
      const k = fold(r.match.search);
      claims.set(k, [...(claims.get(k) || []), r]);
    }
    for (const [, group] of claims) if (group.length > 1) for (const r of group) { r.match = null; r.pick = ''; r.score = 0; }
    let n = 0;
    for (const r of rows) {
      if (r.skipped) { r.rank = null; continue; }
      r.rank = r.seenRank > 0 ? r.seenRank : ++n;
      if (r.rank > n) n = r.rank;
    }
    render(roster);
    const missingBefore = first.max - first.seen;
    const s = ms => (ms / 1000).toFixed(1) + 's';
    const summary = `${GV.model} · ${GV.fps} fps · ${GV.res.replace('MEDIA_RESOLUTION_', '').toLowerCase()} detail — `
      + `${rows.length} players · first pass found ${first.seen} of ${first.max} ranks`
      + (GV.gaps && missingBefore ? `, the re-read filled ${filled} of ${missingBefore}` : '')
      + ` · ${usage.total.toLocaleString()} tokens in ${usage.requests} request(s) (prompt ${usage.prompt.toLocaleString()}, `
      + `cached ${usage.cached.toLocaleString()}, output ${usage.output.toLocaleString()})`
      + ` · ${s(Date.now() - t0)} in all: upload wait ${s(tUp - t0)}, processing ${s(tReady - tUp)}, `
      + `reading ${s(tRead - tReady)}${usage.requests > 1 ? `, re-read ${s(Date.now() - tRead)}` : ''}`;
    log('done — ' + summary);
    gvEl('gvRuns').insertAdjacentHTML('afterbegin', `<li>${esc(summary)} · `
      + `${rows.filter(r => r.match).length} matched, ${rows.filter(r => !r.match).length} to confirm</li>`);
    setProg(1);
  } catch (e) { log('✗ ' + e.message); }
  $('go').disabled = !videoFile;
};
