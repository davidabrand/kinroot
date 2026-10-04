"""Accounts: sign up, log in, log out, account settings, and form protection."""
import os
import secrets
import time
from collections import defaultdict, deque
from functools import wraps

from flask import (Blueprint, abort, current_app, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db

bp = Blueprint("auth", __name__)

MIN_PASSWORD = 8
MAX_FAILED_LOGINS = 8           # per email + address ...
FAILED_LOGIN_WINDOW = 10 * 60   # ... within ten minutes
DEFAULT_MAX_REGISTRATIONS = 10  # new accounts per address per hour (override via config)
REGISTRATION_WINDOW = 60 * 60


# ------------------------------------------------------------------ helpers

def current_user():
    if "user" not in g:
        uid = session.get("user_id")
        user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
        # A changed password rotates the account's token, logging out other sessions.
        if user is not None and user["session_token"] and session.get("tok") != user["session_token"]:
            user = None
        g.user = user
    return g.user


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify(error="Please log in again."), 401
            return redirect(url_for("auth.login", next=request.full_path.rstrip("?")))
        return view(*args, **kwargs)
    return wrapped


def safe_next(default_endpoint="trees.dashboard"):
    nxt = request.values.get("next", "")
    if nxt.startswith("/") and not nxt.startswith("//") and "\\" not in nxt:
        return nxt
    return url_for(default_endpoint)


def log_in(user_id, token=None):
    session.clear()
    session["user_id"] = user_id
    if token is None:
        row = get_db().execute("SELECT session_token FROM users WHERE id = ?", (user_id,)).fetchone()
        token = row["session_token"] if row else None
    session["tok"] = token
    session.permanent = True


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(24)
    return session["csrf"]


def check_csrf():
    """Every form post must carry the token from its page (stops other sites posting forms)."""
    if not current_app.config.get("CSRF_ENABLED", True):
        return
    sent = request.form.get("csrf_token", "")
    if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
        abort(400, description="This page expired. Go back, refresh, and try again.")


def _failed_logins():
    return current_app.extensions.setdefault("kinroot_failed_logins", defaultdict(deque))


def _too_many_attempts(key):
    attempts = _failed_logins()[key]
    now = time.time()
    while attempts and now - attempts[0] > FAILED_LOGIN_WINDOW:
        attempts.popleft()
    return len(attempts) >= MAX_FAILED_LOGINS


def _registrations():
    return current_app.extensions.setdefault("kinroot_registrations", defaultdict(deque))


def _too_many_registrations(ip):
    q = _registrations()[ip]
    now = time.time()
    while q and now - q[0] > REGISTRATION_WINDOW:
        q.popleft()
    return len(q) >= current_app.config.get("MAX_REGISTRATIONS_PER_HOUR", DEFAULT_MAX_REGISTRATIONS)


# ------------------------------------------------------------------ pages

@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user():
        return redirect(safe_next())
    form = {"name": "", "email": ""}
    if request.method == "POST":
        if _too_many_registrations(request.remote_addr):
            flash("Too many new accounts from here. Try again later.", "error")
            return render_template("register.html", form=form)
        form["name"] = request.form.get("name", "").strip()[:80]
        form["email"] = request.form.get("email", "").strip().lower()[:200]
        password = request.form.get("password", "")
        db = get_db()
        if not form["name"]:
            flash("Please tell us your name.", "error")
        elif "@" not in form["email"] or "." not in form["email"].split("@")[-1]:
            flash("That email address doesn't look right.", "error")
        elif len(password) < MIN_PASSWORD:
            flash(f"Use a password with at least {MIN_PASSWORD} characters.", "error")
        elif db.execute("SELECT 1 FROM users WHERE email = ?", (form["email"],)).fetchone():
            flash("That email already has an account. Log in instead.", "error")
        else:
            token = secrets.token_urlsafe(16)
            cur = db.execute("INSERT INTO users (email, name, password_hash, session_token) VALUES (?, ?, ?, ?)",
                             (form["email"], form["name"], generate_password_hash(password), token))
            db.commit()
            _registrations()[request.remote_addr].append(time.time())
            log_in(cur.lastrowid, token)
            flash(f"Welcome to Kinroot, {form['name'].split()[0]}.", "success")
            return redirect(safe_next())
    return render_template("register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user():
        return redirect(safe_next())
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        key = (request.remote_addr, email)
        if _too_many_attempts(key):
            flash("Too many tries. Wait ten minutes, then try again.", "error")
        else:
            user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if user and check_password_hash(user["password_hash"], password):
                _failed_logins().pop(key, None)
                log_in(user["id"])
                return redirect(safe_next())
            _failed_logins()[key].append(time.time())
            flash("That email and password don't match. Check for a typo, or sign up if you're new to Kinroot.", "error")
    return render_template("login.html", email=email)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You're logged out.", "success")
    return redirect(url_for("landing"))


@bp.route("/account", methods=["GET", "POST"])
@login_required
def account():
    user = current_user()
    if request.method == "POST":
        db = get_db()
        action = request.form.get("action")
        if action == "name":
            name = request.form.get("name", "").strip()[:80]
            if name:
                db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user["id"]))
                db.commit()
                flash("Name updated.", "success")
        elif action == "password":
            current = request.form.get("current_password", "")
            new = request.form.get("new_password", "")
            if not check_password_hash(user["password_hash"], current):
                flash("Your current password isn't right, so nothing was changed. Type it again and retry.", "error")
            elif len(new) < MIN_PASSWORD:
                flash(f"Use a new password with at least {MIN_PASSWORD} characters.", "error")
            else:
                new_token = secrets.token_urlsafe(16)
                db.execute("UPDATE users SET password_hash = ?, session_token = ? WHERE id = ?",
                           (generate_password_hash(new), new_token, user["id"]))
                db.commit()
                session["tok"] = new_token   # keep THIS session signed in
                flash("Password changed. Other devices have been signed out.", "success")
        elif action == "delete_account":
            if not check_password_hash(user["password_hash"], request.form.get("password", "")):
                flash("That password isn't right, so your account was not deleted. Type your current password to confirm.", "error")
                return redirect(url_for("auth.account"))
            _delete_account(db, user["id"])
            session.clear()
            flash("Your account and the trees you owned have been deleted.", "success")
            return redirect(url_for("landing"))
        return redirect(url_for("auth.account"))
    return render_template("account.html")


def _safe_remove_photo(upload_dir, filename):
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return
    try:
        os.remove(os.path.join(upload_dir, filename))
    except OSError:
        pass


def _delete_account(db, uid):
    """Delete a user, the trees they own (and everything in them), and their memberships.

    Leaves they claimed on other people's trees are un-claimed (kept, just no longer linked),
    and their connections and messages are removed by the database's cascades.
    """
    upload_dir = current_app.config["UPLOAD_DIR"]
    owned = [r["id"] for r in db.execute("SELECT id FROM trees WHERE owner_id = ?", (uid,)).fetchall()]
    for tid in owned:
        for r in db.execute("SELECT photo FROM people WHERE tree_id = ? AND photo != ''", (tid,)).fetchall():
            _safe_remove_photo(upload_dir, r["photo"])
    db.execute("DELETE FROM invites WHERE created_by = ?", (uid,))
    for tid in owned:
        db.execute("DELETE FROM trees WHERE id = ?", (tid,))   # cascades people, rels, invites, members
    db.execute("DELETE FROM tree_members WHERE user_id = ?", (uid,))
    db.execute("DELETE FROM users WHERE id = ?", (uid,))        # cascades connections + messages; SET NULL claimed leaves
    db.commit()
