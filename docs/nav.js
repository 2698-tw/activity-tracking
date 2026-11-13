let shownView = '';
function showTab(name) {
  $('home').classList.toggle('hide', name !== 'home');
  $('app').classList.toggle('hide', name === 'home');
  $('tab-roster').classList.toggle('hide', name !== 'roster');
  $('tab-wb').classList.toggle('hide', name !== 'whitebeard');
  $('tab-st').classList.toggle('hide', name !== 'snowtrain');
  $('tab-et').classList.toggle('hide', name !== 'energytower');
  $('tab-ma').classList.toggle('hide', name !== 'mammoth');
  $('tab-frost').classList.toggle('hide', name !== 'frost');
  if (name === 'frost') frostFrame();
  $('tab-nc').classList.toggle('hide', name !== 'nc');
  if (name === 'nc') frostFrame('ncFrame', 'nc.html');
  $('tab-player').classList.toggle('hide', name !== 'player');
  if (name === 'player') frostFrame('playerFrame', 'player.html');
  $('tab-sd').classList.toggle('hide', name !== 'stormduel');
  if (name === 'stormduel') frostFrame('sdFrame', 'sd.html');
  $('tab-practice').classList.toggle('hide', name !== 'practice');
  if (name === 'practice') {
    warmPractice();
    const t = $('tab-practice'); t.classList.remove('cardsin'); void t.offsetWidth; t.classList.add('cardsin');
  }
  $('tab-admin').classList.toggle('hide', name !== 'admin');
  const shown = { home: 'home', roster: 'tab-roster', whitebeard: 'tab-wb', snowtrain: 'tab-st', energytower: 'tab-et', mammoth: 'tab-ma', frost: 'tab-frost', nc: 'tab-nc', player: 'tab-player', stormduel: 'tab-sd', practice: 'tab-practice', admin: 'tab-admin' }[name];
  if (shownView && shownView !== name && $(shown)) { const v = $(shown); v.classList.remove('viewin'); void v.offsetWidth; v.classList.add('viewin'); }
  shownView = name;
  document.documentElement.classList.remove('athome');
  delete document.documentElement.dataset.view;
  const inPractice = PRACTICE_VIEWS.includes(name), hl = $('homeLink');
  hl.lastChild.textContent = inPractice ? 'Back' : 'Home';
  hl.setAttribute('href', inPractice ? '#practice' : './');
  dispatchEvent(new CustomEvent('viewchange', { detail: name }));
}
const viewFromAddress = () => ({ '#roster': 'roster', '#whitebeard': 'whitebeard', '#snowtrain': 'snowtrain', '#energytower': 'energytower', '#mammoth': 'mammoth', '#frost': 'frost', '#nc': 'nc', '#player': 'player', '#stormduel': 'stormduel', '#practice': 'practice', '#admin': 'admin' })[location.hash] || 'home';
function frostFrame(id = 'frostFrame', page = 'frost.html') {
  const f = $(id);
  if (f.src) return;
  const h = Last.num.get('h:' + id);
  if (h) f.style.height = h + 'px';
  f.onload = () => {
    if (!f.contentDocument || !f.contentDocument.body) return;
    const body = f.contentDocument.body, cs = getComputedStyle(body);
    let keep = 0;
    const fit = () => {
      const px = Math.ceil(body.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
      f.style.height = px + 'px';
      clearTimeout(keep); keep = setTimeout(() => Last.num.set('h:' + id, px), 1500);
    };
    new f.contentWindow.ResizeObserver(fit).observe(body); fit();
    f.classList.add('in');
  };
  f.src = page;
}
function goTo(name) {
  if (name === viewFromAddress()) return;
  if (name === 'home') history.pushState(null, '', location.pathname + location.search);
  else history.pushState(null, '', '#' + name);
  showTab(name);
  scrollTo(0, 0);
}
const PRACTICE_VIEWS = ['whitebeard', 'snowtrain', 'energytower', 'mammoth', 'frost', 'nc', 'stormduel'];
$('homeLink').onclick = e => { e.preventDefault(); goTo(PRACTICE_VIEWS.includes(shownView) ? 'practice' : 'home'); };
addEventListener('popstate', () => showTab(viewFromAddress()));
addEventListener('hashchange', () => { showTab(viewFromAddress()); scrollTo(0, 0); });
const prefetch = pages => { for (const page of pages) { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = page; document.head.appendChild(l); } };
let practiceWarm = false;
function warmPractice() {
  if (practiceWarm) return; practiceWarm = true;
  try { Last.warm(['/wb', '/st', '/et', '/ma', '/frost-read', '/frost-battle', '/nc-read', '/sd-read', '/search-names', '/roster'].map(p => API_BASE + p), 10 * 60 * 1000); } catch {}
  prefetch(['frost.html', 'nc.html', 'sd.html', 'who.js?v=7', 'sendday.js?v=3']);
}
showTab(viewFromAddress());
(function () {
  const c = navigator.connection;
  if (c && c.saveData) return;
  const go = () => {
    try { Last.warm(['/roster', '/search-names', '/schedule'].map(p => API_BASE + p), 10 * 60 * 1000); } catch {}
    prefetch(['player.html', 'who.js?v=7']);
  };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 1500));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle);
})();
