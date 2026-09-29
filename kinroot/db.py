"""SQLite database: connection handling and schema migrations.

Each entry in MIGRATIONS runs once, in order. The database remembers how far
it got (PRAGMA user_version), so upgrading Kinroot never loses your data.
To change the schema later, add a new entry at the end — never edit old ones.
"""
import sqlite3

from flask import current_app, g

from .dates import year_of

MIGRATIONS = [
    # 1 — the original Rootwork schema
    """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trees (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tree_members (
        tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
        PRIMARY KEY (tree_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY,
        tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT DEFAULT '',
        gender TEXT DEFAULT '',
        birth_date TEXT DEFAULT '',
        birth_place TEXT DEFAULT '',
        death_date TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        photo TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY,
        tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        person_a INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        person_b INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('parent', 'spouse')),
        UNIQUE (person_a, person_b, kind)
    );
    """,
    # 2 — Kinroot: privacy, claimed leaves, invite links, family connections and messages
    """
    ALTER TABLE people ADD COLUMN deceased INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE people ADD COLUMN birth_year INTEGER;
    ALTER TABLE people ADD COLUMN death_year INTEGER;
    ALTER TABLE people ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE trees ADD COLUMN hide_living INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE trees ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_people_tree ON people(tree_id);
    CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id);
    CREATE INDEX IF NOT EXISTS idx_people_match ON people(lower(first_name), lower(last_name), birth_year);
    CREATE INDEX IF NOT EXISTS idx_rel_tree ON relationships(tree_id);
    CREATE INDEX IF NOT EXISTS idx_members_user ON tree_members(user_id);

    CREATE TABLE invites (
        id INTEGER PRIMARY KEY,
        tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
        person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE connections (
        id INTEGER PRIMARY KEY,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
        note TEXT NOT NULL DEFAULT '',
        via_tree_id INTEGER REFERENCES trees(id) ON DELETE SET NULL,
        via_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
        match_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
        blocked_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        responded_at TEXT
    );
    CREATE UNIQUE INDEX idx_connection_pair ON connections(
        min(requester_id, addressee_id), max(requester_id, addressee_id));
    CREATE INDEX idx_connection_addressee ON connections(addressee_id, status);

    CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT
    );
    CREATE INDEX idx_messages_connection ON messages(connection_id, id);
    """,
]


def _backfill_years(db):
    rows = db.execute("SELECT id, birth_date, death_date FROM people").fetchall()
    for r in rows:
        db.execute("UPDATE people SET birth_year = ?, death_year = ? WHERE id = ?",
                   (year_of(r["birth_date"]), year_of(r["death_date"]), r["id"]))


AFTER_MIGRATION = {2: _backfill_years}


def connect(path):
    db = sqlite3.connect(path, detect_types=0)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DB_PATH"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def migrate(db):
    """Bring the database schema up to date. Safe to run every start."""
    version = db.execute("PRAGMA user_version").fetchone()[0]
    for number, script in enumerate(MIGRATIONS, start=1):
        if number <= version:
            continue
        try:
            db.executescript("BEGIN;" + script + "COMMIT;")
        except sqlite3.Error:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        if number in AFTER_MIGRATION:
            AFTER_MIGRATION[number](db)
        db.execute(f"PRAGMA user_version = {number}")
        db.commit()
    return db.execute("PRAGMA user_version").fetchone()[0]
