/**
 * Kartz key holder — a Cloudflare Worker that keeps the Ollama Cloud key off the page.
 *
 * The static page sends its existing vision request to this Worker. The Worker translates
 * that request into Ollama's native /api/chat format, adds the OLLAMA_API_KEY secret, and
 * forwards it to Ollama Cloud. The browser never receives the API key.
 *
 * Required Cloudflare secret:
 *   wrangler secret put OLLAMA_API_KEY
 *
 * The model is fixed to gemma4:31b by the page. The key is stored only in Cloudflare.
 *
 * The Base CP tab uses Gemini instead, through /api/gemini/<model>:
 *   wrangler secret put GEMINI_API_KEY
 */

// Extra origins allowed to call this when the page is hosted somewhere else.
const ALLOWED_ORIGINS = [
  'http://localhost:8731',
  'https://2698-tw.github.io',
  'https://data-extractor.jk06nm04.workers.dev',
];

// What the ask bar may read (api/ask-data), table by table. Columns are chosen to leave out the
// free-text Notes and the Discord names, since anyone can use the ask bar.
const KARTZ_BOOK = '1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE', ROSTER_BOOK = '1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8';
const ASK_MONTHS = ['January 2026', 'February 2026', 'March 2026', 'April 2026', 'May 2026', 'June 2026', 'August 2026', 'September 2026'];
const ASK_TABLES = {
  kartz_scores:  { book: KARTZ_BOOK,  ranges: ["'Input-RawData'!C:K"] },
  kartz_monthly: { book: KARTZ_BOOK,  ranges: ASK_MONTHS.map(m => `'${m}'!A:N`) },
  kartz_ratings: { book: KARTZ_BOOK,  ranges: ["'Kartz Tracker'!A2:J"] },
  roster:        { book: ROSTER_BOOK, ranges: ["'Alliance Rosters'!A:I", "'Alliance Rosters'!K:L", "'Alliance Rosters'!U:V"] },
  cp_history:    { book: ROSTER_BOOK, ranges: ["'RawData-CP'!A:I"] },
  left_roster:   { book: ROSTER_BOOK, ranges: ["'Roster-Removed/Left'!A:I", "'Roster-Removed/Left'!K:L"] },
};

// Every player's power on every server, refreshed about every ten minutes (see api/global-cp).
const GLOBAL_CP = 'https://www.topwarfandom.com/api/global-cp';

// Ollama Cloud API. Authentication is supplied through the Authorization header below.
const UPSTREAM = 'https://ollama.com/api/chat';

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-kartz-pass',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

/**
 * Translate the page's existing Gemini-shaped request into Ollama's native chat format.
 * Gemma 4 accepts images before the text prompt, which is also the order used here.
 */
async function runOllama(env, model, body) {
  if (!env.OLLAMA_API_KEY)
    throw new Error('Worker has no OLLAMA_API_KEY secret set.');

  const parts = body?.contents?.[0]?.parts || [];
  const images = parts
    .filter(p => p.inline_data?.data)
    .map(p => p.inline_data.data);
  const text = parts
    .filter(p => p.text)
    .map(p => p.text)
    .join('\n');

  const payload = {
    model,
    messages: [{
      role: 'user',
      content: text,
      images,
    }],
    stream: false,
    think: false,
    format: 'json',
    options: {
      temperature: 0,
      seed: body?.generationConfig?.seed ?? 7,
      num_predict: body?.generationConfig?.maxOutputTokens ?? 32768,
    },
  };

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.OLLAMA_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 1000);
    throw new Error(`${upstream.status}: ${detail}`);
  }

  const out = await upstream.json();
  const reply = typeof out?.message?.content === 'string'
    ? out.message.content
    : '';

  // Keep the response shape expected by index.html, so the UI/parser does not need
  // provider-specific code.
  return {
    candidates: [{
      content: {
        parts: [{ text: reply }],
      },
    }],
    usageMetadata: out?.prompt_eval_count || out?.eval_count
      ? {
          promptTokenCount: out.prompt_eval_count || 0,
          candidatesTokenCount: out.eval_count || 0,
          totalTokenCount: (out.prompt_eval_count || 0) + (out.eval_count || 0),
        }
      : undefined,
  };
}

/* ---------------- Google Sheets append ---------------- */
// Two places rows can go, one per tab of the page. The page names a target; the spreadsheet,
// tab and columns behind each name are fixed here, so no caller can point the Worker anywhere
// else. Each tab is found by its gid, the number in its link, so renaming it breaks nothing.
// The Worker signs in as a service account, so every spreadsheet here must be shared with that
// account's email as an Editor.
//
// Required Cloudflare secret — the service account's JSON key, pasted whole:
//   wrangler secret put GOOGLE_SA_KEY
const TARGETS = {
  // the Kartz tab: Input-RawData of the Kartz Tracker, C to K (B was given to another column)
  kartz: { id: '1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE', gid: 1243524383,
           from: 'C', to: 'K', book: 'Kartz Tracker' },
  // the Base CP tab: Alliance Rosters, A to I
  cp:    { id: '1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8', gid: 237521468,
           from: 'A', to: 'I', book: 'Alliance Rosters' },
};
// The game's ranking lists (docs/bookmark.html, run on the Top War web game): Date, Name, Points
// and Alliance, in A to D of the first tab. Each send is added below the lists already there.
// Only this route accepts the game page's origin.
const RANKING = { id: '12m3Eh6Xd-LWJ9mFakmEejKNpYYqm2ll-3UCx_TeBxyc', gid: 0, book: 'Game rankings' };
// The Snow Train's Unit Details (docs/extractor.js): Date, Name, March CP and Alliance, the same way
// but Unit Type (Army, Navy, Air Force) in D and Alliance in E; the headers are set to match on a send
const SNOW_TRAIN = { id: '1d2jgRQlfhYMufn69YaZ-2ZPQ-lGtfvSiOPDTEplUqGs', gid: 0, book: 'SS P2 Snow Train', extra: 'Unit Type' };
const RANKING_ORIGIN = 'https://h5.topwargame.com';
const RANKING_MAX = 3000;
// The alliances that take part in a Kartz round (api/round-*).
const ROUND_ALLIANCES = ['698N', '698S', '698W', '698C'];
const SHEET_COLS = 9;                   // both targets take nine columns
const MAX_ROWS = 1000;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));

// An access token lasts an hour; one isolate often serves several sends inside that.
let cachedToken = null;
async function googleToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  if (!env.GOOGLE_SA_KEY) throw new Error('Worker has no GOOGLE_SA_KEY secret set.');
  let sa;
  try { sa = JSON.parse(env.GOOGLE_SA_KEY); }
  catch { throw new Error('GOOGLE_SA_KEY is not valid JSON — paste the whole key file.'); }

  const der = Uint8Array.from(atob(sa.private_key
    .replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.'
    + b64urlText(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now, exp: now + 3600,
      }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + b64url(sig),
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.access_token)
    throw new Error(`Google sign-in failed: ${out.error_description || out.error || r.status}`);
  cachedToken = { token: out.access_token, exp: Date.now() + (out.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

// USER_ENTERED so the stamp and date land as real dates, like the rows typed in by hand. The
// catch is that a name starting with = + - or @ would be read as a formula, so those get the
// leading apostrophe Sheets uses to mean "this is text".
const asCell = v => typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;

async function appendRows(env, values, name = 'kartz') {
  const target = TARGETS[name] && await sheetTarget(env, name);
  if (!target) throw Object.assign(new Error(`Unknown target "${name}".`), { status: 400 });
  if (!Array.isArray(values) || !values.length)
    throw Object.assign(new Error('No rows to append.'), { status: 400 });
  if (values.length > MAX_ROWS)
    throw Object.assign(new Error(`At most ${MAX_ROWS} rows at a time.`), { status: 400 });
  if (!values.every(r => Array.isArray(r) && r.length === SHEET_COLS
                         && r.every(v => typeof v === 'string' || typeof v === 'number')))
    throw Object.assign(new Error(`Every row must be ${SHEET_COLS} text or number cells.`),
                        { status: 400 });

  const token = await googleToken(env);
  const title = await tabTitle(token, target);
  const tab = `'${title.replace(/'/g, "''")}'`;
  const { from, to } = target;

  // Not values:append. Append looks for the "table" the range touches and writes from that
  // table's first column, and column A of the Kartz tab is filled with lookup formulas — so rows
  // aimed at its data columns landed one column early. Instead: find the last row with anything
  // in the target's columns, and write the new rows into those columns directly below it. Nothing
  // outside them is ever touched.
  const got = await sheetsCall(token, 'GET', `/values/${encodeURIComponent(`${tab}!${from}:${to}`)}`
    + '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE', null, target);
  // Trailing empty rows are not returned, but a formula showing "" still counts as a value,
  // so walk back past any row whose cells are all blank.
  const seen = got.values || [];
  let filled = seen.length;
  while (filled > 0 && !(seen[filled - 1] || []).some(v => v !== '' && v != null)) filled--;
  const first = filled + 1;
  const last = first + values.length - 1;
  const range = `${tab}!${from}${first}:${to}${last}`;

  const out = await sheetsCall(token, 'PUT',
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: 'ROWS', values: values.map(row => row.map(asCell)) }, target);
  // where the rows went, by name as well as cells, for the page's confirmation and its link
  return { range: out.updatedRange || range, rows: out.updatedRows || values.length,
           book: target.book, tab: title, id: target.id, gid: target.gid };
}

async function writeRanking(env, rows, target = RANKING) {
  if (!Array.isArray(rows) || !rows.length)
    throw Object.assign(new Error('No rows to send.'), { status: 400 });
  if (rows.length > RANKING_MAX)
    throw Object.assign(new Error(`At most ${RANKING_MAX} rows at a time.`), { status: 400 });
  // points are a number, or millions written as the game shows them (256M, for March CP)
  const n = target.extra ? 4 : 3;
  if (!rows.every(r => Array.isArray(r) && r.length === n && typeof r[0] === 'string' && r[0].length <= 80
                       && (Number.isFinite(r[1]) || /^\d{1,6}M$/.test(r[1])) && typeof r[2] === 'string' && r[2].length <= 20
                       && (n === 3 || /^(Army|Navy|Air Force|)$/.test(r[3]))))
    throw Object.assign(new Error(`Every row must be [name, points, alliance${n === 4 ? ', unit type' : ''}].`), { status: 400 });
  const end = n === 4 ? 'E' : 'D';

  const token = await googleToken(env);
  const tab = `'${(await tabTitle(token, target)).replace(/'/g, "''")}'`;
  // Each list goes below the last one, the way appendRows does it: find the last row with
  // anything in A to D (E) and write directly under it.
  const got = await sheetsCall(token, 'GET', `/values/${encodeURIComponent(`${tab}!A:${end}`)}`
    + '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE', null, target);
  const seen = got.values || [];
  let filled = seen.length;
  while (filled > 0 && !(seen[filled - 1] || []).some(v => v !== '' && v != null)) filled--;
  // The date the list was sent, by the game's day: Top War runs on UTC. USER_ENTERED makes it a
  // real date in the sheet; asCell keeps a name starting with = or + as plain text.
  const date = new Date().toISOString().slice(0, 10);
  const first = Math.max(filled, 1) + 1, last = first + rows.length - 1;
  const range = `${tab}!A${first}:${end}${last}`;
  if (target.extra && ((seen[0] || [])[3] !== target.extra || (seen[0] || [])[4] !== 'Alliance')) {
    const head = `${tab}!D1:E1`;
    await sheetsCall(token, 'PUT', `/values/${encodeURIComponent(head)}?valueInputOption=RAW`, { range: head, values: [[target.extra, 'Alliance']] }, target);
  }
  const out = await sheetsCall(token, 'PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: 'ROWS',
      values: rows.map(([name, points, ally, type]) => n === 4 ? [date, asCell(name), points, type, asCell(ally)] : [date, asCell(name), points, asCell(ally)]) }, target);
  return { rows: out.updatedRows || rows.length, range: out.updatedRange || range, date,
           link: `https://docs.google.com/spreadsheets/d/${target.id}/edit#gid=${target.gid}&range=A${first}` };
}

async function sheetsCall(token, method, path, body, target) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${target.id}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = out?.error?.message || String(r.status);
    throw new Error(r.status === 403
      ? `The sheet refused the service account — share it with the account's email as Editor. (${msg})`
      : `Sheets API: ${msg}`);
  }
  return out;
}

// kept per spreadsheet and tab, since the admin view can point a target somewhere else
const cachedTabs = new Map();
async function tabTitle(token, target) {
  const key = target.id + ':' + target.gid;
  if (cachedTabs.has(key)) return cachedTabs.get(key);
  const out = await sheetsCall(token, 'GET', '?fields=sheets.properties(sheetId,title)', null, target);
  const hit = (out.sheets || []).find(t => t.properties?.sheetId === target.gid);
  if (!hit) throw new Error(`No tab with gid ${target.gid} in ${target.book}.`);
  cachedTabs.set(key, hit.properties.title);
  return hit.properties.title;
}

// Where each Send goes: the spreadsheet and tab set in the admin view (Sheets), else the ones above.
// Columns and checks stay as fixed here.
const SHEET_BASE = { kartz: TARGETS.kartz, cp: TARGETS.cp, ranking: RANKING, snowtrain: SNOW_TRAIN };
async function sheetTarget(env, name) {
  let s = null;
  try {
    if (env.ROSTER) {
      const r = await env.ROSTER.get(env.ROSTER.idFromName('roster')).fetch('https://roster/settings', { method: 'POST', body: '{}' });
      if (r.ok) s = await r.json();
    }
  } catch {}
  const o = s && s.sheets && s.sheets[name], base = SHEET_BASE[name];
  return o && o.id ? { ...base, id: o.id, gid: o.gid } : base;
}

/* ---------------- recordings: Apps Script link, B2 staging ---------------- */
// The Apps Script (apps-script/VideoUpload.gs) runs as the Drive folder's owner and hands out
// one-time Drive upload links, and renames finished files. Secrets pasted into the dashboard easily
// pick up a trailing space or line break, which Google answers with a bare 404, so both are trimmed.
const cleanSecret = v => String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
async function videoScript(env, payload, signal) {
  const scriptUrl = cleanSecret(env.VIDEO_SCRIPT_URL), pass = cleanSecret(env.VIDEO_PASS);
  if (!scriptUrl || !pass) throw new Error('Worker has no VIDEO_SCRIPT_URL / VIDEO_PASS secret set.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(scriptUrl))
    throw new Error('VIDEO_SCRIPT_URL is not a web app URL — it should look like '
      + 'https://script.google.com/macros/s/…/exec');
  // Apps Script answers a POST with a redirect to the reply, which fetch follows
  const r = await fetch(scriptUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, pass }), signal,
  });
  const j = await r.json().catch(() => ({}));
  // enough of the URL to tell which script was called, without printing all of it
  if (j.error || (!j.url && !j.ok)) {
    // a fingerprint of the whole URL: one different character anywhere gives a different one
    const print = toHex(await crypto.subtle.digest('SHA-256', te.encode(scriptUrl))).slice(0, 10);
    throw new Error(j.error || `upload script answered ${r.status} — VIDEO_SCRIPT_URL ends `
      + `"…${scriptUrl.slice(-16)}" (${scriptUrl.length} characters, fingerprint ${print})`);
  }
  return j;
}

// Staging in Backblaze B2. The browser uploads the recording straight into a B2 bucket while the
// run is read and checked — through a short-lived signed link, so the bytes never pass through the
// Worker and its 100 MB request limit does not apply. At Send the Worker copies it from B2 into
// Drive by itself, after it has answered, so the page can be closed as soon as Send is done. A
// recording that is never sent is removed by the bucket's lifecycle rule; one that is copied is
// deleted straight away. B2 is reached through its S3-compatible API, with signed links for
// everything — upload, read back, delete — so the Worker holds no B2 session of its own.
//
//   secrets   B2_ENDPOINT   the bucket's S3 endpoint, e.g. s3.us-east-005.backblazeb2.com
//             B2_BUCKET     the bucket's name
//             B2_KEY_ID, B2_APP_KEY   an application key limited to that bucket
// Without them the page falls back to uploading to Drive itself.
const b2Endpoint = env => cleanSecret(env.B2_ENDPOINT).replace(/^https?:\/\//, '').replace(/\/+$/, '');
const stagingReady = env => /^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(b2Endpoint(env))
  && !!(cleanSecret(env.B2_BUCKET) && cleanSecret(env.B2_KEY_ID) && cleanSecret(env.B2_APP_KEY));
const te = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const hmac = async (key, msg) => crypto.subtle.sign('HMAC',
  await crypto.subtle.importKey('raw', typeof key === 'string' ? te.encode(key) : key,
                                { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), te.encode(msg));
// A presigned link for B2's S3-compatible endpoint (AWS Signature Version 4, query-string form).
// Only the host header is signed, so the browser is free to send the file's Content-Type.
async function presignB2(env, method, key, seconds = 3600) {
  const host = b2Endpoint(env);
  const region = host.split('.')[1];                       // s3.<region>.backblazeb2.com
  const id = cleanSecret(env.B2_KEY_ID), secret = cleanSecret(env.B2_APP_KEY);
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');   // 20261005T123456Z
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const path = `/${cleanSecret(env.B2_BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${id}/${scope}`,
    'X-Amz-Date': amzDate, 'X-Amz-Expires': String(seconds), 'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const canonical = [method, path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope,
                  toHex(await crypto.subtle.digest('SHA-256', te.encode(canonical)))].join('\n');
  let k = await hmac('AWS4' + secret, day);
  for (const part of [region, 's3', 'aws4_request']) k = await hmac(k, part);
  return `https://${host}${path}?${query}&X-Amz-Signature=${toHex(await hmac(k, toSign))}`;
}
// After a Send: B2 → Drive, under the run's name, then the staged copy goes. The Apps Script does
// the copying (see "copy" in apps-script/VideoUpload.gs). Streaming it through here ran into
// Cloudflare's limit on background work after a reply — about 30 seconds — and recordings were cut
// off mid-copy with "Network connection lost". A script run has six minutes and finishes even if
// this stops waiting for it, so the links it gets are signed for two hours.
//
// So the Worker waits only COPY_WAIT for the script's answer. A short recording is done by then and
// any failure is logged as before; a long one is left to finish in the script, which outlives the
// wait. Waiting the full copy out instead just had Cloudflare cancel the wait at its 30-second mark,
// with a warning on every large recording. The script's own Executions page shows how those ended.
const COPY_WAIT = 20 * 1000;
async function copyStagedToDrive(env, key, name) {
  try {
    await videoScript(env, {
      action: 'copy', name, type: 'video/quicktime',
      from: await presignB2(env, 'GET', key, 7200),
      del: await presignB2(env, 'DELETE', key, 7200),
    }, AbortSignal.timeout(COPY_WAIT));
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      console.log(`recording still copying in Apps Script after ${COPY_WAIT / 1000}s: "${name}"`);
      return;
    }
    throw e;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Anything that is not the API is the site itself.
    if (!url.pathname.replace(/^\/+/, '').startsWith('api')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('No ASSETS binding: add [assets] to wrangler.toml.', { status: 500 });
    }

    const origin = request.headers.get('Origin') || '';
    const knownOrigin = !!origin
      && (origin === new URL(request.url).origin || ALLOWED_ORIGINS.includes(origin));
    const hasPass = !!env.SHARED_PASS
      && request.headers.get('x-kartz-pass') === env.SHARED_PASS;
    // the game page may reach the ranking route and the roster's MM/CE list, and nothing else
    const rankingCall = origin === RANKING_ORIGIN
      && ['api/game-ranking', 'api/roster-class', 'api/roster-update', 'api/game-cp', 'api/wb-update', 'api/game-snowtrain', 'api/st-update']
        .includes(url.pathname.replace(/^\/+/, ''));
    const allowed = knownOrigin || hasPass || rankingCall;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed ? corsHeaders(origin) : {},
      });
    }
    if (!allowed) return new Response('origin not allowed', { status: 403 });

    const cors = corsHeaders(origin);
    const reply = (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    });

    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    // The ask bar's data (docs/ask.js): a fixed set of read-only tables, each a named list of tab
    // ranges, read with the service account (Alliance Rosters is not readable by link). Nothing
    // else in either workbook can be asked for — no Notes, no Discord names — and nothing is
    // written. The Sheets answer is passed on as it comes, unparsed, so a 10,000-row tab costs the
    // Worker next to no time; the page turns it into a table. Each table is kept for five minutes.
    if (url.pathname.replace(/^\/+/, '') === 'api/ask-data') {
      const { table } = await request.json().catch(() => ({}));
      const spec = ASK_TABLES[table];
      if (!spec) return reply({ error: 'no such table' }, 400);
      const cache = caches.default, key = new Request(`https://ask-data.cache/${table}`);
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: { ...cors, 'content-type': 'application/json' } });
      let token;
      try { token = await googleToken(env); }
      catch (e) { return reply({ error: String(e.message || e) }, 500); }
      const q = spec.ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
      const up = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spec.book}/values:batchGet?${q}&majorDimension=ROWS`,
        { headers: { authorization: 'Bearer ' + token } });
      if (!up.ok) return reply({ error: `the sheet refused: ${up.status} ${(await up.text()).slice(0, 200)}` }, 502);
      const body = await up.text();
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } })));
      return new Response(body, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    // The Alliance Roster card (the site's #roster view): one alliance read by the extractor updates
    // that alliance's rows, matched by UID, which stays here and is never sent to the site.
    if (url.pathname.replace(/^\/+/, '') === 'api/roster-update') {
      if (!env.ROSTER) return reply({ error: 'Worker has no ROSTER binding — see wrangler.toml.' }, 500);
      const body = await request.text();
      if (body.length > 256 * 1024) return reply({ error: 'Request too large.' }, 413);
      let read;
      try { read = checkRosterRead(JSON.parse(body)); }
      catch (e) { return reply({ error: String(e.message || e) }, 400); }
      return rosterCall(env, '/update', read, reply);
    }
    if (url.pathname.replace(/^\/+/, '') === 'api/roster') {
      if (!env.ROSTER) return reply({ error: 'Worker has no ROSTER binding — see wrangler.toml.' }, 500);
      return rosterCall(env, '/list', null, reply);
    }
    // The Whitebeard card (#whitebeard): each read the extractor makes is kept under its UTC date, so
    // a read on a new day adds a column and another read the same day replaces that day's. Kept in
    // the roster's store; the UIDs it matches players on stay here.
    // The site's settings (alliances, each card's columns and filters, the home page, where each Send
    // goes), for every visitor; changed only through the admin view.
    if (url.pathname.replace(/^\/+/, '') === 'api/settings') {
      if (!env.ROSTER) return reply(cleanSettings(null), 200);
      return rosterCall(env, '/settings', null, reply);
    }
    // The admin view (docs/admin.js): every change to the cards and the settings, each kept in History
    // with what it replaced so it can be undone. Only with the shared password (the Worker's SHARED_PASS
    // secret), sent as x-kartz-pass; a wrong one is answered slowly, to make guessing slow.
    if (url.pathname.replace(/^\/+/, '') === 'api/admin') {
      if (!env.SHARED_PASS) return reply({ error: 'No password is set up yet: add a SHARED_PASS secret to the Worker in Cloudflare (Settings → Variables and Secrets).' }, 403);
      if (!hasPass) { await new Promise(r => setTimeout(r, 800)); return reply({ error: 'Wrong password.' }, 403); }
      if (!env.ROSTER) return reply({ error: 'Worker has no ROSTER binding — see wrangler.toml.' }, 500);
      const body = await request.text();
      if (body.length > 16 * 1024 * 1024) return reply({ error: 'Request too large.' }, 413);
      let b;
      try { b = JSON.parse(body); } catch { return reply({ error: 'Not JSON.' }, 400); }
      return rosterCall(env, '/admin', b, reply);
    }
    // The Snow Train card (#snowtrain) is kept the same way, from the Unit Details reads.
    const dayCard = { 'api/wb-update': '/wb-update', 'api/st-update': '/st-update', 'api/wb': '/wb-list', 'api/st': '/st-list' }[url.pathname.replace(/^\/+/, '')];
    if (dayCard) {
      if (!env.ROSTER) return reply({ error: 'Worker has no ROSTER binding — see wrangler.toml.' }, 500);
      if (dayCard.endsWith('-list')) return rosterCall(env, dayCard, null, reply);
      const body = await request.text();
      if (body.length > 512 * 1024) return reply({ error: 'Request too large.' }, 413);
      let read;
      try { read = checkWbRead(JSON.parse(body)); }
      catch (e) { return reply({ error: String(e.message || e) }, 400); }
      return rosterCall(env, dayCard, read, reply);
    }

    // Base CP from the extractor's alliance reads, in the Base CP tab's own format: Alliance Rosters,
    // RawData-CP, A to I: date, submitter, search name, in-game name, alliance, base CP, and the three
    // march columns left empty. The rows are checked here; the tab is the existing 'cp' target.
    if (url.pathname.replace(/^\/+/, '') === 'api/game-cp') {
      const body = await request.text();
      if (body.length > 512 * 1024) return reply({ error: { code: 413, message: 'Request too large.' } }, 413);
      try {
        const { rows } = JSON.parse(body);
        if (!Array.isArray(rows) || !rows.length || rows.length > 1000
            || !rows.every(r => Array.isArray(r) && r.length === 6
              && /^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(r[0])
              && [1, 2, 3, 4].every(i => typeof r[i] === 'string' && r[i].length <= 80) && r[1].trim()
              && Number.isFinite(r[5]) && r[5] >= 0 && r[5] < 10000))
          return reply({ error: { code: 400, message: 'Every row must be [date, submitter, search name, in-game name, alliance, base CP].' } }, 400);
        const out = await appendRows(env, rows.map(r => [...r, '', '', '']), 'cp');
        return reply(out, 200);
      } catch (e) {
        const status = e.status || (e instanceof SyntaxError ? 400 : 502);
        return reply({ error: { code: status, message: String(e && e.message || e) } }, status);
      }
    }

    // Search names for the roster card (docs/cards.js), from two tabs of the roster workbook: the
    // Alliance Rosters tab (A search name, B in-game name, C alliance), looked at first, then the Base CP
    // sends (RawData-CP, the 'cp' target), which are updated more often: each in-game name and alliance
    // with the search name sent for it most recently. A row that says nothing about who it is counts only
    // where nothing better is known: one the sheet marked "No Name Match", or one whose search name is
    // just the in-game name (the bookmark sends that for a player it could not match). Those columns
    // only; kept for ten minutes.
    if (url.pathname.replace(/^\/+/, '') === 'api/search-names') {
      const cache = caches.default, key = new Request('https://ask-data.cache/search-names');
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: { ...cors, 'content-type': 'application/json' } });
      let roster, raw;
      try {
        const token = await googleToken(env), target = await sheetTarget(env, 'cp');
        const tab = `'${(await tabTitle(token, target)).replace(/'/g, "''")}'`;
        [roster, raw] = await Promise.all([
          sheetsCall(token, 'GET', `/values/${encodeURIComponent("'Alliance Rosters'!A2:C")}?majorDimension=ROWS`, null, { id: ROSTER_BOOK }),
          sheetsCall(token, 'GET', `/values/${encodeURIComponent(tab + '!C2:J')}?majorDimension=ROWS`, null, target),
        ]);
      } catch (e) { return reply({ error: String(e.message || e) }, 502); }
      const t = v => String(v || '').trim();
      // [in-game name, alliance, search name]
      const rosterNames = (roster.values || []).map(r => [t(r[1]), t(r[2]), t(r[0])]).filter(r => r[0] && r[2]);
      // C search name, D in-game name, E alliance, J Name Check; later rows are newer
      const best = new Map();
      for (const r of raw.values || []) {
        const search = t(r[0]), name = t(r[1]), ally = t(r[2]);
        if (!search || !name) continue;
        const k = name + '\n' + ally, weak = search === name || /no name match/i.test(r[7] || '');
        if (weak && best.has(k) && !best.get(k).weak) continue;
        best.delete(k); best.set(k, { search, weak });          // kept in the order last sent
      }
      // raw: [in-game name, alliance, search name, 1 if it says nothing about who it is], oldest first
      const body = JSON.stringify({ roster: rosterNames, raw: [...best].map(([k, v]) => [...k.split('\n'), v.search, v.weak ? 1 : 0]) });
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600' } })));
      return new Response(body, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    // MM/CE for the extractor (docs/extractor.js): search name, in-game name, alliance, MM/CE and
    // Base CP (to tell apart two players with one name) from the Alliance Rosters tab — those five
    // columns only, nothing else from the sheet. Kept for ten minutes, so opening the extractor again
    // does not go back to the sheet.
    if (url.pathname.replace(/^\/+/, '') === 'api/roster-class') {
      const cache = caches.default, key = new Request('https://ask-data.cache/roster-class');
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { headers: { ...cors, 'content-type': 'application/json' } });
      let token;
      try { token = await googleToken(env); }
      catch (e) { return reply({ error: String(e.message || e) }, 500); }
      const range = encodeURIComponent("'Alliance Rosters'!A2:E");
      const up = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ROSTER_BOOK}/values/${range}?majorDimension=ROWS`,
        { headers: { authorization: 'Bearer ' + token } });
      if (!up.ok) return reply({ error: `the sheet refused: ${up.status}` }, 502);
      const rows = ((await up.json()).values || [])
        .map(r => [r[0] || '', r[1] || '', r[2] || '', r[4] || '', r[3] || ''].map(v => String(v).trim()))
        .filter(r => (r[0] || r[1]) && /^(MM|CE)$/.test(r[3]));
      const body = JSON.stringify({ rows });
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600' } })));
      return new Response(body, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    // The Global CP list (topwarfandom.com), for the Base CP tab. That site does not let other
    // pages read it, so it comes through here — passed on unchanged rather than filtered: it is
    // 28 MB, more than a free-plan Worker has the time to sort through, and the page keeps its
    // own server and alliance. Cloudflare keeps a copy for ten minutes, which is as often as the
    // list itself changes, so repeated fetches do not go back to the site.
    // A ranking list read from the game by the bookmark (docs/bookmark.html): added below the lists
    // already in the Game rankings sheet. The sheet and columns are fixed above.
    // The Snow Train's Unit Details go to their own sheet the same way.
    const rankingRoute = { 'api/game-ranking': 'ranking', 'api/game-snowtrain': 'snowtrain' }[url.pathname.replace(/^\/+/, '')];
    if (rankingRoute) {
      const body = await request.text();
      if (body.length > 512 * 1024) return reply({ error: 'Request too large.' }, 413);
      try {
        return reply(await writeRanking(env, JSON.parse(body).rows, await sheetTarget(env, rankingRoute)), 200);
      } catch (e) {
        const status = e.status || (e instanceof SyntaxError ? 400 : 502);
        return reply({ error: String(e && e.message || e) }, status);
      }
    }

    if (url.pathname.replace(/^\/+/, '') === 'api/global-cp') {
      let up;
      try {
        up = await fetch(GLOBAL_CP, { cf: { cacheTtl: 600, cacheEverything: true } });
      } catch (e) {
        return reply({ error: 'the Global CP list could not be reached: ' + (e.message || e) }, 502);
      }
      if (!up.ok) return reply({ error: `the Global CP list refused: ${up.status}` }, 502);
      return new Response(up.body, { headers: { ...cors, 'content-type': 'application/json' } });
    }

    // Checked before the model route, which would otherwise take "append" for a model name.
    if (url.pathname.replace(/^\/+/, '') === 'api/append') {
      const body = await request.text();
      if (body.length > 1024 * 1024)
        return reply({ error: { code: 413, message: 'Request too large.' } }, 413);
      try {
        const { values, target, video } = JSON.parse(body);
        const out = await appendRows(env, values, target);
        // The Kartz recording, staged in B2 at Extract: copied to Drive after this reply, so the
        // page need not stay open for it. Only keys this Worker hands out are accepted.
        if (video && stagingReady(env) && /^kartz\/[\w.-]{1,120}$/.test(video.key || '')
            && typeof video.name === 'string' && video.name.length <= 200) {
          ctx.waitUntil(copyStagedToDrive(env, video.key, video.name)
            .catch(e => console.error('recording not copied to Drive:', e && e.message || e)));
          out.video = 'copying';
        }
        return reply(out, 200);
      } catch (e) {
        const status = e.status || (e instanceof SyntaxError ? 400 : 502);
        return reply({ error: { code: status, message: String(e && e.message || e) } }, status);
      }
    }

    // /api/video-session: a one-time upload link for the recording, into the Kartz recordings folder
    // on Google Drive. It comes from an Apps Script that runs as the folder's owner (see
    // apps-script/VideoUpload.gs) — the service account has no Drive storage to upload with. The
    // Worker only fetches the link, adding the passphrase; the video itself goes straight from the
    // browser to Drive.
    //   wrangler secret put VIDEO_SCRIPT_URL
    //   wrangler secret put VIDEO_PASS
    const videoRoute = url.pathname.replace(/^\/+/, '');
    // A staged recording handed over after its rows were sent: copied to Drive after this reply, so
    // the page need not stay open for it. Only keys this Worker hands out are accepted.
    if (videoRoute === 'api/video-commit') {
      if (!stagingReady(env)) return reply({ error: { code: 501, message: 'B2 staging is not set up.' } }, 501);
      try {
        const { key, name } = JSON.parse(await request.text());
        if (!/^kartz\/[\w.-]{1,120}$/.test(key || '') || typeof name !== 'string' || !name || name.length > 200)
          return reply({ error: { code: 400, message: 'Bad recording details.' } }, 400);
        ctx.waitUntil(copyStagedToDrive(env, key, name)
          .catch(e => console.error('recording not copied to Drive:', e && e.message || e)));
        return reply({ ok: true }, 202);
      } catch (e) {
        return reply({ error: { code: 400, message: String(e && e.message || e) } }, 400);
      }
    }
    // A signed link for uploading the recording straight into B2 (see "Staging in Backblaze B2").
    // Kartz rounds (docs/batch.js): each alliance uploads its recording for the day into a shared
    // place in the B2 staging bucket, and one person reads all of them at once. A round is a month
    // and day, e.g. Oct26-Day-1; each alliance has one recording in it, under a fixed key, beside a
    // small note of who sent it and whether it has been read and sent:
    //   kartz/round-Oct26-Day-1-698S.mov    kartz/round-Oct26-Day-1-698S.json
    // A second upload for the same alliance and day replaces the first. The keys sit under kartz/ so
    // api/video-commit can copy them on to Drive after the rows are sent, like any other recording,
    // and the bucket's lifecycle rule clears whatever is left.
    //   round-stage   a signed upload link for one alliance's recording
    //   round-done    the note, written once the upload has finished (and again when it is sent)
    //   round-status  each alliance's note for a round, or nothing
    //   round-video   a signed link to read one recording back, for Extract all
    if (['api/round-stage', 'api/round-done', 'api/round-status', 'api/round-video'].includes(videoRoute)) {
      if (!stagingReady(env)) return reply({ error: { code: 501, message: 'B2 staging is not set up.' } }, 501);
      try {
        const b = JSON.parse(await request.text());
        const round = String(b.round || '');
        if (!/^[A-Z][a-z]{2}\d{2}-Day-[147]$/.test(round))
          return reply({ error: { code: 400, message: 'Bad round.' } }, 400);
        const base = a => `kartz/round-${round}-${a}`;
        const note = async a => {
          const r = await fetch(await presignB2(env, 'GET', base(a) + '.json', 300));
          return r.ok ? r.json().catch(() => null) : null;
        };
        if (videoRoute === 'api/round-status') {
          const out = {};
          await Promise.all(ROUND_ALLIANCES.map(async a => { out[a] = await note(a); }));
          return reply({ round, alliances: out }, 200);
        }
        const a = String(b.alliance || '');
        if (!ROUND_ALLIANCES.includes(a)) return reply({ error: { code: 400, message: 'Bad alliance.' } }, 400);
        if (videoRoute === 'api/round-stage') {
          const { type, size } = b;
          if (!/^video\//.test(type || '') || !(size > 0 && size < 5e9))
            return reply({ error: { code: 400, message: 'Bad recording details.' } }, 400);
          const ext = /mp4/.test(type) ? 'mp4' : /webm/.test(type) ? 'webm' : 'mov';
          const key = `${base(a)}.${ext}`;
          return reply({ key, url: await presignB2(env, 'PUT', key, 7200) }, 200);
        }
        if (videoRoute === 'api/round-video') {
          const n = await note(a);
          if (!n || !n.key) return reply({ error: { code: 404, message: `No recording for ${a} yet.` } }, 404);
          return reply({ ...n, url: await presignB2(env, 'GET', n.key, 3600) }, 200);
        }
        // round-done: who sent it, when, and later that it was read and sent
        const old = await note(a) || {};
        const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
        const next = {
          key: /^kartz\/round-[\w.-]{1,120}$/.test(b.key || '') ? b.key : old.key,
          submitter: clip(b.submitter ?? old.submitter, 40), file: clip(b.file ?? old.file, 120),
          size: Number(b.size ?? old.size) || 0,
          uploadedAt: b.sent ? old.uploadedAt : new Date().toISOString(),
          sentAt: b.sent ? new Date().toISOString() : (b.key ? null : old.sentAt || null),
          rows: b.sent ? Number(b.rows) || 0 : (b.key ? null : old.rows ?? null),
        };
        if (!next.key) return reply({ error: { code: 400, message: 'No recording key.' } }, 400);
        const put = await fetch(await presignB2(env, 'PUT', base(a) + '.json', 300),
          { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
        if (!put.ok) return reply({ error: { code: 502, message: `B2 refused the note (${put.status})` } }, 502);
        return reply(next, 200);
      } catch (e) {
        return reply({ error: { code: 500, message: String(e && e.message || e) } }, 500);
      }
    }
    if (videoRoute === 'api/video-stage') {
      if (!stagingReady(env)) return reply({ error: { code: 501, message: 'B2 staging is not set up.' } }, 501);
      try {
        const { type, size } = JSON.parse(await request.text());
        if (!/^video\//.test(type || '') || !(size > 0 && size < 5e9))
          return reply({ error: { code: 400, message: 'Bad recording details.' } }, 400);
        const ext = /mp4/.test(type) ? 'mp4' : /webm/.test(type) ? 'webm' : 'mov';
        const key = `kartz/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        return reply({ key, url: await presignB2(env, 'PUT', key) }, 200);
      } catch (e) {
        return reply({ error: { code: 500, message: String(e && e.message || e) } }, 500);
      }
    }
    // A one-time Drive upload link, or the renaming of a finished upload — used when B2 staging
    // is not set up and the page uploads to Drive itself.
    if (videoRoute === 'api/video-session' || videoRoute === 'api/video-rename') {
      try {
        const { name, type, size, fileId } = JSON.parse(await request.text());
        const rename = videoRoute === 'api/video-rename';
        if (typeof name !== 'string' || !name || name.length > 200
            || (rename ? !/^[\w-]{10,200}$/.test(fileId || '')
                       : !/^video\//.test(type || '') || !(size > 0 && size < 2e9)))
          return reply({ error: { code: 400, message: 'Bad recording details.' } }, 400);
        const j = await videoScript(env, rename ? { action: 'rename', fileId, name }
                                                : { name, type, size, origin });
        return reply(rename ? { ok: true } : { url: j.url }, 200);
      } catch (e) {
        return reply({ error: { code: 502, message: String(e && e.message || e) } }, 502);
      }
    }

    // /api/gemini/<model>: the Base CP tab, on Gemini instead of Ollama. The page already
    // speaks Gemini's own request shape, so this adds the key and forwards it untouched.
    // Gemini's file storage, for reading a whole recording as a video (test.html). The video itself
    // never comes through here — it can be hundreds of MB, past a Worker's request limit. This only
    // opens an upload session with the key, and hands back the session's own link, which the page
    // then uploads to directly (Google accepts uploads from the site's origin). The link is good for
    // that one upload and nothing else, so the key stays here. Gemini deletes files after 48 hours.
    const fileRoute = url.pathname.replace(/^\/+/, '');
    if (fileRoute === 'api/gemini-upload-start' || fileRoute === 'api/gemini-file' || fileRoute === 'api/gemini-models') {
      if (!env.GEMINI_API_KEY) return reply({ error: 'Worker has no GEMINI_API_KEY secret set.' }, 500);
      const key = env.GEMINI_API_KEY, GB = 'https://generativelanguage.googleapis.com';
      const j = await request.json().catch(() => ({}));
      if (fileRoute === 'api/gemini-upload-start') {
        const size = Number(j.size);
        const type = /^video\/[\w.+-]{1,40}$/.test(j.type || '') ? j.type : 'video/quicktime';
        if (!(size > 0 && size <= 2 * 1024 ** 3)) return reply({ error: 'the recording size is missing or over 2 GB' }, 400);
        const r = await fetch(`${GB}/upload/v1beta/files`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': key, 'content-type': 'application/json',
            'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start',
            'x-goog-upload-header-content-length': String(size), 'x-goog-upload-header-content-type': type,
            // the page's own origin, so the session takes the upload from the page (as Drive needed)
            ...(origin ? { origin } : {}),
          },
          body: JSON.stringify({ file: { display_name: String(j.name || 'recording').slice(0, 120) } }),
        });
        const link = r.headers.get('x-goog-upload-url');
        if (!link) return reply({ error: `Gemini would not open an upload: ${r.status} ${(await r.text()).slice(0, 200)}` }, 502);
        return reply({ url: link, type,
                       granularity: +(r.headers.get('x-goog-upload-chunk-granularity') || 0) || 8 * 1024 * 1024 }, 200);
      }
      if (fileRoute === 'api/gemini-file') {
        // whether an uploaded video has finished processing (state ACTIVE) and can be read
        if (!/^files\/[\w-]{1,80}$/.test(j.name || '')) return reply({ error: 'bad file name' }, 400);
        const r = await fetch(`${GB}/v1beta/${j.name}`, { headers: { 'x-goog-api-key': key } });
        return new Response(await r.text(), { status: r.status, headers: { ...cors, 'content-type': 'application/json' } });
      }
      // the models this key can use, so the test page can offer the right names
      const r = await fetch(`${GB}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
      const m = await r.json().catch(() => ({}));
      return reply({ models: (m.models || [])
        .filter(x => (x.supportedGenerationMethods || []).includes('generateContent'))
        .map(x => ({ name: String(x.name || '').replace(/^models\//, ''), label: x.displayName || '' })) }, r.ok ? 200 : r.status);
    }

    const gem = url.pathname.replace(/^\/+/, '').match(/^api\/gemini\/([a-zA-Z0-9._\-]{1,80})$/);
    if (gem) {
      if (!env.GEMINI_API_KEY)
        return reply({ error: { code: 500, message: 'Worker has no GEMINI_API_KEY secret set.' } }, 500);
      const body = await request.text();
      if (body.length > 25 * 1024 * 1024)
        return reply({ error: { code: 413, message: 'Request too large.' } }, 413);
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${gem[1]}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body,
        });
      // Gemini's status passes through, so the page still sees a 429 as a 429 and waits it out
      // with the delay Gemini asks for.
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    }

    // Path is /<model>, or /api/<model>.
    const model = decodeURIComponent(
      new URL(request.url).pathname.replace(/^\/+/, '').replace(/^api\/+/, '')
    );
    if (!/^[a-zA-Z0-9._:\-]{1,80}$/.test(model))
      return reply({ error: { code: 400, message: 'Bad model name.' } }, 400);

    if (!env.OLLAMA_API_KEY)
      return reply({
        error: {
          code: 500,
          message: 'Worker has no OLLAMA_API_KEY secret set.',
        },
      }, 500);

    // Frames are large; cap the request body so a stray caller cannot post something enormous.
    const body = await request.text();
    if (body.length > 25 * 1024 * 1024)
      return reply({ error: { code: 413, message: 'Request too large.' } }, 413);

    try {
      const out = await runOllama(env, model, JSON.parse(body));
      return reply(out, 200);
    } catch (e) {
      return reply({
        error: {
          code: 502,
          message: String(e && e.message || e),
        },
      }, 502);
    }
  },
};

/* ---------------- the Alliance Roster card ---------------- */
// What one alliance read may hold. Alliances are the four the extractor reads; every field is checked
// so the store only ever holds what the card shows, plus the UID it matches on.
const ROSTER_ALLIANCES = ['698N', '698S', '698W', '698C'];
function checkRosterRead(b) {
  if (!b || !ROSTER_ALLIANCES.includes(b.alliance)) throw new Error('unknown alliance');
  const m = b.members;
  if (!Array.isArray(m) || !m.length || m.length > 300) throw new Error('members must be 1 to 300 players');
  const num = v => Number.isFinite(v) ? v : 0, str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    alliance: b.alliance,
    members: m.map(x => {
      if (!x || !/^\d{5,20}$/.test(String(x.uid))) throw new Error('every member needs its id');
      return { uid: String(x.uid), name: str(x.name, 60), search: str(x.search, 60), rank: num(x.rank), power: num(x.power),
               level: num(x.level), join: num(x.join), last: num(x.last), online: !!x.online, cls: /^(MM|CE)$/.test(x.cls) ? x.cls : '' };
    }),
  };
}

// One Whitebeard read: every player in the ranking, with the points the game showed. A player is
// keyed by UID; one the game gave no UID is keyed by name instead.
function checkWbRead(b) {
  const r = b && b.rows;
  if (!Array.isArray(r) || !r.length || r.length > 3000) throw new Error('rows must be 1 to 3000 players');
  return {
    rows: r.map(x => {
      if (!x || !Number.isFinite(x.points)) throw new Error('every player needs points');
      const name = String(x.name == null ? '' : x.name).slice(0, 60);
      const key = /^\d{5,20}$/.test(String(x.uid)) ? String(x.uid) : 'n|' + name;
      return { key, name, ally: String(x.ally == null ? '' : x.ally).slice(0, 20), points: x.points,
               type: /^(Army|Navy|Air Force)$/.test(x.type) ? x.type : '' };
    }),
  };
}

// A Snow Train day's points for a player as { unit type: March CP }; reads kept before unit types were
// tracked per day hold a bare number, which belongs to the player's unit type then.
const asTypes = (v, type) => v == null ? {} : typeof v === 'number' ? { [type || '']: v } : { ...v };
// a player's best March CP per unit type, [[type, cp], …] in the order the types first appeared
const bestsOf = w => (w.bests || (w.best ? [[w.type || '', w.best]] : [])).map(x => x.slice());

/* ---------------- site settings ---------------- */
// What the admin view can set besides the cards' rows: the alliances (filter chips), each card's title,
// columns, default sort and filter and number format, the home page, and where each Send goes. Kept in
// the store under 'settings'; anything missing or not valid falls back to these.
const UNIT_TYPES = ['Army', 'Navy', 'Air Force'];
const col = (k, label) => ({ k, label, show: true });
const DEFAULT_SETTINGS = {
  alliances: ['698N', '698S', '698W', '698C'],
  cards: {
    wb: { title: 'Whitebeard ranking', sort: 'last', filter: '', fmt: 'full', unitFilters: false,
          cols: [col('name', 'Name'), col('ally', 'Alliance'), col('@dates', 'Date columns')] },
    st: { title: 'Snow Train', sort: 'cp1', filter: '', fmt: 'M', unitFilters: true,
          cols: [col('name', 'Name'), col('cp1', 'March CP 1'), col('u1', 'Unit 1'), col('cp2', 'March CP 2'), col('u2', 'Unit 2'),
                 col('cp3', 'March CP 3'), col('u3', 'Unit 3'), col('ally', 'Alliance'), col('@dates', 'Date columns')] },
    ro: { title: 'Alliance roster', sort: 'power', filter: '', fmt: 'M', unitFilters: false,
          cols: [col('name', 'Name'), col('alliance', 'Alliance'), col('rank', 'Rank'), col('power', 'Power'), col('cls', 'MM/CE'),
                 col('join', 'Joined'), col('last', 'Last online'), col('status', 'Status')] },
  },
  home: { title: '2698 Data Extractor', banner: '2698', cards: [
    { id: 'kartz', title: 'Kartz ranking', show: true, link: 'https://docs.google.com/spreadsheets/d/1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE/edit#gid=1243524383' },
    { id: 'cp', title: 'Alliance roster', show: true, link: 'https://docs.google.com/spreadsheets/d/1gumrQaMDdMzkzX3s9leBQZFt2jvDYhAU488sH4sXPY8/edit' },
    { id: 'wb', title: 'Whitebeard ranking', show: true, link: 'https://docs.google.com/spreadsheets/d/12m3Eh6Xd-LWJ9mFakmEejKNpYYqm2ll-3UCx_TeBxyc/edit#gid=0' },
    { id: 'st', title: 'Snow Train', show: true, link: 'https://docs.google.com/spreadsheets/d/1d2jgRQlfhYMufn69YaZ-2ZPQ-lGtfvSiOPDTEplUqGs/edit#gid=0' }] },
  sheets: Object.fromEntries(Object.entries(SHEET_BASE).map(([k, t]) => [k, { id: t.id, gid: t.gid }])),
};
// settings as sent, made safe: unknown fields dropped, each value checked, the defaults filling the gaps
function cleanSettings(s) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!s || typeof s !== 'object') return out;
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  if (Array.isArray(s.alliances)) {
    const a = [...new Set(s.alliances.map(x => str(x, 12)).filter(x => /^[^\s<>"'&]{1,12}$/.test(x)))].slice(0, 12);
    if (a.length) out.alliances = a;
  }
  for (const c of ['wb', 'st', 'ro']) {
    const i = s.cards && s.cards[c], o = out.cards[c];
    if (!i || typeof i !== 'object') continue;
    o.title = str(i.title, 40) || o.title;
    o.fmt = ['M', 'k', 'full'].includes(i.fmt) ? i.fmt : o.fmt;
    if (typeof i.unitFilters === 'boolean') o.unitFilters = i.unitFilters;
    if (Array.isArray(i.cols)) {
      const known = new Map(o.cols.map(x => [x.k, x])), cols = [];
      for (const x of i.cols) {
        const b = x && known.get(x.k);
        if (b && !cols.some(y => y.k === x.k)) cols.push({ k: b.k, label: str(x.label, 30) || b.label, show: b.k === 'name' || x.show !== false });
      }
      for (const b of o.cols) if (!cols.some(y => y.k === b.k)) cols.push(b);
      cols.sort((a, b) => (b.k === 'name') - (a.k === 'name'));        // Name stays first
      o.cols = cols;
    }
    const sorts = o.cols.map(x => x.k).filter(k => k !== '@dates').concat(c === 'ro' ? [] : ['last']);
    if (sorts.includes(i.sort)) o.sort = i.sort;
    o.filter = i.filter === '' || out.alliances.includes(i.filter) || (i.filter === 'OTHER' && c !== 'ro') ? i.filter : '';
  }
  const h = s.home;
  if (h && typeof h === 'object') {
    out.home.title = str(h.title, 60) || out.home.title;
    if (/^\d{1,6}$/.test(h.banner)) out.home.banner = h.banner;
    if (Array.isArray(h.cards)) {
      const known = new Map(out.home.cards.map(x => [x.id, x])), cards = [];
      for (const x of h.cards) {
        const b = x && known.get(x.id);
        if (b && !cards.some(y => y.id === x.id))
          cards.push({ id: b.id, title: str(x.title, 40) || b.title, show: x.show !== false,
                       link: /^https:\/\/[^\s"'<>]{1,400}$/.test(x.link || '') ? x.link : b.link });
      }
      for (const b of out.home.cards) if (!cards.some(y => y.id === b.id)) cards.push(b);
      out.home.cards = cards;
    }
  }
  for (const name of Object.keys(SHEET_BASE)) {
    const i = s.sheets && s.sheets[name];
    if (i && /^[\w-]{20,100}$/.test(i.id) && Number.isInteger(i.gid) && i.gid >= 0) out.sheets[name] = { id: i.id, gid: i.gid };
  }
  return out;
}

// The store is asked with a plain request (stub.fetch) rather than by calling its methods: that works
// for any Durable Object class. Any failure comes back as a JSON error with the CORS headers, never as
// Cloudflare's bare error page (which a browser reports only as a CORS block).
async function rosterCall(env, path, body, reply) {
  try {
    const stub = env.ROSTER.get(env.ROSTER.idFromName('roster'));
    const r = await stub.fetch('https://roster' + path, { method: 'POST', body: JSON.stringify(body || {}) });
    const j = await r.json();
    return reply(j, r.ok ? 200 : r.status === 400 ? 400 : 500);
  } catch (e) {
    return reply({ error: 'the roster store failed: ' + String(e && e.message || e) }, 500);
  }
}

// What a backup holds and a restore may write: the cards' data and the settings, not History
const DATA_KEY = /^(rows|reads|settings|(wb|st):who|(wb|st):day:\d{4}-\d{2}-\d{2}|adm:alias:(wb|st))$/;
const LOG_MAX = 100;                          // changes kept in History, each with what it replaced
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'));
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const text = (v, n, need) => { const t = String(v == null ? '' : v).trim().slice(0, n); if (need && !t) throw bad('It cannot be empty.'); return t; };
const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad('Not a valid number: ' + v); return n; };
const cardOf = b => { if (!['wb', 'st', 'ro'].includes(b.card)) throw bad('Unknown card.'); return b.card; };
// a Snow Train day's value as sent by the admin view: { unit type: March CP }
const cleanTypes = v => {
  if (!v || typeof v !== 'object') throw bad('Bad day value.');
  const o = {};
  for (const [t, p] of Object.entries(v)) { if (!UNIT_TYPES.includes(t)) throw bad('Unknown unit type: ' + t); o[t] = num(p, 0, 1e13); }
  if (!Object.keys(o).length) throw bad('Bad day value.');
  return o;
};
// storage calls take at most 128 keys at a time
async function putMany(st, obj) {
  const e = Object.entries(obj);
  for (let i = 0; i < e.length; i += 128) await st.put(Object.fromEntries(e.slice(i, i + 128)));
}
const snapKeys = e => Array.from({ length: e.n }, (_, j) => `adm:snap:${e.id}:${j}`);
async function delSnaps(st, e) {
  const k = snapKeys(e);
  for (let i = 0; i < k.length; i += 128) await st.delete(k.slice(i, i + 128));
}

// Each admin change, run against `tx` (get, put, del, list), which keeps what every written key held
// before. `this` is the store.
const ADMIN_OPS = {
  // one field of one player
  async 'row-set'(tx, b) {
    const ns = cardOf(b), v = b.value;
    if (ns === 'ro') {
      const rows = (await tx.get('rows')) || {}, r = rows[await this.keyOf('ro', b.id, rows)];
      switch (b.field) {
        case 'name': r.name = text(v, 60, true); break;
        case 'alliance': if (!(await this.alliances()).includes(v)) throw bad('Unknown alliance.'); r.alliance = v; break;
        case 'rank': r.rank = Math.round(num(v, 0, 6)); break;
        case 'power': r.power = num(v, 0, 1e13); break;
        // the bookmark sends MM/CE from the Alliance Rosters sheet; one set here stays over its reads
        case 'cls': if (!/^(MM|CE|)$/.test(v)) throw bad('MM, CE or nothing.'); r.cls = v; r.pin = { ...r.pin, cls: v }; break;
        case 'status': if (!['Active', 'Left'].includes(v)) throw bad('Active or Left.'); r.status = v; r.leftAt = v === 'Left' ? r.leftAt || Date.now() : 0; break;
        case 'join': r.join = Math.round(num(v, 0, 4e9)); break;
        case 'last': r.last = Math.round(num(v, 0, 4e9)); r.online = false; break;
        default: throw bad('That cannot be changed.');
      }
      return tx.put('rows', rows);
    }
    const who = (await tx.get(ns + ':who')) || {}, w = who[await this.keyOf(ns, b.id, who)];
    if (b.field === 'name') w.name = text(v, 60, true);
    else if (b.field === 'ally') w.ally = text(v, 20);
    else throw bad('That cannot be changed.');
    return tx.put(ns + ':who', who);
  },
  // Whitebeard: one player's points on one day, or none
  async 'cell-set'(tx, b) {
    if (cardOf(b) !== 'wb' || !isDay(b.day)) throw bad('Bad cell.');
    const who = (await tx.get('wb:who')) || {}, k = await this.keyOf('wb', b.id, who);
    const pts = await tx.get('wb:day:' + b.day);
    if (!pts) throw bad('There is no column for ' + b.day + '.');
    if (b.value == null) delete pts[k]; else pts[k] = num(b.value, 0, 1e13);
    return tx.put('wb:day:' + b.day, pts);
  },
  // Snow Train: one player's March CP per unit type on some days (null: not on a train that day),
  // and their March CP 1–3 worked out again from all their days if asked
  async 'days-set'(tx, b) {
    if (cardOf(b) !== 'st' || !b.days || typeof b.days !== 'object') throw bad('Bad days.');
    const who = (await tx.get('st:who')) || {}, k = await this.keyOf('st', b.id, who);
    for (const [d, v] of Object.entries(b.days)) {
      if (!isDay(d)) throw bad('Bad date.');
      const pts = await tx.get('st:day:' + d);
      if (!pts) throw bad('There is no column for ' + d + '.');
      if (v == null) { if (!(k in pts)) continue; delete pts[k]; } else pts[k] = cleanTypes(v);
      await tx.put('st:day:' + d, pts);
    }
    if (b.recalc) {
      who[k].bests = (await this.bestsFromDays(tx, who))[k] || [];
      delete who[k].best;
      await tx.put('st:who', who);
    }
  },
  // Snow Train: March CP 1–3 as given, [[unit type, March CP], …]
  async 'bests-set'(tx, b) {
    if (cardOf(b) !== 'st' || !Array.isArray(b.bests) || b.bests.length > 3) throw bad('Bad March CP.');
    const bests = b.bests.map(x => { if (!Array.isArray(x) || !UNIT_TYPES.includes(x[0])) throw bad('Bad unit type.'); return [x[0], num(x[1], 0, 1e13)]; });
    if (new Set(bests.map(x => x[0])).size !== bests.length) throw bad('Each unit type can be there once.');
    const who = (await tx.get('st:who')) || {}, w = who[await this.keyOf('st', b.id, who)];
    w.bests = bests; if (bests[0]) w.type = bests[0][0]; delete w.best;
    return tx.put('st:who', who);
  },
  async 'row-add'(tx, b) {
    const ns = cardOf(b), name = text(b.name, 60, true), key = 'a|' + crypto.randomUUID().slice(0, 12), now = Date.now();
    if (ns === 'ro') {
      if (!(await this.alliances()).includes(b.ally)) throw bad('Pick an alliance.');
      const rows = (await tx.get('rows')) || {};
      rows[key] = { name, search: name, rank: 1, power: 0, level: 0, join: Math.floor(now / 1000), last: Math.floor(now / 1000), online: false, cls: '',
                    alliance: b.ally, status: 'Active', leftAt: 0, seenAt: now, firstAt: now };
      await tx.put('rows', rows);
    } else {
      const who = (await tx.get(ns + ':who')) || {};
      who[key] = ns === 'st' ? { name, ally: text(b.ally, 20), type: '', bests: [], manual: 1 } : { name, ally: text(b.ally, 20), manual: 1 };
      await tx.put(ns + ':who', who);
    }
    return { id: (await this.ids(ns, [key]))[key] };
  },
  async 'row-delete'(tx, b) {
    const ns = cardOf(b);
    if (!Array.isArray(b.ids) || !b.ids.length) throw bad('No players.');
    if (ns === 'ro') {
      const rows = (await tx.get('rows')) || {};
      for (const k of await this.keysOf('ro', b.ids, rows)) delete rows[k];
      return tx.put('rows', rows);
    }
    const who = (await tx.get(ns + ':who')) || {}, keys = await this.keysOf(ns, b.ids, who);
    for (const k of keys) delete who[k];
    await tx.put(ns + ':who', who);
    for (const [dk, pts] of await tx.list(ns + ':day:')) {
      if (!keys.some(k => k in pts)) continue;
      for (const k of keys) delete pts[k];
      await tx.put(dk, pts);
    }
    // the game's ids merged into a deleted player start afresh on the next read
    const alias = (await tx.get('adm:alias:' + ns)) || {};
    if (Object.entries(alias).some(([a, k]) => keys.includes(k) || keys.includes(a))) {
      for (const [a, k] of Object.entries(alias)) if (keys.includes(k) || keys.includes(a)) delete alias[a];
      await tx.put('adm:alias:' + ns, alias);
    }
  },
  // Several players made one (a renamed player, or one listed twice): their days joined, the higher
  // value kept where both have one. Later reads of the others count for the one kept.
  async merge(tx, b) {
    const ns = cardOf(b);
    if (ns === 'ro') throw bad('Roster players cannot be merged.');
    const who = (await tx.get(ns + ':who')) || {}, keep = await this.keyOf(ns, b.keep, who);
    const others = (await this.keysOf(ns, b.ids, who)).filter(k => k !== keep);
    if (!others.length) throw bad('Pick another player to merge with.');
    for (const [dk, pts] of await tx.list(ns + ':day:')) {
      if (!others.some(k => k in pts)) continue;
      for (const o of others) {
        if (!(o in pts)) continue;
        if (ns === 'wb') pts[keep] = Math.max(pts[keep] ?? -Infinity, pts[o]);
        else {
          const into = asTypes(pts[keep], who[keep].type);
          for (const [t, p] of Object.entries(asTypes(pts[o], who[o].type))) into[t] = Math.max(into[t] || 0, p);
          pts[keep] = into;
        }
        delete pts[o];
      }
      await tx.put(dk, pts);
    }
    if (ns === 'st') {
      const bests = bestsOf(who[keep]);
      for (const o of others) for (const [t, p] of bestsOf(who[o])) {
        const x = bests.find(y => y[0] === t); if (x) x[1] = Math.max(x[1], p); else bests.push([t, p]);
      }
      who[keep].bests = bests; delete who[keep].best;
    }
    for (const o of others) { if (who[o].manual && !who[keep].manual) delete who[keep].manual; delete who[o]; }
    await tx.put(ns + ':who', who);
    const alias = (await tx.get('adm:alias:' + ns)) || {};
    for (const [a, k] of Object.entries(alias)) if (others.includes(k)) alias[a] = keep;
    for (const o of others) alias[o] = keep;
    await tx.put('adm:alias:' + ns, alias);
  },
  async 'bulk-ally'(tx, b) {
    const ns = cardOf(b);
    if (!Array.isArray(b.ids) || !b.ids.length) throw bad('No players.');
    if (ns === 'ro') {
      if (!(await this.alliances()).includes(b.ally)) throw bad('Unknown alliance.');
      const rows = (await tx.get('rows')) || {};
      for (const k of await this.keysOf('ro', b.ids, rows)) rows[k].alliance = b.ally;
      return tx.put('rows', rows);
    }
    const who = (await tx.get(ns + ':who')) || {};
    for (const k of await this.keysOf(ns, b.ids, who)) who[k].ally = text(b.ally, 20);
    return tx.put(ns + ':who', who);
  },
  // date columns
  async 'day-add'(tx, b) {
    const ns = cardOf(b);
    if (ns === 'ro' || !isDay(b.day)) throw bad('Bad date.');
    if (await tx.get(ns + ':day:' + b.day)) throw bad('That date already has a column.');
    return tx.put(ns + ':day:' + b.day, {});
  },
  // a column moved to another date (merged with that date's, keeping each player's higher number),
  // removed, or emptied. Afterwards March CP 1–3 are worked out again from the days that are left,
  // and players left with no day at all are dropped (unless added by hand).
  async 'day-move'(tx, b) { return this.dayChange(tx, b, 'move'); },
  async 'day-delete'(tx, b) { return this.dayChange(tx, b, 'delete'); },
  async 'day-clear'(tx, b) { return this.dayChange(tx, b, 'clear'); },
  async 'roster-reads'(tx, b) {
    const a = text(b.ally, 20, true), reads = (await tx.get('reads')) || {};
    if (b.action === 'wipe') {
      const rows = (await tx.get('rows')) || {};
      for (const [k, r] of Object.entries(rows)) if (r.alliance === a) delete rows[k];
      await tx.put('rows', rows);
    } else if (b.action !== 'reset') throw bad('Reset or wipe.');
    delete reads[a];
    return tx.put('reads', reads);
  },
  // the settings; a changed Sheets target is tried first, so a wrong link is never saved
  async settings(tx, b) {
    const next = cleanSettings(b.settings), cur = await this.getSettings();
    for (const [name, t] of Object.entries(next.sheets)) {
      const was = cur.sheets[name];
      if (t.id === was.id && t.gid === was.gid) continue;
      try { await tabTitle(await googleToken(this.env), { ...SHEET_BASE[name], id: t.id, gid: t.gid }); }
      catch (e) { throw bad(`That sheet could not be used: ${e.message || e}`); }
    }
    await tx.put('settings', next);
    return { settings: next };
  },
  // An alliance renamed: in the settings and on every player who has it
  async 'alliance-rename'(tx, b) {
    const from = text(b.from, 12, true), to = text(b.to, 12, true), s = await this.getSettings();
    if (!/^[^\s<>"'&]{1,12}$/.test(to)) throw bad('Not a valid tag.');
    if (!s.alliances.includes(from) || s.alliances.includes(to)) throw bad(s.alliances.includes(to) ? to + ' is already there.' : 'Unknown alliance.');
    s.alliances = s.alliances.map(a => a === from ? to : a);
    for (const c of Object.values(s.cards)) if (c.filter === from) c.filter = to;
    await tx.put('settings', cleanSettings(s));
    for (const ns of ['wb', 'st']) {
      const who = (await tx.get(ns + ':who')) || {};
      if (!Object.values(who).some(w => w.ally === from)) continue;
      for (const w of Object.values(who)) if (w.ally === from) w.ally = to;
      await tx.put(ns + ':who', who);
    }
    const rows = (await tx.get('rows')) || {}, reads = (await tx.get('reads')) || {};
    if (Object.values(rows).some(r => r.alliance === from)) {
      for (const r of Object.values(rows)) if (r.alliance === from) r.alliance = to;
      await tx.put('rows', rows);
    }
    if (from in reads) { reads[to] = reads[from]; delete reads[from]; await tx.put('reads', reads); }
  },
  // a backup file put back: every card and the settings as they were in it
  async restore(tx, b) {
    const data = b.data;
    if (!data || typeof data !== 'object' || !Object.keys(data).length || !Object.keys(data).every(k => DATA_KEY.test(k)))
      throw bad('That is not a backup of this site.');
    for (const k of (await tx.list('')).keys()) if (DATA_KEY.test(k) && !(k in data)) await tx.del(k);
    for (const [k, v] of Object.entries(data)) await tx.put(k, v);
  },
};

// One store for the whole roster, keyed by UID. A read of an alliance adds its new players, updates
// the ones already there, marks the alliance's players who are missing as Left (with the date) and
// brings back anyone who returns. Rows are never deleted by a read; the admin view can.
export class RosterStore {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/update') return Response.json(await this.update(await request.json()));
      if (path === '/list') return Response.json(await this.list());
      if (path === '/wb-update') return Response.json(await this.wbUpdate(await request.json(), 'wb'));
      if (path === '/wb-list') return Response.json(await this.wbList('wb'));
      if (path === '/st-update') return Response.json(await this.wbUpdate(await request.json(), 'st'));
      if (path === '/st-list') return Response.json(await this.wbList('st'));
      if (path === '/settings') return Response.json(await this.getSettings());
      if (path === '/admin') return Response.json(await this.admin(await request.json()));
      return Response.json({ error: 'unknown roster call' }, { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e && e.message || e) }, { status: e && e.status === 400 ? 400 : 500 });
    }
  }
  async getSettings() { return cleanSettings(await this.state.storage.get('settings')); }
  async alliances() { return (await this.getSettings()).alliances; }

  // Each player's id on the site: a hash of their key with a secret kept here, so a UID can be
  // neither seen nor worked back from it, yet the admin view can still name the row to change.
  async ids(ns, keys) {
    const st = this.state.storage;
    let salt = await st.get('salt');
    if (!salt) { salt = crypto.randomUUID(); await st.put('salt', salt); }
    const out = {};
    for (const k of keys) out[k] = toHex(await crypto.subtle.digest('SHA-256', te.encode(salt + '|' + ns + '|' + k))).slice(0, 16);
    return out;
  }
  async keysOf(ns, ids, map) {
    const all = await this.ids(ns, Object.keys(map)), want = new Set(ids);
    const keys = Object.keys(all).filter(k => want.has(all[k]));
    if (keys.length !== want.size) throw bad('Someone is no longer on the card — reload it.');
    return keys;
  }
  async keyOf(ns, id, map) { return (await this.keysOf(ns, [id], map))[0]; }

  async load() { return (await this.state.storage.get('rows')) || {}; }
  async update(read) {
    const rows = await this.load(), now = Date.now(), seen = new Set();
    let added = 0, updated = 0, rejoined = 0, left = 0;
    for (const m of read.members) {
      seen.add(m.uid);
      const was = rows[m.uid];
      if (!was) added++;
      else { updated++; if (was.status === 'Left') rejoined++; }
      // what the admin view set to stay (MM/CE) wins over the read
      rows[m.uid] = { ...was, ...m, ...(was && was.pin), alliance: read.alliance, status: 'Active', leftAt: 0, seenAt: now, firstAt: (was && was.firstAt) || now };
    }
    for (const uid of Object.keys(rows)) {
      const r = rows[uid];
      if (r.alliance === read.alliance && r.status === 'Active' && !seen.has(uid)) { r.status = 'Left'; r.leftAt = now; left++; }
    }
    const reads = (await this.state.storage.get('reads')) || {};
    reads[read.alliance] = now;
    await this.state.storage.put({ rows, reads });
    return { alliance: read.alliance, added, updated, rejoined, left, total: Object.keys(rows).length };
  }
  // the card's view: every row with its site id instead of its UID, and when each alliance was last read
  async list() {
    const rows = await this.load(), reads = (await this.state.storage.get('reads')) || {};
    const ok = new Set([...ROSTER_ALLIANCES, ...await this.alliances()]), ids = await this.ids('ro', Object.keys(rows));
    return { reads, rows: Object.entries(rows).filter(([, r]) => ok.has(r.alliance)).map(([k, { uid, pin, ...r }]) => ({ id: ids[k], ...r })) };
  }

  // Whitebeard (ns 'wb') and the Snow Train (ns 'st'): each UTC day's points under a key of its own
  // (wb:day:2026-10-27), so no one value grows with the number of days; names, alliances and unit
  // types, latest first, under wb:who
  // The Snow Train keeps, per player, the highest March CP ever read (best) and which days they were
  // on a train; a second read the same day (another train) adds to that day rather than replacing it.
  // A player merged into another in the admin view is counted as that one (adm:alias).
  async wbUpdate(read, ns) {
    const day = new Date().toISOString().slice(0, 10), keep = ns === 'st';
    const before = await this.state.storage.get(ns + ':day:' + day), had = !!before && Object.keys(before).length > 0;
    const pts = keep && before ? before : {};
    const who = (await this.state.storage.get(ns + ':who')) || {};
    const alias = (await this.state.storage.get('adm:alias:' + ns)) || {};
    for (const r of read.rows) {
      const key = alias[r.key] || r.key, was = who[key] || {};
      if (!keep) { pts[key] = Math.max(pts[key] ?? -Infinity, r.points); who[key] = { name: r.name, ally: r.ally }; continue; }
      // Snow Train: that day's best per unit type, and the player's best per unit type ever, the
      // types in the order they first appeared (March CP 1, 2, 3 on the card)
      const ty = r.type || '', dayPts = asTypes(pts[key], was.type);
      dayPts[ty] = Math.max(dayPts[ty] || 0, r.points); pts[key] = dayPts;
      const bests = bestsOf(was), b = bests.find(x => x[0] === ty);
      if (b) b[1] = Math.max(b[1], r.points); else bests.push([ty, r.points]);
      who[key] = { name: r.name, ally: r.ally, type: ty || was.type || '', bests };
    }
    await this.state.storage.put({ [ns + ':day:' + day]: pts, [ns + ':who']: who });
    return { day, players: read.rows.length, replaced: had, merged: keep && had };
  }

  // each Snow Train player's best per unit type over the days there are, the types in the order they
  // first appear
  async bestsFromDays(tx, who) {
    const bests = {};
    for (const pts of (await tx.list('st:day:')).values()) for (const [k, v] of Object.entries(pts)) {
      const list = bests[k] = bests[k] || [];
      for (const [ty, p] of Object.entries(asTypes(v, who[k] && who[k].type))) {
        const b = list.find(x => x[0] === ty); if (b) b[1] = Math.max(b[1], p); else list.push([ty, p]);
      }
    }
    return bests;
  }
  async dayChange(tx, b, action) {
    const ns = cardOf(b), day = b.day, dk = ns + ':day:' + day;
    if (ns === 'ro' || !isDay(day) || (action === 'move' && !isDay(b.to))) throw bad('Bad date.');
    const from = await tx.get(dk);
    if (!from) throw bad('There is no column for ' + day + '.');
    const who = (await tx.get(ns + ':who')) || {};
    if (action === 'move') {
      if (b.to === day) throw bad('Pick a different date.');
      const into = (await tx.get(ns + ':day:' + b.to)) || {};
      for (const [k, v] of Object.entries(from)) {
        if (ns !== 'st') { into[k] = Math.max(into[k] ?? -Infinity, v); continue; }
        const a = asTypes(into[k], who[k] && who[k].type);
        for (const [ty, p] of Object.entries(asTypes(v, who[k] && who[k].type))) a[ty] = Math.max(a[ty] || 0, p);
        into[k] = a;
      }
      await tx.put(ns + ':day:' + b.to, into);
    }
    if (action === 'clear') await tx.put(dk, {}); else await tx.del(dk);
    const seen = {};
    for (const pts of (await tx.list(ns + ':day:')).values()) for (const k of Object.keys(pts)) seen[k] = 1;
    const bests = ns === 'st' ? await this.bestsFromDays(tx, who) : {};
    for (const k of Object.keys(who)) {
      if (!seen[k] && !who[k].manual) delete who[k];
      else if (ns === 'st') { who[k].bests = bests[k] || []; delete who[k].best; }
    }
    await tx.put(ns + ':who', who);
  }

  // the card's view: one row per player, with its site id instead of its key, and the points per day
  async wbList(ns) {
    const who = (await this.state.storage.get(ns + ':who')) || {};
    const days = await this.state.storage.list({ prefix: ns + ':day:' });
    const dates = [...days.keys()].map(k => k.slice(ns.length + 5)).sort();
    const ids = await this.ids(ns, Object.keys(who));
    const rows = Object.entries(who).map(([key, w]) => {
      const p = {};
      for (const d of dates) { const v = days.get(ns + ':day:' + d)[key]; if (v != null) p[d] = v; }
      return ns === 'st' ? { id: ids[key], name: w.name, ally: w.ally, type: w.type || '', bests: bestsOf(w), pts: p }
                         : { id: ids[key], name: w.name, ally: w.ally, pts: p };
    });
    return { dates, rows };
  }

  // The admin view's calls. A change is run by ADMIN_OPS and goes into History (adm:log, newest first)
  // with what every key it wrote held before (adm:snap:<id>:<n>, one key each); undoing a change puts
  // those back, after undoing every later change first.
  async admin(b) {
    const st = this.state.storage, op = b && b.op;
    if (op === 'check') return { ok: true };
    if (op === 'log') return { log: (await st.get('adm:log')) || [] };
    if (op === 'backup') {
      const data = {};
      for (const [k, v] of await st.list()) if (DATA_KEY.test(k)) data[k] = v;
      return { site: '2698', at: Date.now(), data };
    }
    if (op === 'undo') return this.undo(b.id);
    const fn = ADMIN_OPS[op];
    if (!fn) throw bad('Unknown admin change.');
    const read = new Map(), before = new Map();
    const was = async k => { if (!before.has(k)) before.set(k, read.has(k) ? read.get(k) : (await st.get(k)) ?? null); };
    const tx = {
      get: async k => { const v = await st.get(k); if (!read.has(k)) read.set(k, v === undefined ? null : structuredClone(v)); return v; },
      put: async (k, v) => { await was(k); await st.put(k, v); },
      del: async k => { await was(k); await st.delete(k); },
      list: prefix => st.list({ prefix }),
    };
    const res = (await fn.call(this, tx, b)) || {};
    if (!before.size) return { ...res, unchanged: true };
    const note = b.note || {}, clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(),
                    what: clip(note.what || op, 160), from: clip(note.from, 200), to: clip(note.to, 200), n: before.size };
    const snaps = {};
    [...before].forEach(([k, v], i) => { snaps[`adm:snap:${entry.id}:${i}`] = { k, v }; });
    await putMany(st, snaps);
    const log = (await st.get('adm:log')) || [];
    log.unshift(entry);
    for (const old of log.splice(LOG_MAX)) await delSnaps(st, old);
    await st.put('adm:log', log);
    return { ...res, entry: { id: entry.id, what: entry.what } };
  }
  async undo(id) {
    const st = this.state.storage, log = (await st.get('adm:log')) || [], i = log.findIndex(e => e.id === id);
    if (i < 0) throw bad('That change is no longer in History.');
    for (const e of log.slice(0, i + 1)) {           // newest first
      const keys = snapKeys(e);
      for (let j = 0; j < keys.length; j += 128) {
        for (const s of (await st.get(keys.slice(j, j + 128))).values()) {
          if (s.v === null) await st.delete(s.k); else await st.put(s.k, s.v);
        }
      }
      await delSnaps(st, e);
    }
    await st.put('adm:log', log.slice(i + 1));
    return { undone: i + 1 };
  }
}
