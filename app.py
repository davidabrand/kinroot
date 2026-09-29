"""Kinroot — your family tree, in its best light.

Start it with:   python app.py
Then open:       http://127.0.0.1:5000

The code lives in the kinroot/ folder:
    kinroot/auth.py           accounts, logging in, form protection
    kinroot/trees.py          trees, sharing, invite links, import/export, the 3D page's API
    kinroot/family.py         connection requests and messages between relatives
    kinroot/relationships.py  "How are we related?"
    kinroot/dates.py          genealogy-friendly dates ("about 1921")
    kinroot/gedcom.py         GEDCOM files (the format other genealogy sites use)
    kinroot/privacy.py        what viewers can see about living relatives
    kinroot/db.py             the database and its upgrades
"""
from kinroot import create_app

app = create_app()

if __name__ == "__main__":
    print("\n  Kinroot is running. Open http://127.0.0.1:5000 in your browser.")
    print("  Press Ctrl+C to stop it.\n")
    app.run(debug=True)
