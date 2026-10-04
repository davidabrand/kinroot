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
- `kinroot/checks.py` — consistency checks ("born before their parent"), shown to editors.
- `kinroot/privacy.py` — what view-only guests may see about living people.
- `kinroot/db.py` — SQLite schema via append-only MIGRATIONS (never edit an old
  migration; add a new numbered one at the end).
- `static/js/tree/` — the 3D view (layout.js is pure math and has tests).
  `skytime.js` works out the time-of-day sky (preview with `?hour=5.5`); `sky.js` draws it.
  Its tests are in `tests/js/` and run through pytest when Node is installed.
- `templates/` — Jinja pages; `static/css/style.css` — the design system.
- Homepage (logged-out `/`): `templates/landing.html` + `partials/landing_tree.svg`, styled only by
  `static/css/landing.css` and driven by `static/js/landing.js`. Its example family lives in
  `kinroot/landing.py`; `tests/test_landing.py` checks the relationship it shows against the real engine.

## Rules — do not break these
1. **Never deploy to production automatically.** The live app is on
   PythonAnywhere with real family data. Deploy is a human step (see DEPLOY.md).
2. **Never touch `instance/`** (the live database, secret key, uploaded photos)
   and never commit it — it's git-ignored. Don't print secrets.
3. **Preserve security:** parameterized SQL only; keep CSRF, the login/registration
   rate limits, access checks (`require_role`), and privacy for living relatives.
4. **Keep the look.** The homepage is the design source of truth: a modern family
   archive — near-black "ink" world, warm ivory "paper" sheets, brass/gold accents,
   Cormorant Garamond (history, names, titles) + Manrope (interface). Never drift
   toward generic SaaS. Work within the tokens in `style.css` (`.theme-ink`,
   `.theme-paper`) and `landing.css`.
5. **Schema changes** go in a new `MIGRATIONS` entry; verify the migration runs
   cleanly on an existing database, not just a fresh one.
6. **Work on a git branch**, run the tests, and summarize what changed. Let a
   human review and merge.

## What's next (from ROADMAP.md)
Open items include: photos & stories per person (multiple photos, dated
memories), undo for more actions, merge a GEDCOM into an existing tree,
password reset + email verification (needs an email provider — see DEPLOY.md),
and performance for very large trees.

## Standards — what "better" means here

**Definition of done** for any change:
- `python -m pytest -q` passes, and new/changed behavior has a test.
- Works at phone width and desktop; keyboard-accessible; correct on both ink and paper surfaces.
- No secrets printed or committed; `instance/` untouched; no new runtime dependency
  without calling it out (it must also work on PythonAnywhere's free tier — no paid APIs).
- Security preserved: parameterized SQL, CSRF, rate limits, `require_role`, living-person privacy.
- Uses the design tokens in `style.css`; matches the homepage's identity (rule 4).
  Logged-in pages live in the shell in `base.html` (dark sidebar + paper `.sheet`);
  serif for titles/names, sans for UI, `.eyebrow` / `.kicker` for labels. The 3D tree
  draws only on change: call `scene.invalidate()` after anything that alters it.
  Spacing (`--sp-1…8`), radii (`--r-xs…--r-pill`), motion (`--ease`, `--dur-fast`, `--dur`)
  and shadows (`--shadow-sm`, `--shadow-pop` for floating things only) are tokens too:
  no one-off pixel values. Cards are flat; settings pages use `.settings` sections.
- Done on a git branch, with a short written summary of what changed and why.

**UI/UX principles:**
- Clarity over cleverness. Every screen should answer: where am I, what can I do,
  what's the main action, what just happened, what next.
- Reuse components; keep spacing, radii and colours consistent with the system.
- Confirm only destructive actions; prefer an Undo over a confirm dialog.
- Every new area needs empty, loading and error states — never a blank screen.
- Treat mobile as a real product, not a shrunk desktop.

**Using competitors (Ancestry, MyHeritage, FamilySearch, Geni, WikiTree):**
- Adapt *ideas*, never clone their UI, copy proprietary content, or scrape paywalled data.
- Skip anything needing data/DNA partnerships or paid services — out of scope for a solo app.
- Keep Kinroot's privacy-first stance and its own look.

## Working autonomously (supervised)
Work in cycles. Each cycle: pick ONE high-value item from `BACKLOG.md` (or add a new,
well-justified one first), branch `feat/<name>`, implement to the Definition of Done,
run the tests, then STOP and summarize for review. Never deploy — that's a human step.
Keep `BACKLOG.md` updated: mark items done, add new ideas with a one-line rationale.
