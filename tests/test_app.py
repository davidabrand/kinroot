"""Accounts, trees, people, sharing and privacy. Run all tests with:  python -m pytest"""
import io
import sqlite3

from conftest import H, add, make_tree, register

from kinroot import create_app
from kinroot.db import MIGRATIONS


def test_landing_register_login_and_logout(app):
    c = app.test_client()
    assert b"in its best light" in c.get("/").data
    assert register(c, "dave@example.com", "Dave Brand").status_code == 302
    assert c.get("/").status_code == 302                      # logged in: landing sends you to your trees
    tid = make_tree(c)
    assert c.get(f"/trees/{tid}").status_code == 200
    c.post("/logout")
    assert c.get(f"/trees/{tid}").status_code == 302          # now asks you to log in
    assert c.post("/login", data={"email": "dave@example.com", "password": "nope"}).status_code == 200
    assert c.post("/login", data={"email": "dave@example.com", "password": "password123"}).status_code == 302


def test_sign_in_pages_keep_where_you_were_headed(app):
    c = app.test_client()
    page = c.get("/login?next=/join/abc").get_data(as_text=True)
    nav = page.split("</nav>")[0]
    assert 'action="/login?next=/join/abc"' in page                 # no #sign-in to trail onto the next page
    assert 'href="/register?next=/join/abc#sign-up"' in page        # switching forms keeps the invite
    assert 'href="/register?next=/join/abc">Start your tree' in nav  # ...and so does the top bar
    assert ">Log in</a>" not in nav                                  # no link to the page you're on
    page = c.get("/register").get_data(as_text=True)
    assert 'id="sign-up"' in page and 'href="/login#sign-in"' in page
    assert "Start your tree</a>" not in page.split("</nav>")[0]


def test_people_dates_and_relationships(app):
    c = app.test_client()
    register(c, "dave@example.com")
    tid = make_tree(c)
    joe = add(c, tid, first_name="Joe", last_name="Brand", birth_date="2 Mar 1921", death_date="1998", gender="male")
    ann = add(c, tid, first_name="Ann", birth_date="about 1925", gender="female", link={"to": joe, "as": "spouse"})
    sam = add(c, tid, first_name="Sam", link={"to": joe, "as": "child"})
    assert c.post(f"/api/trees/{tid}/relationships", json={"person": ann, "other": sam, "as": "parent"}, headers=H).status_code == 201
    # Can't make someone their own ancestor, or give a child three parents.
    assert c.post(f"/api/trees/{tid}/relationships", json={"person": sam, "other": joe, "as": "parent"}, headers=H).status_code == 400
    extra = add(c, tid, first_name="Extra")
    assert c.post(f"/api/trees/{tid}/relationships", json={"person": extra, "other": sam, "as": "parent"}, headers=H).status_code == 400

    data = c.get(f"/api/trees/{tid}").json
    people = {p["id"]: p for p in data["people"]}
    assert people[joe]["birth_date"] == "1921-03-02" and people[joe]["birth_display"] == "2 Mar 1921"
    assert people[joe]["deceased"] is True and people[joe]["death_year"] == 1998
    assert people[ann]["birth_display"] == "about 1925"
    bad = c.put(f"/api/trees/{tid}/people/{sam}", json={"birth_date": "31 Feb 1950"}, headers=H)
    assert bad.status_code == 400 and "Born" in bad.json["error"]

    rel = c.get(f"/api/trees/{tid}/relationship?a={sam}&b={joe}").json
    assert rel["sentence"] == "Joe is Sam's father." and rel["path"] == [sam, joe]
    assert c.delete(f"/api/trees/{tid}/people/{sam}", headers=H).status_code == 200
    assert len(c.get(f"/api/trees/{tid}").json["relationships"]) == 1


def test_sharing_roles_and_privacy(app):
    owner, viewer, stranger = app.test_client(), app.test_client(), app.test_client()
    register(owner, "owner@example.com")
    register(viewer, "cousin@example.com")
    register(stranger, "stranger@example.com")
    tid = make_tree(owner)
    add(owner, tid, first_name="Mia", birth_date="1984-09-03", birth_place="Queens", notes="Loves maps")
    add(owner, tid, first_name="Joe", birth_date="1921", deceased=True, birth_place="Brooklyn")
    owner.post(f"/trees/{tid}/share", data={"action": "add_member", "email": "cousin@example.com", "role": "viewer"})

    seen = {p["first_name"]: p for p in viewer.get(f"/api/trees/{tid}").json["people"]}
    assert seen["Mia"]["private"] and seen["Mia"]["birth_date"] == "" and seen["Mia"]["notes"] == ""
    assert not seen["Joe"]["private"] and seen["Joe"]["birth_place"] == "Brooklyn"
    assert viewer.post(f"/api/trees/{tid}/people", json={"first_name": "X"}, headers=H).status_code == 403
    assert stranger.get(f"/api/trees/{tid}").status_code == 404
    assert viewer.get(f"/trees/{tid}/share").status_code == 403
    assert viewer.get(f"/trees/{tid}/export.ged").status_code == 403

    owner.post(f"/trees/{tid}/share", data={"action": "privacy", "discoverable": "on"})   # hide_living switched off
    seen = {p["first_name"]: p for p in viewer.get(f"/api/trees/{tid}").json["people"]}
    assert seen["Mia"]["birth_date"] == "1984-09-03"

    owner.post(f"/trees/{tid}/share", data={"action": "set_role", "user_id": 2, "role": "editor"})
    assert viewer.post(f"/api/trees/{tid}/people", json={"first_name": "X"}, headers=H).status_code == 201


def test_invite_link_claims_a_leaf(app):
    owner, mia = app.test_client(), app.test_client()
    register(owner, "owner@example.com", "Dave Brand")
    tid = make_tree(owner)
    mia_leaf = add(owner, tid, first_name="Mia", last_name="Brand")
    owner.post(f"/trees/{tid}/share", data={"action": "create_invite", "role": "editor", "person_id": mia_leaf})
    with app.app_context():
        from kinroot.db import connect
        db = connect(app.config["DB_PATH"])
        token = db.execute("SELECT token FROM invites").fetchone()["token"]
    page = mia.get(f"/join/{token}")
    assert page.status_code == 200 and b"saved a leaf for you" in page.data
    register(mia, "mia@example.com", "Mia Brand")
    assert mia.post(f"/join/{token}").status_code == 302
    data = mia.get(f"/api/trees/{tid}").json
    assert data["role"] == "editor" and data["me"]["person_id"] == mia_leaf
    # Person-specific links work once.
    assert app.test_client().get(f"/join/{token}").status_code == 410


def test_api_writes_need_header_and_forms_need_token(app, tmp_path):
    c = app.test_client()
    register(c, "dave@example.com")
    tid = make_tree(c)
    assert c.post(f"/api/trees/{tid}/people", json={"first_name": "X"}).status_code == 400
    strict = create_app({"INSTANCE_DIR": str(tmp_path / "strict"), "DB_PATH": str(tmp_path / "strict.db"),
                         "UPLOAD_DIR": str(tmp_path / "strict_up")})
    assert strict.test_client().post("/register", data={"name": "A", "email": "a@b.co", "password": "password123"}).status_code == 400


def test_photo_upload_checks_the_file(app):
    c = app.test_client()
    register(c, "dave@example.com")
    tid = make_tree(c)
    pid = add(c, tid, first_name="Joe")
    fake = c.post(f"/api/trees/{tid}/people/{pid}/photo", data={"photo": (io.BytesIO(b"<html>"), "x.png")},
                  headers=H, content_type="multipart/form-data")
    assert fake.status_code == 400
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    ok = c.post(f"/api/trees/{tid}/people/{pid}/photo", data={"photo": (io.BytesIO(png), "joe.png")},
                headers=H, content_type="multipart/form-data")
    assert ok.status_code == 200
    url = ok.json["person"]["photo_url"]
    assert c.get(url).status_code == 200
    assert app.test_client().get(url).status_code == 302   # not logged in


def test_gedcom_import_and_dashboard(app):
    c = app.test_client()
    register(c, "dave@example.com")
    ged = b"""0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Joseph /Brand/
1 SEX M
1 BIRT
2 DATE 2 MAR 1921
2 PLAC Brooklyn, New York
1 DEAT
2 DATE 20 NOV 1998
0 @I2@ INDI
1 NAME Ann /Brand/
1 SEX F
1 BIRT
2 DATE ABT 1925
0 @I3@ INDI
1 NAME Samuel /Brand/
1 SEX M
1 BIRT
2 DATE 1950
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR
"""
    resp = c.post("/trees/import", data={"gedcom": (io.BytesIO(ged), "brand_family.ged"), "name": ""},
                  content_type="multipart/form-data")
    assert resp.status_code == 302
    tid = int(resp.headers["Location"].rstrip("/").split("/")[-1])
    data = c.get(f"/api/trees/{tid}").json
    assert len(data["people"]) == 3 and len(data["relationships"]) == 3
    assert c.get(f"/api/trees/{tid}/relationship?a=3&b=1").json["term"] == "father"
    dash = c.get("/trees")
    assert dash.status_code == 200 and b"brand family" in dash.data
    exported = c.get(f"/trees/{tid}/export.ged").data.decode()
    assert "1 NAME Joseph /Brand/" in exported and "2 DATE ABT 1925" in exported


def test_old_databases_are_upgraded(tmp_path):
    """A database made by the first version (before Kinroot) keeps its data."""
    db = sqlite3.connect(tmp_path / "old.db")
    db.executescript(MIGRATIONS[0])
    db.execute("INSERT INTO users (email, name, password_hash) VALUES ('a@b.co', 'A', 'x')")
    db.execute("INSERT INTO trees (name, owner_id) VALUES ('Old tree', 1)")
    db.execute("INSERT INTO people (tree_id, first_name, birth_date) VALUES (1, 'Joe', '1921-03-02')")
    db.commit()
    db.close()
    app = create_app({"INSTANCE_DIR": str(tmp_path), "DB_PATH": str(tmp_path / "old.db"), "UPLOAD_DIR": str(tmp_path / "up")})
    with app.app_context():
        from kinroot.db import connect
        conn = connect(app.config["DB_PATH"])
        row = conn.execute("SELECT birth_year, deceased FROM people").fetchone()
        assert row["birth_year"] == 1921 and row["deceased"] == 0
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
