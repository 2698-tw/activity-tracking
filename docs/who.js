/* ---------------- Who a read row is: one player through their name changes ---------------- */
// The Player Summary (player.html) and the All tabs of the Frost Crystal Contest (frost.html) and Neutral City
// (nc.html) put a player's reads together under one name. Each row the Worker sends carries its id for the player
// (pid: the same in every event, made from the UID, never the UID). A row read before there were ids is matched
// by name to the roster (api/roster), its past names included (every card's reads note a new name). A name two
// roster players share, and a player the roster has never seen, stay as the name they were read under.
// Who(roster) → { key(name, pid), row(key) }: a key for the player, and their roster row (name now, alliance) if any.
window.Who = function (ro) {
  const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/о/g, 'o').replace(/[^\p{L}\p{N}]/gu, '');
  const keyOf = x => x.pid ? 'p:' + x.pid : 'r:' + x.name;
  const byName = new Map(), two = new Set(), byKey = new Map();
  const add = (n, k) => { if (byName.has(n) && byName.get(n) !== k) two.add(n); else byName.set(n, k); };
  for (const x of (ro && ro.rows) || []) {
    byKey.set(keyOf(x), x);
    for (const n of [x.name, ...(x.names || [])]) if (n) { add(n, keyOf(x)); if (fold(n)) add('~' + fold(n), keyOf(x)); }
  }
  for (const n of two) byName.delete(n);
  return {
    key: (name, pid) => pid ? 'p:' + pid : byName.get(name) || (fold(name) !== '' && byName.get('~' + fold(name))) || 'n:' + name,
    row: k => byKey.get(k) || null,
  };
};
