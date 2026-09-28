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
 */

// Extra origins allowed to call this when the page is hosted somewhere else.
const ALLOWED_ORIGINS = [
  'http://localhost:8731',
  'https://kartz-tracking.github.io',
  'https://data-extractor.jk06nm04.workers.dev',
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
// Rows go to Input-RawData, columns B to J, of the tracking sheet. The Worker signs in as a
// service account, so the sheet must be shared with that account's email as an Editor.
//
// Required Cloudflare secret — the service account's JSON key, pasted whole:
//   wrangler secret put GOOGLE_SA_KEY
const SHEET_ID = '13NeOXdGbsb7znqYOqQa_MntCZSlNzwv-8XOvtG6JiIM';
const SHEET_RANGE = "'Input-RawData'!B:J";
const SHEET_COLS = 9;
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

async function appendRows(env, values) {
  if (!Array.isArray(values) || !values.length)
    throw Object.assign(new Error('No rows to append.'), { status: 400 });
  if (values.length > MAX_ROWS)
    throw Object.assign(new Error(`At most ${MAX_ROWS} rows at a time.`), { status: 400 });
  if (!values.every(r => Array.isArray(r) && r.length === SHEET_COLS
                         && r.every(v => typeof v === 'string' || typeof v === 'number')))
    throw Object.assign(new Error(`Every row must be ${SHEET_COLS} text or number cells.`),
                        { status: 400 });

  const token = await googleToken(env);
  // OVERWRITE, not INSERT_ROWS: the tab has formulas filled down in A and Q:T, and inserting
  // rows would open gaps in them. Overwriting fills the empty B:J cells below the last entry.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/`
    + `${encodeURIComponent(SHEET_RANGE)}:append`
    + '?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
    body: JSON.stringify({ majorDimension: 'ROWS', values: values.map(row => row.map(asCell)) }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = out?.error?.message || String(r.status);
    throw new Error(r.status === 403
      ? `The sheet refused the service account — share it with the account's email as Editor. (${msg})`
      : `Sheets API: ${msg}`);
  }
  return { range: out?.updates?.updatedRange || '', rows: out?.updates?.updatedRows || 0 };
}

export default {
  async fetch(request, env) {
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
        const { values } = JSON.parse(body);
        return reply(await appendRows(env, values), 200);
      } catch (e) {
        const status = e.status || (e instanceof SyntaxError ? 400 : 502);
        return reply({ error: { code: status, message: String(e && e.message || e) } }, status);
      }
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
