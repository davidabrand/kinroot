// Where everyone sits on the tree. Pure maths, no 3D code, so it's easy to test.
//
// Generations sit in clear horizontal bands: the oldest at the bottom (the family's roots),
// each younger generation one band higher. Inside a band, partners sit side by side and
// siblings stay together under their parents. The order inside every band is chosen to cross
// as few lines as possible, and spacing never drops below a minimum, so portraits never overlap.

export const R = 0.6;              // medallion radius, in world units
export const GEN_HEIGHT = 3.3;     // distance between generation bands
export const COUPLE_GAP = 2.1;     // centre to centre: partners
export const SIBLING_GAP = 2.45;   //                   brothers and sisters
export const FAMILY_GAP = 3.1;     //                   unrelated neighbours (cousins, in-laws' families)
const DEPTH_STEP = 0.55;           // each generation away from you sits a little further back
const DEPTH_CURVE = 0.006;         // and the band bends gently away at its ends
const MAX_DEPTH = 5;
const WIDEST = 2.6;                // past this width-to-height ratio, bands spread further apart

export function indexFamily(people, rels) {
  const ids = new Set(people.map((p) => p.id));
  const parents = new Map(), children = new Map(), spouses = new Map();
  for (const id of ids) { parents.set(id, []); children.set(id, []); spouses.set(id, []); }
  for (const r of rels) {
    if (!ids.has(r.person_a) || !ids.has(r.person_b) || r.person_a === r.person_b) continue;
    if (r.kind === "parent") {
      if (!parents.get(r.person_b).includes(r.person_a)) parents.get(r.person_b).push(r.person_a);
      if (!children.get(r.person_a).includes(r.person_b)) children.get(r.person_a).push(r.person_b);
    } else {
      if (!spouses.get(r.person_a).includes(r.person_b)) spouses.get(r.person_a).push(r.person_b);
      if (!spouses.get(r.person_b).includes(r.person_a)) spouses.get(r.person_b).push(r.person_a);
    }
  }
  return { parents, children, spouses };
}

// Which band everyone sits in. Children sit above their parents and partners share a band.
// Then ancestors are pulled up to sit just below their children, so someone who married into
// a deep family doesn't leave their own parents stranded several bands down.
export function generations(people, rels) {
  const fam = indexFamily(people, rels);
  const gen = new Map(people.map((p) => [p.id, 0]));
  const limit = people.length + 3;
  const settle = () => {
    for (let pass = 0; pass < limit; pass++) {
      let changed = false;
      for (const [child, ps] of fam.parents) {
        for (const p of ps) if (gen.get(child) < gen.get(p) + 1) { gen.set(child, gen.get(p) + 1); changed = true; }
      }
      for (const [a, ss] of fam.spouses) {
        for (const b of ss) {
          const top = Math.max(gen.get(a), gen.get(b));
          if (gen.get(a) !== top || gen.get(b) !== top) { gen.set(a, top); gen.set(b, top); changed = true; }
        }
      }
      if (!changed) return;
    }
  };
  settle();
  for (let pass = 0; pass < limit; pass++) {
    let changed = false;
    for (const [id, cs] of fam.children) {
      if (!cs.length) continue;
      const want = Math.min(...cs.map((c) => gen.get(c))) - 1;
      if (want > gen.get(id)) { gen.set(id, want); changed = true; }
    }
    if (!changed) break;
    settle();
  }
  const low = people.length ? Math.min(...gen.values()) : 0;
  for (const [id, g] of gen) gen.set(id, g - low);
  return gen;
}

// Positions along a band: as close as possible to where everyone wants to be, never closer
// together than the gaps allow. (Least squares with minimum gaps, solved exactly by
// "pool adjacent violators": shift the gaps out, make the sequence non-decreasing, shift back.)
export function pack(want, gaps) {
  const n = want.length, off = [0];
  for (let i = 1; i < n; i++) off.push(off[i - 1] + gaps[i - 1]);
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: want[i] - off[i], count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      a.sum += b.sum; a.count += b.count;
      blocks.pop();
    }
  }
  const x = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) x.push(b.sum / b.count + off[x.length]);
  return x;
}

const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;

// Lines that cross between bands. Each child hangs from one junction between their parents,
// so a line runs from the child to the middle of their parents; those lines are compared pairwise.
export function countCrossings(rows, fam, x) {
  let total = 0;
  for (const row of rows) {
    const edges = [];
    for (const c of row) {
      const ps = fam.parents.get(c);
      if (ps.length) edges.push([x.get(c), mean(ps.map((p) => x.get(p)))]);
    }
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if ((edges[i][0] - edges[j][0]) * (edges[i][1] - edges[j][1]) < -1e-9) total++;
      }
    }
  }
  return total;
}

// "Unknown" parents shown beside someone who is missing one or both, so a parent can be
// added right where they belong. Placeholder ids are negative and never reach the family data.
function withPlaceholders(people, rels, fam, forIds) {
  const extra = [], links = [], placeholders = [];
  for (const id of forIds) {
    if (!fam.parents.has(id)) continue;
    const known = fam.parents.get(id);
    for (let k = known.length; k < 2; k++) {
      const pid = -(id * 2 + k + 1);
      extra.push({ id: pid, placeholder: true, first_name: "Unknown" });
      links.push({ kind: "parent", person_a: pid, person_b: id });
      // The missing parent sits beside the known one, as their (unknown) partner.
      if (known.length === 1) links.push({ kind: "spouse", person_a: known[0], person_b: pid });
      placeholders.push({ id: pid, childId: id });
    }
    if (!known.length) links.push({ kind: "spouse", person_a: -(id * 2 + 1), person_b: -(id * 2 + 2) });
  }
  return { people: [...people, ...extra], rels: [...rels, ...links], placeholders };
}

export function computeLayout(people, rels, { meId = null, unknownFor = [] } = {}) {
  const fam = indexFamily(people, rels);             // the real family: what the rest of the app sees
  const aug = withPlaceholders(people, rels, fam, unknownFor);
  const all = aug.people;
  const f = indexFamily(all, aug.rels);
  const gen = generations(all, aug.rels);
  const maxGen = all.length ? Math.max(...gen.values()) : 0;
  const rows = [];
  for (let g = 0; g <= maxGen; g++) rows.push([]);
  // Start each band in a family-first order (a walk through each connected family), so separate
  // families begin apart and the sweeps below only have to refine.
  const seen = new Set();
  const visit = (start) => {
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      rows[gen.get(id)].push(id);
      const next = [...f.children.get(id), ...f.spouses.get(id), ...f.parents.get(id)].filter((n) => !seen.has(n));
      for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
    }
  };
  for (const p of [...all].sort((a, b) => gen.get(a.id) - gen.get(b.id) || a.id - b.id)) visit(p.id);

  const x = new Map();
  rows.forEach((row) => row.forEach((id, i) => x.set(id, i * SIBLING_GAP)));
  const shareParent = (a, b) => f.parents.get(a).some((p) => f.parents.get(b).includes(p));
  const gapBetween = (a, b) => (f.spouses.get(a).includes(b) ? COUPLE_GAP : shareParent(a, b) ? SIBLING_GAP : FAMILY_GAP);
  const born = new Map(all.map((p) => [p.id, p.birth_year ?? null]));

  // Partners inside a band form a unit that moves together.
  const unitsOf = (row) => {
    const inRow = new Set(row), done = new Set(), units = [];
    for (const id of row) {
      if (done.has(id)) continue;
      const unit = [], stack = [id];
      while (stack.length) {
        const n = stack.pop();
        if (done.has(n)) continue;
        done.add(n);
        unit.push(n);
        for (const s of f.spouses.get(n)) if (inRow.has(s) && !done.has(s)) stack.push(s);
      }
      units.push(unit);
    }
    return units;
  };

  // Order the members of one unit. A couple: the partner whose own family lies to the left goes
  // left; someone who married in sits on the outside of their partner's brothers and sisters.
  const orderUnit = (unit, wantOf, row) => {
    if (unit.length === 1) return unit;
    const inUnit = new Set(unit);
    const deg = (n) => f.spouses.get(n).filter((s) => inUnit.has(s)).length;
    const side = (n) => {
      const w = wantOf(n);
      if (w != null) return w;
      const partner = f.spouses.get(n).find((s) => inUnit.has(s) && wantOf(s) != null);
      if (partner == null) return x.get(n);
      const sibs = row.filter((s) => s !== partner && shareParent(s, partner));
      const outward = sibs.length ? (x.get(partner) >= mean(sibs.map((s) => x.get(s))) ? 1 : -1) : 1;
      return wantOf(partner) + outward * 0.01;
    };
    const isPath = unit.every((n) => deg(n) <= 2) && unit.filter((n) => deg(n) === 1).length === 2;
    if (isPath) {
      const ends = unit.filter((n) => deg(n) === 1);
      const path = [ends[0]];
      while (path.length < unit.length) {
        const last = path[path.length - 1];
        path.push(f.spouses.get(last).find((s) => inUnit.has(s) && !path.includes(s)));
      }
      return side(path[0]) <= side(path[path.length - 1]) ? path : path.reverse();
    }
    // Someone with several partners sits in the middle, partners split either side.
    const hub = [...unit].sort((a, b) => deg(b) - deg(a) || a - b)[0];
    const rest = unit.filter((n) => n !== hub).sort((a, b) => side(a) - side(b) || a - b);
    const half = Math.floor(rest.length / 2);
    return [...rest.slice(0, half), hub, ...rest.slice(half)];
  };

  // Lay out one band: units ordered by where they want to be, then packed with minimum gaps.
  const placeRow = (row, wantOf, reorder = true) => {
    let order = row;
    if (reorder) {
      const units = unitsOf(row).map((u) => {
        const wants = u.map(wantOf).filter((w) => w != null);
        return { members: orderUnit(u, wantOf, row), key: wants.length ? mean(wants) : mean(u.map((n) => x.get(n))) };
      });
      // Brothers and sisters with the same key keep their birth order.
      const firstBorn = (u) => Math.min(...u.members.map((n) => born.get(n) ?? 9999));
      units.sort((a, b) => a.key - b.key || firstBorn(a) - firstBorn(b) || a.members[0] - b.members[0]);
      order = units.flatMap((u) => u.members);
    }
    const want = order.map((id) => {
      const w = wantOf(id);
      if (w != null) return w;
      const partner = f.spouses.get(id).find((s) => order.includes(s) && wantOf(s) != null);
      return partner != null ? wantOf(partner) : x.get(id);
    });
    // A couple wants to sit centred on its shared want, not stacked on one point.
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && f.spouses.get(order[j]).includes(order[j + 1])) j++;
      if (j > i) {
        const centre = mean(want.slice(i, j + 1));
        let offs = [0];
        for (let k = i + 1; k <= j; k++) offs.push(offs[offs.length - 1] + COUPLE_GAP);
        const mid = mean(offs);
        for (let k = i; k <= j; k++) want[k] = centre + offs[k - i] - mid;
      }
      i = j + 1;
    }
    const gaps = order.slice(1).map((id, i) => gapBetween(order[i], id));
    const xs = pack(want, gaps);
    order.forEach((id, i) => x.set(id, xs[i]));
    row.splice(0, row.length, ...order);
  };

  const wantFromParents = (id) => {
    const ps = f.parents.get(id);
    return ps.length ? mean(ps.map((p) => x.get(p))) : null;
  };
  const wantFromChildren = (id) => {
    const cs = f.children.get(id);
    return cs.length ? mean(cs.map((c) => x.get(c))) : null;
  };
  const wantBoth = (id) => {
    const a = wantFromParents(id), b = wantFromChildren(id);
    return a == null ? b : b == null ? a : (a + b) / 2;
  };

  // Sweep up and down a few times, keeping whichever ordering crosses the fewest lines.
  let best = null;
  const snapshot = () => ({ rows: rows.map((r) => [...r]), x: new Map(x) });
  const sweeps = all.length > 300 ? 6 : 10;
  for (let pass = 0; pass < sweeps; pass++) {
    for (let g = 1; g <= maxGen; g++) if (rows[g].length) placeRow(rows[g], wantFromParents);
    for (let g = maxGen - 1; g >= 0; g--) if (rows[g].length) placeRow(rows[g], wantFromChildren);
    const crossings = countCrossings(rows, f, x);
    if (!best || crossings < best.crossings) best = { crossings, ...snapshot() };
    if (crossings === 0) break;
  }
  if (best) {
    best.rows.forEach((r, g) => rows[g].splice(0, rows[g].length, ...r));
    for (const [id, v] of best.x) x.set(id, v);
  }
  // Settle positions without reordering: everyone between their parents and their children.
  for (let pass = 0; pass < 4; pass++) {
    for (let g = 0; g <= maxGen; g++) if (rows[g].length) placeRow(rows[g], wantBoth, false);
  }

  // Centre the tree, then give it gentle depth around you (or the middle band).
  const xs = [...x.values()];
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  // A very wide family gets taller gaps between bands (up to 2.6x), so generations stay
  // easy to tell apart instead of flattening into a strip.
  const genHeight = maxGen > 0 ? Math.min(GEN_HEIGHT * 2.6, Math.max(GEN_HEIGHT, span / (WIDEST * maxGen))) : GEN_HEIGHT;
  const focusRow = meId != null && gen.has(meId) ? gen.get(meId) : Math.round(maxGen / 2);
  const half = Math.max(span / 2, 1);
  const pos = new Map();
  for (const p of all) {
    const px = x.get(p.id) - mid, g = gen.get(p.id);
    const bend = Math.min(DEPTH_CURVE * px * px, 2.2 * (px / half) ** 2);   // the band's ends bend gently away
    const z = -Math.min(MAX_DEPTH, DEPTH_STEP * Math.abs(g - focusRow) + bend);
    pos.set(p.id, { x: px, y: g * genHeight, z });
  }

  // Families: everyone who shares the same parents hangs from one junction between them.
  const families = new Map();
  for (const p of all) {
    const ps = [...f.parents.get(p.id)].sort((a, b) => x.get(a) - x.get(b));
    if (!ps.length) continue;
    const key = ps.join("+");
    if (!families.has(key)) families.set(key, { key, parents: ps, children: [] });
    families.get(key).children.push(p.id);
  }
  const partners = [];
  for (const [a, ss] of f.spouses) for (const b of ss) if (a < b) partners.push([a, b]);

  return {
    pos, gen, maxGen, fam, rows, focusRow, partners, genHeight,
    families: [...families.values()],
    placeholders: aug.placeholders,
    crossings: best ? best.crossings : 0,
  };
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
