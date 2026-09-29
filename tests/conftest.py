import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kinroot import create_app  # noqa: E402

H = {"X-Requested-With": "Kinroot"}


@pytest.fixture
def app(tmp_path):
    return create_app({"INSTANCE_DIR": str(tmp_path), "DB_PATH": str(tmp_path / "test.db"),
                       "UPLOAD_DIR": str(tmp_path / "uploads"), "CSRF_ENABLED": False, "TESTING": True})


def register(client, email, name="Test Person"):
    return client.post("/register", data={"name": name, "email": email, "password": "password123"})


def make_tree(client, name="Brands"):
    resp = client.post("/trees/new", data={"name": name})
    return int(resp.headers["Location"].rstrip("/").split("/")[-1])


def add(client, tree_id, **fields):
    resp = client.post(f"/api/trees/{tree_id}/people", json=fields, headers=H)
    assert resp.status_code == 201, resp.json
    return resp.json["person"]["id"]
