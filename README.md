# Kinroot

**Your family tree, in its best light.** Kinroot turns names, dates and old photos
into a living 3D tree that the whole family can explore, add to and talk around.
It's a Python (Flask) web app with a golden-hour 3D view built with Three.js, and
3D models and printable posters made in Blender.

## Start it (Windows)

1. Double-click **`run.bat`**. The first time, it sets itself up (about a minute).
2. Your browser opens ****. Make an account and plant your tree.
3. Want to see it full of people first? Double-click **`load_demo.bat`**, then log in as
. You're David Brand, with five generations,
   a chat with your sister Mia and a request from cousin Leo waiting.

To stop Kinroot, close the black window (or press Ctrl+C in it).

Prefer a terminal (Mac, Linux, or PyCharm's terminal)?

```bash
python -m venv .venv
.venv\Scripts\activate          # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
python seed_demo.py              # optional demo family
python app.py
```

## What it does

| | |
|---|---|
| **3D family tree** | Oldest generation at the roots, each generation growing upward. Everyone hangs in a brass medallion with their photo or initials. Drag to turn, scroll to zoom, click anyone. |
| **Watch it grow** | A time-lapse of your family: people appear in the year they were born, branches grow toward them, and leaves turn gold for those who've passed. Old years look like a sepia photograph and warm into colour as they reach today. |
| **How are we related?** | Pick two people and Kinroot names it (great-aunt, second cousin once removed, sister-in-law, stepfather…) and lights up the path between you. |
| **Claim your leaf** | Send a relative an invite link tied to their spot on the tree. When they join, that leaf becomes theirs. |
| **Talk on the tree** | Connect with relatives you find: send a request with a note, and message once they accept. Declines are silent, and anyone can block. |
| **Relatives you may have** | If another family's tree has the same ancestor (same name and birth year, and they've passed away), you can send that family a request. Only trees whose owners switch this on are searched. |
| **Private by default** | View-only guests see living relatives' names and photos, but not their birth dates, birthplaces or notes. |
| **Real genealogy dates** | "2 Mar 1921", "Mar 1921", "1921", "about 1921", "before 1900" all work. |
| **GEDCOM in and out** | Import a tree from Ancestry, FamilySearch or MyHeritage; download yours any time. |
| **Coming up** | Birthdays in the next month, and remembrance days for relatives who've passed. |
| **Save a picture** | Download the current view as a PNG, names included. |

## Blender

Install Blender (4.2 or newer) from blender.org with the normal installer. Then just double-click:

- **`make_3d_models.bat`**: builds the medallion, trunk and leaves for the tree page. Refresh the page afterwards.
- **`make_poster.bat`**: first open the tree page's **⋯** menu → **Export for a Blender poster**, then
  double-click this. It renders the newest export in your Downloads and opens the picture when it's done.

Both find Blender by themselves. The rest of this section is the same thing by hand, for the curious.
Everything Blender does is a Python script in the `blender/` folder. In the commands below, use the
path to your Blender, for example `"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"`.

**1. The 3D models the website uses** (medallion, trunk, leaves):

```bash
blender --background --python blender/build_assets.py
```

This writes `person_node.glb`, `trunk.glb` and `leaves.glb` into `static/models/`.
Refresh the tree page to see them. Without them, the page builds similar shapes itself.
The app takes the *shapes* from these files and colours them to match the golden-hour look.
To change a shape, open `blender/kinroot_assets.blend`, edit it, and export each collection
with **File → Export → glTF 2.0** (glTF Binary, "Selected Objects") using the same names.

**2. A printable poster of your tree:**

1. On the tree page, open the **⋯** menu → **Export for a Blender poster**.
2. Run:

   ```bash
   blender --background --python blender/render_poster.py -- "%USERPROFILE%\Downloads\the-brand-family-poster.json"
   ```

It builds your tree in Blender with an evening sky, photos in the medallions, names and
a title, and saves a 3600 × 4800 PNG next to the file: 12 × 16 inches at print quality.
Options: `--out poster.png`, `--size 4800x3600`, `--samples 128`, `--cycles`.
Put `Alegreya-ExtraBold.ttf` (free from Google Fonts) in `blender/fonts/` to use Kinroot's typeface.

## Project map

```
app.py                  start here: python app.py
kinroot/                the Python app
  auth.py               accounts, logging in, form protection
  trees.py              trees, sharing, invite links, GEDCOM, the 3D page's API
  family.py             connection requests and messages
  relationships.py      "How are we related?"
  dates.py              genealogy-friendly dates
  gedcom.py             GEDCOM import and export
  privacy.py            what view-only guests can see
  db.py                 the database and its upgrades
templates/              the pages
static/css/style.css    the Kinroot look (colours, type, layout)
static/js/tree3d.js     the tree page; its parts live in static/js/tree/
static/models/          Blender models (.glb)
blender/                Blender scripts: 3D models and posters
tests/                  automated checks: python -m pytest
instance/               your database and photos (created on first run, back it up)
```

## Tests

```bash
python -m pytest
```

## Good to know

- The 3D view loads Three.js from the internet, so it needs a connection.
- Everything you add is stored in `instance/`. Back that folder up; don't share it.
- Invite links work on your own computer and home network until Kinroot is online.
- `ROADMAP.md` lists what's done and what's next.
