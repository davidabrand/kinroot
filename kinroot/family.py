"""Family connections and messages.

How it works:
  1. You find a relative: on a tree you share, or as a shared ancestor in
     another family's tree (only if that family switched on discovery).
  2. You send a connection request with a short note.
  3. They accept, decline or block. Declines are silent: to the sender the
     request just stays "sent", so nobody feels rejected.
  4. Once connected you can message each other.
"""
from datetime import date, datetime, timedelta

from flask import Blueprint, abort, flash, jsonify, redirect, render_template, request, url_for

from .auth import current_user, login_required
from .dates import utc_now
from .db import get_db
from .privacy import PRESUMED_DECEASED_AFTER_YEARS
from .relationships import FamilyGraph

bp = Blueprint("family", __name__)

MAX_PENDING_OUT = 25
MAX_NOTE = 300
MAX_MESSAGE = 2000
RETRY_AFTER_DAYS = 30


# ------------------------------------------------------------------ state helpers

def _now():
    return utc_now().strftime("%Y-%m-%d %H:%M:%S")


def connection_between(a, b):
    return get_db().execute(
        "SELECT * FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
        (a, b, b, a)).fetchone()


def state_for(row, me):
    """How a connection looks from my side: none | pending_out | pending_in | connected | unavailable."""
    if row is None:
        return "none"
    if row["status"] == "accepted":
        return "connected"
    if row["status"] == "blocked":
        return "unavailable"
    if row["status"] == "pending":
        return "pending_out" if row["requester_id"] == me else "pending_in"
    # declined: the person who was declined keeps seeing "sent"
    return "pending_out" if row["requester_id"] == me else "none"


def connection_states(me):
    """{other_user_id: {"state": ..., "id": connection_id}} for everyone I have a connection row with."""
    rows = get_db().execute("SELECT * FROM connections WHERE requester_id = ? OR addressee_id = ?", (me, me)).fetchall()
    states = {}
    for r in rows:
        other = r["addressee_id"] if r["requester_id"] == me else r["requester_id"]
        states[other] = {"state": state_for(r, me), "id": r["id"]}
    return states


def shares_tree(a, b):
    return get_db().execute(
        "SELECT 1 FROM tree_members x JOIN tree_members y ON x.tree_id = y.tree_id "
        "WHERE x.user_id = ? AND y.user_id = ? LIMIT 1", (a, b)).fetchone() is not None


def _historic_sql(alias):
    return (f"({alias}.deceased = 1 OR {alias}.death_date != '' OR "
            f"({alias}.birth_year IS NOT NULL AND {alias}.birth_year < :cutoff))")


def discovery_matches(me, limit=60):
    """Ancestors (people who have passed away) that also appear in other families' discoverable trees."""
    sql = f"""
        SELECT mine.id AS my_person_id, mine.first_name, mine.last_name, mine.birth_year,
               mt.id AS my_tree_id, mt.name AS my_tree_name,
               theirs.id AS their_person_id, tt.id AS their_tree_id, tt.name AS their_tree_name,
               owner.id AS owner_id, owner.name AS owner_name
        FROM people mine
        JOIN tree_members mm ON mm.tree_id = mine.tree_id AND mm.user_id = :me
        JOIN trees mt ON mt.id = mine.tree_id
        JOIN people theirs ON lower(theirs.first_name) = lower(mine.first_name)
                          AND lower(theirs.last_name) = lower(mine.last_name)
                          AND theirs.birth_year = mine.birth_year
        JOIN trees tt ON tt.id = theirs.tree_id AND tt.discoverable = 1
        JOIN users owner ON owner.id = tt.owner_id
        WHERE mine.birth_year IS NOT NULL AND mine.last_name != ''
          AND owner.id != :me
          AND theirs.tree_id NOT IN (SELECT tree_id FROM tree_members WHERE user_id = :me)
          AND {_historic_sql('mine')} AND {_historic_sql('theirs')}
        ORDER BY mine.birth_year
        LIMIT :limit"""
    cutoff = date.today().year - PRESUMED_DECEASED_AFTER_YEARS
    return get_db().execute(sql, {"me": me, "cutoff": cutoff, "limit": limit}).fetchall()


def match_is_valid(me, via_person_id, match_person_id, owner_id):
    for m in discovery_matches(me, limit=500):
        if m["my_person_id"] == via_person_id and m["their_person_id"] == match_person_id and m["owner_id"] == owner_id:
            return m
    return None


def short_name(full):
    parts = (full or "").split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[-1][0]}."
    return full or "Someone"


def relationship_between_users(me, other):
    """What `other` is to `me`, using a tree where both have claimed their own leaf."""
    db = get_db()
    row = db.execute("""
        SELECT a.tree_id, a.id AS my_person, b.id AS their_person, t.name AS tree_name
        FROM people a JOIN people b ON a.tree_id = b.tree_id
        JOIN trees t ON t.id = a.tree_id
        WHERE a.user_id = ? AND b.user_id = ? LIMIT 1""", (me, other)).fetchone()
    if not row:
        return None
    people = db.execute("SELECT id, first_name, gender FROM people WHERE tree_id = ?", (row["tree_id"],)).fetchall()
    rels = db.execute("SELECT person_a, person_b, kind FROM relationships WHERE tree_id = ?", (row["tree_id"],)).fetchall()
    found = FamilyGraph(people, rels).describe(row["my_person"], row["their_person"])
    if not found or found["term"] == "same person":
        return None
    return {"term": found["term"], "tree_name": row["tree_name"]}


def counts(me):
    db = get_db()
    requests = db.execute("SELECT COUNT(*) FROM connections WHERE addressee_id = ? AND status = 'pending'",
                          (me,)).fetchone()[0]
    unread = db.execute("""
        SELECT COUNT(*) FROM messages m JOIN connections c ON c.id = m.connection_id
        WHERE c.status = 'accepted' AND (c.requester_id = :me OR c.addressee_id = :me)
          AND m.sender_id != :me AND m.read_at IS NULL""", {"me": me}).fetchone()[0]
    return {"requests": requests, "unread": unread, "total": requests + unread}


# ------------------------------------------------------------------ actions

class RequestError(ValueError):
    pass


def send_request(me, other, note="", via_tree_id=None, via_person_id=None, match_person_id=None):
    """Create (or revive) a connection request. Returns (connection_id, state)."""
    db = get_db()
    note = (note or "").strip()[:MAX_NOTE]
    if other == me:
        raise RequestError("That's you!")
    if not db.execute("SELECT 1 FROM users WHERE id = ?", (other,)).fetchone():
        raise RequestError("That person isn't on Kinroot.")

    if match_person_id:
        if not match_is_valid(me, via_person_id, match_person_id, other):
            raise RequestError("That match isn't available any more.")
        via_tree_id = None
    elif not shares_tree(me, other):
        raise RequestError("You can only connect with people on a tree you share, or through a shared ancestor.")
    else:
        via_person_id = match_person_id = None
        both_in_tree = via_tree_id and db.execute(
            "SELECT COUNT(*) FROM tree_members WHERE tree_id = ? AND user_id IN (?, ?)",
            (via_tree_id, me, other)).fetchone()[0] == 2
        if not both_in_tree:
            via_tree_id = None

    existing = connection_between(me, other)
    now = _now()
    if existing:
        state = state_for(existing, me)
        if state == "connected":
            return existing["id"], "connected"
        if state == "unavailable":
            raise RequestError("You can't send a request to this person.")
        if existing["status"] == "pending" and existing["addressee_id"] == me:
            # They already asked us: sending one back simply accepts theirs.
            db.execute("UPDATE connections SET status = 'accepted', responded_at = ? WHERE id = ?",
                       (now, existing["id"]))
            db.commit()
            return existing["id"], "connected"
        if existing["status"] == "declined" and existing["requester_id"] == me:
            answered = datetime.strptime(existing["responded_at"], "%Y-%m-%d %H:%M:%S")
            if utc_now() - answered < timedelta(days=RETRY_AFTER_DAYS):
                return existing["id"], "pending_out"   # silent: still looks "sent"
        if existing["status"] == "pending" and existing["requester_id"] == me:
            return existing["id"], "pending_out"
        _check_pending_limit(me)
        db.execute("""UPDATE connections SET requester_id = ?, addressee_id = ?, status = 'pending', note = ?,
                      via_tree_id = ?, via_person_id = ?, match_person_id = ?, created_at = ?, responded_at = NULL
                      WHERE id = ?""",
                   (me, other, note, via_tree_id, via_person_id, match_person_id, now, existing["id"]))
        db.commit()
        return existing["id"], "pending_out"

    _check_pending_limit(me)
    cur = db.execute("""INSERT INTO connections (requester_id, addressee_id, status, note, via_tree_id,
                        via_person_id, match_person_id, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)""",
                     (me, other, note, via_tree_id, via_person_id, match_person_id, now))
    db.commit()
    return cur.lastrowid, "pending_out"


def _check_pending_limit(me):
    pending = get_db().execute(
        "SELECT COUNT(*) FROM connections WHERE requester_id = ? AND status IN ('pending', 'declined')",
        (me,)).fetchone()[0]
    if pending >= MAX_PENDING_OUT:
        raise RequestError(f"You have {MAX_PENDING_OUT} requests waiting. Wait for some answers first.")


def my_connection(cid, me):
    row = get_db().execute("SELECT * FROM connections WHERE id = ? AND (requester_id = ? OR addressee_id = ?)",
                           (cid, me, me)).fetchone()
    if row is None:
        abort(404)
    return row


def other_party(row, me):
    return row["addressee_id"] if row["requester_id"] == me else row["requester_id"]


def message_dict(m, me):
    return {"id": m["id"], "mine": m["sender_id"] == me, "body": m["body"],
            "at": m["created_at"].replace(" ", "T") + "Z"}


def mark_read(cid, me):
    db = get_db()
    db.execute("UPDATE messages SET read_at = ? WHERE connection_id = ? AND sender_id != ? AND read_at IS NULL",
               (_now(), cid, me))
    db.commit()


# ------------------------------------------------------------------ pages

@bp.route("/family")
@login_required
def hub():
    me = current_user()["id"]
    db = get_db()
    incoming = db.execute("""
        SELECT c.*, u.name AS other_name, t.name AS tree_name,
               vp.first_name AS via_first, vp.last_name AS via_last, vp.birth_year AS via_year
        FROM connections c JOIN users u ON u.id = c.requester_id
        LEFT JOIN trees t ON t.id = c.via_tree_id
        LEFT JOIN people vp ON vp.id = c.match_person_id
        WHERE c.addressee_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC""", (me,)).fetchall()
    outgoing = db.execute("""
        SELECT c.*, u.name AS other_name FROM connections c JOIN users u ON u.id = c.addressee_id
        WHERE c.requester_id = ? AND c.status IN ('pending', 'declined') ORDER BY c.created_at DESC""",
                          (me,)).fetchall()
    connected = db.execute("""
        SELECT c.*, u.name AS other_name, u.id AS other_id,
               (SELECT body FROM messages m WHERE m.connection_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
               (SELECT created_at FROM messages m WHERE m.connection_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
               (SELECT COUNT(*) FROM messages m WHERE m.connection_id = c.id AND m.sender_id != :me
                    AND m.read_at IS NULL) AS unread
        FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = :me THEN c.addressee_id ELSE c.requester_id END
        WHERE (c.requester_id = :me OR c.addressee_id = :me) AND c.status = 'accepted'
        ORDER BY COALESCE(last_at, c.responded_at) DESC""", {"me": me}).fetchall()
    blocked = db.execute("""
        SELECT c.*, u.name AS other_name FROM connections c
        JOIN users u ON u.id = CASE WHEN c.requester_id = :me THEN c.addressee_id ELSE c.requester_id END
        WHERE c.status = 'blocked' AND c.blocked_by = :me""", {"me": me}).fetchall()

    states = connection_states(me)
    suggestions = []
    for row in db.execute("""
            SELECT DISTINCT u.id, u.name, t.id AS tree_id, t.name AS tree_name
            FROM tree_members mine JOIN tree_members theirs ON theirs.tree_id = mine.tree_id
            JOIN users u ON u.id = theirs.user_id JOIN trees t ON t.id = mine.tree_id
            WHERE mine.user_id = ? AND theirs.user_id != ? ORDER BY u.name""", (me, me)).fetchall():
        if states.get(row["id"], {}).get("state", "none") != "none":
            continue
        if any(s["id"] == row["id"] for s in suggestions):
            continue
        suggestions.append({"id": row["id"], "name": row["name"], "tree_id": row["tree_id"],
                            "tree_name": row["tree_name"], "relation": relationship_between_users(me, row["id"])})

    matches = {}
    for m in discovery_matches(me):
        if states.get(m["owner_id"], {}).get("state", "none") != "none":
            continue
        entry = matches.setdefault(m["owner_id"], {
            "owner_id": m["owner_id"], "owner_name": short_name(m["owner_name"]),
            "their_tree_name": m["their_tree_name"], "people": []})
        if len(entry["people"]) < 5:
            entry["people"].append(m)

    relations = {c["other_id"]: relationship_between_users(me, c["other_id"]) for c in connected}
    return render_template("family.html", incoming=incoming, outgoing=outgoing, connected=connected,
                           blocked=blocked, suggestions=suggestions, matches=list(matches.values()),
                           relations=relations, incoming_relations={
                               r["requester_id"]: relationship_between_users(me, r["requester_id"]) for r in incoming})


@bp.route("/family/requests", methods=["POST"])
@login_required
def request_form():
    me = current_user()["id"]
    try:
        send_request(me, request.form.get("user_id", type=int), request.form.get("note", ""),
                     request.form.get("via_tree_id", type=int), request.form.get("via_person_id", type=int),
                     request.form.get("match_person_id", type=int))
        flash("Request sent. You'll be able to message each other once they accept.", "success")
    except RequestError as e:
        flash(str(e), "error")
    return redirect(url_for("family.hub"))


@bp.route("/family/<int:cid>/respond", methods=["POST"])
@login_required
def respond(cid):
    me = current_user()["id"]
    row = my_connection(cid, me)
    action = request.form.get("action")
    db = get_db()
    if action == "block":
        db.execute("UPDATE connections SET status = 'blocked', blocked_by = ?, responded_at = ? WHERE id = ?",
                   (me, _now(), cid))
        db.commit()
        flash("Blocked. They can't send you requests or messages.", "success")
        return redirect(url_for("family.hub"))
    if row["addressee_id"] != me or row["status"] != "pending":
        abort(400)
    if action == "accept":
        db.execute("UPDATE connections SET status = 'accepted', responded_at = ? WHERE id = ?", (_now(), cid))
        db.commit()
        flash("Connected. Say hello!", "success")
        return redirect(url_for("family.chat", cid=cid))
    if action == "decline":
        db.execute("UPDATE connections SET status = 'declined', responded_at = ? WHERE id = ?", (_now(), cid))
        db.commit()
        flash("Request declined. They won't be told.", "success")
    return redirect(url_for("family.hub"))


@bp.route("/family/<int:cid>/withdraw", methods=["POST"])
@login_required
def withdraw(cid):
    """Cancel my own request, remove a connection, or unblock someone I blocked."""
    me = current_user()["id"]
    row = my_connection(cid, me)
    allowed = ((row["status"] in ("pending", "declined") and row["requester_id"] == me)
               or row["status"] == "accepted"
               or (row["status"] == "blocked" and row["blocked_by"] == me))
    if not allowed:
        abort(400)
    get_db().execute("DELETE FROM connections WHERE id = ?", (cid,))
    get_db().commit()
    flash({"pending": "Request cancelled.", "declined": "Request cancelled.", "accepted": "Connection removed.",
           "blocked": "Unblocked."}[row["status"]], "success")
    return redirect(url_for("family.hub"))


@bp.route("/family/<int:cid>", methods=["GET", "POST"])
@login_required
def chat(cid):
    me = current_user()["id"]
    row = my_connection(cid, me)
    if row["status"] != "accepted":
        return redirect(url_for("family.hub"))
    db = get_db()
    if request.method == "POST":   # works even without JavaScript
        body = request.form.get("body", "").strip()[:MAX_MESSAGE]
        if body:
            db.execute("INSERT INTO messages (connection_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)",
                       (cid, me, body, _now()))
            db.commit()
        return redirect(url_for("family.chat", cid=cid))
    other = db.execute("SELECT id, name FROM users WHERE id = ?", (other_party(row, me),)).fetchone()
    messages = db.execute("SELECT * FROM (SELECT * FROM messages WHERE connection_id = ? ORDER BY id DESC LIMIT 200) "
                          "ORDER BY id", (cid,)).fetchall()
    mark_read(cid, me)
    via = db.execute("SELECT name FROM trees WHERE id = ?", (row["via_tree_id"],)).fetchone() if row["via_tree_id"] else None
    return render_template("chat.html", connection=row, other=other,
                           messages=[message_dict(m, me) for m in messages],
                           relation=relationship_between_users(me, other["id"]), via=via)


# ------------------------------------------------------------------ JSON API (used by the tree and chat pages)

@bp.route("/api/family/requests", methods=["POST"])
@login_required
def api_request():
    me = current_user()["id"]
    data = request.get_json(silent=True) or {}
    try:
        cid, state = send_request(me, int(data.get("user_id") or 0), data.get("note", ""),
                                  data.get("via_tree_id"), data.get("via_person_id"), data.get("match_person_id"))
    except (RequestError, ValueError, TypeError) as e:
        return jsonify(error=str(e) or "Couldn't send that request."), 400
    return jsonify(connection_id=cid, state=state)


@bp.route("/api/family/<int:cid>/messages", methods=["GET", "POST"])
@login_required
def api_messages(cid):
    me = current_user()["id"]
    row = my_connection(cid, me)
    if row["status"] != "accepted":
        return jsonify(error="You're not connected any more."), 403
    db = get_db()
    if request.method == "POST":
        body = str((request.get_json(silent=True) or {}).get("body", "")).strip()
        if not body:
            return jsonify(error="Write a message first."), 400
        if len(body) > MAX_MESSAGE:
            return jsonify(error=f"Messages can be up to {MAX_MESSAGE} characters."), 400
        cur = db.execute("INSERT INTO messages (connection_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)",
                         (cid, me, body, _now()))
        db.commit()
        m = db.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone()
        return jsonify(message=message_dict(m, me)), 201
    after = request.args.get("after", 0, type=int)
    rows = db.execute("SELECT * FROM messages WHERE connection_id = ? AND id > ? ORDER BY id LIMIT 200",
                      (cid, after)).fetchall()
    mark_read(cid, me)
    return jsonify(messages=[message_dict(m, me) for m in rows])


@bp.route("/api/family/counts")
@login_required
def api_counts():
    return jsonify(counts(current_user()["id"]))
