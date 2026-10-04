// Branch filters for the tree: which people to keep lit around one person.
// Pure functions over the family index from layout.js (parents/children/spouses maps), so they're
// testable in Node and know nothing about rendering.

export const FILTERS = {
  all: "Everyone",
  immediate: "Immediate family",
  ancestors: "Ancestors",
  descendants: "Descendants",
  paternal: "Father's side",
  maternal: "Mother's side",
};

const genderOf = (p) => {
  const g = (p?.gender || "").trim().toLowerCase();
  if (g.startsWith("m") || g === "he") return "m";
  if (g.startsWith("f") || g === "she") return "f";
  return null;
};

// Everyone reachable by following `next` (parents or children) from the start people.
function walk(starts, next) {
  const found = new Set(starts);
  const stack = [...starts];
  while (stack.length) {
    for (const n of next.get(stack.pop()) || []) if (!found.has(n)) { found.add(n); stack.push(n); }
  }
  return found;
}

// Partners of the people kept, so couples stay together on screen.
function withPartners(set, fam) {
  for (const n of [...set]) for (const s of fam.spouses.get(n) || []) set.add(s);
  return set;
}

/**
 * The people to keep for a filter, centred on `id`. Returns null for "everyone".
 * A side (paternal/maternal) needs a parent whose gender is recorded; if none is known,
 * it returns just the person, so nothing is guessed.
 */
export function filterSet(mode, id, fam, byId) {
  if (!mode || mode === "all" || id == null) return null;
  const parents = fam.parents.get(id) || [];
  switch (mode) {
    case "immediate":
      return new Set([id, ...parents, ...(fam.children.get(id) || []), ...(fam.spouses.get(id) || []),
        ...parents.flatMap((p) => fam.children.get(p) || [])]);
    case "ancestors":
      return withPartners(walk([id], fam.parents), fam);
    case "descendants":
      return withPartners(walk([id], fam.children), fam);
    case "paternal":
    case "maternal": {
      const want = mode === "paternal" ? "m" : "f";
      const side = parents.filter((p) => genderOf(byId.get(p)) === want);
      const set = withPartners(walk(side, fam.parents), fam);
      set.add(id);
      return set;
    }
    default:
      return null;
  }
}
