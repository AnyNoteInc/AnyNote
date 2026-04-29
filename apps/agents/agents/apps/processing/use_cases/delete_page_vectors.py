from dataclasses import dataclass

from ..repositories import VectorStoreRepository
from ..schemas import PageWipeResponseSchema


@dataclass
class DeletePageVectorsUseCase:
    vector_store: VectorStoreRepository

    async def __call__(self, page_id: str) -> PageWipeResponseSchema:
        deleted: list[str] = []
        for name in await self.vector_store.list_collections():
            if not name.startswith('pages_'):
                continue
            await self.vector_store.delete_by_page(name, page_id)
            deleted.append(name)
        return PageWipeResponseSchema(deletedCollections=deleted)
