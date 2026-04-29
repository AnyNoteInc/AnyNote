import re


def collection_name_for(provider_slug: str, model_slug: str) -> str:
    def _safe(s: str) -> str:
        return re.sub(r'[^a-z0-9-]+', '-', s.lower()).strip('-')

    return f'pages_{_safe(provider_slug)}_{_safe(model_slug)}'
