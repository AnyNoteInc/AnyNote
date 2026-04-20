"""Dishka providers for the indexer. Filled out in T5."""

from __future__ import annotations

from dishka import Provider, Scope, from_context

from indexer.settings import Settings


class AppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)


class AppSingletonsProvider(Provider):
    scope = Scope.APP
