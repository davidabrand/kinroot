"""Work out how two people in a tree are related ("How are we related?").

The idea: walk up from both people to find their closest shared ancestor,
count the generations on each side, and name the result — sibling, aunt,
second cousin once removed, and so on. If there's no shared ancestor we try
marriage links (in-laws, step-family, "partner of your cousin").
"""
from collections import defaultdict, deque

ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth",
                 "sixth", "seventh", "eighth", "ninth", "tenth"]


def ordinal_word(n):
    return ORDINAL_WORDS[n] if n < len(ORDINAL_WORDS) else ordinal(n)


def ordinal(n):
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def greats(n):
    """Prefix for n 'great's: great-, great-great-, then 3rd great-, 4th great- ..."""
    if n <= 0:
        return ""
    if n == 1:
        return "great-"
    if n == 2:
        return "great-great-"
    return f"{ordinal(n)} great-"


def gender_of(person):
    g = (person.get("gender") or "").strip().lower()
    if g in ("m", "male", "man", "boy", "he", "him") or g.startswith("male"):
        return "m"
    if g in ("f", "female", "woman", "girl", "she", "her") or g.startswith("female"):
        return "f"
    return None


def pick(g, male, female, neutral):
    return male if g == "m" else female if g == "f" else neutral


def blood_term(up_a, up_b, g, half=False):
    """Name for B when A is up_a generations and B is up_b generations below their shared ancestor."""
    if up_a == 0 and up_b == 0:
        return "same person"
    if up_b == 0:  # B is A's ancestor
        if up_a == 1:
            return pick(g, "father", "mother", "parent")
        return greats(up_a - 2) + pick(g, "grandfather", "grandmother", "grandparent")
    if up_a == 0:  # B is A's descendant
        if up_b == 1:
            return pick(g, "son", "daughter", "child")
        return greats(up_b - 2) + pick(g, "grandson", "granddaughter", "grandchild")
    if up_a == 1 and up_b == 1:
        word = pick(g, "brother", "sister", "sibling")
        return f"half-{word}" if half else word
    if up_b == 1:  # B is a sibling of A's ancestor
        return greats(up_a - 2) + pick(g, "uncle", "aunt", "aunt or uncle")
    if up_a == 1:  # B descends from A's sibling
        return greats(up_b - 2) + pick(g, "nephew", "niece", "niece or nephew")
    degree = min(up_a, up_b) - 1
    removed = abs(up_a - up_b)
    term = f"{ordinal_word(degree)} cousin"
    if removed:
        term += " " + {1: "once", 2: "twice"}.get(removed, f"{removed} times") + " removed"
    return term


class FamilyGraph:
    def __init__(self, people, relationships):
        self.people = {p["id"]: dict(p) for p in people}
        self.parents = defaultdict(set)
        self.children = defaultdict(set)
        self.spouses = defaultdict(set)
        for r in relationships:
            a, b = r["person_a"], r["person_b"]
            if a not in self.people or b not in self.people:
                continue
            if r["kind"] == "parent":
                self.parents[b].add(a)
                self.children[a].add(b)
            else:
                self.spouses[a].add(b)
                self.spouses[b].add(a)

    def name(self, pid):
        p = self.people[pid]
        return (p.get("first_name") or "Someone").strip()

    def _ancestors(self, pid):
        """{ancestor_id: (generations_up, next_id_toward_pid)}, including pid itself at 0."""
        found = {pid: (0, None)}
        queue = deque([pid])
        while queue:
            cur = queue.popleft()
            dist = found[cur][0]
            for par in sorted(self.parents[cur]):
                if par not in found:
                    found[par] = (dist + 1, cur)
                    queue.append(par)
        return found

    @staticmethod
    def _chain(found, top):
        """Path from the starting person up to `top`, e.g. [me, dad, grandpa]."""
        chain = [top]
        while found[chain[-1]][1] is not None:
            chain.append(found[chain[-1]][1])
        return list(reversed(chain))

    def blood(self, a, b):
        """Closest blood relation as (term, path) or None."""
        up_a, up_b = self._ancestors(a), self._ancestors(b)
        shared = set(up_a) & set(up_b)
        if not shared:
            return None
        best = min(shared, key=lambda c: (up_a[c][0] + up_b[c][0], max(up_a[c][0], up_b[c][0]), c))
        da, db = up_a[best][0], up_b[best][0]
        half = False
        if da == 1 and db == 1:
            common = self.parents[a] & self.parents[b]
            half = len(common) == 1 and len(self.parents[a]) >= 2 and len(self.parents[b]) >= 2
        term = blood_term(da, db, gender_of(self.people[b]), half)
        path = self._chain(up_a, best) + list(reversed(self._chain(up_b, best)))[1:]
        return term, path

    def describe(self, a, b):
        """What is B to A? Returns {"term", "sentence", "path"} or None if unrelated here."""
        if a not in self.people or b not in self.people:
            return None
        if a == b:
            return {"term": "same person", "sentence": "That's the same person.", "path": [a]}
        name_a, name_b = self.name(a), self.name(b)
        g_b = gender_of(self.people[b])

        def result(term, path):
            return {"term": term, "sentence": f"{name_b} is {name_a}'s {term}.", "path": path}

        found = self.blood(a, b)
        if found:
            return result(*found)

        if b in self.spouses[a]:
            return result(pick(g_b, "husband", "wife", "partner"), [a, b])

        # Step-family: B is the partner of A's parent, or the child of A's partner.
        for parent in sorted(self.parents[a]):
            if b in self.spouses[parent]:
                return result(pick(g_b, "stepfather", "stepmother", "step-parent"), [a, parent, b])
        for partner in sorted(self.spouses[a]):
            if b in self.children[partner]:
                return result(pick(g_b, "stepson", "stepdaughter", "stepchild"), [a, partner, b])

        # In-laws through A's partner: B is a blood relative of A's partner.
        for partner in sorted(self.spouses[a]):
            rel = self.blood(partner, b)
            if rel:
                term, path = rel
                special = {"father": "father-in-law", "mother": "mother-in-law", "parent": "parent-in-law",
                           "brother": "brother-in-law", "sister": "sister-in-law", "sibling": "sibling-in-law"}
                if term in special:
                    return result(special[term], [a] + path)
                if term.endswith(("nephew", "niece", "niece or nephew", "uncle", "aunt", "aunt or uncle")):
                    return result(term + " by marriage", [a] + path)
                partner_word = pick(gender_of(self.people[partner]), "husband", "wife", "partner")
                return {"term": f"{partner_word}'s {term}",
                        "sentence": f"{name_b} is {name_a}'s {partner_word}'s {term}.",
                        "path": [a] + path}

        # In-laws through B's partner: B is married to A's blood relative.
        for partner in sorted(self.spouses[b]):
            rel = self.blood(a, partner)
            if rel:
                term, path = rel
                if term in ("son", "daughter", "child"):
                    return result(pick(g_b, "son-in-law", "daughter-in-law", "child-in-law"), path + [b])
                if term in ("brother", "sister", "sibling", "half-brother", "half-sister", "half-sibling"):
                    return result(pick(g_b, "brother-in-law", "sister-in-law", "sibling-in-law"), path + [b])
                for word in ("aunt or uncle", "uncle", "aunt"):
                    if term.endswith(word):
                        prefix = term[: -len(word)]
                        return result(prefix + pick(g_b, "uncle", "aunt", "aunt or uncle") + " by marriage", path + [b])
                for word in ("niece or nephew", "nephew", "niece"):
                    if term.endswith(word):
                        prefix = term[: -len(word)]
                        return result(prefix + pick(g_b, "nephew", "niece", "niece or nephew") + " by marriage", path + [b])
                partner_word = pick(g_b, "husband", "wife", "partner")
                return {"term": f"{partner_word} of {name_a}'s {term}",
                        "sentence": f"{name_b} is the {partner_word} of {name_a}'s {term}.",
                        "path": path + [b]}

        path = self.any_path(a, b)
        if path:
            return {"term": "family by marriage",
                    "sentence": f"{name_b} and {name_a} are connected through marriage, {len(path) - 1} steps apart.",
                    "path": path}
        return None

    def any_path(self, a, b):
        """Shortest path through any parent/child/partner links, or None."""
        prev = {a: None}
        queue = deque([a])
        while queue:
            cur = queue.popleft()
            if cur == b:
                path = [b]
                while prev[path[-1]] is not None:
                    path.append(prev[path[-1]])
                return list(reversed(path))
            for nxt in sorted(self.parents[cur] | self.children[cur] | self.spouses[cur]):
                if nxt not in prev:
                    prev[nxt] = cur
                    queue.append(nxt)
        return None


def generations(people_ids, relationships):
    """{person_id: generation} with the oldest generation at 0 (same rules as the 3D layout)."""
    gen = {pid: 0 for pid in people_ids}
    rels = [r for r in relationships if r["person_a"] in gen and r["person_b"] in gen]
    for _ in range(len(gen) + 2):
        changed = False
        for r in rels:
            a, b = r["person_a"], r["person_b"]
            if r["kind"] == "parent":
                if gen[b] < gen[a] + 1:
                    gen[b] = gen[a] + 1
                    changed = True
            else:
                top = max(gen[a], gen[b])
                if gen[a] != top or gen[b] != top:
                    gen[a] = gen[b] = top
                    changed = True
        if not changed:
            break
    return gen
