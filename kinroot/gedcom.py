"""Read and write GEDCOM, the file format every genealogy site can export.

Import lets people bring a tree over from Ancestry, FamilySearch, MyHeritage,
etc. Export means their family history is never locked inside Kinroot.
Only the parts Kinroot uses are read: names, sex, birth, death, notes and
family links. Everything else in the file is ignored.
"""
import re
from collections import defaultdict
from datetime import date

from .dates import parse_date_lenient, to_gedcom

LINE = re.compile(r"^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$")


class GedcomError(ValueError):
    pass


def decode(data):
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")  # older ANSI/ANSEL files; close enough for names


def _records(text):
    """Yield top-level records as nested dicts: {"xref", "tag", "value", "children": [...]}."""
    root, stack = None, []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        m = LINE.match(raw)
        if not m:
            continue
        level, xref, tag, value = int(m.group(1)), m.group(2), m.group(3).upper(), m.group(4) or ""
        node = {"xref": xref, "tag": tag, "value": value, "children": []}
        if tag in ("CONT", "CONC") and stack:
            parent = stack[-1] if level > len(stack) - 1 else stack[level - 1]
            parent["value"] += ("\n" if tag == "CONT" else "") + value
            continue
        if level == 0:
            if root is not None:
                yield root
            root, stack = node, [node]
            continue
        while len(stack) > level:
            stack.pop()
        if stack and len(stack) == level:
            stack[-1]["children"].append(node)
            stack.append(node)
    if root is not None:
        yield root


def _child(node, tag):
    for c in node["children"]:
        if c["tag"] == tag:
            return c
    return None


def _value(node, *path):
    for tag in path:
        node = _child(node, tag) if node else None
    return node["value"].strip() if node else ""


def parse(data):
    """Parse GEDCOM bytes into {"people": [...], "families": [...], "skipped": int}.

    people:   dicts with key "ref" plus Kinroot person fields
    families: dicts with "parents" [refs] and "children" [refs]
    """
    text = decode(data)
    if "HEAD" not in text[:5000]:
        raise GedcomError("That doesn't look like a GEDCOM file (it has no header).")
    notes = {}
    individuals, families = [], []
    for rec in _records(text):
        if rec["tag"] == "NOTE" and rec["xref"]:
            notes[rec["xref"]] = rec["value"]
        elif rec["tag"] == "INDI":
            individuals.append(rec)
        elif rec["tag"] == "FAM":
            families.append(rec)

    people = []
    for rec in individuals:
        name_node = _child(rec, "NAME")
        full = name_node["value"] if name_node else ""
        first, last = full, ""
        m = re.match(r"^(.*?)/(.*?)/(.*)$", full)
        if m:
            first = (m.group(1) + " " + m.group(3)).strip()
            last = m.group(2).strip()
        if name_node:
            first = _value(name_node, "GIVN") or first
            last = _value(name_node, "SURN") or last
        first = re.sub(r"\s+", " ", first).strip() or "Unknown"
        sex = _value(rec, "SEX").upper()
        birth = _child(rec, "BIRT") or _child(rec, "CHR") or _child(rec, "BAPM")
        death = _child(rec, "DEAT") or _child(rec, "BURI")
        note_parts = []
        for c in rec["children"]:
            if c["tag"] == "NOTE":
                note_parts.append(notes.get(c["value"].strip(), c["value"]) if c["value"].startswith("@") else c["value"])
        people.append({
            "ref": rec["xref"],
            "first_name": first[:100],
            "last_name": re.sub(r"\s+", " ", last)[:100],
            "gender": {"M": "male", "F": "female"}.get(sex, ""),
            "birth_date": parse_date_lenient(_value(birth, "DATE")) if birth else "",
            "birth_place": _value(birth, "PLAC")[:200] if birth else "",
            "death_date": parse_date_lenient(_value(death, "DATE")) if death else "",
            "deceased": 1 if death else 0,
            "notes": "\n\n".join(n.strip() for n in note_parts if n.strip())[:5000],
        })

    fams = []
    for rec in families:
        parents = [c["value"].strip() for c in rec["children"] if c["tag"] in ("HUSB", "WIFE")]
        kids = [c["value"].strip() for c in rec["children"] if c["tag"] == "CHIL"]
        fams.append({"parents": parents, "children": kids})
    return {"people": people, "families": fams}


def export(tree_name, people, relationships):
    """Build a GEDCOM 5.5.1 text for a tree."""
    by_id = {p["id"]: p for p in people}
    parents_of = defaultdict(list)
    spouse_pairs = set()
    for r in relationships:
        if r["person_a"] not in by_id or r["person_b"] not in by_id:
            continue
        if r["kind"] == "parent":
            parents_of[r["person_b"]].append(r["person_a"])
        else:
            spouse_pairs.add(tuple(sorted((r["person_a"], r["person_b"]))))

    # A GEDCOM "family" is a set of parents plus their children.
    families = defaultdict(list)
    for child, parents in parents_of.items():
        families[tuple(sorted(parents))].append(child)
    for pair in spouse_pairs:
        families.setdefault(pair, [])

    fam_ids = {key: f"@F{i}@" for i, key in enumerate(sorted(families), start=1)}
    fams_of, famc_of = defaultdict(list), defaultdict(list)
    for key, kids in families.items():
        for pid in key:
            fams_of[pid].append(fam_ids[key])
        for kid in kids:
            famc_of[kid].append(fam_ids[key])

    out = ["0 HEAD", "1 SOUR KINROOT", "2 NAME Kinroot", "1 GEDC", "2 VERS 5.5.1",
           "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", f"1 DATE {to_gedcom(date.today().isoformat())}",
           f"1 FILE {_clean(tree_name)}.ged"]

    def text_lines(level, tag, text):
        lines = (text or "").split("\n")
        result = [f"{level} {tag} {lines[0]}".rstrip()]
        result += [f"{level + 1} CONT {line}".rstrip() for line in lines[1:]]
        return result

    for p in people:
        out.append(f"0 @I{p['id']}@ INDI")
        out.append(f"1 NAME {_clean(p['first_name'])} /{_clean(p['last_name'])}/")
        out.append(f"2 GIVN {_clean(p['first_name'])}")
        if p["last_name"]:
            out.append(f"2 SURN {_clean(p['last_name'])}")
        g = (p["gender"] or "").lower()
        if g.startswith("m") or g.startswith("f"):
            out.append(f"1 SEX {'M' if g.startswith('m') else 'F'}")
        if p["birth_date"] or p["birth_place"]:
            out.append("1 BIRT")
            if p["birth_date"]:
                out.append(f"2 DATE {to_gedcom(p['birth_date'])}")
            if p["birth_place"]:
                out.append(f"2 PLAC {_clean(p['birth_place'])}")
        if p["death_date"]:
            out += ["1 DEAT", f"2 DATE {to_gedcom(p['death_date'])}"]
        elif p["deceased"]:
            out.append("1 DEAT Y")
        if p["notes"]:
            out += text_lines(1, "NOTE", p["notes"])
        for f in famc_of[p["id"]]:
            out.append(f"1 FAMC {f}")
        for f in fams_of[p["id"]]:
            out.append(f"1 FAMS {f}")

    for key in sorted(families):
        out.append(f"0 {fam_ids[key]} FAM")
        members = sorted(key, key=lambda pid: 0 if (by_id[pid]["gender"] or "").lower().startswith("m") else 1)
        for i, pid in enumerate(members):
            g = (by_id[pid]["gender"] or "").lower()
            tag = "HUSB" if g.startswith("m") else "WIFE" if g.startswith("f") else ("HUSB" if i == 0 else "WIFE")
            out.append(f"1 {tag} @I{pid}@")
        for kid in sorted(families[key]):
            out.append(f"1 CHIL @I{kid}@")
    out.append("0 TRLR")
    return "\n".join(out) + "\n"


def _clean(text):
    return re.sub(r"[\r\n/@]+", " ", text or "").strip()
