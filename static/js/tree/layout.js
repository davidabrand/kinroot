// Where everyone sits on the tree. Pure maths, no 3D code, so it's easy to test.
//
// The oldest generation sits just above the trunk (the roots of the family)
// and each younger generation grows upward. Partners sit side by side,
// siblings stay together, and rows bend back gently so the crown looks round.

export const TRUNK_HEIGHT = 3.2;
export const FIRST_LIFT = 2.2;
export const GEN_HEIGHT = 3.4;
const COUPLE_GAP = 3.3;
const SIBLING_GAP = 3.9;
const FAMILY_GAP = 4.8;
const CURVE = 0.014;

export function indexFamily(people, rels) {
  const ids = new Set(people.map((p) => p.id));
  const parents = new Map(), children = new Map(), spouses = new Map();
  for (const id of ids) { parents.set(id, []); children.set(id, []); spouses.set(id, []); }
  for (const r of rels) {
    if (!ids.has(r.person_a) || !ids.has(r.person_b)) continue;
    if (r.kind === "parent") {
      parents.get(r.person_b).push(r.person_a);
      children.get(r.person_a).push(r.person_b);
    } else {
      spouses.get(r.person_a).push(r.person_b);
      spouses.get(r.person_b).push(r.person_a);
    }
  }
  return { parents, children, spouses };
}

export function generations(people, rels) {
  const gen = new Map(people.map((p) => [p.id, 0]));
  for (let pass = 0; pass < people.length + 2; pass++) {
    let changed = false;
    for (const r of rels) {
      if (!gen.has(r.person_a) || !gen.has(r.person_b)) continue;
      const a = gen.get(r.person_a), b = gen.get(r.person_b);
      if (r.kind === "parent" && b < a + 1) { gen.set(r.person_b, a + 1); changed = true; }
      if (r.kind === "spouse" && a !== b) { const top = Math.max(a, b); gen.set(r.person_a, top); gen.set(r.person_b, top); changed = true; }
    }
    if (!changed) break;
  }
  return gen;
}

export function computeLayout(people, rels) {
  const fam = indexFamily(people, rels);
  const gen = generations(people, rels);
  const maxGen = people.length ? Math.max(...gen.values()) : 0;
  const rows = [];
  for (let g = 0; g <= maxGen; g++) rows.push(people.filter((p) => gen.get(p.id) === g).map((p) => p.id));

  const x = new Map();
  rows.forEach((row) => row.forEach((id, i) => x.set(id, i * SIBLING_GAP)));
  const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const shareParent = (a, b) => fam.parents.get(a).some((p) => fam.parents.get(b).includes(p));

  const placeRow = (row, keyOf) => {
    const keys = new Map(row.map((id) => [id, keyOf(id)]));
    const sorted = [...row].sort((a, b) => keys.get(a) - keys.get(b) || a - b);
    const ordered = [], placed = new Set();
    for (const id of sorted) {
      if (placed.has(id)) continue;
      // A person's partners sit right beside them; partners with their own
      // parents on the tree go on the side closer to those parents.
      const partners = fam.spouses.get(id).filter((s) => row.includes(s) && !placed.has(s));
      const before = partners.filter((s) => keys.get(s) < keys.get(id));
      const after = partners.filter((s) => keys.get(s) >= keys.get(id));
      for (const s of before) { ordered.push(s); placed.add(s); }
      ordered.push(id); placed.add(id);
      for (const s of after) { ordered.push(s); placed.add(s); }
    }
    let cursor = 0;
    ordered.forEach((id, i) => {
      if (i > 0) {
        const prev = ordered[i - 1];
        cursor += fam.spouses.get(prev).includes(id) ? COUPLE_GAP : shareParent(prev, id) ? SIBLING_GAP : FAMILY_GAP;
      }
      x.set(id, cursor);
    });
    // Keep the row centred over where its keys want it to be.
    const want = avg(ordered.map((id) => keys.get(id)));
    const have = avg(ordered.map((id) => x.get(id)));
    ordered.forEach((id) => x.set(id, x.get(id) + (want - have)));
  };

  for (let pass = 0; pass < 6; pass++) {
    for (let g = 1; g <= maxGen; g++) {
      if (!rows[g].length) continue;
      placeRow(rows[g], (id) => {
        const ps = fam.parents.get(id).filter((p) => x.has(p));
        if (ps.length) return avg(ps.map((p) => x.get(p)));
        const sp = fam.spouses.get(id).filter((s) => fam.parents.get(s).length);
        return sp.length ? avg(sp.map((s) => x.get(s))) + 0.01 : x.get(id);
      });
    }
    for (let g = maxGen - 1; g >= 0; g--) {
      if (!rows[g].length) continue;
      placeRow(rows[g], (id) => {
        const cs = fam.children.get(id).filter((c) => x.has(c));
        return cs.length ? avg(cs.map((c) => x.get(c))) : x.get(id);
      });
    }
  }

  // Centre the whole tree over the trunk.
  const all = [...x.values()];
  const mid = all.length ? (Math.min(...all) + Math.max(...all)) / 2 : 0;
  const pos = new Map();
  for (const p of people) {
    const px = x.get(p.id) - mid;
    const g = gen.get(p.id);
    pos.set(p.id, { x: px, y: TRUNK_HEIGHT + FIRST_LIFT + g * GEN_HEIGHT, z: -CURVE * px * px + Math.sin(g * 1.3) * 0.5 });
  }
  return { pos, gen, maxGen, fam };
}

// Estimated birth and death years for the time-lapse. Missing births are
// guessed from relatives (a parent is usually ~27 years older than a child).
export function estimateYears(people, fam, thisYear = new Date().getFullYear()) {
  const born = new Map(), died = new Map(), estimated = new Set();
  for (const p of people) if (p.birth_year) born.set(p.id, p.birth_year);
  for (let pass = 0; pass < 8; pass++) {
    for (const p of people) {
      if (born.has(p.id)) continue;
      const guesses = [];
      const ps = fam.parents.get(p.id).filter((q) => born.has(q)).map((q) => born.get(q));
      if (ps.length) guesses.push(Math.max(...ps) + 27);
      const cs = fam.children.get(p.id).filter((q) => born.has(q)).map((q) => born.get(q));
      if (cs.length) guesses.push(Math.min(...cs) - 27);
      const ss = fam.spouses.get(p.id).filter((q) => born.has(q)).map((q) => born.get(q));
      if (ss.length) guesses.push(ss.reduce((a, b) => a + b, 0) / ss.length);
      if (guesses.length) {
        born.set(p.id, Math.min(thisYear, Math.round(guesses.reduce((a, b) => a + b, 0) / guesses.length)));
        estimated.add(p.id);
      }
    }
  }
  const known = [...born.values()];
  const fallback = known.length ? Math.min(...known) : thisYear - 30;
  for (const p of people) {
    if (!born.has(p.id)) { born.set(p.id, fallback); estimated.add(p.id); }
    if (p.death_year) died.set(p.id, p.death_year);
    else if (p.deceased) died.set(p.id, Math.min(thisYear, born.get(p.id) + 75));
  }
  return { born, died, estimated };
}
