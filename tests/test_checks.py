"""Consistency checks: impossible and unlikely dates."""
from datetime import date

import pytest

from conftest import H, add, make_tree, register
from kinroot.checks import date_range, find_issues


def person(pid, first, birth="", death="", gender=""):
    return {"id": pid, "first_name": first, "last_name": "Brand", "gender": gender,
            "birth_date": birth, "death_date": death}


def parent(a, b):
    return {"person_a": a, "person_b": b, "kind": "parent"}


def levels(issues, pid):
    return [i["level"] for i in issues.get(pid, [])]


@pytest.mark.parametrize("stored, lo, hi", [
    ("1921-03-02", date(1921, 3, 2), date(1921, 3, 2)),
    ("1921-02", date(1921, 2, 1), date(1921, 2, 28)),
    ("1921", date(1921, 1, 1), date(1921, 12, 31)),
    ("~1921", date(1919, 1, 1), date(1923, 12, 31)),
    ("~1920-02-29", date(1918, 2, 28), date(1922, 2, 28)),
    ("<1900", date(1, 1, 1), date(1899, 12, 31)),
    (">1900", date(1901, 1, 1), date(9999, 12, 31)),
])
def test_date_range(stored, lo, hi):
    assert date_range(stored) == (lo, hi)
    assert date_range("") is None


def test_a_sensible_family_has_no_issues():
    people = [person(1, "Ann", "1920", "1990", "female"), person(2, "Sam", "1950-06-01")]
    assert find_issues(people, [parent(1, 2)]) == {}


def test_died_before_born_and_very_long_life():
    people = [person(1, "Ann", "1921-05", "1921-03"), person(2, "Joe", "1800", "1950")]
    issues = find_issues(people, [])
    assert levels(issues, 1) == ["impossible"]
    assert "died" in issues[1][0]["text"]
    assert levels(issues, 2) == ["unlikely"]


def test_child_born_before_parent_shows_on_both():
    people = [person(1, "Ann", "1960"), person(2, "Sam", "1950")]
    issues = find_issues(people, [parent(1, 2)])
    assert levels(issues, 1) == levels(issues, 2) == ["impossible"]
    assert issues[1][0]["text"] == "Sam Brand was born before their parent, Ann Brand."


def test_parent_ages():
    young = [person(1, "Ann", "1950"), person(2, "Sam", "1958")]
    assert levels(find_issues(young, [parent(1, 2)]), 2) == ["unlikely"]
    old_mother = [person(1, "Ann", "1900", gender="female"), person(2, "Sam", "1965")]
    assert levels(find_issues(old_mother, [parent(1, 2)]), 2) == ["unlikely"]
    old_father = [person(1, "Abe", "1900", gender="male"), person(2, "Sam", "1965")]
    assert find_issues(old_father, [parent(1, 2)]) == {}


def test_born_after_a_parent_died():
    mother = [person(1, "Ann", "1900", "1940-01-01", "female"), person(2, "Sam", "1940-06-01")]
    assert levels(find_issues(mother, [parent(1, 2)]), 2) == ["impossible"]
    father = [person(1, "Abe", "1900", "1940-01-01", "male"), person(2, "Sam", "1940-06-01")]
    assert find_issues(father, [parent(1, 2)]) == {}           # within nine months: fine
    late = [person(1, "Abe", "1900", "1940-01-01", "male"), person(2, "Sam", "1941-06-01")]
    assert levels(find_issues(late, [parent(1, 2)]), 2) == ["impossible"]


def test_fuzzy_dates_only_flag_certain_problems():
    # "about 1950" could be 1948-1952, so a child born 1961 is still plausible.
    people = [person(1, "Ann", "~1950"), person(2, "Sam", "1961")]
    assert find_issues(people, [parent(1, 2)]) == {}
    # Open-ended dates never crash and don't invent problems.
    people = [person(1, "Ann", ">1900", ">1950", "male"), person(2, "Sam", "<1990")]
    assert find_issues(people, [parent(1, 2)]) == {}


def test_api_shows_issues_to_editors_but_not_viewers(app):
    owner, viewer = app.test_client(), app.test_client()
    register(owner, "owner@example.com")
    register(viewer, "cousin@example.com")
    tid = make_tree(owner)
    ann = add(owner, tid, first_name="Ann", birth_date="1960", death_date="2000", deceased=True)
    add(owner, tid, first_name="Sam", birth_date="1950", death_date="2010", deceased=True,
        link={"to": ann, "as": "child"})
    seen = {p["first_name"]: p for p in owner.get(f"/api/trees/{tid}").json["people"]}
    assert seen["Ann"]["issues"][0]["level"] == "impossible"
    assert seen["Sam"]["issues"]

    owner.post(f"/trees/{tid}/share", data={"action": "add_member", "email": "cousin@example.com", "role": "viewer"})
    for p in viewer.get(f"/api/trees/{tid}").json["people"]:
        assert p["issues"] == []

    # Fixing the date clears the warning.
    owner.put(f"/api/trees/{tid}/people/{ann}", json={"birth_date": "1925"}, headers=H)
    assert all(not p["issues"] for p in owner.get(f"/api/trees/{tid}").json["people"])
