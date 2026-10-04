// Branch filters on a small family with a few real-world wrinkles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSet } from "../../static/js/tree/filters.js";

// Grandparents G1 (m) + G2 (f) -> Dad (m); Grandma's other line G3 (f) -> Mum (f), whose father is unknown.
// Dad + Mum -> Me, Sis. Me -> Kid. Sis has a partner, Pat.
const people = {
  G1: "male", G2: "female", G3: "female", Dad: "male", Mum: "female", Me: "", Sis: "female", Kid: "", Pat: "",
};
const byId = new Map(Object.entries(people).map(([id, gender]) => [id, { id, gender }]));
const parents = new Map(Object.keys(people).map((id) => [id, []]));
const children = new Map(Object.keys(people).map((id) => [id, []]));
const spouses = new Map(Object.keys(people).map((id) => [id, []]));
const link = (p, c) => { parents.get(c).push(p); children.get(p).push(c); };
[["G1", "Dad"], ["G2", "Dad"], ["G3", "Mum"], ["Dad", "Me"], ["Mum", "Me"], ["Dad", "Sis"], ["Mum", "Sis"], ["Me", "Kid"]].forEach(([p, c]) => link(p, c));
spouses.get("Sis").push("Pat"); spouses.get("Pat").push("Sis");
spouses.get("G1").push("G2"); spouses.get("G2").push("G1");
const fam = { parents, children, spouses };
const ids = (set) => [...set].sort();

test("everyone means no filter", () => {
  assert.equal(filterSet("all", "Me", fam, byId), null);
  assert.equal(filterSet("ancestors", null, fam, byId), null);
});

test("immediate family: parents, siblings, children", () => {
  assert.deepEqual(ids(filterSet("immediate", "Me", fam, byId)), ["Dad", "Kid", "Me", "Mum", "Sis"]);
});

test("ancestors and descendants follow the lines, keeping couples together", () => {
  assert.deepEqual(ids(filterSet("ancestors", "Me", fam, byId)), ["Dad", "G1", "G2", "G3", "Me", "Mum"]);
  assert.deepEqual(ids(filterSet("descendants", "Mum", fam, byId)), ["Kid", "Me", "Mum", "Pat", "Sis"]);
});

test("father's and mother's sides use recorded genders, never guesses", () => {
  assert.deepEqual(ids(filterSet("paternal", "Me", fam, byId)), ["Dad", "G1", "G2", "Me"]);
  assert.deepEqual(ids(filterSet("maternal", "Me", fam, byId)), ["G3", "Me", "Mum"]);
  // Kid's only recorded parent (Me) has no gender: no side can be chosen, so only Kid is kept.
  assert.deepEqual(ids(filterSet("paternal", "Kid", fam, byId)), ["Kid"]);
});
