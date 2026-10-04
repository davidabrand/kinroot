// The tree's layout engine: bands, spacing, couples, crossings and "Unknown" parents.
import test from "node:test";
import assert from "node:assert/strict";
import { COUPLE_GAP, GEN_HEIGHT, computeLayout, countCrossings, pack } from "../../static/js/tree/layout.js";
import { buildLinks, routePoints } from "../../static/js/tree/links.js";

// A tiny family builder: person("Ann", 1950) returns an id; parent(a, b) / partner(a, b) link them.
function family() {
  const people = [], rels = [];
  let next = 1;
  return {
    people, rels,
    person(first, birth_year = null) { const id = next++; people.push({ id, first_name: first, birth_year }); return id; },
    parent(p, c) { rels.push({ kind: "parent", person_a: p, person_b: c }); },
    partner(a, b) { rels.push({ kind: "spouse", person_a: Math.min(a, b), person_b: Math.max(a, b) }); },
    couple(a, b, ...kids) { this.partner(a, b); for (const k of kids) { this.parent(a, k); this.parent(b, k); } },
  };
}

// Nobody in the same band closer than the minimum gap, and every child a band above each parent.
function assertSound(layout) {
  const { pos, fam } = layout;
  for (const row of layout.rows) {
    const xs = row.map((id) => pos.get(id).x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= COUPLE_GAP - 1e-6, `overlap in a band: ${xs}`);
  }
  for (const [child, ps] of fam.parents) for (const p of ps) assert.ok(pos.get(child).y > pos.get(p).y, "a child sits above their parent");
}

test("pack keeps everyone at least the gap apart, as close to their wish as possible", () => {
  assert.deepEqual(pack([0, 0, 0], [2, 2]), [-2, 0, 2]);
  assert.deepEqual(pack([0, 10], [2]), [0, 10]);
});

test("two people, a couple, side by side in one band", () => {
  const f = family();
  const a = f.person("Ann"), b = f.person("Bob");
  f.partner(a, b);
  const l = computeLayout(f.people, f.rels);
  assert.equal(l.pos.get(a).y, l.pos.get(b).y);
  assert.ok(Math.abs(Math.abs(l.pos.get(a).x - l.pos.get(b).x) - COUPLE_GAP) < 1e-6);
});

test("three generations stack in bands, children centred under (above) their parents", () => {
  const f = family();
  const g1 = f.person("Rose", 1900), g2 = f.person("Isaac", 1898);
  const p1 = f.person("Joe", 1925), p2 = f.person("Ann", 1927);
  const c1 = f.person("Sam", 1950), c2 = f.person("Lin", 1952);
  f.couple(g1, g2, p1);
  f.couple(p1, p2, c1, c2);
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.equal(l.pos.get(c1).y - l.pos.get(p1).y, GEN_HEIGHT);
  const parentsMid = (l.pos.get(p1).x + l.pos.get(p2).x) / 2;
  const kidsMid = (l.pos.get(c1).x + l.pos.get(c2).x) / 2;
  assert.ok(Math.abs(parentsMid - kidsMid) < 0.6, "siblings sit around their parents' junction");
  assert.ok(l.pos.get(c1).x < l.pos.get(c2).x, "older sibling first");
});

test("single parent, large sibling group, multiple partners and half-siblings stay clear", () => {
  const f = family();
  const mum = f.person("Mum"), dad1 = f.person("Dad"), dad2 = f.person("Step");
  f.partner(mum, dad1);
  f.partner(mum, dad2);
  const kids = [];
  for (let i = 0; i < 9; i++) { const k = f.person(`K${i}`, 1980 + i); kids.push(k); f.parent(mum, k); f.parent(i < 5 ? dad1 : dad2, k); }
  const solo = f.person("Solo");
  const only = f.person("Only child");
  f.parent(solo, only);
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  // Mum sits between her two partners.
  const xs = [dad1, mum, dad2].map((id) => l.pos.get(id).x);
  assert.ok((xs[0] - xs[1]) * (xs[2] - xs[1]) < 0, "mum between her partners");
  assert.equal(l.crossings, 0);
  // Two families with different fathers: two separate junctions.
  assert.equal(l.families.filter((fm) => fm.parents.includes(mum)).length, 2);
});

test("an in-law's parents sit right below them, not stranded at the bottom", () => {
  const f = family();
  // A deep line: 4 generations down to Kid.
  let top = f.person("G0");
  for (let i = 1; i < 4; i++) { const n = f.person(`G${i}`); f.parent(top, n); top = n; }
  const inlaw = f.person("Inlaw"), inlawMum = f.person("Inlaw's mum");
  f.parent(inlawMum, inlaw);
  f.partner(top, inlaw);
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.equal(l.gen.get(inlawMum), l.gen.get(inlaw) - 1);
});

test("two families joined by a marriage are ordered without crossings", () => {
  const f = family();
  const a1 = f.person("A1"), a2 = f.person("A2"), b1 = f.person("B1"), b2 = f.person("B2");
  const as = [f.person("As1"), f.person("As2"), f.person("As3")];
  const bs = [f.person("Bs1"), f.person("Bs2"), f.person("Bs3")];
  f.couple(a1, a2, ...as);
  f.couple(b1, b2, ...bs);
  f.partner(as[2], bs[0]);            // the youngest of one family marries the eldest of the other
  const kid = f.person("Kid");
  f.parent(as[2], kid); f.parent(bs[0], kid);
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.equal(countCrossings(l.rows, l.fam, new Map([...l.pos].map(([id, p]) => [id, p.x]))), 0);
  assert.equal(Math.abs(l.rows[1].indexOf(as[2]) - l.rows[1].indexOf(bs[0])), 1, "the married pair sit together");
});

test("six generations: sound and free of crossings", () => {
  const f = family();
  let band = [f.person("Root A"), f.person("Root B")];
  f.partner(band[0], band[1]);
  for (let g = 1; g < 6; g++) {
    const next = [];
    for (let i = 0; i + 1 < band.length; i += 2) {
      for (let k = 0; k < 2; k++) {
        const c = f.person(`P${g}-${i}-${k}`); f.parent(band[i], c); f.parent(band[i + 1], c);
        const spouse = f.person(`S${g}-${i}-${k}`); f.partner(c, spouse);
        next.push(c, spouse);
      }
    }
    band = next;
  }
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.equal(l.maxGen, 5);
  assert.equal(l.crossings, 0);
});

test("a random 500-person family lays out soundly and quickly", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const f = family();
  const couples = [];
  const a = f.person("Founder A"), b = f.person("Founder B");
  f.partner(a, b);
  couples.push([a, b]);
  while (f.people.length < 500) {
    const [p, q] = couples[Math.floor(rand() * couples.length)];
    const kid = f.person("Kid");
    f.parent(p, kid);
    if (rand() > 0.15) f.parent(q, kid);              // some single parents
    if (rand() > 0.35) { const s = f.person("Partner"); f.partner(kid, s); couples.push([kid, s]); }
  }
  const t0 = Date.now();
  const l = computeLayout(f.people, f.rels);
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0}ms`);
  assertSound(l);
});

test("unknown parents appear beside you, never in the family data", () => {
  const f = family();
  const mum = f.person("Mum"), me = f.person("Me");
  f.parent(mum, me);
  const l = computeLayout(f.people, f.rels, { meId: me, unknownFor: [me] });
  assert.equal(l.placeholders.length, 1);
  const ph = l.placeholders[0];
  assert.ok(ph.id < 0 && ph.childId === me);
  assert.equal(l.pos.get(ph.id).y, l.pos.get(mum).y);
  assert.ok(!l.fam.parents.get(me).includes(ph.id), "the real family is untouched");
  assert.ok(l.families.some((fm) => fm.parents.includes(ph.id) && fm.children.includes(me)));
});

test("missing dates and missing links still lay out", () => {
  const f = family();
  for (let i = 0; i < 5; i++) f.person(`Loose ${i}`);
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.equal(l.maxGen, 0);
});

test("lines: a couple's children branch from one junction and end below each child", () => {
  const f = family();
  const a = f.person("A"), b = f.person("B"), c1 = f.person("C1"), c2 = f.person("C2");
  f.couple(a, b, c1, c2);
  const l = computeLayout(f.people, f.rels);
  const links = buildLinks(l, (id) => l.pos.get(id), () => 0.5);
  const kids = links.curves.filter((c) => c.kind === "child");
  assert.equal(kids.length, 2);
  assert.deepEqual(kids[0].pts[0], kids[1].pts[0], "same junction");
  assert.equal(links.junctions.length, 1);
  for (const k of kids) {
    const end = k.pts[k.pts.length - 1], p = l.pos.get(k.child);
    assert.ok(Math.abs(end[0] - p.x) < 1e-9 && end[1] < p.y - 0.6 - 0.49, "ends below the child's caption");
  }
  assert.ok(links.curves.some((c) => c.kind === "root"), "faint roots under the oldest band");
  // The route from one child to the other: up through the junction, in order.
  const route = routePoints([c1, a, c2], l, links);
  const near = (pt, id) => Math.hypot(pt[0] - l.pos.get(id).x, pt[1] - l.pos.get(id).y) < 2;
  assert.ok(near(route[0], c1) && near(route[route.length - 1], c2));
});

test("a very wide family spreads its bands apart so generations stay distinct", () => {
  const f = family();
  const a = f.person("A"), b = f.person("B");
  f.partner(a, b);
  for (let i = 0; i < 40; i++) { const k = f.person(`K${i}`); f.parent(a, k); f.parent(b, k); }
  const l = computeLayout(f.people, f.rels);
  assertSound(l);
  assert.ok(l.genHeight > GEN_HEIGHT, "taller gaps for a wide family");
  const small = computeLayout(f.people.slice(0, 4), f.rels.filter((r) => r.person_b <= 4));
  assert.equal(small.genHeight, GEN_HEIGHT, "a small family keeps the standard gap");
});
