"""CLI composition for the agents service."""

from __future__ import annotations

import typer

from agents.cli.commands.health import health


def create_app() -> typer.Typer:
    app = typer.Typer(help="AnyNote Agents CLI", no_args_is_help=True)

    @app.callback()
    def _root() -> None:
        """AnyNote Agents CLI."""

    app.command(name="health")(health)
    return app
