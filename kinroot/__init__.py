"""Kinroot — your family tree, in its best light."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta

from flask import Flask, jsonify, redirect, render_template, request, url_for
from markupsafe import Markup, escape
from werkzeug.exceptions import HTTPException
from werkzeug.security import safe_join

from . import auth, db, family, trees
from .landing import scene as landing_scene
from .dates import format_date, utc_now

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_HEADER = ("X-Requested-With", "Kinroot")
# Locks where scripts, styles, fonts and images may load from. The 3D view loads
# three.js from jsDelivr and fonts from Google; everything else is same-origin.
# 'unsafe-inline' is kept because the pages use a few small inline scripts.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


def create_app(test_config=None):
    app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"),
                static_folder=os.path.join(BASE_DIR, "static"))
    instance = (test_config or {}).get("INSTANCE_DIR", os.path.join(BASE_DIR, "instance"))
    app.config.update(
        INSTANCE_DIR=instance,
        DB_PATH=os.path.join(instance, "family_tree.db"),
        UPLOAD_DIR=os.path.join(instance, "uploads"),
        MAX_CONTENT_LENGTH=12 * 1024 * 1024,
        CSRF_ENABLED=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_HTTPONLY=True,
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    )
    if test_config:
        app.config.update(test_config)
    os.makedirs(app.config["INSTANCE_DIR"], exist_ok=True)
    os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)
    app.secret_key = _secret_key(app.config["INSTANCE_DIR"])

    with app.app_context():
        conn = db.connect(app.config["DB_PATH"])
        db.migrate(conn)
        conn.close()
    app.teardown_appcontext(db.close_db)

    app.register_blueprint(auth.bp)
    app.register_blueprint(trees.bp)
    app.register_blueprint(family.bp)

    @app.route("/")
    def landing():
        if auth.current_user():
            return redirect(url_for("trees.dashboard"))
        return render_template("landing.html", scene=landing_scene())

    @app.before_request
    def protect_writes():
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if request.path.startswith("/api/"):
            # Other websites can't add this header, so they can't change your tree.
            if request.headers.get(API_HEADER[0]) != API_HEADER[1]:
                return jsonify(error="Missing request header."), 400
            return None
        auth.check_csrf()
        return None

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        if request.is_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return resp

    # Cache-busting: every static URL carries a fingerprint of the file's contents
    # (/static/css/style.css?v=3f2a9c...). When a deploy changes a file, its URL
    # changes, so browsers fetch the new copy instead of reusing a stale one. This
    # matters on PythonAnywhere, whose static file server sends no cache headers.
    @app.url_defaults
    def version_static_urls(endpoint, values):
        if endpoint == "static" and "v" not in values:
            version = _static_version(app.static_folder, values.get("filename", ""))
            if version:
                values["v"] = version

    def versioned_modules(folder):
        """Import-map entries for every JS module in static/<folder>, so modules that
        import each other by relative path ("./panel.js") also get fingerprinted URLs."""
        root = os.path.join(app.static_folder, folder)
        names = sorted(n for n in os.listdir(root) if n.endswith(".js")) if os.path.isdir(root) else []
        return {url_for("static", filename=f"{folder}/{n}", v=None): url_for("static", filename=f"{folder}/{n}")
                for n in names}

    @app.context_processor
    def globals_for_templates():
        me = auth.current_user()
        return {"me": me, "csrf_token": auth.csrf_token, "this_year": datetime.now().year,
                "nav_counts": family.counts(me["id"]) if me else None,
                "versioned_modules": versioned_modules}

    app.add_template_filter(format_date, "fdate")
    app.add_template_filter(_ago, "ago")
    app.add_template_filter(_initials, "initials")
    app.add_template_filter(_nl2br, "nl2br")

    @app.errorhandler(HTTPException)
    def http_error(e):
        if e.code is None or e.code < 400:   # routing redirects are exceptions too; let them through
            return e
        if request.path.startswith("/api/"):
            messages = {401: "Please log in again.", 403: "You don't have permission to change this tree.",
                        404: "Not found.", 413: "That file is too big (the limit is 12 MB)."}
            return jsonify(error=messages.get(e.code, e.description)), e.code
        titles = {400: "Something went wrong", 403: "No access", 404: "Not found",
                  413: "That file is too big", 410: "Gone"}
        messages = {403: "You don't have permission to do that.",
                    404: "That page or tree doesn't exist, or it isn't shared with you.",
                    413: "Files can be up to 12 MB."}
        return render_template("message.html", title=titles.get(e.code, "Something went wrong"),
                               message=messages.get(e.code, e.description)), e.code

    return app


_STATIC_VERSIONS = {}


def _static_version(static_folder, filename):
    """A short content hash for a static file, or None for folders and missing files.
    Cached by modification time and size, so each file is read once per change."""
    path = safe_join(static_folder, filename) if filename else None
    if not path or not os.path.isfile(path):
        return None
    st = os.stat(path)
    key = (path, st.st_mtime_ns, st.st_size)
    if key not in _STATIC_VERSIONS:
        with open(path, "rb") as f:
            _STATIC_VERSIONS[key] = hashlib.sha1(f.read()).hexdigest()[:10]
    return _STATIC_VERSIONS[key]


def _secret_key(instance_dir):
    """One random secret kept in the instance folder, so logins survive restarts."""
    path = os.path.join(instance_dir, "secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


def _ago(stamp):
    """'2026-09-28 13:05:00' (UTC) -> '5 min ago'."""
    if not stamp:
        return ""
    try:
        then = datetime.strptime(stamp[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return stamp
    secs = (utc_now() - then).total_seconds()
    if secs < 60:
        return "just now"
    if secs < 3600:
        return f"{int(secs // 60)} min ago"
    if secs < 86400:
        hours = int(secs // 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = int(secs // 86400)
    if days < 7:
        return f"{days} day{'s' if days != 1 else ''} ago"
    return then.strftime("%-d %b %Y") if os.name != "nt" else then.strftime("%d %b %Y").lstrip("0")


def _initials(name):
    parts = [p for p in (name or "").replace("-", " ").split() if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


def _nl2br(text):
    return Markup("<br>".join(escape(line) for line in (text or "").split("\n")))
