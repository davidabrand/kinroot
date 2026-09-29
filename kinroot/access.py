"""Who can do what in a tree. Roles, from least to most: viewer < editor < owner."""
from flask import abort

from .auth import current_user
from .db import get_db

ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}
ROLE_LABEL = {"owner": "Owner", "editor": "Can edit", "viewer": "Can view"}


def tree_role(tree_id, user_id):
    row = get_db().execute("SELECT role FROM tree_members WHERE tree_id = ? AND user_id = ?",
                           (tree_id, user_id)).fetchone()
    return row["role"] if row else None


def require_role(tree_id, minimum="viewer"):
    """Return (tree, role) or stop with 404/403.

    Someone who isn't a member gets 404, so they can't even tell the tree exists.
    """
    user = current_user()
    role = tree_role(tree_id, user["id"]) if user else None
    tree = get_db().execute("SELECT * FROM trees WHERE id = ?", (tree_id,)).fetchone()
    if role is None or tree is None:
        abort(404)
    if ROLE_RANK[role] < ROLE_RANK[minimum]:
        abort(403)
    return tree, role


def can(role, minimum):
    return role is not None and ROLE_RANK[role] >= ROLE_RANK[minimum]
