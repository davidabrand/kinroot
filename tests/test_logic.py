"""Dates, relationship names and GEDCOM files (no web server needed)."""
from datetime import date

import pytest

from kinroot import gedcom
from kinroot.dates import DateError, format_date, parse_date, to_gedcom
from kinroot.relationships import FamilyGraph, blood_term

TODAY = date(2026, 9, 28)


@pytest.mark.parametrize("typed, stored, shown", [
    ("1921-03-02", "1921-03-02", "2 Mar 1921"),
    ("3/2/1921", "1921-03-02", "2 Mar 1921"),
    ("March 2, 1921", "1921-03-02", "2 Mar 1921"),
    ("Mar 1921", "1921-03", "Mar 1921"),
    ("1921", "1921", "1921"),
    ("about 1921", "~1921", "about 1921"),
    ("c. 1921", "~1921", "about 1921"),
    ("BEF 1900", "<1900", "before 1900"),
    ("ABT 2 MAR 1921", "~1921-03-02", "about 2 Mar 1921"),
    ("BET 1900 AND 1910", "~1905", "about 1905"),
    ("1750/51", "1750", "1750"),
    ("1921/03/02", "1921-03-02", "2 Mar 1921"),
])
def test_dates(typed, stored, shown):
    assert parse_date(typed, TODAY) == stored
    assert format_date(stored) == shown


@pytest.mark.parametrize("bad", ["31 Feb 1921", "2099", "yesterday", "13/1/1921"])
def test_bad_dates(bad):
    with pytest.raises(DateError):
        parse_date(bad, TODAY)


def test_gedcom_date_round_trip():
    for value in ("1921-03-02", "1921-03", "1921", "~1921", "<1900", ">1850"):
        assert parse_date(to_gedcom(value), TODAY) == value


@pytest.mark.parametrize("up_a, up_b, gender, term", [
    (1, 0, "m", "father"), (2, 0, "f", "grandmother"), (4, 0, None, "great-great-grandparent"),
    (5, 0, "m", "3rd great-grandfather"), (0, 3, "f", "great-granddaughter"), (1, 1, "f", "sister"),
    (2, 1, "m", "uncle"), (3, 1, "f", "great-aunt"), (1, 2, None, "niece or nephew"),
    (2, 2, None, "first cousin"), (3, 3, None, "second cousin"), (2, 3, None, "first cousin once removed"),
    (4, 2, None, "first cousin twice removed"), (5, 4, None, "third cousin once removed"),
])
def test_blood_terms(up_a, up_b, gender, term):
    assert blood_term(up_a, up_b, gender) == term


def family():
    P = lambda i, n, g="": {"id": i, "first_name": n, "gender": g}   # noqa: E731
    R = lambda a, b, k="parent": {"person_a": a, "person_b": b, "kind": k}   # noqa: E731
    people = [P(1, "Joe", "male"), P(2, "Ann", "female"), P(3, "Sam", "male"), P(4, "Ruth", "female"),
              P(5, "Linda", "female"), P(6, "David", "male"), P(7, "Mia", "female"), P(8, "Leo", "male"),
              P(9, "Tom", "male"), P(10, "Kid", "")]
    rels = [R(1, 2, "spouse"), R(1, 3), R(2, 3), R(1, 4), R(2, 4), R(3, 5, "spouse"), R(3, 6), R(5, 6),
            R(3, 7), R(5, 7), R(4, 8), R(9, 4, "spouse"), R(9, 10)]
    return FamilyGraph(people, rels)


@pytest.mark.parametrize("a, b, sentence", [
    (6, 7, "Mia is David's sister."),
    (6, 8, "Leo is David's first cousin."),
    (6, 4, "Ruth is David's aunt."),
    (6, 9, "Tom is David's uncle by marriage."),
    (5, 2, "Ann is Linda's mother-in-law."),
    (4, 5, "Linda is Ruth's sister-in-law."),
    (10, 4, "Ruth is Kid's stepmother."),
    (4, 10, "Kid is Ruth's stepchild."),
])
def test_describe(a, b, sentence):
    assert family().describe(a, b)["sentence"] == sentence


def test_gedcom_parse_and_export():
    text = b"""0 HEAD
0 @N1@ NOTE Kept bees.
1 CONT Grew tomatoes.
0 @I1@ INDI
1 NAME Joseph /Brand/ Jr
1 SEX M
1 BIRT
2 DATE ABT MAR 1921
2 PLAC Brooklyn
1 DEAT Y
1 NOTE @N1@
0 @I2@ INDI
1 NAME Ann /Brand/
1 SEX F
0 @I3@ INDI
1 NAME Sam /Brand/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR
"""
    parsed = gedcom.parse(text)
    joe = parsed["people"][0]
    assert joe["first_name"] == "Joseph Jr" and joe["last_name"] == "Brand"
    assert joe["birth_date"] == "~1921-03" and joe["deceased"] == 1
    assert joe["notes"] == "Kept bees.\nGrew tomatoes."
    assert parsed["families"] == [{"parents": ["@I1@", "@I2@"], "children": ["@I3@"]}]

    people = [dict(id=i + 1, first_name=p["first_name"], last_name=p["last_name"], gender=p["gender"],
                   birth_date=p["birth_date"], birth_place=p["birth_place"], death_date=p["death_date"],
                   deceased=p["deceased"], notes=p["notes"]) for i, p in enumerate(parsed["people"])]
    rels = [{"person_a": 1, "person_b": 2, "kind": "spouse"}, {"person_a": 1, "person_b": 3, "kind": "parent"},
            {"person_a": 2, "person_b": 3, "kind": "parent"}]
    again = gedcom.parse(gedcom.export("Brands", people, rels).encode())
    assert [p["first_name"] for p in again["people"]] == ["Joseph Jr", "Ann", "Sam"]
    assert again["people"][0]["notes"] == "Kept bees.\nGrew tomatoes."
    assert again["families"][0]["children"] == ["@I3@"]


def test_not_a_gedcom_file():
    with pytest.raises(gedcom.GedcomError):
        gedcom.parse(b"hello world")
