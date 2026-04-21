from __future__ import annotations

import importlib
import sys


def test_settings_import_uses_project_dotenv_even_when_shell_debug_is_release(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('DEBUG', 'release')
    monkeypatch.delenv('ENVIRONMENT', raising=False)
    monkeypatch.delenv('TITLE', raising=False)

    (tmp_path / '.env').write_text(
        '\n'.join(
            [
                'TITLE=agents',
                'DEBUG=true',
                'ENVIRONMENT=dev',
                'BASE_URL=http://localhost:8000',
                'SECRET_KEY=test-secret',
                'CORS_ORIGINS=["127.0.0.1", "localhost"]',
                'DB__HOST=localhost',
                'DB__PORT=5432',
                'DB__USER=postgres',
                'DB__PASSWORD=postgres',
                'DB__NAME=agents',
            ]
        )
    )

    sys.modules.pop('agents.settings', None)
    settings_module = importlib.import_module('agents.settings')

    assert settings_module.settings.debug is True
