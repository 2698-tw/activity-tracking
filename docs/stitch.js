/* ---------------- TEST: Kartz by stitching (test.html only) ---------------- */
// The live page reads a recording as 64 frames cut into 3 bands each — 192 images, every row of
// the list photographed three to six times over, and the full roster prompt sent again with every
// batch of twelve. This test reads it the other way round:
//
//   1. Find the list's window: the part of the screen that scrolls. The header, the pinned own-row
//      card and whatever the recording opens on (Control Center) never move with the list, so
//      they fall outside it on their own.
//   2. Stitch: play the video, measure how far the list moved between frames, and keep only the
//      newly revealed strip. The whole board comes out as one long picture, each row in it once.
//   3. Crop: keep the rank column and the name/points column, drop the avatars between them.
//   4. Pack: cut the long picture into pieces of a few rows, overlapping by one row so nothing is
//      lost at a seam, and set pieces side by side so each image carries as many rows as it can
//      while still being legible. An image costs the same tokens whatever it holds.
//   5. One request, prompt first: the instructions, roster and reference sheet are the same every
//      time, so leading with them lets Gemini's automatic context caching charge them at the
//      cached rate, and with the whole list in one request they are paid for only once.

const ST = {
  fps: 12,                 // frames looked at per second of video
  rowsPerPiece: 8,         // rows in one piece of the long picture
  piecesPerImage: 2,       // pieces set side by side in one image
  imagesPerRequest: 12,    // all of a normal list in one request: the prompt is then paid for once
  rank: [0.00, 0.20],      // the rank column, as fractions of the list window's width
  text: [0.36, 0.92],      // the name / points column
  bands: 12,               // vertical bands the row profiles are taken over, for matching frames
};

const stEl = id => document.getElementById(id);
const lumAt = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

async function stOpen(file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  // Safari only decodes a video that is in the page
  Object.assign(v.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
  document.body.append(v);
  v.src = URL.createObjectURL(file);
  await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('this video could not be opened')); });
  return v;
}
const stSeek = (v, t) => new Promise(ok => { v.onseeked = () => ok(); v.currentTime = t; });

// 1. The list window. Sample the video sparsely and small; for each row and column of pixels,
// count in how many of the moving moments it changed. The list changes in nearly all of them;
// the header and the pinned card almost never; a screen the recording passes on its way in
// changes in only a few. The longest run of rows (then columns) that changed in most is the list.
async function stFindWindow(v, onProg) {
  const W = v.videoWidth, H = v.videoHeight, SW = 180, s = SW / W, SH = Math.round(H * s);
  const c = Object.assign(document.createElement('canvas'), { width: SW, height: SH });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const N = 48, frames = [];
  for (let i = 0; i < N; i++) {
    await stSeek(v, (v.duration * (i + 0.5)) / N);
    ctx.drawImage(v, 0, 0, SW, SH);
    const d = ctx.getImageData(0, 0, SW, SH).data, L = new Float32Array(SW * SH);
    for (let p = 0; p < SW * SH; p++) L[p] = lumAt(d, p * 4);
    frames.push(L);
    onProg && onProg((i + 1) / N);
  }
  const rowHits = new Float32Array(SH), colHits = new Float32Array(SW);
  let moving = 0;
  const pairs = [];
  for (let i = 1; i < N; i++) {
    const a = frames[i - 1], b = frames[i], rd = new Float32Array(SH);
    let tot = 0;
    for (let y = 0; y < SH; y++) {
      let e = 0;
      for (let x = 0; x < SW; x++) e += Math.abs(a[y * SW + x] - b[y * SW + x]);
      rd[y] = e / SW; tot += rd[y];
    }
    if (tot / SH < 2) continue;                       // nothing moved between these two
    moving++; pairs.push([a, b]);
    for (let y = 0; y < SH; y++) if (rd[y] > 6) rowHits[y]++;
  }
  if (moving < 3) throw new Error('the list never seems to move in this recording');
  const run = (hits, n, need) => {
    let best = [0, 0], start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && hits[i] >= need;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { if (i - start > best[1] - best[0]) best = [start, i]; start = -1; }
    }
    return best;
  };
  const [y0, y1] = run(rowHits, SH, moving * 0.4);
  for (const [a, b] of pairs)
    for (let x = 0; x < SW; x++) {
      let e = 0;
      for (let y = y0; y < y1; y++) e += Math.abs(a[y * SW + x] - b[y * SW + x]);
      if (e / Math.max(1, y1 - y0) > 6) colHits[x]++;
    }
  const [x0, x1] = run(colHits, SW, moving * 0.4);
  const win = {
    x: Math.max(0, Math.floor(x0 / s) + 2), y: Math.max(0, Math.floor(y0 / s) + 2),
    w: Math.min(W, Math.ceil((x1 - x0) / s) - 4), h: Math.min(H, Math.ceil((y1 - y0) / s) - 4),
  };
  if (win.h < H * 0.15 || win.w < W * 0.3) throw new Error('could not find the scrolling list in this recording');
  return win;
}

// A frame's fingerprint for matching: for every pixel row of the window, the mean brightness in
// each of a dozen vertical bands. Text makes every row of a list different from its neighbours,
// so two frames line up where their fingerprints do.
function stProfile(d, w, h, K) {
  const P = new Float32Array(h * K), bw = w / K;
  for (let y = 0; y < h; y++)
    for (let k = 0; k < K; k++) {
      let e = 0, n = 0;
      for (let x = Math.floor(k * bw); x < Math.floor((k + 1) * bw); x += 2) { e += lumAt(d, (y * w + x) * 4); n++; }
      P[y * K + k] = e / n;
    }
  return P;
}
// How far the list moved from `prev` to `cur`: the shift at which they agree best. Rows of a list
// look alike, so a shift far from the last one is charged a little, which keeps the match from
// jumping a whole row when two rows happen to read similarly.
function stShift(prev, cur, h, K, last) {
  let best = 0, bestErr = Infinity;
  const minOv = Math.floor(h * 0.3);
  for (let dy = -Math.floor(h * 0.5); dy <= h - minOv; dy++) {
    const y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy);
    let e = 0, n = 0;
    for (let y = y0; y < y1; y += 2) {
      const a = (y + dy) * K, b = y * K;
      for (let k = 0; k < K; k++) e += Math.abs(prev[a + k] - cur[b + k]);
      n += K;
    }
    e = e / n + 2 * Math.abs(dy - last) / h;
    if (e < bestErr) { bestErr = e; best = dy; }
  }
  return { dy: best, err: bestErr };
}

// 2. Stitch. Plays the video and, frame by frame, works out where this frame's window sits on the
// long picture. The picture is kept as bands of a few pixel rows, each with the sharpness it was
// taken at: a band is (re)drawn from this frame whenever this frame shows it sharper than before.
// So each row ends up as its clearest view, not its first — the first view of the top of the
// list is often half faded in under Control Center, and rows caught mid-flick are smeared.
const ST_BAND = 24;
function stRowSharpness(d, w, h) {
  // per pixel row: how much fine detail it has (sum of |horizontal + vertical second difference|)
  const S = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    let e = 0;
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      const c = lumAt(d, i);
      e += Math.abs(4 * c - lumAt(d, i - 4) - lumAt(d, i + 4) - lumAt(d, i - w * 4) - lumAt(d, i + w * 4));
    }
    S[y] = e;
  }
  return S;
}
async function stStitch(v, win, onProg) {
  const { w, h } = win, K = ST.bands, T = ST_BAND;
  const F = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const fx = F.getContext('2d', { willReadFrequently: true });
  // Each stretch of frames that line up with one another is a segment; a frame that does not line
  // up with the one before starts a new one. The list is the longest segment — what comes before
  // or after it (Control Center, another screen) is a short one and is set aside at the end.
  const segments = [];
  let seg = null, prev = null, last = 0, frames = 0, used = 0, breaks = 0;
  const start = () => { seg = { bands: [], pos: 0, total: 0 }; segments.push(seg); };
  let misses = 0, missed = null;                     // frames in a row that did not line up, and the last of them
  const paint = (d) => {
    const S = stRowSharpness(d, w, h);
    const first = Math.floor(seg.pos / T), lastBand = Math.floor((seg.pos + h - 1) / T);
    let drew = false;
    for (let b = Math.max(0, first); b <= lastBand; b++) {
      const fy0 = b * T - seg.pos, fy1 = fy0 + T;
      const whole = fy0 >= 1 && fy1 <= h - 1;
      const have = seg.bands[b];
      if (!whole && have) continue;                   // a cut-off band only fills a gap
      let q = 0;
      for (let y = Math.max(1, fy0); y < Math.min(h - 1, fy1); y++) q += S[y];
      if (!whole) q = 0;
      if (have && have.q >= q) continue;
      const c = have ? have.c : Object.assign(document.createElement('canvas'), { width: w, height: T });
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, w, T);
      cx.drawImage(F, 0, fy0, w, T, 0, 0, w, T);
      seg.bands[b] = { c, q };
      drew = true;
    }
    seg.total = Math.max(seg.total, seg.pos + h);
    if (drew) used++;
  };
  const take = () => {
    fx.drawImage(v, win.x, win.y, w, h, 0, 0, w, h);
    const d = fx.getImageData(0, 0, w, h).data;
    const P = stProfile(d, w, h, K);
    frames++;
    if (!prev) { start(); paint(d); prev = P; return; }
    const m = stShift(prev, P, h, K, last);
    if (m.err > 14) {
      // Not lined up with the last good frame. A frame smeared mid-flick does that: it is skipped,
      // and the next sharp one is matched against the last good frame from further off. But when
      // two frames in a row miss it yet agree with each other, the screen itself has changed and
      // settled (Control Center closing onto the list, say), and a new stretch starts at once —
      // waiting would let the top of the list scroll by unrecorded.
      // still, not a smeared flick: frames of a moving list agree with each other only at a shift
      const again = missed && stShift(missed, P, h, K, 0);
      const settled = again && again.err <= 14 && Math.abs(again.dy) <= 3;
      missed = P;
      if (!settled && ++misses < 18) return;
      misses = 0; missed = null; breaks++; start(); paint(d); prev = P; last = 0; return;
    }
    misses = 0; missed = null;
    last = m.dy;
    seg.pos += m.dy;
    if (seg.pos < 0) {                                 // scrolled above where this segment began
      const up = Math.ceil(-seg.pos / T) * T;
      seg.bands = [...Array(up / T)].concat(seg.bands);
      seg.pos += up; seg.total += up;
    }
    paint(d);
    prev = P;
  };
  // Stepped through by seeking, at a fixed rate. Playing the video and taking frames as they are
  // shown looked quicker but is at the browser's mercy: on one run it delivered nothing for the
  // first three seconds, which is exactly when the top of the list was on screen.
  const step = 1 / ST.fps;
  for (let t = 0; t < v.duration - 0.02; t += step) {
    await stSeek(v, t);
    take();
    onProg && onProg(t / v.duration);
  }
  if (!segments.length) throw new Error('no frames could be read from this recording');
  // Stretches back into one picture. A flick too fast to follow, or a few frames that did not line
  // up, leaves the list in two stretches that still overlap by a row or so: the bottom of one is
  // the top of the next. Where that overlap is found they are joined; where it is not, they stay
  // apart (another screen, or a stretch of list genuinely never on screen) and the longest wins.
  const parts = segments.map(sg => ({
    total: sg.total,
    strips: sg.bands.map((b, i) => b && { y: i * T, c: b.c }).filter(Boolean),
  }));
  const chains = [parts[0]];
  let joins = 0;
  for (const nx of parts.slice(1)) {
    const cur = chains[chains.length - 1];
    const at = stJoin(cur, nx, w, K);
    if (at == null) { chains.push(nx); continue; }
    for (const s of nx.strips) if (s.y + at + s.c.height > cur.total) cur.strips.push({ y: s.y + at, c: s.c });
    cur.total = Math.max(cur.total, at + nx.total);
    joins++;
  }
  const best = chains.reduce((a, b) => (b.total > a.total ? b : a));
  return { strips: best.strips, total: best.total, frames, used, breaks, joins,
           dropped: chains.length - 1, win };
}

// Rows y0..y1 of a stretch as a fingerprint, the same kind stShift compares.
function stPartProfile(part, y0, y1, w, K) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: y1 - y0 });
  const x = c.getContext('2d', { willReadFrequently: true });
  for (const s of part.strips) if (s.y < y1 && s.y + s.c.height > y0) x.drawImage(s.c, 0, s.y - y0);
  return stProfile(x.getImageData(0, 0, w, y1 - y0).data, w, y1 - y0, K);
}
// Where stretch `b` starts within stretch `a` (its offset in a's picture), if b's top repeats a's
// bottom closely enough; null if it does not. Needs at least most of a row of overlap, and a
// close match, since a wrong join would put the rows below it in the wrong place.
function stJoin(a, b, w, K) {
  const span = Math.min(a.total, 1200), top = Math.min(b.total, 1200);
  if (span < 60 || top < 60) return null;
  const A = stPartProfile(a, a.total - span, a.total, w, K), B = stPartProfile(b, 0, top, w, K);
  let best = null, bestErr = Infinity;
  for (let p = 0; p < span - 60; p++) {                  // b's top lands p rows into a's tail
    const n = Math.min(span - p, top);
    if (n < 80) continue;
    let e = 0, m = 0;
    for (let y = 0; y < n; y += 2) {
      for (let k = 0; k < K; k++) e += Math.abs(A[(p + y) * K + k] - B[y * K + k]);
      m += K;
    }
    e /= m;
    if (e < bestErr) { bestErr = e; best = p; }
  }
  return bestErr <= 8 ? a.total - span + best : null;
}

// The row pitch, from the long picture itself: the shift at which it best matches itself.
function stPitch(st) {
  const { strips, total, win } = st;
  const h = Math.min(total, 3000);
  const c = Object.assign(document.createElement('canvas'), { width: win.w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true });
  for (const s of strips) if (s.y < h) x.drawImage(s.c, 0, s.y);
  const d = x.getImageData(0, 0, win.w, h).data, P = new Float32Array(h);
  for (let y = 0; y < h; y++) { let e = 0; for (let i = 0; i < win.w; i += 3) e += lumAt(d, (y * win.w + i) * 4); P[y] = e; }
  let best = 120, bestE = Infinity;
  const errAt = lag => { let e = 0; for (let y = 0; y + lag < h; y++) e += Math.abs(P[y] - P[y + lag]); return e / (h - lag); };
  for (let lag = 40; lag < Math.min(400, h / 3); lag++) {
    const e = errAt(lag);
    if (e < bestE) { bestE = e; best = lag; }
  }
  // a list matches itself one row on and two rows on almost equally; the row is the shorter
  for (let half = Math.round(best / 2); half >= 40; half = Math.round(best / 2)) {
    let e = Infinity, at = half;
    for (let l = half - 3; l <= half + 3; l++) { const x = errAt(l); if (x < e) { e = x; at = l; } }
    if (e > bestE * 1.3) break;
    best = at; bestE = Math.min(bestE, e);
  }
  return best;
}

// 3 + 4. Crop and pack.
function stImages(st, pitch) {
  const { strips, total, win } = st;
  const rx0 = Math.round(ST.rank[0] * win.w), rx1 = Math.round(ST.rank[1] * win.w);
  const tx0 = Math.round(ST.text[0] * win.w), tx1 = Math.round(ST.text[1] * win.w);
  const gap = 10, pw = (rx1 - rx0) + gap + (tx1 - tx0);
  const ph = ST.rowsPerPiece * pitch + pitch;            // a row of overlap with the next piece
  const step = ST.rowsPerPiece * pitch;
  const pieces = [];
  for (let y = 0; y < total; y += step) {
    const hh = Math.min(ph, total - y);
    if (hh < pitch * 0.6 && pieces.length) break;        // a sliver: already inside the last overlap
    const c = Object.assign(document.createElement('canvas'), { width: pw, height: hh });
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, pw, hh);
    for (const s of strips) {
      const a = Math.max(y, s.y), b = Math.min(y + hh, s.y + s.c.height);
      if (b <= a) continue;
      x.drawImage(s.c, rx0, a - s.y, rx1 - rx0, b - a, 0, a - y, rx1 - rx0, b - a);
      x.drawImage(s.c, tx0, a - s.y, tx1 - tx0, b - a, rx1 - rx0 + gap, a - y, tx1 - tx0, b - a);
    }
    pieces.push(c);
  }
  const images = [];
  for (let i = 0; i < pieces.length; i += ST.piecesPerImage) {
    const set = pieces.slice(i, i + ST.piecesPerImage);
    const W = set.reduce((n, c) => n + c.width, 0) + 16 * (set.length - 1);
    const H = Math.max(...set.map(c => c.height));
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    let at = 0;
    for (const p of set) { x.drawImage(p, at, 0); at += p.width + 16; }
    const url = c.toDataURL('image/jpeg', 0.85);
    images.push({ url, data: url.split(',')[1], w: W, h: H });
  }
  return { images, pieces: pieces.length, pitch };
}

// 5. Ask. The prompt is the live page's own (roster, symbol names, reference sheet), with the
// opening sentence saying what these images are now.
function stPrompt() {
  return buildPrompt(false, true).replace(
    'These are frames from a screen recording of a mobile game leaderboard called "Ranking".',
    `These images are strips cut from a mobile game leaderboard called "Ranking". The players'
avatar pictures have been cut out, so each row shows the rank number on the left and, to its
right, the player name with "Contribution (Pt): <number>" beneath it. An image may hold two or
three strips side by side: read each strip from top to bottom, left strip first. Neighbouring
strips overlap by about one row, so a rank can appear twice.`);
}
const stConfig = () => ({
  temperature: 0, maxOutputTokens: 32768, seed: 7,
  thinkingConfig: { thinkingLevel: 'minimal' }, mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
  responseMimeType: 'application/json', responseSchema: RANKING_SCHEMA,
});
async function stAsk(images, onBatch) {
  const sheet = rosterSheet(currentRoster());
  // The prompt goes first and the images after, so every request (and every run) starts with the
  // same several thousand tokens — which is what Gemini's automatic caching charges at the cached
  // rate. An explicit cache was tried as well and dropped: with the whole list in one request
  // there is nothing within a run to reuse it, and it costs a request of its own plus storage.
  const prefix = [{ text: stPrompt() }, ...(sheet ? [{ inline_data: { mime_type: 'image/jpeg', data: sheet } }] : [])];
  const usage = { requests: 0, prompt: 0, cached: 0, output: 0, total: 0 };
  const groups = [];
  for (let i = 0; i < images.length; i += ST.imagesPerRequest) groups.push(images.slice(i, i + ST.imagesPerRequest));
  const one = async (g, gi) => {
    const imgs = g.map(im => ({ inline_data: { mime_type: 'image/jpeg', data: im.data } }));
    const body = { contents: [{ role: 'user', parts: [...prefix, ...imgs] }], generationConfig: stConfig() };
    const t0 = Date.now();
    const r = await fetch(MODEL_BASE + '/' + encodeURIComponent(MODEL), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 300));
    const j = await r.json(), u = j.usageMetadata || {};
    usage.requests++;
    usage.prompt += u.promptTokenCount || 0;
    usage.cached += u.cachedContentTokenCount || 0;
    usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    usage.total += u.totalTokenCount || 0;
    usage.slowest = Math.max(usage.slowest || 0, Date.now() - t0);
    onBatch && onBatch(usage.requests, groups.length);
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return parseJSON(text).map(row => Object.assign(row, { frame: gi }));
  };
  // Caching only applies once the prompt has been seen, so when a list does need more than one
  // request the first goes on its own and the rest together.
  let out = [];
  if (groups.length) {
    out = await one(groups[0], 0);
    out = out.concat((await Promise.all(groups.slice(1).map((g, i) => one(g, i + 1)))).flat());
  }
  return { rows: out, usage };
}

// A test run is not a real one: nothing goes to Backblaze or the Drive folder from this page.
startVideoUpload = () => {};
saveAfterSend = async () => {};

/* the test page's controls */
let stLast = null;                // { file, st, pitch, built } from the last preview
async function stPrepare(file) {
  if (stLast && stLast.file === file) return stLast;
  const v = await stOpen(file);
  try {
    log('finding the list on screen…'); setProg(0);
    const win = await stFindWindow(v, p => setProg(p * 0.15));
    log(`list window ${win.w}×${win.h} at ${win.x},${win.y} — stitching…`);
    const t0 = Date.now();
    const st = await stStitch(v, win, p => { setProg(0.15 + p * 0.35); });
    const pitch = stPitch(st);
    stLast = { file, st, pitch, secs: (Date.now() - t0) / 1000 };
    return stLast;
  } finally { URL.revokeObjectURL(v.src); v.remove(); }
}
function stShow(prep, built) {
  const { st, pitch, secs } = prep;
  const est = built.images.length * 560;
  stEl('stStats').innerHTML =
    `List window ${st.win.w}×${st.win.h}px · ${st.frames} frames looked at, ${st.used} added to the picture`
    + `${st.joins ? ` · ${st.joins} join(s) after a fast flick` : ''}`
    + `${st.dropped ? ` · <strong>${st.dropped} stretch(es) set aside</strong> (another screen, or list that could not be joined)` : ''} · stitched in ${secs.toFixed(1)}s<br>`
    + `Long picture ${st.total}px tall · row ≈ ${pitch}px ≈ ${Math.round(st.total / pitch)} rows<br>`
    + `<strong>${built.images.length} images</strong> (${built.pieces} pieces of ${ST.rowsPerPiece} rows, ${ST.piecesPerImage} per image)`
    + ` in ${Math.ceil(built.images.length / ST.imagesPerRequest)} requests · images ≈ ${est.toLocaleString()} tokens`
    + ` (the live page sends ${(+$('sens').value) * STRIPS} images)`;
  stEl('stImgs').innerHTML = built.images.map((im, i) =>
    `<a href="${im.url}" target="_blank" title="image ${i + 1}: ${im.w}×${im.h}"><img src="${im.url}"></a>`).join('');
}
function stReadControls() {
  ST.fps = +stEl('stRate').value;
  ST.rowsPerPiece = +stEl('stRows').value;
  ST.piecesPerImage = +stEl('stCols').value;
  ST.imagesPerRequest = +stEl('stPer').value;
  ST.rank = [+stEl('stRankL').value / 100, +stEl('stRankR').value / 100];
  ST.text = [+stEl('stTextL').value / 100, +stEl('stTextR').value / 100];
}
for (const id of ['stRows', 'stCols', 'stPer', 'stRankL', 'stRankR', 'stTextL', 'stTextR'])
  stEl(id).addEventListener('input', () => {
    stEl(id + 'V').textContent = stEl(id).value;
    stReadControls();
    if (stLast && stLast.file === videoFile) stShow(stLast, stImages(stLast.st, stLast.pitch));
  });
stEl('stRate').addEventListener('change', () => { stLast = null; });

stEl('stPreview').onclick = async () => {
  if (!videoFile) return log('choose a recording first');
  stEl('stPreview').disabled = true;
  try {
    stReadControls();
    const prep = await stPrepare(videoFile);
    stShow(prep, stImages(prep.st, prep.pitch));
    setProg(0.5); log('preview ready — nothing has been sent');
  } catch (e) { log('✗ ' + e.message); }
  stEl('stPreview').disabled = false;
};

// Extract, the stitched way. Everything after the reading is the live page's own: the same
// foreign-row filter, the same consolidation by rank, the same matching and table. No gap fill:
// it re-reads frames of the video, which this route does not have; a missing rank here is shown
// as missing so the stitching can be judged on its own.
$('go').onclick = async () => {
  $('go').disabled = true; $('out').classList.add('hide');
  try {
    const roster = await freshRoster();
    index = buildIndex(roster);
    skipIndex = buildIndex(skippedRoster());
    aliases = store.get('aliases') || {};
    stReadControls();
    const t0 = Date.now();
    const prep = await stPrepare(videoFile);
    const built = stImages(prep.st, prep.pitch);
    stShow(prep, built);
    log(`${built.images.length} images — reading…`);
    const { rows: read, usage } = await stAsk(built.images,
      (n, of) => { setProg(0.5 + 0.5 * n / of); log(`read ${n} of ${of} requests…`); });
    let sightings = dropForeignRows(read);
    const base = consolidate(sightings, built.images.length);
    rows = base.map(makeMatcher(index, skipIndex, aliases));
    const claims = new Map();
    for (const r of rows) {
      if (!r.match || r.skipped) continue;
      const k = fold(r.match.search);
      if (!claims.has(k)) claims.set(k, []);
      claims.get(k).push(r);
    }
    for (const [, group] of claims) if (group.length > 1) for (const r of group) { r.match = null; r.pick = ''; r.score = 0; }
    let n = 0;
    for (const r of rows) {
      if (r.skipped) { r.rank = null; continue; }
      r.rank = r.seenRank > 0 ? r.seenRank : ++n;
      if (r.rank > n) n = r.rank;
    }
    render(roster);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    log(`done in ${secs}s — ${sightings.length} readings → ${rows.length} players · `
      + `${usage.total.toLocaleString()} tokens in ${usage.requests} requests `
      + `(prompt ${usage.prompt.toLocaleString()}, of it cached ${usage.cached.toLocaleString()}; output ${usage.output.toLocaleString()})`);
    setProg(1);
  } catch (e) { log('✗ ' + e.message); }
  $('go').disabled = !videoFile;
};
