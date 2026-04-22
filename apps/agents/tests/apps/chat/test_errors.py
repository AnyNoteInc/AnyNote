from agents.apps.chat.errors import ProviderError, UnauthorizedError


def test_provider_error_message_uses_raw_message() -> None:
    error = ProviderError('Gateway timeout', code='UPSTREAM_TIMEOUT')

    assert error.message == 'Provider error: Gateway timeout, code: UPSTREAM_TIMEOUT'


def test_unauthorized_error_message_uses_raw_message() -> None:
    error = UnauthorizedError()

    assert error.message == 'Unauthorized: Invalid bearer token, code: UNAUTHORIZED'
