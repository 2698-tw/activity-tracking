(function () {
  'use strict';
  if (!/(^|\.)topwargame\.com$/.test(location.hostname)) {
    var site = 'https://2698-tw.github.io/activity-tracking/';
    if (!window.open(site, '_blank')) location.href = site;
    return;
  }
  var host = document.getElementById('x2698');
  if (host && window.__x2698 && window.__x2698.toggle) {
    if (host.style.display !== 'none' || (window.__x2698.busy && window.__x2698.busy())) { host.style.display = ''; return; }
    host.remove();
  }
  if (!document.getElementById('x2698')) window.__x2698 = undefined;
  var old = document.getElementById('x2698pw');
  if (old) { old.style.display = ''; return; }
  if (window.__x2698 || window.__x2698loading) return;
  window.__x2698loading = 1;

  var API = 'https://data-collection.jk06nm04.workers.dev/api/extractor-code';
  var PASS = 'x2698.pass';
  var getPass = function () { try { return localStorage.getItem(PASS) || sessionStorage.getItem(PASS) || ''; } catch (e) { return ''; } };
  var keepPass = function (p, keep) {
    try { if (keep) { localStorage.setItem(PASS, p); sessionStorage.removeItem(PASS); } else { sessionStorage.setItem(PASS, p); localStorage.removeItem(PASS); } } catch (e) {}
  };
  var dropPass = function () { try { localStorage.removeItem(PASS); sessionStorage.removeItem(PASS); } catch (e) {} };

  var load = async function (p) {
    var r;
    try { r = await fetch(API, { method: 'POST', headers: { 'x-kartz-pass': p } }); }
    catch (e) { return { err: "Couldn't reach the site. Check your connection and try again." }; }
    if (r.status === 401) return { bad: true };
    if (!r.ok) return { err: "The site couldn't send the extractor (error " + r.status + '). Try again.' };
    return { code: await r.text(), token: r.headers.get('x-kartz-token') || '' };
  };
  var start = function (code) {
    try { (0, eval)(code); }
    catch (e) { alert('2698 Data Extractor loaded but could not start (' + (e && e.message || e) + ').'); }
  };

  var card = function (refused) {
    var box = document.createElement('div');
    box.id = 'x2698pw';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    if (!document.getElementById('x2698font')) { var fs = document.createElement('style'); fs.id = 'x2698font'; fs.textContent = "@font-face{font-family:x2698selawik;font-weight:400;font-display:swap;src:url(https://2698-tw.github.io/activity-tracking/fonts/selawik-400.woff2) format('woff2')}" + "@font-face{font-family:x2698selawik;font-weight:600;font-display:swap;src:url(https://2698-tw.github.io/activity-tracking/fonts/selawik-600.woff2) format('woff2')}" + "@font-face{font-family:x2698selawik;font-weight:700 900;font-display:swap;src:url(https://2698-tw.github.io/activity-tracking/fonts/selawik-700.woff2) format('woff2')}"; (document.head || document.documentElement).appendChild(fs); }
    var root = box.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      '*{box-sizing:border-box}' +
      '.app{all:initial;display:block;box-sizing:border-box;position:absolute;top:12px;left:50%;transform:translateX(-50%);width:min(440px,calc(100% - 24px));pointer-events:auto;' +
        'font:14px/1.45 x2698selawik,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f3f3f7;background:rgba(22,22,30,.97);border-radius:19px;padding:12px 14px 14px;' +
        'box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1);-webkit-font-smoothing:antialiased;animation:in .22s ease-out}' +
      '@keyframes in{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '.top{display:flex;align-items:center;gap:10px;margin:-12px -14px 4px;padding:12px 14px 4px}' +
      '.logo{width:28px;height:28px;border-radius:8px;flex:none;object-fit:cover;background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b)}' +
      '.top b{font-size:15.5px;flex:1}' +
      '.x{border:0;background:rgba(255,255,255,.1);color:#bbb;width:28px;height:28px;border-radius:50%;font-size:16px;cursor:pointer;flex:none}' +
      '[hidden]{display:none!important}' +
      '.pw{padding:14px 4px 6px;text-align:center}' +
      '.pwic{width:46px;height:46px;margin:4px auto 10px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b);box-shadow:0 8px 24px rgba(195,20,65,.35)}' +
      '.pwic svg{width:22px;height:22px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
      '.pw h2{margin:0 0 12px;font-size:17px}.pwp{margin:-6px auto 12px;max-width:300px;color:rgba(235,235,245,.6);font-size:13px}' +
      '.pwf{position:relative;text-align:left}' +
      '.pwf input{width:100%;border:0;border-radius:12px;padding:12px 44px 12px 14px;background:rgba(255,255,255,.08);color:inherit;font:inherit;font-size:15px;outline:none;box-shadow:inset 0 0 0 1.5px transparent;transition:box-shadow .15s}' +
      '.pwf input:focus{box-shadow:inset 0 0 0 1.5px #e0457b}.pwf.bad input{box-shadow:inset 0 0 0 1.5px #ff7a7a}' +
      '.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:rgba(235,235,245,.6);width:34px;height:34px;border-radius:9px;cursor:pointer;display:grid;place-items:center}' +
      '.eye:hover{background:rgba(255,255,255,.07)}.eye svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.pwe{min-height:18px;margin:7px 2px 0;color:#ff7a7a;font-size:12.5px;text-align:left}' +
      '.shake{animation:shake .35s}@keyframes shake{20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}' +
      '.pwgo{width:100%;margin-top:6px;border:0;border-radius:14px;padding:12px;color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer;background:linear-gradient(135deg,#7b1a31,#c31441 60%,#e0457b);transition:transform .15s,opacity .2s}' +
      '.pwgo:active{transform:scale(.98)}.pwgo[disabled]{opacity:.6;cursor:default}' +
      '.pwrem{display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 0 2px;color:rgba(235,235,245,.6);font-size:12.5px;cursor:pointer;user-select:none}.pwrem input{accent-color:#e0457b}' +
      '</style>' +
      '<div class="app"><div class="top"><img class="logo" alt="" src="https://2698-tw.github.io/activity-tracking/icon.png"><b>2698 Data Extractor</b>' +
        '<button class="x" id="close" title="Close">×</button></div>' +
      '<div class="pw"><div class="pwic"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>' +
        '<h2 id="pwT"></h2><p class="pwp" id="pwP" hidden></p>' +
        '<form id="pwF" autocomplete="off"><div class="pwf" id="pwFld"><input id="pwIn" type="password" placeholder="Password" autocomplete="current-password" spellcheck="false">' +
          '<button type="button" class="eye" id="pwEye" title="Show"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>' +
          '<div class="pwe" id="pwE"></div><button class="pwgo" id="pwGo" type="submit">Unlock</button>' +
          '<label class="pwrem"><input type="checkbox" id="pwRem" checked> Keep me signed in on this browser</label></form></div></div>';
    var $ = function (s) { return root.querySelector(s); };
    $('#pwT').textContent = refused ? 'Password not accepted' : 'Bookmark password';
    if (refused) { $('#pwP').hidden = false; $('#pwP').textContent = "The saved password wasn't accepted. Enter it again."; }
    var close = function () { box.remove(); window.__x2698loading = 0; };
    var bad = function (msg) {
      var f = $('#pwFld'); f.classList.add('bad'); $('#pwE').textContent = msg;
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); $('#pwIn').select();
    };
    $('#close').onclick = close;
    $('#pwEye').onclick = function () { var i = $('#pwIn'); i.type = i.type === 'password' ? 'text' : 'password'; i.focus(); };
    $('#pwIn').oninput = function () { $('#pwFld').classList.remove('bad'); $('#pwE').textContent = ''; };
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { $('#pwIn').addEventListener(t, function (e) { e.stopPropagation(); }); });
    $('#pwF').onsubmit = async function (e) {
      e.preventDefault();
      var p = $('#pwIn').value.trim(), go = $('#pwGo');
      if (!p) return $('#pwIn').focus();
      go.disabled = true; go.textContent = 'Checking…'; $('#pwE').textContent = '';
      var got = await load(p);
      go.disabled = false; go.textContent = 'Unlock';
      if (got.bad) return bad("That password wasn't accepted.");
      if (got.err) return bad(got.err);
      keepPass(got.token || p, $('#pwRem').checked);
      box.remove();
      window.__x2698loading = 0;
      start(got.code);
    };
    document.body.appendChild(box);
    setTimeout(function () { $('#pwIn').focus(); }, 50);
  };

  (async function () {
    var p = getPass();
    if (!p) { card(false); return; }
    var got = await load(p);
    if (got.code) {
      var kept = false; try { kept = !!localStorage.getItem(PASS); } catch (e) {}
      if (got.token) keepPass(got.token, kept);
      window.__x2698loading = 0; start(got.code); return;
    }
    if (got.bad) { dropPass(); card(true); return; }
    window.__x2698loading = 0;
    alert('2698 Data Extractor: ' + got.err);
  })();
})();
