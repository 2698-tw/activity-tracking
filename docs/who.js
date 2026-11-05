/* ---------------- Who a read row is: one player through their name changes ---------------- */
// The Player Summary (player.html) and the All tabs of the Frost Crystal Contest (frost.html) and Neutral City
// (nc.html) put a player's reads together under one name. Each row the Worker sends carries its id for the player
// (pid: the same in every event, made from the UID, never the UID). A row read before there were ids is matched
// by name to the roster (api/roster), its past names included (every card's reads note a new name). A name two
// roster players share, and a player the roster has never seen, stay as the name they were read under.
// Who(roster, sheet) → { key(name, pid, ally), row(key), search(key) }: a key for the player, their roster row (name now,
// alliance) if any, and their search name where a look-up by in-game name could pick the wrong one. sheet: the roster
// sheet's search names (api/search-names .roster, [in-game name, alliance, search name]). search(key) is
//  - the sheet's, when one row of the player's alliance has their in-game name (Killua: 698W's and 698C's);
//  - the roster's own, when two rows do (Gikey and Gikey Alt, both 698S): the bookmark told them apart by Base CP;
//  - '' (none) for an old read, from before the reads had ids, of a name two roster players share: whose it was is
//    not known;
//  - undefined otherwise: the page looks it up by name, as before.
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
  // a name two roster players share, read before the reads had ids: the read's alliance tells them apart when only one
  // of them is in it (NC's reads carry the alliance; Skadi 698N and Skadi 698C)
  const byAlly = new Map(), twoA = new Set();
  for (const x of (ro && ro.rows) || []) for (const n of [x.name, ...(x.names || [])]) if (n && x.alliance) {
    const k = n + '|' + x.alliance; if (byAlly.has(k) && byAlly.get(k) !== keyOf(x)) twoA.add(k); else byAlly.set(k, keyOf(x));
  }
  for (const k of twoA) byAlly.delete(k);
  const bySheet = new Map();                       // in-game name|alliance → the sheet's search names for it
  for (const [n, a, s] of sheet || []) if (n && s) { const k = n + '|' + a; if (!bySheet.has(k)) bySheet.set(k, new Set()); bySheet.get(k).add(s); }
  return {
    key: (name, pid, ally) => pid ? 'p:' + pid : byName.get(name) || (fold(name) !== '' && byName.get('~' + fold(name)))
      || (ally && byAlly.get(name + '|' + ally)) || 'n:' + name,
    row: k => byKey.get(k) || null,
    search: k => {
      const x = byKey.get(k);
      if (!x) return k.startsWith('n:') && nameN.get(k.slice(2)) > 1 ? '' : undefined;
      const s = bySheet.get(x.name + '|' + (x.alliance || ''));
      if (s && s.size === 1) return [...s][0];
      if (x.search && ((s && s.size > 1) || nameN.get(x.name) > 1)) return x.search;
      return undefined;
    },
  };
};
