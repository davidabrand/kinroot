"""Accounts: sign up, log in, log out, account settings, and form protection."""
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


# ------------------------------------------------------------------ helpers

def current_user():
    if "user" not in g:
        uid = session.get("user_id")
        g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
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


def log_in(user_id):
    session.clear()
    session["user_id"] = user_id
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


# ------------------------------------------------------------------ pages

@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user():
        return redirect(safe_next())
    form = {"name": "", "email": ""}
    if request.method == "POST":
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
            cur = db.execute("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                             (form["email"], form["name"], generate_password_hash(password)))
            db.commit()
            log_in(cur.lastrowid)
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
            flash("That email and password don't match.", "error")
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
                flash("Your current password isn't right.", "error")
            elif len(new) < MIN_PASSWORD:
                flash(f"Use a new password with at least {MIN_PASSWORD} characters.", "error")
            else:
                db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                           (generate_password_hash(new), user["id"]))
                db.commit()
                flash("Password changed.", "success")
        return redirect(url_for("auth.account"))
    return render_template("account.html")
