from dishka import Provider, Scope

from agents.apps.processing.services import LanguageDetectorService, NormalizerService
from agents.apps.processing.use_cases import NormalizeTextUseCase

provider = Provider(scope=Scope.APP)
provider.provide(LanguageDetectorService)
provider.provide(NormalizerService)
provider.provide(NormalizeTextUseCase)
