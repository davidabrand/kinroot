"""Runs the browser-side unit tests in tests/js/ with Node (skipped if Node isn't installed)."""
import os
import shutil
import subprocess

import pytest

JS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "js")


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_js_unit_tests():
    files = sorted(os.path.join(JS_DIR, f) for f in os.listdir(JS_DIR) if f.endswith(".test.mjs"))
    env = {**os.environ, "TZ": "America/New_York"}   # the sky tests reason about New York clock times
    result = subprocess.run(["node", "--test", *files], capture_output=True, text=True, env=env, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
