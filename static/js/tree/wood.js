// How the branches join up. Pure maths, no 3D code, so it's easy to test.
//
// Every family sits on one piece of wood, the way the tree on the sign-in page does:
//
//              child      child          The branch from a couple's parents arrives at their FORK,
//                  \      /              just under the pair. Short LIMBS curl up from the fork to
//                   \    /               hold each partner's medallion from below, a STEM rises
//      (partner)~~~~KNOT~~~~(partner)    between them to the KNOT, where their gold vine ties
//           \        |        /          round it, and their children's branches grow out of the
//            \___  STEM  ___/            knot. A parent on their own gets the same, off to one side.
//                 \  |  /
//                   FORK   <- from their parents (or from the trunk, for the oldest family)
//
// Every branch starts inside the wood it grows from and ends inside a knot, so nothing floats.
import { TRUNK_HEIGHT } from "./layout.js";

export const GROW_YEARS = 2.5;       // how long a branch takes to grow in the time-lapse
// In the time-lapse the wood always grows first: each person's branch finishes the year they're born,
// the branch before it finishes just before that, and so on back to the trunk, so a medallion only
// ever appears on the end of a branch that has already reached it.
const KNOB_DROP = 0.7;               // a medallion sits on the tip of its branch, just under the ring
const FORK_DROP = 1.3;               // a family's fork: below the couple, between their name labels
const KNOT_LIFT = 0.16;              // the knot: level with the middle of the gold vine
const BACK = 0.34;                   // stems and knots stand a little behind the medallions

export const branchRadius = (gen) => Math.max(0.07, 0.24 - gen * 0.035);

const v = (x, y, z) => ({ x, y, z });
const plus = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mid = (a, b) => v((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);

// Curve shapes, as cubic Bézier control points.
function rise(from, to) {             // leaves heading up, arrives heading up (a gentle S)
  const dy = Math.max(0.4, to.y - from.y);
  return [from, plus(from, v(0, dy * 0.55, 0)), plus(to, v(0, -dy * 0.55, 0)), to];
}
function curl(from, to) {             // leaves up and out, then turns upward under a medallion like a hand
  return [from, v(from.x + (to.x - from.x) * 0.42, from.y + 0.2, from.z + (to.z - from.z) * 0.42),
    v(to.x, to.y - 0.34, to.z), to];
}
function arch(from, to) {             // from one fork across to another
  const dx = to.x - from.x, dz = to.z - from.z;
  return [from, v(from.x + dx * 0.35, from.y + 0.22, from.z + dz * 0.35),
    v(to.x - dx * 0.35, to.y + 0.22, to.z - dz * 0.35), to];
}
function vineCurve(a, b) {            // rim to rim, arching up a little (a quadratic Bézier)
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
  const d = v((b.x - a.x) / len, (b.y - a.y) / len, (b.z - a.z) / len);
  const start = v(a.x + d.x * 0.6, a.y + d.y * 0.6, a.z + d.z * 0.6 - 0.06);
  const end = v(b.x - d.x * 0.6, b.y - d.y * 0.6, b.z - d.z * 0.6 - 0.06);
  return [start, plus(mid(start, end), v(0, 0.32, -0.06)), end];
}

export function computeWood({ pos, gen, fam }) {
  const ids = [...pos.keys()];
  const P = (id) => pos.get(id);
  const G = (id) => gen.get(id) || 0;
  const edges = [], knots = [], links = new Map(), vines = new Map();
  const addEdge = (e) => (edges.push(e), edges.length - 1);

  // 1. Families ("units"): every couple, plus a parent on their own when a child has only them.
  const units = [], unitOfCouple = new Map(), singleUnit = new Map(), coupleUnits = new Map();
  const coupleKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const a of ids) {
    coupleUnits.set(a, []);
  }
  for (const a of ids) {
    for (const b of fam.spouses.get(a) || []) {
      if (!pos.has(b) || unitOfCouple.has(coupleKey(a, b))) continue;
      const u = { members: a < b ? [a, b] : [b, a], children: [] };
      unitOfCouple.set(coupleKey(a, b), u);
      units.push(u);
    }
  }
  for (const u of units) for (const m of u.members) coupleUnits.get(m).push(u);
  const parentUnitsOf = (c) => {
    const ps = (fam.parents.get(c) || []).filter((p) => pos.has(p));
    if (ps.length === 2 && unitOfCouple.has(coupleKey(ps[0], ps[1]))) return [unitOfCouple.get(coupleKey(ps[0], ps[1]))];
    return ps.map((p) => {
      if (!singleUnit.has(p)) {
        const u = { members: [p], children: [], single: true };
        singleUnit.set(p, u);
        units.push(u);
      }
      return singleUnit.get(p);
    });
  };
  const childParents = new Map();
  for (const c of ids) {
    const us = parentUnitsOf(c);
    childParents.set(c, us);
    for (const u of us) u.children.push(c);
  }
  // Where each person's own wood is: their first couple, or their own family if they're a lone parent.
  const home = (p) => coupleUnits.get(p)[0] || singleUnit.get(p) || null;

  // 2. Where each family's fork and knot are.
  for (const u of units) {
    u.gen = Math.max(...u.members.map(G));
    if (u.single) {
      const p = P(u.members[0]);
      const kidsX = u.children.map((c) => P(c).x);
      const side = kidsX.length && kidsX.reduce((s, x) => s + x, 0) / kidsX.length < p.x ? -1 : 1;
      u.fork = v(p.x + 0.35 * side, p.y - FORK_DROP, p.z - BACK * 0.6);
      u.knot = v(p.x + 1.0 * side, p.y + KNOT_LIFT, p.z - BACK);
    } else {
      const m = mid(P(u.members[0]), P(u.members[1]));
      u.fork = v(m.x, m.y - FORK_DROP, m.z - BACK * 0.6);
      u.knot = v(m.x, m.y + KNOT_LIFT, m.z - BACK);
    }
    u.in = [];          // edges arriving at the fork
  }
  const knob = (p) => v(P(p).x, P(p).y - KNOB_DROP, P(p).z - 0.05);
  const target = (p) => (home(p) ? { unit: home(p), at: home(p).fork } : { person: p, at: knob(p) });
  const knobEdges = new Map();        // person -> edge that holds their medallion

  // 3. Limbs from each fork up to its partners (or across to a partner's other family).
  const limbOf = new Map(), across = new Map();
  for (const u of units) {
    const R = branchRadius(u.gen);
    for (const m of u.members) {
      const h = home(m);
      if (h === u) {
        const i = addEdge({
          kind: "limb", points: curl(u.fork, knob(m)), r0: R * 0.8, r1: R * 0.55, groups: [[m]],
          grow: { mode: "birth", ids: [m], offset: -GROW_YEARS },     // reaches them the year they're born
        });
        limbOf.set(m, i);
        knobEdges.set(m, i);
      } else if (h && !across.has(`${m}:${units.indexOf(u)}`)) {
        const other = u.members.filter((x) => x !== m);
        const i = addEdge({
          kind: "limb", points: arch(h.fork, u.fork), r0: R * 0.75, r1: R * 0.65,
          groups: other.length ? [[m], other] : [[m]],
          grow: { mode: "birth", ids: [...other, ...u.children], offset: -GROW_YEARS * 4 },
        });
        across.set(`${m}:${units.indexOf(u)}`, i);
        u.in.push(i);
      }
    }
    // Stem up to the knot, if this family has children.
    if (u.children.length) {
      u.stem = addEdge({
        kind: "stem", points: rise(u.fork, u.knot), r0: R, r1: R * 0.92, groups: [u.members, u.children],
        grow: { mode: "birth", ids: u.children, offset: -GROW_YEARS * 3 },   // ready before the first child's branch
      });
    }
  }

  // 4. Children's branches, from their parents' knot to their own fork (or straight to their medallion).
  const branchTo = new Map();         // "unitIndex>child" -> edge
  for (const u of units) {
    for (const c of u.children) {
      const t = target(c);
      const i = addEdge({
        kind: "child", points: rise(u.knot, t.at), r0: branchRadius(u.gen) * 0.9, r1: branchRadius(G(c)),
        groups: [[c], u.members], grow: { mode: "birth", ids: [c], offset: t.unit ? -GROW_YEARS * 2 : -GROW_YEARS },
      });
      branchTo.set(`${units.indexOf(u)}>${c}`, i);
      if (t.unit) t.unit.in.push(i); else knobEdges.set(c, i);
    }
  }

  // 5. The trunk, under the oldest family (or between them, if there are several).
  const roots = ids.filter((p) => G(p) === 0 && !(childParents.get(p) || []).length);
  const rootTargets = [];
  for (const p of roots) {
    const t = target(p);
    if (!rootTargets.some((r) => r.at === t.at)) rootTargets.push({ ...t, ids: t.unit ? t.unit.members : [p] });
  }
  const trunk = rootTargets.length
    ? v(rootTargets.reduce((s, t) => s + t.at.x, 0) / rootTargets.length, 0, rootTargets.reduce((s, t) => s + t.at.z, 0) / rootTargets.length)
    : v(0, 0, 0);
  const trunkTop = v(trunk.x, TRUNK_HEIGHT - 0.05, trunk.z);
  for (const t of rootTargets) {
    const i = addEdge({
      kind: "trunk", points: rise(trunkTop, t.at), r0: 0.3, r1: branchRadius(0) * 1.1, groups: [t.ids],
      grow: { mode: "birth", ids: t.ids, offset: t.unit ? -GROW_YEARS * 2 : -GROW_YEARS },
    });
    if (t.unit) t.unit.in.push(i); else knobEdges.set(t.ids[0], i);
  }

  // 6. Gold vines between partners.
  for (const u of units) {
    if (u.single) continue;
    const [a, b] = u.members;
    vines.set(coupleKey(a, b), addEdge({
      kind: "vine", points: vineCurve(P(a), P(b)), r0: 0.05, r1: 0.05, groups: [[a], [b]],
      grow: { mode: "union", ids: u.members, offset: 0 },
    }));
  }

  // 7. Knots at every joint, sized to swallow the ends of the branches that meet there.
  const tip = (i) => edges[i].r1, base = (i) => edges[i].r0;
  knots.push({ kind: "trunk", at: v(trunk.x, TRUNK_HEIGHT - 0.05, trunk.z), r: 0.38, groups: [roots], carrier: null });
  for (const u of units) {
    const out = edges.filter((e) => e.points[0] === u.fork).map((e) => e.r0);
    const r = Math.max(...u.in.map(tip), ...out, 0.08) * 1.12;
    const carrier = u.in[0] ?? edges.findIndex((e) => e.points[0] === u.fork);
    knots.push({ kind: "fork", at: u.fork, r, groups: [u.members], carrier: carrier >= 0 ? carrier : null });
    if (u.stem != null) {
      const kids = u.children.map((c) => branchTo.get(`${units.indexOf(u)}>${c}`));
      knots.push({ kind: "knot", at: u.knot, r: Math.max(tip(u.stem), ...kids.map(base)) * 1.15, groups: [u.members, u.children], carrier: u.stem });
    }
  }
  for (const [p, i] of knobEdges) knots.push({ kind: "knob", person: p, at: knob(p), r: Math.max(0.1, tip(i) * 1.3), groups: [[p]], carrier: i });

  // 8. For "How are we related?": the chain of wood between each parent and child.
  for (const u of units) {
    const ui = units.indexOf(u);
    for (const c of u.children) {
      const t = target(c);
      for (const p of u.members) {
        const chain = [];
        if (home(p) === u) chain.push(limbOf.get(p));
        else if (across.has(`${p}:${ui}`)) chain.push(limbOf.get(p), across.get(`${p}:${ui}`));
        chain.push(u.stem, branchTo.get(`${ui}>${c}`));
        if (t.unit && limbOf.has(c)) chain.push(limbOf.get(c));
        links.set(`${p}>${c}`, chain.filter((i) => i != null));
      }
    }
  }

  return { edges, knots, links, vines, trunk, trunkTop, units };
}

// The year a branch starts growing in the time-lapse.
export function growYear(grow, born) {
  const years = grow.ids.map((id) => born.get(id)).filter((y) => y != null);
  if (!years.length) return -Infinity;
  return grow.mode === "union" ? Math.max(...years) + 20 + grow.offset : Math.min(...years) + grow.offset;
}

// The whole time-lapse schedule: when each branch starts growing (never before the wood it grows
// from has arrived) and the year each person appears (their birth, or when their branch reaches
// them if that's later, e.g. a partner who married in and is older than the family's fork).
export function growSchedule({ edges, knots }, born) {
  const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
  const feeders = edges.map((e, i) => (e.kind === "vine" ? [] : edges
    .map((f, j) => (j !== i && f.kind !== "vine" && close(f.points[f.points.length - 1], e.points[0]) ? j : -1))
    .filter((j) => j >= 0)));
  const start = new Array(edges.length).fill(null);
  const visit = (i, busy) => {
    if (start[i] != null) return start[i];
    let s = growYear(edges[i].grow, born);
    if (busy.has(i)) return s;
    busy.add(i);
    for (const j of feeders[i]) s = Math.max(s, visit(j, busy) + GROW_YEARS);
    return (start[i] = s);
  };
  edges.forEach((_, i) => visit(i, new Set()));
  const appear = new Map();
  for (const k of knots) {
    if (k.kind === "knob") appear.set(k.person, Math.max(born.get(k.person) ?? -Infinity, start[k.carrier] + GROW_YEARS));
  }
  return { start, appear };
}
