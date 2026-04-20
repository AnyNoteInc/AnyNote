from __future__ import annotations


def include_object(
    _object: object,
    name: str | None,
    type_: str,
    _reflected: bool,
    _compare_to: object,
) -> bool:
    if type_ != "table":
        return True
    if not name:
        return True
    return not name.startswith("checkpoint") and not name.startswith("checkpoints")
