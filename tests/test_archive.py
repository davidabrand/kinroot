"""People, Relationships and Timeline pages: access, privacy and correct content."""
from conftest import H, add, make_tree, register


def _family(app):
    owner = app.test_client()
    register(owner, "owner@example.com", name="Ann Brand")
    tid = make_tree(owner)
    gran = add(owner, tid, first_name="Rose", last_name="Brand", birth_date="1902", death_date="1988", gender="female")
    mum = add(owner, tid, first_name="Joan", last_name="Brand", birth_date="12 May 1950", gender="female",
              link={"to": gran, "as": "child"})
    me = add(owner, tid, first_name="Ann", last_name="Brand", birth_date="3 Mar 1980", gender="female",
             link={"to": mum, "as": "child"})
    owner.post(f"/api/trees/{tid}/people/{me}/claim", headers=H)
    return owner, tid, {"gran": gran, "mum": mum, "me": me}


def test_people_page_names_relationships_to_you(app):
    owner, tid, ids = _family(app)
    page = owner.get(f"/trees/{tid}/people").get_data(as_text=True)
    assert "Everyone in the tree" in page
    assert "Your grandmother" in page and "Your mother" in page and ">You<" in page
    assert f'#person-{ids["gran"]}' in page                         # opens that person on the 3D tree
    listed = owner.get(f"/trees/{tid}/people?view=list").get_data(as_text=True)
    assert "<table" in listed and "12 May 1950" in listed


def test_relationships_page_draws_the_path(app):
    owner, tid, ids = _family(app)
    page = owner.get(f"/trees/{tid}/relationships?b={ids['gran']}").get_data(as_text=True)
    assert "Grandmother" in page                                    # from Kinroot's own engine, starting at you
    assert page.count('class="lineage-name"') == 3                  # Ann -> Joan -> Rose
    same = owner.get(f"/trees/{tid}/relationships?a={ids['me']}&b={ids['me']}").get_data(as_text=True)
    assert "lineage" not in same.split("</form>")[1]                # no result for the same person twice


def test_timeline_groups_by_decade(app):
    owner, tid, _ = _family(app)
    page = owner.get(f"/trees/{tid}/timeline").get_data(as_text=True)
    for decade in ("1900", "1950", "1980"):
        assert f">{decade}<span>s</span>" in page
    assert "Remembering <b>Rose Brand</b>" in page


def test_guests_never_see_living_relatives_dates(app):
    owner, tid, _ = _family(app)
    guest = app.test_client()
    register(guest, "cousin@example.com")
    owner.post(f"/trees/{tid}/share", data={"action": "add_member", "email": "cousin@example.com", "role": "viewer"})
    people = guest.get(f"/trees/{tid}/people?view=list").get_data(as_text=True)
    timeline = guest.get(f"/trees/{tid}/timeline").get_data(as_text=True)
    # Living relatives (Joan, Ann): no dates anywhere, not even in search data or the timeline.
    for page in (people, timeline):
        assert "12 May 1950" not in page and "3 Mar 1980" not in page
    assert 'data-search="joan brand 1950' not in people and "Private" in people
    assert "Joan Brand</b> is born" not in timeline and "Ann Brand</b> is born" not in timeline
    assert "Rose Brand</b> is born" in timeline                     # Rose has passed away: shown


def test_strangers_are_kept_out(app):
    _, tid, _ = _family(app)
    stranger = app.test_client()
    register(stranger, "stranger@example.com")
    for path in ("people", "relationships", "timeline"):
        assert stranger.get(f"/trees/{tid}/{path}").status_code in (403, 404)


def test_import_page_explains_and_offers_exports(app):
    owner, tid, _ = _family(app)
    page = owner.get("/trees/import").get_data(as_text=True)
    assert "Bring your family history" in page and 'enctype="multipart/form-data"' in page
    assert "Nothing is overwritten" in page and "Notes and photos stay in Kinroot" in page
    assert f"/trees/{tid}/export.ged" in page                      # each tree you can edit can be exported
