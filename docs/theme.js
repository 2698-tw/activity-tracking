(function () {
  const LIST = [['light', 'Light', '#f4f5f8'], ['dark', 'Dark', '#12141a'], ['banana', 'Banana yellow', '#fff1a8'], ['ash', 'Ash', '#323339'], ['lilac', 'Lilac', '#c9b3ec'], ['seafoam', 'Seafoam green', '#9fe0c6'], ['sunset', 'Sunset', 'linear-gradient(135deg,#440556,#5a3806)']];
  const KEY = 'kartz.theme', root = document.documentElement;
  const valid = t => LIST.some(x => x[0] === t) ? t : 'dark';
  const read = () => { try { return valid(JSON.parse(localStorage.getItem(KEY))); } catch { return 'dark'; } };
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7.2" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.2" r="1.2" fill="currentColor"/></svg>';
  const btns = [];
  let menu = null, owner = null;
  const apply = t => { root.dataset.theme = t; paint(); };
  function paint() {
    const t = LIST.find(x => x[0] === root.dataset.theme) || LIST[1];
    for (const b of btns) {
      if (!b.firstChild) b.innerHTML = ICON;
      b.title = 'Background: ' + t[1];
      b.setAttribute('aria-label', b.title);
    }
    if (menu) menu.querySelectorAll('.thm').forEach(m => m.classList.toggle('on', m.dataset.t === t[0]));
  }
  function close() { if (menu) menu.hidden = true; if (owner) owner.setAttribute('aria-expanded', 'false'); owner = null; }
  function open(b) {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'thmenu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
      menu.innerHTML = LIST.map(([id, name, c]) => `<button type="button" role="menuitemradio" class="thm" data-t="${id}"><i style="background:${c}"></i>${name}</button>`).join('');
      menu.onclick = e => {
        const m = e.target.closest('.thm'); if (!m) return;
        try { localStorage.setItem(KEY, JSON.stringify(m.dataset.t)); } catch {}
        apply(m.dataset.t); close();
      };
      document.body.appendChild(menu);
      addEventListener('mousedown', e => { if (owner && !menu.contains(e.target) && !owner.contains(e.target)) close(); });
      addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
      addEventListener('scroll', close, { passive: true });
      addEventListener('resize', close);
    }
    paint();
    menu.hidden = false; owner = b; b.setAttribute('aria-expanded', 'true');
    const r = b.getBoundingClientRect(), w = menu.offsetWidth;
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  }
  function mount(b) {
    if (!b) return;
    btns.push(b);
    b.classList.add('thpink');
    b.setAttribute('aria-haspopup', 'menu');
    b.onclick = e => { e.stopPropagation(); owner === b ? close() : open(b); };
    paint();
  }
  const css = document.createElement('style');
  css.textContent = 'button.themebtn.thpink{background:linear-gradient(135deg,#c31441,#e0457b);border-color:transparent;color:#fff;box-shadow:0 4px 16px rgba(195,20,65,.35)}'
    + 'button.themebtn.thpink svg{display:block;width:18px;height:18px}'
    + '.thmenu{position:fixed;z-index:1000;background:var(--panel,#fff);color:var(--ink,#15181f);border:1px solid var(--line,#dfe3ea);border-radius:12px;padding:5px;min-width:180px;box-shadow:0 10px 30px rgba(0,0,0,.25)}'
    + '.thmenu[hidden]{display:none}'
    + '.thm{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;background:none;color:inherit;font:inherit;font-size:14px;line-height:1.3;border-radius:8px;cursor:pointer;text-align:left}'
    + '.thm:hover{background:color-mix(in srgb,var(--accent,#3b5bdb) 12%,transparent)}'
    + '.thm i{width:16px;height:16px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 35%,transparent)}'
    + '.thm.on{font-weight:700}.thm.on::after{content:"\\2713";margin-left:auto;color:var(--accent,#3b5bdb)}'
    + ':root{--tbg:rgba(22,22,30,.97);--thead:#20212c;--tcell:#1a1a23;--tink:#f3f3f7;--tstrong:#fff;--tfg:255 255 255;--tdim:235 235 245;--tscheme:dark;'
    + '--tgreen:#7ee2a8;--tblue:#9ec5ff;--tamber:#ffc078;--tpurple:#d8a8ff;--tmag:#e9a8ff;--tce:#ff9f6b;--tred:#ff7a7a;--tpinktext:#f0a3c0;'
    + '--tnB:#22324f;--tsB:#3b2340;--twB:#203d33;--tcB:#45321b;--tagB:#3a3a3a;--tagF:#ddd;--tleft:#8a8f99;--tleftline:#4a4f58;--tchipon:rgba(195,20,65,.35);--tchipink:#f3f3f7}'
    + ':root[data-theme="ash"]{--tbg:#2b2c31;--thead:#36373d;--tcell:#2b2c31;--tink:#f2f3f5;--tdim:235 236 240;'
    + '--tgreen:#84e4ae;--tblue:#a8cbff;--tamber:#ffc685;--tmag:#eab0ff;--tce:#ffa676;'
    + '--tnB:#2a3956;--tsB:#432b48;--twB:#27443a;--tcB:#4b3822;--tagB:#404147;--tleftline:#55565d;--tchipon:rgba(195,20,65,.32);--tchipink:#f2f3f5}'
    + ':root[data-theme="light"]{--tbg:#fff;--thead:#f3f4f8;--tcell:#fff;--tink:#15181f;--tstrong:#15181f;--tfg:20 24 40;--tdim:21 24 31;--tscheme:light;'
    + '--tgreen:#1d7a45;--tblue:#2a62c9;--tamber:#a86200;--tpurple:#7a3fb8;--tmag:#8c2fa3;--tce:#c9531a;--tred:#c0392b;--tpinktext:#b0124a;'
    + '--tnB:#e2ebff;--tsB:#f6e2f9;--twB:#ddf3e7;--tcB:#fbecd6;--tagB:#eceef2;--tagF:#4a4f58;--tleft:#7a808c;--tleftline:#cfd3da;--tchipon:rgba(224,69,123,.12);--tchipink:#a8123c}'
    + ':root[data-theme="banana"]{--tbg:#fffbe3;--thead:#fff3c2;--tcell:#fffbe3;--tink:#2b2510;--tstrong:#2b2510;--tfg:70 55 0;--tdim:43 37 16;--tscheme:light;'
    + '--tgreen:#2b7a36;--tblue:#2a55b0;--tamber:#8f5200;--tpurple:#7a3fb8;--tmag:#8c2fa3;--tce:#bf4d12;--tred:#b8261f;--tpinktext:#a01045;'
    + '--tnB:#e1e8fb;--tsB:#f5e0f2;--twB:#dcefd2;--tcB:#fbe2b8;--tagB:#f6ecc0;--tagF:#5a4f2a;--tleft:#8a7d48;--tleftline:#e0cf85;--tchipon:rgba(208,51,106,.13);--tchipink:#9c1038}'
    + ':root:is([data-theme="light"],[data-theme="banana"],[data-theme="lilac"],[data-theme="seafoam"]) .rapp{box-shadow:0 12px 40px rgba(60,40,0,.1),inset 0 0 0 2px rgba(208,51,106,.45)}'
    + ':root:is([data-theme="light"],[data-theme="banana"],[data-theme="lilac"],[data-theme="seafoam"]) .hlc{color:color-mix(in srgb,var(--hl) 50%,#000)!important}'
    + '.rgo.pink,.rgo.danger{color:#fff}'
    + 'html:root[data-theme="lilac"]{--bg:#ece3f8;--panel:#fbf8fe;--ink:#271c38;--muted:#6c5d85;--line:#ddd0ef;--accent:#7046c2;--ok:#2b8a3e;--warn:#a65c00;--bad:#b8261f;--okbg:#e6f4ea;--warnbg:#fbeedc;--badbg:#fbe3e6;'
    + '--card:#fbf8fe;--dim:#6c5d85;--head:#f3ecfb;--acc:#7046c2;color-scheme:light;'
    + '--tbg:#fbf8fe;--thead:#f1e9fb;--tcell:#fbf8fe;--tink:#271c38;--tstrong:#271c38;--tfg:50 30 80;--tdim:39 28 56;--tscheme:light;'
    + '--tgreen:#1d7a45;--tblue:#2a62c9;--tamber:#a86200;--tpurple:#6a3ab8;--tmag:#8c2fa3;--tce:#c9531a;--tred:#c0392b;--tpinktext:#a8124f;'
    + '--tnB:#e2e6ff;--tsB:#f3e0f7;--twB:#def0e6;--tcB:#f8e8d4;--tagB:#ece4f6;--tagF:#4d4166;--tleft:#7d6f95;--tleftline:#d6c8ea;--tchipon:rgba(112,70,194,.13);--tchipink:#5a2fa8}'
    + 'html:root[data-theme="lilac"]:not([data-framed]) body{background:linear-gradient(160deg,#f1e9fc 0%,#e6d9f7 55%,#dccbf3 100%) fixed;min-height:100vh}'
    + 'html:root[data-theme="seafoam"]{--bg:#dcf2ea;--panel:#f6fcf9;--ink:#13302a;--muted:#557a6f;--line:#c4e4d8;--accent:#13866b;--ok:#2b8a3e;--warn:#a65c00;--bad:#b8261f;--okbg:#e2f4e6;--warnbg:#fbeedc;--badbg:#fbe3e6;'
    + '--card:#f6fcf9;--dim:#557a6f;--head:#eaf7f2;--acc:#13866b;color-scheme:light;'
    + '--tbg:#f6fcf9;--thead:#e6f5ef;--tcell:#f6fcf9;--tink:#13302a;--tstrong:#13302a;--tfg:15 60 50;--tdim:19 48 42;--tscheme:light;'
    + '--tgreen:#1d7a45;--tblue:#2a62c9;--tamber:#a86200;--tpurple:#7a3fb8;--tmag:#8c2fa3;--tce:#c9531a;--tred:#c0392b;--tpinktext:#a8124f;'
    + '--tnB:#e0e8ff;--tsB:#f3e2f6;--twB:#d6f0e2;--tcB:#f8e8d4;--tagB:#e3f1ec;--tagF:#3f5a52;--tleft:#6d8a81;--tleftline:#c4e0d6;--tchipon:rgba(19,134,107,.13);--tchipink:#0e6b55}'
    + 'html:root[data-theme="seafoam"]:not([data-framed]) body{background:linear-gradient(160deg,#e6f7f1 0%,#d5efe5 55%,#c6e9dc 100%) fixed;min-height:100vh}'
    + 'html:root[data-theme="sunset"]{--bg:#3a0a52;--panel:rgba(22,6,34,.62);--ink:#f4ecf8;--muted:#cdb6d6;--line:rgba(255,255,255,.13);--accent:#d9a3ff;--ok:#7ee2a8;--warn:#ffc078;--bad:#ff8a8a;--okbg:rgba(60,140,90,.25);--warnbg:rgba(160,100,20,.25);--badbg:rgba(160,40,60,.25);'
    + '--card:rgba(22,6,34,.62);--dim:#cdb6d6;--head:rgba(30,8,44,.7);--acc:#d9a3ff;color-scheme:dark;'
    + '--tbg:rgba(22,6,34,.6);--thead:#2a0c3a;--tcell:#1e0a2b;--tink:#f4ecf8;--tdim:240 228 248;--tchipon:rgba(217,163,255,.22);--tchipink:#f4ecf8}'
    + 'html:root[data-theme="sunset"]:not([data-framed]) body{background:url(art/palms-right.png) right bottom/auto 70vh no-repeat fixed,url(art/palms-left.png) left bottom/auto 70vh no-repeat fixed,linear-gradient(to bottom right,#2b0a55 0%,#440556 30%,#531a42 55%,#5b2a26 78%,#5a3806 100%) fixed;min-height:100vh}'
    + 'html:root[data-theme="sunset"][data-framed] body{background:transparent}'
    + 'html:root[data-theme="sunset"] :is(.rapp,.events,.card,.hcard,.frostframe){backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}'
    + 'html:root[data-theme="sunset"] .thmenu{background:#2a0c3c}';
  document.head.appendChild(css);
  root.dataset.theme = read();
  try { if (window.top !== window) root.dataset.framed = ''; } catch { root.dataset.framed = ''; }
  addEventListener('storage', e => { if (e.key === KEY) apply(read()); });
  window.Theme = { mount };
})();
