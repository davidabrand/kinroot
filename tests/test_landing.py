"""The homepage: its example family is honest, and every way in still works."""
from kinroot import landing
from kinroot.relationships import FamilyGraph


def _graph():
    people = [{"id": p[0], "first_name": p[2], "gender": p[9]} for p in landing.PEOPLE]
    return FamilyGraph(people, landing.relationships())


def test_homepage_relationship_claim_matches_kinroot():
    found = _graph().describe(landing.YOU, landing.ELENA)
    assert found["term"] == landing.RELATION_TERM == "second cousin once removed"
    assert found["path"] == landing.RELATION_PATH        # the gold route drawn is the route Kinroot finds


def test_scene_has_every_person_and_line():
    s = landing.scene()
    assert len(s["people"]) == len(landing.PEOPLE)
    assert len(s["lines"]) == sum(len(k) for k in landing.CHILDREN.values())
    assert s["relation_path"].startswith("M300 320")      # starts at "You"


def test_homepage_renders_story_and_entry_points(app):
    page = app.test_client().get("/").get_data(as_text=True)
    for section in ('id="home"', 'id="explore"', 'id="time"', 'id="relate"', 'id="together"', 'id="privacy"', 'id="begin"'):
        assert section in page
    assert "Second cousin <em>once removed</em>" in page
    assert 'href="/register"' in page and 'href="/login"' in page
    assert 'href="/register?next=/trees%23import"' in page          # "Import a GEDCOM" lands on the import option
    for fake in ("testimonial", "million", "★"):
        assert fake not in page.lower()


def test_logged_in_visitors_still_skip_the_homepage(app):
    from conftest import register
    c = app.test_client()
    register(c, "ann@example.com")
    resp = c.get("/")
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/trees")


def test_background_tree_is_never_tilted():
    """The homepage tree shifts and zooms between sections but must always stay level."""
    import re
    from pathlib import Path
    css = (Path(__file__).resolve().parent.parent / "static" / "css" / "landing.css").read_text(encoding="utf-8")
    for rule in re.findall(r"[^{}]*\.kt-world[^{}]*\{[^}]*\}", css):
        assert "rotate" not in rule and "skew" not in rule, rule.strip()


def test_phones_get_the_tree_inside_each_demo_section(app):
    """On phones the hero tree scrolls away; the sections that show something with the tree
    (time-lapse, relationship, together) carry their own framed copy instead of a floating one."""
    page = app.test_client().get("/").get_data(as_text=True)
    for section in ("time", "relate", "together"):
        chunk = page.split(f'id="{section}"', 1)[1].split("</section>", 1)[0]
        assert 'class="kr-scene kr-figure"' in chunk
