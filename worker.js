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
