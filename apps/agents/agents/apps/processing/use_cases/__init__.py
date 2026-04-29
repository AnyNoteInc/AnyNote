from .vectorize_page import VectorizePageUseCase


class DeletePageVectorsUseCase:
    async def __call__(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError('DeletePageVectorsUseCase is implemented in Task 8')


class DeleteWorkspaceVectorsUseCase:
    async def __call__(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError('DeleteWorkspaceVectorsUseCase is implemented in Task 9')


__all__ = [
    'DeletePageVectorsUseCase',
    'DeleteWorkspaceVectorsUseCase',
    'VectorizePageUseCase',
]
