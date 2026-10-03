"""Genealogy-friendly dates.

People rarely know every date exactly, so Kinroot stores dates as short
canonical strings instead of strict calendar dates:

    "1921-03-02"   exact day
    "1921-03"      month and year
    "1921"         year only
    "~1921"        about 1921
    "<1921"        before 1921
    ">1921"        after 1921

parse_date() turns whatever someone typed (or a GEDCOM file contained)
into one of those. format_date() turns it back into friendly text.
"""
import calendar
import re
from datetime import date, datetime, timezone


def utc_now():
    """The current UTC time as a plain (timezone-free) datetime.

    Kinroot stores timestamps as "YYYY-MM-DD HH:MM:SS" UTC strings without a
    timezone, so we drop tzinfo to keep comparisons with parsed stamps working.
    (Replaces datetime.utcnow(), which Python has deprecated.)
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
MONTH_SHOW = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Words people (and GEDCOM files) put in front of a date, mapped to our prefix.
QUALIFIERS = {
    "about": "~", "abt": "~", "approx": "~", "approximately": "~", "around": "~",
    "circa": "~", "ca": "~", "c": "~", "est": "~", "estimated": "~", "cal": "~",
    "calculated": "~", "int": "", "before": "<", "bef": "<", "after": ">", "aft": ">",
}
PREFIX_WORDS = {"~": "about", "<": "before", ">": "after"}

CANONICAL = re.compile(r"^([~<>]?)(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")


class DateError(ValueError):
    """Raised with a message that can be shown to the person who typed the date."""


def _month_number(word):
    word = word.lower().rstrip(".")
    for i, abbr in enumerate(MONTH_ABBR, start=1):
        if word.startswith(abbr) and (len(word) <= 3 or calendar.month_name[i].lower().startswith(word)):
            return i
    if word == "sept":
        return 9
    return None


def _build(prefix, year, month=None, day=None, today=None):
    today = today or date.today()
    if not 1000 <= year <= today.year:
        if year > today.year:
            raise DateError("That date is in the future.")
        raise DateError("Use a four-digit year, like 1921.")
    if month is not None and not 1 <= month <= 12:
        raise DateError("That month doesn't exist.")
    if day is not None:
        if month is None or not 1 <= day <= calendar.monthrange(year, month)[1]:
            raise DateError("That day doesn't exist in that month.")
        if date(year, month, day) > today:
            raise DateError("That date is in the future.")
    text = f"{year:04d}"
    if month is not None:
        text += f"-{month:02d}"
        if day is not None:
            text += f"-{day:02d}"
    return prefix + text


def parse_date(text, today=None):
    """Return the canonical form of a typed date, or '' for a blank one.

    Accepts things like: 1921-03-02, 3/2/1921 (month/day/year), 2 Mar 1921,
    March 2, 1921, Mar 1921, 1921, about 1921, c. 1921, before 1900, ~1921,
    and GEDCOM forms such as "ABT 1921", "BET 1900 AND 1910", "1750/51".
    """
    raw = (text or "").strip()
    if not raw:
        return ""

    m = CANONICAL.match(raw)
    if m:
        prefix, y, mo, d = m.groups()
        return _build(prefix, int(y), int(mo) if mo else None, int(d) if d else None, today)

    s = raw.lower()
    s = re.sub(r"\(.*?\)", " ", s)            # GEDCOM "INT 1900 (said to be)" notes
    s = s.replace(",", " ").replace(".", " ")
    prefix = ""
    if s[:1] in "~<>":
        prefix, s = s[0], s[1:]

    # GEDCOM ranges: "bet 1900 and 1910" -> about the middle; "from 1900 to 1910" -> about the start
    rng = re.match(r"^\s*(?:bet|between)\s+(.*?)\s+(?:and|-)\s+(.*)$", s)
    if rng:
        y1, y2 = _first_year(rng.group(1)), _first_year(rng.group(2))
        if y1 and y2:
            return _build("~", (y1 + y2) // 2, today=today)
    frm = re.match(r"^\s*from\s+(.*?)(?:\s+to\s+.*)?$", s)
    if frm:
        s, prefix = frm.group(1), "~"
    to = re.match(r"^\s*to\s+(.*)$", s)
    if to:
        s, prefix = to.group(1), "<"

    words = s.split()
    while words and words[0] in QUALIFIERS:
        prefix = QUALIFIERS[words[0]] or prefix
        words = words[1:]
    s = " ".join(words)
    s = re.sub(r"\b(\d{4})/(\d{1,2})\b(?!/)", _dual_year, s)   # old dual dating "1750/51" -> 1750

    # 1921-3-2 or 1921/03/02
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?", s)
    if m:
        return _build(prefix, int(m.group(1)), int(m.group(2)), int(m.group(3)) if m.group(3) else None, today)
    # 3/2/1921 or 3-2-1921 (month first, as written in the US)
    m = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        return _build(prefix, int(m.group(3)), int(m.group(1)), int(m.group(2)), today)
    # 3/1921 (month/year)
    m = re.fullmatch(r"(\d{1,2})[-/](\d{4})", s)
    if m:
        return _build(prefix, int(m.group(2)), int(m.group(1)), None, today)
    # 1921
    m = re.fullmatch(r"(\d{4})", s)
    if m:
        return _build(prefix, int(m.group(1)), today=today)
    # 2 Mar 1921 / 2 march 1921
    m = re.fullmatch(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", s)
    if m and _month_number(m.group(2)):
        return _build(prefix, int(m.group(3)), _month_number(m.group(2)), int(m.group(1)), today)
    # March 2 1921 / Mar 2nd 1921
    m = re.fullmatch(r"([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})", s)
    if m and _month_number(m.group(1)):
        return _build(prefix, int(m.group(3)), _month_number(m.group(1)), int(m.group(2)), today)
    # March 1921
    m = re.fullmatch(r"([a-z]+)\s+(\d{4})", s)
    if m and _month_number(m.group(1)):
        return _build(prefix, int(m.group(2)), _month_number(m.group(1)), None, today)

    raise DateError("Try a date like 2 Mar 1921, 1921-03-02, Mar 1921, 1921 or about 1921.")


def _dual_year(match):
    """Before 1752 the year could turn in March, so records say 1750/51. Keep the first year."""
    year, tail = int(match.group(1)), match.group(2)
    if int(tail) == (year + 1) % (10 ** len(tail)):
        return match.group(1)
    return match.group(0)


def _first_year(text):
    m = re.search(r"\b(\d{4})\b", text or "")
    return int(m.group(1)) if m else None


def parse_date_lenient(text):
    """Like parse_date but returns '' instead of raising (used for imports)."""
    try:
        return parse_date(text)
    except DateError:
        return ""


def split(canonical):
    """'~1921-03-02' -> ('~', 1921, 3, 2). Missing parts are None."""
    m = CANONICAL.match(canonical or "")
    if not m:
        return None
    prefix, y, mo, d = m.groups()
    return prefix, int(y), int(mo) if mo else None, int(d) if d else None


def year_of(canonical):
    parts = split(canonical)
    return parts[1] if parts else None


def month_day(canonical):
    """(month, day) for exact dates without a qualifier, else None. Used for birthdays."""
    parts = split(canonical)
    if not parts or parts[0] or parts[3] is None:
        return None
    return parts[2], parts[3]


def format_date(canonical):
    """'~1921-03-02' -> 'about 2 Mar 1921'."""
    parts = split(canonical)
    if not parts:
        return canonical or ""
    prefix, y, mo, d = parts
    text = str(y)
    if mo:
        text = f"{MONTH_SHOW[mo - 1]} {y}"
        if d:
            text = f"{d} {text}"
    return f"{PREFIX_WORDS[prefix]} {text}" if prefix else text


def to_gedcom(canonical):
    """'~1921-03-02' -> 'ABT 2 MAR 1921'."""
    parts = split(canonical)
    if not parts:
        return ""
    prefix, y, mo, d = parts
    text = str(y)
    if mo:
        text = f"{MONTH_ABBR[mo - 1].upper()} {y}"
        if d:
            text = f"{d} {text}"
    return {"~": "ABT ", "<": "BEF ", ">": "AFT ", "": ""}[prefix] + text
