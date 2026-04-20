from __future__ import annotations

from typer.testing import CliRunner

from agents.cli.app import app


def test_cli_help() -> None:
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "AnyNote Agents CLI" in result.stdout
