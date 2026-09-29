"""Connection requests and messages between relatives."""
from conftest import H, add, make_tree, register


def setup_two_relatives(app):
    dave, mia, stranger = app.test_client(), app.test_client(), app.test_client()
    register(dave, "dave@example.com", "Dave Brand")
    register(mia, "mia@example.com", "Mia Brand")
    register(stranger, "stranger@example.com", "Stranger Danger")
    tid = make_tree(dave, "The Brand family")
    sam = add(dave, tid, first_name="Sam", gender="male")
    d = add(dave, tid, first_name="David", gender="male", link={"to": sam, "as": "child"})
    m = add(dave, tid, first_name="Mia", gender="female", link={"to": sam, "as": "child"})
    dave.post(f"/trees/{tid}/share", data={"action": "add_member", "email": "mia@example.com", "role": "viewer"})
    assert dave.post(f"/api/trees/{tid}/people/{d}/claim", headers=H).status_code == 200
    assert mia.post(f"/api/trees/{tid}/people/{m}/claim", headers=H).status_code == 200
    return dave, mia, stranger, tid


def test_request_accept_and_message(app):
    dave, mia, stranger, tid = setup_two_relatives(app)
    # Strangers who share no tree can't send requests.
    assert stranger.post("/api/family/requests", json={"user_id": 1}, headers=H).status_code == 400

    r = dave.post("/api/family/requests", json={"user_id": 2, "note": "Hi sis!", "via_tree_id": tid}, headers=H)
    assert r.status_code == 200 and r.json["state"] == "pending_out"
    cid = r.json["connection_id"]
    # Not connected yet: no messaging.
    assert dave.post(f"/api/family/{cid}/messages", json={"body": "hello?"}, headers=H).status_code == 403

    hub = mia.get("/family")
    assert b"Dave Brand" in hub.data and b"Your brother" in hub.data and b"Hi sis!" in hub.data
    assert mia.get("/api/family/counts").json["requests"] == 1
    assert mia.post(f"/family/{cid}/respond", data={"action": "accept"}).status_code == 302

    sent = dave.post(f"/api/family/{cid}/messages", json={"body": "Found Grandpa's old letters!"}, headers=H)
    assert sent.status_code == 201
    assert mia.get("/api/family/counts").json["unread"] == 1
    got = mia.get(f"/api/family/{cid}/messages?after=0").json["messages"]
    assert got[0]["body"] == "Found Grandpa's old letters!" and got[0]["mine"] is False
    assert mia.get("/api/family/counts").json["unread"] == 0
    assert stranger.get(f"/api/family/{cid}/messages").status_code == 404
    page = mia.get(f"/family/{cid}")
    assert page.status_code == 200 and b"Your brother" in page.data

    # The tree shows Mia as connected, with a Message button's target.
    people = {p["first_name"]: p for p in dave.get(f"/api/trees/{tid}").json["people"]}
    assert people["Mia"]["account"]["connection"] == "connected"
    assert people["David"]["account"]["connection"] == "self"


def test_decline_is_silent_and_block_stops_requests(app):
    dave, mia, _stranger, tid = setup_two_relatives(app)
    cid = dave.post("/api/family/requests", json={"user_id": 2}, headers=H).json["connection_id"]
    mia.post(f"/family/{cid}/respond", data={"action": "decline"})
    # Dave still just sees "sent", and sending again doesn't nag Mia.
    again = dave.post("/api/family/requests", json={"user_id": 2}, headers=H)
    assert again.json["state"] == "pending_out"
    assert mia.get("/api/family/counts").json["requests"] == 0
    # Mia can still reach out to Dave later.
    r = mia.post("/api/family/requests", json={"user_id": 1}, headers=H)
    assert r.json["state"] == "pending_out"
    dave.post(f"/family/{r.json['connection_id']}/respond", data={"action": "block"})
    assert mia.post("/api/family/requests", json={"user_id": 1}, headers=H).status_code == 400


def test_mutual_requests_connect_automatically(app):
    dave, mia, _stranger, _tid = setup_two_relatives(app)
    dave.post("/api/family/requests", json={"user_id": 2}, headers=H)
    r = mia.post("/api/family/requests", json={"user_id": 1}, headers=H)
    assert r.json["state"] == "connected"


def test_discovery_matches_only_opted_in_ancestors(app):
    dave, other = app.test_client(), app.test_client()
    register(dave, "dave@example.com", "Dave Brand")
    register(other, "ruth@example.com", "Ruth Katz")
    mine = make_tree(dave, "Brands")
    theirs = make_tree(other, "Katz family")
    my_joe = add(dave, mine, first_name="Joseph", last_name="Brand", birth_date="1921", deceased=True)
    their_joe = add(other, theirs, first_name="Joseph", last_name="Brand", birth_date="1921", death_date="1998")
    add(other, theirs, first_name="Mia", last_name="Brand", birth_date="1984")          # living: never matched
    add(dave, mine, first_name="Mia", last_name="Brand", birth_date="1984")

    assert b"Ruth K." not in dave.get("/family").data        # not discoverable yet
    other.post(f"/trees/{theirs}/share", data={"action": "privacy", "hide_living": "on", "discoverable": "on"})
    hub = dave.get("/family").data
    assert b"Ruth K." in hub and b"Joseph Brand, born 1921" in hub and b"Mia Brand, born 1984" not in hub

    r = dave.post("/api/family/requests", json={"user_id": 2, "via_person_id": my_joe, "match_person_id": their_joe,
                                                "note": "I think we share Joseph!"}, headers=H)
    assert r.status_code == 200 and r.json["state"] == "pending_out"
    assert b"Found Joseph Brand (born 1921) in both your trees" in other.get("/family").data
