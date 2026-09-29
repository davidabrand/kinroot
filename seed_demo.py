"""Fill Kinroot with a demo family so you can see everything working.

Run once:   python seed_demo.py
Log in as:  demo@example.com / password123     (you are David Brand)
Also:       mia@example.com, leo@example.com, ruth@example.com (same password)

It creates five generations of the Brand family, a chat between David and his
sister Mia, a connection request from cousin Leo, and a second family (the
Cohens) who share an ancestor, so "Relatives you may have" has something to show.
"""
from datetime import date, timedelta

from kinroot import create_app

H = {"X-Requested-With": "Kinroot"}
PASSWORD = "password123"
app = create_app({"CSRF_ENABLED": False})


def client_for(email, name):
    c = app.test_client()
    r = c.post("/register", data={"name": name, "email": email, "password": PASSWORD})
    if r.status_code != 302 or "/register" in r.headers.get("Location", ""):
        c.post("/login", data={"email": email, "password": PASSWORD})
    return c


def new_tree(c, name):
    r = c.post("/trees/new", data={"name": name})
    return int(r.headers["Location"].rstrip("/").split("/")[-1])


def main():
    with app.app_context():
        from kinroot.db import connect
        db = connect(app.config["DB_PATH"])
        if db.execute("SELECT 1 FROM users WHERE email = 'demo@example.com'").fetchone():
            print("The demo family is already here. Log in as demo@example.com / password123")
            return

    today = date.today()

    def soon(days, year):
        """A birthday a few days from now, in an earlier year (so 'Coming up' has something to show)."""
        d = today + timedelta(days=days)
        return date(year, d.month, min(d.day, 28) if d.month == 2 else d.day).isoformat()

    david = client_for("demo@example.com", "David Brand")
    tid = new_tree(david, "The Brand family")

    def add(**f):
        r = david.post(f"/api/trees/{tid}/people", json=f, headers=H)
        assert r.status_code == 201, r.json
        return r.json["person"]["id"]

    def link(a, b, as_what):
        david.post(f"/api/trees/{tid}/relationships", json={"person": a, "other": b, "as": as_what}, headers=H)

    isaac = add(first_name="Isaac", last_name="Brand", gender="male", birth_date="1890", death_date="1962",
                birth_place="Białystok, Poland", notes="Came to New York in 1912 with one suitcase and a sewing machine.")
    rose = add(first_name="Rose", last_name="Brand", gender="female", birth_date="about 1894", death_date="1970",
               link={"to": isaac, "as": "spouse"})
    joseph = add(first_name="Joseph", last_name="Brand", gender="male", birth_date=soon(20, 1921), death_date="20 Nov 1998",
                 birth_place="Brooklyn, New York", notes="Ran the corner hardware store on Nostrand Avenue for 41 years.",
                 link={"to": isaac, "as": "child"})
    link(rose, joseph, "parent")
    ann = add(first_name="Ann", last_name="Brand", gender="female", birth_date="about 1925", death_date="2011",
              link={"to": joseph, "as": "spouse"})
    samuel = add(first_name="Samuel", last_name="Brand", gender="male", birth_date="1950-01-09", link={"to": joseph, "as": "child"})
    link(ann, samuel, "parent")
    linda = add(first_name="Linda", last_name="Brand", gender="female", birth_date="1952-06-30", link={"to": samuel, "as": "spouse"})
    ruth = add(first_name="Ruth", last_name="Katz", gender="female", birth_date="1953-04-22", link={"to": joseph, "as": "child"})
    link(ann, ruth, "parent")
    aaron = add(first_name="Aaron", last_name="Katz", gender="male", birth_date="1951", link={"to": ruth, "as": "spouse"})
    me = add(first_name="David", last_name="Brand", gender="male", birth_date="1980-02-11", birth_place="Queens, New York",
             link={"to": samuel, "as": "child"})
    link(linda, me, "parent")
    emma = add(first_name="Emma", last_name="Brand", gender="female", birth_date="1982-08-19", link={"to": me, "as": "spouse"})
    mia = add(first_name="Mia", last_name="Brand", gender="female", birth_date=soon(9, 1984), link={"to": samuel, "as": "child"})
    link(linda, mia, "parent")
    leo = add(first_name="Leo", last_name="Katz", gender="male", birth_date="1979-12-12", link={"to": ruth, "as": "child"})
    link(aaron, leo, "parent")
    nora = add(first_name="Nora", last_name="Katz", gender="female", birth_date="1983", link={"to": ruth, "as": "child"})
    link(aaron, nora, "parent")
    lily = add(first_name="Lily", last_name="Brand", gender="female", birth_date="2012-05-14", link={"to": me, "as": "child"})
    link(emma, lily, "parent")
    owen = add(first_name="Owen", last_name="Brand", gender="male", birth_date="2015", link={"to": me, "as": "child"})
    link(emma, owen, "parent")
    david.post(f"/api/trees/{tid}/people/{me}/claim", headers=H)

    # Relatives with their own accounts.
    mia_c = client_for("mia@example.com", "Mia Brand")
    leo_c = client_for("leo@example.com", "Leo Katz")
    for email, role in (("mia@example.com", "editor"), ("leo@example.com", "viewer")):
        david.post(f"/trees/{tid}/share", data={"action": "add_member", "email": email, "role": role})
    mia_c.post(f"/api/trees/{tid}/people/{mia}/claim", headers=H)
    leo_c.post(f"/api/trees/{tid}/people/{leo}/claim", headers=H)

    ids = {row["email"]: row["id"] for row in connect_rows("SELECT id, email FROM users")}
    cid = mia_c.post("/api/family/requests", json={"user_id": ids["demo@example.com"], "note": "Found you on the tree!", "via_tree_id": tid}, headers=H).json["connection_id"]
    david.post(f"/family/{cid}/respond", data={"action": "accept"})
    mia_c.post(f"/api/family/{cid}/messages", json={"body": "I found Grandpa Joe's old store sign in Mom's garage!"}, headers=H)
    david.post(f"/api/family/{cid}/messages", json={"body": "No way. Can you take a photo? I'll add it to his leaf."}, headers=H)
    mia_c.post(f"/api/family/{cid}/messages", json={"body": "Sending it tonight. Also, it's my birthday soon, just saying."}, headers=H)
    leo_c.post("/api/family/requests", json={"user_id": ids["demo@example.com"], "via_tree_id": tid,
                                              "note": "Hi David, it's Leo, Aunt Ruth's son. Want to help with Great-grandpa Isaac's side?"}, headers=H)

    # Another family who shares Isaac Brand, and lets others find shared ancestors.
    ruth_c = client_for("ruth@example.com", "Ruth Cohen")
    other = new_tree(ruth_c, "Cohen–Brand cousins")
    r1 = ruth_c.post(f"/api/trees/{other}/people", json={"first_name": "Isaac", "last_name": "Brand", "gender": "male",
                                                          "birth_date": "1890", "death_date": "1962"}, headers=H).json["person"]["id"]
    ruth_c.post(f"/api/trees/{other}/people", json={"first_name": "Morris", "last_name": "Brand", "gender": "male",
                                                     "birth_date": "1923", "death_date": "2001", "link": {"to": r1, "as": "child"}}, headers=H)
    ruth_c.post(f"/trees/{other}/share", data={"action": "privacy", "hide_living": "on", "discoverable": "on"})

    print("Demo family ready. Start Kinroot with 'python app.py' and log in as demo@example.com / password123")


def connect_rows(sql):
    from kinroot.db import connect
    db = connect(app.config["DB_PATH"])
    rows = db.execute(sql).fetchall()
    db.close()
    return rows


if __name__ == "__main__":
    main()
