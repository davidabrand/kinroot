# Deploying Kinroot to PythonAnywhere (free tier)

Your live address will be `https://<username>.pythonanywhere.com`.

## 1. Get the code onto PythonAnywhere
Easiest: zip this folder on your PC (right-click the `kinroot-main` folder →
Send to → Compressed folder), but **delete the `.venv` and `instance` folders
from the copy first** (`.venv` is Windows-only; `instance` holds your local test
data — the site makes its own fresh database online).

- PythonAnywhere → **Files** tab → upload the zip.
- Open a **Bash console** (Consoles tab) and unzip:
  ```
  unzip kinroot-main.zip
  ```
  (Git alternative: `git clone <your repo> kinroot-main` instead of upload.)

## 2. Make a virtualenv and install Flask
In the Bash console:
```
cd ~/kinroot-main
python3.10 -m venv .venv          # 3.10, 3.11, 3.12 or 3.13 all work
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Create the web app
- **Web** tab → **Add a new web app** → **Manual configuration**
  (NOT "Flask" — manual) → pick the **same Python version** as your venv.

## 4. Point it at the code
On the Web tab:
- **Virtualenv:** `/home/<username>/kinroot-main/.venv`
- **Source code** and **Working directory:** `/home/<username>/kinroot-main`
- Click the **WSGI configuration file** link and replace everything in it with:
  ```python
  import sys
  path = "/home/<username>/kinroot-main"
  if path not in sys.path:
      sys.path.insert(0, path)
  from wsgi import application   # noqa: E402
  ```
  (Kinroot's own `wsgi.py` already turns on HTTPS-only cookies and ProxyFix.)

## 5. (Recommended) Serve static files fast
Web tab → **Static files**:
- URL `/static/`  →  Directory `/home/<username>/kinroot-main/static`

## 6. Reload and open
Click the big green **Reload** button, then visit
`https://<username>.pythonanywhere.com`. On first load the app creates its
`instance/` folder (database, secret key, uploads) automatically. Sign up,
make a tree, and test an invite link on your phone.

## Good to know (free tier)
- **No outbound email.** Free accounts can only reach an allowlist of sites, so
  password-reset / verification email won't work until a paid tier or an
  allowed email provider. Keep signups to family you invite for now.
- The app **sleeps** and must be renewed (~every 3 months, one button).
- **Backups:** download `instance/family_tree.db` from the Files tab now and
  then, or have people export their tree as GEDCOM.
- **Updating later:** re-upload (or `git pull`) then **Reload**.
- Debug stays off in production — `wsgi.py` never enables it.
