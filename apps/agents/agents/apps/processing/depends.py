from dishka import Provider, Scope

from agents.apps.processing.services.language_detector import LanguageDetector
from agents.apps.processing.services.normalizer import NormalizerService
from agents.apps.processing.use_cases import NormalizeTextUseCase

provider = Provider(scope=Scope.APP)
provider.provide(LanguageDetector)
provider.provide(NormalizerService)
provider.provide(NormalizeTextUseCase)
