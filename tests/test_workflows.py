"""Workflow shortcuts: smart defaults and landing people where they need to be."""
from conftest import H, add, make_tree, register


def test_first_tree_name_is_prefilled(app):
    c = app.test_client()
    register(c, "ann@example.com", name="Ann Brand")
    page = c.get("/trees").get_data(as_text=True)
    assert 'value="The Brand family"' in page


def test_single_word_name_gets_no_guess(app):
    c = app.test_client()
    register(c, "cher@example.com", name="Cher")
    page = c.get("/trees").get_data(as_text=True)
    assert 'value=""' in page and "The Smith family" in page     # placeholder only


def test_tree_api_includes_my_name_for_add_myself(app):
    c = app.test_client()
    register(c, "ann@example.com", name="Ann Brand")
    tid = make_tree(c)
    assert c.get(f"/api/trees/{tid}").json["me"]["name"] == "Ann Brand"


def test_new_invite_lands_on_the_new_link(app):
    c = app.test_client()
    register(c, "ann@example.com", name="Ann Brand")
    tid = make_tree(c)
    resp = c.post(f"/trees/{tid}/share", data={"action": "create_invite", "role": "viewer"})
    assert resp.status_code == 302
    anchor = resp.headers["Location"].split("#")[1]
    assert anchor.startswith("invite-row-")
    assert f'id="{anchor}"' in c.get(f"/trees/{tid}/share").get_data(as_text=True)


def test_adding_a_sibling_or_a_child_of_two_parents(app):
    """The add form's "How are they related?" choices: a sibling shares the same parents,
    and a child can be linked to both parents (what the tree page sends)."""
    c = app.test_client()
    register(c, "sib@example.com")
    tid = make_tree(c)
    dad = add(c, tid, first_name="Tom", last_name="Hale")
    mum = add(c, tid, first_name="Ada", last_name="Hale", link={"to": dad, "as": "spouse"})
    kid = add(c, tid, first_name="Ben", last_name="Hale", link={"to": dad, "as": "child"})
    assert c.post(f"/api/trees/{tid}/relationships", json={"person": mum, "other": kid, "as": "parent"},
                  headers=H).status_code == 201
    # A sibling of Ben: added, then linked to each of Ben's parents.
    sis = add(c, tid, first_name="Cora", last_name="Hale")
    for parent in (dad, mum):
        assert c.post(f"/api/trees/{tid}/relationships", json={"person": parent, "other": sis, "as": "parent"},
                      headers=H).status_code == 201
    rel = c.get(f"/api/trees/{tid}/relationship?a={kid}&b={sis}", headers=H).get_json()
    assert rel["term"] in ("sister", "sibling")
