const ALLOWED_ORIGINS = [
  'http://localhost:8731',
  'https://2698-tw.github.io',
  'https://data-collection.jk06nm04.workers.dev/',
];

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
  const target = TARGETS[name];
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

const cachedTabs = new Map();
async function tabTitle(token, target) {
  if (cachedTabs.has(target)) return cachedTabs.get(target);
  const out = await sheetsCall(token, 'GET', '?fields=sheets.properties(sheetId,title)', null, target);
  const hit = (out.sheets || []).find(t => t.properties?.sheetId === target.gid);
  if (!hit) throw new Error(`No tab with gid ${target.gid} in ${target.book}.`);
  cachedTabs.set(target, hit.properties.title);
  return hit.properties.title;
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
    const allowed = knownOrigin || hasPass;

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
