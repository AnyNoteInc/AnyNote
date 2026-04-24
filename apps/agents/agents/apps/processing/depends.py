from dishka import Provider, Scope

from agents.apps.processing.repositories import (
    VectorStoreRepository,
    VectorizationRepository,
)
from agents.apps.processing.services import (
    ChunkerService,
    LanguageDetectorService,
    NormalizerService,
)
from agents.apps.processing.use_cases import VectorizePageUseCase

provider = Provider(scope=Scope.APP)
provider.provide(ChunkerService)
provider.provide(LanguageDetectorService)
provider.provide(NormalizerService)
provider.provide(VectorStoreRepository)
provider.provide(VectorizationRepository)
provider.provide(VectorizePageUseCase)
