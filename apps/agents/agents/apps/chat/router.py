from fastapi import APIRouter, Response, status

router = APIRouter(prefix='/chat', tags=['Chat (deprecated)'])


@router.post('/generate', status_code=status.HTTP_308_PERMANENT_REDIRECT)
async def generate_deprecated() -> Response:
    return Response(
        status_code=status.HTTP_308_PERMANENT_REDIRECT,
        headers={
            'Location': '/agent/run',
            'Deprecation': 'true',
            'Sunset': 'Wed, 01 Jul 2026 00:00:00 GMT',
            'Link': '</agent/run>; rel="successor-version"',
        },
    )
