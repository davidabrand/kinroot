# Kinroot backlog

Prioritized ideas for the coding agent. Work top-down; pick the highest item that
fits the Definition of Done in CLAUDE.md. Competitor-informed, but adapted to our
stack (Flask + Three.js, no paid APIs, free-tier friendly). Mark done with [x] and
a date; add new ideas with a one-line "why".

## High value, safe, good fit
- [ ] **Photos & stories per person** — multiple photos and dated "memories/stories",
      not just one portrait. The emotional core of the product. (Roadmap item.)
- [ ] **Life timeline** — a per-person (and per-family) timeline of events
      (born, married, children born, died, places lived). Competitors' most-loved view.
- [ ] **Source notes per fact** — let people record where a fact came from
      ("Grandma's letter", a certificate). Genealogy standard; builds trust in the data.

## Medium
- [ ] **Printable fan / pedigree chart** (2D) to complement the 3D view and the poster.
- [ ] **"On this day"** — surface births, deaths and anniversaries on the dashboard,
      not just upcoming birthdays.
- [ ] **GEDCOM merge into an existing tree** (needs duplicate detection). (Roadmap.)
- [ ] **Accessibility pass** — WCAG AA: contrast, focus order, labels, screen-reader
      structure across the main screens.
- [ ] **Undo for more actions** — unlink, edit, tree-level changes (we have it for delete).
- [ ] **"This is correct" on a consistency note** — let an editor dismiss a note they've
      verified (needs a small table). Why: a real 81-year-old father shouldn't nag forever.
- [ ] **Run consistency checks after a GEDCOM import** — show "N dates worth a second
      look" on the import result. Why: imports are where most bad dates come from.

## Needs a decision first (don't start without the owner)
- [ ] **Password reset + email verification** — needs an email provider; free
      PythonAnywhere blocks outbound email. Decide the sender first (see DEPLOY.md).
- [ ] **Map of ancestors' birthplaces** — nice, but geocoding needs an API/data;
      confirm a free, allowed source before building.
- [ ] **Large-tree performance** — instanced leaves, label culling for 500+ people.

## Done
- [x] 2026-10-04 **Time-of-day sky** (owner request) — the sky behind the tree follows the
      visitor's clock: stars + the moon in its real phase at night, a rosy blue hour,
      fiery sunrise, golden hour (unchanged signature colours), brighter midday. Richer
      three-band gradient with sun glow along the horizon; fireflies after dark.
      Preview any time with `?hour=5.5` in the address bar.
- [x] 2026-10-03 **Consistency checks** — "Worth a second look" notes on the person
      panel and the overview (editors only): died before born, lived past 120, born
      before a parent, parent under 12 / over 60 (mother) / over 80, born after a parent
      died. Fuzzy dates only flag certain problems. ("Two birth dates" doesn't apply:
      Kinroot stores one birth date per person.)
<!-- [x] 2026-10-03 Undo for deleting a person -->
