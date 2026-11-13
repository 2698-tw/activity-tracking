
const DC_STEP = 1 / 8;
const DC_LANES = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1));

function dcBoxes(view, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = view.getUint32(p), type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7));
    let head = 8;
    if (size === 1) { size = Number(view.getBigUint64(p + 8)); head = 16; }
    else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type, start: p, head: p + head, end: p + size });
    p += size;
  }
  return out;
}
const dcFind = (view, box, ...path) => {
  let cur = [box];
  for (const t of path) {
    const next = [];
    for (const b of cur) next.push(...dcBoxes(view, b.head, b.end).filter(c => c.type === t));
    cur = next;
    if (!cur.length) return [];
  }
  return cur;
};
async function dcReadMoov(file) {
  for (let p = 0; p + 8 <= file.size;) {
    const head = new DataView(await file.slice(p, p + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (size === 1) size = Number(head.getBigUint64(8));
    else if (size === 0) size = file.size - p;
    if (size < 8) break;
    if (type === 'moov') return new DataView(await file.slice(p, p + size).arrayBuffer());
    p += size;
  }
  throw new Error('no moov box');
}
function dcCodec(entry, view) {
  const kids = dcBoxes(view, entry.head + 78, entry.end);
  const cfg = kids.find(k => k.type === 'avcC' || k.type === 'hvcC');
  if (!cfg) throw new Error('no decoder configuration');
  const bytes = new Uint8Array(view.buffer, view.byteOffset + cfg.head, cfg.end - cfg.head).slice();
  const hex = n => n.toString(16).padStart(2, '0');
  if (cfg.type === 'avcC') return { codec: `avc1.${hex(bytes[1])}${hex(bytes[2])}${hex(bytes[3])}`, description: bytes };
  const b = bytes, space = ['', 'A', 'B', 'C'][b[1] >> 6], tier = (b[1] >> 5) & 1 ? 'H' : 'L', profile = b[1] & 0x1f;
  let compat = ((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0, rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const cons = [b[6], b[7], b[8], b[9], b[10], b[11]];
  while (cons.length && !cons[cons.length - 1]) cons.pop();
  return { codec: [entry.type === 'hev1' ? 'hev1' : 'hvc1', space + profile, (rev >>> 0).toString(16), tier + b[12], ...cons.map(c => c.toString(16))].join('.'),
           description: bytes };
}
async function dcIndex(file) {
  const view = await dcReadMoov(file);
  const moov = { head: 8, end: view.byteLength };
  for (const trak of dcFind(view, moov, 'trak')) {
    const hdlr = dcFind(view, trak, 'mdia', 'hdlr')[0];
    if (!hdlr || String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + hdlr.head + 8, 4)) !== 'vide') continue;
    const mdhd = dcFind(view, trak, 'mdia', 'mdhd')[0];
    const v1 = view.getUint8(mdhd.head) === 1;
    const scale = view.getUint32(mdhd.head + (v1 ? 20 : 12));
    const stbl = dcFind(view, trak, 'mdia', 'minf', 'stbl')[0];
    const box = t => dcBoxes(view, stbl.head, stbl.end).find(b => b.type === t);
    const stsd = box('stsd'), entry = dcBoxes(view, stsd.head + 8, stsd.end)[0];
    const width = view.getUint16(entry.head + 24), height = view.getUint16(entry.head + 26);
    const { codec, description } = dcCodec(entry, view);
    const u32 = (b, i) => view.getUint32(b.head + i);
    const stsz = box('stsz'), fixed = u32(stsz, 4), n = u32(stsz, 8);
    const size = Array.from({ length: n }, (_, i) => fixed || u32(stsz, 12 + 4 * i));
    const stco = box('stco'), co64 = box('co64'), cbox = stco || co64, nc = u32(cbox, 4);
    const chunk = Array.from({ length: nc }, (_, i) => (stco ? u32(cbox, 8 + 4 * i) : Number(view.getBigUint64(cbox.head + 8 + 8 * i))));
    const stsc = box('stsc'), ns = u32(stsc, 4);
    const runs = Array.from({ length: ns }, (_, i) => [u32(stsc, 8 + 12 * i), u32(stsc, 12 + 12 * i)]);
    const offset = new Array(n);
    for (let r = 0, s = 0; r < runs.length; r++) {
      const [first, per] = runs[r], last = r + 1 < runs.length ? runs[r + 1][0] - 1 : nc;
      for (let c = first; c <= last && s < n; c++) {
        let at = chunk[c - 1];
        for (let k = 0; k < per && s < n; k++, s++) { offset[s] = at; at += size[s]; }
      }
    }
    const stts = box('stts'), dts = new Array(n);
    for (let e = 0, s = 0, t = 0; e < u32(stts, 4); e++) {
      const cnt = u32(stts, 8 + 8 * e), d = u32(stts, 12 + 8 * e);
      for (let k = 0; k < cnt && s < n; k++, s++) { dts[s] = t; t += d; }
    }
    const ctts = box('ctts'), cts = dts.slice();
    if (ctts) for (let e = 0, s = 0; e < u32(ctts, 4); e++) {
      const cnt = u32(ctts, 8 + 8 * e), off = view.getInt32(ctts.head + 12 + 8 * e);
      for (let k = 0; k < cnt && s < n; k++, s++) cts[s] += off;
    }
    const stss = box('stss'), key = new Array(n).fill(!stss);
    if (stss) for (let e = 0; e < u32(stss, 4); e++) key[u32(stss, 8 + 4 * e) - 1] = true;
    const samples = Array.from({ length: n }, (_, i) => ({ offset: offset[i], size: size[i], t: cts[i] / scale, key: key[i] }));
    const duration = Math.max(...samples.map(s => s.t)) + (n > 1 ? (dts[n - 1] - dts[n - 2]) / scale : 0);
    return { codec, description, width, height, samples, duration };
  }
  throw new Error('no video track');
}

async function dcDecode(file, ix, from, to, each) {
  let failed = null;
  const dec = new VideoDecoder({ output: f => { try { each(f); } catch (e) { failed = e; } finally { f.close(); } },
                                 error: e => { failed = e; } });
  dec.configure({ codec: ix.codec, description: ix.description, codedWidth: ix.width, codedHeight: ix.height,
                  hardwareAcceleration: ix.accel || 'prefer-hardware', optimizeForLatency: false });
  const BLOCK = 8 * 1024 * 1024;
  let blockAt = -1, block = null;
  for (let i = from; i <= to; i++) {
    if (failed) throw failed;
    const s = ix.samples[i];
    if (!block || s.offset < blockAt || s.offset + s.size > blockAt + block.byteLength) {
      blockAt = s.offset;
      block = new Uint8Array(await file.slice(blockAt, Math.min(file.size, blockAt + Math.max(BLOCK, s.size))).arrayBuffer());
    }
    dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.t * 1e6),
                                       data: block.subarray(s.offset - blockAt, s.offset - blockAt + s.size) }));
    while (dec.decodeQueueSize > 6) await new Promise(r => setTimeout(r, 0));
  }
  await dec.flush();
  dec.close();
  if (failed) throw failed;
}

async function dcExtract(file, budget, onProg, soft = false) {
  if (!('VideoDecoder' in window)) throw new Error('this browser has no WebCodecs');
  const tA = performance.now();
  const ix = await dcIndex(file);
  const base = { codec: ix.codec, description: ix.description, codedWidth: ix.width, codedHeight: ix.height };
  const can = async accel => (await VideoDecoder.isConfigSupported({ ...base, hardwareAcceleration: accel })).supported;
  ix.accel = !soft && await can('prefer-hardware') ? 'prefer-hardware'
    : await can('prefer-software') ? 'prefer-software' : null;
  if (!ix.accel) throw new Error(`this browser cannot decode ${ix.codec}`);
  const W = Math.min(ix.width, 1080), H = Math.round(W * ix.height / ix.width);
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const TW = Math.max(8, Math.round(W / 4)), TH = Math.max(8, Math.round(H / 4));
  const tcv = Object.assign(document.createElement('canvas'), { width: TW, height: TH });
  const tc = tcv.getContext('2d', { willReadFrequently: true });

  const tB = performance.now();
  const keys = ix.samples.map((s, i) => (s.key ? i : -1)).filter(i => i >= 0);
  const cuts = [...new Set(Array.from({ length: DC_LANES }, (_, j) => keys[Math.floor(j * keys.length / DC_LANES)]))];
  const seen = [];
  let done1 = 0;
  await Promise.all(cuts.map((from, j) => {
    const to = j + 1 < cuts.length ? cuts[j + 1] - 1 : ix.samples.length - 1;
    let next = 0;
    return dcDecode(file, ix, from, to, f => {
      const t = f.timestamp / 1e6;
      if (t + 1e-6 < next) return;
      next = t + DC_STEP;
      cx.drawImage(f, 0, 0, W, H);
      tc.drawImage(cv, 0, 0, W, H, 0, 0, TW, TH);
      const px = tc.getImageData(0, 0, TW, TH).data, grey = new Uint8Array(TW * TH);
      for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0;
      seen.push({ t, grid: motionGrid(cx, W, H), map: motionMap(cx, W, H), grey });
      onProg(0.6 * Math.min(1, (++done1 * DC_STEP) / ix.duration), 0);
    });
  }));
  seen.sort((a, b) => a.t - b.t);
  const times = [], motion = [], thumbs = [], accum = new Float32Array(GW * GH);
  let total = 0;
  for (let i = 0; i < seen.length; i++) {
    if (i > 0) {
      total += gridDiff(seen[i - 1].grid, seen[i].grid);
      const a = seen[i - 1].map, b = seen[i].map;
      for (let j = 0; j < accum.length; j++) accum[j] += Math.abs(b[j] - a[j]);
    }
    times.push(seen[i].t); motion.push(total); thumbs.push(seen[i].grey);
  }
  const box = movingRegion(accum);
  lastCropBox = box;

  const picks = [times[0]];
  if (total > 1e-6) {
    const gap = total / (budget - 1);
    let want = gap;
    for (let i = 1; i < times.length; i++)
      if (motion[i] >= want && picks.length < budget - 1) { picks.push(times[i]); want = motion[i] + gap; }
  }
  if (picks[picks.length - 1] !== times[times.length - 1]) picks.push(times[times.length - 1]);
  const chosen = [];
  for (let i = 0; i < picks.length; i++) {
    const prevGap = i > 0 ? picks[i] - picks[i - 1] : Infinity, nextGap = i < picks.length - 1 ? picks[i + 1] - picks[i] : Infinity;
    const reach = Math.min(SHARP_MAX, 0.25 * Math.min(prevGap, nextGap));
    let bestT = null, bestScore = -1;
    for (let k = 0; k < times.length; k++) {
      if (Math.abs(times[k] - picks[i]) > reach + 1e-6) continue;
      const score = thumbSharpness(thumbs[k], TW, TH, box);
      if (score > bestScore) { bestScore = score; bestT = times[k]; }
    }
    if (bestT !== null) chosen.push(bestT);
  }

  const tC = performance.now();
  const byTime = new Map(ix.samples.map((s, i) => [Math.round(s.t * 1e6), i]));
  const want = new Map(chosen.map((t, i) => [Math.round(t * 1e6), i]));
  const stretches = new Map();
  for (const t of chosen) {
    const at = byTime.get(Math.round(t * 1e6));
    if (at == null) continue;
    let k = at;
    while (k > 0 && !ix.samples[k].key) k--;
    stretches.set(k, Math.max(stretches.get(k) ?? 0, Math.min(ix.samples.length - 1, at + 4)));
  }
  const shots = new Array(chosen.length);
  let got = 0, decoded2 = 0;
  await inTurn([...stretches], ([from, to]) => {
    decoded2 += to - from + 1;
    return dcDecode(file, ix, from, to, f => {
      const i = want.get(f.timestamp);
      if (i == null || shots[i]) return;
      cx.drawImage(f, 0, 0, W, H);
      shots[i] = sliceStrips(cropFrame(cv, W, H, box), 1)[0];
      onProg(0.6 + 0.4 * (++got) / chosen.length, got);
    });
  }, DC_LANES);
  const frames = [], frameTimes = [];
  shots.forEach((s, i) => { if (s) { frames.push(s); frameTimes.push(chosen[i]); } });
  frames.times = frameTimes;
  frames.duration = ix.duration;
  frames.mode = 'decoded';
  const tD = performance.now(), sec = ms => (ms / 1000).toFixed(1) + 's';
  frames.detail = `${ix.codec}, ${ix.samples.length} frames, ${DC_LANES} ${ix.accel === 'prefer-software' ? 'software' : 'hardware'} decoders — index ${sec(tB - tA)}, `
    + `pass 1 ${sec(tC - tB)}, pass 2 ${sec(tD - tC)} (${decoded2} frames in ${stretches.size} stretches)`;
  return frames;
}
