from agents.apps.agent.services.nodes.executor import extract_reasoning_text


class _Msg:
    def __init__(self, blocks: object) -> None:
        self.content_blocks = blocks


def test_extracts_reasoning_blocks() -> None:
    msg = _Msg([
        {'type': 'reasoning', 'reasoning': 'step 1'},
        {'type': 'text', 'text': 'answer'},
        {'type': 'reasoning', 'reasoning': 'step 2'},
    ])
    assert extract_reasoning_text(msg) == 'step 1\nstep 2'


def test_no_blocks_returns_empty() -> None:
    class _Bare:
        pass

    assert extract_reasoning_text(_Bare()) == ''


def test_empty_blocks_returns_empty() -> None:
    assert extract_reasoning_text(_Msg([])) == ''
