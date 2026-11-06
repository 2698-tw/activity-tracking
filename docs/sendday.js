/* ---------------- Admin: a date's reads sent to the sheets (the Frost Crystal and Neutral City pages) ---------------- */
// The bookmark sends a contest's or a battle's reads to the sheets at the time; this sends a date again, or for the first
// time, from the site. Shown only in admin mode (the site's admin pill, kept in this browser), on a date's tab. The
// Worker writes what the site has for that date: the Neutral City's original sheet (rows added below the ones there)
// and the Practice Round sheet the date goes to (Admin → Sheets & backup; that date's rows replaced there, its Summary
// sorted). SendDay({api, path, what, original, label, after}) → {show(day)}: a day to offer, or null for none.
window.SendDay = function ({ api, path, what, original, label, after }) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const admin = () => { try { return !!localStorage.getItem('adminPass'); } catch { return false; } };
  const settings = () => { try { return JSON.parse(localStorage.getItem('site.settings')) || {}; } catch { return {}; } };
  // admin only: the password the Worker needs for a send
  const post = (p, body) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(() => { try { const p = localStorage.getItem('adminPass'); return p ? { 'x-kartz-pass': p } : {}; } catch { return {}; } })() }, body: JSON.stringify(body) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || j.error || 'The Worker answered ' + r.status); return j; });
  const bar = document.createElement('div');
  bar.className = 'sendday'; bar.hidden = true;
  after.after(bar);
  const style = document.createElement('style');
  style.textContent = '.sendday{margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:13.5px}'
    + '.sendday ul{margin:6px 0 8px;padding-left:18px}.sendday li{margin:2px 0}.sendday .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}'
    + '.sendday small{color:var(--dim)}.sendday .bad{color:var(--bad)}'
    + '.sendday button{font:inherit;font-weight:600;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 12px;cursor:pointer}'
    + '.sendday button.pri{background:var(--acc);border-color:var(--acc);color:#fff}.sendday button:disabled{opacity:.6;cursor:default}';
  document.head.appendChild(style);
  let day = null;
  function idle() {
    bar.innerHTML = `<div class="row"><button type="button" data-ask>📤 Send ${esc(label(day))} to the sheets…</button><small>admin</small></div>`;
  }
  function show(d) {
    day = d;
    bar.hidden = !(admin() && d);
    if (!bar.hidden) idle();
  }
  bar.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return idle();
    if (e.target.closest('[data-ask]')) {
      bar.innerHTML = '<small>Checking where it goes…</small>';
      const s = settings(), orig = original && s.sheets && s.sheets[original] && s.sheets[original].id;
      let r = null;
      try { r = await post('/round-of', { day }); if (!r || typeof r.round !== 'number') r = null; } catch {}
      const items = [];
      if (original) items.push(orig ? `<li>The ${esc(what)} sheet <small>adds the rows below the ones there: check the date isn't there already</small></li>` : `<li class="bad">The ${esc(what)} sheet: none set (Admin → Sheets &amp; backup)</li>`);
      items.push(!r ? '<li class="bad">The Practice Round sheet could not be checked</li>'
        : !r.round ? '<li class="bad">No Practice Round sheet: this date goes to none (Admin → Sheets &amp; backup)</li>'
        : !r.sheet ? `<li class="bad">Practice Round ${r.round}: no sheet set for it (Admin → Sheets &amp; backup)</li>`
        : `<li>Practice Round ${r.round} <small>${r.set ? 'as set for this date' : 'from the schedule'}; replaces any rows sent before for ${esc(day)}, then sorts its Summary</small></li>`);
      bar.innerHTML = `<b>Send ${esc(label(day))} (${esc(day)}) to:</b><ul>${items.join('')}</ul>
        <div class="row"><button type="button" data-x>Cancel</button><button type="button" class="pri" data-go>Send</button></div>`;
      return;
    }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    go.disabled = true; go.textContent = 'Sending…';
    try {
      const j = await post(path, { day });
      const each = (j.sent || []).map(x => `<li>${esc(x.to)}: ${Number(x.rows).toLocaleString()} rows${x.replaced ? ` (in place of ${Number(x.replaced).toLocaleString()} sent before)` : ''} · <a href="${esc(x.link)}" target="_blank" rel="noopener">Open ↗</a>${x.summaryError ? ` · <span class="bad">Summary not sorted: ${esc(x.summaryError)}</span>` : ''}</li>`).join('');
      const not = [...(j.skipped || []), ...(j.errors || [])].map(x => `<li class="bad">Not sent: ${esc(x)}</li>`).join('');
      bar.innerHTML = `<b>Sent ${esc(label(day))}</b><ul>${each}${not}</ul><div class="row"><button type="button" data-x>Done</button></div>`;
    } catch (x) {
      bar.innerHTML = `<b class="bad">✗ Couldn't send: ${esc(x.message || x)}</b><div class="row"><button type="button" data-x>Back</button></div>`;
    }
  });
  return { show };
};
