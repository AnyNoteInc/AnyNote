from __future__ import annotations

import json
from pathlib import Path


def test_package_json_dev_uses_cmd_rest() -> None:
    package_json = json.loads(Path("package.json").read_text())
    assert "agents.cmd.rest:app" in package_json["scripts"]["dev"]
