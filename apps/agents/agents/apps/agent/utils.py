def extract_bearer_token(authorization: str) -> str | None:
    """Return the token from an ``Authorization: Bearer <token>`` header, or None
    if the scheme is not bearer / the token is empty."""
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token:
        return None
    return token
