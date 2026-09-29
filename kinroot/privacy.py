"""Who counts as living, and what viewers are allowed to see about them.

Birth dates, birthplaces and mothers' maiden names are classic answers to
bank security questions, so by default people who only have *view* access
see a living relative's name and photo, but not their dates, places or notes.
Owners and editors always see everything.
"""
from datetime import date

# Someone born more than this many years ago, with no death recorded,
# is presumed to have passed away (the usual genealogy convention).
PRESUMED_DECEASED_AFTER_YEARS = 110

PRIVATE_FIELDS = ("birth_date", "birth_place", "death_date", "notes")


def is_living(person, today=None):
    today = today or date.today()
    if person["deceased"] or person["death_date"]:
        return False
    birth_year = person["birth_year"]
    if birth_year and birth_year < today.year - PRESUMED_DECEASED_AFTER_YEARS:
        return False
    return True


def viewer_must_hide(tree, role, person, today=None):
    """True when this person's details should be hidden from this viewer."""
    return role == "viewer" and bool(tree["hide_living"]) and is_living(person, today)
