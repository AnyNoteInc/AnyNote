from dataclasses import dataclass

from ..repositories import VectorStoreRepository
from ..schemas import WorkspaceWipeResponseSchema


@dataclass
class DeleteWorkspaceVectorsUseCase:
    vector_store: VectorStoreRepository

    async def __call__(self, workspace_id: str) -> WorkspaceWipeResponseSchema:
        deleted: list[str] = []
        for name in await self.vector_store.list_collections():
            if not name.startswith('pages_'):
                continue
            await self.vector_store.delete_by_workspace(name, workspace_id)
            deleted.append(name)
        return WorkspaceWipeResponseSchema(deletedCollections=deleted)
