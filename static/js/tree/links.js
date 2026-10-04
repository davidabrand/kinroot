// The lines between people, as plain points. Pure maths (no 3D code), so it's easy to test.
//
//   partners   a quiet line between two portraits (an arc over anyone sitting between them)
//   junction   the point on that line where the couple's children branch from
//   child      a smooth S-curve from the junction up to the child, ending just below their name
//   root       faint strands under the oldest generation, fading into the dark: the family
//              goes on further back than anyone has recorded yet
import { COUPLE_GAP, GEN_HEIGHT, R } from "./layout.js";

const CHILD_STEPS = 22, PARTNER_STEPS = 14, ROOT_STEPS = 18;
const MAX_ROOTS = 28;

const lerp = (a, b, t) => a + (b - a) * t;
const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
};
const quad = (p0, p1, p2, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * p0[k] + 2 * u * t * p1[k] + t * t * p2[k]);
};
const sample = (fn, steps) => Array.from({ length: steps + 1 }, (_, i) => fn(i / steps));

// The line between two partners, and the junction their children hang from.
export function partnerCurve(a, b) {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const span = r.x - l.x;
  if (Math.abs(l.y - r.y) < 1e-6 && span <= COUPLE_GAP * 1.6) {
    // Side by side: a nearly straight line between the rims, with the slightest sag.
    const p0 = [l.x + R * 1.08, l.y, l.z], p2 = [r.x - R * 1.08, r.y, r.z];
    const p1 = [(p0[0] + p2[0]) / 2, l.y - 0.1, (p0[2] + p2[2]) / 2];
    const pts = sample((t) => quad(p0, p1, p2, t), PARTNER_STEPS);
    return { pts, junction: quad(p0, p1, p2, 0.5), flip: a.x > b.x };
  }
  // Apart (someone sits between them, or they're in different bands): an arc over the top.
  const lift = Math.min(GEN_HEIGHT * 0.42, 0.7 + span * 0.06);
  const p0 = [l.x, l.y + R * 1.05, l.z], p3 = [r.x, r.y + R * 1.05, r.z];
  const top = Math.max(p0[1], p3[1]) + lift;
  const p1 = [lerp(p0[0], p3[0], 0.2), top, p0[2]], p2 = [lerp(p0[0], p3[0], 0.8), top, p3[2]];
  const pts = sample((t) => cubic(p0, p1, p2, p3, t), PARTNER_STEPS + 6);
  return { pts, junction: cubic(p0, p1, p2, p3, 0.5), flip: a.x > b.x };
}

// From a family's junction up to a child, arriving just below the child's caption.
export function childCurve(j, c, drop = 0) {
  const end = [c.x, c.y - R * 1.04 - drop, c.z];
  const rise = Math.max(0.6, end[1] - j[1]);
  const p1 = [j[0], j[1] + rise * 0.5, j[2]], p2 = [end[0], end[1] - rise * 0.5, end[2]];
  return sample((t) => cubic(j, p1, p2, end, t), CHILD_STEPS);
}

// Everything to draw for a layout. `posOf(id)` gives the current {x, y, z} (it may be mid-animation);
// `dropOf(id)` how far below a portrait its caption reaches, in world units.
export function buildLinks(layout, posOf, dropOf = () => 0) {
  const curves = [], junctions = [];
  const placeholder = (id) => id < 0;
  const partnerOf = new Map();
  for (const [a, b] of layout.partners) {
    const pa = posOf(a), pb = posOf(b);
    if (!pa || !pb) continue;
    const pc = partnerCurve(pa, pb);
    partnerOf.set(a < b ? `${a}+${b}` : `${b}+${a}`, pc);
    curves.push({ kind: "partner", key: `p:${Math.min(a, b)}+${Math.max(a, b)}`, ids: [a, b], pts: pc.pts,
      faint: placeholder(a) || placeholder(b) });
  }
  for (const fam of layout.families) {
    const ps = fam.parents.map(posOf);
    if (ps.some((p) => !p)) continue;
    let j;
    if (ps.length === 2) {
      const [a, b] = fam.parents;
      const known = partnerOf.get(a < b ? `${a}+${b}` : `${b}+${a}`);
      const pc = known || partnerCurve(ps[0], ps[1]);
      if (!known) {
        // Two parents who aren't recorded as partners still share one junction, joined quietly.
        curves.push({ kind: "partner", key: `p:${Math.min(a, b)}+${Math.max(a, b)}`, ids: [a, b], pts: pc.pts, faint: true });
      }
      j = pc.junction;
      junctions.push({ key: fam.key, at: j, ids: fam.parents });
    } else {
      j = [ps[0].x, ps[0].y + R * 1.04, ps[0].z];
    }
    for (const c of fam.children) {
      const pc = posOf(c);
      if (!pc) continue;
      curves.push({ kind: "child", key: `c:${fam.key}>${c}`, ids: [...fam.parents, c], child: c, parents: fam.parents,
        junction: j, pts: childCurve(j, pc, dropOf(c)),
        faint: placeholder(c) || fam.parents.some(placeholder) });
    }
  }
  // Roots: under the oldest band, a few strands converge toward the dark and fade away.
  const oldest = (layout.rows[0] || []).filter((id) => !placeholder(id) && posOf(id)).slice(0, MAX_ROOTS);
  if (oldest.length) {
    // Strands keep their left-to-right order as they gather, so they never cross each other.
    const strands = [];
    for (const id of oldest) for (const side of [-1, 1]) strands.push({ id, side, x: posOf(id).x + side * 0.12 });
    strands.sort((a, b) => a.x - b.x);
    const xs = strands.map((s) => s.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const width = Math.max(1.2, (Math.max(...xs) - Math.min(...xs)) * 0.32);
    strands.forEach(({ id, side, x }, i) => {
      const p = posOf(id), top = [x, p.y - R * 1.04 - dropOf(id), p.z];
      const ex = strands.length > 1 ? cx - width / 2 + (width * i) / (strands.length - 1) : cx;
      const end = [ex, p.y - (layout.genHeight || GEN_HEIGHT) * 1.15, p.z - 1.4];
      const p1 = [x, top[1] - 1.0, p.z], p2 = [ex, end[1] + 1.1, end[2]];
      curves.push({ kind: "root", key: `r:${id}${side}`, ids: [id], pts: sample((t) => cubic(top, p1, p2, end, t), ROOT_STEPS), fade: true });
    });
  }
  return { curves, junctions };
}

// The route between relatives, as one continuous line in order: along partner lines, down to a
// family's junction and up to the child (or the other way), for every step of the path.
export function routePoints(path, layout, links) {
  const out = [];
  const byKey = new Map(links.curves.map((c) => [c.key, c]));
  const push = (pts) => {
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1], last[2] - p[2]) > 1e-6) out.push(p);
    }
  };
  const famOf = (parent, child) => layout.families.find((f) => f.parents.includes(parent) && f.children.includes(child));
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const partner = byKey.get(`p:${Math.min(a, b)}+${Math.max(a, b)}`);
    if (partner && layout.partners.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
      const pts = partner.pts;
      const aLeft = pts[0][0] <= pts[pts.length - 1][0] ? true : false;
      const fromA = layout.pos.get(a).x <= layout.pos.get(b).x ? aLeft : !aLeft;
      push(fromA ? pts : [...pts].reverse());
      continue;
    }
    const down = famOf(a, b), up = famOf(b, a);
    const fam = down || up;
    if (!fam) continue;
    const parent = down ? a : b, child = down ? b : a;
    const curve = byKey.get(`c:${fam.key}>${child}`);
    if (!curve) continue;
    // Parent to junction: half the partner line (a couple), or the parent's own stem.
    let toJunction;
    if (fam.parents.length === 2) {
      const [p, q] = fam.parents;
      const pl = byKey.get(`p:${Math.min(p, q)}+${Math.max(p, q)}`);
      if (pl) {
        const half = Math.ceil(pl.pts.length / 2);
        const parentLeft = layout.pos.get(parent).x <= layout.pos.get(parent === p ? q : p).x;
        const leftToRight = pl.pts[0][0] <= pl.pts[pl.pts.length - 1][0];
        const ordered = leftToRight === parentLeft ? pl.pts : [...pl.pts].reverse();
        toJunction = ordered.slice(0, half);
      }
    }
    if (!toJunction) {
      const pp = layout.pos.get(parent);
      toJunction = [[pp.x, pp.y, pp.z], curve.junction];
    }
    const leg = [...toJunction, ...curve.pts];
    push(down ? leg : leg.reverse());
  }
  return out;
}
