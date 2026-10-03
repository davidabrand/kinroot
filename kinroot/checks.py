"""Consistency checks: gentle warnings about dates that look impossible or unlikely.

Family records are messy, so these are hints for people who can edit the tree,
never errors that block saving. Each finding is either:

    "impossible"  the dates contradict each other (died before being born,
                  born before a parent), or
    "unlikely"    possible but rare enough to be worth a second look
                  (a parent aged 9, someone who lived to 130).

Dates can be fuzzy ("about 1921", "before 1900", "Mar 1921"), so every date is
turned into the earliest and latest day it could mean, and we only complain
when even the most generous reading of the dates still looks wrong.
"""
import calendar
from datetime import date, timedelta

from .dates import format_date, split
from .relationships import gender_of

ABOUT_YEARS = 2          # "about 1921" could mean 1919-1923
MAX_AGE = 120            # nobody has reliably lived much past this
MIN_PARENT_AGE = 12
MAX_MOTHER_AGE = 60
MAX_PARENT_AGE = 80      # fathers, and parents whose gender we don't know
PREGNANCY = timedelta(days=280)   # a child can be born up to ~9 months after their father dies

EARLIEST = date(1, 1, 1)
LATEST = date(9999, 12, 31)


def _shift_years(day, years):
    try:
        return day.replace(year=day.year + years)
    except ValueError:              # 29 Feb in a year that doesn't have one
        return day.replace(year=day.year + years, day=28)


def date_range(canonical):
    """The earliest and latest real day a stored date could mean, or None if blank.

    '1921-03' -> (1 Mar 1921, 31 Mar 1921); '~1921' -> (1 Jan 1919, 31 Dec 1923);
    '<1900' -> (the distant past, 31 Dec 1899); '>1900' -> (1 Jan 1901, the far future).
    """
    parts = split(canonical)
    if not parts:
        return None
    prefix, year, month, day = parts
    lo = date(year, month or 1, day or 1)
    if day:
        hi = lo
    elif month:
        hi = date(year, month, calendar.monthrange(year, month)[1])
    else:
        hi = date(year, 12, 31)
    if prefix == "~":
        return _shift_years(lo, -ABOUT_YEARS), _shift_years(hi, ABOUT_YEARS)
    if prefix == "<":
        return EARLIEST, lo - timedelta(days=1)
    if prefix == ">":
        return hi + timedelta(days=1), LATEST
    return lo, hi


def _years_between(earlier, later):
    return (later - earlier).days / 365.2425


def _name(p):
    return " ".join(part for part in (p["first_name"], p["last_name"]) if part)


def find_issues(people, relationships):
    """Return {person_id: [{"level": "impossible"|"unlikely", "text": ...}, ...]}.

    `people` and `relationships` are rows (or dicts) as stored in the database.
    Only people with something to report appear in the result. A finding about a
    parent and child is listed under both of them, so it shows whichever you open.
    """
    by_id = {p["id"]: p for p in people}
    births = {p["id"]: date_range(p["birth_date"]) for p in people}
    deaths = {p["id"]: date_range(p["death_date"]) for p in people}
    issues = {}

    def add(level, text, *ids):
        for pid in ids:
            issues.setdefault(pid, []).append({"level": level, "text": text})

    for p in people:
        born, died = births[p["id"]], deaths[p["id"]]
        if not (born and died):
            continue
        if died[1] < born[0]:
            add("impossible", f"{_name(p)} died ({format_date(p['death_date'])}) before they were born "
                              f"({format_date(p['birth_date'])}).", p["id"])
        elif _years_between(born[1], died[0]) > MAX_AGE:
            add("unlikely", f"{_name(p)} would have lived to over {MAX_AGE}.", p["id"])

    for r in relationships:
        if r["kind"] != "parent" or r["person_a"] not in by_id or r["person_b"] not in by_id:
            continue
        parent, child = by_id[r["person_a"]], by_id[r["person_b"]]
        p_born, p_died, c_born = births[parent["id"]], deaths[parent["id"]], births[child["id"]]
        if not c_born:
            continue
        ids = (child["id"], parent["id"])
        is_mother = gender_of({"gender": parent["gender"]}) == "f"
        if p_born:
            if c_born[1] < p_born[0]:
                add("impossible", f"{_name(child)} was born before their parent, {_name(parent)}.", *ids)
            elif _years_between(p_born[0], c_born[1]) < MIN_PARENT_AGE:
                add("unlikely", f"{_name(parent)} would have been under {MIN_PARENT_AGE} "
                                f"when {_name(child)} was born.", *ids)
            else:
                limit = MAX_MOTHER_AGE if is_mother else MAX_PARENT_AGE
                if _years_between(p_born[1], c_born[0]) > limit:
                    add("unlikely", f"{_name(parent)} would have been over {limit} "
                                    f"when {_name(child)} was born.", *ids)
        if p_died:
            if is_mother and c_born[0] > p_died[1]:
                add("impossible", f"{_name(child)} was born after their mother, {_name(parent)}, died.", *ids)
            elif not is_mother and c_born[0] - p_died[1] > PREGNANCY:
                add("impossible", f"{_name(child)} was born more than 9 months after "
                                  f"their parent, {_name(parent)}, died.", *ids)

    for found in issues.values():
        found.sort(key=lambda i: i["level"] != "impossible")   # impossible first
    return issues
