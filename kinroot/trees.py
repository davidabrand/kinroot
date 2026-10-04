"""Family trees: dashboard, the 3D tree page, sharing and invite links,
GEDCOM import/export, and the JSON API the 3D view talks to."""
import os
import secrets
import uuid
from datetime import date, datetime, timedelta

from flask import (Blueprint, Response, abort, current_app, flash, jsonify, redirect, render_template,
                   request, send_from_directory, url_for)

from . import gedcom
from .access import ROLE_LABEL, ROLE_RANK, can, require_role, tree_role
from .auth import current_user, login_required
from .checks import find_issues
from .dates import DateError, format_date, month_day, parse_date, utc_now, year_of
from .db import get_db
from .family import connection_states, counts as family_counts
from .privacy import is_living, viewer_must_hide
from .relationships import FamilyGraph, generations

bp = Blueprint("trees", __name__)

PHOTO_SIGNATURES = {b"\x89PNG": "png", b"\xff\xd8\xff": "jpg", b"GIF8": "gif", b"RIFF": "webp"}
TEXT_LIMITS = {"first_name": 100, "last_name": 100, "gender": 30, "birth_place": 200, "notes": 5000}
INVITE_DAYS = 30
MAX_IMPORT_PEOPLE = 25000


# ------------------------------------------------------------------ helpers

def person_in_tree(person_id, tree_id):
    row = get_db().execute("SELECT * FROM people WHERE id = ? AND tree_id = ?", (person_id, tree_id)).fetchone()
    if row is None:
        abort(404)
    return row


def clean_person(data, partial=False):
    """Validate person fields from a form/JSON. Returns (fields, error_message)."""
    fields = {}
    for key, limit in TEXT_LIMITS.items():
        if key in data or not partial:
            fields[key] = str(data.get(key, "") or "").strip()[:limit]
    if "first_name" in fields and not fields["first_name"]:
        return None, "A first name is required."
    for key, label in (("birth_date", "Born"), ("death_date", "Died")):
        if key in data or not partial:
            try:
                fields[key] = parse_date(str(data.get(key, "") or ""))
            except DateError as e:
                return None, f"{label}: {e}"
    if "deceased" in data or not partial:
        fields["deceased"] = 1 if data.get("deceased") in (True, 1, "1", "true", "on", "yes") else 0
    if "birth_date" in fields:
        fields["birth_year"] = year_of(fields["birth_date"])
    if "death_date" in fields:
        fields["death_year"] = year_of(fields["death_date"])
        if fields["death_date"]:
            fields["deceased"] = 1
    birth, death = fields.get("birth_year"), fields.get("death_year")
    if birth and death and death < birth:
        return None, "The death date is before the birth date."
    return fields, None


def person_payload(p, tree, role, me, states, accounts, issues=None):
    hide = viewer_must_hide(tree, role, p)
    d = {
        "id": p["id"], "first_name": p["first_name"], "last_name": p["last_name"], "gender": p["gender"],
        "birth_date": "" if hide else p["birth_date"], "death_date": "" if hide else p["death_date"],
        "birth_place": "" if hide else p["birth_place"], "notes": "" if hide else p["notes"],
        "birth_year": None if hide else p["birth_year"], "death_year": None if hide else p["death_year"],
        "deceased": bool(p["deceased"] or p["death_date"]),
        "living": is_living(p), "private": hide,
        "photo_url": url_for("trees.photo", filename=p["photo"]) if p["photo"] else "",
        "account": None,
        "issues": issues or [],
    }
    d["birth_display"] = format_date(d["birth_date"])
    d["death_display"] = format_date(d["death_date"])
    if p["user_id"] and p["user_id"] in accounts:
        other = p["user_id"]
        st = states.get(other, {"state": "none", "id": None})
        d["account"] = {"id": other, "name": accounts[other], "is_me": other == me,
                        "connection": "self" if other == me else st["state"], "connection_id": st["id"]}
    return d


def add_relationship(db, tree_id, person, other, as_what):
    """Record that `person` is the `as_what` (parent/child/spouse) of `other`. Returns an error or None."""
    if person == other:
        return "Someone can't be related to themselves."
    if as_what == "parent":
        a, b, kind = person, other, "parent"
    elif as_what == "child":
        a, b, kind = other, person, "parent"
    elif as_what == "spouse":
        a, b, kind = min(person, other), max(person, other), "spouse"
    else:
        return "Choose parent, child or partner."
    if kind == "parent":
        if is_ancestor(db, b, a):
            return "That would make someone their own ancestor."
        if db.execute("SELECT 1 FROM relationships WHERE kind = 'spouse' AND person_a = ? AND person_b = ?",
                      (min(a, b), max(a, b))).fetchone():
            return "They're already linked as partners."
        count = db.execute("SELECT COUNT(*) FROM relationships WHERE person_b = ? AND kind = 'parent' AND person_a != ?",
                           (b, a)).fetchone()[0]
        if count >= 2:
            return "That person already has two parents."
    else:
        if db.execute("SELECT 1 FROM relationships WHERE kind = 'parent' AND "
                      "((person_a = ? AND person_b = ?) OR (person_a = ? AND person_b = ?))", (a, b, b, a)).fetchone():
            return "A parent and child can't also be partners."
    db.execute("INSERT OR IGNORE INTO relationships (tree_id, person_a, person_b, kind) VALUES (?, ?, ?, ?)",
               (tree_id, a, b, kind))
    return None


def is_ancestor(db, maybe_ancestor, person):
    seen, stack = set(), [person]
    while stack:
        cur = stack.pop()
        if cur == maybe_ancestor:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack += [r[0] for r in db.execute(
            "SELECT person_a FROM relationships WHERE person_b = ? AND kind = 'parent'", (cur,))]
    return False


def remove_photo_file(filename):
    if filename:
        try:
            os.remove(os.path.join(current_app.config["UPLOAD_DIR"], filename))
        except OSError:
            pass


def tree_shape(db, tree_id):
    """People per generation, oldest first — drawn as the little tree on each dashboard card."""
    ids = [r[0] for r in db.execute("SELECT id FROM people WHERE tree_id = ?", (tree_id,))]
    if not ids:
        return []
    rels = db.execute("SELECT person_a, person_b, kind FROM relationships WHERE tree_id = ?", (tree_id,)).fetchall()
    gens = generations(ids, rels)
    counts = [0] * (max(gens.values()) + 1)
    for g in gens.values():
        counts[g] += 1
    return counts[:8]


def upcoming_dates(db, user_id, days=30, today=None):
    """Birthdays (and remembrance days for relatives who've passed) in the next few weeks."""
    today = today or date.today()
    rows = db.execute("""
        SELECT p.*, t.name AS tree_name, t.hide_living, m.role, t.id AS tid FROM people p
        JOIN tree_members m ON m.tree_id = p.tree_id AND m.user_id = ?
        JOIN trees t ON t.id = p.tree_id
        WHERE p.birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'""", (user_id,)).fetchall()
    seen, events = set(), []
    for p in rows:
        md = month_day(p["birth_date"])
        if not md or viewer_must_hide(p, p["role"], p, today):
            continue
        key = (p["first_name"].lower(), p["last_name"].lower(), p["birth_date"])
        if key in seen:
            continue
        seen.add(key)
        month, day = md
        for year in (today.year, today.year + 1):
            try:
                when = date(year, month, day)
            except ValueError:          # 29 February in a non-leap year
                when = date(year, 2, 28)
            if when >= today:
                break
        until = (when - today).days
        if until > days:
            continue
        age = when.year - p["birth_year"]
        living = is_living(p, today)
        if not living and age > 125:
            continue
        events.append({"person": p, "date": when, "days": until, "age": age, "living": living,
                       "tree_id": p["tid"], "tree_name": p["tree_name"]})
    events.sort(key=lambda e: (e["days"], e["person"]["first_name"]))
    return events[:6]


def greeting():
    hour = datetime.now().hour
    return "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"


def valid_invite(token):
    inv = get_db().execute("""
        SELECT i.*, t.name AS tree_name, u.name AS inviter_name,
               p.first_name AS person_first, p.last_name AS person_last, p.user_id AS person_user
        FROM invites i JOIN trees t ON t.id = i.tree_id JOIN users u ON u.id = i.created_by
        LEFT JOIN people p ON p.id = i.person_id WHERE i.token = ?""", (token,)).fetchone()
    if not inv or inv["revoked"]:
        return None
    if utc_now().strftime("%Y-%m-%d %H:%M:%S") > inv["expires_at"]:
        return None
    if inv["max_uses"] is not None and inv["uses"] >= inv["max_uses"]:
        return None
    return inv


def claim_person(db, tree_id, person_id, user_id):
    """Link a person on the tree to an account. Returns an error or None."""
    person = db.execute("SELECT * FROM people WHERE id = ? AND tree_id = ?", (person_id, tree_id)).fetchone()
    if not person:
        return "That person isn't on this tree."
    if person["user_id"] and person["user_id"] != user_id:
        return "Someone else has already claimed this leaf."
    if db.execute("SELECT 1 FROM people WHERE tree_id = ? AND user_id = ? AND id != ?",
                  (tree_id, user_id, person_id)).fetchone():
        return "You've already claimed a different leaf on this tree."
    db.execute("UPDATE people SET user_id = ? WHERE id = ?", (user_id, person_id))
    return None


# ------------------------------------------------------------------ pages

@bp.route("/trees")
@login_required
def dashboard():
    db = get_db()
    me = current_user()
    trees = db.execute("""
        SELECT t.*, m.role, u.name AS owner_name,
               (SELECT COUNT(*) FROM people p WHERE p.tree_id = t.id) AS people_count
        FROM trees t JOIN tree_members m ON m.tree_id = t.id AND m.user_id = ?
        JOIN users u ON u.id = t.owner_id ORDER BY t.created_at DESC, t.id DESC""", (me["id"],)).fetchall()
    cards = [{"tree": t, "shape": tree_shape(db, t["id"])} for t in trees]
    return render_template("dashboard.html", cards=cards, upcoming=upcoming_dates(db, me["id"]),
                           family=family_counts(me["id"]), greeting=greeting(), role_label=ROLE_LABEL)


@bp.route("/trees/new", methods=["POST"])
@login_required
def new_tree():
    name = request.form.get("name", "").strip()[:120] or "My family"
    tree_id = create_tree(name, current_user()["id"])
    get_db().commit()
    return redirect(url_for("trees.tree_view", tree_id=tree_id))


def create_tree(name, owner_id):
    db = get_db()
    cur = db.execute("INSERT INTO trees (name, owner_id) VALUES (?, ?)", (name, owner_id))
    db.execute("INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, 'owner')", (cur.lastrowid, owner_id))
    return cur.lastrowid


@bp.route("/trees/import", methods=["POST"])
@login_required
def import_tree():
    file = request.files.get("gedcom")
    if not file or not file.filename:
        flash("Choose a GEDCOM file (it usually ends in .ged).", "error")
        return redirect(url_for("trees.dashboard"))
    try:
        parsed = gedcom.parse(file.read())
    except gedcom.GedcomError as e:
        flash(str(e), "error")
        return redirect(url_for("trees.dashboard"))
    except Exception:  # a damaged or unusual file shouldn't crash the page
        current_app.logger.exception("GEDCOM import failed")
        flash("Kinroot couldn't read that file. Try exporting it again from the other site.", "error")
        return redirect(url_for("trees.dashboard"))
    people = parsed["people"]
    if not people:
        flash("That file doesn't have any people in it.", "error")
        return redirect(url_for("trees.dashboard"))
    if len(people) > MAX_IMPORT_PEOPLE:
        flash(f"That file has {len(people):,} people. Kinroot can import up to {MAX_IMPORT_PEOPLE:,} at once.", "error")
        return redirect(url_for("trees.dashboard"))

    db = get_db()
    default_name = os.path.splitext(os.path.basename(file.filename))[0].replace("_", " ").strip()
    name = request.form.get("name", "").strip()[:120] or default_name or "Imported family"
    tree_id = create_tree(name, current_user()["id"])
    ids = {}
    for p in people:
        cur = db.execute("""INSERT INTO people (tree_id, first_name, last_name, gender, birth_date, birth_place,
                            death_date, notes, deceased, birth_year, death_year)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                         (tree_id, p["first_name"], p["last_name"], p["gender"], p["birth_date"], p["birth_place"],
                          p["death_date"], p["notes"], p["deceased"], year_of(p["birth_date"]), year_of(p["death_date"])))
        if p["ref"]:
            ids[p["ref"]] = cur.lastrowid
    parent_count, skipped = {}, 0
    for fam in parsed["families"]:
        parents = [ids[r] for r in fam["parents"] if r in ids]
        if len(parents) == 2:
            a, b = sorted(parents)
            db.execute("INSERT OR IGNORE INTO relationships (tree_id, person_a, person_b, kind) VALUES (?, ?, ?, 'spouse')",
                       (tree_id, a, b))
        for ref in fam["children"]:
            child = ids.get(ref)
            if child is None:
                continue
            for par in parents:
                if par == child:
                    continue
                if parent_count.get(child, 0) >= 2:
                    skipped += 1
                    continue
                cur = db.execute("INSERT OR IGNORE INTO relationships (tree_id, person_a, person_b, kind) "
                                 "VALUES (?, ?, ?, 'parent')", (tree_id, par, child))
                if cur.rowcount:
                    parent_count[child] = parent_count.get(child, 0) + 1
    db.commit()
    msg = f"Imported {len(people):,} people into “{name}”."
    if skipped:
        msg += f" {skipped} extra parent links (like adoptive families) were skipped, since Kinroot allows two parents per person."
    flash(msg, "success")
    return redirect(url_for("trees.tree_view", tree_id=tree_id))


@bp.route("/trees/<int:tree_id>")
@login_required
def tree_view(tree_id):
    tree, role = require_role(tree_id, "viewer")
    return render_template("tree.html", tree=tree, role=role)


@bp.route("/trees/<int:tree_id>/export.ged")
@login_required
def export_gedcom(tree_id):
    tree, _role = require_role(tree_id, "editor")
    db = get_db()
    people = db.execute("SELECT * FROM people WHERE tree_id = ? ORDER BY id", (tree_id,)).fetchall()
    rels = db.execute("SELECT * FROM relationships WHERE tree_id = ?", (tree_id,)).fetchall()
    text = gedcom.export(tree["name"], people, rels)
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in tree["name"]).strip().replace(" ", "_") or "family"
    return Response(text, mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.ged"'})


@bp.route("/trees/<int:tree_id>/share", methods=["GET", "POST"])
@login_required
def share(tree_id):
    tree, role = require_role(tree_id, "owner")
    db = get_db()
    me = current_user()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "create_invite":
            inv_role = request.form.get("role", "viewer")
            person_id = request.form.get("person_id", type=int)
            if inv_role not in ("viewer", "editor"):
                inv_role = "viewer"
            if person_id:
                person = person_in_tree(person_id, tree_id)
                if person["user_id"]:
                    flash(f"{person['first_name']} has already claimed their leaf.", "error")
                    return redirect(url_for("trees.share", tree_id=tree_id))
            expires = (utc_now() + timedelta(days=INVITE_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
            cur = db.execute("""INSERT INTO invites (tree_id, token, role, person_id, created_by, expires_at, max_uses)
                                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                             (tree_id, secrets.token_urlsafe(18), inv_role, person_id, me["id"], expires,
                              1 if person_id else None))
            db.commit()
            flash("Invite link ready. Copy it and send it however your family talks: text, email, WhatsApp.", "success")
            # Land right on the new link (highlighted, Copy focused) instead of making the owner hunt for it.
            return redirect(url_for("trees.share", tree_id=tree_id, _anchor=f"invite-row-{cur.lastrowid}"))
        elif action == "revoke_invite":
            db.execute("UPDATE invites SET revoked = 1 WHERE id = ? AND tree_id = ?",
                       (request.form.get("invite_id", type=int), tree_id))
            db.commit()
            flash("Invite link turned off. Anyone who has it can no longer join.", "success")
        elif action == "add_member":
            email = request.form.get("email", "").strip().lower()
            new_role = request.form.get("role", "viewer")
            user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if new_role not in ("viewer", "editor"):
                flash("Pick “Can view” or “Can edit”.", "error")
            elif user is None:
                flash(f"No Kinroot account uses {email} yet. Send them an invite link instead.", "error")
            elif user["id"] == me["id"]:
                flash("You already own this tree.", "error")
            else:
                db.execute("""INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, ?)
                              ON CONFLICT(tree_id, user_id) DO UPDATE SET role = excluded.role
                              WHERE tree_members.role != 'owner'""", (tree_id, user["id"], new_role))
                db.commit()
                flash(f"Shared with {email}.", "success")
        elif action == "set_role":
            new_role = request.form.get("role")
            if new_role in ("viewer", "editor"):
                db.execute("UPDATE tree_members SET role = ? WHERE tree_id = ? AND user_id = ? AND role != 'owner'",
                           (new_role, tree_id, request.form.get("user_id", type=int)))
                db.commit()
                flash("Access updated.", "success")
        elif action == "remove_member":
            uid = request.form.get("user_id", type=int)
            db.execute("DELETE FROM tree_members WHERE tree_id = ? AND user_id = ? AND role != 'owner'", (tree_id, uid))
            db.execute("UPDATE people SET user_id = NULL WHERE tree_id = ? AND user_id = ?", (tree_id, uid))
            db.commit()
            flash("Access removed.", "success")
        elif action == "rename":
            name = request.form.get("name", "").strip()[:120]
            if name:
                db.execute("UPDATE trees SET name = ? WHERE id = ?", (name, tree_id))
                db.commit()
                flash("Tree renamed.", "success")
        elif action == "privacy":
            db.execute("UPDATE trees SET hide_living = ?, discoverable = ? WHERE id = ?",
                       (1 if request.form.get("hide_living") else 0, 1 if request.form.get("discoverable") else 0,
                        tree_id))
            db.commit()
            flash("Privacy settings saved.", "success")
        elif action == "delete":
            if request.form.get("confirm", "").strip() != tree["name"]:
                flash(f"Nothing was deleted: the name didn't match. Type “{tree['name']}” exactly to confirm.", "error")
            else:
                for row in db.execute("SELECT photo FROM people WHERE tree_id = ? AND photo != ''", (tree_id,)).fetchall():
                    remove_photo_file(row["photo"])
                db.execute("DELETE FROM trees WHERE id = ?", (tree_id,))
                db.commit()
                flash(f"“{tree['name']}” was deleted.", "success")
                return redirect(url_for("trees.dashboard"))
        return redirect(url_for("trees.share", tree_id=tree_id))

    members = db.execute("""
        SELECT u.id, u.name, u.email, m.role,
               (SELECT first_name || ' ' || last_name FROM people p WHERE p.tree_id = m.tree_id AND p.user_id = u.id) AS leaf
        FROM tree_members m JOIN users u ON u.id = m.user_id WHERE m.tree_id = ?
        ORDER BY m.role = 'owner' DESC, u.name""", (tree_id,)).fetchall()
    invites = db.execute("""
        SELECT i.*, p.first_name AS person_first FROM invites i LEFT JOIN people p ON p.id = i.person_id
        WHERE i.tree_id = ? AND i.revoked = 0 AND i.expires_at > ? AND (i.max_uses IS NULL OR i.uses < i.max_uses)
        ORDER BY i.created_at DESC""", (tree_id, utc_now().strftime("%Y-%m-%d %H:%M:%S"))).fetchall()
    unclaimed = db.execute("SELECT id, first_name, last_name FROM people WHERE tree_id = ? AND user_id IS NULL "
                           "ORDER BY first_name, last_name", (tree_id,)).fetchall()
    return render_template("share.html", tree=tree, members=members, invites=invites, unclaimed=unclaimed,
                           role_label=ROLE_LABEL, invite_days=INVITE_DAYS)


@bp.route("/join/<token>", methods=["GET", "POST"])
def join(token):
    inv = valid_invite(token)
    if inv is None:
        return render_template("message.html", title="This invite has expired",
                               message="Invite links stop working after a while or once they're used. "
                                       "Ask whoever sent it for a new one."), 410
    user = current_user()
    if request.method == "POST":
        if user is None:
            return redirect(url_for("auth.login", next=url_for("trees.join", token=token)))
        db = get_db()
        current = tree_role(inv["tree_id"], user["id"])
        if current is None:
            db.execute("INSERT INTO tree_members (tree_id, user_id, role) VALUES (?, ?, ?)",
                       (inv["tree_id"], user["id"], inv["role"]))
        elif ROLE_RANK[inv["role"]] > ROLE_RANK[current]:
            db.execute("UPDATE tree_members SET role = ? WHERE tree_id = ? AND user_id = ?",
                       (inv["role"], inv["tree_id"], user["id"]))
        note = ""
        if inv["person_id"]:
            err = claim_person(db, inv["tree_id"], inv["person_id"], user["id"])
            note = f" Your leaf is {inv['person_first']}." if not err else f" ({err})"
        db.execute("UPDATE invites SET uses = uses + 1 WHERE id = ?", (inv["id"],))
        db.commit()
        flash(f"Welcome to “{inv['tree_name']}”.{note}", "success")
        return redirect(url_for("trees.tree_view", tree_id=inv["tree_id"]))
    return render_template("join.html", invite=inv, role_label=ROLE_LABEL, token=token,
                           already=tree_role(inv["tree_id"], user["id"]) if user else None)


@bp.route("/photos/<path:filename>")
@login_required
def photo(filename):
    row = get_db().execute("SELECT tree_id FROM people WHERE photo = ?", (filename,)).fetchone()
    if row is None:
        abort(404)
    require_role(row["tree_id"], "viewer")
    resp = send_from_directory(current_app.config["UPLOAD_DIR"], filename, max_age=3600)
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp


# ------------------------------------------------------------------ JSON API for the 3D tree page

@bp.route("/api/trees/<int:tree_id>")
@login_required
def api_tree(tree_id):
    tree, role = require_role(tree_id, "viewer")
    db = get_db()
    me = current_user()["id"]
    people = db.execute("SELECT * FROM people WHERE tree_id = ? ORDER BY id", (tree_id,)).fetchall()
    rels = db.execute("SELECT id, person_a, person_b, kind FROM relationships WHERE tree_id = ?", (tree_id,)).fetchall()
    claimed = [p["user_id"] for p in people if p["user_id"]]
    accounts = {}
    if claimed:
        marks = ",".join("?" * len(claimed))
        accounts = {r["id"]: r["name"] for r in db.execute(f"SELECT id, name FROM users WHERE id IN ({marks})", claimed)}
    states = connection_states(me)
    my_leaf = next((p["id"] for p in people if p["user_id"] == me), None)
    # Consistency hints go only to people who can fix them (and who see every date anyway).
    issues = find_issues(people, rels) if can(role, "editor") else {}
    return jsonify(
        tree={"id": tree["id"], "name": tree["name"], "hide_living": bool(tree["hide_living"]),
              "discoverable": bool(tree["discoverable"])},
        role=role, me={"id": me, "person_id": my_leaf, "name": current_user()["name"]},
        people=[person_payload(p, tree, role, me, states, accounts, issues.get(p["id"])) for p in people],
        relationships=[dict(r) for r in rels])


def _person_response(tree_id, person_id):
    tree, role = require_role(tree_id, "viewer")
    p = person_in_tree(person_id, tree_id)
    me = current_user()["id"]
    accounts = {}
    if p["user_id"]:
        row = get_db().execute("SELECT id, name FROM users WHERE id = ?", (p["user_id"],)).fetchone()
        accounts = {row["id"]: row["name"]} if row else {}
    return person_payload(p, tree, role, me, connection_states(me), accounts)


@bp.route("/api/trees/<int:tree_id>/people", methods=["POST"])
@login_required
def api_add_person(tree_id):
    require_role(tree_id, "editor")
    data = request.get_json(silent=True) or {}
    fields, error = clean_person(data)
    if error:
        return jsonify(error=error), 400
    db = get_db()
    cols = list(fields)
    cur = db.execute(f"INSERT INTO people (tree_id, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))})",
                     [tree_id] + [fields[c] for c in cols])
    new_id = cur.lastrowid
    link = data.get("link")
    if isinstance(link, dict) and link.get("to"):
        other = person_in_tree(int(link["to"]), tree_id)["id"]
        error = add_relationship(db, tree_id, new_id, other, link.get("as"))
        if error:
            db.rollback()
            return jsonify(error=error), 400
    db.commit()
    return jsonify(person=_person_response(tree_id, new_id)), 201


@bp.route("/api/trees/<int:tree_id>/people/<int:person_id>", methods=["PUT", "DELETE"])
@login_required
def api_person(tree_id, person_id):
    require_role(tree_id, "editor")
    person = person_in_tree(person_id, tree_id)
    db = get_db()
    if request.method == "DELETE":
        # Snapshot the person and their links first, so a delete can be undone.
        snap = {k: person[k] for k in person.keys()}
        rels = db.execute(
            "SELECT person_a, person_b, kind FROM relationships "
            "WHERE tree_id = ? AND (person_a = ? OR person_b = ?)",
            (tree_id, person_id, person_id)).fetchall()
        rel_list = [{"person_a": r["person_a"], "person_b": r["person_b"], "kind": r["kind"]} for r in rels]
        # Keep the photo file on disk so Undo can bring it back; a never-undone
        # delete leaves an unreferenced file, which is harmless.
        db.execute("DELETE FROM people WHERE id = ?", (person_id,))
        db.commit()
        return jsonify(ok=True, undo={"person": snap, "relationships": rel_list})
    fields, error = clean_person(request.get_json(silent=True) or {}, partial=True)
    if error:
        return jsonify(error=error), 400
    if fields:
        db.execute(f"UPDATE people SET {', '.join(k + ' = ?' for k in fields)} WHERE id = ?",
                   list(fields.values()) + [person_id])
        db.commit()
    return jsonify(person=_person_response(tree_id, person_id))


@bp.route("/api/trees/<int:tree_id>/people/restore", methods=["POST"])
@login_required
def api_restore_person(tree_id):
    """Put back a person (and their links) that was just deleted — the Undo action."""
    require_role(tree_id, "editor")
    data = request.get_json(silent=True) or {}
    snap = data.get("person") or {}
    rels = data.get("relationships") or []
    db = get_db()
    cols = ["first_name", "last_name", "gender", "birth_date", "birth_place",
            "death_date", "notes", "photo", "deceased", "birth_year", "death_year", "user_id"]
    values = [snap.get(c) for c in cols]
    old_id = snap.get("id")

    # Reuse the original id when it's still free, so existing links feel unchanged;
    # otherwise take a fresh one.
    new_id = None
    if isinstance(old_id, int) and not db.execute("SELECT 1 FROM people WHERE id = ?", (old_id,)).fetchone():
        db.execute(
            f"INSERT INTO people (id, tree_id, {', '.join(cols)}) "
            f"VALUES (?, ?, {', '.join(['?'] * len(cols))})",
            [old_id, tree_id] + values)
        new_id = old_id
    if new_id is None:
        new_id = db.execute(
            f"INSERT INTO people (tree_id, {', '.join(cols)}) "
            f"VALUES (?, {', '.join(['?'] * len(cols))})",
            [tree_id] + values).lastrowid

    # Restore each link whose other end still exists in this tree.
    for r in rels:
        if r.get("kind") not in ("parent", "spouse"):
            continue
        a = new_id if r.get("person_a") == old_id else r.get("person_a")
        b = new_id if r.get("person_b") == old_id else r.get("person_b")
        ok_a = db.execute("SELECT 1 FROM people WHERE id = ? AND tree_id = ?", (a, tree_id)).fetchone()
        ok_b = db.execute("SELECT 1 FROM people WHERE id = ? AND tree_id = ?", (b, tree_id)).fetchone()
        if ok_a and ok_b:
            db.execute(
                "INSERT OR IGNORE INTO relationships (tree_id, person_a, person_b, kind) "
                "VALUES (?, ?, ?, ?)", (tree_id, a, b, r["kind"]))
    db.commit()
    return jsonify(person=_person_response(tree_id, new_id))


@bp.route("/api/trees/<int:tree_id>/people/<int:person_id>/photo", methods=["POST", "DELETE"])
@login_required
def api_photo(tree_id, person_id):
    require_role(tree_id, "editor")
    person = person_in_tree(person_id, tree_id)
    db = get_db()
    if request.method == "DELETE":
        remove_photo_file(person["photo"])
        db.execute("UPDATE people SET photo = '' WHERE id = ?", (person_id,))
        db.commit()
        return jsonify(person=_person_response(tree_id, person_id))
    file = request.files.get("photo")
    head = file.stream.read(12) if file else b""
    kind = next((ext for sig, ext in PHOTO_SIGNATURES.items() if head.startswith(sig)), None)
    if kind == "webp" and head[8:12] != b"WEBP":
        kind = None
    if not kind:
        return jsonify(error="Upload a photo as a JPG, PNG, GIF or WebP file."), 400
    file.stream.seek(0)
    filename = f"{uuid.uuid4().hex}.{kind}"
    file.save(os.path.join(current_app.config["UPLOAD_DIR"], filename))
    remove_photo_file(person["photo"])
    db.execute("UPDATE people SET photo = ? WHERE id = ?", (filename, person_id))
    db.commit()
    return jsonify(person=_person_response(tree_id, person_id))


@bp.route("/api/trees/<int:tree_id>/people/<int:person_id>/claim", methods=["POST", "DELETE"])
@login_required
def api_claim(tree_id, person_id):
    _tree, role = require_role(tree_id, "viewer")
    me = current_user()["id"]
    person = person_in_tree(person_id, tree_id)
    db = get_db()
    if request.method == "DELETE":
        if person["user_id"] != me and not can(role, "editor"):
            abort(403)
        db.execute("UPDATE people SET user_id = NULL WHERE id = ?", (person_id,))
        db.commit()
        return jsonify(person=_person_response(tree_id, person_id))
    error = claim_person(db, tree_id, person_id, me)
    if error:
        return jsonify(error=error), 400
    db.commit()
    return jsonify(person=_person_response(tree_id, person_id))


@bp.route("/api/trees/<int:tree_id>/relationships", methods=["POST"])
@login_required
def api_add_relationship(tree_id):
    require_role(tree_id, "editor")
    data = request.get_json(silent=True) or {}
    try:
        a = person_in_tree(int(data.get("person") or 0), tree_id)["id"]
        b = person_in_tree(int(data.get("other") or 0), tree_id)["id"]
    except (TypeError, ValueError):
        return jsonify(error="Choose two people."), 400
    db = get_db()
    error = add_relationship(db, tree_id, a, b, data.get("as"))
    if error:
        return jsonify(error=error), 400
    db.commit()
    return jsonify(ok=True), 201


@bp.route("/api/trees/<int:tree_id>/relationships/<int:rel_id>", methods=["DELETE"])
@login_required
def api_delete_relationship(tree_id, rel_id):
    require_role(tree_id, "editor")
    db = get_db()
    db.execute("DELETE FROM relationships WHERE id = ? AND tree_id = ?", (rel_id, tree_id))
    db.commit()
    return jsonify(ok=True)


@bp.route("/api/trees/<int:tree_id>/relationship")
@login_required
def api_relationship(tree_id):
    require_role(tree_id, "viewer")
    a, b = request.args.get("a", type=int), request.args.get("b", type=int)
    db = get_db()
    people = db.execute("SELECT id, first_name, gender FROM people WHERE tree_id = ?", (tree_id,)).fetchall()
    rels = db.execute("SELECT person_a, person_b, kind FROM relationships WHERE tree_id = ?", (tree_id,)).fetchall()
    graph = FamilyGraph(people, rels)
    if a not in graph.people or b not in graph.people:
        return jsonify(error="Choose two people on this tree."), 400
    found = graph.describe(a, b)
    if not found:
        return jsonify(term=None, path=[],
                       sentence=f"{graph.name(b)} and {graph.name(a)} aren't connected on this tree yet.")
    return jsonify(found)
