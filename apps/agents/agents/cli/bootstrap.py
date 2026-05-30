"""CLI composition for the agents service."""

import typer


def create_app() -> typer.Typer:
    app = typer.Typer(help="AnyNote Agents CLI")

    return app
