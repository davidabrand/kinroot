"""Workflow shortcuts: smart defaults and landing people where they need to be."""
from conftest import make_tree, register


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
