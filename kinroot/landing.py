"""The fictional Hale–Cole family drawn on the homepage.

One small, invented family (no real people) shown as a living tree behind the
homepage story. It's plain data plus the SVG geometry for it, rendered by
templates/partials/landing_tree.svg. tests/test_landing.py checks it against
Kinroot's own relationship engine, so what the homepage claims ("second cousin
once removed") is what the product would actually say.

Coordinates live in a 1300 x 1000 drawing whose trunk stands at x = 655.
"""

# id, initials, first name, surname, born, died (None = living), x, y, generation, gender
PEOPLE = [
    (1, "AH", "Arthur", "Hale", 1898, 1971, 610, 800, 0, "male"),
    (2, "RH", "Rose", "Hale", 1902, 1988, 700, 800, 0, "female"),
    (3, "TH", "Thomas", "Hale", 1926, 2004, 470, 640, 1, "male"),
    (4, "MC", "Margaret", "Cole", 1931, 2015, 845, 630, 1, "female"),
    (5, "PH", "Peter", "Hale", 1955, None, 350, 480, 2, "male"),
    (6, "AW", "Anna", "Ward", 1958, None, 560, 470, 2, "female"),
    (7, "SC", "Samuel", "Cole", 1957, None, 770, 465, 2, "male"),
    (8, "DC", "Daniel", "Cole", 1960, None, 950, 480, 2, "male"),
    (9, "YOU", "You", "", 1986, None, 300, 320, 3, ""),
    (10, "NW", "Nora", "Ward", 1984, None, 585, 305, 3, "female"),
    (11, "LC", "Leo", "Cole", 1989, None, 745, 300, 3, "male"),
    (12, "MC", "Mila", "Cole", 1983, None, 1010, 320, 3, "female"),
    (13, "IW", "Ivy", "Ward", 2012, None, 520, 150, 4, "female"),
    (14, "EC", "Elena", "Cole", 2013, None, 1080, 160, 4, "female"),
    # Joins the tree only in the "Family isn't built alone" moment.
    (15, "TC", "Theo", "Cole", 2021, None, 790, 140, 4, "male"),
]

COUPLE = (1, 2)
CHILDREN = {COUPLE: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9], 6: [10], 7: [11], 8: [12], 10: [13], 12: [14], 11: [15]}
YOU, ELENA = 9, 14
NEW_ARRIVAL = 15

MEDALLION_R = 26


def _people():
    keys = ("id", "initials", "first", "last", "born", "died", "x", "y", "gen", "gender")
    return {row[0]: dict(zip(keys, row)) for row in PEOPLE}


def _curve(x1, y1, x2, y2):
    """A soft S-curve rising from (x1, y1) to (x2, y2), like a lineage line."""
    mid = (y1 + y2) / 2
    return f"M{x1:.0f} {y1:.0f} C{x1:.0f} {mid:.0f}, {x2:.0f} {mid:.0f}, {x2:.0f} {y2:.0f}"


def _smooth(points):
    """A smooth path through points (Catmull-Rom turned into cubic Béziers)."""
    d = f"M{points[0][0]:.0f} {points[0][1]:.0f}"
    for i in range(len(points) - 1):
        p0 = points[max(i - 1, 0)]
        p1, p2 = points[i], points[i + 1]
        p3 = points[min(i + 2, len(points) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.0f} {c1[1]:.0f}, {c2[0]:.0f} {c2[1]:.0f}, {p2[0]:.0f} {p2[1]:.0f}"
    return d


def relationships():
    """The family as Kinroot stores it: parent links and the one couple."""
    rels = [{"person_a": COUPLE[0], "person_b": COUPLE[1], "kind": "spouse"}]
    for parent, kids in CHILDREN.items():
        for parent_id in (parent if isinstance(parent, tuple) else (parent,)):
            rels += [{"person_a": parent_id, "person_b": kid, "kind": "parent"} for kid in kids]
    return rels


# The route Kinroot's relationship finder returns from You to Elena.
RELATION_PATH = [9, 5, 3, 1, 4, 8, 12, 14]
RELATION_TERM = "second cousin once removed"


def scene():
    """Everything the homepage tree template needs, in drawing order."""
    people = _people()
    r = MEDALLION_R
    lines = []
    for parent, kids in CHILDREN.items():
        if isinstance(parent, tuple):
            a, b = people[parent[0]], people[parent[1]]
            px, py = (a["x"] + b["x"]) / 2, a["y"] - 6
            gen = 0
        else:
            px, py, gen = people[parent]["x"], people[parent]["y"] - r, people[parent]["gen"]
        for kid in kids:
            k = people[kid]
            lines.append({"d": _curve(px, py, k["x"], k["y"] + r), "to": kid, "gen": k["gen"],
                          "born": k["born"], "new": kid == NEW_ARRIVAL, "parent_gen": gen})
    a, b = people[COUPLE[0]], people[COUPLE[1]]
    route = [(people[i]["x"], people[i]["y"]) for i in RELATION_PATH]
    return {
        "people": list(people.values()),
        "lines": lines,
        "couple_line": f"M{a['x'] + r:.0f} {a['y']:.0f} L{b['x'] - r:.0f} {b['y']:.0f}",
        "relation_path": _smooth(route),
        "relation_ids": RELATION_PATH,
        "trunk_x": (a["x"] + b["x"]) / 2,
        "r": r,
        "you": YOU,
        "elena": ELENA,
        "new_arrival": NEW_ARRIVAL,
    }
