from __future__ import annotations

import os

from alembic import context
from sqlalchemy import MetaData, engine_from_config, pool

from agents_migrations_env import include_object

config = context.config
target_metadata = MetaData()


def _database_url() -> str:
    url = os.getenv("AGENTS_DATABASE_URL")
    if url:
        config.set_main_option("sqlalchemy.url", url)
        return url

    try:
        url = config.get_main_option("sqlalchemy.url")
    except Exception:
        url = ""

    if not url or url.startswith("%("):
        raise RuntimeError("AGENTS_DATABASE_URL must be set for Alembic migrations")
    config.set_main_option("sqlalchemy.url", url)
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    _database_url()
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
