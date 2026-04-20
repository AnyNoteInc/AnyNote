from __future__ import annotations

import json
from pathlib import Path


def test_package_json_dev_uses_cmd_rest() -> None:
    package_json_path = Path(__file__).resolve().parents[1] / "package.json"
    package_json = json.loads(package_json_path.read_text())
    assert "agents.cmd.rest:app" in package_json["scripts"]["dev"]
