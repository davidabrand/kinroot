# Kinroot roadmap

The plan we agreed on, one step at a time. `[x]` is done; `[ ]` is still to do.
Items marked **(you)** need a person, not code.

## 1. Name and brand
- [x] Name: **Kinroot** (kin = family, root = heritage)
- [x] Logo: a sprouting "K" whose arms are a leaf and a branch, with the evening sun in the notch
- [x] Golden-hour palette (canopy green, misty sage, honey, leaf, bark) in light and dark mode
- [x] Type: Alegreya for headings, Alegreya Sans for everything else
- [x] Tagline: "Your family tree, in its best light."
- [ ] **(you)** Check that kinroot.com (or .app / .family) is free, and do a trademark search before spending money on the name

## 2. See it running
- [x] Started on Dave's PC with `run.bat` and `load_demo.bat`
- [x] Checked the real 3D view and fixed what looked wrong: the first camera framing, branches that curled into loops,
      the partner vine crossing portraits, crowded name labels, faded people not fading, branches crossing faces,
      and labels colliding on phones
- [ ] **(you)** Explore the demo yourself and list what you'd change: that's the next design pass
- [ ] Try it on a real phone on the same Wi-Fi (run with `app.run(host="0.0.0.0")`)

## 3. Blender models
- [x] `build_assets.py` makes the medallion, trunk and leaf ring
- [x] `render_poster.py` renders your tree as a printable golden-hour poster
- [ ] **(you)** Run both in Blender 4.x and report anything that errors (they couldn't be run where they were written)
- [ ] Richer shapes: bark texture, varied leaves, a carved nameplate under each medallion
- [ ] Seasonal trees (spring blossom, autumn gold, winter snow)

## 4. Design pass
- [x] Landing page with the hero illustration
- [x] Sign up / log in, dashboard with mini tree previews and "Coming up" birthdays
- [x] Tree page: search, time-lapse bar, relationship finder, flat view, phone layout
- [x] Sharing & settings, Family hub, chat, account pages
- [ ] Tune after step 2 (we'll adjust what looks off on a real screen)
- [ ] Share preview image for links (so a shared link shows the tree)

## 5. Real-world features
- [x] GEDCOM import (as a new tree) and export
- [x] Search, focus on a branch, "How are we related?", flat 2D view
- [x] Privacy for living relatives
- [x] Invite links that claim a leaf
- [x] Connection requests (accept / silent decline / block), messages, unread counts
- [x] "Relatives you may have": opt-in shared-ancestor matching (deceased only)
- [x] Time-lapse "Watch your family grow"
- [ ] Merge a GEDCOM into an existing tree (needs duplicate detection)
- [ ] Photos gallery and stories per person (more than one photo, dated memories)
- [ ] Report a message (needed before strangers can match at scale)
- [ ] Big trees (500+ people): draw leaves with instancing, hide far-away labels
- [ ] Undo for deletions

## 6. Go live
- [ ] Hosting (PythonAnywhere or Render are the easiest for Flask) and a real domain
- [ ] A production server (`waitress-serve app:app`) and HTTPS
- [ ] Email: invite links by email, password reset, "you have a new message" notifications
- [ ] Nightly backups of `instance/`
- [ ] Privacy policy and terms (needed once strangers can sign up)
- [ ] Delete-my-account and download-my-data buttons

## 7. Launch
- [ ] A public demo tree anyone can explore
- [ ] Poster prints as a paid extra (Blender render → print shop)
- [ ] Short screen recording of the time-lapse for social media

## Things we decided (and why)
- **Dates are text, not a calendar picker**: family records are often "about 1921" or just a year.
- **Declines are silent**: the sender keeps seeing "Request sent", so nobody feels rejected.
- **Matching only uses people who've passed away**, and only in trees whose owners opt in.
- **Two parents per person** for now. Adoptive and step-parents need a "type of parent" field later.
