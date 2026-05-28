from agents.cmd.rest import app


def test_validation_routes_registered() -> None:
    paths = {getattr(r, 'path', None) for r in app.routes}
    assert '/validation/llm' in paths
    assert '/validation/embedding' in paths
    assert '/validation/mcp' in paths
