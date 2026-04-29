from .delete_page_vectors import DeletePageVectorsUseCase
from .vectorize_page import VectorizePageUseCase


class DeleteWorkspaceVectorsUseCase:
    async def __call__(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError('DeleteWorkspaceVectorsUseCase is implemented in Task 9')


__all__ = [
    'DeletePageVectorsUseCase',
    'DeleteWorkspaceVectorsUseCase',
    'VectorizePageUseCase',
]
