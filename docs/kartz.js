
const KZ = { budget: 64, perImage: 2, perRequest: 8, rank: [0.00, 0.20], text: [0.36, 0.92] };
const kzImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });

let kzSampling = null;
function kzSample(f) {
  if (kzSampling && kzSampling.file === f) return kzSampling.promise;
  const job = { file: f, t0: Date.now() };
  kzSampling = job;
  const note = m => { if (kzSampling === job && !$('go').disabled) log(m); };
  note('reading the recording…');
  job.promise = (async () => {
    let frames;
    const prog = p => note(`reading the recording… ${Math.round(p * 100)}%`);
    try {
      frames = await dcExtract(f, KZ.budget, prog);
    } catch (e) {
      job.why = e.message;
      if (/no WebCodecs|cannot decode/.test(e.message)) frames = null;
      else frames = await dcExtract(f, KZ.budget, prog, true).catch(e2 => { job.why = e2.message; return null; });
      if (!frames) {
        frames = await extractFrames(f, KZ.budget, prog, 1);
        frames.mode = extractFrames.mode;
      }
    }
    if (!frames.length) throw new Error('no frames could be taken from this recording');
    job.secs = (Date.now() - job.t0) / 1000;
    job.mode = frames.mode;
    const how = frames.mode === 'decoded' ? 'fast route'
      : `slower route${job.why ? ' — ' + job.why : ''}`;
    if (frames.detail) console.log('[kartz] ' + frames.detail);
    note(`recording read (${frames.length} frames, ${job.secs.toFixed(1)}s, ${how}) — ready to Extract`);
    return frames;
  })();
  job.promise.catch(e => note('✗ ' + e.message));
  return job.promise;
}

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

async function kzPost(path, body) {
  const res = await fetch(API_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(res.status + ': ' + (await res.text()).slice(0, 300));
  return res.json();
}
async function kzAsk(images, usage, only) {
  const roster = currentRoster().map(r => ({ search: r.search, ingame: r.ingame }));
  const groups = [];
  for (let i = 0; i < images.length; i += KZ.perRequest) groups.push(images.slice(i, i + KZ.perRequest));
  const one = async (g, gi) => {
    const r = await withFallback(model => kzPost('/kartz-ask', { model, images: g.map(im => im.data), roster, only }), modelChain(), () => {}, true);
    const u = r.usage || {};
    usage.prompt += u.promptTokenCount || 0;
    usage.cached += u.cachedContentTokenCount || 0;
    usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    usage.total += u.totalTokenCount || 0;
    usage.requests++;
    return (r.rows || []).map((row, i, all) => {
      let k = row.img > 0 ? row.img - 1 : -1;
      if (!(k >= 0 && k < g.length)) k = Math.round(all.length > 1 ? i / (all.length - 1) * (g.length - 1) : 0);
      return Object.assign(row, { frame: gi * KZ.perRequest + k });
    });
  };
  return (await Promise.all(groups.map(one))).flat();
}

async function kzFill(sightings, times, duration, file, usage) {
  const when = new Map();
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
    const count = Math.max(GAP_MOMENTS, Math.min(12, Math.round((t1 - t0) / 0.25) + 1));
    return Array.from({ length: count }, (_, i) => t0 + (t1 - t0) * i / (count - 1));
  });
  const shots = (await grabStrips(file, moments, 1)).flat();
  const got = (await kzAsk(await kzPack(shots), usage, todo).catch(() => []))
    .filter(r => todo.some(([a, b]) => r.rank >= a && r.rank <= b));
  return { asked: missing, found: new Set(got.map(r => r.rank)).size, rows: got };
}

$('go').onclick = async () => {
  $('go').disabled = true; $('out').classList.add('hide');
  const usage = { requests: 0, prompt: 0, cached: 0, output: 0, total: 0 };
  try {
    startVideoUpload(videoFile);
    const t0 = Date.now();
    const sampled = kzSample(videoFile);
    log('reading the recording…'); setProg(0.1);
    const [roster, frames] = await Promise.all([freshRoster(), sampled]);
    const learned = store.get('aliases') || {};
    const images = await kzPack(frames);
    log(`${frames.length} frames → ${images.length} images — reading…`); setProg(0.4);
    let sightings = await kzAsk(images, usage);
    setProg(0.8);
    const clean = await kzPost('/kartz-clean', { sightings });
    sightings = clean.sightings;
    (clean.notes || []).forEach(log);
    const fill = await kzFill(sightings, images.map(p => p.t), frames.duration, videoFile, usage);
    sightings = sightings.concat(fill.rows);
    const matched = await kzPost('/kartz-match', { sightings, images: images.length, roster, skipped: skippedRoster(), aliases: learned });
    rows = matched.rows;
    (matched.notes || []).forEach(log);
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
