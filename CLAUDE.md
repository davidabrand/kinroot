# Kinroot — guide for any coding agent working on this project

Kinroot is a family-tree web app: **Flask (Python)** backend, a **Three.js** 3D
tree in the browser, Blender for 3D models/posters. A beginner owns this project,
so prefer small, safe, well-explained changes over clever rewrites.

## Run it
- Windows: double-click `run.bat` (first run sets up a venv and installs deps).
- Any OS: `python -m venv .venv` → activate → `pip install -r requirements.txt`
  → `python app.py` → open http://127.0.0.1:5000
- Demo data: `python seed_demo.py` then log in as the demo user (see README).

## Test it — ALWAYS before finishing a change
```
python -m pytest -q
```
All tests must pass. If you change behavior, add or update a test in `tests/`.
Tests live in `tests/test_app.py` (Flask test client; see `tests/conftest.py`
for the `register` / `make_tree` / `add` helpers).

## Where things are
- `app.py` / `wsgi.py` — entry points (local vs. production).
- `kinroot/__init__.py` — app factory, security headers (CSP/HSTS), error pages.
- `kinroot/auth.py` — accounts, login, sessions, rate limits, account deletion.
- `kinroot/access.py` — tree roles (viewer < editor < owner).
- `kinroot/trees.py` — trees, the JSON API the 3D page uses, GEDCOM, photos.
- `kinroot/family.py` — connection requests and messages between relatives.
- `kinroot/relationships.py` — "how are we related?".
- `kinroot/dates.py` — genealogy dates ("about 1921").
- `kinroot/privacy.py` — what view-only guests may see about living people.
- `kinroot/db.py` — SQLite schema via append-only MIGRATIONS (never edit an old
  migration; add a new numbered one at the end).
- `static/js/tree/` — the 3D view (layout.js is pure math and has tests).
- `templates/` — Jinja pages; `static/css/style.css` — the design system.

## Rules — do not break these
1. **Never deploy to production automatically.** The live app is on
   PythonAnywhere with real family data. Deploy is a human step (see DEPLOY.md).
2. **Never touch `instance/`** (the live database, secret key, uploaded photos)
   and never commit it — it's git-ignored. Don't print secrets.
3. **Preserve security:** parameterized SQL only; keep CSRF, the login/registration
   rate limits, access checks (`require_role`), and privacy for living relatives.
4. **Keep the look.** Kinroot's warm "golden-hour forest" identity is deliberate;
   don't restyle it toward a generic/corporate look. Work within the existing
   design tokens in `style.css`.
5. **Schema changes** go in a new `MIGRATIONS` entry; verify the migration runs
   cleanly on an existing database, not just a fresh one.
6. **Work on a git branch**, run the tests, and summarize what changed. Let a
   human review and merge.

## What's next (from ROADMAP.md)
Open items include: photos & stories per person (multiple photos, dated
memories), undo for more actions, merge a GEDCOM into an existing tree,
password reset + email verification (needs an email provider — see DEPLOY.md),
and performance for very large trees.
