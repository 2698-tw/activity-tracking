const READ_ALLY = {
  '2026-11-01|Killua': '698C',
};
const untag = n => { const m = /^(.*\D)\s?[2-9]$/.exec(n || '') || /^(.+)\.[A-Za-z]$/.exec(n || ''); return m ? m[1].trim() : ''; };
window.Who = function (ro, sheet) {
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const keyOf = x => x.pid ? 'p:' + x.pid : 'r:' + x.name;
  const byName = new Map(), two = new Set(), byKey = new Map(), nameN = new Map();
  const add = (n, k) => { if (byName.has(n) && byName.get(n) !== k) two.add(n); else byName.set(n, k); };
  for (const x of (ro && ro.rows) || []) {
    byKey.set(keyOf(x), x); nameN.set(x.name, (nameN.get(x.name) || 0) + 1);
    for (const n of [x.name, ...(x.names || [])]) if (n) { add(n, keyOf(x)); if (fold(n)) add('~' + fold(n), keyOf(x)); }
  }
  for (const n of two) byName.delete(n);
  const byAlly = new Map(), twoA = new Set();
  for (const x of (ro && ro.rows) || []) for (const n of [x.name, ...(x.names || [])]) if (n && x.alliance) {
    const k = n + '|' + x.alliance; if (byAlly.has(k) && byAlly.get(k) !== keyOf(x)) twoA.add(k); else byAlly.set(k, keyOf(x));
  }
  for (const k of twoA) byAlly.delete(k);
  const bySheet = new Map();
  const bySheetBare = new Map();
  const put = (m, k, s) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(s); };
  for (const [n, a, s] of sheet || []) if (n && s) { put(bySheet, n + '|' + a, s); const b = untag(n); if (b) put(bySheetBare, b + '|' + a, s); }
  return {
    key: (name, pid, ally, day) => {
      if (pid) return 'p:' + pid;
      const a = ally || (day && READ_ALLY[day + '|' + name]);
      return byName.get(name) || (fold(name) !== '' && byName.get('~' + fold(name))) || (a && byAlly.get(name + '|' + a)) || 'n:' + name;
    },
    row: k => byKey.get(k) || null,
    untag,
    search: k => {
      const x = byKey.get(k);
      if (!x) return k.startsWith('n:') && nameN.get(k.slice(2)) > 1 ? '' : undefined;
      const ka = x.name + '|' + (x.alliance || '');
      const s = nameN.get(x.name) > 1 && bySheetBare.has(ka) ? new Set([...(bySheet.get(ka) || []), ...bySheetBare.get(ka)]) : bySheet.get(ka);
      if (s && s.size === 1) return [...s][0];
      if (x.search && ((s && s.size > 1) || nameN.get(x.name) > 1)) return x.search;
      if (!s && x.search && x.search !== x.name) return x.search;
      return undefined;
    },
  };
};
window.Who.untag = untag;
