"""Static files get fingerprinted URLs, so a deploy can never mix new pages with stale CSS/JS."""
import json
import re

from conftest import make_tree, register


def test_stylesheet_and_scripts_are_fingerprinted(app):
    page = app.test_client().get("/").get_data(as_text=True)
    assert re.search(r'/static/css/style\.css\?v=[0-9a-f]{10}"', page)
    assert re.search(r'/static/js/app\.js\?v=[0-9a-f]{10}"', page)


def test_fingerprint_changes_with_the_file(app, tmp_path):
    from kinroot import _static_version
    f = tmp_path / "a.css"
    f.write_text("body{}")
    first = _static_version(str(tmp_path), "a.css")
    f.write_text("body{color:red}")
    assert _static_version(str(tmp_path), "a.css") != first
    assert _static_version(str(tmp_path), "missing.css") is None
    assert _static_version(str(tmp_path), "../outside.css") is None    # never reads outside static/


def test_folders_are_not_fingerprinted(app):
    # The 3D page builds model URLs as modelsBase + "file.glb"; a ?v= on the folder would break them.
    c = app.test_client()
    register(c, "ann@example.com")
    page = c.get(f"/trees/{make_tree(c)}").get_data(as_text=True)
    assert 'modelsBase: "/static/models/"' in page


def test_tree_modules_are_in_the_import_map(app):
    c = app.test_client()
    register(c, "ann@example.com")
    page = c.get(f"/trees/{make_tree(c)}").get_data(as_text=True)
    imports = json.loads(re.search(r'<script type="importmap">(.*?)</script>', page, re.S).group(1))["imports"]
    assert re.fullmatch(r"/static/js/tree/panel\.js\?v=[0-9a-f]{10}", imports["/static/js/tree/panel.js"])
    assert imports["three"].startswith("https://cdn.jsdelivr.net/")
    assert re.search(r'/static/js/tree3d\.js\?v=[0-9a-f]{10}"', page)


def test_tree_page_has_one_toolbar_and_camera_controls(app):
    """The tree stage: one floating toolbar, and camera controls including fit and reset orientation."""
    c = app.test_client()
    register(c, "stage@example.com")
    page = c.get(f"/trees/{make_tree(c)}").get_data(as_text=True)
    assert page.count('class="tree-bar"') == 1 and 'role="toolbar"' in page
    for control in ("btn-zoom-in", "btn-zoom-out", "btn-reset", "btn-me", "btn-orient", "search-input"):
        assert f'id="{control}"' in page
    assert "/static/js/tree/links.js" in page                       # the line geometry module is mapped
    assert "sky.js" not in page and "wood.js" not in page            # the old landscape and wooden branches are gone
