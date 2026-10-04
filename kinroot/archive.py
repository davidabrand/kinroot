"""Archive pages for one tree: People, Relationships and Timeline.

Read-only views over data Kinroot already has. They reuse the tree API's pieces:
`require_role` for access, `person_payload` for privacy (view-only guests never see a
living relative's dates or places), and `FamilyGraph` for naming relationships.
"""
from flask import Blueprint, render_template, request

from .access import require_role
from .auth import current_user, login_required
from .db import get_db
from .relationships import FamilyGraph
from .trees import person_payload

bp = Blueprint("archive", __name__)

MAX_RELATION_LOOKUPS = 400   # naming everyone's relationship to you is fine for family-sized trees


def _load(tree_id):
    """The tree, your role, its people (privacy applied) and the family graph."""
    tree, role = require_role(tree_id, "viewer")
    db = get_db()
    me = current_user()["id"]
    rows = db.execute("SELECT * FROM people WHERE tree_id = ? ORDER BY first_name, last_name", (tree_id,)).fetchall()
    rels = db.execute("SELECT id, person_a, person_b, kind FROM relationships WHERE tree_id = ?", (tree_id,)).fetchall()
    people = [person_payload(p, tree, role, me, {}, {}) for p in rows]
    graph = FamilyGraph([{"id": p["id"], "first_name": p["first_name"], "gender": p["gender"]} for p in rows], rels)
    my_leaf = next((p["id"] for p in rows if p["user_id"] == me), None)
    return tree, role, people, graph, my_leaf


@bp.route("/trees/<int:tree_id>/people")
@login_required
def people(tree_id):
    tree, role, people, graph, my_leaf = _load(tree_id)
    relation = {}
    if my_leaf and len(people) <= MAX_RELATION_LOOKUPS:
        for p in people:
            if p["id"] == my_leaf:
                relation[p["id"]] = "You"
            else:
                found = graph.describe(my_leaf, p["id"])
                if found and found.get("term"):
                    relation[p["id"]] = f"Your {found['term']}"
    view = "list" if request.args.get("view") == "list" else "portraits"
    return render_template("people.html", tree=tree, role=role, people=people, relation=relation, view=view)


@bp.route("/trees/<int:tree_id>/relationships")
@login_required
def relationships(tree_id):
    tree, role, people, graph, my_leaf = _load(tree_id)
    by_id = {p["id"]: p for p in people}
    a = request.args.get("a", type=int) or my_leaf
    b = request.args.get("b", type=int)
    result = None
    if a in by_id and b in by_id and a != b:
        found = graph.describe(a, b)
        if found:
            chain = [by_id[i] for i in found["path"] if i in by_id]
            result = {"term": found["term"], "sentence": found["sentence"], "chain": chain}
        else:
            result = {"term": None, "chain": [],
                      "sentence": f"{by_id[b]['first_name']} and {by_id[a]['first_name']} aren't connected on this tree yet."}
    return render_template("relationships.html", tree=tree, role=role, people=people, a=a, b=b, result=result)


@bp.route("/trees/<int:tree_id>/timeline")
@login_required
def timeline(tree_id):
    tree, role, people, graph, my_leaf = _load(tree_id)
    events = []
    for p in people:
        if p["birth_year"]:
            events.append({"year": p["birth_year"], "kind": "born", "person": p, "when": p["birth_display"]})
        if p["death_year"]:
            events.append({"year": p["death_year"], "kind": "died", "person": p, "when": p["death_display"]})
    events.sort(key=lambda e: (e["year"], e["kind"] != "born", e["person"]["first_name"]))
    decades = []
    for e in events:
        decade = e["year"] // 10 * 10
        if not decades or decades[-1]["decade"] != decade:
            decades.append({"decade": decade, "events": []})
        decades[-1]["events"].append(e)
    undated = sum(1 for p in people if not p["birth_year"])
    return render_template("timeline.html", tree=tree, role=role, decades=decades, undated=undated, total=len(people))
