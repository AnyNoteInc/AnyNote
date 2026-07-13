## [1.38.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.38.0...v1.38.1) (2026-07-13)


### Bug Fixes

* **diagram-board:** normalizeSvgForImg — валидный XML и intrinsic-размеры для <img>-показа ([f79c013](https://github.com/AnyNoteInc/AnyNote/commit/f79c013dfc07bf31d33144588cbe7c4e408edf29))
* **editor:** пакет правок UX редактора — каретка после вставки, placeholder, табы, диаграммы, блочное меню ([046a26c](https://github.com/AnyNoteInc/AnyNote/commit/046a26c6125f71de86c445d0908f01fe7936f8e1))
* **editor:** устранить 2 minor-регрессии из adversarial-ревью ([31436e9](https://github.com/AnyNoteInc/AnyNote/commit/31436e99311a4ad7930ea91c70289364894b4906))
* **web:** единый регион панелей, чат правее превью, высоты шапок, ширина колонки ([59c5e68](https://github.com/AnyNoteInc/AnyNote/commit/59c5e6811b1ae3c9455448a0108e66b2c1878db3))

# [1.38.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.37.0...v1.38.0) (2026-07-12)


### Bug Fixes

* **editor:** кнопка просмотра видео видима при выделенной ноде ([d9b9ca6](https://github.com/AnyNoteInc/AnyNote/commit/d9b9ca68d03f51f170c406b3fee7bbe5dda32991))
* **editor:** контракт diagram-svg в типах + гард ссылок в превью PlantUML ([77727ae](https://github.com/AnyNoteInc/AnyNote/commit/77727aef62ebe7bab00f2866f959d90144d172f8))
* **web:** preview-kind — обработка MIME-параметров + тест приоритета MIME над ext ([9e7e1d1](https://github.com/AnyNoteInc/AnyNote/commit/9e7e1d1242c38c4dd583161033168d602b09bb17))
* **web:** preview-pdf — size guard, guarded S3-чтение, 422 на битом doc, наблюдаемость ([9e026ff](https://github.com/AnyNoteInc/AnyNote/commit/9e026ff23bc59307ef31641e250efc363672400f))
* **web:** правки ревью просмотрщиков — центр 1:1, сброс состояния, blob-утечка, a11y, цвет кнопки ([66f0711](https://github.com/AnyNoteInc/AnyNote/commit/66f0711c111d809fabd856794577a04b0556f4f9))
* **web:** просмотр — отложенный revoke SVG-blob + Esc уважает defaultPrevented ([8c35bcb](https://github.com/AnyNoteInc/AnyNote/commit/8c35bcb5a18f3f23988b4babc51f926f833d7774))


### Features

* **editor:** клик по drawio и diagram-превью открывает общий просмотрщик ([ab87f01](https://github.com/AnyNoteInc/AnyNote/commit/ab87f0165a2e03a5325da626e9a2910b91a674e7))
* **editor:** клик по карточке вложения открывает просмотр ([82fbde5](https://github.com/AnyNoteInc/AnyNote/commit/82fbde5c31247f298835a479f67c7e13cdc31829))
* **editor:** кнопка «Открыть просмотр» у видео и аудио ([0d358c2](https://github.com/AnyNoteInc/AnyNote/commit/0d358c25153f8faeb5072d3bd34fac076b4fe0b5))
* **editor:** контракт onOpenFilePreview — типы, хелперы, протяжка опций ([f632a65](https://github.com/AnyNoteInc/AnyNote/commit/f632a65c3d2fe100e9a944b4d51c1f689ead757e))
* **editor:** просмотр изображения — клик (read-only), dblclick и кнопка тулбара ([59e9764](https://github.com/AnyNoteInc/AnyNote/commit/59e97649b68797409e419bc9c95f640178b51eb0))
* **page-export:** officeToPdf — конвертация office-документов через Gotenberg LibreOffice ([40c9e25](https://github.com/AnyNoteInc/AnyNote/commit/40c9e25cbe4cc6b6e31dd8e5d841587a5ca68ac8))
* **web:** resolvePreviewType — классификация файлов для просмотрщика ([aaf48f3](https://github.com/AnyNoteInc/AnyNote/commit/aaf48f374cabd7f1b6a80cb05f38771df8c6a735))
* **web:** контекст просмотра файлов + иконки фуллскрина/зума в @repo/ui ([0976d33](https://github.com/AnyNoteInc/AnyNote/commit/0976d33986d945e39bbfb6cff4a8dec79766560e))
* **web:** монтирование просмотрщика — провайдер, панели, оффсеты outline/FAB ([8d589e0](https://github.com/AnyNoteInc/AnyNote/commit/8d589e08477d634fb236c98c3cd3472f53fc1e93))
* **web:** просмотрщики по типам + zoom/pan вьюпорт ([de1d007](https://github.com/AnyNoteInc/AnyNote/commit/de1d007d66a1667e45200a9652504bd351a78358))
* **web:** роут preview-pdf — office → PDF через Gotenberg с S3-кэшем ([15805eb](https://github.com/AnyNoteInc/AnyNote/commit/15805eb8bab49704277292f9ea691aebfb85314c))
* **web:** сплит-панель и фуллскрин-диалог просмотра файлов ([24a8c8c](https://github.com/AnyNoteInc/AnyNote/commit/24a8c8c2ee0f4222d0f729b96562b2a846456975))

# [1.37.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.36.0...v1.37.0) (2026-07-11)


### Bug Fixes

* **agents:** gate messages-mode tokens to AIMessage to stop prompt echo ([9f80b55](https://github.com/AnyNoteInc/AnyNote/commit/9f80b551ee43432bf2ed029aef20b2ed272ee626))
* **editor:** empty-line placeholder wording — «пробел» для AI или «/» для команд ([1d6fbea](https://github.com/AnyNoteInc/AnyNote/commit/1d6fbea7b512fa1a2d671adaad1d26f5e658728d))
* **engines,web:** apply review findings — auth-order, live reads, index staleness, history hardening ([5a3c28f](https://github.com/AnyNoteInc/AnyNote/commit/5a3c28f952a06bfc660964cda9e3832a2f701147))
* **engines:** attach the Hocuspocus provider to its shared socket ([e5471ff](https://github.com/AnyNoteInc/AnyNote/commit/e5471ff2223460c639147fcb22c5f74b759a2e99))
* **engines:** restore MCP tools/list broken by the zod 4 upgrade ([1db19c8](https://github.com/AnyNoteInc/AnyNote/commit/1db19c8ad0bf7ae327c4552ff88fae26276ef3c3))
* **ui:** raise vitest testTimeout to survive parallel CI load ([5e71658](https://github.com/AnyNoteInc/AnyNote/commit/5e71658b29c9ad6280f60ffe5ed2866a23a51c6b))
* **web:** make page outline quick-nav clicks land reliably ([798528a](https://github.com/AnyNoteInc/AnyNote/commit/798528a0362d729b1eac2bf7472fe48d646000c6))
* **web:** page chats send the full thread history; tool-only turns stay in the prompt ([267250d](https://github.com/AnyNoteInc/AnyNote/commit/267250d8c7eba9b3541fe629911ed3a698bbbd4f))
* **web:** pin chat attachment uploads to the chat's workspace ([039985c](https://github.com/AnyNoteInc/AnyNote/commit/039985ce20a6b5cc6393c66812245c3a175f0c29))


### Features

* **editor,web,agents,engines:** page-chat wave 3 — inline-AI fixes + hard page binding ([f783a7a](https://github.com/AnyNoteInc/AnyNote/commit/f783a7a91ca5a658dcef86eff2b6bc1c13c74a62))
* **editor,web,engines,agents:** page-chat wave 4 — block Ask-AI, PDF tool, image↔file, echo fix, resize perf ([342e6e4](https://github.com/AnyNoteInc/AnyNote/commit/342e6e4a72223df3490a4588c180f1b8725a6b07))
* **editor:** center drag handle on the first line and enlarge controls ([fe287dc](https://github.com/AnyNoteInc/AnyNote/commit/fe287dc3844f018acdffcbe1d4f34fd00f9b7bec))
* **engines,agents,web:** renamePage/replaceInPage tools + page-bound system prompt ([2dacd9f](https://github.com/AnyNoteInc/AnyNote/commit/2dacd9fa1642f6ecf9e269405afff83c6b9dfad7))
* **engines:** apply agent page edits through the live yjs doc ([501f9fc](https://github.com/AnyNoteInc/AnyNote/commit/501f9fc55bb22c2ca36533b5cbdc13be2cf8c4a4))
* **ui:** compact chat density — full-width assistant output in the page panel ([c02da96](https://github.com/AnyNoteInc/AnyNote/commit/c02da96aac2d7aa9f6dc333466d413469527ed3e))
* **ui:** re-export icons/transitions for the page-chat panel ([27e9c48](https://github.com/AnyNoteInc/AnyNote/commit/27e9c488b92f3642d0fbda478bcd81f7d7dda196))
* **web,ui,editor:** page-chat wave 2 — resizable sidebars, answer actions, any-file uploads ([f20a166](https://github.com/AnyNoteInc/AnyNote/commit/f20a16625878d29be096ae1b6e9cbd8110bba886))
* **web:** page-chat panel — FAB auto-hide, slide-in animation, docked/floating modes, «Чат» header ([3f56ec5](https://github.com/AnyNoteInc/AnyNote/commit/3f56ec574500b960efd7c7912989ef00a4b34e4f))

# [1.36.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.35.1...v1.36.0) (2026-07-09)


### Bug Fixes

* **editor:** a11y labels, repaint unsubscribe and history trim in inline-AI widget ([b27ee17](https://github.com/AnyNoteInc/AnyNote/commit/b27ee17cf96bc0e5aeb7290e4c2008775ce4a09f))
* **editor:** discard space-AI draft on Esc regardless of focus ([51be9e8](https://github.com/AnyNoteInc/AnyNote/commit/51be9e86d70965903e637f13253cd6d4d5c7061a))
* **editor:** fold MUI 9-removed Stack system props into sx in space-AI feature ([8651d02](https://github.com/AnyNoteInc/AnyNote/commit/8651d021e96921c4bf4596a3d8d3327bc88a8c94))
* **editor:** harden space-AI bar against re-trigger, unmount and drift edges ([663d26a](https://github.com/AnyNoteInc/AnyNote/commit/663d26a6a0e10467544373b227dde2f4af1313a7))
* **editor:** ignore already-handled Escapes in space-AI bar listener ([44ff917](https://github.com/AnyNoteInc/AnyNote/commit/44ff9173ba4032fb136390fc989a8b81ece3b57c))
* **trpc:** fail closed on orphaned page chats and pin trash semantics ([37bebb1](https://github.com/AnyNoteInc/AnyNote/commit/37bebb1baa82387097a3e379e75f660fcb021a3e))
* **web:** keep page-chat client mounted through first-send thread creation ([0c66c64](https://github.com/AnyNoteInc/AnyNote/commit/0c66c64563c36619077e58ab8aa863963f43c3d6))
* **web:** keep preset inline-AI actions single-shot, pin history contract ([720f976](https://github.com/AnyNoteInc/AnyNote/commit/720f9761935613225068a7d1afe5dbbed74684ed))
* **web:** make the next 16.2.9 pin exact as intended ([483508d](https://github.com/AnyNoteInc/AnyNote/commit/483508dcb704b8af2d6d56146c8679fcc407f8f3))
* **web:** map bare 403 to plan upsell copy in inline-AI bridge ([a28bd07](https://github.com/AnyNoteInc/AnyNote/commit/a28bd0774c67b8736cfde0ca8ca79a05adc7f6d0))
* **web:** pin next to 16.2.9 — 16.2.10 turbopack dev intermittently deadlocks route compiles ([e038ee2](https://github.com/AnyNoteInc/AnyNote/commit/e038ee2f03314156ecd15a51dff18fd41d294e1c))
* **web:** reset shared hoisted mocks with resetAllMocks under vitest 4 ([23ad4e8](https://github.com/AnyNoteInc/AnyNote/commit/23ad4e8e869d2ea0fabc27e5ba708a92530a7f96))


### Features

* **db,domain:** ChatKind.PAGE + Chat.pageId with page-delete purge ([b99d5eb](https://github.com/AnyNoteInc/AnyNote/commit/b99d5eb5e5f50ff0cf9204d6fb32c53c8b519370))
* **editor,web:** generate-AI bridge contract + plan upsell copy ([f5b426a](https://github.com/AnyNoteInc/AnyNote/commit/f5b426a73c627b0a6e1aa202ed845c8fca0c4829))
* **editor:** custom instruction, insert-below and follow-up in inline-AI popover ([4031277](https://github.com/AnyNoteInc/AnyNote/commit/403127724d8da0185645b66900e9e6e8ea2a4d16))
* **editor:** insert-below apply mode for inline-AI results ([b398cde](https://github.com/AnyNoteInc/AnyNote/commit/b398cde83d8447030dfc146075ef81b3ad67b514))
* **editor:** space-AI bar with in-document streaming draft and markdown insert ([e2b8cbe](https://github.com/AnyNoteInc/AnyNote/commit/e2b8cbea8901815d20bb483c58c0cc3248fd3ad9))
* **editor:** space-bar AI trigger extension with empty-paragraph guard ([7fecaf1](https://github.com/AnyNoteInc/AnyNote/commit/7fecaf14b81cf9e50d58488e0ec1790092bf4a06))
* **trpc:** page-scoped chats — createChat pageId, listByPage, visibility gate ([164ebcb](https://github.com/AnyNoteInc/AnyNote/commit/164ebcba5c28008d2833317f3d54aa7b6fb29a89))
* **ui:** Fab export and chat composer context chip ([9a7be6d](https://github.com/AnyNoteInc/AnyNote/commit/9a7be6d74e316ef8b443152620aea34a42e6741e))
* **web:** accept generate/custom actions with history in /api/ai/inline ([2b8ca68](https://github.com/AnyNoteInc/AnyNote/commit/2b8ca689e41359dffbafb151ef9f74d51bd9e376))
* **web:** add generate/custom inline-AI prompt builders ([fd183d6](https://github.com/AnyNoteInc/AnyNote/commit/fd183d625b21b6e6bb7226f64ecf558f29a0d45c))
* **web:** inject page/selection context into page-chat generation ([cc9a9d7](https://github.com/AnyNoteInc/AnyNote/commit/cc9a9d79081919d4b394f27b3de33aa25bd5bff5))
* **web:** inject space-AI drafting bridge into the page editor ([1636573](https://github.com/AnyNoteInc/AnyNote/commit/163657343d255993126cc99efaeefbc28784d8b2))
* **web:** page chat panel with FAB, thread switcher and context chip ([76e3a92](https://github.com/AnyNoteInc/AnyNote/commit/76e3a92bf214a13bb06412ba4fb60bea436540cf))
* **web:** page variant of the workspace chat client with context injection ([f79edc5](https://github.com/AnyNoteInc/AnyNote/commit/f79edc5e826221b564131b9f298b08f4f158fd9b))
* **web:** rename/delete page-chat threads and record spec deviations ([6da6c58](https://github.com/AnyNoteInc/AnyNote/commit/6da6c5878a8dda62b9619868bee352abd0e37b17))

## [1.35.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.35.0...v1.35.1) (2026-07-07)


### Bug Fixes

* **editor:** place caret in toggle summary after slash insert ([3401c2a](https://github.com/AnyNoteInc/AnyNote/commit/3401c2a80cfab7608f8a51dae8dc35bc0cafe9e0))

# [1.35.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.34.0...v1.35.0) (2026-07-07)


### Features

* **web:** add GitHub repo link to footer and Open Source landing section ([52ec41a](https://github.com/AnyNoteInc/AnyNote/commit/52ec41a8cac8a6099ddf9204b56c08e4b87346cb)), closes [#opensource](https://github.com/AnyNoteInc/AnyNote/issues/opensource)

# [1.34.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.33.0...v1.34.0) (2026-07-05)


### Features

* retire Electron desktop app and its download flow ([cdd22dd](https://github.com/AnyNoteInc/AnyNote/commit/cdd22ddf32d5d79bad64078516471c4491ac32e8))

# [1.33.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.32.0...v1.33.0) (2026-07-05)


### Features

* **web:** add «Мои пространства» / «Последние действия» tabs to profile page ([872f987](https://github.com/AnyNoteInc/AnyNote/commit/872f987be248b50c937af9deca5721b8046a7275))

# [1.32.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.31.1...v1.32.0) (2026-07-05)


### Features

* **editor:** add blockToMarkdown block serializer ([ff23a29](https://github.com/AnyNoteInc/AnyNote/commit/ff23a296a59d211a39009ca79db0a339c8d35c1e))
* **editor:** add Копировать текст (copy block as markdown) to block menu ([ea3dd9a](https://github.com/AnyNoteInc/AnyNote/commit/ea3dd9a52e7bb937278d55b4a346b6bdee6eb231))

## [1.31.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.31.0...v1.31.1) (2026-06-28)


### Bug Fixes

* **deploy:** prune superseded images after bring-up to free host disk ([c945bfd](https://github.com/AnyNoteInc/AnyNote/commit/c945bfd2fe9ba121a425b592a1cc7dfd6f012592))

# [1.31.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.30.1...v1.31.0) (2026-06-27)


### Bug Fixes

* **billing:** capture @Cron renewal failures to Sentry ([501232d](https://github.com/AnyNoteInc/AnyNote/commit/501232da9cc2f9a9d6af333424872ca1d3a9fdb9))
* **indexer:** resolve connectionEnc before vectorizing workspace pages ([1c9d791](https://github.com/AnyNoteInc/AnyNote/commit/1c9d79120668f9377335f1df2d9f1521f52c5a25))
* resolve SonarCloud quality-gate findings on the audit quick-wins ([093d6b3](https://github.com/AnyNoteInc/AnyNote/commit/093d6b35a365f9336a3826e5745f1b2f2e54abc3))


### Features

* **agents:** bound graph recursion and degrade recoverably on limit ([a7ed451](https://github.com/AnyNoteInc/AnyNote/commit/a7ed4514740cf7c55db7c5fd905087f146bb4a07))


### Performance Improvements

* **agents:** index workspaceId/pageId payloads in Qdrant collections ([ee4e0f3](https://github.com/AnyNoteInc/AnyNote/commit/ee4e0f3a10b010449c2c5ff1c881665451c6535f))
* **chat:** bound per-chat message fetch in chat history builder ([f5534ac](https://github.com/AnyNoteInc/AnyNote/commit/f5534ac3dd269aefb285950cc30ac9c6245b2e7e))
* **database:** cap BOARD grouping fetch + surface truncated flag ([e753457](https://github.com/AnyNoteInc/AnyNote/commit/e753457e036603e6e28e1c3c98514bba7390e11e))
* **sidebar:** rewrite flattenTree from O(n²) to O(n) ([cb4c248](https://github.com/AnyNoteInc/AnyNote/commit/cb4c2483eaef7d56d9981e53219f69028b7d6714))
* **web:** drop redundant getMyRole client query in workspace layout ([ac4a695](https://github.com/AnyNoteInc/AnyNote/commit/ac4a69521a9a8670a526fe903c086f31448cd872))

## [1.30.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.30.0...v1.30.1) (2026-06-23)


### Bug Fixes

* **trpc:** route plan-maxed users out of the create-workspace dead-end ([8a56857](https://github.com/AnyNoteInc/AnyNote/commit/8a56857c6909e8cc1b4000932a647112fab41aa8))

# [1.30.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.29.1...v1.30.0) (2026-06-23)


### Bug Fixes

* **agents:** quiet expected ERROR-log noise + set service tag on global scope ([974944d](https://github.com/AnyNoteInc/AnyNote/commit/974944d5c6188cff040a22cb1a8bc27fe9da2e99))
* **agents:** type-annotate Sentry before_send hook for mypy ([a72a6dd](https://github.com/AnyNoteInc/AnyNote/commit/a72a6dde11aa1ebefc5ac8cb58437c9b97b96b37))
* **sentry:** drop dev events on engines/yjs/agents for free-tier parity with web ([8b5aa21](https://github.com/AnyNoteInc/AnyNote/commit/8b5aa21c4b37fb179d725f7ee5a792c73bc09bf8))
* **web:** prevent Sentry source-map build OOM (gate generation on token + raise heap) ([4cfdac4](https://github.com/AnyNoteInc/AnyNote/commit/4cfdac40274ea934e881134a85c14eddf2286924))
* **web:** raise tsc heap to fix check-types OOM on CI runners ([fe4c076](https://github.com/AnyNoteInc/AnyNote/commit/fe4c0760e10007442be4e879af8c85f3508b1479))
* **web:** read NEXT_PUBLIC_SENTRY_* in browser Sentry config (Next only inlines public env) ([464d1fe](https://github.com/AnyNoteInc/AnyNote/commit/464d1feddc8317db1c9b38120d1d71215675caf9))
* **yjs:** await onLoadDocument capture + exclude normal token-denial from Sentry ([eef2bb8](https://github.com/AnyNoteInc/AnyNote/commit/eef2bb866201e70c4369b0e972a12eb31f5199e3))


### Features

* **agents:** direct sentry_sdk init with tracing + service tag ([e356444](https://github.com/AnyNoteInc/AnyNote/commit/e3564446130bbd526848ded9c0a5bfe2d2915841))
* **agents:** tag Sentry with LLM provider/model + capture config/run errors ([4a654ec](https://github.com/AnyNoteInc/AnyNote/commit/4a654ec9a8a9f1fae62bb08a90bd1a6a1f987e46))
* **engines:** capture cron-worker errors in Sentry (global filter misses scheduled jobs) ([f4f9873](https://github.com/AnyNoteInc/AnyNote/commit/f4f9873edd6d099e5c1da443e121bcb1fca44b01))
* **engines:** capture per-subscription renewal failures in Sentry ([c39bf0b](https://github.com/AnyNoteInc/AnyNote/commit/c39bf0b8145dc1e03696df85067abcb1192e3c0a))
* **engines:** initialize Sentry before module load + SentryModule ([c569baf](https://github.com/AnyNoteInc/AnyNote/commit/c569baf4ec01abe12ff84bdd906c73fcd46e01d4))
* **trpc:** attach authenticated user to Sentry scope in context ([d085ff7](https://github.com/AnyNoteInc/AnyNote/commit/d085ff787e38cd0fb28f6dbd767741b635a6e4ed))
* **web:** capture YooKassa webhook processing failures in Sentry ([fa7d4f9](https://github.com/AnyNoteInc/AnyNote/commit/fa7d4f9dbfa3cbf98de52bd0a4ada952493b5ded))
* **web:** Sentry init for browser, server, edge + global-error boundary ([05e2fc7](https://github.com/AnyNoteInc/AnyNote/commit/05e2fc7f51265948993c2f0bd0484363031636db))
* **web:** set Sentry user on the browser scope ([153fc1f](https://github.com/AnyNoteInc/AnyNote/commit/153fc1f08f9362fcc1de3867e44d0b7cad4453ee))
* **web:** shared Sentry init options with dev-drop + noise filter ([e46c1dc](https://github.com/AnyNoteInc/AnyNote/commit/e46c1dc8e498f50f7a60a002900685a4bea03419))
* **yjs:** initialize Sentry + capture unexpected auth/persist failures ([8ce2072](https://github.com/AnyNoteInc/AnyNote/commit/8ce20728ddf26323739fd9ae9ff78de2644fe1a0))

## [1.29.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.29.0...v1.29.1) (2026-06-23)


### Bug Fixes

* **desktop:** ad-hoc sign the mac app so it stops showing "damaged" ([39d19be](https://github.com/AnyNoteInc/AnyNote/commit/39d19bef555f6402eb775e6178bc3080df5da50b))

# [1.29.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.28.4...v1.29.0) (2026-06-22)


### Features

* **web:** explain the macOS "app is damaged" Gatekeeper block ([95a7012](https://github.com/AnyNoteInc/AnyNote/commit/95a701236648f116229f03ff12a4253b0860094e))

## [1.28.4](https://github.com/AnyNoteInc/AnyNote/compare/v1.28.3...v1.28.4) (2026-06-22)


### Bug Fixes

* **desktop:** set homepage/author in package.json, not electron-builder.yml ([588ec18](https://github.com/AnyNoteInc/AnyNote/commit/588ec1841bc0fd0ad15be180b94588b21c1b854f))

## [1.28.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.28.2...v1.28.3) (2026-06-22)


### Bug Fixes

* **desktop:** push installers into internal MinIO over SSH; fix linux build ([15fa351](https://github.com/AnyNoteInc/AnyNote/commit/15fa3515fe7da77a754f796027b00fcdd6ab7fd9))

## [1.28.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.28.1...v1.28.2) (2026-06-22)


### Bug Fixes

* **desktop:** disable GitHub publish in electron-builder (ship via S3) ([6badb6a](https://github.com/AnyNoteInc/AnyNote/commit/6badb6aeefe92e1c02d2d129707556163169ce39))

## [1.28.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.28.0...v1.28.1) (2026-06-22)


### Bug Fixes

* **web:** serve desktop installers from S3 via /api/download proxy ([42bb4c5](https://github.com/AnyNoteInc/AnyNote/commit/42bb4c5fcccc4a5296039c9a60e8be041d3eac1a))

# [1.28.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.27.0...v1.28.0) (2026-06-22)


### Features

* **web:** serve desktop installers locally and move download to page end ([c923d5b](https://github.com/AnyNoteInc/AnyNote/commit/c923d5b28a40ac88ed59444da88bdde94c155b53))

# [1.27.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.26.0...v1.27.0) (2026-06-22)


### Bug Fixes

* **auth:** use BETTER_AUTH_URL for transactional email links ([f7ed19e](https://github.com/AnyNoteInc/AnyNote/commit/f7ed19eef73267937cebbc3496cab0c0a21c680b))
* **desktop:** emit .cjs main/preload and lazy electron-store init ([c144a76](https://github.com/AnyNoteInc/AnyNote/commit/c144a7684ed81545337dcf7797d4e6525f6b09e5))
* **desktop:** origin-check external links, sandbox selection window, ping timeout, iife renderer, log change-server errors ([737919b](https://github.com/AnyNoteInc/AnyNote/commit/737919bb36109995f16fc4c313009166673e83de))
* **desktop:** pin installer artifact names, split preload to isolate setup bridge, bump electron ([d688efe](https://github.com/AnyNoteInc/AnyNote/commit/d688efea182822209bb7715907a95d3aef8c1fe8))


### Features

* **auth:** hide Google sign-in from the site; add proprietary LICENSE ([ad56a24](https://github.com/AnyNoteInc/AnyNote/commit/ad56a2419755f8657ecb9eaaad6d8099356282cf))
* **desktop:** app entry, menu, connect IPC, auto-update ([cdae79b](https://github.com/AnyNoteInc/AnyNote/commit/cdae79bd458103311ef0d3a75cf8589e9c10307f))
* **desktop:** desktop user-agent builder ([10cb117](https://github.com/AnyNoteInc/AnyNote/commit/10cb117da298c001d6841a3c6f7aaee8075847d2))
* **desktop:** electron-store server-url config ([68e9b5c](https://github.com/AnyNoteInc/AnyNote/commit/68e9b5cb59895bcc2278fbc2657e0760c08c3133))
* **desktop:** health-check ping with injectable fetch ([242ba9c](https://github.com/AnyNoteInc/AnyNote/commit/242ba9c6185d47c887d4e7a8f54df3e8d1b2f54b))
* **desktop:** local server-selection screen ([ffa4164](https://github.com/AnyNoteInc/AnyNote/commit/ffa41643b0625c1a2b7709791d6c2dc79dd841c6))
* **desktop:** main window with custom UA and external-link handling ([9bd758a](https://github.com/AnyNoteInc/AnyNote/commit/9bd758adc27e4cd2c91e2847dad6ad6db90fa313))
* **desktop:** preload contextBridge for window.anynote ([2d0ed62](https://github.com/AnyNoteInc/AnyNote/commit/2d0ed62d0a6468b05513acda44f95abb4c184627))
* **desktop:** server-url normalization and validation ([3c28d91](https://github.com/AnyNoteInc/AnyNote/commit/3c28d916008d76981ac669ab887f323a5b2f050c))
* **desktop:** window.anynote api shape ([55d0cce](https://github.com/AnyNoteInc/AnyNote/commit/55d0cce11a8e6c2bbb7abaa6e24231a17b8264e2))
* **web:** desktop download-link helpers ([16f99d7](https://github.com/AnyNoteInc/AnyNote/commit/16f99d7add3a3de458d2af41d31dabb4a291316f))
* **web:** HomeDownload section component ([190b584](https://github.com/AnyNoteInc/AnyNote/commit/190b5842a31addead01c545787420bbdb1507d03))
* **web:** recognize AnyNote desktop client in session list ([c8b69c9](https://github.com/AnyNoteInc/AnyNote/commit/c8b69c996e8acfe20eeb8c45045db1c06eeed5d7))
* **web:** show desktop download section first on home page ([2d16950](https://github.com/AnyNoteInc/AnyNote/commit/2d169500ebd875d7c58c2d0a70c1edb6de1f7c62))

# [1.26.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.25.0...v1.26.0) (2026-06-16)


### Bug Fixes

* **diagram:** sanitize foreignObject geometry in inline SVG + add page error boundary ([9c9a597](https://github.com/AnyNoteInc/AnyNote/commit/9c9a59749ad7953a6dbbbadee01767f5a767d345))
* **domain:** moveToCollection detaches and splices at the drop position ([2aca3cc](https://github.com/AnyNoteInc/AnyNote/commit/2aca3cc464a67097a39d43b2c69b7efbab5026cc))
* **domain:** moveToCollection preserves parentId on plain move + adds cycle/self-ref guards ([2ba328e](https://github.com/AnyNoteInc/AnyNote/commit/2ba328eb5c7ec67471097447c8e659b93ae92da5))
* **engines:** parse GFM tables in MCP markdown parser ([36d3bd0](https://github.com/AnyNoteInc/AnyNote/commit/36d3bd020826385e402539db046fbd649d55e921))
* **engines:** render table nodes to GFM markdown in MCP renderer ([8e85705](https://github.com/AnyNoteInc/AnyNote/commit/8e85705d04ed6c4444b59aba43903f3b830d32bb))
* **engines:** serialize MCP tables into contentYjs via table extensions ([a4737c4](https://github.com/AnyNoteInc/AnyNote/commit/a4737c4f165a01ac8343f86fb27ecaeb872475d0))
* scope optimistic move-into to target collection, escape table cells, drop dead SwitchWorkspaceButton ([a3706c9](https://github.com/AnyNoteInc/AnyNote/commit/a3706c931d9edfffb59e9128a00b62cd90fb1af7))
* **trpc:** scope user.activity to current workspace memberships (no cross-tenant leak) ([db62416](https://github.com/AnyNoteInc/AnyNote/commit/db6241636d607928d8b9adccc78b16ba068beac7))
* **web:** drag into Личное/Команда splices at the drop position, optimistically ([6a68e10](https://github.com/AnyNoteInc/AnyNote/commit/6a68e109e4e2102807227560fbcf841d0a1d1a4a))
* **web:** hang page icon in the left gutter, keep title position fixed ([c0356d5](https://github.com/AnyNoteInc/AnyNote/commit/c0356d571c72261473fbf257f2fb4d37843148ba))
* **web:** order pages by the linked-list chain within each collection ([711d52e](https://github.com/AnyNoteInc/AnyNote/commit/711d52efd0fb547ebd059ebeb0f00144d4025fca))
* **web:** vertically center the right outline nav ([771846f](https://github.com/AnyNoteInc/AnyNote/commit/771846f803b5947c9eb85b19d1300ba2281c6cd2))


### Features

* **trpc:** user.activity per-day PageRevision counts + recent actions ([51ee3ba](https://github.com/AnyNoteInc/AnyNote/commit/51ee3bab178f0f0cc2a8a692401943c1dbd6953f))
* **web:** move /notifications to a standalone page with the public header ([447516f](https://github.com/AnyNoteInc/AnyNote/commit/447516f09dedf7c504385a33fa7730f15f8db559))
* **web:** replace profile workspaces with activity grid + recent actions ([806c24b](https://github.com/AnyNoteInc/AnyNote/commit/806c24b740c14dcb8270b2a4aa72db26a9c0894c))

# [1.25.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.24.0...v1.25.0) (2026-06-15)


### Bug Fixes

* **editor:** datetime node — make time selectable, not just date ([4782b8a](https://github.com/AnyNoteInc/AnyNote/commit/4782b8a17b704b97ccea845e7296d34f57d41728))
* **editor:** persist async-picker slash inserts (synced block, db, meeting, drawio) ([c00b74f](https://github.com/AnyNoteInc/AnyNote/commit/c00b74fa52384751e2ba4205c3d09f3c5089f669))
* **web:** make page-title add-icon/add-cover buttons visible (text variant, hover contrast) ([29b5d77](https://github.com/AnyNoteInc/AnyNote/commit/29b5d77544ad9e33da6fcbde062f1ed964ae40ef))
* **web:** move /notifications under (active) so it gets the workspace toolbar ([1a57416](https://github.com/AnyNoteInc/AnyNote/commit/1a57416106fefea3bf2040c5f699b6b4983fef81))
* **web:** profile 'Перейти' switches active workspace before navigating ([c10a19f](https://github.com/AnyNoteInc/AnyNote/commit/c10a19ffa44a0048c9072a74d281b749d1b52bb9))
* **web:** sidebar scroll runs through the page list only, pin tabs + bottom links ([6eeeb32](https://github.com/AnyNoteInc/AnyNote/commit/6eeeb32695ec347f6a2e10ae6a40d6445bf5f5a0))
* **web:** single scroll region for the pages sidebar ([0b094df](https://github.com/AnyNoteInc/AnyNote/commit/0b094df0c5223b409d50486afc95458011cce928))
* **web:** whole-section move drop zones + same-section reorder precedence in sidebar DnD ([4834ec0](https://github.com/AnyNoteInc/AnyNote/commit/4834ec05894c38078a3e4efacb1eb17fa2f07648))


### Features

* **integration:** show only implemented (Telegram) integration on settings page ([799b69d](https://github.com/AnyNoteInc/AnyNote/commit/799b69d2ce566de2159f2bb0586d3e7dea5b8c8c))
* **web:** API key expiry uses a Select; 'Никогда' → 'Бессрочный' ([300cac9](https://github.com/AnyNoteInc/AnyNote/commit/300cac94f76bd2629bef8730df3cbbce942f6de6))
* **web:** create dashboards and upload meetings from the unified '+' menu ([17cc3a9](https://github.com/AnyNoteInc/AnyNote/commit/17cc3a9a73886aa928e12c5e4bf821104c17c26e))
* **web:** favorites/team/personal as first-level sidebar tree roots, pinned collections below ([9eb953a](https://github.com/AnyNoteInc/AnyNote/commit/9eb953a03b6149fbaee7bdb8db6433062f52269b))
* **web:** page cover spans full content-area width, flush under breadcrumbs ([ad9093c](https://github.com/AnyNoteInc/AnyNote/commit/ad9093cca029cc8144763534b93af200bb50a56e))
* **web:** show active workspace / create-space link in app user menu ([092ecfd](https://github.com/AnyNoteInc/AnyNote/commit/092ecfdae5d42881bf6b4bc7e264fecb2948ed02))
* **web:** sidebar drag-and-drop — favorite/move/archive/trash drop zones ([6e75e70](https://github.com/AnyNoteInc/AnyNote/commit/6e75e7052c8928f9a06c8a150a02534e2bfe8280))

# [1.24.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.23.0...v1.24.0) (2026-06-14)


### Bug Fixes

* **9b:** guard async editor dispatch, listener cleanup, auth-before-ratelimit, redirect base-url ([32bcefa](https://github.com/AnyNoteInc/AnyNote/commit/32bcefa1d89f98a6c23f4426b4b364f6af09c4c4))
* **appearance:** magic-bytes for public uploads, image-icon dialog faces, public caching, exact changed hints ([3c83fd5](https://github.com/AnyNoteInc/AnyNote/commit/3c83fd554db0b9f2130d462aa6ea96f270a65b38))
* **billing:** invoice email in deploy template, pin seat-refund non-goal ([00a0728](https://github.com/AnyNoteInc/AnyNote/commit/00a07286b59e596e5e27c40c955d52dc21a0a09c))
* **billing:** settle-once guards, deterministic renewal idempotency, charge-equals-applied seats ([a5848b4](https://github.com/AnyNoteInc/AnyNote/commit/a5848b4a8eef1d62a63d95eb7365787ba8d467cd))
* **dashboards:** single widget title + document DATE group-by granularity ([ea6eb57](https://github.com/AnyNoteInc/AnyNote/commit/ea6eb575162247dcd182833f0616aa2ac7c186f5))
* **database:** close 2 review findings — trash leak + deleted-row mutations ([e2da53f](https://github.com/AnyNoteInc/AnyNote/commit/e2da53f38dcf36d09fb977f5aaf39f90e4e78cd9))
* **database:** close 3 review findings — URL scheme, non-finite number, formula DoS ([e5d502c](https://github.com/AnyNoteInc/AnyNote/commit/e5d502cc30b933c1127db5d0bd932e0d8e45b2c7))
* **database:** close 3 review findings + verify JSON number comparison ([aed1d01](https://github.com/AnyNoteInc/AnyNote/commit/aed1d014ac6d4cbd3fa503a2c4c73d4115ec8f43)), closes [#8224](https://github.com/AnyNoteInc/AnyNote/issues/8224)
* **database:** close 6 access-control review findings (1 critical, 4 high, 1 medium) ([fa8ee1e](https://github.com/AnyNoteInc/AnyNote/commit/fa8ee1e32999480a865bde311c72a337678b6669))
* **database:** SELECT/STATUS is_any_of in planner + invalidate rows on view-config change ([8132192](https://github.com/AnyNoteInc/AnyNote/commit/81321922b63b71ef61419d38b930a94890e26b1d))
* **db:** FK-support indexes on artifact/mapping tables + cascade note ([7347fab](https://github.com/AnyNoteInc/AnyNote/commit/7347fab6af137c32b7f13684b0213c7b2183f449))
* **db:** order collections migration after the squash; drop cl*.md from merge ([dddb42c](https://github.com/AnyNoteInc/AnyNote/commit/dddb42cb58d75c30642f88aa21940b362a615c57))
* **developers:** canonical page url in api docs, hardened drift guards, sitemap coverage ([ace06b0](https://github.com/AnyNoteInc/AnyNote/commit/ace06b0aaff99070da74f3564d82af86ff22f9c6))
* **domain:** hide template backing pages from page listings ([8e92f70](https://github.com/AnyNoteInc/AnyNote/commit/8e92f701c110b6a539b1667b60e260a9ff47b163))
* **domain:** singleton UnitOfWork — transactions were autocommit across all modules ([a79fbbb](https://github.com/AnyNoteInc/AnyNote/commit/a79fbbb1920c9463bc3c1bf843d52b7773ea865f))
* **domain:** validate tags in template update; drop dead listTagsInput; clarify comments ([7b41e90](https://github.com/AnyNoteInc/AnyNote/commit/7b41e90e4aa7e7a9d15e882687e43a2119089ad3))
* **editor:** allow editing time in datetime node ([8630694](https://github.com/AnyNoteInc/AnyNote/commit/863069453c6d8dfaa4ddbeb909f18efdd8b4123a))
* **editor:** block javascript/data/vbscript schemes in normalizeLinkHref ([b2641ca](https://github.com/AnyNoteInc/AnyNote/commit/b2641ca573d73306a57964d2426264539ba089a6))
* **editor:** clickable links + no https:// prefill in plain editor ([f9acc92](https://github.com/AnyNoteInc/AnyNote/commit/f9acc9220b467228ade95695ddfb358b87ead24d))
* **editor:** give links color, underline, and pointer cursor ([8a9a492](https://github.com/AnyNoteInc/AnyNote/commit/8a9a4923b3d765222b9221ef8486bece38f7bd79))
* **editor:** ignore superseded inline-AI run callbacks on retry ([473b215](https://github.com/AnyNoteInc/AnyNote/commit/473b21517ee414fe12680c152e4ccd17c22a6bfc))
* **editor:** open links in new tab in page editor and HTML export ([e01de79](https://github.com/AnyNoteInc/AnyNote/commit/e01de79448af013c25254eb9624fa190fa967b98))
* **editor:** require left button for modifier link-open + test attachLinkClickHandler ([cc8df55](https://github.com/AnyNoteInc/AnyNote/commit/cc8df550e1bb52211358f216d1d540dfa9d51f44))
* **editor:** stable inline-AI widget key — no per-token DOM thrash ([b0e781e](https://github.com/AnyNoteInc/AnyNote/commit/b0e781e8ded29d6a2976ddc6d9de961644427990))
* **editor:** view-mode link clicks + no https:// prefill in toolbar dialog ([f9e301b](https://github.com/AnyNoteInc/AnyNote/commit/f9e301bf881ceee52b7bba52c2cf77b6e213fd4c))
* **identity:** bound discovery responses, require issuer match, document rebinding window ([ca177af](https://github.com/AnyNoteInc/AnyNote/commit/ca177af17d426b2d39dfb9da120d39e0c2681487))
* **identity:** port-before-tx domain removal, batched join lookup, sso docs + type/test hardening ([adae9fc](https://github.com/AnyNoteInc/AnyNote/commit/adae9fc16b08c8704d7da6d49e7797bab80244ac))
* **identity:** reserve jit-joined audit action, rate-limit sso resolve ([73c05c6](https://github.com/AnyNoteInc/AnyNote/commit/73c05c60abbe48fd673e31bf395d33b0ab2cb765))
* **marketplace:** render columnLayout in previews + guard preview conversion ([2df8f83](https://github.com/AnyNoteInc/AnyNote/commit/2df8f834da14e9d6afdad62ff09a1756c557ac44))
* **meetings:** idempotent re-processing (no segment dup on retry) + blocked-member reads return no_access ([e2d5a34](https://github.com/AnyNoteInc/AnyNote/commit/e2d5a34a2e5a74acce1687d7ad69d633b6740cd2))
* **meetings:** reclaim stalled in-progress artifacts + plan-gate the slash item ([71183cc](https://github.com/AnyNoteInc/AnyNote/commit/71183cc67236702af8bc91d09adb8fc20edc38ec))
* **notifications:** close 3 review findings — comment leak, trashed-page history, dedup ([4aa671a](https://github.com/AnyNoteInc/AnyNote/commit/4aa671a26d7bb8cb79caf0c4d8b7b5bd8ef4b610))
* **pages:** close visibility leak in getById + file attach/detach ([114f779](https://github.com/AnyNoteInc/AnyNote/commit/114f779e814e6a907c871f384bffadb918e2a5d2))
* **people:** accept-origin check, hydration chip, hidden-section render, block-oracle, e2e hygiene ([c3c0139](https://github.com/AnyNoteInc/AnyNote/commit/c3c0139e094e1e43a40ad44ec5a81b57904d1d6b))
* **people:** concurrent-accept races, in-tx seat re-check, join-link audit parity ([813f9e9](https://github.com/AnyNoteInc/AnyNote/commit/813f9e9c2b91f197d71c09b051779e143bf05b70))
* **people:** getById block filter, convert-race convergence, agents chat-lookup filter ([2cda4e6](https://github.com/AnyNoteInc/AnyNote/commit/2cda4e6cc40ad9636117cfe7230b5bada0127c17))
* **pwa:** no runtime offline re-cache, single-use install prompt, request-keyed match ([834cf91](https://github.com/AnyNoteInc/AnyNote/commit/834cf913b3c0eef82cf7e48bfd27fbc70bb17d01))
* **seats:** bigint proration, in-tx legacy capacity check, honest reduction ledger ([74d3fcd](https://github.com/AnyNoteInc/AnyNote/commit/74d3fcdc6354256b05b541c542fa25df09fae0fb))
* **security:** atomic first-ack, nullable requester email, override forward-declaration note ([6181d52](https://github.com/AnyNoteInc/AnyNote/commit/6181d525e43fcb71b5fc453cbff35dd8dc2d85ed))
* **security:** gate allowCopy under the copy policy, document notification url shape ([96b9d4e](https://github.com/AnyNoteInc/AnyNote/commit/96b9d4ef5390930a59397dc96706dfa20861bbc3))
* **security:** page-gate myGuestRequests, honest link-role reset notice ([758fd05](https://github.com/AnyNoteInc/AnyNote/commit/758fd057fadb3edc1982deafb57f2be8422c0db1))
* **share:** close 3 review findings — subpage yjs, metadata leak, copy password ([d8e5ad0](https://github.com/AnyNoteInc/AnyNote/commit/d8e5ad0aa43698409363c6b9f163a75bdb0d4246))
* **telegram:** atomic link-code claim — concurrent /link can no longer double-consume ([03074e1](https://github.com/AnyNoteInc/AnyNote/commit/03074e1d1e1ede6d5a242df64e8a2b790ede8b11))
* **telegram:** avoid TS parameter properties in TelegramApi for Node strip-types ([5f1a100](https://github.com/AnyNoteInc/AnyNote/commit/5f1a100a9931f78dfb887acb40fd20062240e0e2))
* **telegram:** deploy env template, gated log queries, bounded e2e timeout ([d66f1f3](https://github.com/AnyNoteInc/AnyNote/commit/d66f1f343f8cb737ce9f2cfad7fb6f8ed9afb94a))
* **telegram:** search length cap, robust chat-gone detection, disabled-status guard + security-path tests ([4ae58ce](https://github.com/AnyNoteInc/AnyNote/commit/4ae58ced503dbc1e3a79a747438f97b159fc3500))
* **templates:** refresh sidebar tree after Использовать so the new page shows immediately ([bac0c5a](https://github.com/AnyNoteInc/AnyNote/commit/bac0c5adeb6e03c006a0e416eea49380f7ebc23c))
* **templates:** render content for backing-page-less templates (no 404) ([9d071e7](https://github.com/AnyNoteInc/AnyNote/commit/9d071e7f101d5cf7fbec1b71ee72e8e14663f606))
* **templates:** use backing-page content on instantiation; wire see-all; back-to-marketplace; soft-delete backing page; cleanup ([bacaf97](https://github.com/AnyNoteInc/AnyNote/commit/bacaf977d26134dc26c001ec3c78a606bac54f4a))
* **test:** generous timeout for the real-DNS default-resolver check ([b2e1cbb](https://github.com/AnyNoteInc/AnyNote/commit/b2e1cbb08155b62d7acf5406a6111312d32deb37))
* **test:** scope outbox drain loops to the fixture workspace — global drain never terminates under gates concurrency ([b9cca58](https://github.com/AnyNoteInc/AnyNote/commit/b9cca58e896cb83586e6a238eb44c27d14bcfb5c))
* **test:** scope subscription-count assert to the fixture connection ([de36a6a](https://github.com/AnyNoteInc/AnyNote/commit/de36a6a0149e97076b089f20744103c46bf1b8a1))
* **trpc:** enforce single active job via partial unique index, archived-parent guard ([36423f3](https://github.com/AnyNoteInc/AnyNote/commit/36423f3147d2bd174aeaa355f63816f18f7af7ed))
* **trpc:** reject non-document template content; richer Yjs derivation ([004f7a9](https://github.com/AnyNoteInc/AnyNote/commit/004f7a974ca565eac57ffba3ec5da4f7e6956f0b))
* **trpc:** stringify Plan.maxFileBytes in subscription.getCurrent ([9d1193b](https://github.com/AnyNoteInc/AnyNote/commit/9d1193bde0e3ab2c143f3f8af1f8d58b71529602))
* **trpc:** synced-block getById gates unsynced/orphan content by origin visibility ([6a46e5d](https://github.com/AnyNoteInc/AnyNote/commit/6a46e5d31de8c28cd778f8c186051035e9b0249a))
* **trpc:** visibility-aware synced-block mutation gate + honest anon snapshot ([f79d2f9](https://github.com/AnyNoteInc/AnyNote/commit/f79d2f95899364178d86025e06674bfa69311ed0))
* **web:** artifact files owner-only (workspaceId null), import mapping race, nosniff ([86a5d12](https://github.com/AnyNoteInc/AnyNote/commit/86a5d12d01b2333ea26e78874dd4ea45e937ef59))
* **web:** bookmark-preview route exports only valid Next route fields ([6a6dee2](https://github.com/AnyNoteInc/AnyNote/commit/6a6dee23f14622dd33f872416f498c8e40ec2ca2))
* **web:** export asset workspace scoping + atomicity, depth guards, resume-aware quota ([9da08fa](https://github.com/AnyNoteInc/AnyNote/commit/9da08fa7d339eb2a00b0f22505c048445ad52464))
* **web:** gate template editor by edit permission; fetch backing page via template-scoped path ([91d16ba](https://github.com/AnyNoteInc/AnyNote/commit/91d16ba37e247ac8d34430055bc8372aad796d0c))
* **webhooks:** configurable challenge timeout, honest delivery switch, verify/update coverage ([7463a5c](https://github.com/AnyNoteInc/AnyNote/commit/7463a5c613777bda49531c69b35820e15c9fae62))
* **webhooks:** redact non-team hint page ids at fan-out, reclaim stale delivery locks ([91cb1f6](https://github.com/AnyNoteInc/AnyNote/commit/91cb1f67b4f8f9e7a67444edf4daa0106d1c85ab))
* **webhooks:** stable event ids + unique deliveries, transactional comment emissions, terminal decrypt failures ([0c1c384](https://github.com/AnyNoteInc/AnyNote/commit/0c1c384531470b2e9d6ce8e067f763c7c1250f96))
* **web:** import converters — gfm table mapping, dot-path normalization, review nits ([317e575](https://github.com/AnyNoteInc/AnyNote/commit/317e57572590265f5df138dfe73101fdd304726c))
* **web:** import wizard file-input reset, orphan-upload note, test mock completeness ([b7b6e6f](https://github.com/AnyNoteInc/AnyNote/commit/b7b6e6f88e6f69f2d8de7e0502dcad3cbe6e73ed))
* **web:** merged-folder database placement, row-race cleanup, property type match ([6b2eeb1](https://github.com/AnyNoteInc/AnyNote/commit/6b2eeb1cdec3621f3deae878ebd525a05e6b2533))
* **web:** multi-select inference guard, csv bounds, confluence title sanitization ([b4e191c](https://github.com/AnyNoteInc/AnyNote/commit/b4e191cba50acb5273c98071a5989db5f16fd0a7))
* **web:** nested notion link/image resolution, asset dedup, duplicate-row handling ([b92d803](https://github.com/AnyNoteInc/AnyNote/commit/b92d803398de64541aa51c61bdc9356a52c6edc4))
* **web:** pdf database-render failure degrades to html, cap sync csv export rows ([8851074](https://github.com/AnyNoteInc/AnyNote/commit/885107402252bdcfa2e559e4aa27afbee510a15d))
* **web:** return 404 (not 500) for missing pages/templates in neutral routes ([ab8112e](https://github.com/AnyNoteInc/AnyNote/commit/ab8112e4163f6905d3caf780384887f04aa7d18b))
* **web:** robust template editor save + MUI delete confirm ([25140c4](https://github.com/AnyNoteInc/AnyNote/commit/25140c45a7098cee223fa42567ecce64efdd9bf6))
* **web:** route settings hotkey + legacy MCP redirect to the dialog ([3a44893](https://github.com/AnyNoteInc/AnyNote/commit/3a44893c27c5dcee99e5071526af35d133f2b614))
* **web:** settings dialog error/not-found state + accessible name ([c42ab92](https://github.com/AnyNoteInc/AnyNote/commit/c42ab9239580e12340cae0291b67bfa19a020429))
* **web:** settings dialog opens the requested section ([12457d0](https://github.com/AnyNoteInc/AnyNote/commit/12457d0a660e9d3af5a77c78f43cb9a9ea3b1c7a))
* **yjs:** synced-block live access gates origin page by collection visibility ([c3b8941](https://github.com/AnyNoteInc/AnyNote/commit/c3b8941fa563950afbadfa5302788484586a5ba0))


### Features

* **agents:** /transcription (S3-reading, mock-or-real adapter) + /meeting/summarize (workspace provider) ([a5de476](https://github.com/AnyNoteInc/AnyNote/commit/a5de47670a7b58372059b30f082631797fbe394c))
* **auth:** better-auth sso plugin — runtime oidc providers (compatibility spike) ([956fa98](https://github.com/AnyNoteInc/AnyNote/commit/956fa9848b42a0819fb4b8cfc75ae3f61fb7ee86))
* **billing:** seat-purchase orders and seat-aware renewals with snapshots ([a23deb5](https://github.com/AnyNoteInc/AnyNote/commit/a23deb5e023a5af39bad734b1e0338e473109da4))
* **database:** hide database item pages from tree/search/MCP ([9575704](https://github.com/AnyNoteInc/AnyNote/commit/957570459a3dd814f658e0b922f71b65a18a51e9))
* **database:** self-targeted date-cell reminders via the notification pipeline ([1e5a63e](https://github.com/AnyNoteInc/AnyNote/commit/1e5a63ebe4cba99455e8c38a9883b179b7fa1116))
* **database:** unsupported placeholder for embedded db in public copies ([be4eddf](https://github.com/AnyNoteInc/AnyNote/commit/be4eddfd1d2785f84b08049c59e7c328d795cf8e))
* **db:** add Collection model + Page archive/collection fields ([cb275e6](https://github.com/AnyNoteInc/AnyNote/commit/cb275e6fc51e0fd3244bf77c3ad33cb80de7b41c))
* **db:** add Task.actualDate field and ACTUAL_DATE_CHANGED activity ([553b34b](https://github.com/AnyNoteInc/AnyNote/commit/553b34bbedabfd769d5dcb3b0fafe95283fef807))
* **db:** add UserPreference.activeWorkspaceId ([23db3ad](https://github.com/AnyNoteInc/AnyNote/commit/23db3ad1986b93031e0708df90b877d985cd2989))
* **db:** ChatKind.INLINE_AI ephemeral chats — list-excluded, page-delete-pruned ([8d4288c](https://github.com/AnyNoteInc/AnyNote/commit/8d4288cfc6ff578bc6d896f65d0349c29cc7d2b4))
* **db:** CSV import format, PDF_ZIP export format, ExportJob.result ([7d9335e](https://github.com/AnyNoteInc/AnyNote/commit/7d9335e6d8af8a4b5895f53ab3a70d8b306b08cc))
* **db:** dashboard models — Dashboard/DashboardWidget/DashboardGlobalFilter + DASHBOARD page type ([e0e40f9](https://github.com/AnyNoteInc/AnyNote/commit/e0e40f934ca18f867de2212e90178e0745dc200a))
* **db:** database page access rules + structure lock ([577faec](https://github.com/AnyNoteInc/AnyNote/commit/577faecb412a94feac83a91ec9df3146e70d544f))
* **db:** database source/view/property/row/cell models ([d7933c0](https://github.com/AnyNoteInc/AnyNote/commit/d7933c081a38be1bf4b44705c78b5f85ee82b74f))
* **db:** database view types BOARD/CALENDAR/LIST ([6dc5e60](https://github.com/AnyNoteInc/AnyNote/commit/6dc5e60e21e75104a5df39d35895423e1bd4aae5))
* **db:** identity governance models — domains, verification, auth providers, identity links ([5fc6129](https://github.com/AnyNoteInc/AnyNote/commit/5fc61292ea19b598f9daf7dc292f8ed84c04cc7d))
* **db:** import/export job models (ExportJob, ImportJob, artifacts, mappings) ([1e43f75](https://github.com/AnyNoteInc/AnyNote/commit/1e43f75dc212cf5da88f3212587e1f447a26337b))
* **db:** ImportJob.source enum column (GENERIC/NOTION/CONFLUENCE/YANDEX_WIKI) ([28fddee](https://github.com/AnyNoteInc/AnyNote/commit/28fddeebb5a0bbbd4e9759ac96e67fa3b1c78dc5))
* **db:** meeting models — MeetingArtifact/TranscriptSegment/ActionItem/SummaryInstruction + MEETING page type ([6061011](https://github.com/AnyNoteInc/AnyNote/commit/60610110d9f39e0833c86068c087594e4d810670))
* **db:** migration — collections + archive fields, backfill legacy pages to TEAM ([372d64b](https://github.com/AnyNoteInc/AnyNote/commit/372d64b4c613934ddea0b4b158eb9484c4ae1044))
* **db:** page revisions, notify-me preferences, database date reminders ([8553a67](https://github.com/AnyNoteInc/AnyNote/commit/8553a6798e23da8caf14026a22069f11b45bc9f7))
* **db:** Page.isTemplate; repoint template tags to pages; drop PageTemplate ([13264ab](https://github.com/AnyNoteInc/AnyNote/commit/13264abd7382b0e0e3ca0a623a1a188078ee29c0))
* **db:** PageShare public-site/link fields + Page copy provenance ([d267998](https://github.com/AnyNoteInc/AnyNote/commit/d267998aaae3cfc3a765a2af83da9c9068f735ee))
* **db:** people management models — invitations, guest invites, blocks, audit log ([84c2103](https://github.com/AnyNoteInc/AnyNote/commit/84c2103706874a6fba8c619285702a197b3f2132))
* **db:** per-seat billing models, seat prices, invoice-request mail ([bf6e9a9](https://github.com/AnyNoteInc/AnyNote/commit/bf6e9a9bea667a27f888285aab1a1c9f8f77b388))
* **db:** rich database property types + relation-link table ([0c43ef0](https://github.com/AnyNoteInc/AnyNote/commit/0c43ef0881afc13c6333d611ec8652631a09fa4c))
* **db:** Russian marketplace tag names ([95f93b4](https://github.com/AnyNoteInc/AnyNote/commit/95f93b458e673fefc2a934f17f6619646d4abbe5))
* **db:** security policy + guest invite request models, guest-request notification event ([736d845](https://github.com/AnyNoteInc/AnyNote/commit/736d8452294bc98cc83aaf5f0d19a6f721516d17))
* **db:** seed regimented marketplace tags ([a1c3881](https://github.com/AnyNoteInc/AnyNote/commit/a1c3881f9bc2f691497ca6ca9f54c483b345e7d0))
* **db:** seed system workspace + global template pages ([31d8b42](https://github.com/AnyNoteInc/AnyNote/commit/31d8b42e24676855c18b567b09d1774471b751b6))
* **db:** tag and rate seeded global templates ([22fa337](https://github.com/AnyNoteInc/AnyNote/commit/22fa3371eba626d3be325b6486d8d98e147362f1))
* **db:** telegram integration models + dual webhook/telegram outbox emission ([6881f70](https://github.com/AnyNoteInc/AnyNote/commit/6881f7029935d26a605ad3553d5589212e2d8f1c))
* **db:** template tags, backing page, rating/preview columns ([798d922](https://github.com/AnyNoteInc/AnyNote/commit/798d9227518de3cff35eb42b4c601c04a02fa955))
* **db:** webhook subscription + delivery models ([b6bc285](https://github.com/AnyNoteInc/AnyNote/commit/b6bc2852a0692418a709817341f9baa21cc44f5f))
* **domain:** accept actualDate in updateTaskInput ([3405c60](https://github.com/AnyNoteInc/AnyNote/commit/3405c60b89a8017f0645a91f761508cf549f6933))
* **domain:** access-rule + structure-lock DTOs ([bbd0c2c](https://github.com/AnyNoteInc/AnyNote/commit/bbd0c2c664b19400ef2b9078e06a27cab1e55602))
* **domain:** access-rule repo + resolver-context lookups ([987d82c](https://github.com/AnyNoteInc/AnyNote/commit/987d82c33a8851710ba7a28abb6954a53610ebd0))
* **domain:** add template create/getById/updateContent DTOs ([c9a1e0e](https://github.com/AnyNoteInc/AnyNote/commit/c9a1e0e3d79bf9c707051de22566fd280fd0b581))
* **domain:** admin content search — audited owner-only FTS with audience states ([d5bcc9a](https://github.com/AnyNoteInc/AnyNote/commit/d5bcc9a56b128a02203de90e2b4b15cf55777f4b))
* **domain:** aggregateWidget — access+visibility-gated metric/grouped/table aggregation over databases ([bf4de78](https://github.com/AnyNoteInc/AnyNote/commit/bf4de78480cedfefc044b19eeb06d7ee1c31a3e7))
* **domain:** apply page visibility in findAccessiblePage; add collectionId/archivedAt to PageRowDto ([c098763](https://github.com/AnyNoteInc/AnyNote/commit/c0987639c26c6f5feffe97dbfcdc050decf29069))
* **domain:** auth providers — lifecycle, domain gate, sso resolution, enterprise requests ([fd60bc0](https://github.com/AnyNoteInc/AnyNote/commit/fd60bc04b02d29d8b5b8dec3ec4b90b0bc162ac4))
* **domain:** auto-set actualDate when task moves into a DONE column ([3d2773c](https://github.com/AnyNoteInc/AnyNote/commit/3d2773c05f8372e5038db06093796842a51edc6b))
* **domain:** backing-page templates, tags, marketplace listing, tiered write access ([c7b2dcf](https://github.com/AnyNoteInc/AnyNote/commit/c7b2dcf775bccf48e7cadb9ef58a0c9e679fa9db))
* **domain:** batch row-access + DB-level access predicate ([ab0bd4e](https://github.com/AnyNoteInc/AnyNote/commit/ab0bd4e8d22c545ae45b7d9160a29b05d75b1309))
* **domain:** buildPageVisibilityWhere — single page-visibility source of truth ([1a441e8](https://github.com/AnyNoteInc/AnyNote/commit/1a441e8517e4233dbe4907fafcfade1150898fc5))
* **domain:** capture structural page revisions on rename/move/archive/restore ([4fb67a2](https://github.com/AnyNoteInc/AnyNote/commit/4fb67a27917aa9712de764d0bc06053a4da62feb))
* **domain:** collection module (dto, repository, service, DI wiring) ([e352c91](https://github.com/AnyNoteInc/AnyNote/commit/e352c91fd6a2209167a4309103562db3c4364fab))
* **domain:** compute-on-read formula/rollup/relation/metadata resolver ([4a5568a](https://github.com/AnyNoteInc/AnyNote/commit/4a5568acc08ebf2ee29e6fde08f74ab4ed8cddf4))
* **domain:** database dto + repository ([ea4df1f](https://github.com/AnyNoteInc/AnyNote/commit/ea4df1f068f1e59d2ad4436e91b72ab215ab9bdc))
* **domain:** database repo — schema-only load + paged/grouped row fetch ([cf5c0c2](https://github.com/AnyNoteInc/AnyNote/commit/cf5c0c23fc14f9982a5cb6cbeec1fbba270c4908))
* **domain:** database row access resolver (broadest-access-wins, restrictive rules) ([f33c28b](https://github.com/AnyNoteInc/AnyNote/commit/f33c28bcdf8714b0e89b657166c4f5b58a83c76e))
* **domain:** database rows bridge to item Pages (create/title/delete/restore) ([caaab9f](https://github.com/AnyNoteInc/AnyNote/commit/caaab9f82488d47a346ef36e935039d2afe5aab0))
* **domain:** database view query planner (filters/sorts → prisma) ([7fc7ebf](https://github.com/AnyNoteInc/AnyNote/commit/7fc7ebf25817033c2f625082214eb4a9c711feb8))
* **domain:** DatabaseService — seedDefaults, view/property/cell ops ([09ba13b](https://github.com/AnyNoteInc/AnyNote/commit/09ba13b5118b8ef6edd19e281e1f63ebc4010ac3))
* **domain:** enforce row access in list/read/mutation paths ([a78879d](https://github.com/AnyNoteInc/AnyNote/commit/a78879d853471e42ed88fe812043b7d82a1b2636))
* **domain:** formula evaluator + function library (sandboxed, date-fns) ([fc2cf35](https://github.com/AnyNoteInc/AnyNote/commit/fc2cf359ff7ddda0ea4ea9d6f4a2ce31c605b834))
* **domain:** formula parser (recursive descent + precedence) ([4cf301a](https://github.com/AnyNoteInc/AnyNote/commit/4cf301a1f3acd0cbcd490e9b448d8970c4857548))
* **domain:** formula tokenizer ([6844b8e](https://github.com/AnyNoteInc/AnyNote/commit/6844b8e2f05c25b5eb01f8b4176b37d28455573f))
* **domain:** getByPage schema-only + listRows/grouped/duplicateView ([93dd6ab](https://github.com/AnyNoteInc/AnyNote/commit/93dd6ab753df694f395475f5c7c06e4b59549ebd))
* **domain:** identity module — allowed domains, dns verification, domain auto-join ([2abb3aa](https://github.com/AnyNoteInc/AnyNote/commit/2abb3aa6c597a47e369cf25ff930bdf7ce053e08))
* **domain:** invite link, page guests, conversion, role matrix, blocking ([8e12fb1](https://github.com/AnyNoteInc/AnyNote/commit/8e12fb1baf6ce938e56b0390a832e67131fbfc10))
* **domain:** page-based template DTOs + content file-id extractor ([c497242](https://github.com/AnyNoteInc/AnyNote/commit/c497242ae0ddbbcad77acacc6eaf1b118e6b3a30))
* **domain:** page-history capture + restore service ([1f70388](https://github.com/AnyNoteInc/AnyNote/commit/1f703889c8b1e4cd1b450a17a7eb2e53468e24e2))
* **domain:** pageHistoryDays retention plan feature ([020feb8](https://github.com/AnyNoteInc/AnyNote/commit/020feb8996570c8de164cdd229a82ec2ad82257c))
* **domain:** pass through actualDate and record ACTUAL_DATE_CHANGED on updateTask ([e41948e](https://github.com/AnyNoteInc/AnyNote/commit/e41948ee953be8c310e739b08d896b40ba4812b8))
* **domain:** people module — invitations, block helpers, workspace audit log ([6db6ee9](https://github.com/AnyNoteInc/AnyNote/commit/6db6ee9d98680b1e87dc64354e7031c7630a6f50))
* **domain:** provision database source on DATABASE page create ([0799013](https://github.com/AnyNoteInc/AnyNote/commit/0799013532d04e205311ab660af5f8ec05be5391))
* **domain:** PublicShareAccessResolver — link mode, expiry, archived/deleted guard ([1923f30](https://github.com/AnyNoteInc/AnyNote/commit/1923f30c7ef72cd8225accb36094d083b3fef1b8))
* **domain:** PublicShareCopyService — deep-copy public page/subtree ([18bbfb3](https://github.com/AnyNoteInc/AnyNote/commit/18bbfb3c25dd55691442d43a670ba036d4acd5f5))
* **domain:** publicSitesEnabled plan feature flag ([25f1247](https://github.com/AnyNoteInc/AnyNote/commit/25f12479fecd604c4801117021b6e775c45f344e))
* **domain:** relation filter post-pass; computed columns non-filterable ([54cbe55](https://github.com/AnyNoteInc/AnyNote/commit/54cbe55d021f3e7d77a89f277bc9dbaf9953714a))
* **domain:** relation-link repo + member/linkable-row lookups ([5f87d58](https://github.com/AnyNoteInc/AnyNote/commit/5f87d5869f67fae438b6d54fb0967e9aa083e25f))
* **domain:** relation/rollup traversal respects target-row access ([80da115](https://github.com/AnyNoteInc/AnyNote/commit/80da11589e322bea9f3512a56dd68b6bdc96d545))
* **domain:** resolver SITE mode, password/scheduled extensions, subtree child access ([74b256b](https://github.com/AnyNoteInc/AnyNote/commit/74b256b70321cd26a08cb124f169617aa8b9bc44))
* **domain:** rewrite templates onto pages (no PageTemplate/backing) ([21ad443](https://github.com/AnyNoteInc/AnyNote/commit/21ad443017a73424174077dcbcf96a151d9982eb))
* **domain:** rich cell validation + relations + computed cells in view-model ([9bcee73](https://github.com/AnyNoteInc/AnyNote/commit/9bcee73309fc85d948d94abcf980fe5b846d4f96))
* **domain:** rich property settings + relation/rollup DTOs ([6ebde12](https://github.com/AnyNoteInc/AnyNote/commit/6ebde12e4877c5fdad4dffd7baf9c6c5b36b95db))
* **domain:** scope-tiered template edit permissions ([e44b22a](https://github.com/AnyNoteInc/AnyNote/commit/e44b22a5db3cb6ca292f4f51aac7dff69431ff62))
* **domain:** seats module — counting, proration, addons, ledger, invoice requests ([169d009](https://github.com/AnyNoteInc/AnyNote/commit/169d0093f099b511af39e22363b4f3a8a43591cc))
* **domain:** security module — policy, enforcement helpers, guest invite requests ([69ec269](https://github.com/AnyNoteInc/AnyNote/commit/69ec269c9ecdb5d77973ba6956640e904e760c6a))
* **domain:** select and accept actualDate in kanban repository ([cf02486](https://github.com/AnyNoteInc/AnyNote/commit/cf02486c7439af028a1b1c3dfee75df15566f7f9))
* **domain:** share-access dto + repository (read layer) ([fb4c813](https://github.com/AnyNoteInc/AnyNote/commit/fb4c813f1715e832bc2aba712c251d18e4676002))
* **domain:** structure-edit guard + access-rule ops + getMyAccess ([85d4396](https://github.com/AnyNoteInc/AnyNote/commit/85d43964fb3a946ae7bf67de18662f22f350601e))
* **domain:** template repo create/findDetail/updateContent ([3bae068](https://github.com/AnyNoteInc/AnyNote/commit/3bae068c7d22cc056e87e9b48d23e638bfc7d8de))
* **domain:** template service create/getById/updateContent ([05b2289](https://github.com/AnyNoteInc/AnyNote/commit/05b2289b0da1c5374e7b677a28d5283fcc20e461))
* **domain:** typed view settings + listRows/grouped/duplicate DTOs ([7b2e4c2](https://github.com/AnyNoteInc/AnyNote/commit/7b2e4c27e90dffe97741d2f6f5b81028af5e1fac))
* **domain:** webhook_event outbox emissions for page lifecycle, comments, content saves ([62c4c30](https://github.com/AnyNoteInc/AnyNote/commit/62c4c30679083c08a3f6404c9e8891051214abf6))
* **domain:** wire share-access module into container ([92bcfbd](https://github.com/AnyNoteInc/AnyNote/commit/92bcfbdf310d19d74f59e6b998e1fc6da808af12))
* **editor:** add normalizeLinkHref for smart link prefixing ([f66cc65](https://github.com/AnyNoteInc/AnyNote/commit/f66cc6594c86ee3c42fd1f6037712676b28c8d06))
* **editor:** collapsible headings — local per-viewer section folding via decorations ([4183a58](https://github.com/AnyNoteInc/AnyNote/commit/4183a580feeeb3788982635da5c4208026a3fef3))
* **editor:** embedded database view node + slash command ([1ace819](https://github.com/AnyNoteInc/AnyNote/commit/1ace819e2c41cb5f6e706699c4ab2f4e2632de30))
* **editor:** embeds and bookmarks — provider allowlist, sandboxed iframes, paste menu ([93762d2](https://github.com/AnyNoteInc/AnyNote/commit/93762d2a93cb9093ea66ae2bbdb4f3d917234552))
* **editor:** InlineAI extension — local streaming-preview decoration, undo-safe accept, position re-map ([88f2da5](https://github.com/AnyNoteInc/AnyNote/commit/88f2da5be360cc253c2d1ebe55727445d2f2f580))
* **editor:** MeetingNotesBlock — atom node, object-hiding embed, slash + render-prop injection ([09c45bd](https://github.com/AnyNoteInc/AnyNote/commit/09c45bddfa7b81a2e379434b17a36b3f0fe8699f))
* **editor:** synced-block node — nested collaborative editor, render-prop injection, detach helpers ([b01f590](https://github.com/AnyNoteInc/AnyNote/commit/b01f5901e432f0aae163252bca2e2c2bbb1124ff))
* **editor:** tabs block — labeled sections, keyboard nav, dissolve ([1c9962b](https://github.com/AnyNoteInc/AnyNote/commit/1c9962b8dc3d46dfbf0262231169aed2a238b3d4))
* **editor:** video and audio blocks with inline players and attachment conversion ([4dd41dc](https://github.com/AnyNoteInc/AnyNote/commit/4dd41dc80a53ed11a0410803f1c494707ef28a9c))
* **editor:** view-mode link clicks + reusable attachLinkClickHandler ([3f3a1b5](https://github.com/AnyNoteInc/AnyNote/commit/3f3a1b5e1999df75516fc1c0397be27ecfc0a3c2))
* **engines:** apply page visibility in MCP page tools ([142383a](https://github.com/AnyNoteInc/AnyNote/commit/142383aa024d603825787293af240ae7f6032c16))
* **engines:** page revision retention prune cron ([288844a](https://github.com/AnyNoteInc/AnyNote/commit/288844a883e8b73ccf6c4b45e85fa2955524085c))
* **engines:** telegram dispatch cron module ([470f8fc](https://github.com/AnyNoteInc/AnyNote/commit/470f8fcdbd693228709fd66bb2a60e6ae84cb6fd))
* **engines:** webhook dispatch cron module ([dc4b8ab](https://github.com/AnyNoteInc/AnyNote/commit/dc4b8abdb6e9cb10da97ee694d471fa0ab191b52))
* **kanban:** add hierarchy helper for parent/child derivation ([e86fdda](https://github.com/AnyNoteInc/AnyNote/commit/e86fddac7e9dbf27522ab3afa83b9b2706453c6f))
* **kanban:** add ParentBadge shared component ([a396e55](https://github.com/AnyNoteInc/AnyNote/commit/a396e55756e5e4f60711101cc5a09f41e03b31e8))
* **kanban:** add subtasks block with progress to task detail ([e6a5bba](https://github.com/AnyNoteInc/AnyNote/commit/e6a5bbaf1e930b37a699d5030299e7db0f071288))
* **kanban:** highlight parent tasks in table view ([4ccdf42](https://github.com/AnyNoteInc/AnyNote/commit/4ccdf4203341a20377fbee9a832429a8e579d316))
* **kanban:** highlight parent tasks on board cards ([5d2ab93](https://github.com/AnyNoteInc/AnyNote/commit/5d2ab9308ee3d325197a68232fed703225555456))
* **kanban:** saturate parent task bars in Gantt view ([5329135](https://github.com/AnyNoteInc/AnyNote/commit/53291350e465c6a36a53ad3aae428bb1ad66d4eb))
* **marketplace:** content-preview cards, toolbar breadcrumb+search, tags-first ([66008d4](https://github.com/AnyNoteInc/AnyNote/commit/66008d41dcb61b15fe282767937bbf42b1e4c6a7))
* **media:** media upload kind — video/audio MIME, 200MB cap, magic-byte sniff ([4e0398b](https://github.com/AnyNoteInc/AnyNote/commit/4e0398b681e2f0eb6d63553921a29e4de3501292))
* **notifications:** page-activity helper with burst dedup + new event helpers ([5aa5e3b](https://github.com/AnyNoteInc/AnyNote/commit/5aa5e3bf4c664680706689ae8243d3d0510194ce))
* **pages:** archive/unarchive + listArchived; visibility in listByWorkspace ([7331c67](https://github.com/AnyNoteInc/AnyNote/commit/7331c67f6d6bc7b9ffd3750aafd1cb34b77d47e7))
* **pages:** collection-aware create + moveToCollection/moveToPrivate ([5c3c536](https://github.com/AnyNoteInc/AnyNote/commit/5c3c5368448c28479eaa26756fdadbfd02e2d2cf))
* **pages:** icon format + cover fields — upload kinds, validation, emission ([3cee02c](https://github.com/AnyNoteInc/AnyNote/commit/3cee02c28af76f5c297c214220cd16ac254522cf))
* **people:** guest read path — member-or-grant access, sidebar shared-with-me, switcher ([b784709](https://github.com/AnyNoteInc/AnyNote/commit/b78470910ef5cb3241f4c806e7e5d77ea27d5a7d))
* **pwa:** conservative shell cache in the push service worker, offline fallback ([c94f946](https://github.com/AnyNoteInc/AnyNote/commit/c94f946c931d67ee60c75ee50c8be45af4e2539a))
* **search:** apply page visibility — no private/other-user leak in search ([aac84f0](https://github.com/AnyNoteInc/AnyNote/commit/aac84f096868bbeaf7e16cd4cf30ee199b199314))
* **seats:** capacity includes purchased seats, member ledger threaded through every path ([95a4d38](https://github.com/AnyNoteInc/AnyNote/commit/95a4d38a4549aec368042bc569c1cda4b1796c78))
* **security:** policy enforcement — resolver kill-switch, sharing, exports, cross-workspace copy ([0cace49](https://github.com/AnyNoteInc/AnyNote/commit/0cace49a5dd971e462736def8a829b435ad574d0))
* **security:** workspace-block denial across trpc, domain, engines, yjs, files, agents ([ffec6cf](https://github.com/AnyNoteInc/AnyNote/commit/ffec6cf89aeaebe1cdb579a82642f3e0288ed741))
* **share:** copy-to-workspace button + dialog ([78b95a3](https://github.com/AnyNoteInc/AnyNote/commit/78b95a3c6b79db5a6037fabbd9f144f95b6f3362))
* **share:** copyToWorkspace tRPC (duplicate-as-template) ([2dd4bee](https://github.com/AnyNoteInc/AnyNote/commit/2dd4bee50508e50be07c06e65e59e93d9e7ecc58))
* **share:** nested public subpage route + tree navigation ([79b0848](https://github.com/AnyNoteInc/AnyNote/commit/79b0848563e0448df0bc4dc23275c279008224e9))
* **share:** per-page robots metadata (indexing only when allowed) ([4090bf0](https://github.com/AnyNoteInc/AnyNote/commit/4090bf0a11949af3999c9fc2cf3fb746580e5c6d))
* **share:** unavailable states + password gate ([7c2961a](https://github.com/AnyNoteInc/AnyNote/commit/7c2961a8b4dfe74b9764e07785f18ef8e43eba17))
* **share:** validateSharePassword + route resolver via domain authority ([2d933f4](https://github.com/AnyNoteInc/AnyNote/commit/2d933f455a777c31d0ff7243a80eec1cf327bf58))
* some changes ([bae0916](https://github.com/AnyNoteInc/AnyNote/commit/bae091639d0c475aeaf63253f671f26c5e2f9d53))
* **telegram:** command router with identity-gated search/get and full audit ([af74127](https://github.com/AnyNoteInc/AnyNote/commit/af74127b6d14b16b54b0f5f38bef8494d301bc13))
* **telegram:** delivery tick — send-time visibility re-check, backoff, auto-disable ([8b69a72](https://github.com/AnyNoteInc/AnyNote/commit/8b69a727c5135cc76dfe7f9aa16f096335126829))
* **telegram:** fan-out tick — subscription matching over the shared no-leak gate ([252c012](https://github.com/AnyNoteInc/AnyNote/commit/252c012fddad54f09ef6be1a016bdabf27d65add))
* **telegram:** package scaffold — bot api client, secrets, message rendering ([47430fa](https://github.com/AnyNoteInc/AnyNote/commit/47430fa5c1405b1a67c47439e86b5840b0e88f44))
* **templates:** Notion-style page templates (workspace + global) ([52cf48d](https://github.com/AnyNoteInc/AnyNote/commit/52cf48d056da163989e06a1ff1e41fa28b2ce4bf))
* **trpc:** add resolveActiveWorkspace helper ([4c2a2df](https://github.com/AnyNoteInc/AnyNote/commit/4c2a2dfb260268907d851da6140f4a334d17bb14))
* **trpc:** add workspace.getActive/setActive and set active on create ([9545de6](https://github.com/AnyNoteInc/AnyNote/commit/9545de691834f3fffc5f72861506f20455820b14))
* **trpc:** billing router — seat purchases, reductions, ledger, invoice requests ([31333f1](https://github.com/AnyNoteInc/AnyNote/commit/31333f1eccb5e2a3d448481384ef322d4ff70a29))
* **trpc:** collection router (list/update/reorder) ([38cf60f](https://github.com/AnyNoteInc/AnyNote/commit/38cf60fa21dcd262769f0d26d094152057dc5437))
* **trpc:** dashboard router — CRUD, widget caps, object-hiding reads, per-viewer widgetData ([cfe96c3](https://github.com/AnyNoteInc/AnyNote/commit/cfe96c3cd3c058664c36a8b18bb4b482bb710feb))
* **trpc:** database access-rule + structure-lock procedures ([839ae31](https://github.com/AnyNoteInc/AnyNote/commit/839ae31ae588fb1fb5ee3ab2ae09fedff4270dc5))
* **trpc:** database listRows/grouped/duplicateView; getByPage schema-only ([d5f1c1b](https://github.com/AnyNoteInc/AnyNote/commit/d5f1c1baafd2e6fa779eee04fff86ae31f61fde6))
* **trpc:** database router (source/view/property/row/cell) ([50b6259](https://github.com/AnyNoteInc/AnyNote/commit/50b62598b479b3add495a950fbb2a265615a0cbe))
* **trpc:** database update + person-assignment notifications (access-filtered) ([4a1c471](https://github.com/AnyNoteInc/AnyNote/commit/4a1c4712bee798ea3170892e14b3d2b97bc5a3d2))
* **trpc:** identity router — domains, verification, providers, domain join + signup restriction ([d67b03b](https://github.com/AnyNoteInc/AnyNote/commit/d67b03b76fea852dfffc3ec9da8bd08830dfa9c1))
* **trpc:** import source validation + journal fields, owner-gated report route ([2cf9aab](https://github.com/AnyNoteInc/AnyNote/commit/2cf9aabf555a37feb43e20e54f2c5158d7c2f6b8))
* **trpc:** job router — create/list/delete with lazy orphan reclaim ([7dcfc7a](https://github.com/AnyNoteInc/AnyNote/commit/7dcfc7aca9fcb1ee80818634d39ded0524b64823))
* **trpc:** jobs kick port in context, wired to the web job runner ([9c14e21](https://github.com/AnyNoteInc/AnyNote/commit/9c14e219ad42e95a8911a2dafe6c63d1cab0a39d))
* **trpc:** marketplace listing, tag listing, tagIds on template create ([cd62696](https://github.com/AnyNoteInc/AnyNote/commit/cd62696bd7a293734c7615412456fc3354c02daf))
* **trpc:** meeting router — consent-gated create, object-hiding reads, S3-freeing delete, summary instructions ([107740d](https://github.com/AnyNoteInc/AnyNote/commit/107740df99d78850717634bacc70a89dfc6d12be))
* **trpc:** notify-me page preferences + comment-reply/all-comments notifications ([6f90061](https://github.com/AnyNoteInc/AnyNote/commit/6f90061642def7958f8a126ee210349d5b76e72b))
* **trpc:** page history list/preview/restore (edit-gated) ([e41f778](https://github.com/AnyNoteInc/AnyNote/commit/e41f778d195c2c769de6d5b08d5575e5367bf284))
* **trpc:** people router — invites, link join, guests, conversion, blocking, audit ([8ddd317](https://github.com/AnyNoteInc/AnyNote/commit/8ddd31713dd90e6f64c96f6e8b81d30b4c9829c0))
* **trpc:** public link/site settings, publish/unpublish, password procedures ([8a0c590](https://github.com/AnyNoteInc/AnyNote/commit/8a0c590b7ea1251a8d5e9591b2fa73175fd35d48))
* **trpc:** relation links, linkable rows, formula validation, file/page existence checks ([15f97cc](https://github.com/AnyNoteInc/AnyNote/commit/15f97cc5cd54087f170cb84dd8b348d68bebf58e))
* **trpc:** security router — policy, guest requests, audited admin content search ([9256f43](https://github.com/AnyNoteInc/AnyNote/commit/9256f43eb9bb73ac4f9441e59078a160bed057fe))
* **trpc:** synced-block router — create, access-checked getById, list, unsync, delete, copy transform ([1ff5ad3](https://github.com/AnyNoteInc/AnyNote/commit/1ff5ad302211d987eed374696d4c110569043306))
* **trpc:** telegram router — connection, chats, subscriptions, link codes, logs ([5cc266e](https://github.com/AnyNoteInc/AnyNote/commit/5cc266e3c731074267d9161a7798b8f0a15d221d))
* **trpc:** template create/getById/updateContent procedures ([82226b9](https://github.com/AnyNoteInc/AnyNote/commit/82226b9cfd962331bd25caa74b66c464681cd23d))
* **trpc:** template router over pages; exclude isTemplate from page lists/search ([8f8376a](https://github.com/AnyNoteInc/AnyNote/commit/8f8376aa1442c6bc2646cc10038a1ca8c36df244))
* **trpc:** webhook router — create/verify/rotate/deliveries with admin+plan gates ([e21dc57](https://github.com/AnyNoteInc/AnyNote/commit/e21dc57a8a942c01f66102589e4d6101636e8433))
* **ui:** export marketplace tag icons ([54ccedc](https://github.com/AnyNoteInc/AnyNote/commit/54ccedcbd993d20b8b0220571216c34d9f313a9b))
* **ui:** re-export TodayIcon ([7d37fa7](https://github.com/AnyNoteInc/AnyNote/commit/7d37fa7232bb394be4b71049f0002ae6d12a598f))
* **web:** /api/ai/inline route — preset transforms, plan gate, rate limit, ephemeral-chat proxy stream, audit ([06e1673](https://github.com/AnyNoteInc/AnyNote/commit/06e167348b27652e03b4caa76d284d68704de507))
* **web:** /archive route + archive page body ([f4ffa66](https://github.com/AnyNoteInc/AnyNote/commit/f4ffa66df5357c3698533051a64d892e40e669a3))
* **web:** /developers portal — five doc pages, sidebar shell, nav, seo, sitemap ([5f4e915](https://github.com/AnyNoteInc/AnyNote/commit/5f4e915066ea72497d46aba7830fb0752c7ae5d1))
* **web:** actual-date filter and planned/actual/deviation sort in applyFilters ([558e25b](https://github.com/AnyNoteInc/AnyNote/commit/558e25b20d4beaa412b927bcd75f2c6bef9d0b12))
* **web:** add actualDate to BoardTaskData ([abc34a1](https://github.com/AnyNoteInc/AnyNote/commit/abc34a12104f26ce8895c0e2770e09abd2e93592))
* **web:** add computeDeviation/formatDeviation helper ([a390f83](https://github.com/AnyNoteInc/AnyNote/commit/a390f83cbae877d87eda3a7673897e9b47b1261c))
* **web:** add fflate/marked/transformer deps + ui import-export icons ([b4e1ca2](https://github.com/AnyNoteInc/AnyNote/commit/b4e1ca26b8aa2b63524937e53be1308cdfaee40e))
* **web:** add Templates sidebar item above Trash ([7f15a8a](https://github.com/AnyNoteInc/AnyNote/commit/7f15a8a6ec5201c8e591fdfc6af402144ec24adf))
* **web:** always-mini page outline with hover popover ([91464e4](https://github.com/AnyNoteInc/AnyNote/commit/91464e482495324992882c2df4356a638501b728))
* **web:** archive html rewriting + database table rendering for bulk export ([cd1cacd](https://github.com/AnyNoteInc/AnyNote/commit/cd1cacd1054d371f7fb08ab3974f0d5c6d835c16))
* **web:** attachment upload resolves active workspace server-side ([0e3cb1d](https://github.com/AnyNoteInc/AnyNote/commit/0e3cb1df1bda78d5a3db46b30f8c3c6a88401ae8))
* **web:** bookmark-preview route — ssrf-guarded og-metadata fetch with caps ([523f727](https://github.com/AnyNoteInc/AnyNote/commit/523f72715641e7e336958b96b9e68acc994f3274))
* **web:** collection home route (Home/Все страницы/Мои страницы) ([b97665c](https://github.com/AnyNoteInc/AnyNote/commit/b97665c3c2290dfe9f9f6a7784d8cc921915301d))
* **web:** confluence zip plan builder + import journal ([e5e7b7f](https://github.com/AnyNoteInc/AnyNote/commit/e5e7b7f6587c524d82841280048cc2b8ba261604))
* **web:** contentYjs builder for imported pages ([737f528](https://github.com/AnyNoteInc/AnyNote/commit/737f52833225c7b8d55251170b38d7258fa8eeea))
* **web:** creatable rich property types + settings auto-open ([015ac75](https://github.com/AnyNoteInc/AnyNote/commit/015ac751adbed0e01e30d899502e2d5ee6dc8ba7))
* **web:** csv column type inference with domain value mapping ([d153b04](https://github.com/AnyNoteInc/AnyNote/commit/d153b04ad0a607e08f7d74f7b48b384652b31814))
* **web:** csv import path — overrides, database title, empty-file guard ([7afd065](https://github.com/AnyNoteInc/AnyNote/commit/7afd0659a1cdff2a13b4b23980d60e58d9e597fc))
* **web:** csv stringifier with label mapping, inference overrides, csv format ([cb499e7](https://github.com/AnyNoteInc/AnyNote/commit/cb499e753962d267254ddb3115e208e4bb8e8d54))
* **web:** csv→database materializer with resume + per-cell degradation ([51cedbc](https://github.com/AnyNoteInc/AnyNote/commit/51cedbc1ef3ce34cd87aba347e4f98a4a5411c5f))
* **web:** dashboard editor — react-grid-layout grid, edit/view mode, widget settings, global filters ([e7eddc3](https://github.com/AnyNoteInc/AnyNote/commit/e7eddc39b48ea6b47622e37283a18b3fc90ee7eb))
* **web:** dashboard widgets (metric/grouped/table/bar/line/donut) + @mui/x-charts + DASHBOARD page type ([e818416](https://github.com/AnyNoteInc/AnyNote/commit/e8184161e8ac4cb9c675aa8f1bfe33e763a1ed97))
* **web:** database board view (derived groups + drag) ([610224e](https://github.com/AnyNoteInc/AnyNote/commit/610224effa01a10a847dd0bd39a2e4fdf4f19c76))
* **web:** database calendar + list views ([0d06110](https://github.com/AnyNoteInc/AnyNote/commit/0d061101936360669d35e5f09b9c491bd8f96598))
* **web:** DATABASE creatable + renderer branch + full-bleed + repairSource ([97ef6e6](https://github.com/AnyNoteInc/AnyNote/commit/97ef6e6837f10e8c3053502357d17b684dc052d1))
* **web:** database item page modal (peek) ([e7263fc](https://github.com/AnyNoteInc/AnyNote/commit/e7263fc954e7d3a94a982fd85c23822a5c95e248))
* **web:** database page-access rules panel + structure-lock toggle ([b78efcd](https://github.com/AnyNoteInc/AnyNote/commit/b78efcd7fb2123712d46a9cd3d3d6ed26e72d351))
* **web:** database table view + toolbar + cell editors ([06b22bd](https://github.com/AnyNoteInc/AnyNote/commit/06b22bdb16ac636a9a270cc1277068d72fec00cb))
* **web:** database view tabs + ?viewId= dispatch + useViewRows ([a11e735](https://github.com/AnyNoteInc/AnyNote/commit/a11e735dbb225ee008a9f9a1ac2bb83937a0277a))
* **web:** date-range and sort controls in kanban filters ([95a4c3d](https://github.com/AnyNoteInc/AnyNote/commit/95a4c3dcaa7d42e45c1699560cbc9cbd378ad5d3))
* **web:** document history side panel (preview + restore) ([d0006b8](https://github.com/AnyNoteInc/AnyNote/commit/d0006b8e205ab68cc173be6aa4edb6e4e1fc334f))
* **web:** edit templates through the collaborative page editor ([2b3c83a](https://github.com/AnyNoteInc/AnyNote/commit/2b3c83a3ee3e1a00031e78eb6c8cae2f5b5ccaf8))
* **web:** export archive naming + relative path helpers ([3bcc0f2](https://github.com/AnyNoteInc/AnyNote/commit/3bcc0f24d524cb3569c45247235b00dbb29794e7))
* **web:** export job processor — notion-style zip, assets, database tables ([79aaea7](https://github.com/AnyNoteInc/AnyNote/commit/79aaea7a37dbd8bc7cb188880888d09fc479c8f8))
* **web:** export page-set collector with canonical visibility filtering ([5781807](https://github.com/AnyNoteInc/AnyNote/commit/5781807f5858a78da70a572f93d5749c34486860))
* **web:** external-href resolver hook in import link rewriting ([d9bd51e](https://github.com/AnyNoteInc/AnyNote/commit/d9bd51e4e61d36b8920fa1f169894f9d193c869d))
* **web:** full-screen workspace settings dialog ([848e62e](https://github.com/AnyNoteInc/AnyNote/commit/848e62e9afd984088c4506748d054f8edd3eda81))
* **web:** group Inbox notifications by page/thread ([692427a](https://github.com/AnyNoteInc/AnyNote/commit/692427a6eeb4d2320ab1f2142784d73de295f47f))
* **webhooks:** fan-out tick with team-visibility no-leak gate ([f0cbbbe](https://github.com/AnyNoteInc/AnyNote/commit/f0cbbbef2899ef1689fb0a3ce29516fb2b5a1ae6))
* **webhooks:** hmac delivery tick — ssrf guard, backoff, auto-disable, logs ([f4d60bc](https://github.com/AnyNoteInc/AnyNote/commit/f4d60bc482dac6e252bd8382c2b9a61518b16ad6))
* **webhooks:** package scaffold — catalog, secrets, hmac, ssrf guard, payload builder ([ef06725](https://github.com/AnyNoteInc/AnyNote/commit/ef06725a2457447be6a936e3282e19a64bd239ab))
* **web:** html→tiptap import chain via dedicated turndown instance ([74c43ed](https://github.com/AnyNoteInc/AnyNote/commit/74c43ed8f5458a3b1c5cad465761472a7bf1bea3))
* **web:** identity settings — domains, verification, providers, enterprise; domain-join surfaces ([2bd202d](https://github.com/AnyNoteInc/AnyNote/commit/2bd202de1070ad39f0846bea0319ec5fe1fc9373))
* **web:** import job processor with idempotent resume and asset upload ([613cd73](https://github.com/AnyNoteInc/AnyNote/commit/613cd73ffbb4ce142a0cfa8c307c261ccb26bd75))
* **web:** import processor — source dispatch, alias links, csv databases, journal artifact ([706c4ef](https://github.com/AnyNoteInc/AnyNote/commit/706c4ef9c0a044ecacd3145666ebdfa62707ba57))
* **web:** import second-pass relative link rewriting ([e5c654d](https://github.com/AnyNoteInc/AnyNote/commit/e5c654d894f7569b2c40bc984ce042303100270c))
* **web:** import source picker step + import journal viewer ([0a26c55](https://github.com/AnyNoteInc/AnyNote/commit/0a26c55b03aab360d7ca1daf1c7e72fab60be4fe))
* **web:** Import/Export Center — settings section, import wizard, export dialog ([8daaade](https://github.com/AnyNoteInc/AnyNote/commit/8daaadeff815a079cf2d3bb505e503252bd1ebb3))
* **web:** import/export job presentation helpers ([29d520e](https://github.com/AnyNoteInc/AnyNote/commit/29d520eb5ee543ffec64deb289e31d096ae20c84))
* **web:** inline-AI bubble-menu button, action popover, streaming bridge — wired through page-renderer ([70351e6](https://github.com/AnyNoteInc/AnyNote/commit/70351e699263da021c098832dcb3f3eb04e12b21))
* **web:** invitation acceptance pages — member, join link, guest ([09266df](https://github.com/AnyNoteInc/AnyNote/commit/09266df096bee73bf78da5cc95e77cefe8405af0))
* **web:** location-aware create flow (quick-create defaults to Private) ([22326be](https://github.com/AnyNoteInc/AnyNote/commit/22326be90627f556c9b18b81b868b9df46dbfea8))
* **web:** Manage public pages settings section ([b109fe1](https://github.com/AnyNoteInc/AnyNote/commit/b109fe149ab177168cb6758e7039abbd813be9d0))
* **web:** markdown→tiptap import parser (port of engines MarkdownParser) ([363d745](https://github.com/AnyNoteInc/AnyNote/commit/363d745796909794ac432288b4918f2912db8b45))
* **web:** marketplace page with tag row, sections, and template cards ([d9e94e0](https://github.com/AnyNoteInc/AnyNote/commit/d9e94e0944c673384426080fc81424ad77ff73aa))
* **web:** meeting job runner — transcribe→summarize pipeline, meetingsEnabled plan gate, service-token agents client ([40d62f1](https://github.com/AnyNoteInc/AnyNote/commit/40d62f1a9c390b7ad59b882736584a8ea67f9b2c))
* **web:** MEETING page type — transcript page, upload dialog (consent + summary instruction), segment search ([675ff71](https://github.com/AnyNoteInc/AnyNote/commit/675ff714243eb6a2f9fff44c797fa4f6de06c299))
* **web:** members settings — invitations, invite link, guests, blocking, audit log ([a793e05](https://github.com/AnyNoteInc/AnyNote/commit/a793e05028acaad16f0e966bc16ccd19fc684263))
* **web:** move dialog destination (Команда/Личное) + visibility warning ([fb1916a](https://github.com/AnyNoteInc/AnyNote/commit/fb1916ae6b86c86f0222753b899037adb8b65ef1))
* **web:** multi-select/person/file cell editors ([2ef8489](https://github.com/AnyNoteInc/AnyNote/commit/2ef8489ac8ebbd18949d5d97ab14b7c614aba386))
* **web:** neutral (active) route group + /app and /workspaces redirects ([46087c5](https://github.com/AnyNoteInc/AnyNote/commit/46087c55d113fbc57ab37e4987f7496d29eb8740))
* **web:** neutral /marketplace route + legacy redirect ([be915d5](https://github.com/AnyNoteInc/AnyNote/commit/be915d539d281ed4172750edae0585e75690d209))
* **web:** Notify-me menu + database date-cell reminder ([15c2b1d](https://github.com/AnyNoteInc/AnyNote/commit/15c2b1df9f4a3b97423153e9dc23510080f66869))
* **web:** notion export zip plan builder with aliases and database blueprints ([fb59a85](https://github.com/AnyNoteInc/AnyNote/commit/fb59a85578a2e3cf006c1b686d3eeab79ad583cf))
* **web:** notion name/id parsing helpers ([3a1d6e4](https://github.com/AnyNoteInc/AnyNote/commit/3a1d6e4a50aa4033a8c6501c18f26f3415cd8631))
* **web:** owner-gated expiring artifact download route ([704bfe1](https://github.com/AnyNoteInc/AnyNote/commit/704bfe1cb35465415d5a8da0cb91349c2b8be17c))
* **web:** page context menu — archive + make private + move to team ([c84e1c0](https://github.com/AnyNoteInc/AnyNote/commit/c84e1c005fb9fb6cc856b2e0d6c8d99dfd686eb7))
* **web:** page export API by pageId; legacy export redirects ([9d00afa](https://github.com/AnyNoteInc/AnyNote/commit/9d00afa4ec29e83157260304c9a47746f8e7ad5f))
* **web:** page icon component, cover band and pickers across all surfaces ([2ed49c3](https://github.com/AnyNoteInc/AnyNote/commit/2ed49c3293e3cae98c1d438b79fb270ead7f3431))
* **web:** parameterize PageTreeSection by collectionId ([d12b093](https://github.com/AnyNoteInc/AnyNote/commit/d12b093bf27aa3e84c775bae025c2e9e5e5c4fe0))
* **web:** pdf bulk export — 50-page cap, per-page html fallback, result notes ([1877512](https://github.com/AnyNoteInc/AnyNote/commit/187751276dbf05f8fa5477680567682d46f4bd4c))
* **web:** pdf export option, export journal, csv preview with type overrides ([48f48bb](https://github.com/AnyNoteInc/AnyNote/commit/48f48bbac67214fa133901acbd9b0b699ded10c1))
* **web:** permission-aware database controls (structure lock + content rights) ([62a45b4](https://github.com/AnyNoteInc/AnyNote/commit/62a45b48048f31672f0b7ed0815dba8ae8e3693d))
* **web:** planned/actual date fields, 'указать сегодня', and deviation in task form ([4243834](https://github.com/AnyNoteInc/AnyNote/commit/4243834daf49d50fa32b1875e53a2ecde4724195))
* **web:** property settings panel (options/format/formula/relation/rollup) ([5d05384](https://github.com/AnyNoteInc/AnyNote/commit/5d053845269e538794ca30f58e4409ef7e84c051))
* **web:** Publish tab body ([e95396a](https://github.com/AnyNoteInc/AnyNote/commit/e95396afa22385adf5ba6e0b1f79c0429a9d50b3))
* **web:** pwa manifest, install prompt surfaces, honest app help card ([f81b0e3](https://github.com/AnyNoteInc/AnyNote/commit/f81b0e33f865628f6ce9576f22cbf34d08e99a28))
* **web:** redesign database property-visibility panel ([10b4cd6](https://github.com/AnyNoteInc/AnyNote/commit/10b4cd6dfa2d79d4986e27f214c2d1bf031e66bc))
* **web:** refresh landing page to reflect shipped Notion-parity product ([be4ca76](https://github.com/AnyNoteInc/AnyNote/commit/be4ca76e2100af3c411968d5e1bd5d4d56aee197))
* **web:** remove public changelog page and «Обновления» links ([f974dd4](https://github.com/AnyNoteInc/AnyNote/commit/f974dd4d1900b55284f79394d1f8b8213299ff30))
* **web:** rename sidebar Шаблоны → Маркетплейс ([ddc0303](https://github.com/AnyNoteInc/AnyNote/commit/ddc0303f3fd6718e6ec8047b57c94e2f83c80689))
* **web:** rfc-4180 csv parser for imports ([ca6fb61](https://github.com/AnyNoteInc/AnyNote/commit/ca6fb61a8f180a335937f728ee9e93997e9cca6d))
* **web:** security settings — policy, guest request queue, admin content search ([cf261c4](https://github.com/AnyNoteInc/AnyNote/commit/cf261c411c587d34764b40e9ff79e5ff6335c964))
* **web:** share status chips ([8432d96](https://github.com/AnyNoteInc/AnyNote/commit/8432d9631d206e25638a214e41f2bd32ca392484))
* **web:** show active workspace at top of user menu ([e5c6bc0](https://github.com/AnyNoteInc/AnyNote/commit/e5c6bc035ab1b300f63f9bdc69769ff92b44ea6b))
* **web:** show actual-date badge and deviation on board card ([330e236](https://github.com/AnyNoteInc/AnyNote/commit/330e236b27330c5e19e5ed4d6ee1a1e056637311))
* **web:** show planned/actual/deviation in table-view task rows ([4cccba2](https://github.com/AnyNoteInc/AnyNote/commit/4cccba24baf391434303721254672a0639a75527))
* **web:** sidebar section buttons as active-pill / inactive-icon ([55a8c21](https://github.com/AnyNoteInc/AnyNote/commit/55a8c21ac104e443508229088ce1d48bb8e7a1be))
* **web:** sidebar Команда/Личное/Поделились sections + Архив link ([50959ae](https://github.com/AnyNoteInc/AnyNote/commit/50959ae8bb4171979c178868cc514707a48d093a))
* **web:** single-row template view; Использовать+menu in toolbar; Маркетплейс/Шаблоны/{name} breadcrumb ([4813d52](https://github.com/AnyNoteInc/AnyNote/commit/4813d5247a5180676f96a88a95fae01097887360))
* **web:** single-user template content editor ([0c363d3](https://github.com/AnyNoteInc/AnyNote/commit/0c363d308d6ed954dd1da996d52ba93ba9013600))
* **web:** slimmer breadcrumb/search toolbar row ([461e92d](https://github.com/AnyNoteInc/AnyNote/commit/461e92d0d21ddcf84bf99a42be434921d733cb9e))
* **web:** space menu with owner settings/invite + switch list ([d50c2af](https://github.com/AnyNoteInc/AnyNote/commit/d50c2af62cd6d4d4fc7b7b5016e59746eaedf4fe))
* **web:** sso sign-in entry — email resolve + provider flow start ([b6efb30](https://github.com/AnyNoteInc/AnyNote/commit/b6efb301f7b4838f8ef968a1b0362887ac43e608))
* **web:** subtree zip export entry in the page actions menu ([994f80c](https://github.com/AnyNoteInc/AnyNote/commit/994f80c2a5633cad064bf826e9a76625a05f865f))
* **web:** switch UI links to neutral URLs and switcher to setActive ([6c49dd3](https://github.com/AnyNoteInc/AnyNote/commit/6c49dd34f3d55a0422c50d4368fac65d082ca632))
* **web:** synced-block embed — access-checked nested editor, placeholders, picker wiring ([8668c53](https://github.com/AnyNoteInc/AnyNote/commit/8668c53f81f5cc4b3ebe58dc7567b44d027076cb))
* **web:** table view via listRows + filter/sort/visibility builders ([9ba76c7](https://github.com/AnyNoteInc/AnyNote/commit/9ba76c7c554d69347393d5f2179c6db2aa625147))
* **web:** tag picker and global scope in save-as-template; drop category UI ([c28e2c8](https://github.com/AnyNoteInc/AnyNote/commit/c28e2c8466c87b2f4da332c8c6b2513f310b5846))
* **web:** telegram inbound webhook route — secret verification, chat registry, command dispatch ([6bb0678](https://github.com/AnyNoteInc/AnyNote/commit/6bb0678a2a11a8c9022be3ac2cceee2fa0e7d3d6))
* **web:** telegram settings — connection card, chat subscriptions, logs, personal link ([0259de0](https://github.com/AnyNoteInc/AnyNote/commit/0259de0068b95b4ae222768e66da94024bdc8bac))
* **web:** template metadata create/edit dialog ([b40d21f](https://github.com/AnyNoteInc/AnyNote/commit/b40d21f586740581c4d90b57ddd08d431f9d4470))
* **web:** template view at /marketplace/templates/[id] with actions menu + Использовать ([0f72dcf](https://github.com/AnyNoteInc/AnyNote/commit/0f72dcf7639d229774a735152311384e6c23fd1d))
* **web:** template view renders the page; marketplace-only template lists ([0aa56a6](https://github.com/AnyNoteInc/AnyNote/commit/0aa56a646e8f784a698b989807d150abb446606e))
* **web:** templates management list page ([abcf298](https://github.com/AnyNoteInc/AnyNote/commit/abcf29881f9bc362fa72b2866058b02b621ea73b))
* **web:** turn legacy /workspaces/[id] routes into safe redirects ([ce58025](https://github.com/AnyNoteInc/AnyNote/commit/ce5802508cbca80c471632250981c535010224ed))
* **web:** two-tab Share/Publish dialog ([82be8a2](https://github.com/AnyNoteInc/AnyNote/commit/82be8a2f4ef9ba8071bb55ecb7fde1bf3006c2f1))
* **web:** URL params for actual-date filter and sort ([d047309](https://github.com/AnyNoteInc/AnyNote/commit/d0473090d34b79e3738b44548eccf02a54c8c2c6))
* **web:** url/email/phone/page-link/relation/computed cell editors ([e24c8e6](https://github.com/AnyNoteInc/AnyNote/commit/e24c8e60ddb75131a2ce2895e177a902e30061fd))
* **web:** view-aware csv export route + database toolbar action ([0869aac](https://github.com/AnyNoteInc/AnyNote/commit/0869aacfeebdc8016fa7183402f0236d8024dbad))
* **web:** webhooks settings section — subscriptions, secret dialog, delivery log ([3fdb462](https://github.com/AnyNoteInc/AnyNote/commit/3fdb462876578b6ac570d73ab396b67e39432f8e))
* **web:** workspace seat billing — usage, purchase, reduction, ledger, invoice requests ([2e44b8d](https://github.com/AnyNoteInc/AnyNote/commit/2e44b8d40580b1e79532e0e402ecd38d77461cb4))
* **web:** zip import plan builder with folder→tree mapping and zip-slip guard ([2cb88a6](https://github.com/AnyNoteInc/AnyNote/commit/2cb88a61da4ed2a4ad6df1ad5e8da908d7200316))
* **workspace:** ensure collections on create + personal collection on member add ([6787a0b](https://github.com/AnyNoteInc/AnyNote/commit/6787a0b060e6f920933ef377f8735b5b2cbf50de))
* **yjs:** capture page content revisions on save (throttled) ([712fd03](https://github.com/AnyNoteInc/AnyNote/commit/712fd037e342e340c49bc5ab742411dfd1676d62))
* **yjs:** synced-block document type — prefix-routed auth, load, store, access check ([d6a8a46](https://github.com/AnyNoteInc/AnyNote/commit/d6a8a46515c02991cc4af921688bf6bb1c01bad8))

## [1.22.4](https://github.com/AnyNoteInc/AnyNote/compare/v1.22.3...v1.22.4) (2026-06-01)


### Bug Fixes

* **deploy:** wire PLANTUML_URL into the production env pipeline ([627c1bf](https://github.com/AnyNoteInc/AnyNote/commit/627c1bf8cc0b2a4e56ebe388b58a13270dd70274))
* **ui:** render GFM tables in LLM chat responses ([2ac6d4b](https://github.com/AnyNoteInc/AnyNote/commit/2ac6d4bf461beb3abebd7f9d9837b3c245e8859f))

## [1.22.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.22.2...v1.22.3) (2026-06-01)


### Bug Fixes

* **deploy:** wire YJS_SHARE_TOKEN_SECRET into the production env pipeline ([0803620](https://github.com/AnyNoteInc/AnyNote/commit/08036208b5271e8d58e921c224b5cad79471a75f))

## [1.22.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.22.1...v1.22.2) (2026-06-01)


### Bug Fixes

* **deploy:** raise Node heap for the web Docker build to avoid OOM ([95234e3](https://github.com/AnyNoteInc/AnyNote/commit/95234e36405485e262cff2c92193797e400495bf))

## [1.22.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.22.0...v1.22.1) (2026-06-01)


### Bug Fixes

* **deploy:** pnpm 11 global-bin PATH + ship docs/changelog.md to web image ([5b9c449](https://github.com/AnyNoteInc/AnyNote/commit/5b9c449144b3ec172a607fa338b3a27336129236))

# [1.22.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.21.0...v1.22.0) (2026-06-01)


### Bug Fixes

* **agents:** non-empty timeout error messages in validation use-cases + mcp failure test ([b2c689f](https://github.com/AnyNoteInc/AnyNote/commit/b2c689f865231386dcfb727b22eb37e11674c23e))
* **agents:** resolve mcp_client dynamic-generic mypy valid-type error ([e30a558](https://github.com/AnyNoteInc/AnyNote/commit/e30a55899effc42b59439851c03e5583d64c5286))
* **agents:** restore chat agent tooling blocked across the stack ([8b383e1](https://github.com/AnyNoteInc/AnyNote/commit/8b383e102859788238c76d2e3f8c7b6bacc7c0f5))
* **agents:** satisfy mypy + ruff for the streaming tests and graph_streaming ([d84683d](https://github.com/AnyNoteInc/AnyNote/commit/d84683dd870491b101e1d0f81ff82bc29f1d7920)), closes [agents#check-types](https://github.com/agents/issues/check-types)
* **agents:** set current_step_id on trivial routing so the executor answers ([ecf0357](https://github.com/AnyNoteInc/AnyNote/commit/ecf0357cabbe694de0378c87ecb4ff86b5d84fba))
* **api:** document isCurrent/isDefault on WorkspaceSummaryDto ([ebcb493](https://github.com/AnyNoteInc/AnyNote/commit/ebcb493c027d01951369313930469afb5c2a2df7))
* **arch:** repair test resolution after dep moves ([c2e8342](https://github.com/AnyNoteInc/AnyNote/commit/c2e834291fae36804b706a98713c2e5766ed83b8))
* **chat:** animate composer slide via flex-grow longhand ([bdd862b](https://github.com/AnyNoteInc/AnyNote/commit/bdd862b293a571a2d456365939e65b2582101202))
* **chat:** cap the confirmation panel width to its content ([ed6090e](https://github.com/AnyNoteInc/AnyNote/commit/ed6090e1e1c1dee4ad96419e6f46f615238a9afc))
* **chat:** contain confirmation panel to the chat viewport width ([08d7d33](https://github.com/AnyNoteInc/AnyNote/commit/08d7d332d6dc79c4af7e865313dc5ecebc2331ac))
* **chat:** do not leak raw extraction error into attachment reason ([ed0b661](https://github.com/AnyNoteInc/AnyNote/commit/ed0b66178ba867bfebd4ea9f20a46d193fa5f801))
* **chat:** drop the composer shell gradient band ([c154506](https://github.com/AnyNoteInc/AnyNote/commit/c154506982ec2f0ac1923998d0c885be75056dc8))
* **chat:** front-place the thinking segment so persisted order matches live ([fef8270](https://github.com/AnyNoteInc/AnyNote/commit/fef82706e629320ae2dcf3dc34c092424095c937))
* **chat:** give timeline connectors a visible minimum height ([fc980c4](https://github.com/AnyNoteInc/AnyNote/commit/fc980c46f24dfc7fb8f133089b6d9ee4448c65de))
* **chat:** neutral tool-step ticks, non-bold tooling, input disclaimer ([ec03b22](https://github.com/AnyNoteInc/AnyNote/commit/ec03b221f6ded01535abca45cf1cf1eec38c534f))
* **chat:** opaque backing behind the sticky composer ([91e54f1](https://github.com/AnyNoteInc/AnyNote/commit/91e54f17c839235cad2ea1907ee881d4b2734575))
* **chat:** persist thinking selection when creating a new chat (chip now shows) ([179843c](https://github.com/AnyNoteInc/AnyNote/commit/179843c5f3bb586248bc4058b92d2e5c758d6595))
* **chat:** remove the state tick box from tool steps in chat responses ([dc41bda](https://github.com/AnyNoteInc/AnyNote/commit/dc41bda212c2e55c7f6d84f5c9e3e55463d18bea))
* **chat:** stretch the confirmation panel to the full chat width ([9e2c087](https://github.com/AnyNoteInc/AnyNote/commit/9e2c087c4771217e8fff5f4aebfbc7f17c7d9797))
* **chat:** transparent message area + tighter timeline dot spacing ([7545b4f](https://github.com/AnyNoteInc/AnyNote/commit/7545b4f17cd6a05bb967a681487bc4620cc81861))
* **chat:** vertically centre the compact composer row ([537a53d](https://github.com/AnyNoteInc/AnyNote/commit/537a53dcc9c446b9cea2e04e052e85dab83004c1))
* **chat:** wider slash menu, transparent input, min timeline dot gap ([2e8a97a](https://github.com/AnyNoteInc/AnyNote/commit/2e8a97a434df209d1b0a17d4a3ff27fb8997f0bd))
* **comments:** expose toggle open state via aria-pressed ([c4b9270](https://github.com/AnyNoteInc/AnyNote/commit/c4b927038d77185a03c1c62dd8cab3888b5f0f1a))
* **comments:** fallback popover anchor for resolved threads (Phase 2 review) ([ce51fba](https://github.com/AnyNoteInc/AnyNote/commit/ce51fba55fe14656709afd53761062a831ab1441))
* **comments:** full-height comments sidebar on the share page ([7d87196](https://github.com/AnyNoteInc/AnyNote/commit/7d87196a42acd5246ba3bf2772266a3ef749acc9))
* **comments:** full-height panel, popover resolve-close, outline offset, reopen icon ([676a542](https://github.com/AnyNoteInc/AnyNote/commit/676a5428ae90c317767b61f1cd44215b2b9bbe92)), closes [#comment](https://github.com/AnyNoteInc/AnyNote/issues/comment)
* **comments:** require authenticated identity to moderate comments ([defd05d](https://github.com/AnyNoteInc/AnyNote/commit/defd05dfc6452625db104c66f5030be78c84f6ea))
* **comments:** tighten realtime subscription updates ([53c86a6](https://github.com/AnyNoteInc/AnyNote/commit/53c86a6158fdcda444c56bafa63a46359300caf3))
* **comments:** validate mentions to members + isolate notify failures ([7a7cd8c](https://github.com/AnyNoteInc/AnyNote/commit/7a7cd8c51173fd6d82efe992a7d569ac5cf0b1a8))
* **db:** drop redundant ApiKey keyHash index; use composite userId+createdAt ([56fb8c0](https://github.com/AnyNoteInc/AnyNote/commit/56fb8c035b0f66cd3cfdaa07ce6684efd6771a1f))
* **db:** keep WorkspaceAiSettings connection columns; export AiProviderKind ([e889fa4](https://github.com/AnyNoteInc/AnyNote/commit/e889fa47fee0e8bdce59fbce8ae740ed27a5de06))
* **db:** use LATERAL subquery in workspace_limits backfill for deterministic per-workspace plan resolution ([3f3b195](https://github.com/AnyNoteInc/AnyNote/commit/3f3b195a0b8446af3f91d6b6b8b3b7edf816d5d7))
* **deps:** pin @tiptap/core to 3.22.5 + add highlight.js for code-block-pro ([66ec6cb](https://github.com/AnyNoteInc/AnyNote/commit/66ec6cbc61049b53a4495fdbc8fa99b1579ba8b8))
* **domain:** make @repo/domain natively strippable + commit domain-refactor tail ([4c33a73](https://github.com/AnyNoteInc/AnyNote/commit/4c33a7339a4c1e98ce375230baac5e7667285f1c))
* **editor:** address final review (drop orphan code-block-lowlight dep, document theme-at-mount, divider a11y) ([b402992](https://github.com/AnyNoteInc/AnyNote/commit/b40299243058f278f16f2fa3c694e05cea387195))
* **editor:** fresh mermaid render id per render to avoid id collision ([e7c9b58](https://github.com/AnyNoteInc/AnyNote/commit/e7c9b58396795a5b8db2475e0b42907300bf1d7f))
* **editor:** mermaid slash item uses setCodeBlock to keep cursor in block ([48a8e4d](https://github.com/AnyNoteInc/AnyNote/commit/48a8e4dde2d58fd1e15809c838c2350c44e5b44e))
* **editor:** restore code block syntax highlighting + add copy button ([29b2597](https://github.com/AnyNoteInc/AnyNote/commit/29b25971f52945101ddc345929beaaf84930d793))
* **editor:** support nested block drag cleanup ([7e1d3cf](https://github.com/AnyNoteInc/AnyNote/commit/7e1d3cf1c12769feb3f75708992f8b1d72669471))
* **editor:** use Tiptap Y binding for comment anchors ([277a29b](https://github.com/AnyNoteInc/AnyNote/commit/277a29b67e3c9b26b92860452db37f8415991cf2))
* **engines:** named jest.fn refs for combinator guard + workspaceId on search hit ([b233ce5](https://github.com/AnyNoteInc/AnyNote/commit/b233ce5189821c84f77c5be495e03fd447b4d6b9))
* **engines:** updatePage parses markdown and rebuilds contentYjs ([2dfed2a](https://github.com/AnyNoteInc/AnyNote/commit/2dfed2a4aff1adaf56ddd3df53a0e305b0cd711f))
* **engines:** use named jest.fn refs in workspace.tools.spec to keep types ([538dac2](https://github.com/AnyNoteInc/AnyNote/commit/538dac27796fd35c5c102ba037fab35e7ab8eb48))
* **gates:** satisfy lint + check-types across engines/agents/trpc ([e81880b](https://github.com/AnyNoteInc/AnyNote/commit/e81880b01d82673025dc8391d9379d68d288927a))
* **likec4:** StrictMode-safe diagram effect ([9b2a5aa](https://github.com/AnyNoteInc/AnyNote/commit/9b2a5aa6307a89661934ac9cfc29aae7642eedc7))
* links ([d80f813](https://github.com/AnyNoteInc/AnyNote/commit/d80f8139712301a007e8e7dfceebb475bdc391ba))
* **mcp:** bound get_file_content read size; stop download-link double-count ([e2bfbc1](https://github.com/AnyNoteInc/AnyNote/commit/e2bfbc1ed876b6496453386d78d55d115c8f1807))
* **mcp:** check workspace membership before confirm in delete_file ([0902a68](https://github.com/AnyNoteInc/AnyNote/commit/0902a68db84719ad6a15f9f0ea2ef4e3cc6e4e10))
* **mcp:** merge reminder id selectors in deleteReminder; cover list/complete; doc offsets ([70330fa](https://github.com/AnyNoteInc/AnyNote/commit/70330fadd652421476084b3b7760b37bdffc5ae0))
* **mcp:** page-writer createPage + movePage delegate to @repo/domain — gap-fixes ([609c7b5](https://github.com/AnyNoteInc/AnyNote/commit/609c7b548fdf9e7a28e8cdc813a8b58aa28ed35c))
* **mcp:** reminder service delegates to domain with scheduler injection — fixes delivery bug ([56bae42](https://github.com/AnyNoteInc/AnyNote/commit/56bae428108f234dfeaf1b30fcccc7c932d6e642))
* **mermaid:** address code review (blob revoke, awareness deps, divider gesture cleanup) ([641b59f](https://github.com/AnyNoteInc/AnyNote/commit/641b59f197a8c7d6030e9f51242c7a99fda16192))
* **pages:** DnD usability fixes — whole-row activator, mount gate, prev-page lift ([9118283](https://github.com/AnyNoteInc/AnyNote/commit/911828385d517be3e76a9fdd0d7fe8ea6cfdfcb5))
* redirect to page ([f4655f0](https://github.com/AnyNoteInc/AnyNote/commit/f4655f0ab584472bc6f75b2c9ef008fdcd9c0fc8))
* **share:** address final review feedback ([4d952c3](https://github.com/AnyNoteInc/AnyNote/commit/4d952c3ec8d42f3cd85bed7dddd31e556560bb79))
* **share:** address Phase 1 review feedback ([f0bfb19](https://github.com/AnyNoteInc/AnyNote/commit/f0bfb19993c94732ccaa79425b89235da1e91b31))
* **share:** address Phase 4 review feedback ([9dcf1cc](https://github.com/AnyNoteInc/AnyNote/commit/9dcf1cc38e48d5b3f5ad3527491dbdac2726b1bf))
* simplify ([572ad0b](https://github.com/AnyNoteInc/AnyNote/commit/572ad0b6ba12a9e13b094d4769dbe501e99bceec))
* simplify ([86eeecc](https://github.com/AnyNoteInc/AnyNote/commit/86eeecc3382581e8bbb79fe6b65019f8ac8c010e))
* simplify review — custom-provider search path, validation guards, mcp update hardening ([d05d707](https://github.com/AnyNoteInc/AnyNote/commit/d05d707c6e939d12ec56dbfa3c620ef3053b26c1))
* **storage:** clean UTF-8 truncation on char boundary (no U+FFFD) ([13c01b0](https://github.com/AnyNoteInc/AnyNote/commit/13c01b07ab38d698cf41447b4f7a16826e26830b))
* tittap right column ([1fb3ea3](https://github.com/AnyNoteInc/AnyNote/commit/1fb3ea33cc3671c8f31764a436198c532b75c3b8))
* **trpc:** align syncWorkspaceLimits with TRIAL/PAST_DUE; sequential upsert; tx-safety test ([645d6e8](https://github.com/AnyNoteInc/AnyNote/commit/645d6e8f2e047518b2eb0d4748c2fd9f06ea3ffa))
* **trpc:** clean error on undecryptable provider creds; drop redundant transaction; cover addModel/list ([dbb860b](https://github.com/AnyNoteInc/AnyNote/commit/dbb860b5e263d16b7a822bfeb7f2cf37a21c9530))
* **trpc:** require anonymous comment identity for writes ([db3faca](https://github.com/AnyNoteInc/AnyNote/commit/db3facacb9c92e167533892f2b53a2aa634c5c41))
* **trpc:** require anonymous identity to resolve comment threads ([08e324b](https://github.com/AnyNoteInc/AnyNote/commit/08e324b5825df04cfbf28da878fce7a7f9b7cd30))
* **trpc:** satisfy noUncheckedIndexedAccess in toBase62 ([352112a](https://github.com/AnyNoteInc/AnyNote/commit/352112a6fd9ecdfced5a93ad483dcc483a410bac))
* **trpc:** scope mcpServer update/delete to the workspace (prevent cross-workspace access); add non-member test ([e3b9e26](https://github.com/AnyNoteInc/AnyNote/commit/e3b9e263f29f4ae24f05cf53812fed2fd13ad43f))
* **trpc:** skip member-limit check for existing-member role updates in inviteMember ([2a2b4ee](https://github.com/AnyNoteInc/AnyNote/commit/2a2b4ee587a4f03a2fb0ef1b3c7bd4b3b99285c7))
* **trpc:** wrap addFavorite max-position+upsert in $transaction ([d1c1112](https://github.com/AnyNoteInc/AnyNote/commit/d1c11127ef754314ecf8bd21da3a189d573893bd))
* **web:** add customAiProvidersEnabled to PlanFeatures test fixture ([76562cc](https://github.com/AnyNoteInc/AnyNote/commit/76562cc2d9438a81fa378201855e2f8e13e2a339))
* **web:** apiKey UI — clipboard error handling, race fix, types, connection snippet ([52b4075](https://github.com/AnyNoteInc/AnyNote/commit/52b4075b9d37d58f7b59ac334e17de33f63bffe7))
* **web:** clear create-mutation error when add dialog re-opens ([f22ccc2](https://github.com/AnyNoteInc/AnyNote/commit/f22ccc25bdd6fda1374fd39e876ff7d74a7cd91f))
* **web:** deep-import getPlanDisplayName from client-safe dto leaf (no root-barrel/prisma in client bundle) ([0cb07f5](https://github.com/AnyNoteInc/AnyNote/commit/0cb07f53bbc4167f0a64d9af9a2db1432f58e649))
* **web:** deep-import kanban colors so the client bundle excludes @repo/db/pg ([b29121e](https://github.com/AnyNoteInc/AnyNote/commit/b29121e520a06dd71f6bf14369e3fb54b63eb84b))
* **web:** delete dead /api/agent/generate route; document kind enum invariant; contextful decrypt error ([c80d247](https://github.com/AnyNoteInc/AnyNote/commit/c80d24755a7b9480965384aad4fba0b4ce184c4b))
* **web:** exclude over-large text attachments so the agent reads them via tooling ([ac39a51](https://github.com/AnyNoteInc/AnyNote/commit/ac39a51dd44699b34d77f5f5b81d31c28b63276d))
* **web:** give sidebar chat/page rows matching left padding ([b7dbde1](https://github.com/AnyNoteInc/AnyNote/commit/b7dbde18fa02a53f69713d67554eff8f8390c2b4))
* **web:** grant workspaces:read, favorites:*, notifications:write agent scopes ([19e923b](https://github.com/AnyNoteInc/AnyNote/commit/19e923be274a27a3b9da4a9fe60dbd080a98a4ca))
* **web:** harden comment mention composer ([19e2f05](https://github.com/AnyNoteInc/AnyNote/commit/19e2f054aad25889ac82018ea82401bb7763064d))
* **web:** stub esbuild/bundle-require from the client bundle ([2ff2295](https://github.com/AnyNoteInc/AnyNote/commit/2ff22956060d9e39edca233c8a2b8817c5f4862f))


### Features

* add drawio ([7e8b07b](https://github.com/AnyNoteInc/AnyNote/commit/7e8b07bcc9202b5e9877c12f6e2aa6ec783cedb0))
* add themes to drawio ([4bd03fd](https://github.com/AnyNoteInc/AnyNote/commit/4bd03fd39494cde704d738ca73f0a7f678065fb0))
* **agents:** /validation/{llm,embedding,mcp} endpoints + use-cases + DI ([c9d58f6](https://github.com/AnyNoteInc/AnyNote/commit/c9d58f679de6fe2c187c1587a5e16fbf2bd2cc48))
* **agents:** add score_threshold (default 0.7) to RAG /v1/search ([d83436f](https://github.com/AnyNoteInc/AnyNote/commit/d83436f8f6f08977659e572ae3b554be3e6a5bdb))
* **agents:** add thinking SSE event type to ServerEventSchema ([4ce93ca](https://github.com/AnyNoteInc/AnyNote/commit/4ce93ca7f2447778c4c1ce77ccb33d537867013c))
* **agents:** add yandexgpt/anthropic/deepseek enum + folder_id connection field ([8c30d4b](https://github.com/AnyNoteInc/AnyNote/commit/8c30d4b1ace3584fe8e21ea1622f34f836be6541))
* **agents:** anthropic, deepseek, yandexgpt chat models in model_factory ([862908d](https://github.com/AnyNoteInc/AnyNote/commit/862908dea303b43108c543848a345e3251f5a75d))
* **agents:** capture LLM reasoning and emit one thinking event before answer ([7557722](https://github.com/AnyNoteInc/AnyNote/commit/7557722d2f58ebe46686b4a21721e774eae26fea))
* **agents:** emit real tool_status events from tool_runner via stream writer ([539e80c](https://github.com/AnyNoteInc/AnyNote/commit/539e80c32ec1ca87e9f511c1f5f0af649c2451aa))
* **agents:** map reasoning flag to provider knobs in model_factory ([f4535ec](https://github.com/AnyNoteInc/AnyNote/commit/f4535ec448633dde992e0522375206bf71cc380f))
* **agents:** register file MCP tools + delete confirmation/scope ([ff7be21](https://github.com/AnyNoteInc/AnyNote/commit/ff7be21dae11e8c9bc8601a8ecd13ccf5dc34b64))
* **agents:** render <attachments> block in planner/executor prompts ([857ce30](https://github.com/AnyNoteInc/AnyNote/commit/857ce30f3e4a5ed8e261c46c5a1df64cecc1bbbc))
* **agents:** stream executor answer tokens; drop duplicate final token with non-streaming fallback ([8086fbe](https://github.com/AnyNoteInc/AnyNote/commit/8086fbe8a83bb603d0a25db23d79587da8b8751c))
* **agents:** yandexgpt embeddings in embedding_factory ([387a3d1](https://github.com/AnyNoteInc/AnyNote/commit/387a3d19d0430be4af23e66809f138b4df790409))
* **arch:** enforce intra-domain dto/repository/service boundaries ([6a747bf](https://github.com/AnyNoteInc/AnyNote/commit/6a747bfe023bd5fab04ac4a12911adf18cd22a21))
* **architecture:** enforce layer boundaries via dependency-cruiser + docs ([be5a425](https://github.com/AnyNoteInc/AnyNote/commit/be5a425ddb281c6d59a2239b53005fa79ee79243))
* **architecture:** harden cruiser rules (directional infra DAG + unresolvable-import guard) ([f1e2014](https://github.com/AnyNoteInc/AnyNote/commit/f1e201436ee7f791164727ff7a4ac4f73180d678))
* **chat:** add attachments + reasoning to agent run payload ([41680dc](https://github.com/AnyNoteInc/AnyNote/commit/41680dce4a8795f6a1307a0c0d8ea5836658b4d8))
* **chat:** add files:delete scope (OWNER-only) + guard test ([4590476](https://github.com/AnyNoteInc/AnyNote/commit/45904765f208438c2a28aa05a0b8af58a8c96c17))
* **chat:** announce active effort + name the Thinking switch (a11y) ([5f2148a](https://github.com/AnyNoteInc/AnyNote/commit/5f2148a0ec77e91717f779443b47d4ba7ae041d6))
* **chat:** autofocus the input on a new chat ([1d45e4a](https://github.com/AnyNoteInc/AnyNote/commit/1d45e4a5552d86dde55a0604f7522a49068d07ee))
* **chat:** bridge + persist thinking stream as message part ([81751b4](https://github.com/AnyNoteInc/AnyNote/commit/81751b4ec4475974d70d12587037a0fa305d8e39))
* **chat:** centre composer when empty, slide it down on first message ([a850107](https://github.com/AnyNoteInc/AnyNote/commit/a850107d2829a1c6109ffa4954eb6041a82753b8))
* **chat:** composer + menu (files/recent), slash /thinking menu, thinking chip + flag ([47d4f2a](https://github.com/AnyNoteInc/AnyNote/commit/47d4f2a623020a36c0111b306f889a87627100f7))
* **chat:** drop the timeline rail from user messages ([f874035](https://github.com/AnyNoteInc/AnyNote/commit/f87403541c4d3c60095af1699f56a1e0e2888152))
* **chat:** map thinking part through to thread message ([c865004](https://github.com/AnyNoteInc/AnyNote/commit/c8650043f02e3d68ac01a615c6a38c099064b593))
* **chat:** optimistic send — show user message immediately ([b8f5473](https://github.com/AnyNoteInc/AnyNote/commit/b8f5473af545dcedfaa61877328faf66e03d5c5c))
* **chat:** ordered-segment accumulator across registry, bridge, and SSE routes ([2133ebf](https://github.com/AnyNoteInc/AnyNote/commit/2133ebff774288eaf6bfebd512ea94c78d60966d))
* **chat:** quiet tool steps + inline confirmation; remove modal dialog + plan panel ([1dd5a88](https://github.com/AnyNoteInc/AnyNote/commit/1dd5a884ed52c85930490df31d48ad68da7901d9))
* **chat:** randomise empty-state greeting, drop the comment icon ([cbfadf1](https://github.com/AnyNoteInc/AnyNote/commit/cbfadf16b087e768843448c4acc8c4c9eef5461a))
* **chat:** render assistant timeline with state-coloured dots in @mui/lab ([b586a67](https://github.com/AnyNoteInc/AnyNote/commit/b586a678115058874350aa9da44e838e0907acba))
* **chat:** render thinking live during streaming (wire message.thinking) ([5d3b39a](https://github.com/AnyNoteInc/AnyNote/commit/5d3b39abe288b8ab24640a2cb9f162c60c84989f))
* **chat:** resolve + attach file contents in generate route ([a604d42](https://github.com/AnyNoteInc/AnyNote/commit/a604d42c375bb4b9409aa7f625db207f94a5c565))
* **chat:** resolve attachment contents in BFF (text + PDF/DOCX, caps) ([bc3ab31](https://github.com/AnyNoteInc/AnyNote/commit/bc3ab31e9b1318648ae5ff337c7b6ac000335edf))
* **chat:** segment-ordered client reducers; apply token deltas by index, replace from snapshots ([f58b7bc](https://github.com/AnyNoteInc/AnyNote/commit/f58b7bc904b7198e0de13909f344ae799b8e3c8f))
* **chat:** slash Thinking as a switch + no-arrow dots effort stepper ([55e5420](https://github.com/AnyNoteInc/AnyNote/commit/55e542080cca5effd9bb23d019990d64a877cc93))
* **chat:** structured <attachments> wrapper + injection guard prompt ([b6e8263](https://github.com/AnyNoteInc/AnyNote/commit/b6e8263eff42c7d54520d50e529ffd0bd7d5ac3f))
* **chat:** tighten spacing between timeline parts ([2e7a5c3](https://github.com/AnyNoteInc/AnyNote/commit/2e7a5c3829b8d8594d7b9ac124fc10f93210363f))
* **chat:** use ArrowUpward for the send button icon ([c93f175](https://github.com/AnyNoteInc/AnyNote/commit/c93f175508bffe684cad0966c240d9b46425ea45))
* **comments:** add comments context module with deriveCommentViews ([fb171bb](https://github.com/AnyNoteInc/AnyNote/commit/fb171bbd68f5a8b64d1886e7c8e840ce353a89af))
* **comments:** add CommentsSidebar with inline threads ([301d250](https://github.com/AnyNoteInc/AnyNote/commit/301d250a2a4a77e6f32b7107e7f766fb378805a9))
* **comments:** add CommentToggleButton ([8ceb885](https://github.com/AnyNoteInc/AnyNote/commit/8ceb885322864f5b6e669978d46fd2bc3ce77343))
* **comments:** add PageCommentsProvider ([aedbdd2](https://github.com/AnyNoteInc/AnyNote/commit/aedbdd27fb0d5c2687f719b507c2639602b49e8c))
* **comments:** in-text thread popover anchored to the active highlight ([b11b19a](https://github.com/AnyNoteInc/AnyNote/commit/b11b19a7a186d0f0e08851075868391625bb7564))
* **comments:** move comments toggle to toolbar and threads to a right sidebar ([b768125](https://github.com/AnyNoteInc/AnyNote/commit/b76812514b5b61c0697b5c35f97108508abbc61b))
* **comments:** parse #comment-<id> deep-link hash ([b3453a3](https://github.com/AnyNoteInc/AnyNote/commit/b3453a3189f73e8df24dd28ea8869906ae0b0b32))
* **comments:** resolve/reopen as a top-right corner icon ([71c5f12](https://github.com/AnyNoteInc/AnyNote/commit/71c5f1286868447da1560484eae71235c171d2ff))
* **comments:** tag the popover container with a comment-popover class ([2d3bbc8](https://github.com/AnyNoteInc/AnyNote/commit/2d3bbc8a888e23678d40d489b926d34d8929ddb2))
* **comments:** wire popover + #comment deep-link into the page ([7f167a0](https://github.com/AnyNoteInc/AnyNote/commit/7f167a00d57e52c0ac6dd50ae4983b4eb1b9e06e)), closes [#comment](https://github.com/AnyNoteInc/AnyNote/issues/comment)
* **db:** add ApiKey model for public API access ([2c695ce](https://github.com/AnyNoteInc/AnyNote/commit/2c695ceaf7cd96d08e0abb0d786d5086aeaa723c))
* **db:** add LIKEC4 to PageType enum ([00972f3](https://github.com/AnyNoteInc/AnyNote/commit/00972f3a1477f4a6fba3e61859379cdcff857e4d))
* **db:** add MERMAID page type enum value ([ebd745f](https://github.com/AnyNoteInc/AnyNote/commit/ebd745f4783b2b53bdc1809993dea4f0526c2457))
* **db:** add PageCommentThread and PageComment models ([a9d1ff2](https://github.com/AnyNoteInc/AnyNote/commit/a9d1ff23b154fafb0f5f1932db578205b258a367))
* **db:** add PageShare and PageShareUser models ([cfb4056](https://github.com/AnyNoteInc/AnyNote/commit/cfb4056f2d9830c764700d315a6df7fd2f09d58d))
* **db:** add per-chat settings + AiModel.supportsReasoning to schema ([58d07d2](https://github.com/AnyNoteInc/AnyNote/commit/58d07d22a819698ddb14875027baf969d071dc44))
* **db:** add Plan.maxFileBytes + WorkspaceLimit table with backfill ([e7b01d5](https://github.com/AnyNoteInc/AnyNote/commit/e7b01d5edf6b2e2a97a5530da0c022faac6569ea))
* **db:** add PLANTUML to PageType enum + migration ([75a8bac](https://github.com/AnyNoteInc/AnyNote/commit/75a8bac1c9db52753bdfbeda695bd699f6357de4))
* **db:** add position to FavoritePage for personalized favorites order ([c33118f](https://github.com/AnyNoteInc/AnyNote/commit/c33118ff468ba3f3be6e6ea56a6bfa582a26b1ea))
* **db:** connection schemas for anthropic, deepseek, yandexgpt ([0f690f5](https://github.com/AnyNoteInc/AnyNote/commit/0f690f5b3a7e816865df1f0027c1e89e6f5257a9))
* **db:** migration for chat settings + reasoning support ([a6bdfdf](https://github.com/AnyNoteInc/AnyNote/commit/a6bdfdf241e95a0a7d58ce62cc721b67a53aed1b))
* **db:** scope AiProvider to workspace + AiProviderKind, customAiProvidersEnabled plan flag ([01d13ef](https://github.com/AnyNoteInc/AnyNote/commit/01d13ef40680ffbdafe5274a2d16c5a3d4e73327))
* **db:** seed AiProvider.kind and customAiProvidersEnabled flag ([aae0697](https://github.com/AnyNoteInc/AnyNote/commit/aae0697c83c1cad493c80a00b3e55a7bc5e3d7c8))
* **db:** seed maxFileBytes + updated plan feature bullets ([20dc0d3](https://github.com/AnyNoteInc/AnyNote/commit/20dc0d303e145f27965e47391104ea453c414c87))
* **deploy:** plantuml-server sidecar (internal, no traefik route) ([d07780e](https://github.com/AnyNoteInc/AnyNote/commit/d07780e6fa168de44d25d2685892a29c00aef016))
* **deploy:** route api.anynote.ru → engines via traefik ([fb59ae4](https://github.com/AnyNoteInc/AnyNote/commit/fb59ae404be21796f05dae872979facbe0b0b152))
* **diagram-board:** allow a pluggable Preview component alongside SVG render ([f986193](https://github.com/AnyNoteInc/AnyNote/commit/f98619385fc645d5f9a379ffa299a2646a387e95))
* **diagram-board:** scaffold shared diagram-board package ([ac70134](https://github.com/AnyNoteInc/AnyNote/commit/ac7013484a428607cc3cbf14b3cb5ab142207559))
* **domain/reminders:** add dto, ports, and tokens for layered reminders module ([d281256](https://github.com/AnyNoteInc/AnyNote/commit/d2812568460a8ac06f3e7290c3f6e0c4cfeb19f0))
* **domain/reminders:** add repository, service, module + tests; delete old free-function files ([f9a02ed](https://github.com/AnyNoteInc/AnyNote/commit/f9a02ed146b317ce4d0188be3678336ac596ba98))
* **domain:** add createDomain composition root + export from barrel ([420e77e](https://github.com/AnyNoteInc/AnyNote/commit/420e77ed3122a2d661a01980d241ada132bde308))
* **domain:** add favorites domain module (addFavorite/removeFavorite/reorderFavorites) ([94f800e](https://github.com/AnyNoteInc/AnyNote/commit/94f800e279ecb315b58202397e5dd9e5362e67b0))
* **domain:** add favorites dto + tokens ([9d23631](https://github.com/AnyNoteInc/AnyNote/commit/9d236310ac965e34013bc128eb3d5780170a8107))
* **domain:** add favorites repository, service, module, and tests ([3dff791](https://github.com/AnyNoteInc/AnyNote/commit/3dff791b58943ed7a303e86fbb31a1223c3a330e))
* **domain:** add granular reminder domain functions with DeliveryScheduler port ([6731532](https://github.com/AnyNoteInc/AnyNote/commit/6731532f271a0d650712c6763adb8b0a37690a18))
* **domain:** add kanban position helpers + page-access (DomainError) ([a6ba9d3](https://github.com/AnyNoteInc/AnyNote/commit/a6ba9d341af7212ec57bd6c9cae9beacf9119dcf))
* **domain:** add notifications domain module (markRead/markAllRead/deleteAll) ([3f22e53](https://github.com/AnyNoteInc/AnyNote/commit/3f22e538e640b42c610871624ac3a5e53ea6f12a))
* **domain:** add pages schemas + ordering cycle-detection helpers ([162e586](https://github.com/AnyNoteInc/AnyNote/commit/162e586212cc035aef2757912765eb8a35d4682b))
* **domain:** add pages.createPage (tail-insert + outbox + kanban seed) ([7602b8b](https://github.com/AnyNoteInc/AnyNote/commit/7602b8b0184f1009e5ebab424d2c565c405196f3))
* **domain:** add pages.duplicatePage (copy content+contentYjs, relink, outbox) ([da256e4](https://github.com/AnyNoteInc/AnyNote/commit/da256e4d7266c01fbe01da3995f44480ee5a950e))
* **domain:** add pages.hardDeletePage + emptyTrash; wire pages barrel + domain index ([4b656dd](https://github.com/AnyNoteInc/AnyNote/commit/4b656dd146492541f72a11c2464f075d17a541fe))
* **domain:** add pages.movePage (reparent + ancestor-walk cycle-detection) ([77dcab9](https://github.com/AnyNoteInc/AnyNote/commit/77dcab986d8f9f9d8b9487f125e43d307ff56124))
* **domain:** add pages.renamePage + updatePage (ownership + outbox) ([02a4284](https://github.com/AnyNoteInc/AnyNote/commit/02a42848ac7e5563c9a23332a36daac40b83a80a))
* **domain:** add pages.reorderPage (BFS cycle-detection + 3-step relink) ([8bcdf9a](https://github.com/AnyNoteInc/AnyNote/commit/8bcdf9a85459fe35f5b07a7e17b68d88364d7b8b))
* **domain:** add pages.softDeletePage + pages.restorePage (recursive BFS) ([f9606a0](https://github.com/AnyNoteInc/AnyNote/commit/f9606a0168f2c6c0c3c774fb1c27aabedb1f8459))
* **domain:** add reminders ports (DeliveryScheduler) and input schemas ([9a18263](https://github.com/AnyNoteInc/AnyNote/commit/9a18263e570bd1bc303b30a6257909dcd153eb31))
* **domain:** add shared inversify tokens ([b4296fa](https://github.com/AnyNoteInc/AnyNote/commit/b4296fa5c4e244ccfe1a9d2bdc4780f79447b7f4))
* **domain:** add syncReminders (batch reconcile) ported verbatim from tRPC syncForPage ([5fd5df7](https://github.com/AnyNoteInc/AnyNote/commit/5fd5df7096a95bbdd3d2d80ae64fec370e3fd088))
* **domain:** add UnitOfWork with AsyncLocalStorage transaction scoping ([69f6226](https://github.com/AnyNoteInc/AnyNote/commit/69f6226514d6049200930f6f902aea4f73452283))
* **domain:** add workspace module tokens ([bdfed2f](https://github.com/AnyNoteInc/AnyNote/commit/bdfed2f752c99e6229e82f9a97108cad0a07735b))
* **domain:** add WorkspaceMembershipDto ([e0682cc](https://github.com/AnyNoteInc/AnyNote/commit/e0682ccd2e6ad2cb2518c70b574a926943db7fe1))
* **domain:** add WorkspaceRepository (membership lookup -> DTO) ([41023ad](https://github.com/AnyNoteInc/AnyNote/commit/41023ad86594ded2b9020ee172ef5a35fe814ad5))
* **domain:** add WorkspaceService.assertMembership ([4a69d19](https://github.com/AnyNoteInc/AnyNote/commit/4a69d19bd60f9b0879f50958b5e4b15aad6ab6f5))
* **domain:** migrate billing — layered reads + getPlanDisplayName dto + tx carve-out ([736fc75](https://github.com/AnyNoteInc/AnyNote/commit/736fc759dd69ca95f4710dd1e0878f71b6bdabe4))
* **domain:** port kanban sprint + comment operations; barrels ([4650eed](https://github.com/AnyNoteInc/AnyNote/commit/4650eed1b359bdca54600621b5caa4e2c4af33a6))
* **domain:** port kanban task write operations ([57c0902](https://github.com/AnyNoteInc/AnyNote/commit/57c09027abbfe15d6c89fe2a16d2d2a82e3ec24a))
* **domain:** scaffold @repo/domain package with DomainError ([889c708](https://github.com/AnyNoteInc/AnyNote/commit/889c7081aa35dd162b85468809ae968e5e4a76ec))
* **domain:** wire DeliveryScheduler into DomainDeps + all three createDomain singletons ([b99cb4a](https://github.com/AnyNoteInc/AnyNote/commit/b99cb4aacf6d4ca4bc24ec2a70c06742d8ddb35c))
* **domain:** wire favorites into container facade; drop old flat files ([2a46a60](https://github.com/AnyNoteInc/AnyNote/commit/2a46a60449d241a001e9612afae92a7969305977))
* **domain:** wire workspace ContainerModule + module barrel ([cf576fd](https://github.com/AnyNoteInc/AnyNote/commit/cf576fdcff7a72a7ee088ed50dc54635c8429fa2))
* **drawio:** add DRAWIO to PageType enum ([d842725](https://github.com/AnyNoteInc/AnyNote/commit/d8427256a34d74aa5018433653e06e48c16c2b14))
* **drawio:** add NEXT_PUBLIC_DRAWIO_URL config + resolveDrawioUrl ([a0a2d85](https://github.com/AnyNoteInc/AnyNote/commit/a0a2d85a0fe3f28633368df81d634375c32a7329))
* **drawio:** full-page DrawioBoard with Yjs load/save sync ([98af9a2](https://github.com/AnyNoteInc/AnyNote/commit/98af9a2a3c1d32046f23fa28ecf92791765b7306))
* **drawio:** render DRAWIO page type in apps/web ([7b8b6fd](https://github.com/AnyNoteInc/AnyNote/commit/7b8b6fdcfbf2442038fb3b898b7db4008ee44dd1))
* **drawio:** scaffold @repo/drawio package ([2be6e6d](https://github.com/AnyNoteInc/AnyNote/commit/2be6e6d1d411c3731bb858885e4f2e0fc1c0771a))
* **drawio:** split Холст into Excalidraw/Draw.io submenu ([6e06d90](https://github.com/AnyNoteInc/AnyNote/commit/6e06d90bae3cdd829db1d873d32d1f4135a31543))
* **drawio:** yjs sync helper + useDrawioYjs hook ([21a0d86](https://github.com/AnyNoteInc/AnyNote/commit/21a0d8639f81e281d7e38b9f8c3d81e033cf82a7))
* **editor:** «Код» slash group with Mermaid/PlantUML/d2 items ([aff5fd0](https://github.com/AnyNoteInc/AnyNote/commit/aff5fd08b926e1e0a382f3317f6f3b3fdf5871cd))
* **editor:** «Комментировать» button on the floating toolbar ([fb894b0](https://github.com/AnyNoteInc/AnyNote/commit/fb894b090a2ce9ff5c2f89fcffa18b9b51bb4cf9))
* **editor:** add Mermaid slash command ([24632f1](https://github.com/AnyNoteInc/AnyNote/commit/24632f15019eb979ffffe33de7080806259eb87c))
* **editor:** add Встраивание slash group with Draw.io item ([d7be6bd](https://github.com/AnyNoteInc/AnyNote/commit/d7be6bda5f9e1253f9db00f6c543e459081cc596))
* **editor:** code-block-pro module with scoped languages (TDD) ([7f7547f](https://github.com/AnyNoteInc/AnyNote/commit/7f7547f568fb99a93a40c7fb65105b00da469f5a))
* **editor:** comment highlight decorations + setCommentThreads ([c6df2dc](https://github.com/AnyNoteInc/AnyNote/commit/c6df2dc4f0de21d34c7c3d73d173ced01bba44ca))
* **editor:** comment-anchor RelativePosition codec + range resolver ([c579ccd](https://github.com/AnyNoteInc/AnyNote/commit/c579ccd92790784cf4ab669ea5d42c22c4d43825))
* **editor:** default mermaid blocks to preview + trim language list ([659ffc8](https://github.com/AnyNoteInc/AnyNote/commit/659ffc80ace0d366e3d6c7b083376b0c00d85947))
* **editor:** draw.io editor + viewer dialogs ([832d9df](https://github.com/AnyNoteInc/AnyNote/commit/832d9df621d4bafbe5904b4cbc47d3caf3c78832))
* **editor:** drawio block node + NodeView ([80874d3](https://github.com/AnyNoteInc/AnyNote/commit/80874d309a1d309743ecad15907ecda25c778136))
* **editor:** drawio save reducer + react-drawio dep ([c5f9227](https://github.com/AnyNoteInc/AnyNote/commit/c5f92272b3a703da664064e02d6462788d608ac9))
* **editor:** emphasis decoration for the active comment anchor ([9f62391](https://github.com/AnyNoteInc/AnyNote/commit/9f62391fc432d5de7ad4725ff4f336986749b9c2))
* **editor:** in-block language picker for code blocks ([e043aa8](https://github.com/AnyNoteInc/AnyNote/commit/e043aa83213542b6ccf6dc1fa1334ffa612a5165))
* **editor:** likec4 code block preview + slash item ([783af5e](https://github.com/AnyNoteInc/AnyNote/commit/783af5e1d8942820c9433790f295cf7230aa4356))
* **editor:** Mermaid code block Код↔Просмотр toggle + render ([e224cca](https://github.com/AnyNoteInc/AnyNote/commit/e224cca5c87e9f91aead6b3243834f68615bffa0))
* **editor:** PlantUML Код↔Просмотр preview in code block ([42469bd](https://github.com/AnyNoteInc/AnyNote/commit/42469bd931e088da6cd1935b52958f250163533c))
* **editor:** register drawio node + thread drawioUrl ([7f70bbb](https://github.com/AnyNoteInc/AnyNote/commit/7f70bbbdbc4867aac570f3afcc85e7ae679bdd38))
* **editor:** replace CodeBlockLowlight with code-block-pro ([ee81a95](https://github.com/AnyNoteInc/AnyNote/commit/ee81a9580c7f253f2a3424efdfe4d7a65b009678))
* **engines:** add ApiKeyGuard with SHA-256 Bearer validation ([5a9dfbb](https://github.com/AnyNoteInc/AnyNote/commit/5a9dfbb935cf548973f4d79596725a76df1c058a))
* **engines:** add AuthContext type + assertMember helper ([82eb59d](https://github.com/AnyNoteInc/AnyNote/commit/82eb59d363f04aa0046ccd35af8fcec62bd895cb))
* **engines:** add DOMAIN bridge (createDomain provider); FavoriteService via facade ([328c1be](https://github.com/AnyNoteInc/AnyNote/commit/328c1be3411a049bcc026dcacbcb9ee872020af5))
* **engines:** add list_workspaces MCP tool ([9b57df7](https://github.com/AnyNoteInc/AnyNote/commit/9b57df75cbfc4956c34354f008d43ea7a06c342f))
* **engines:** add McpAuthGuard combinator (api-key OR internal) ([20f913a](https://github.com/AnyNoteInc/AnyNote/commit/20f913a7495f18f9abd56ba13ab2eb183fa2995a))
* **engines:** add REST DTOs with class-validator + Swagger metadata ([cd24498](https://github.com/AnyNoteInc/AnyNote/commit/cd24498c22d01bde76049031fec7ef769cc7a4d0))
* **engines:** drop /api prefix, Swagger at /docs, add /healthz + /v1/meta ([6f76cfd](https://github.com/AnyNoteInc/AnyNote/commit/6f76cfd36b9e3dfee76516ae5f7dc6e79f06ffd4))
* **engines:** REST controllers under /v1 mirror MCP tools ([42cca9a](https://github.com/AnyNoteInc/AnyNote/commit/42cca9a59e77282763b2a494b6cafde5bb7a564c))
* **engines:** sync workspace limits when subscriptions expire on cancel ([7fb86d9](https://github.com/AnyNoteInc/AnyNote/commit/7fb86d9d491002bf7b2bccce227a8f15b2e06735))
* **env:** add NEXT_PUBLIC_API_BASE_URL for /settings/api hints ([59e8131](https://github.com/AnyNoteInc/AnyNote/commit/59e81319aeb8c42aaff4aa256f1ccd8ce4942837))
* extend tittap editor ([665f0ff](https://github.com/AnyNoteInc/AnyNote/commit/665f0ffe9f0126faeb8b256dfc549e522a6357c7))
* **infra:** add private plantuml-server container + env wiring ([eadfc12](https://github.com/AnyNoteInc/AnyNote/commit/eadfc12fe21f228ff03fd4557ad4c4b59ece25b1))
* **likec4:** browser parse+layout+render diagram component with view selector ([ebdc6d0](https://github.com/AnyNoteInc/AnyNote/commit/ebdc6d097e0dbde7c632f53d05b2071bc091455e))
* **likec4:** Likec4Board (DiagramBoard + custom preview) and package exports ([a3389f2](https://github.com/AnyNoteInc/AnyNote/commit/a3389f237945c13eff5d5e6f11a1e2f310f91cc6))
* **likec4:** Monaco Monarch language for LikeC4 DSL ([1be30b7](https://github.com/AnyNoteInc/AnyNote/commit/1be30b7ebc8e58287306f6e41992409bace45645))
* **likec4:** pure view-selection helpers ([917e92e](https://github.com/AnyNoteInc/AnyNote/commit/917e92e827a53d287a38c0b3dc5ed32e4bf690ee))
* **mcp:** add appendToPage (markdown append to TEXT pages) ([64bb123](https://github.com/AnyNoteInc/AnyNote/commit/64bb1236e29753993b5bee6358e834dc38a3de47))
* **mcp:** add archivePage/restorePage tools ([45b7d1f](https://github.com/AnyNoteInc/AnyNote/commit/45b7d1f33af12f943422c55cbf896f7bab677abf))
* **mcp:** add createDiagramPage/updateDiagramSource tools ([2bc5ec3](https://github.com/AnyNoteInc/AnyNote/commit/2bc5ec3484fac9a7e3955a88eaaac01d9b3fa935))
* **mcp:** add DiagramValidatorService (structural validation) ([2914c07](https://github.com/AnyNoteInc/AnyNote/commit/2914c07f8256b4f86b98a749dd17bfd82b6aca95))
* **mcp:** add EmbeddingConfigService to resolve workspace embedding payload ([73ed6f1](https://github.com/AnyNoteInc/AnyNote/commit/73ed6f188a7b5978d2d2b56184d209cf4133737b))
* **mcp:** add favorites list/add/remove tools ([3eff8c0](https://github.com/AnyNoteInc/AnyNote/commit/3eff8c0e8f35dd0eddafd0f41edec7c4c66a3309))
* **mcp:** add Kanban MCP tools (reads + writes) + wiring + registry ([7d04b82](https://github.com/AnyNoteInc/AnyNote/commit/7d04b82370ecf551155a9e57b6d17dcd7bea50ad))
* **mcp:** add Kanban read service (prisma) + write service (@repo/domain) ([4027e9e](https://github.com/AnyNoteInc/AnyNote/commit/4027e9ebbeb341be1c084b1611327574c266a551))
* **mcp:** add KanbanGateway (resolvers, board guard, DomainError mapping) ([20f7ef3](https://github.com/AnyNoteInc/AnyNote/commit/20f7ef37d5d6b7e1da2d0b7b07287fcdafb7d8c6))
* **mcp:** add listPages tree-browse tool ([5e94458](https://github.com/AnyNoteInc/AnyNote/commit/5e94458e5e17c8f19ca64b52c187d968206512f8))
* **mcp:** add listWorkspaceMembers tool ([49454e6](https://github.com/AnyNoteInc/AnyNote/commit/49454e6190ff6ef05c9fc0f34e7478facb1898ad))
* **mcp:** add notification list + mark-read tools ([35d7264](https://github.com/AnyNoteInc/AnyNote/commit/35d7264f4492629c9b223c3b168ea7b564336eea))
* **mcp:** add PageFtsService for Postgres full-text page search ([10a311d](https://github.com/AnyNoteInc/AnyNote/commit/10a311d8eb17f0281d77d91a895d7b9b18217260))
* **mcp:** add reminder CRUD tools ([706c830](https://github.com/AnyNoteInc/AnyNote/commit/706c830a4597901e912182d4f9730d17d216a7fc))
* **mcp:** add ReminderService (create/list/move/delete/complete) ([2dfeac6](https://github.com/AnyNoteInc/AnyNote/commit/2dfeac6167bf373150e11827666385759ab586f2))
* **mcp:** add STREAMABLE_HTTP transport for stateful MCP servers (Context7) ([b4f68a2](https://github.com/AnyNoteInc/AnyNote/commit/b4f68a28d42e89ea8d6b951c911bb311105d39f5))
* **mcp:** favorite service delegates to domain; add reorderFavorites tool (gap-fix) ([af66d82](https://github.com/AnyNoteInc/AnyNote/commit/af66d827243f533200bfaa2a68707db8df6f9834))
* **mcp:** file tools — list/search/download-link/content/delete ([35ff5d7](https://github.com/AnyNoteInc/AnyNote/commit/35ff5d7f38d301e9ea86ee7e189e4b3012e263b2))
* **mcp:** flag current/default workspace in list_workspaces ([ab59670](https://github.com/AnyNoteInc/AnyNote/commit/ab596708fa1c7db182ae56552f37b13f77fb1f4d))
* **mcp:** notification service delegates to domain; add markAllNotificationsRead tool ([a7c8c4b](https://github.com/AnyNoteInc/AnyNote/commit/a7c8c4b00857e40d5b4e6ac29039bce822cd59f2))
* **mcp:** seed diagram pages (mermaid/plantuml/likec4) in PageWriter ([b47845e](https://github.com/AnyNoteInc/AnyNote/commit/b47845e5a3b93ef2bf57521db348b341e376b855))
* **mcp:** thread embedding config + scoreThreshold into agents search client ([115ad48](https://github.com/AnyNoteInc/AnyNote/commit/115ad48cd525a5d2bde76da44053a4bd3bc7ded5))
* **mcp:** two-stage search_pages (FTS+RAG) and add searchPagesByTitle ([cd6c84b](https://github.com/AnyNoteInc/AnyNote/commit/cd6c84be7773a4bbe0284e9637e49c7701c45481))
* **mermaid:** Monaco Monarch grammar for mermaid ([f9becf2](https://github.com/AnyNoteInc/AnyNote/commit/f9becf2da585a14b1215326f1fa7ec2ace9c222e))
* **mermaid:** Monaco source editor bound to Y.Text ([6a99644](https://github.com/AnyNoteInc/AnyNote/commit/6a99644a55385a94dc565add4c6c14c5442bb46c))
* **mermaid:** preview with zoom/pan, error panel, SVG/PNG export ([262717f](https://github.com/AnyNoteInc/AnyNote/commit/262717fcdfe9cb4a56633110cae326d7c07ae656))
* **mermaid:** safe mermaid render wrapper with parse guard ([76d4c78](https://github.com/AnyNoteInc/AnyNote/commit/76d4c78e66043afc3359c6db557b80ed12c9fcc4))
* **mermaid:** scaffold @repo/mermaid package and register transpile ([4598002](https://github.com/AnyNoteInc/AnyNote/commit/45980025ddd212026a91d088942153de133a20cb))
* **mermaid:** self-hosted Monaco worker + loader config ([5a2a050](https://github.com/AnyNoteInc/AnyNote/commit/5a2a05021a1a8ca9a617dd21e1c54f202aa02e26))
* **mermaid:** split-pane board shell + dynamic ssr:false wrapper ([0c8352c](https://github.com/AnyNoteInc/AnyNote/commit/0c8352cea5b5f891830826ac4564fdb7cbf78883))
* **mermaid:** SVG/PNG export helpers ([fb03963](https://github.com/AnyNoteInc/AnyNote/commit/fb0396353f1532ea5afd4ea9d8ed8926e5b5548e))
* **mermaid:** theme mode mapping helpers ([00b3c47](https://github.com/AnyNoteInc/AnyNote/commit/00b3c479df69fa9115b212af6008a38740891baf))
* **mermaid:** yjs hook with Y.Text source root ([e94f2e5](https://github.com/AnyNoteInc/AnyNote/commit/e94f2e52c97fa01ae5ed9cda9174bee88897b322))
* **plantuml:** Monaco Monarch language for plantuml source ([fce023a](https://github.com/AnyNoteInc/AnyNote/commit/fce023aa58b5f67708a191946edb990ad5486090))
* **plantuml:** scaffold @repo/plantuml package ([d49c005](https://github.com/AnyNoteInc/AnyNote/commit/d49c005c5a3c25c643a9d3cc7ec43846608a2cd3))
* **plantuml:** server-proxied renderer + PlantumlBoard ([2b9c013](https://github.com/AnyNoteInc/AnyNote/commit/2b9c0131af3107633524c3886c9a28647c351a4a))
* realtime comment updates via bus subscription ([b29a642](https://github.com/AnyNoteInc/AnyNote/commit/b29a642f67bb105ffb239f1a13c5c9dfc3234ff9))
* remove d2 and likec4 from codes ([79ba791](https://github.com/AnyNoteInc/AnyNote/commit/79ba791ab7b178c2945cf7e258294532fac28a78))
* **seo:** list /changelog in the sitemap ([6c23602](https://github.com/AnyNoteInc/AnyNote/commit/6c23602ed3db7a2db37ea907b2dcc1a190056b1b))
* **storage:** shared text extractor (whitelist + PDF/DOCX) ([7b76dbc](https://github.com/AnyNoteInc/AnyNote/commit/7b76dbca9d30eb91d80d9cd72f7a22dc8f0a616c))
* **trpc,agents:** JWT-protect /validation/* with internal service token ([958127c](https://github.com/AnyNoteInc/AnyNote/commit/958127c69ae1fcd76f12176a0c0dc1351ed2246e))
* **trpc:** add api-key generation + hash helpers ([2128b5c](https://github.com/AnyNoteInc/AnyNote/commit/2128b5c232b63dcbd955197da5473a10e8635b83))
* **trpc:** add apiKey router (list/create/revoke) ([ebc6a3f](https://github.com/AnyNoteInc/AnyNote/commit/ebc6a3f37ea830687f127f64e6b6d1f3aea9a39f))
* **trpc:** add page.reorder — workspace-shared DnD tree reordering ([63127d5](https://github.com/AnyNoteInc/AnyNote/commit/63127d5e68313bf976e8802a366aabb8c36472a3))
* **trpc:** add page.reorderFavorites — personalized favorites order ([b4d5133](https://github.com/AnyNoteInc/AnyNote/commit/b4d5133bd8683d1e4156bec40b849787b6e6dd7f))
* **trpc:** add resolveActivePlanOrPersonal + syncWorkspaceLimits helpers ([704f20e](https://github.com/AnyNoteInc/AnyNote/commit/704f20ea323429ac0e82f904f588b34280a0cf55))
* **trpc:** add workspace.getUsage procedure ([6b8c845](https://github.com/AnyNoteInc/AnyNote/commit/6b8c8456df656e1adaa01688cca8562b22243147))
* **trpc:** agents provider/embedding/mcp validation client ([3bc40ba](https://github.com/AnyNoteInc/AnyNote/commit/3bc40ba2fe4cd4b839005ad874a8c3fdd79d2117))
* **trpc:** aiProvider router with ping-on-save + encrypted creds (owner-only, plan-gated) ([57c60d0](https://github.com/AnyNoteInc/AnyNote/commit/57c60d0ba4abafb69a2f8312b341b549190e3107))
* **trpc:** anonymous + public-link comment resolution ([bac01bf](https://github.com/AnyNoteInc/AnyNote/commit/bac01bf1cc5c3064e29bef5d7eafb53100bff3e5))
* **trpc:** chat.updateChatSettings + settings in getChat/createChat ([a748add](https://github.com/AnyNoteInc/AnyNote/commit/a748add41a31bef6efecd2fc99b1da8d1cdfbd07))
* **trpc:** comment edit/delete (moderation) + resolve/reopen ([a5f61ee](https://github.com/AnyNoteInc/AnyNote/commit/a5f61eef12b87cba22ad536deb75bf40dc0af5a6))
* **trpc:** comment listThreads/createThread/addComment + bus ([8fa713c](https://github.com/AnyNoteInc/AnyNote/commit/8fa713c70695d03be6f0d287771d47c9fd943eea))
* **trpc:** enforce member limit in workspace.inviteMember ([8638531](https://github.com/AnyNoteInc/AnyNote/commit/8638531de69ea5f39e65d7d0999734d923a1470d))
* **trpc:** expose + set AiModel.supportsReasoning ([f9ce9c8](https://github.com/AnyNoteInc/AnyNote/commit/f9ce9c8d439e6479fa3ad2d0b2f15548850289c3))
* **trpc:** favorites ordered by position; addFavorite appends at tail ([89bd93a](https://github.com/AnyNoteInc/AnyNote/commit/89bd93aa8af718a807f30941cea48d33ac5f302d))
* **trpc:** file.listRecent for composer recent-files menu ([f9bb855](https://github.com/AnyNoteInc/AnyNote/commit/f9bb8552a9e1f3e7428395b8d8c28005766d113d))
* **trpc:** page.create inserts new page at tail of sibling list ([744f17c](https://github.com/AnyNoteInc/AnyNote/commit/744f17c37f8e101b6e973b328fdf66ae47f6eab8))
* **trpc:** page.share get (read-only) + ensure (lazy create) ([4d51087](https://github.com/AnyNoteInc/AnyNote/commit/4d51087006d69aab6aafa4c1732e405159850c71))
* **trpc:** page.share setAccess/addUser/updateUser/removeUser ([f88e829](https://github.com/AnyNoteInc/AnyNote/commit/f88e829de2721a4f78018a4da42e8ad7040fb09d))
* **trpc:** ping MCP servers before save + customMcpEnabled plan gate ([ade45e6](https://github.com/AnyNoteInc/AnyNote/commit/ade45e6b7d86b4105aedb1b706976af6ac804059))
* **trpc:** plan flag customAiProvidersEnabled + workspace-scoped model listing ([4883f39](https://github.com/AnyNoteInc/AnyNote/commit/4883f39359f6b6314b84a4926e10a3a6a147e8cc))
* **trpc:** resolveCommentContext (signed-in resolution) ([e9bdb15](https://github.com/AnyNoteInc/AnyNote/commit/e9bdb153bcab1769fdf9e04e140583d28eabbd37))
* **trpc:** restrict aiSettings.update to workspace owner ([91fbef8](https://github.com/AnyNoteInc/AnyNote/commit/91fbef8f1c6093ea411cd5ddad7474c63489d2db))
* **trpc:** sync workspace limits in handlePaymentSucceeded and handleRefundSucceeded ([38e5680](https://github.com/AnyNoteInc/AnyNote/commit/38e568010498c011cab43a23d4d72bcbf0b30fc7))
* **trpc:** sync workspace limits on workspace.create ([1690263](https://github.com/AnyNoteInc/AnyNote/commit/16902637ab0f8af7000a55f2a03355adc1c1ffc8))
* **trpc:** user.search with anti-enumeration limits ([bd6228c](https://github.com/AnyNoteInc/AnyNote/commit/bd6228c3ad018d865c1cea992c27b6e9a936d64d))
* **ui:** ChatThinkingBlock collapsible reasoning block ([355b80f](https://github.com/AnyNoteInc/AnyNote/commit/355b80fea91e572e9b1782c0fe20b1fe10afe6fd))
* **ui:** Claude cream palette (light + dark) theme tokens ([466f5b3](https://github.com/AnyNoteInc/AnyNote/commit/466f5b349a13ac5f73ed74173016fa97f638b3ae))
* **ui:** Claude-style message list (full-width, no avatars/bubbles) + render thinking ([ee4bff5](https://github.com/AnyNoteInc/AnyNote/commit/ee4bff5b85befecaec81fd9aa403afaa38b3f02c))
* **ui:** export ScreenShare/Lock/Public icons ([cfb848c](https://github.com/AnyNoteInc/AnyNote/commit/cfb848cb45869dd272d77fdf6589cf443dfe0769))
* **web,trpc:** show MCP tools discovered during validation after add ([1bee367](https://github.com/AnyNoteInc/AnyNote/commit/1bee367a310de9da0bf80ee0ba2cb6db1d84064a))
* **web:** «Диаграмма» submenu with MermaidJS / PlantUML ([187499b](https://github.com/AnyNoteInc/AnyNote/commit/187499b6a5e344041aa35a0242472821155a6acb))
* **web:** «Поделиться» button in the page toolbar ([63991e7](https://github.com/AnyNoteInc/AnyNote/commit/63991e7a9d637d333cc42bfe9b23f1ecfe281bd2))
* **web:** /api/yjs/share-token mints share JWTs ([b5c9bfe](https://github.com/AnyNoteInc/AnyNote/commit/b5c9bfe8e63b4bb8b1d959dbfd181b525f43cbd8))
* **web:** add 'Диаграмма' (MERMAID) to create-page menu ([19b92ef](https://github.com/AnyNoteInc/AnyNote/commit/19b92efdd8b54627bad5877a1ffc411f906a57b0))
* **web:** add /settings/api page with key management UI ([4cf5ac9](https://github.com/AnyNoteInc/AnyNote/commit/4cf5ac98623c956418905319d47abc33cb9553cb))
* **web:** add /settings/usage page with limits + nav entry ([76e693a](https://github.com/AnyNoteInc/AnyNote/commit/76e693aeb7e82eea8814f76d30ba72a75be22927))
* **web:** add changelog nav item next to pricing ([5bd49d7](https://github.com/AnyNoteInc/AnyNote/commit/5bd49d7e3ca8f85f0b898e354027f5749e5d3fee))
* **web:** add comment mention autocomplete ([12057a7](https://github.com/AnyNoteInc/AnyNote/commit/12057a76ebb0199858adfbca0e4371066a517000))
* **web:** add formatBytes utility ([2eb23c7](https://github.com/AnyNoteInc/AnyNote/commit/2eb23c7f39e1f7146e59f8ee7c9f7ef92f010f08))
* **web:** add resolveShareAccess viewing-resolution helper ([b3778e0](https://github.com/AnyNoteInc/AnyNote/commit/b3778e000751275f1f53bb80b3555472c305ce08))
* **web:** add UsageSection component for workspace settings ([db9b2fd](https://github.com/AnyNoteInc/AnyNote/commit/db9b2fd1b52e970d1dab7ea4c004833b92bd9d68))
* **web:** auth-gated /api/plantuml/render proxy route ([676039c](https://github.com/AnyNoteInc/AnyNote/commit/676039c5459a19a856d23565b16ee0b719a4ed58))
* **web:** comments on the public share route ([c1ff856](https://github.com/AnyNoteInc/AnyNote/commit/c1ff856a222fadb78fe61edf3ed9a9ad0ecf81ff))
* **web:** custom AI providers manager in workspace AI settings (owner + plan gated) ([3639edc](https://github.com/AnyNoteInc/AnyNote/commit/3639edc0a1ab2e193d91d0f4e49853bf56be3049))
* **web:** enforce workspace storage limit on file upload ([1fb2c96](https://github.com/AnyNoteInc/AnyNote/commit/1fb2c9642330d5dd0b9ef033eef35cc2c58920fd))
* **web:** favorites section drag-and-drop reordering ([8567d24](https://github.com/AnyNoteInc/AnyNote/commit/8567d24dbde9b1ef7e3334d292a2c11e8dad206c))
* **web:** include PLANTUML in page chrome type unions + full-bleed ([2e3a756](https://github.com/AnyNoteInc/AnyNote/commit/2e3a75625a012e7702aa0aada3bec2d27023e125))
* **web:** inline comment UI (highlight popover + panel) wired to PageRenderer ([e6cfb90](https://github.com/AnyNoteInc/AnyNote/commit/e6cfb901a8cd1359ff14c2c0e109b3048f15fc6a))
* **web:** install dnd-kit, add FlatPageItem + flattenTree ([b54a7e8](https://github.com/AnyNoteInc/AnyNote/commit/b54a7e8abbf8907fcdd398e75246ea2a09d91a46))
* **web:** page tree drag-and-drop reordering via dnd-kit ([24f5d1b](https://github.com/AnyNoteInc/AnyNote/commit/24f5d1b4eefcb3ca4fc41079ece1502fb1240f02))
* **web:** PageRenderer accepts injected yjsToken + editable ([b7c2c5c](https://github.com/AnyNoteInc/AnyNote/commit/b7c2c5c03f651a7323348a15a9dd9d2231ad6b4d))
* **web:** per-workspace MCP servers settings section + nav; retire global MCP page ([f912af8](https://github.com/AnyNoteInc/AnyNote/commit/f912af8e252908ef5fa2397c7cbc50033776741d))
* **web:** plantuml render helper (encode + proxy fetch) ([2e21e49](https://github.com/AnyNoteInc/AnyNote/commit/2e21e498eb5f643dff43eed16685e09c88b2e88b))
* **web:** public /changelog page rendering docs/changelog.md ([2fb981c](https://github.com/AnyNoteInc/AnyNote/commit/2fb981c3dd1ef5d416904fb79b704592a8f96967))
* **web:** public /s/[shareId] share route + read-only banner ([d3540d3](https://github.com/AnyNoteInc/AnyNote/commit/d3540d38583dff0daff54259b71f05b9febc610b))
* **web:** render MERMAID pages via @repo/mermaid ([556f943](https://github.com/AnyNoteInc/AnyNote/commit/556f9431a7b78399e7ed345a43153b221e84d96b))
* **web:** render PLANTUML pages with PlantumlBoard ([5e30fce](https://github.com/AnyNoteInc/AnyNote/commit/5e30fce42758a7cf8612e7bb53f833d59e956be9))
* **web:** save page icon from rename dialog ([226715e](https://github.com/AnyNoteInc/AnyNote/commit/226715eb08105b18ef2559229c0cd294b6634561))
* **web:** send provider.kind + decrypt workspace provider creds in agent payload ([38dd4c1](https://github.com/AnyNoteInc/AnyNote/commit/38dd4c13150f2438ba9cdcc03bdbdc9f2cc8e41b))
* **web:** settings nav entry for API keys ([a159a36](https://github.com/AnyNoteInc/AnyNote/commit/a159a3630a58152f7cfeea3f8ea46a5bf069b560))
* **web:** ShareDialog for the «Общий доступ» modal ([d51c14e](https://github.com/AnyNoteInc/AnyNote/commit/d51c14e829ab665a31d085553e1f63bb17aba9f9))
* **web:** treat MERMAID as full-bleed page type in actions + layout ([c2b3f2d](https://github.com/AnyNoteInc/AnyNote/commit/c2b3f2da10b7d8217e9bc5c4230557024756bdb1))
* **web:** wire LIKEC4 page type (renderer, submenu, actions, full-bleed) ([448c483](https://github.com/AnyNoteInc/AnyNote/commit/448c483b6be91c4726e3d68ef37d5486cd37c43c))
* **workspace:** white (paper) canvas on all workspace pages ([1db2cd6](https://github.com/AnyNoteInc/AnyNote/commit/1db2cd667526d019609ee8f6ec5c7a2b65caf340))
* **yjs:** authorize share tokens with read-only for reader/commenter ([219f4d7](https://github.com/AnyNoteInc/AnyNote/commit/219f4d7da66c4dc5425265be63ad7c600deb7a32))
* **yjs:** persist MERMAID source snapshot to Page.content ([26660da](https://github.com/AnyNoteInc/AnyNote/commit/26660da388da54b1de4327d2d255c64590cb520b))
* **yjs:** verifyShareToken + share-token env ([13cd5b5](https://github.com/AnyNoteInc/AnyNote/commit/13cd5b55a58f93c8bec9b10606d48390942dde08))


### Performance Improvements

* **likec4:** skip no-op re-renders on unchanged Yjs source ([064f8a3](https://github.com/AnyNoteInc/AnyNote/commit/064f8a3da006aa6e3351514a5208c75bfc823840))

# [1.21.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.20.0...v1.21.0) (2026-05-19)


### Bug Fixes

* **agents:** make create-page-from-chat reliable on GigaChat-2 Pro ([2b1b766](https://github.com/AnyNoteInc/AnyNote/commit/2b1b766909301a9fac812f70737872cfd1c28b98))
* createPages ([66bca68](https://github.com/AnyNoteInc/AnyNote/commit/66bca6862a41717c85edfb4fec1444e0403d5d72))
* **engines:** tolerate GigaChat null tool args + widen confirmation auth skew ([5a43d31](https://github.com/AnyNoteInc/AnyNote/commit/5a43d3171181631b921d97d1cdf65036594d6fb3))
* **engines:** widen expired-timestamp offset past new 600s skew window ([7865f1b](https://github.com/AnyNoteInc/AnyNote/commit/7865f1b6c1ef4439b5e545ca87dff208651193a5))
* tests ([7a3c48a](https://github.com/AnyNoteInc/AnyNote/commit/7a3c48aa545348327e5b4717e33b86321cdbed43))
* **web:** align tests with redesigned workspace root + settings hotkey ([0ddc478](https://github.com/AnyNoteInc/AnyNote/commit/0ddc4781cff2f408dd5aff7006939b346d7e0d08))


### Features

* Add favorits chat ([a8bb079](https://github.com/AnyNoteInc/AnyNote/commit/a8bb079efb839c5c38ffc5a73755022a799816bd))
* redesign workspaces ([7223ecc](https://github.com/AnyNoteInc/AnyNote/commit/7223eccc5a129cad596084a9e985371c8260e556))

# [1.20.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.19.3...v1.20.0) (2026-05-18)


### Bug Fixes

* address SonarCloud findings on PR [#17](https://github.com/AnyNoteInc/AnyNote/issues/17) ([1d580e4](https://github.com/AnyNoteInc/AnyNote/commit/1d580e42d719ead4614b9ae712f0dcdb719b9b48))
* **engines:** MarkdownParser preserves marks on hard breaks + covers edge cases ([86b329e](https://github.com/AnyNoteInc/AnyNote/commit/86b329ed5761d66d23d202ee00d3a2d5686f114e))
* **engines:** typecheck cleanup after PageTools ctor + parser test additions ([312f611](https://github.com/AnyNoteInc/AnyNote/commit/312f61162360f47aa9e0e5d316b6eb07a6a7f691))


### Features

* **engines:** createPage MCP tool persists markdown body and returns URL ([177b650](https://github.com/AnyNoteInc/AnyNote/commit/177b65009aeca17cb00055320618cf4f4fe29ffe))
* **engines:** intent-first createPage description covers chat-summary flow ([b775852](https://github.com/AnyNoteInc/AnyNote/commit/b7758521d71f30952c320e8804bb2b30ddac8df3))
* **engines:** MarkdownParser handles inline marks and hard breaks ([8c884d8](https://github.com/AnyNoteInc/AnyNote/commit/8c884d80063c285162ed944bf19b244e94f60f55))
* **engines:** MarkdownParser handles lists, blockquotes, code, hr ([d75c638](https://github.com/AnyNoteInc/AnyNote/commit/d75c638d01145d6c68fd8e9f07342afa9cd2fccc))
* **engines:** MarkdownParser handles paragraphs and headings ([95578d3](https://github.com/AnyNoteInc/AnyNote/commit/95578d350d1b463ec3ed62cea7afe922b585ce59))
* **engines:** PageWriter.createPage accepts optional Tiptap content ([d1eebdc](https://github.com/AnyNoteInc/AnyNote/commit/d1eebdc1e1051d615b01db3f77b3962da6a47f9d))

## [1.19.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.19.2...v1.19.3) (2026-05-18)


### Bug Fixes

* **agents:** register custom types in LangGraph checkpoint serde ([4a29e64](https://github.com/AnyNoteInc/AnyNote/commit/4a29e64c11ad65074a5c4dde1b518f039f3ce520))
* **deploy:** point ENGINES_MCP_URL to /api/mcp prefix ([506bc65](https://github.com/AnyNoteInc/AnyNote/commit/506bc65acafdf21fb22bc9d4990a7666f01d1a09))

## [1.19.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.19.1...v1.19.2) (2026-05-18)


### Bug Fixes

* **agents:** install spaCy models into project venv ([c77e1db](https://github.com/AnyNoteInc/AnyNote/commit/c77e1db19e8671322fcc34f43198dbde2e121767))

## [1.19.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.19.0...v1.19.1) (2026-05-18)


### Bug Fixes

* **deploy:** wire Agent OS v1 env vars into production ([294132e](https://github.com/AnyNoteInc/AnyNote/commit/294132ecace3878cd5e138f73672710779e19ffc))

# [1.19.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.18.1...v1.19.0) (2026-05-18)


### Bug Fixes

* **agents,web:** wire internal tools, persist save_memory, robust resume + critic + interrupt streaming ([eda620e](https://github.com/AnyNoteInc/AnyNote/commit/eda620e592d374fb75df4468f43d369c58804a6d))
* **agents:** handle JSON-Schema nullable union type in MCP arg model ([1091a11](https://github.com/AnyNoteInc/AnyNote/commit/1091a11bf82f2f1ea1c388c7387e9973708a40f5))
* **agents:** populate_by_name on ModelConnectionSchema ([2b64fb8](https://github.com/AnyNoteInc/AnyNote/commit/2b64fb8f3a240cd7b7237c9d9da2931a92c37512))
* **agents:** re-emit plan_step events on status changes ([00c3ab4](https://github.com/AnyNoteInc/AnyNote/commit/00c3ab4a553e2a63d8827ba50c40b8b0fe276b5f))
* **agents:** split executor into LLM + tool-runner nodes for safe resume ([dc90983](https://github.com/AnyNoteInc/AnyNote/commit/dc90983e99044f4af12e1ad977ebb9d06b246d3a))
* **auth:** validate IV/tag length in decryptSecret + extra tamper tests ([a616b80](https://github.com/AnyNoteInc/AnyNote/commit/a616b8018e346ee9c174e2cd42e6ed450df602a8))
* **db:** agent_os_v1 — nullable createdBy/userId, extra memory index ([925e71d](https://github.com/AnyNoteInc/AnyNote/commit/925e71dd2be299f1ac9ebc8937294a7759ef8436))
* deploy env ([9bdc77a](https://github.com/AnyNoteInc/AnyNote/commit/9bdc77a70da6d73a3e29bed477cf6e8ef651368d))
* gates — drop non-existent retries select, fix lint import order, noqa RUF002 ([6dab106](https://github.com/AnyNoteInc/AnyNote/commit/6dab10645dd5e9a4786d83db2630f2022ba85c8b))
* **lint:** move Readonly<> to chat prop type defs; eslint-disable prop-types for Readonly-wrapped destructure; inline NOSONAR for confirmResume S6440 ([582cb12](https://github.com/AnyNoteInc/AnyNote/commit/582cb126514ec499cb557e1725c1a961714ba28e))
* restore legacy chat compatibility after agent-os-v1 regressions ([25cce6b](https://github.com/AnyNoteInc/AnyNote/commit/25cce6b94870f1a76ef1c40ef037d2d086813935))
* **ui:** thread onConfirm through ChatMessageContent render path ([ef3107a](https://github.com/AnyNoteInc/AnyNote/commit/ef3107a2f842d3664dcc1ff647044d55636af54c))
* **ui:** wrap chat-service-block titles inside the message bubble ([9eda6a1](https://github.com/AnyNoteInc/AnyNote/commit/9eda6a134568d81004bef51ae1a25e76f7acf30b))
* **web:** hide confirm buttons after allow/deny by flipping block state ([03b180e](https://github.com/AnyNoteInc/AnyNote/commit/03b180eda24af8989d1a11be020b9f4efcd39127))


### Features

* **agents,web:** AgentActionLog repository + web POST endpoint ([34ef621](https://github.com/AnyNoteInc/AnyNote/commit/34ef621203a21011ae13616e9683d2963d121bcc))
* **agents,web:** memory_writer node + /api/agent/memory-writes endpoint ([8098083](https://github.com/AnyNoteInc/AnyNote/commit/809808398981cc986e2c7d2f00266d0b427921ca))
* **agents:** agent module scaffold + HS256 JWT verification (Tasks 8+9) ([1c3018e](https://github.com/AnyNoteInc/AnyNote/commit/1c3018efe6c696dc40ec5d7b4c257b4585bafe5f))
* **agents:** AgentState + request/response schemas ([6853188](https://github.com/AnyNoteInc/AnyNote/commit/685318831b41d94340e7a89950ab2bd0495c6beb))
* **agents:** assemble Plan-Execute-Critic StateGraph + conditional routes ([d02876f](https://github.com/AnyNoteInc/AnyNote/commit/d02876f76332b2066feb8d3cb175e9fde619794e))
* **agents:** build_langchain_tools — namespaced StructuredTools from MCP ([15a6299](https://github.com/AnyNoteInc/AnyNote/commit/15a62999af55120409f987c9a3daa85c047333e6))
* **agents:** critic node with revision cap ([8a6e6cc](https://github.com/AnyNoteInc/AnyNote/commit/8a6e6ccc5ff4efc2f95199e3bfd9e0e2700a4596))
* **agents:** Dishka providers for the agent module ([9b265c2](https://github.com/AnyNoteInc/AnyNote/commit/9b265c2719c8e9f82ea261d0ca5c259a4e4b969d))
* **agents:** executor confirmation gate via LangGraph interrupt() ([1684548](https://github.com/AnyNoteInc/AnyNote/commit/168454830f332409e5d68e89479fdc3221697415))
* **agents:** executor node — ReAct sub-loop, scope gate, plan advance ([e9b205b](https://github.com/AnyNoteInc/AnyNote/commit/e9b205bef2d74854586911600c867c0a7bb3566c))
* **agents:** extended SSE ServerEvent union ([f882b9a](https://github.com/AnyNoteInc/AnyNote/commit/f882b9a0c34186bab6edd4118199373d0ff0f37a))
* **agents:** intent-first descriptions for internal tools ([46bcfa1](https://github.com/AnyNoteInc/AnyNote/commit/46bcfa1da9b4e76b1c9a35f70463649dc261e0ff))
* **agents:** internal tools save_memory, recall_memory, search_pages ([b1bda2e](https://github.com/AnyNoteInc/AnyNote/commit/b1bda2ed2fbf8d307e25593e7e9853cc61862a7e))
* **agents:** Jinja renderer + router/planner/executor/critic templates ([a2e66aa](https://github.com/AnyNoteInc/AnyNote/commit/a2e66aa5e5d7086fd3eb418fe5a36986c1503828))
* **agents:** McpClient HTTP JSON-RPC path + allowlist filtering ([d282220](https://github.com/AnyNoteInc/AnyNote/commit/d282220281951a4a08760983d2db6dc9466ccdbe))
* **agents:** McpClient.discover_all with per-server failure isolation ([0a88c1c](https://github.com/AnyNoteInc/AnyNote/commit/0a88c1c1a347706744f1e303ae7b48fd70fe931e))
* **agents:** mount /agent/run and /agent/resume routes ([f2f5ca1](https://github.com/AnyNoteInc/AnyNote/commit/f2f5ca17e16a4b9542a56090fd5f226d4b3abb12))
* **agents:** planner node — JSON plan parse + fallback ([a0f5f66](https://github.com/AnyNoteInc/AnyNote/commit/a0f5f66955ccb48fb3e765629dc7d99cfe750c9a))
* **agents:** ResumeAgentUseCase + shared streaming helper ([305c1a2](https://github.com/AnyNoteInc/AnyNote/commit/305c1a2ca602877b877373ebf6cdb5b29cfa12a9))
* **agents:** router node + plan-step factory helpers ([3b3d5ed](https://github.com/AnyNoteInc/AnyNote/commit/3b3d5ed96f2a648d378e34f130e849e2c28664f5))
* **agents:** RunAgentUseCase streaming the Plan-Execute-Critic graph ([8389e15](https://github.com/AnyNoteInc/AnyNote/commit/8389e158d76ab3cf445f83d492920eceec17d7e2))
* **agents:** simple chat-history truncation (LLM compaction deferred) ([fbf1107](https://github.com/AnyNoteInc/AnyNote/commit/fbf1107cf3a04c7a28c466e9ea0a575d6ea9fb30))
* **agents:** SSE MCP transport via official mcp SDK ([c076013](https://github.com/AnyNoteInc/AnyNote/commit/c07601307047b7cb41ea50616a29f5b66486509a))
* **agents:** tool registry with scope + confirmation metadata ([11b260a](https://github.com/AnyNoteInc/AnyNote/commit/11b260a8339ff4d3ca6f78cfb248c078de2a2cb1))
* **auth:** AES-256-GCM secret encryption helpers ([c1721d5](https://github.com/AnyNoteInc/AnyNote/commit/c1721d50a68397915e036e425fe84eaf56f13332))
* **db:** agent_os_v1 — WorkspaceMcpServer, WorkspaceAgentMemory, AgentActionLog, WorkspaceAiSettings extension ([67a0282](https://github.com/AnyNoteInc/AnyNote/commit/67a0282f9ba7d50ec9e9a690392d81173f8c2b98))
* **engines:** cleanup cron for orphaned LangGraph interrupts ([c634685](https://github.com/AnyNoteInc/AnyNote/commit/c6346850896c2d9d114a9cb67b6075c8b61300e1))
* **engines:** HMAC guard for apps/agents internal MCP calls ([7d56624](https://github.com/AnyNoteInc/AnyNote/commit/7d56624188272823009c05feff0e0631060deaef))
* **engines:** intent-first description for semantic search MCP tool ([fd84774](https://github.com/AnyNoteInc/AnyNote/commit/fd8477410bcb7c92f3e1587ceaa58f4b6ea89c98))
* **engines:** intent-first descriptions for page MCP tools ([47c9188](https://github.com/AnyNoteInc/AnyNote/commit/47c9188d4131be268b2369aef86f46de28c8e2d1))
* **engines:** intent-first descriptions for workspace MCP tools ([9e42085](https://github.com/AnyNoteInc/AnyNote/commit/9e420853182c56cd5d6ccd2a05f5f6e300a99456))
* **engines:** MCP tool search_pages delegating to apps/agents RAG ([d425442](https://github.com/AnyNoteInc/AnyNote/commit/d425442e48ba0d513f6a7356b9c671ba4fd0184a))
* rewire web chat to /agent/run — JWT auth, new payload, v1 SSE translation ([69051c8](https://github.com/AnyNoteInc/AnyNote/commit/69051c8df51874d98358075626c2e276dd7b072c))
* **trpc:** agentMemory router (list + delete) ([0cdc78c](https://github.com/AnyNoteInc/AnyNote/commit/0cdc78c894d8f59db742704dfd3453afeecdbf15))
* **trpc:** mcpServer router (CRUD with encrypted headers) ([7a793d7](https://github.com/AnyNoteInc/AnyNote/commit/7a793d7df1ed7336eefe0c095b234f565d290b1d))
* **ui:** inline Allow/Deny buttons for tool-confirmation blocks ([0f3535d](https://github.com/AnyNoteInc/AnyNote/commit/0f3535da4f7eab2363b2d8f070f34df37346f339))
* **ui:** thread onConfirm callback from ChatThread to ChatServiceBlock ([005f26e](https://github.com/AnyNoteInc/AnyNote/commit/005f26edc308a3154b85c7f99af47f8d7c2e1589))
* **web:** /api/agent/generate route — SSE proxy to apps/agents ([c28c4c7](https://github.com/AnyNoteInc/AnyNote/commit/c28c4c72ddde20c6d93f26cd8f7472876c172d83))
* **web:** /api/agent/resume route — pass-through with new JWT ([47c3635](https://github.com/AnyNoteInc/AnyNote/commit/47c3635c1481cc6ab342a89f3f71a13afe8dfc3e))
* **web:** /settings/integrations/mcp/ — list, add, enable, delete servers ([47daf0c](https://github.com/AnyNoteInc/AnyNote/commit/47daf0c642f5f426572f8704a3e35a6d648e985c))
* **web:** /settings/memory/ — list and delete agent-recorded facts ([861b7ec](https://github.com/AnyNoteInc/AnyNote/commit/861b7ecdd09adb5d2b6e98c296159d6cea79ba3b))
* **web:** add buildEnginesMcpHeaders helper for HMAC-signed Engines MCP auth ([ecf75cc](https://github.com/AnyNoteInc/AnyNote/commit/ecf75cc7dd6cc67a20920d3fe581855c640da774))
* **web:** ConfirmationDialog + chat-page wiring for plan/confirm events ([9047a52](https://github.com/AnyNoteInc/AnyNote/commit/9047a5252847412b928b0506ceb1ad6c71dec319))
* **web:** decrypt model connection + MCP headers helpers ([cba199f](https://github.com/AnyNoteInc/AnyNote/commit/cba199f3e9f5a88c8d26fed45f4ed952bf18714c))
* **web:** include tool summary and args_preview in confirmation block ([f4bb161](https://github.com/AnyNoteInc/AnyNote/commit/f4bb161f458db0962b08691296690891e962016f))
* **web:** PlanPanel — renders streamed plan_step events ([212f146](https://github.com/AnyNoteInc/AnyNote/commit/212f1469d6ff68ee6d4dfecdf36c50afab49553f))
* **web:** sign short-lived agents JWT (HS256) with scope-by-role ([cde98e2](https://github.com/AnyNoteInc/AnyNote/commit/cde98e2106dbfce41f82bcb36f711b8c373e06c1))
* **web:** translate /api/agent/resume into web SSE + add confirmResume hook ([75c51cc](https://github.com/AnyNoteInc/AnyNote/commit/75c51ccbddfc38458b72124c8274c6626ccc83a8))
* **web:** typed SSE consumer for agent events ([c147ef6](https://github.com/AnyNoteInc/AnyNote/commit/c147ef6cddbecb6fb4fcdc4c39b4760051a5de4a))
* **web:** wire confirmResume into the workspace chat client ([124dec6](https://github.com/AnyNoteInc/AnyNote/commit/124dec6e22132bb8ef76e843feabd29a33a7d4cd))

## [1.18.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.18.0...v1.18.1) (2026-05-17)


### Bug Fixes

* **deploy:** bind postgres to host loopback for SSH-tunnel access ([5303cd9](https://github.com/AnyNoteInc/AnyNote/commit/5303cd9210133719980c1137ead999a8ceb3eba5))

# [1.18.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.17.0...v1.18.0) (2026-05-16)


### Bug Fixes

* html drag ([f4a7e50](https://github.com/AnyNoteInc/AnyNote/commit/f4a7e50d34698649024351d79d80e24a6c0b73b7))
* **kanban:** invalidate activity + comments on SSE events; e2e coverage ([a396526](https://github.com/AnyNoteInc/AnyNote/commit/a396526662a938778fa7e2324b5f9f4182850491))
* **kanban:** table view ignores sprint filter so drag-to-backlog stays visible ([f50de5b](https://github.com/AnyNoteInc/AnyNote/commit/f50de5b6aaf3f5d21f02e5fe5d5e7c04710b16c4))
* **kanban:** TaskRowMenu delete icon, sprint header alignment, newest-first sort ([65475ed](https://github.com/AnyNoteInc/AnyNote/commit/65475ed88763032980a6f2784f63dd2e6786f323))
* **kanban:** UX polish + task popover perf fixes ([78a302b](https://github.com/AnyNoteInc/AnyNote/commit/78a302bbe0ece431655b9c9b3a45db8f0d036391)), closes [#7](https://github.com/AnyNoteInc/AnyNote/issues/7)
* **sonar:** reliability bug, ergonomic cleanup in kanban/editor ([3aabdf7](https://github.com/AnyNoteInc/AnyNote/commit/3aabdf789b88cb9fa57dc60fac77fc5c274e35f1))
* **trpc:** sprint.complete validates source sprint belongs to page ([a63fa0c](https://github.com/AnyNoteInc/AnyNote/commit/a63fa0cac824df590eacf6c76db4765354462606))


### Features

* **db:** add kanban schema (columns, tasks, sprints, labels, activity) ([176a27d](https://github.com/AnyNoteInc/AnyNote/commit/176a27d2e784cf53d4bf1fcd1b5a38167e6b5192))
* **kanban:** board UI with DnD, task detail modal, realtime hook ([234ab29](https://github.com/AnyNoteInc/AnyNote/commit/234ab2990f4230cce0b0028ba84e8e3607a32cc5))
* **kanban:** board.getBoard query with permission check ([5c47311](https://github.com/AnyNoteInc/AnyNote/commit/5c473117243aeb46967f0cf4394d60ee34ac6710))
* **kanban:** column router with task reassignment on delete ([bba3567](https://github.com/AnyNoteInc/AnyNote/commit/bba3567db5d7bcdc92b8db0cf8026573458a1697))
* **kanban:** default sprint filter to current when active sprint exists ([214c29e](https://github.com/AnyNoteInc/AnyNote/commit/214c29e44d64641b96037684d025ba086c51e91f))
* **kanban:** in-memory event bus for SSE fan-out ([4faa629](https://github.com/AnyNoteInc/AnyNote/commit/4faa62948c4b611ccb39a1c2dedb907e843d0b42))
* **kanban:** mount kanban router and seed defaults on page.create ([43ba4ad](https://github.com/AnyNoteInc/AnyNote/commit/43ba4ad4182db48f2c4ae98ac1b7ba3863c3ff38))
* **kanban:** P2 — sprints, table view, filters, view switcher ([52ecbb6](https://github.com/AnyNoteInc/AnyNote/commit/52ecbb61d23eec8a9256eb78586f38e38bbd84da))
* **kanban:** P3 — Gantt view, settings dialog, sortable lists ([9598ce5](https://github.com/AnyNoteInc/AnyNote/commit/9598ce5d6a0f77756449a7e8e38d5f4d1d9ffe8d))
* **kanban:** P4 — comments, activity log UI, archive, parent picker ([4445900](https://github.com/AnyNoteInc/AnyNote/commit/44459006b357bec1b9e35b27299b67f212f8a1b3))
* **kanban:** pluralize-ru helper with Russian plural form rules ([9c8ef86](https://github.com/AnyNoteInc/AnyNote/commit/9c8ef860a0d7ebdfbea546a5b94609eed756d642))
* **kanban:** polish pass — header, view switcher, card menu, DatePicker, save fixes ([4ac0e3b](https://github.com/AnyNoteInc/AnyNote/commit/4ac0e3b1a6f2fd6c509eea99bec8df284e3e34e5)), closes [#1](https://github.com/AnyNoteInc/AnyNote/issues/1) [#2](https://github.com/AnyNoteInc/AnyNote/issues/2) [#3](https://github.com/AnyNoteInc/AnyNote/issues/3) [#5](https://github.com/AnyNoteInc/AnyNote/issues/5) [#6](https://github.com/AnyNoteInc/AnyNote/issues/6) [#7](https://github.com/AnyNoteInc/AnyNote/issues/7) [#8](https://github.com/AnyNoteInc/AnyNote/issues/8) [#9](https://github.com/AnyNoteInc/AnyNote/issues/9) [#14](https://github.com/AnyNoteInc/AnyNote/issues/14) [#15](https://github.com/AnyNoteInc/AnyNote/issues/15) [#11](https://github.com/AnyNoteInc/AnyNote/issues/11) [#10](https://github.com/AnyNoteInc/AnyNote/issues/10) [#12](https://github.com/AnyNoteInc/AnyNote/issues/12)
* **kanban:** position math, default-seed, and activity-log helpers ([dc1e8d4](https://github.com/AnyNoteInc/AnyNote/commit/dc1e8d411058548f33e71a5b70e9f845df2e9748))
* **kanban:** sprint complete dialog with destination picker ([88bd2ea](https://github.com/AnyNoteInc/AnyNote/commit/88bd2eab43c73afe68e4fbe061c706c797339076))
* **kanban:** sprint delete confirm dialog ([c0d5bff](https://github.com/AnyNoteInc/AnyNote/commit/c0d5bff59429527f7b9594e89e52e7fd40eb5bd8))
* **kanban:** sprint edit dialog ([30c0860](https://github.com/AnyNoteInc/AnyNote/commit/30c0860aee4f54ba5a8af17d5d186abfc4d6b7e7))
* **kanban:** sprint section header with dates, status badge, accent, menu ([e77fe9f](https://github.com/AnyNoteInc/AnyNote/commit/e77fe9f82462d82213e122242eb1de73b3601d23))
* **kanban:** sprint status label/color helpers ([bda0d38](https://github.com/AnyNoteInc/AnyNote/commit/bda0d389075ab680144f7f24276202f76f1a66f3))
* **kanban:** sprint three-dot menu with start/complete/edit/delete ([5eb7d83](https://github.com/AnyNoteInc/AnyNote/commit/5eb7d83396d1121f91777fa6bc2fa1ab4f15f600))
* **kanban:** task attachments via existing /api/files upload ([50cf209](https://github.com/AnyNoteInc/AnyNote/commit/50cf20989c32916ae119f6d0426dff017c3d06e4))
* **kanban:** task modal redesign, column menu, gantt UX polish ([61ffa8a](https://github.com/AnyNoteInc/AnyNote/commit/61ffa8a3b5b49f4e9475931a84d2ca6a8d84b280))
* **kanban:** task router (create/update/move/assignees/labels/softDelete) ([eccc881](https://github.com/AnyNoteInc/AnyNote/commit/eccc8814b3b7ff77ba44c5c3b25348752b5b5422))
* **kanban:** type/priority/label routers + shared color palette ([c025af7](https://github.com/AnyNoteInc/AnyNote/commit/c025af7cdb3069119df07cd5681ae2c7771a4e5b))
* **trpc:** sprint.complete accepts moveUndoneTo destination ([475783e](https://github.com/AnyNoteInc/AnyNote/commit/475783e16c35196de4439bf568c94d7e3e1b612b))
* **ui:** export PlayArrow and Flag icons for sprint menu ([be33e74](https://github.com/AnyNoteInc/AnyNote/commit/be33e7437116576836e1cd50058b06fa84b316ae))

# [1.17.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.16.0...v1.17.0) (2026-05-14)


### Bug Fixes

* **seo:** await dynamic params in legal doc opengraph-image ([3899549](https://github.com/AnyNoteInc/AnyNote/commit/3899549f10fe65d238cd1fcaa9685b5453b11e4c))
* **seo:** default ogImage to file-convention path + relax canonical regex ([6383a41](https://github.com/AnyNoteInc/AnyNote/commit/6383a41b33120b6c9f8aa2bf6d72ba30c90005f4))
* **seo:** use nodejs runtime for legal doc opengraph-image ([f03ce74](https://github.com/AnyNoteInc/AnyNote/commit/f03ce74e47447629abaac4ec577b44f8ea80a97e))


### Features

* **seo:** add BreadcrumbList JSON-LD schema ([ea982ba](https://github.com/AnyNoteInc/AnyNote/commit/ea982ba7676e2a315ea66deede2e3f5db8ee3e5f))
* **seo:** add buildMetadata factory with canonical, OG, robots ([1e8a2e1](https://github.com/AnyNoteInc/AnyNote/commit/1e8a2e1b1194c06a83cbda71b300b1fad3b32448))
* **seo:** add default Open Graph image with brand gradient + tagline ([255786b](https://github.com/AnyNoteInc/AnyNote/commit/255786bc0f1ff249ec18909dc8ecccdd38ca730a))
* **seo:** add dynamic OG image for legal document pages ([47ff6c5](https://github.com/AnyNoteInc/AnyNote/commit/47ff6c54426e2fc7f0da16bfbc941487a8d56460))
* **seo:** add FAQPage JSON-LD schema stub ([69d161c](https://github.com/AnyNoteInc/AnyNote/commit/69d161ccb660eec423772e2c3db1d33ab001ccd1))
* **seo:** add JsonLd server component with </script> escaping ([29148d2](https://github.com/AnyNoteInc/AnyNote/commit/29148d2eb5fa7af0532e4cf84853a5d1fe68b9c7))
* **seo:** add Organization JSON-LD schema ([0e74440](https://github.com/AnyNoteInc/AnyNote/commit/0e7444040e7aa5e9c8d9cbdbd2fd752274ad1d43))
* **seo:** add per-page OG image for /pricing ([c5e409c](https://github.com/AnyNoteInc/AnyNote/commit/c5e409cae1e65fd229b1a00755f9aaf8efe6610e))
* **seo:** add Product/Offer JSON-LD schema for pricing ([e58e022](https://github.com/AnyNoteInc/AnyNote/commit/e58e022005f6957de4df0c2fd9dd094f377ff2d6))
* **seo:** add robots.ts with default allowlist + SEO_NOINDEX_ALL kill-switch ([37e277d](https://github.com/AnyNoteInc/AnyNote/commit/37e277d159c7a3e040b576a07b515d84569359ba))
* **seo:** add site-config constants for canonical url, brand, locale ([8fe1fd6](https://github.com/AnyNoteInc/AnyNote/commit/8fe1fd6091cd6c9129ea0c089a3f5850af1ca5e3))
* **seo:** add sitemap.ts driven by legalDocuments with version-based lastModified ([0bef109](https://github.com/AnyNoteInc/AnyNote/commit/0bef1095685d90426e1d88b4304aec65ed8d4798))
* **seo:** add SoftwareApplication JSON-LD schema ([b38df27](https://github.com/AnyNoteInc/AnyNote/commit/b38df27dd4822e23019e1440c438f7c526cab6d8))
* **seo:** add WebSite JSON-LD schema with SearchAction ([4681f85](https://github.com/AnyNoteInc/AnyNote/commit/4681f85bc9ef3b86ee360b9e29a09d3e5a21c463))
* **seo:** home page uses buildMetadata + Organization/WebSite/SoftwareApplication JSON-LD ([b479382](https://github.com/AnyNoteInc/AnyNote/commit/b479382aa5ee895509e83e6e346883aca1483294))
* **seo:** legal doc page uses buildMetadata + BreadcrumbList JSON-LD ([ef8be7c](https://github.com/AnyNoteInc/AnyNote/commit/ef8be7c9ee147cbdfe33be1bbdfa218eed272d16))
* **seo:** noindex robots meta on (auth) and (protected) layouts ([6fc8c4d](https://github.com/AnyNoteInc/AnyNote/commit/6fc8c4d49031384c6bc741d4e13d7f777e118777))
* **seo:** pricing page uses buildMetadata + Product/Offer JSON-LD from DB plans ([0bac4d5](https://github.com/AnyNoteInc/AnyNote/commit/0bac4d54f7ae060ff2a9e890c3abc25a8a994809))
* **seo:** terms list page uses buildMetadata ([6ac7bff](https://github.com/AnyNoteInc/AnyNote/commit/6ac7bffcfaff31f1ed4fbad489bc61daae9225cf))
* **seo:** wire metadataBase, title.template, and webmaster verification in root layout ([d1ec2af](https://github.com/AnyNoteInc/AnyNote/commit/d1ec2affc5f5c3d2c85da34b0c07056461a5a423))

# [1.16.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.15.4...v1.16.0) (2026-05-14)


### Features

* **genogram:** notes, predecessor/partner roles, layout fixes for cross-subtree placements ([1cb0d35](https://github.com/AnyNoteInc/AnyNote/commit/1cb0d35d2ef78b9baefb87b9fe709ac071044a15))

## [1.15.4](https://github.com/AnyNoteInc/AnyNote/compare/v1.15.3...v1.15.4) (2026-05-13)


### Bug Fixes

* **billing:** actively sync order status from YooKassa on return page so payments confirm without webhook ([526c073](https://github.com/AnyNoteInc/AnyNote/commit/526c07355e0772d2c43358db302fb8ed9ae95849))

## [1.15.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.15.2...v1.15.3) (2026-05-13)


### Bug Fixes

* **billing:** gate YooKassa save_payment_method behind env var and surface API error descriptions ([72b6774](https://github.com/AnyNoteInc/AnyNote/commit/72b67744bc6d448212a6f19f8f8a2594d4eeb5af))

## [1.15.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.15.1...v1.15.2) (2026-05-13)


### Bug Fixes

* update remainder fix ([22b3ac2](https://github.com/AnyNoteInc/AnyNote/commit/22b3ac2232138527dccab0d149091d993b196053))

## [1.15.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.15.0...v1.15.1) (2026-05-13)


### Bug Fixes

* **web:** replace stale favicon and brand icon art with orange rhombus ([9463fc9](https://github.com/AnyNoteInc/AnyNote/commit/9463fc9d799f33df48ec1559ece35272aec79913))

# [1.15.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.14.0...v1.15.0) (2026-05-13)


### Features

* **billing:** update Pro and Max plan pricing ([94fa00a](https://github.com/AnyNoteInc/AnyNote/commit/94fa00afb08b7333161ef02fe41133b1e1ae2413))

# [1.14.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.13.2...v1.14.0) (2026-05-13)


### Features

* **editor:** column layout with unlimited columns, resizable dividers, and task-list support ([#12](https://github.com/AnyNoteInc/AnyNote/issues/12)) ([4cb24de](https://github.com/AnyNoteInc/AnyNote/commit/4cb24de354b1d8496ae3d40d5d411623f4dfb35a))

## [1.13.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.13.1...v1.13.2) (2026-05-11)

### Bug Fixes

- reminder ([dbde8ea](https://github.com/AnyNoteInc/AnyNote/commit/dbde8eac3528e87a77efdd451a8e1b36732a1fda))

## [1.13.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.13.0...v1.13.1) (2026-05-11)

### Bug Fixes

- add delete all notifications ([4803ed4](https://github.com/AnyNoteInc/AnyNote/commit/4803ed4936e5ce81d75216538ed1233a45313485))
- notify poppover position ([4474fd1](https://github.com/AnyNoteInc/AnyNote/commit/4474fd1e9e8d8d5f1d11f35021afbae6ea25e76d))
- remove trash to bottom of left side ([f4e570e](https://github.com/AnyNoteInc/AnyNote/commit/f4e570ed6d750dd42819c7fd3ecad6b9956d5638))
- slash with reminder ([50fa166](https://github.com/AnyNoteInc/AnyNote/commit/50fa1666e93a3885ccaf402d3be7576c513da309))

# [1.13.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.12.1...v1.13.0) (2026-05-11)

### Features

- add page reminders ([#11](https://github.com/AnyNoteInc/AnyNote/issues/11)) ([9a5f8da](https://github.com/AnyNoteInc/AnyNote/commit/9a5f8da5890cbea3a976a7c3a0e1ce3a34a9ce28))

## [1.12.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.12.0...v1.12.1) (2026-05-11)

### Bug Fixes

- **editor:** align nested task checkboxes, kill full-width overflow, default TOC to mini ([66e30df](https://github.com/AnyNoteInc/AnyNote/commit/66e30df2365dddde3aca7b923b56fc3be531b8de))

# [1.12.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.11.1...v1.12.0) (2026-05-11)

### Features

- **web:** sidebar redesign — full/hidden modes, notifications bell, trash + ⌘, shortcuts ([#10](https://github.com/AnyNoteInc/AnyNote/issues/10)) ([8693af0](https://github.com/AnyNoteInc/AnyNote/commit/8693af0ef717ff7ce13efc2709651d7fcc2b4956))

## [1.11.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.11.0...v1.11.1) (2026-05-11)

### Bug Fixes

- **deploy:** wire VAPID env vars through to web push runtime ([fe4f712](https://github.com/AnyNoteInc/AnyNote/commit/fe4f71223c95e6c94b8a98a18f45237c99719ecd))

# [1.11.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.10.1...v1.11.0) (2026-05-11)

### Features

- notifications system (events, deliveries, in-app, email, web push) ([#9](https://github.com/AnyNoteInc/AnyNote/issues/9)) ([13cc85e](https://github.com/AnyNoteInc/AnyNote/commit/13cc85edbbd37b5a7b0efbdd3d98e24061638646))

## [1.10.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.10.0...v1.10.1) (2026-05-10)

### Bug Fixes

- **mail:** use 'personal' as sendsay transactional group id ([6eccc78](https://github.com/AnyNoteInc/AnyNote/commit/6eccc78bd32d35d622fd13748931bdd0b8333a3d))

# [1.10.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.9.0...v1.10.0) (2026-05-10)

### Features

- legal-grade user consent tracking ([#8](https://github.com/AnyNoteInc/AnyNote/issues/8)) ([c2cdadb](https://github.com/AnyNoteInc/AnyNote/commit/c2cdadb20ffdc27264f323d9c062b183af8118fd))

# [1.9.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.8.0...v1.9.0) (2026-05-09)

### Bug Fixes

- **mail:** swallow sendsay errors instead of throwing plain objects ([bf2e0df](https://github.com/AnyNoteInc/AnyNote/commit/bf2e0df7750e7057ee2bb8cf2333cf40e25d0d0b))

### Features

- **web:** redirect to /profile 3s after sign-up success ([ec4f2bc](https://github.com/AnyNoteInc/AnyNote/commit/ec4f2bc12dd2200fb25ee8e5c11cca3ddb328c3d))

# [1.8.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.7.1...v1.8.0) (2026-05-08)

### Features

- add navigation ([88c3c5f](https://github.com/AnyNoteInc/AnyNote/commit/88c3c5f5b9dcd5131789f460454ab9dfdcd347ac))

## [1.7.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.7.0...v1.7.1) (2026-05-08)

### Bug Fixes

- **engines:** drop stale packages/mail from Dockerfile package.json patch ([0f20b0f](https://github.com/AnyNoteInc/AnyNote/commit/0f20b0f30590d1d659a23ba295a8cbcc200a2804))

# [1.7.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.6.0...v1.7.0) (2026-05-08)

### Bug Fixes

- some issue ([d952fd5](https://github.com/AnyNoteInc/AnyNote/commit/d952fd5e0f4f1af76a3adfa4ba4dec50ae4330ad))

### Features

- add themes ([72f65ce](https://github.com/AnyNoteInc/AnyNote/commit/72f65ce1ccb17a3a2e2835eb2fcd09e0b038c33f))
- **mail:** migrate from SMTP/outbox to SendSay synchronous send ([#7](https://github.com/AnyNoteInc/AnyNote/issues/7)) ([2eee485](https://github.com/AnyNoteInc/AnyNote/commit/2eee48534f7788d88167f4ada4764edb6e77cda1))

# [1.6.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.5.0...v1.6.0) (2026-05-07)

### Features

- **deploy:** add gotenberg sidecar for server-side PDF export ([ab0a27c](https://github.com/AnyNoteInc/AnyNote/commit/ab0a27c0d53025a58ed6a3e319d0644c8ba87362))

# [1.5.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.4.0...v1.5.0) (2026-05-07)

### Features

- server-side page export (PDF/HTML/Markdown) ([#6](https://github.com/AnyNoteInc/AnyNote/issues/6)) ([58be901](https://github.com/AnyNoteInc/AnyNote/commit/58be901bd81dc6c9072e9a492425c98d79be36f3))

# [1.4.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.3.0...v1.4.0) (2026-05-06)

### Features

- **agents:** add page-search schemas ([5091b97](https://github.com/AnyNoteInc/AnyNote/commit/5091b971dfec6e7d18d20589ebfc262e9ceade59))
- **agents:** expose /v1/search endpoint over RagRetrievalService ([91ce4f1](https://github.com/AnyNoteInc/AnyNote/commit/91ce4f15785f1debc3a440568f5776a1faf48adb))
- **db:** add Page.searchVector and SearchHistory model ([c15b593](https://github.com/AnyNoteInc/AnyNote/commit/c15b59304113b3ff1c58310379e7825a34c37997))
- **trpc:** add search router with parallel PG/Qdrant + history procs ([74c7384](https://github.com/AnyNoteInc/AnyNote/commit/74c7384011af1b7a6856f62d38d686866a4eeed4))
- **ui:** export LinearProgress, InputBase, CircularProgress, HistoryIcon, CloseIcon ([56b32b3](https://github.com/AnyNoteInc/AnyNote/commit/56b32b3b7d00a0d91d38b63a8cfb2bd7e2353791))
- **web:** add workspace search dialog with Cmd/Alt+K hotkey and sidebar entry ([105d392](https://github.com/AnyNoteInc/AnyNote/commit/105d392fbdb3b7475579238bd6c3f7eb84a7e14b)), closes [#blockNumber](https://github.com/AnyNoteInc/AnyNote/issues/blockNumber)

# [1.3.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.2.0...v1.3.0) (2026-05-06)

### Bug Fixes

- **auth:** move /sign-out out of (auth) route group ([3f3183d](https://github.com/AnyNoteInc/AnyNote/commit/3f3183d6146e20494a96c015a197932889faad8c))

### Features

- **home:** require privacy consent before submitting contact form ([6fc671d](https://github.com/AnyNoteInc/AnyNote/commit/6fc671dba409d1e120dfe072bb4ada1ff8b126e1))

# [1.2.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.6...v1.2.0) (2026-05-05)

### Features

- **mail:** send verification, reset, and resend emails synchronously ([#4](https://github.com/AnyNoteInc/AnyNote/issues/4)) ([ff83068](https://github.com/AnyNoteInc/AnyNote/commit/ff830685a8e94b1c0c8ca15f05337ffd6a87a8a3))

## [1.1.6](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.5...v1.1.6) (2026-05-05)

### Bug Fixes

- **excalidraw:** pass loaded elements via initialData to prevent binding-startup wipe ([f5bac98](https://github.com/AnyNoteInc/AnyNote/commit/f5bac9831da80b778742447756b012dc853ea7f9))

## [1.1.5](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.4...v1.1.5) (2026-05-05)

### Bug Fixes

- **auth:** set audience on better-auth jwt plugin so yjs verifyJwt accepts the token ([56cc14d](https://github.com/AnyNoteInc/AnyNote/commit/56cc14d236ce76449863325b43395459e1b8a8ae))

## [1.1.4](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.3...v1.1.4) (2026-05-04)

### Bug Fixes

- **web:** derive yjs ws URL from window.location on HTTPS pages ([f15dd9c](https://github.com/AnyNoteInc/AnyNote/commit/f15dd9c110c74a1eaaad18abdcfef606d8c383fb))

## [1.1.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.2...v1.1.3) (2026-05-04)

### Bug Fixes

- google auth ([522ff06](https://github.com/AnyNoteInc/AnyNote/commit/522ff06fcf9d2e7498331d4c6a8096a733bcba54))

## [1.1.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.1...v1.1.2) (2026-05-04)

### Bug Fixes

- capcha and google auth ([fa2a281](https://github.com/AnyNoteInc/AnyNote/commit/fa2a281c70dbc814d15ecba3750bc7659d709a22))

## [1.1.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.1.0...v1.1.1) (2026-05-04)

### Bug Fixes

- **web:** include docs/terms in docker build context ([7f8c770](https://github.com/AnyNoteInc/AnyNote/commit/7f8c770540d0f8a6e31ec16ed72f629ee8f9f649))

# [1.1.0](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.9...v1.1.0) (2026-05-04)

### Bug Fixes

- **ci:** unblock sign-up test + sonarcloud quality gate ([2e7e569](https://github.com/AnyNoteInc/AnyNote/commit/2e7e5690cf005ad927ffe6f15228e1f27d658f9d))

### Features

- **terms:** legal documents pages, footer revamp, ts extension migration ([0b805f4](https://github.com/AnyNoteInc/AnyNote/commit/0b805f4c6bdbda3319ae92af3247b2355e7def62))

## [1.0.9](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.8...v1.0.9) (2026-05-04)

### Bug Fixes

- **deploy:** set ENVIRONMENT=prod for agents (pydantic Literal['dev','test','prod']) ([88dd85e](https://github.com/AnyNoteInc/AnyNote/commit/88dd85efdfe336cc247e9c892fae8b7ac1f0f3d6))

## [1.0.8](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.7...v1.0.8) (2026-05-04)

### Bug Fixes

- **ci:** force-restart traefik after deploy to pick up traefik.yml changes ([345b76a](https://github.com/AnyNoteInc/AnyNote/commit/345b76a154899d831600b03e4e419b8bfe9ad9f1))
- **deploy:** route traefik docker provider through socket-proxy sidecar ([2ef839a](https://github.com/AnyNoteInc/AnyNote/commit/2ef839a31f202b363391619ede2ff978c8dd2103))
- **deploy:** set traefik docker endpoint in traefik.yml (env override didn't apply) ([5233b2c](https://github.com/AnyNoteInc/AnyNote/commit/5233b2cd6e7541a157f685450ee1e4ae2d056f7a))
- **deploy:** switch traefik routing to file provider, drop docker provider ([9c482e6](https://github.com/AnyNoteInc/AnyNote/commit/9c482e643a6e53d7bca1b71c0c6d6eb718f3948e))

## [1.0.7](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.6...v1.0.7) (2026-05-04)

### Bug Fixes

- **deploy:** force traefik docker client API version to 1.45 ([f45f15a](https://github.com/AnyNoteInc/AnyNote/commit/f45f15aed75548838e94078bdbad2602e633b4a7))

## [1.0.6](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.5...v1.0.6) (2026-05-04)

### Bug Fixes

- **deploy:** point migrate PATH to packages/db/node_modules/.bin ([6a40651](https://github.com/AnyNoteInc/AnyNote/commit/6a40651d98c1e5fd4a1c02ab6db69aa1bea20012))

## [1.0.5](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.4...v1.0.5) (2026-05-03)

### Bug Fixes

- **ci:** show container logs when deploy fails — surface migrate exit code source ([7bdaef2](https://github.com/AnyNoteInc/AnyNote/commit/7bdaef2d8df3a30b8cee5003312fb8ee5f5e5d76))

## [1.0.4](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.3...v1.0.4) (2026-05-03)

### Bug Fixes

- **deploy:** add diagnostic preamble to migrate command for debugging exit 127 ([596123a](https://github.com/AnyNoteInc/AnyNote/commit/596123a11194f5db61e6538f818cef9e3bcd5ee1))

## [1.0.3](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.2...v1.0.3) (2026-05-03)

### Bug Fixes

- **packages:** add 'default' fallback condition + reorder exports for webpack ([7b3d452](https://github.com/AnyNoteInc/AnyNote/commit/7b3d4521ecf876311df6770399a78c7c892ca03d))

## [1.0.2](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.1...v1.0.2) (2026-05-03)

### Bug Fixes

- **web:** switch production build to webpack so transpilePackages resolves .js→.ts ([e852cce](https://github.com/AnyNoteInc/AnyNote/commit/e852cce417d870c0ce7e23223135fc251c017f79))

## [1.0.1](https://github.com/AnyNoteInc/AnyNote/compare/v1.0.0...v1.0.1) (2026-05-03)

### Bug Fixes

- **ci:** add workflow_dispatch to deploy.yml ([9192141](https://github.com/AnyNoteInc/AnyNote/commit/91921411709a9111acafdc93e80109db5c9d7b12))
- **web:** teach webpack to resolve .js → .ts in transpilePackages ([b4063bc](https://github.com/AnyNoteInc/AnyNote/commit/b4063bcce71b664a2be51c262d7c76c3ce71f411))

# 1.0.0 (2026-05-03)

### Bug Fixes

- 10 sidebar UI improvements ([853a10d](https://github.com/AnyNoteInc/AnyNote/commit/853a10d2163ae9d618308ac5168003e50114afd7))
- 5 UI bugs — theme.alpha, popper suppression, button variants, trash color, favorites children ([86af8a5](https://github.com/AnyNoteInc/AnyNote/commit/86af8a5a47f5a91f642c591290f75e5d7cfdadce))
- add client-side page query, consistent PageItem types, Russian localization ([570567c](https://github.com/AnyNoteInc/AnyNote/commit/570567cd4a5ceb4d658d2a2ff25208043611e43a))
- address 10 bugs — collapse/expand, favorites, rename, trash, workspace settings ([a316090](https://github.com/AnyNoteInc/AnyNote/commit/a316090c0180e1dd0ae5d27649f35dbf05c95660))
- **agents:** add ENVIRONMENT to pytest.ini env block ([7783e6b](https://github.com/AnyNoteInc/AnyNote/commit/7783e6bbf7b448a61d27ea4b148f47148496eed0))
- **agents:** add type annotations to settings validators + test helpers ([f9535e6](https://github.com/AnyNoteInc/AnyNote/commit/f9535e687d325f73d2c3a8527be96acbb741e56d))
- **agents:** adjust providererror signature for task2 compliance ([b3cdd15](https://github.com/AnyNoteInc/AnyNote/commit/b3cdd1573246a38ee94e7dccc50a108fe0a8927e))
- **agents:** adjust providererror signature for task2 compliance ([d91aefc](https://github.com/AnyNoteInc/AnyNote/commit/d91aefc621c7f2aea5f3cdd02a1f27d5bdb08300))
- **agents:** align chat schemas and errors with task2 spec ([012c70c](https://github.com/AnyNoteInc/AnyNote/commit/012c70c61cf96aba18cd889dfa69fb362cd2db74))
- **agents:** align chat schemas and errors with task2 spec ([a42ce78](https://github.com/AnyNoteInc/AnyNote/commit/a42ce787f53066debd05d75b913ab301da85d83a))
- **agents:** fail-soft when Qdrant is unavailable on boot (I6) ([cb8741c](https://github.com/AnyNoteInc/AnyNote/commit/cb8741c83c7173fcf81c961fa55b39ca96f72e2c))
- **agents:** finalize alembic env wiring ([c72202d](https://github.com/AnyNoteInc/AnyNote/commit/c72202d30137a67d5dd32eecfb6270672a0f13c6))
- **agents:** handle legacy agent exceptions in bootstrap ([bcbb893](https://github.com/AnyNoteInc/AnyNote/commit/bcbb8936dd2f33599de7421705555fcedd828110))
- **agents:** harden fast-clean bootstrap hooks and py constraints ([51b9290](https://github.com/AnyNoteInc/AnyNote/commit/51b9290e258178cc3e45b5ce4d4fac80de21fe14))
- **agents:** harden task8 script guards and typed marker ([841b3b2](https://github.com/AnyNoteInc/AnyNote/commit/841b3b267bc075cc8763b7fb1ae0e15ca917524f))
- **agents:** import BearerTokenAuthSchema from schemas, fix mock type in test (C3) ([7709764](https://github.com/AnyNoteInc/AnyNote/commit/7709764522f7cb0b9913ddc02674ab26349ad1cb))
- **agents:** make default prompt template compatible with both renderers ([12da689](https://github.com/AnyNoteInc/AnyNote/commit/12da6896bb893f6d0ebfca6fd77e5fdbf9925f40))
- **agents:** make default prompt template compatible with both renderers ([5353ef5](https://github.com/AnyNoteInc/AnyNote/commit/5353ef5f164e157697c27a7f6eec7bbfaba38cae))
- **agents:** override host as optional in Qdrant/Ollama settings schemas ([af6be81](https://github.com/AnyNoteInc/AnyNote/commit/af6be81fecc374cb3264eb5bbebbd8d4b7ee1ae0))
- **agents:** pillar B1 review fixes — Dockerfile/Makefile factory, /health DB ping, auth via Dishka ([dc3a6f9](https://github.com/AnyNoteInc/AnyNote/commit/dc3a6f944fca7a73357318f11d2fabcbe1e25fc2))
- **agents:** RagDocumentSchema accepts both snake_case and camelCase kwargs (C4) ([8556235](https://github.com/AnyNoteInc/AnyNote/commit/8556235b91d20d2f30dc9b92582b68f157de01b8))
- **agents:** remove debug print of system_prompt in prepare_prompt (M4) ([0883681](https://github.com/AnyNoteInc/AnyNote/commit/08836815fd1e3bd709b66324018e31421f95a9b7))
- **agents:** retrieval works with AsyncQdrantClient + wire collection_name from settings ([f0615cf](https://github.com/AnyNoteInc/AnyNote/commit/f0615cfb417d8a7297972e092d344f48a2239b97))
- **agents:** satisfy chat lint ([ba3118a](https://github.com/AnyNoteInc/AnyNote/commit/ba3118a34bd0013ff13dea7aee0c601792519ee0))
- **agents:** typo prodiver → provider in ChatProvider instance (M1) ([9129e49](https://github.com/AnyNoteInc/AnyNote/commit/9129e4978e47f0157107ba8d00274684066f096a))
- **agents:** use bearer_token attribute in VectorsProvider ([336ff14](https://github.com/AnyNoteInc/AnyNote/commit/336ff14e0b805a5c11e5320a62b86f08d4d7821b))
- align workspace chat ui with x-chat requirements ([e8964c2](https://github.com/AnyNoteInc/AnyNote/commit/e8964c2419973694092ad3e0b781f6f12027886a))
- **auth:** show reset token failures consistently ([9022a92](https://github.com/AnyNoteInc/AnyNote/commit/9022a926c71b5373e681eb286dbd46cacfeac7e0))
- backfill chat message updated_at ([bf6fc0a](https://github.com/AnyNoteInc/AnyNote/commit/bf6fc0aa19748572bb520409be3bd742c21ced66))
- chat ([11e2657](https://github.com/AnyNoteInc/AnyNote/commit/11e265737c28e4b96b3487cfd21541745ab17adf))
- chat ([c89ec44](https://github.com/AnyNoteInc/AnyNote/commit/c89ec44b65855eadb3c46896a77a3a54ee327e8f))
- **ci:** provide dummy DATABASE_URL for prisma generate in composite setup ([6373d8a](https://github.com/AnyNoteInc/AnyNote/commit/6373d8a5aa077a67d57f74042919b15ca932dd99))
- **compose:** drop qdrant healthcheck (image lacks wget/curl) ([6e8983a](https://github.com/AnyNoteInc/AnyNote/commit/6e8983a1b1283049a915c49f255ebccd0a82db72))
- conditionally render Popper to prevent ghost sidebar ([f00cc70](https://github.com/AnyNoteInc/AnyNote/commit/f00cc7003507477d6e7e1e018bd02c0e2c4a4c48))
- db ([e1e00ba](https://github.com/AnyNoteInc/AnyNote/commit/e1e00ba9a7a20fee7a47bf30037f3b45768b2dce))
- **db,trpc:** address pillar A review — conventions + stale title ([bad1837](https://github.com/AnyNoteInc/AnyNote/commit/bad1837264f87119fac5eaa86bb3723277ec4dfe))
- **db:** deactivate legacy plans during seed ([385ffe8](https://github.com/AnyNoteInc/AnyNote/commit/385ffe823b77384350b8cc0fcefe138a46479a0f))
- **db:** enforce one active subscription per user ([608cd67](https://github.com/AnyNoteInc/AnyNote/commit/608cd67d8c988c9e11854dec5988fe5077577df7))
- **db:** inline enqueueOutboxEvent into index.ts ([1120b9c](https://github.com/AnyNoteInc/AnyNote/commit/1120b9c9152857fe64847f55cfff5f0cd8b03361))
- **e2e,ui:** restore "Зарегистрироваться" button label and add signUp test helper ([d1df183](https://github.com/AnyNoteInc/AnyNote/commit/d1df18394887b0edb854072b078c0d60a2d97ac6))
- **e2e:** adjust signUpAndAuthAs for autoSignIn + match new submit button label ([23f6b85](https://github.com/AnyNoteInc/AnyNote/commit/23f6b85510499a674b22e76719c4e6db3d35febc))
- **e2e:** drop unused test.use({locale}) in rag-block-links (I7) ([1a27900](https://github.com/AnyNoteInc/AnyNote/commit/1a27900e4fbcf0310d781f5f11e868432e82ae3d))
- **e2e:** load QDRANT**AUTH**BEARER_TOKEN from root .env in rag E2E ([3fc4b21](https://github.com/AnyNoteInc/AnyNote/commit/3fc4b2161ff581a7a22ce6597b16224c1cd6d7fb)), closes [#1](https://github.com/AnyNoteInc/AnyNote/issues/1)
- **e2e:** make signUpAndAuthAs deterministic — clear cookies, sign in via UI ([9056494](https://github.com/AnyNoteInc/AnyNote/commit/90564946259d24dcf4bf82e85d8288801e1c0601))
- **editor,excalidraw:** switch to Bundler module resolution for Next.js ([1285f8b](https://github.com/AnyNoteInc/AnyNote/commit/1285f8b1885ebb1388ed3a8a8ae9a2603e259be8))
- **editor,excalidraw:** task checkbox, table icons, image inversion ([6dc37b1](https://github.com/AnyNoteInc/AnyNote/commit/6dc37b1e1f8cb74cfb908cb4cad37b28de3365a1))
- **editor:** address 10 review findings ([ab17efb](https://github.com/AnyNoteInc/AnyNote/commit/ab17efbe2188a55b0ffa8aeb4c51de01af5bb479))
- **editor:** block-flash via PM plugin state, survives PM rebuilds ([7c05847](https://github.com/AnyNoteInc/AnyNote/commit/7c05847aa5e8e89401453958c7683562d38001f0))
- **editor:** drag handle flicker + first-child target in container blocks ([5caf718](https://github.com/AnyNoteInc/AnyNote/commit/5caf71894e7ea37784fb880fccd1dda328ea2f9b))
- **editor:** four UX polish items ([2fa0fc1](https://github.com/AnyNoteInc/AnyNote/commit/2fa0fc143dee0c5f883df16eb81a8346c55e5e1c))
- **editor:** notion-like polish round — 8 UX issues ([86bdfcc](https://github.com/AnyNoteInc/AnyNote/commit/86bdfcca4bd88632208ed31ef21b334c77a6e7ba))
- **editor:** six UX regressions from review round 2 ([41bada2](https://github.com/AnyNoteInc/AnyNote/commit/41bada219775374298cd3eb84905513116fe3d45)), closes [#ffffff](https://github.com/AnyNoteInc/AnyNote/issues/ffffff)
- **editor:** task checkbox polish, slash menu tweaks, restore horizontal scroll ([5cffc4b](https://github.com/AnyNoteInc/AnyNote/commit/5cffc4b0cdb56858e031e1ec08dc74ab3e7846c1))
- **editor:** visible color swatches + cross-page block move ([c654839](https://github.com/AnyNoteInc/AnyNote/commit/c6548394f2da22dcaa1949a143ce8b5e74081bb8))
- **engines/indexer:** ensure Qdrant collection on app bootstrap ([1e9408b](https://github.com/AnyNoteInc/AnyNote/commit/1e9408b461e4fc048186e4bcbbc5b0ae07453f3b))
- **engines/indexer:** narrow mock return types in outbox cron spec for tsc ([7162a93](https://github.com/AnyNoteInc/AnyNote/commit/7162a932f858745338eafe3c6f778079b8f5e0d9))
- **engines/mcp:** relink sibling links in movePage ([1bdc928](https://github.com/AnyNoteInc/AnyNote/commit/1bdc92836af9cd88ec6044016c3c42419d3829a0))
- **engines/mcp:** validate parentId workspace ownership ([3f940d0](https://github.com/AnyNoteInc/AnyNote/commit/3f940d0d9cf04dc8beabc5584f6262d3c140010e))
- **engines:** catch unhandled rejections in MailDispatchCron tick() ([c243625](https://github.com/AnyNoteInc/AnyNote/commit/c243625734b93a24f91449e6191c9acd053bcf1a))
- **engines:** enable shutdown hooks and surface bootstrap errors ([1eb0645](https://github.com/AnyNoteInc/AnyNote/commit/1eb064513dd9352f82943a35a93e654164d8266a))
- **excalidraw:** sync canvas background with MUI theme ([c0f823d](https://github.com/AnyNoteInc/AnyNote/commit/c0f823dc45a68c8bdfd143a8b0a9201a37a7e0d1))
- **genogram:** add RU.months namespace; format-date imports from it; cover declension edge cases ([37ba04a](https://github.com/AnyNoteInc/AnyNote/commit/37ba04ae65d1b7aab4b187a0797d0d40e77159cd))
- **genogram:** addChildren throws on missing union; assert size=small ([cab2658](https://github.com/AnyNoteInc/AnyNote/commit/cab2658f456046f7722f817432e50aaafa8f7790))
- **genogram:** CustodySide values become 'male'|'female' (spec); add PartialDate doc comments ([e8fde62](https://github.com/AnyNoteInc/AnyNote/commit/e8fde627b9239fcbcb6da4cd5a8c8c54891e2b8d))
- **genogram:** isoToPartial uses UTC accessors and is exported ([b1c19e0](https://github.com/AnyNoteInc/AnyNote/commit/b1c19e076ad0fa095743fe0b069d22ded53cf239))
- **genogram:** multi-partner layout — base in middle, place children, anchor at base↔partner midpoint ([56a4f1b](https://github.com/AnyNoteInc/AnyNote/commit/56a4f1bdee905f19e18dc85d5f25571ad1268ced))
- **genogram:** PartialDateInput rejects NaN; numeric inputMode for mobile ([10d6ffb](https://github.com/AnyNoteInc/AnyNote/commit/10d6ffb036090beb2c8ef3d5bd472dfcb51aff4f))
- **genogram:** setPartnerOrder bounds check + safe lookup + no-op skip ([eeef4f0](https://github.com/AnyNoteInc/AnyNote/commit/eeef4f0f76ff15108a70ec370abcff9819b8a164))
- **genogram:** trim createDefaultParent redundant defaults; UnionDivorceSchema includes markPosition ([2d7d3b6](https://github.com/AnyNoteInc/AnyNote/commit/2d7d3b6d34f7724d1d5fa133969991b1290e014b))
- hide collapse button in popper sidebar variant ([d856ad7](https://github.com/AnyNoteInc/AnyNote/commit/d856ad720d5c054667a3427fb07738188dfc4dae))
- **indexer:** wire health_router into api_router ([430f8b0](https://github.com/AnyNoteInc/AnyNote/commit/430f8b011555aee3f1b907032f4250018b9f71c7))
- indexing ([ef8a91f](https://github.com/AnyNoteInc/AnyNote/commit/ef8a91f1260190804e2af5a6ca739d2498d365b2))
- indexing ([27ca384](https://github.com/AnyNoteInc/AnyNote/commit/27ca384d695734fd4bf2cd9e8349fe90c3344136))
- **landing:** align pricing cards with plan copy ([9ada2cf](https://github.com/AnyNoteInc/AnyNote/commit/9ada2cf909b03c31e087a41c0d9bcc48741b9aad))
- linked-list unique constraint, favorites unmount, move dialog UX ([0034747](https://github.com/AnyNoteInc/AnyNote/commit/00347474ce35e4d1f63bc70d253d80a4abc29e29))
- **mail:** mask token URLs in dispatchPending error log ([ab28cea](https://github.com/AnyNoteInc/AnyNote/commit/ab28ceae6eae92b35f68aabb49a2dd4ea12197b3))
- **mail:** tighten dispatch — guard MAIL_FROM up-front, drop test helper from public API ([3bd3aa0](https://github.com/AnyNoteInc/AnyNote/commit/3bd3aa0373d3799fd5cde70dfc8a9ce0f0d642df))
- **mail:** treat empty-string userId as missing in enqueueMailEvent ([0793fcd](https://github.com/AnyNoteInc/AnyNote/commit/0793fcdae41883a342fc82c0c72f3c11f226c35f))
- migrations ([a1bd70b](https://github.com/AnyNoteInc/AnyNote/commit/a1bd70bd71bb98f3a0c389fb2ee30d975e6d49d0))
- move trash delete icon to right, fix hydration conditional render ([6f9bf01](https://github.com/AnyNoteInc/AnyNote/commit/6f9bf018d1889f5d50a56b1eb66f88d8582006c1))
- orphan-blob cleanup, avatar tx, getById privacy ([e52bbad](https://github.com/AnyNoteInc/AnyNote/commit/e52bbad3d7b0f88624278ab47f2da3411525ee12))
- persist + sync collab editors, tighten page layout ([3f1a4a7](https://github.com/AnyNoteInc/AnyNote/commit/3f1a4a7057eaf8c44d7845709f02b8e931f84e4a)), closes [#3](https://github.com/AnyNoteInc/AnyNote/issues/3) [#4](https://github.com/AnyNoteInc/AnyNote/issues/4) [#6](https://github.com/AnyNoteInc/AnyNote/issues/6)
- post-verification adjustments for workspace and settings ([0e04548](https://github.com/AnyNoteInc/AnyNote/commit/0e04548956af1efc38991bfc9054eb1477a25bed))
- **public:** augment vitest Assertion with jest-dom matchers ([de386d4](https://github.com/AnyNoteInc/AnyNote/commit/de386d4568b43d35468b4f07e1b549bee1956c90))
- **public:** prevent horizontal scroll and equalize pricing tile heights ([9aeb989](https://github.com/AnyNoteInc/AnyNote/commit/9aeb989cefef18713b4ff019b806448e1fd17340))
- **public:** remove no-op prefers-reduced-motion rule from Origami ([516a729](https://github.com/AnyNoteInc/AnyNote/commit/516a729adb7fca719161406561cf8c18d889b4dd))
- **public:** use Latin domain in placeholder publicContact email ([08d62ee](https://github.com/AnyNoteInc/AnyNote/commit/08d62ee18a2de8583b11550326598386dd74a5b7))
- remove checks ([dd4c602](https://github.com/AnyNoteInc/AnyNote/commit/dd4c602b4304db6df4d974eaeccf25a176ed19de))
- remove old spec ([9023d0f](https://github.com/AnyNoteInc/AnyNote/commit/9023d0fd9b5c0ae8676533e7b402ff3b76e0a9fc))
- restore agents baseline type checks ([460c7d9](https://github.com/AnyNoteInc/AnyNote/commit/460c7d9fa3e0e03a888e422757f42a5daa2a577d))
- run gates phases sequentially ([45ec0cd](https://github.com/AnyNoteInc/AnyNote/commit/45ec0cd59813f88d03756f9e989728d5435a5aa0))
- stream gigachat tokens end-to-end ([c1db74a](https://github.com/AnyNoteInc/AnyNote/commit/c1db74add75763cbed1c3dbfbbb7abf1f99c64d4))
- suppress popper on sidebar hide transition ([4768195](https://github.com/AnyNoteInc/AnyNote/commit/4768195aabe6c5298cb34bb9b28019e6ce4c14a0))
- tests ([e90e767](https://github.com/AnyNoteInc/AnyNote/commit/e90e767abe42c01e282985d7d79e044a41e182a2))
- **trpc,web:** break TS2589 type depth in page router + page-header ([d41691d](https://github.com/AnyNoteInc/AnyNote/commit/d41691d03a91fc84a75bacde1e41c11d47dd30e6))
- **trpc:** attachToPage enforces workspace match ([9b51ee8](https://github.com/AnyNoteInc/AnyNote/commit/9b51ee89a47e886dfb3d42f128db66b0f4c1946c))
- **trpc:** do not leak session token via user.listSessions ([bd05fce](https://github.com/AnyNoteInc/AnyNote/commit/bd05fcedab561a98ca6da7e14fef817bccd25d86))
- **trpc:** drop unused Page type import after page.getById return-shape change ([6d91a6b](https://github.com/AnyNoteInc/AnyNote/commit/6d91a6b34f1295c8e0e1998537c828d90641ddbc))
- **trpc:** guard favorite writes on soft downgrade ([1932619](https://github.com/AnyNoteInc/AnyNote/commit/1932619edd1d5b44e86a506226fea71fcd559046))
- **trpc:** include Page.ownership in getById select ([0ecb0e9](https://github.com/AnyNoteInc/AnyNote/commit/0ecb0e9e962849cf4221e560d01c164998489ebe))
- **trpc:** page.duplicate preserves type and text content ([fe01f28](https://github.com/AnyNoteInc/AnyNote/commit/fe01f2806e09cc4a5e7d38d799c595ee1d8b112a))
- **ui:** show loading phrases inline in status row, hide bubble ([f449453](https://github.com/AnyNoteInc/AnyNote/commit/f449453ea675e050ceae7ce9024076dd60d0235d))
- **web:** allow workspace collaborators to download page attachments ([0e21f5e](https://github.com/AnyNoteInc/AnyNote/commit/0e21f5ebe058b3ee233d8b9af8d693e53930ff1e))
- **web:** destroy source stream on download error ([f35b725](https://github.com/AnyNoteInc/AnyNote/commit/f35b725fefcf6e3a49e98d55b9866c31a7fdaf60))
- **web:** drop searchRagDocuments mock from generate route test (C2) ([7bf74ae](https://github.com/AnyNoteInc/AnyNote/commit/7bf74ae028feb7ccc3d538d20a65581c8d823e43))
- **web:** drop unused upstreamPayload after C2 mock cleanup ([76e33d2](https://github.com/AnyNoteInc/AnyNote/commit/76e33d22098be8437b687cdf3edd347617df020d))
- **web:** handle P2002 race in upload route ([d941730](https://github.com/AnyNoteInc/AnyNote/commit/d941730825f9ecd9535020bd242fbf0912c739c3))
- **web:** make file name a download link in workspace files list ([c343348](https://github.com/AnyNoteInc/AnyNote/commit/c34334866633948530bd83ff37350c2744302c3c))
- **web:** mark workspace-shell as client component ([1f8f0a8](https://github.com/AnyNoteInc/AnyNote/commit/1f8f0a8501d50732a62791972a3928d6288948b0))
- **web:** match restored "Зарегистрироваться" button label in sign-up unit test ([98e74a3](https://github.com/AnyNoteInc/AnyNote/commit/98e74a3c39c479cc1dd093513fe788613e468fcd))
- **web:** memoize files-section items to stabilize useMemo deps ([6e877f7](https://github.com/AnyNoteInc/AnyNote/commit/6e877f711446e5c85cd55391c63bf4f5a59c042a))
- **web:** replace Box component=Link with plain Link in settings layout ([4d2bf22](https://github.com/AnyNoteInc/AnyNote/commit/4d2bf22706a5870a077ac8a6a3f05b88100d433d))
- **web:** resolve db connection helpers in Next build ([7ae3847](https://github.com/AnyNoteInc/AnyNote/commit/7ae3847472c41d7a908d69e53a4d008d9650afc5))
- **web:** show avatar in workspace sidebar and settings profile section ([96ec2db](https://github.com/AnyNoteInc/AnyNote/commit/96ec2db99e5506bdda2b8a3871d5af65ea866798))
- **web:** stop duplicating extension in file display name ([8f5648d](https://github.com/AnyNoteInc/AnyNote/commit/8f5648d8c0193af196ec2b0d46531ffe861e564e))
- work mcp servers ([73dc8aa](https://github.com/AnyNoteInc/AnyNote/commit/73dc8aa7ccf8f6e0a56d77b85805d5d38cc89725))
- **yjs:** import expect from @jest/globals + non-null mock.calls[0] access ([d8f2993](https://github.com/AnyNoteInc/AnyNote/commit/d8f2993d1271b497df1ed90ae8225a3b5228c788))
- **yjs:** load repo-root .env via Node --env-file flag ([4576ffb](https://github.com/AnyNoteInc/AnyNote/commit/4576ffbadd7d6708ebb3182219219435e35df194))
- **yjs:** production readiness — esm imports, signal handlers, awaited listen ([bf42832](https://github.com/AnyNoteInc/AnyNote/commit/bf428321902e6f3a7bb0a51a79c0e25bb17adee5))
- **yookassa:** align scaffold exports and test script with plan ([641e955](https://github.com/AnyNoteInc/AnyNote/commit/641e9553fa52e9e1cb8948c8fd796be0fbe9cb36))
- **yookassa:** tighten saved-method charge public API ([6099a21](https://github.com/AnyNoteInc/AnyNote/commit/6099a21cc430514a45ee207a7b46375409d88aa2))

### Features

- add "empty trash" button with confirmation dialog ([229fc82](https://github.com/AnyNoteInc/AnyNote/commit/229fc8235b6b5cb7b31ed060f5416e9d8022b32e))
- add chat message streaming status ([30ae33d](https://github.com/AnyNoteInc/AnyNote/commit/30ae33db0ce8952e68c6be95a296aadaa01a7799))
- Add chat work ([de6ec08](https://github.com/AnyNoteInc/AnyNote/commit/de6ec0866a5f003ff19192280b39d1b67d249e87))
- add FavoritesSection with collapsible favorites list and child pages ([c130abc](https://github.com/AnyNoteInc/AnyNote/commit/c130abc95a7a578cc32a79a95d7ff50d32ecdc2e))
- Add genogram ([4155529](https://github.com/AnyNoteInc/AnyNote/commit/41555295f66dbd2fa8d67264b88bc1aed943fedf))
- Add highlight ([24b8638](https://github.com/AnyNoteInc/AnyNote/commit/24b8638f9fdb36869d96a36091d9e377aebc7d7e))
- add MovePageDialog with tree picker ([1a91aa8](https://github.com/AnyNoteInc/AnyNote/commit/1a91aa8391180c447cf0844141351625846f41f8))
- Add ollama & chatgpt ([864ef71](https://github.com/AnyNoteInc/AnyNote/commit/864ef71efef19da71965c8fb9c3c0c20a5a26291))
- add PageContextMenu with favorites, rename, duplicate, move, delete ([e9df5a7](https://github.com/AnyNoteInc/AnyNote/commit/e9df5a7c249ea80d62055469bcd623181a7bd11e))
- add PageTreeSection with tree rendering and hover actions ([f95dc84](https://github.com/AnyNoteInc/AnyNote/commit/f95dc848c49bf3ec5431b29fb2c344633f3ba47c))
- add pagetype information ([6ef9411](https://github.com/AnyNoteInc/AnyNote/commit/6ef9411fbda0be9434e3da9853f772c278bd3710))
- Add rag search from apps/engines ([f5d3113](https://github.com/AnyNoteInc/AnyNote/commit/f5d3113c904e62e419406b3a29ba740f1cd1b0ad))
- add reusable workspace chat ui ([4bcd475](https://github.com/AnyNoteInc/AnyNote/commit/4bcd475bc2e32f45b5d2ec6d43d859c278901376))
- add structured agents status events ([051f921](https://github.com/AnyNoteInc/AnyNote/commit/051f921563b24df3a142245be78457e359225fa0))
- add trash page and page view stub routes ([1da1860](https://github.com/AnyNoteInc/AnyNote/commit/1da1860b880f44438624c59026a284d733779d99))
- **agents:** /health endpoint ([d90239e](https://github.com/AnyNoteInc/AnyNote/commit/d90239e476b0ed35ac6a1ad0d494945bb7065592))
- **agents/processing:** add dishka provider ([9dd32d9](https://github.com/AnyNoteInc/AnyNote/commit/9dd32d9350e9dc249f5b51aed3748ce671acb0f0))
- **agents/processing:** add language detector ([15dc989](https://github.com/AnyNoteInc/AnyNote/commit/15dc9897c01acae643c3a6be075179a0ca32eb3f))
- **agents/processing:** add spacy-backed normalizer ([106f531](https://github.com/AnyNoteInc/AnyNote/commit/106f531514c7f10bbcca5477372db8a56881b0b6))
- **agents/processing:** mount POST /processing/normalize ([add2b30](https://github.com/AnyNoteInc/AnyNote/commit/add2b305d339fece538bb1429b9636281cff0108))
- **agents:** add alembic scaffold with checkpoint exclusions ([56be5b7](https://github.com/AnyNoteInc/AnyNote/commit/56be5b7a6bcdaac03c6d013d233d31d104cd635a))
- **agents:** add chat schemas enums and errors ([de04aaa](https://github.com/AnyNoteInc/AnyNote/commit/de04aaadb7f60a43402592608049c946c9874779))
- **agents:** add chat schemas enums and errors ([daf218f](https://github.com/AnyNoteInc/AnyNote/commit/daf218f65dad67f8cfcf779994ae0afb6cb98f4f))
- **agents:** add ChunkerService for recursive text splitting ([11f6474](https://github.com/AnyNoteInc/AnyNote/commit/11f647444f6be685da3b8b6ff77a0e28e8a0da5c))
- **agents:** add EmbeddingFactoryRepository for ollama/openai/gigachat ([a405872](https://github.com/AnyNoteInc/AnyNote/commit/a405872ba649a197d320762fa2b562a16cb59ef2))
- **agents:** add EmbeddingProviderConfigSchema and require embedding in vectorization request ([b24804a](https://github.com/AnyNoteInc/AnyNote/commit/b24804a007c2ef5f59b0b5d23c29542596c0f5c0))
- **agents:** add generate stream use case and chat router ([d675ea1](https://github.com/AnyNoteInc/AnyNote/commit/d675ea1fd28528097eccd7ef5400002c7809adad))
- **agents:** add langchain-qdrant + qdrant-client deps ([eda0a4c](https://github.com/AnyNoteInc/AnyNote/commit/eda0a4cdfe0f40d3455dfe029ab53d51c1b4bf90))
- **agents:** add qdrant + ollama settings schemas ([36b86e6](https://github.com/AnyNoteInc/AnyNote/commit/36b86e63f7593fb27bc82c37b5fcde91908179e3))
- **agents:** add RagRetrievalService with pageId/blockNumber dedup ([5ed3487](https://github.com/AnyNoteInc/AnyNote/commit/5ed3487c0e2d9b7272882dc4e7d4c595039c9479))
- **agents:** add shared VectorsProvider for Qdrant + Ollama ([d93395e](https://github.com/AnyNoteInc/AnyNote/commit/d93395ef1569eb9329850a1fa2216f5e2f1000cf))
- **agents:** add VectorizationRepository over OllamaEmbeddings ([10a0cdf](https://github.com/AnyNoteInc/AnyNote/commit/10a0cdf1b1d30347af3afe5cd1b3149511830c4f))
- **agents:** add VectorizePageUseCase with TDD pipeline ([a146a94](https://github.com/AnyNoteInc/AnyNote/commit/a146a9492c5d52f9a2716c64b485c4b9f8571691))
- **agents:** add VectorStoreRepository over langchain-qdrant ([3be4aa5](https://github.com/AnyNoteInc/AnyNote/commit/3be4aa5be8ec4f185613178f89d6c9bda2ce162a))
- **agents:** bearer-token auth dependency + shared test fixtures ([1b7da97](https://github.com/AnyNoteInc/AnyNote/commit/1b7da9781a34566037a5b66fb6a032a5acdf02f6))
- **agents:** chat payload accepts optional embedding config ([1d187fd](https://github.com/AnyNoteInc/AnyNote/commit/1d187fde389d91d3deb720f5ee5789b13ca5d7b6))
- **agents:** DELETE /vectorization/pages/{id} endpoint ([fb5e643](https://github.com/AnyNoteInc/AnyNote/commit/fb5e6435c597d728525520b3af3dadedaec92870))
- **agents:** DELETE /vectorization/workspaces/{id} endpoint ([104636b](https://github.com/AnyNoteInc/AnyNote/commit/104636b56114e606115b0c7982a266a33404740f))
- **agents:** Dishka providers for settings/pool/checkpointer/graph ([b8e9e96](https://github.com/AnyNoteInc/AnyNote/commit/b8e9e96521b7ba1de0725f677c53c7646e410af8))
- **agents:** ensure qdrant `pages` collection on startup ([8075ae1](https://github.com/AnyNoteInc/AnyNote/commit/8075ae18686e0bae140322347e8cf30b9bc48cbb))
- **agents:** inject RagRetrievalService into GraphService ([3e42ef9](https://github.com/AnyNoteInc/AnyNote/commit/3e42ef95bbf64a5df20bed7dfc2bc936970d2e9b))
- **agents:** integrate fast-clean bootstrap hooks and cli scaffold ([404cd08](https://github.com/AnyNoteInc/AnyNote/commit/404cd083d0bb2484677616038c4dc0c1166c6aba))
- **agents:** jinja prompt template + renderer ([4e4fab4](https://github.com/AnyNoteInc/AnyNote/commit/4e4fab4a70f967dc219d09c85961db523cd78dc5))
- **agents:** JinjaRendererRepository accepts explicit rag_documents ([8ece0f2](https://github.com/AnyNoteInc/AnyNote/commit/8ece0f20fcefea809ffd62677e1d875ef330378d))
- **agents:** LangChain provider factory (ollama/openai/gigachat) ([2b7b506](https://github.com/AnyNoteInc/AnyNote/commit/2b7b50611035fb88c034d82f7afe145244e341d6))
- **agents:** LangGraph prepare_prompt → llm pipeline ([bdc179e](https://github.com/AnyNoteInc/AnyNote/commit/bdc179e2efdd6abfcf7546cb15aab3d0c98e6bfe))
- **agents:** MCP tool-calling loop in LangGraph (Pillar B2) ([20db945](https://github.com/AnyNoteInc/AnyNote/commit/20db945d1789b282b989bb46d7919c0d98c252db))
- **agents:** move provider factory and prompt renderer to chat repositories ([d0bc484](https://github.com/AnyNoteInc/AnyNote/commit/d0bc484f65d0c070f81800b0e77059a0a0b3cd47))
- **agents:** move provider factory and prompt renderer to chat repositories ([2ff5872](https://github.com/AnyNoteInc/AnyNote/commit/2ff5872b241c736b227ce4818654b645733dcb73))
- **agents:** port mcp adapters and graph service into chat module ([2c94554](https://github.com/AnyNoteInc/AnyNote/commit/2c94554f2fd722a5d5dc9d324415df7389ab40a5))
- **agents:** POST /api/v1/generate streaming + Ollama integration test ([a30daf3](https://github.com/AnyNoteInc/AnyNote/commit/a30daf34dbaf6fac66ce2494a30c434a73258576))
- **agents:** register RagRetrievalService in ChatProvider ([a9a63f5](https://github.com/AnyNoteInc/AnyNote/commit/a9a63f550a23d3ba0c1eab045d41637fe8663c13))
- **agents:** replace /processing/normalize with POST /vectorization ([28fd01a](https://github.com/AnyNoteInc/AnyNote/commit/28fd01a9a458d787e431c14935ba022a31e887df))
- **agents:** replace processing schemas with Vectorization\* ([9d48cf5](https://github.com/AnyNoteInc/AnyNote/commit/9d48cf5c97515f1d9999acc6d91389a7ec04152d))
- **agents:** request + SSE event schemas ([2feb583](https://github.com/AnyNoteInc/AnyNote/commit/2feb583dd631c3b808f387af50ecdce5c5efedc5))
- **agents:** scaffold apps/agents monorepo app ([911ec2c](https://github.com/AnyNoteInc/AnyNote/commit/911ec2cf4b654d0e59a82bdf56a352883b8dbc46))
- **agents:** scaffold processing module skeleton ([5eb4849](https://github.com/AnyNoteInc/AnyNote/commit/5eb4849b6a2f2bb5eb154c7086e72831fccc20a7))
- **agents:** settings + exception hierarchy ([d56b764](https://github.com/AnyNoteInc/AnyNote/commit/d56b764e55649ecf02e431e15e8649649e1d75ed))
- **agents:** skip RAG retrieval when embedding payload is null ([a1ebbe6](https://github.com/AnyNoteInc/AnyNote/commit/a1ebbe600120995bfa0019716869183c9db93261))
- **agents:** split prompt into system_render and user_render ([3a3fcf5](https://github.com/AnyNoteInc/AnyNote/commit/3a3fcf5deff671436a8c7befdc17446e3a76e05f))
- **agents:** update default.j2 citation format with block anchor ([a4083a7](https://github.com/AnyNoteInc/AnyNote/commit/a4083a79abecac0d6e5078dd9f37be8482b473cf))
- **agents:** update RagDocumentSchema to block-anchor shape ([08af90e](https://github.com/AnyNoteInc/AnyNote/commit/08af90e942b6603d83e5f0559850db16ad4fa463))
- **agents:** wire dishka providers bootstrap router and cmd rest ([06d4612](https://github.com/AnyNoteInc/AnyNote/commit/06d4612590eed6e97a12b45578c624c5e0042858))
- **agents:** wire ProcessingProvider with new repositories + use case ([24ea14d](https://github.com/AnyNoteInc/AnyNote/commit/24ea14da07641ebd4a15d7602083427525fa57f1))
- **agents:** wire router + Dishka + exception handler in app factory ([b4ab773](https://github.com/AnyNoteInc/AnyNote/commit/b4ab773638dd4cace7de99d899bc7404d966ae52))
- **ai-settings:** API keys vault + skills picker (Pillar F2) ([20f58b6](https://github.com/AnyNoteInc/AnyNote/commit/20f58b66196fb050f9009e925cfc0f3972e17479))
- **ai-settings:** operational reindex workspace button ([a784fbe](https://github.com/AnyNoteInc/AnyNote/commit/a784fbe98dfe4cdb86e563e3f604f8c5f26876bb))
- **ai-ux:** system prompt page picker + chat rename/delete ([fbdc075](https://github.com/AnyNoteInc/AnyNote/commit/fbdc075f1e2e4a2af68722ea6df9fb0603cbbcc1))
- **api:** allow workspace members to download workspace files ([b9b7ad4](https://github.com/AnyNoteInc/AnyNote/commit/b9b7ad45d775292ae1ba9acf249318bdd8497411))
- **auth:** add Google OAuth provider + email verification with welcome callback ([590c7f9](https://github.com/AnyNoteInc/AnyNote/commit/590c7f97343a6f319402136939b4897e002687fd))
- **auth:** assign Personal plan to new users by default ([353e8d5](https://github.com/AnyNoteInc/AnyNote/commit/353e8d56f55cd888992566d2ed29b6ba28014847))
- **auth:** create FREE subscription and preferences on user signup ([0016fbe](https://github.com/AnyNoteInc/AnyNote/commit/0016fbe25ebb86c8d739fd1b35357f3d9b5c2e3d))
- **auth:** wire password reset and captcha through mail outbox ([23adb58](https://github.com/AnyNoteInc/AnyNote/commit/23adb588c237357880812814f717b9031f9bb0cc))
- **billing:** add /billing/return page with order status polling ([1977815](https://github.com/AnyNoteInc/AnyNote/commit/197781552e6dead18592a78ef5530e559dce8b9c))
- **billing:** add YooKassa webhook handler with idempotent payment.succeeded/canceled/refund ([4b2bd38](https://github.com/AnyNoteInc/AnyNote/commit/4b2bd38e0b255685af450d82b0daff738ca4aa48))
- **billing:** implement subscription.startCheckout creating YooKassa payment ([b14c946](https://github.com/AnyNoteInc/AnyNote/commit/b14c946e4cde22c7a85068738b205865394009a0))
- **billing:** redesign settings billing page ([f0fe8a7](https://github.com/AnyNoteInc/AnyNote/commit/f0fe8a7178279c596d15193b77a2a58f68727955))
- **billing:** use Russian plan labels (Персональный/ПРО/МАКС) ([49d3c4b](https://github.com/AnyNoteInc/AnyNote/commit/49d3c4b42884e95c8465466d3c8bba2cf18d1aaf))
- change link to profile ([bf1864b](https://github.com/AnyNoteInc/AnyNote/commit/bf1864bb12fd979ad338b3d260d0696a26643963))
- Change menus ([2b1d3b6](https://github.com/AnyNoteInc/AnyNote/commit/2b1d3b686a568ad92beaed802b8d0793f2e214e5))
- change models ([df9e520](https://github.com/AnyNoteInc/AnyNote/commit/df9e5204a55c44e4acd8c26760984b35b5c3e488))
- Changes in genogram ([2bc588b](https://github.com/AnyNoteInc/AnyNote/commit/2bc588b880e1834dd0a034b46747939a6a7010a5))
- **chat:** accept messages history in buildAgentsPayload ([978c85f](https://github.com/AnyNoteInc/AnyNote/commit/978c85f3cde12085a328eed3d54810213d08ae0c))
- **chat:** collect parent-aware chat history for agents ([ff167fb](https://github.com/AnyNoteInc/AnyNote/commit/ff167fb911c1e11c2c0e6aa61622430b895ab3ba))
- **chat:** forward chat history to agents /chat/generate ([baf244b](https://github.com/AnyNoteInc/AnyNote/commit/baf244b73693a2e9761be6ee2a1a7eefdd72a403))
- **chat:** packages/chat — reusable React chat UI library ([12ea4b3](https://github.com/AnyNoteInc/AnyNote/commit/12ea4b372194d7cfa684776dbe3c25d43462ddaf))
- Chatting ([a5f9fe7](https://github.com/AnyNoteInc/AnyNote/commit/a5f9fe749bdeab219552346a3ca5aaf4844edb1f))
- **db:** add AiProviderConnection Zod schema and parser ([2c3ac9b](https://github.com/AnyNoteInc/AnyNote/commit/2c3ac9b3a11928e05dd9b71fa1ad3e976e38a4d7))
- **db:** add Block model with BlockType enum ([97c6105](https://github.com/AnyNoteInc/AnyNote/commit/97c61050a27f19c75dc9191ce20e55d77deab51a))
- **db:** add embeddings model fields to AiModel and WorkspaceAiSettings ([6c2a474](https://github.com/AnyNoteInc/AnyNote/commit/6c2a4740aa958306943d6a1b2efd187236513e8a))
- **db:** add enqueueOutboxEvent transactional helper ([c7ef218](https://github.com/AnyNoteInc/AnyNote/commit/c7ef218becb79668c3fa60e235892c9e92293ce2))
- **db:** add enqueueOutboxEventIgnoreConflict with delayMs + ON CONFLICT DO NOTHING ([25540e1](https://github.com/AnyNoteInc/AnyNote/commit/25540e17cba280e38acbe90a40f3e6763da0a7a2))
- **db:** add enums for workspaces, integrations, and subscriptions ([811fd39](https://github.com/AnyNoteInc/AnyNote/commit/811fd392ab04aa1ed19669a8dc47e73844b5e79a))
- **db:** add File and BlockFile models with partial unique indexes ([f55792e](https://github.com/AnyNoteInc/AnyNote/commit/f55792e1ffb476a8633f7d794731c20fceb5ccb9))
- **db:** add idempotent seed script for providers and plans ([de93202](https://github.com/AnyNoteInc/AnyNote/commit/de93202a9bb830c4e4cd15199144e1a3f57b496a))
- **db:** add IntegrationProvider and Integration models ([23b7f1c](https://github.com/AnyNoteInc/AnyNote/commit/23b7f1c2026a6cdd2aae283b4483ffafcf3f83aa))
- **db:** add OutboxEvent model + pillar_d_outbox_events migration ([5fcd7aa](https://github.com/AnyNoteInc/AnyNote/commit/5fcd7aad2e40b05cf58c51da01955715131bb91d))
- **db:** add Page skeleton model (no Block relations yet) ([1692789](https://github.com/AnyNoteInc/AnyNote/commit/16927894638f3a2296a4fa299fcf37e070533b93))
- **db:** add partial unique index on active outbox events ([b2c7e0c](https://github.com/AnyNoteInc/AnyNote/commit/b2c7e0c319381fe07d3e9c0cb597a7328d0758ab))
- **db:** add Plan and Subscription models ([b3a0a31](https://github.com/AnyNoteInc/AnyNote/commit/b3a0a317a250d5eaa9a4ed9909eec3ddd7ffe0c0))
- **db:** add prevPageId, SearchChat.parentId, and FavoritePage model ([b052399](https://github.com/AnyNoteInc/AnyNote/commit/b052399e1c91273d2efe1b66adfa147c55f67356))
- **db:** add SearchChat and SearchMessage models ([3de130d](https://github.com/AnyNoteInc/AnyNote/commit/3de130d7aa47c20db36797c119eb2ba64761af77))
- **db:** add UserPreference model ([47cbebe](https://github.com/AnyNoteInc/AnyNote/commit/47cbebeb3551174f9b085b2abcabf9c64efde1f1))
- **db:** add Workspace and WorkspaceMember models ([4df6ea1](https://github.com/AnyNoteInc/AnyNote/commit/4df6ea1173b8d8f413512dbd3683a2a3319c6989))
- **db:** add WorkspaceAiSettings model + pillar_f migration ([fa31125](https://github.com/AnyNoteInc/AnyNote/commit/fa3112520073ecfb020ef4690336e1ddfd11d07f))
- **db:** export Block, SearchChat, SearchMessage explicitly ([bb9978f](https://github.com/AnyNoteInc/AnyNote/commit/bb9978f5addfebf66da3ff62014aeeaa2440cd86))
- **db:** extend Plan/Subscription, add Order model for billing ([5adfe6f](https://github.com/AnyNoteInc/AnyNote/commit/5adfe6f1eeb7a27c8c1c54f8de7fc7a5abfd4a5b))
- **db:** migrate blocks + search_chats with linked-list indexes ([bd3571c](https://github.com/AnyNoteInc/AnyNote/commit/bd3571c15150668b3225d5791a267b9d5ee0d8eb))
- **db:** migration for workspaces, integrations, plans, subscriptions ([797b477](https://github.com/AnyNoteInc/AnyNote/commit/797b4772a243b2cd14c66eb2102b1b03e76653d6))
- **db:** pillar A — rename Chat\*/add AI catalog + fresh migration ([db5b890](https://github.com/AnyNoteInc/AnyNote/commit/db5b8903bd6a5cbdeb9dd42208e653fd07f3ddfc))
- **db:** replace block model with PageType + content/contentYjs + PageFile ([2bfcdf2](https://github.com/AnyNoteInc/AnyNote/commit/2bfcdf2eab45ea752ec2fd2f075a9cc6f418de08))
- **db:** seed AI models with minPlanSlug for plan-based filtering ([c2941d8](https://github.com/AnyNoteInc/AnyNote/commit/c2941d89329a436def5debe12b100cc6536d8ac8))
- **db:** seed AI providers (ollama/openai/gigachat) and starter models ([63c1f53](https://github.com/AnyNoteInc/AnyNote/commit/63c1f53152f505a9cd4d1ec2f16d1ff0f2ccf5fc))
- **db:** seed embeddings models and OpenAI provider ([28a5294](https://github.com/AnyNoteInc/AnyNote/commit/28a52945ec34834d9df488a5800b0a37c1fdf094))
- **db:** seed Personal/Pro/Max plans with capability flags ([b20f2ee](https://github.com/AnyNoteInc/AnyNote/commit/b20f2ee8dac27c07a5126d6433165e1b73835d36))
- **editor:** anynoteTextColor mark ([b505df6](https://github.com/AnyNoteInc/AnyNote/commit/b505df63a0c49da8bfc26eceb9b6e3866ccd6592))
- **editor:** block display names + convertibility helper ([d40aa4f](https://github.com/AnyNoteInc/AnyNote/commit/d40aa4fc05ae215be6a84f92ac87a9f18fd9c54a))
- **editor:** block duplicate and conversion helpers ([24420b6](https://github.com/AnyNoteInc/AnyNote/commit/24420b6927da61e8f7f478163bc48f74f8ac9630))
- **editor:** block move dialog + headless Yjs insert logic ([0432bdb](https://github.com/AnyNoteInc/AnyNote/commit/0432bdb12d0bdfc7afb3cee7469b548e301e6e2c))
- **editor:** blockBackground global attribute extension ([8b90ae1](https://github.com/AnyNoteInc/AnyNote/commit/8b90ae144df817b48c41cbfacaa63a832f34a490))
- **editor:** BlockIndexAttributes extension tags top-level nodes ([98c1b7e](https://github.com/AnyNoteInc/AnyNote/commit/98c1b7e69b887f86dccb4890d165691eeaba1524))
- **editor:** color palette constants and CSS variables ([865317f](https://github.com/AnyNoteInc/AnyNote/commit/865317fea00bb6e8181d8b317c656b94b8340c13))
- **editor:** drag handle click opens block menu ([6fd6ca0](https://github.com/AnyNoteInc/AnyNote/commit/6fd6ca0af232cc800ab92e23351c9606ec3c45f7))
- **editor:** drag handle menu component (without move) ([e189c98](https://github.com/AnyNoteInc/AnyNote/commit/e189c9889007426af5a4f7ab5a79c3bc3c4de524))
- **editor:** hidden-text block extension ([8465591](https://github.com/AnyNoteInc/AnyNote/commit/84655912c38ad0fa71dfaf7449bf4db952a4929d))
- **editor:** register BlockIndexAttributes in buildExtensions ([dd92a24](https://github.com/AnyNoteInc/AnyNote/commit/dd92a24a137a61db811f8f8e7c3d31f49b3a828e))
- **editor:** register text-color and block-background extensions ([9fe96de](https://github.com/AnyNoteInc/AnyNote/commit/9fe96de49fbb514638b186002e25438f1dd05f99))
- **editor:** scrollToBlockIndex utility + block-flash CSS ([75e8360](https://github.com/AnyNoteInc/AnyNote/commit/75e83609c5d209e96b34675f3912e4b4fa351d9e))
- **editor:** seed Y.Doc from initialContentYjs before provider connects ([e2e4250](https://github.com/AnyNoteInc/AnyNote/commit/e2e4250cc150e5974ec7bafb03cc50bb9c764c4c))
- **editor:** slash media commands, resizable image block, page header polish ([16e9763](https://github.com/AnyNoteInc/AnyNote/commit/16e97637d5bc8da27ec22490107148b85fefed4d))
- **editor:** support loadingFallback prop for AnyNoteEditor ([b0f47ab](https://github.com/AnyNoteInc/AnyNote/commit/b0f47abc1bddfee2f5838c543b68a202c898b7e9))
- **editor:** tiptap collaborative editor with slash menu, drag handle, file upload ([cff4de1](https://github.com/AnyNoteInc/AnyNote/commit/cff4de14764e052c55f07d9f307d1d061616e80a))
- **editor:** toggle and hidden-text slash menu items ([8edfb27](https://github.com/AnyNoteInc/AnyNote/commit/8edfb27fa28eb103a99bb793e537eccab9911e83))
- **editor:** toggle block extension ([c054fe4](https://github.com/AnyNoteInc/AnyNote/commit/c054fe4612b0c899c6ce66bd005e4d7b67196d1b))
- **editor:** wire block move across pages in page-renderer ([f8d2660](https://github.com/AnyNoteInc/AnyNote/commit/f8d26602f8c3a5bc9a5f3c2f3fe93e4e4550246c))
- **engines/indexer:** add bullmq indexing processor ([148fc27](https://github.com/AnyNoteInc/AnyNote/commit/148fc27800919d576fd0e353aa1c89cfcf7ece45))
- **engines/indexer:** add outbox → bullmq drainer ([0978247](https://github.com/AnyNoteInc/AnyNote/commit/0978247dff673b5c7ac91c795537b172c6bd4711))
- **engines/indexer:** add outbox cron scanning idle pages ([9d687bf](https://github.com/AnyNoteInc/AnyNote/commit/9d687bffe41900c51dad83c3d331402dbf449ca3))
- **engines/indexer:** add page chunker service ([b429ed3](https://github.com/AnyNoteInc/AnyNote/commit/b429ed37b0a3c6015a121782e244f030533f937a))
- **engines/indexer:** add processing service http client ([91cc448](https://github.com/AnyNoteInc/AnyNote/commit/91cc448ed1cceb8f6fbbb233d1e7f7cfe64890a4))
- **engines/indexer:** add qdrant writer service ([7368ab1](https://github.com/AnyNoteInc/AnyNote/commit/7368ab1f4bc5d730abc5608fa4aed0e941deb4bc))
- **engines/indexer:** wire indexer module into app ([af0f80f](https://github.com/AnyNoteInc/AnyNote/commit/af0f80fd350fc45616352372168ac0706230f90c))
- **engines/infra:** add global db module exposing @repo/db singleton ([5ff3697](https://github.com/AnyNoteInc/AnyNote/commit/5ff36971dde1cffdb9400f81c3b5f23619387da5))
- **engines/infra:** add ollama embedding module ([f2edead](https://github.com/AnyNoteInc/AnyNote/commit/f2edeadf89504dbcf8519db77c95b5ec304948c7))
- **engines/infra:** add qdrant module ([bf1a45b](https://github.com/AnyNoteInc/AnyNote/commit/bf1a45b31349f04dccfb8eb8c1d666905ced9825))
- **engines/mcp:** add 15 MCP tools with zod schemas ([bd5492b](https://github.com/AnyNoteInc/AnyNote/commit/bd5492bb9375f3da4664d10c48a9359e2cc82db3))
- **engines/mcp:** add bearer token guard ([d793690](https://github.com/AnyNoteInc/AnyNote/commit/d7936900bb1079713264dff9a79c7b9d8a58d09e))
- **engines/mcp:** add error taxonomy ([3d7d5d8](https://github.com/AnyNoteInc/AnyNote/commit/3d7d5d8d7051cedc581f6f1a3b9fff76906c312a))
- **engines/mcp:** add file uploader service ([1b0f497](https://github.com/AnyNoteInc/AnyNote/commit/1b0f497f1f71f0f651bfefb0e9760d6e81137a9f))
- **engines/mcp:** add page writer service ([798f0f2](https://github.com/AnyNoteInc/AnyNote/commit/798f0f2ea786b17176d345ea81eba4eb7053a6f9))
- **engines/mcp:** add stats service ([8d6f25d](https://github.com/AnyNoteInc/AnyNote/commit/8d6f25d1c69c06ecdea3553f11da39b94f59736e))
- **engines/mcp:** add tiptap → markdown renderer ([e5253e5](https://github.com/AnyNoteInc/AnyNote/commit/e5253e5825e38e46574862f43e8e854cd9be89d6))
- **engines/mcp:** add workspace member guard (plain service) ([99241e0](https://github.com/AnyNoteInc/AnyNote/commit/99241e08bb5ca72d5b5f6a55a4d3ca4f51545e66))
- **engines/mcp:** wire mcp module with 15 tools ([ad6a460](https://github.com/AnyNoteInc/AnyNote/commit/ad6a460d10ea9c2d34160656717881fb886c56e7))
- **engines:** add /health endpoint ([b707280](https://github.com/AnyNoteInc/AnyNote/commit/b70728052b2c28b866801d6487c7426dd716e027))
- **engines:** add AgentsClient for /vectorization HTTP calls ([483b3a4](https://github.com/AnyNoteInc/AnyNote/commit/483b3a486863e86d20d5c0309c17d5a6da7ff380))
- **engines:** add backfill:reindex CLI ([e755b51](https://github.com/AnyNoteInc/AnyNote/commit/e755b51595162b112b98a1a74fd34e0a0173a506))
- **engines:** add billing cli commands and migrate backfill reindex ([d20dc2c](https://github.com/AnyNoteInc/AnyNote/commit/d20dc2c25030e379bd969708081c247ad78713c6))
- **engines:** add MailerModule with dispatch cron service ([4feda25](https://github.com/AnyNoteInc/AnyNote/commit/4feda25a10e6fe9636b6491636b4eda5c4a484ef))
- **engines:** add PageContentReader (block-level text extraction) ([40449d1](https://github.com/AnyNoteInc/AnyNote/commit/40449d14062cb71f3b27caeca579de76b4006889))
- **engines:** add refund cli command ([a2debbf](https://github.com/AnyNoteInc/AnyNote/commit/a2debbfd7f9504f280a7b5297c65ebdbf70ef5a9))
- **engines:** add subscription renewal cron ([44a7395](https://github.com/AnyNoteInc/AnyNote/commit/44a739554100dbbc5bd17449d6b7a0fc63b8fcf3))
- **engines:** apps/engines MCP server (Pillar E) ([a743606](https://github.com/AnyNoteInc/AnyNote/commit/a743606fc797c611e553847d2a2b5605f42ef788))
- **engines:** gate page indexing by owner's pageIndexingEnabled flag ([80833ec](https://github.com/AnyNoteInc/AnyNote/commit/80833ecdd2d8bf45272046805d4cf2e7c4ab05ab))
- **engines:** implement refund service ([34395b4](https://github.com/AnyNoteInc/AnyNote/commit/34395b494f337620f3b790b2081f1a7a2285e6e0))
- **engines:** implement subscription renewal service ([57d3cda](https://github.com/AnyNoteInc/AnyNote/commit/57d3cda5be3cd29a751abcbe734b6a864871fd83))
- **engines:** late-bind embeddings vectorization ([16e1e56](https://github.com/AnyNoteInc/AnyNote/commit/16e1e5670ba18a56431e8b308a3284d2327e81cc))
- **engines:** new VectorizationCronService + lean IndexerModule ([1d0c8b5](https://github.com/AnyNoteInc/AnyNote/commit/1d0c8b50d1c451d92e757fc68f0749fa3d24e384))
- **engines:** scaffold billing module with yookassa factory ([8fa21ae](https://github.com/AnyNoteInc/AnyNote/commit/8fa21aee0c61316b5a973fae322080f4701c74e1))
- **engines:** scaffold nest commander cli ([a0f5b72](https://github.com/AnyNoteInc/AnyNote/commit/a0f5b7230fb53bce094067bfb71bbec05a3cb979))
- **engines:** scaffold nestjs 11 application ([a77bcb7](https://github.com/AnyNoteInc/AnyNote/commit/a77bcb76749118131f5a7fef5c591ab9d53f84b3))
- **excalidraw:** collaborative canvas with yjs binding and file upload ([c5fa0ab](https://github.com/AnyNoteInc/AnyNote/commit/c5fa0abfba6a8d765d7b8362a4d8ef2dd4dbba8c))
- **excalidraw:** seed Y.Doc from initialContentYjs before provider connects ([fc7dff5](https://github.com/AnyNoteInc/AnyNote/commit/fc7dff5b7bb9c45a731075d839bf4ef21e750ab7))
- **excalidraw:** wire collaborative user identity via awareness ([a430506](https://github.com/AnyNoteInc/AnyNote/commit/a4305060a05ce835f04505478f31ae7c458afea1))
- **genogram:** add calcAge and calcAgeAtDeath helpers ([64501f9](https://github.com/AnyNoteInc/AnyNote/commit/64501f9fd72e9f28f68d3e8cf89d3851938972e5))
- **genogram:** add formatPartialDate with Russian declension ([773d80a](https://github.com/AnyNoteInc/AnyNote/commit/773d80ac7a48cef119407bd3891bd7794cc29352))
- **genogram:** add genogram.meta Y.Map with getMeta/setMeta ([a4b8337](https://github.com/AnyNoteInc/AnyNote/commit/a4b833723078dbb42120e57563de712c20234e8c))
- **genogram:** add hasParents/getChildGroupOf/getChildrenOf ([9900cf6](https://github.com/AnyNoteInc/AnyNote/commit/9900cf6ab7fc75188291452a4bb0cc6a48533db0))
- **genogram:** add partner helpers (getBaseOf, getPartnersOf, etc.) ([f05ec0c](https://github.com/AnyNoteInc/AnyNote/commit/f05ec0c3a8827b6c4bd5e740791950b6a1847e95))
- **genogram:** add Russian i18n strings with declension helpers ([3fa0bab](https://github.com/AnyNoteInc/AnyNote/commit/3fa0babd395410a7899f09e3600a3f02914d85f5))
- **genogram:** addChildren with optional reorderExisting ([ff91eb7](https://github.com/AnyNoteInc/AnyNote/commit/ff91eb72b41af816e2f28d256684ad44948f5d7b))
- **genogram:** AddChildrenForm with reorderable existing rows + new entries; PersonDataForm onChange ([3d7ebf3](https://github.com/AnyNoteInc/AnyNote/commit/3d7ebf3c82f93847402e8fa1260798c356b94e22))
- **genogram:** addParents with hasParents guard ([0cbf823](https://github.com/AnyNoteInc/AnyNote/commit/0cbf8230eaaccb04a391bda63bb4114c8ffb48cf))
- **genogram:** addPartner with auto-numbering of multi-partner ordinals ([cb7455b](https://github.com/AnyNoteInc/AnyNote/commit/cb7455b18284ce9a51029e9f8215f97849d78526))
- **genogram:** ApproximateAgeInput with single/range modes ([5828eb1](https://github.com/AnyNoteInc/AnyNote/commit/5828eb1ddec6c4d997dfe7aa4256a15e01198004))
- **genogram:** ChildEntryRow with person/miscarriage/abortion modes ([55a5a3e](https://github.com/AnyNoteInc/AnyNote/commit/55a5a3eec789b38093f8f75baba01ef84cdc8380))
- **genogram:** createOwnerWithParents composes owner + parents + union + meta ([dcbaca4](https://github.com/AnyNoteInc/AnyNote/commit/dcbaca4a0834400c391d35617cef268dc26b2003))
- **genogram:** draggable divorce mark with markPosition persistence ([116663a](https://github.com/AnyNoteInc/AnyNote/commit/116663a53a0e10fe41155efa410b2382022b5a80))
- **genogram:** DrawerHost dispatches forms by drawer.mode; AddPartner composite ([cade695](https://github.com/AnyNoteInc/AnyNote/commit/cade695a106552e227c444f385eb3e31639a99bd))
- **genogram:** E2E tests Tasks 42-46 — all 5 scenarios pass ([bd36388](https://github.com/AnyNoteInc/AnyNote/commit/bd36388c68b091da8350771ecb4a10b45265bb7c))
- **genogram:** EdgeMenu — edit connection + add children ([e0038f2](https://github.com/AnyNoteInc/AnyNote/commit/e0038f233f41d08e5385922c6fc50a29474afb8d))
- **genogram:** ElementMenu — context-aware actions per node type ([f90558e](https://github.com/AnyNoteInc/AnyNote/commit/f90558ecc6916bb0ab92281554901fbc655dfdad))
- **genogram:** EmptyState with conditional CTA ([3637dc5](https://github.com/AnyNoteInc/AnyNote/commit/3637dc59b8a9fb8039c3ddca5cd502f456f114af))
- **genogram:** expose forms/ui public API + align tests to current domain types ([43e506b](https://github.com/AnyNoteInc/AnyNote/commit/43e506b339e724fca19c87b8c776dda08cf04dc9))
- **genogram:** extend domain model with PartialDate, LifeStatus, GenogramMeta, divorce.markPosition ([77007b5](https://github.com/AnyNoteInc/AnyNote/commit/77007b5b5b54095c3fbe334051effea0cb3ce619))
- **genogram:** factories produce new LifeDates shape; add createDefaultParent/createDefaultUnion ([f31a2a4](https://github.com/AnyNoteInc/AnyNote/commit/f31a2a4e2cdda8be53c96f6998328818e4718f05))
- **genogram:** integrate reducer + DrawerHost + Menus + EmptyState ([5ac306f](https://github.com/AnyNoteInc/AnyNote/commit/5ac306fcce38508a93f20f2768ef4ac7a2240242))
- **genogram:** MarriageRelationForm with marriage/cohabitation toggle ([c37186a](https://github.com/AnyNoteInc/AnyNote/commit/c37186a04fcd2478d53ab1363396349b8122a4ff))
- **genogram:** OwnerCreationDateNode renders creation date right of owner ([7930dba](https://github.com/AnyNoteInc/AnyNote/commit/7930dba9ec4b58738e83c629b639007c1bd63829))
- **genogram:** OwnerDataForm (create + edit modes) ([7c5af2c](https://github.com/AnyNoteInc/AnyNote/commit/7c5af2cc7868f5e230bf6903f35410f6424cc670))
- **genogram:** PartialDateInput primitive (day/month/year independent) ([04dd091](https://github.com/AnyNoteInc/AnyNote/commit/04dd0913ad2e27d3a19b1e7af86895ad2f466d81))
- **genogram:** partner placement by sex (single) and partnerOrder (multi) ([3b04965](https://github.com/AnyNoteInc/AnyNote/commit/3b049653957c10c59b06ddfab4d2ea357e8b995e))
- **genogram:** PersonDataForm conditional partner/child ordinal fields ([c100f94](https://github.com/AnyNoteInc/AnyNote/commit/c100f94564af6c9e9538a9e5c53c494d9acc3272))
- **genogram:** PersonDataForm with conditional birth/death/tragically fields ([a93bba3](https://github.com/AnyNoteInc/AnyNote/commit/a93bba318a9dd29049bdd75be76b058fe842852e))
- **genogram:** setChildOrder reorders ChildGroup.children with bounds check ([714c71c](https://github.com/AnyNoteInc/AnyNote/commit/714c71c214cc955f7b8e1ccc0eec1fceb353c9ea))
- **genogram:** setPartnerOrder with consistent renumbering ([55f6784](https://github.com/AnyNoteInc/AnyNote/commit/55f67847324ecd9c18100e9d7360772b176be22c))
- **genogram:** SexToggle + LifeStatusToggle primitives ([d857203](https://github.com/AnyNoteInc/AnyNote/commit/d857203022a6797a8903ff85a75c03333bbee8b1))
- **genogram:** shouldShowDeathCross combines tragically flag and age<65 ([5ce52d1](https://github.com/AnyNoteInc/AnyNote/commit/5ce52d176a8ed5e9c3acd98fedf2f16d62b0443c))
- **genogram:** UI state reducer for selection, menu, drawer ([ba9ba56](https://github.com/AnyNoteInc/AnyNote/commit/ba9ba566beb3e90b315e0925ae9f3164c8546c39))
- **genogram:** visual node updates — lifeStatus tristate, partner ordinal, label positioning, Cyrillic А/В ([7ca4603](https://github.com/AnyNoteInc/AnyNote/commit/7ca460307480fa4ae92944f6b6f2789355963ec6))
- **indexer:** compose worker profile + .env.example + README polish ([171d206](https://github.com/AnyNoteInc/AnyNote/commit/171d206c6ffa275b7aeed499920b099b4f0a61e4))
- **indexer:** scaffold apps/indexer (Python worker, FastAPI host) ([fc3b497](https://github.com/AnyNoteInc/AnyNote/commit/fc3b497793515b794be74f4bb9e08d10bef1dcd8))
- **indexer:** services + DI + worker + /health (T5–T11) ([610875e](https://github.com/AnyNoteInc/AnyNote/commit/610875e51cc63a8692c48ffc0f8d6a45d801c0ae))
- indexing for rag ([e09eb15](https://github.com/AnyNoteInc/AnyNote/commit/e09eb1511d51ca0f54a4e5db6fda8ea0eec493bf))
- **infra:** add minio-init and s3 env vars ([369a5f3](https://github.com/AnyNoteInc/AnyNote/commit/369a5f386dd7e76aec7d039c1fb6793352ea90e1))
- integrate favorites, page tree, and trash link into WorkspaceSidebar ([9978183](https://github.com/AnyNoteInc/AnyNote/commit/99781834dba0e430002906d8c0fcb7f3b335fb31))
- **landing:** sync pricing tiers and add oferta placeholder ([5ff29f9](https://github.com/AnyNoteInc/AnyNote/commit/5ff29f917316ec675a9f9a248839de6b6b87313b))
- **mail:** add 10 templates with renderer registry ([c339bb4](https://github.com/AnyNoteInc/AnyNote/commit/c339bb4e566272485e0256a5fcebac63c084727b))
- **mail:** add enqueueMailEvent helper with live Prisma test ([a593e2e](https://github.com/AnyNoteInc/AnyNote/commit/a593e2e74f842c4b24f1f347cee7ef113a19c53c))
- **mail:** add transport and dispatchPending with retry/back-off ([b794cee](https://github.com/AnyNoteInc/AnyNote/commit/b794ceeeb9447049c3c11f667090228feb9a0a9e))
- **mail:** scaffold @repo/mail package with types and utils ([39e394f](https://github.com/AnyNoteInc/AnyNote/commit/39e394fef30fa774f4cbc6f22324dded078d8e24))
- nextjs docs rules ([c86f5ea](https://github.com/AnyNoteInc/AnyNote/commit/c86f5eaed44b88692e1ea1a5df0f3f81592105cd))
- normalize chat messages for ui ([d51a1b6](https://github.com/AnyNoteInc/AnyNote/commit/d51a1b6cd0530c24fb33ef7d9efe47ed7b1e9dcf))
- **page:** inline title/icon editing with emoji picker + skeleton loading ([2b28fec](https://github.com/AnyNoteInc/AnyNote/commit/2b28fecaed0e2540e69fb013813c70cf65c781da))
- **pricing:** add checkout modal for YooKassa payments ([1437169](https://github.com/AnyNoteInc/AnyNote/commit/1437169666a4062635e583216053dff525777919))
- **pricing:** redesign /pricing with monthly/yearly toggle and tier cards ([60973b0](https://github.com/AnyNoteInc/AnyNote/commit/60973b08058a304b95109bccb5852fbeeb2bb28e))
- production deployment via traefik + docker compose ([#2](https://github.com/AnyNoteInc/AnyNote/issues/2)) ([25f9e6e](https://github.com/AnyNoteInc/AnyNote/commit/25f9e6e41b10ac813c280dbbf259637c7ff7bb26))
- **public:** add cookie consent banner with reject-redirect to ya.ru ([c91fcca](https://github.com/AnyNoteInc/AnyNote/commit/c91fcca1f568665d14d5e45feb5cd8609e7d2019))
- **public:** add home page design tokens ([bda40f5](https://github.com/AnyNoteInc/AnyNote/commit/bda40f535cd9c391422d2dc5267dde9893186f1f))
- **public:** add HomeContact section with origami illustration ([3448a14](https://github.com/AnyNoteInc/AnyNote/commit/3448a14727c8a7d8863d988f1a376a029063b8bd))
- **public:** add HomeFeatures section ([29412de](https://github.com/AnyNoteInc/AnyNote/commit/29412de71e410eac0018298e2b5689d3bbd14fc9))
- **public:** add HomeFinalCta section ([83ada56](https://github.com/AnyNoteInc/AnyNote/commit/83ada56ee6b06de93368be4264d5908d797c3d47))
- **public:** add HomeHero section with workspace preview ([d3cd101](https://github.com/AnyNoteInc/AnyNote/commit/d3cd101352413d05b0f8dd74edc7250aa88c38f3))
- **public:** add HomeMarketFit section ([b02f186](https://github.com/AnyNoteInc/AnyNote/commit/b02f186f32a0f211c8abca93f31bde549e578f28))
- **public:** add HomeModes section with 4 mode cards ([e52773f](https://github.com/AnyNoteInc/AnyNote/commit/e52773f7aed7aadee4b40a219badc949ec599ea8))
- **public:** add HomePricing dark section ([e66fd40](https://github.com/AnyNoteInc/AnyNote/commit/e66fd40bced0d1f7e130a46bbf2d5a1212d92483))
- **public:** add HomeSearch section with answer card ([28244d0](https://github.com/AnyNoteInc/AnyNote/commit/28244d0efc42b1a095d1006f39d1caa45c43ef31))
- **public:** add Origami shape primitive ([883f664](https://github.com/AnyNoteInc/AnyNote/commit/883f664ee98b42d41f29ea61651960b8ff3b5bd0))
- **public:** extend ContactForm with company and message fields ([0a668d8](https://github.com/AnyNoteInc/AnyNote/commit/0a668d882b80cb9f73014a9af7a992b72b51503f))
- **public:** rebrand AnyNote→Любые заметки, AI→ИИ across public surfaces ([bc97624](https://github.com/AnyNoteInc/AnyNote/commit/bc97624874cad9fd44c7e59623850ea572fd1350))
- **public:** rebrand pricing copy and add home content data ([3d0c096](https://github.com/AnyNoteInc/AnyNote/commit/3d0c0969e9762d903fdb0330e56ab76a2ec0313f))
- **public:** repaint footer in Claude editorial style ([f118173](https://github.com/AnyNoteInc/AnyNote/commit/f118173fc7e5c01fa7e783920d74da226d9f0fc2))
- **public:** tighten header, swap BrandMark for Origami, drop cookies link, rebrand feature copy ([8169d0d](https://github.com/AnyNoteInc/AnyNote/commit/8169d0d9b82dd7539de18e6ae56973153c056a65))
- refactor SearchSidebarSection with tree hierarchy and AddIcon for child chats ([8ae2c63](https://github.com/AnyNoteInc/AnyNote/commit/8ae2c638cd6476c4cea25e7e99e3930d2b52983b))
- remove docs ([d32ac69](https://github.com/AnyNoteInc/AnyNote/commit/d32ac69f82fddf24d4005d6bb681aeec713e6420))
- remove version uv ([e3ac361](https://github.com/AnyNoteInc/AnyNote/commit/e3ac361281905024f11a6a14ce03111481b5b86a))
- **sidebar:** plan Chip with green for paid tiers, hide gated nav items ([299ebcf](https://github.com/AnyNoteInc/AnyNote/commit/299ebcf7410baf34759d9b29c335acd7ba421d8c))
- **storage:** implement S3StorageClient and singleton ([040924e](https://github.com/AnyNoteInc/AnyNote/commit/040924e26891485054e7dd7ac377c0fdb481c9cb))
- **storage:** scaffold @repo/storage package ([b3cf41e](https://github.com/AnyNoteInc/AnyNote/commit/b3cf41e9667305a36e9766eb6c9c6cced272bd07))
- **trpc,web:** page.update accepts type; replace parentType in web ([38e808d](https://github.com/AnyNoteInc/AnyNote/commit/38e808db57825b6aee45f7de661f9f3dd6fdc5f2))
- **trpc:** add blockRouter with linked-list operations ([8055cfc](https://github.com/AnyNoteInc/AnyNote/commit/8055cfc6635b546e20edd559b469d79176024840))
- **trpc:** add file.attachToPage and file.detachFromPage ([e094a12](https://github.com/AnyNoteInc/AnyNote/commit/e094a12156c898c9a470e32eed8a4c56cfb04561))
- **trpc:** add file.workspaceUploaders query ([7c2c32f](https://github.com/AnyNoteInc/AnyNote/commit/7c2c32f8f869c41bd8d7a12e2ac8f85fb61cbd9e))
- **trpc:** add fileRouter ([68b132e](https://github.com/AnyNoteInc/AnyNote/commit/68b132e092b33313d9133fd6b86f808b299298a1))
- **trpc:** add getActivePlanForUser helper ([2b4d5af](https://github.com/AnyNoteInc/AnyNote/commit/2b4d5afb7c7900aa7fe9cd26f39560c287b9eeb8))
- **trpc:** add getAvailableAiModels filtering by AiModel.minPlanSlug ([188227e](https://github.com/AnyNoteInc/AnyNote/commit/188227e528aca1cff9789140178db49228392eee))
- **trpc:** add getAvailableEmbeddingModels helper, exclude embeddings from LLM list ([7cb7d0d](https://github.com/AnyNoteInc/AnyNote/commit/7cb7d0d4206b5b6253e1b8d531eaab6ac057c08b))
- **trpc:** add page move, duplicate, favorites procedures ([dc207b2](https://github.com/AnyNoteInc/AnyNote/commit/dc207b23be7cc98a897c678ab58cd73617701c7b))
- **trpc:** add pageRouter with getById and listByWorkspace ([114e0b0](https://github.com/AnyNoteInc/AnyNote/commit/114e0b0464cb21ba3ef5119aa94a3270f8149436))
- **trpc:** add parentId to search chat list and create ([298bea1](https://github.com/AnyNoteInc/AnyNote/commit/298bea1bc8a57243e9921bdbabfb5700b7ff2ff6))
- **trpc:** add PlanFeatures type + getWorkspaceFeatures helper resolving plan by workspace owner ([2038e95](https://github.com/AnyNoteInc/AnyNote/commit/2038e95ef50568c758f7e26f9ae8f587d7b4207b))
- **trpc:** add requireWritableWorkspace guard for soft-downgrade enforcement ([83fa438](https://github.com/AnyNoteInc/AnyNote/commit/83fa4380151caaa136fb5514d140e888b69dd6e3))
- **trpc:** add searchRouter with echo message pipeline ([863151f](https://github.com/AnyNoteInc/AnyNote/commit/863151ff5ca947ed6c95254402737faff0c9506d))
- **trpc:** add subscription cancel/resume/getOrder/listOrders procedures ([caac1ef](https://github.com/AnyNoteInc/AnyNote/commit/caac1efd158b9e64e2d8ee23c52ac98a2442f6de))
- **trpc:** add userRouter (preferences, sessions, profile) ([cf88717](https://github.com/AnyNoteInc/AnyNote/commit/cf88717511d07458e2a6c5d06a2feb1954574acd))
- **trpc:** add workspace, subscription, integration routers ([07a1692](https://github.com/AnyNoteInc/AnyNote/commit/07a1692308406fa2ad20ff81d37b7c3a457c7ad0))
- **trpc:** emit outbox events from Page mutations ([242fe61](https://github.com/AnyNoteInc/AnyNote/commit/242fe61dcc7219e670407275e5bdd88b838df9f0))
- **trpc:** enforce soft downgrade workspace guards ([9b5f5c4](https://github.com/AnyNoteInc/AnyNote/commit/9b5f5c4604e2381bb6c717f2df4e2cb413041dda))
- **trpc:** expand page router with create, rename, softDelete, restore, hardDelete, listTrashed ([6de6a5c](https://github.com/AnyNoteInc/AnyNote/commit/6de6a5ce5b7e2eec35563311df9e287cd107d0cc))
- **trpc:** paginate file.listWorkspace with search and uploader filter ([998f688](https://github.com/AnyNoteInc/AnyNote/commit/998f68848e3a3492b5d54d886165c0f6a1b9a023))
- **trpc:** register block/page/search routers, drop loggerLink ([df59a0e](https://github.com/AnyNoteInc/AnyNote/commit/df59a0e42a0b7360ae874cc0483e02ccb259289a))
- **trpc:** return contentYjs as base64 from page.getById ([2c847db](https://github.com/AnyNoteInc/AnyNote/commit/2c847dbd561c21794e40e35359cc8ad8e9fa9b08))
- **trpc:** seed welcome page + blocks on workspace create ([664b08c](https://github.com/AnyNoteInc/AnyNote/commit/664b08cd87fee31f3162f5505aeec0753e6c2bab))
- **trpc:** update embeddings ai settings ([3100313](https://github.com/AnyNoteInc/AnyNote/commit/3100313b332a63c47ebbdc1567547e3465e3c027))
- **trpc:** workspace rename/members/delete with plan gating ([a0e3b29](https://github.com/AnyNoteInc/AnyNote/commit/a0e3b29b3eadee1b38873f87fde854dde43f0cc1))
- **ui:** add MUI X Tree View and new icons to shared UI package ([4aa86fa](https://github.com/AnyNoteInc/AnyNote/commit/4aa86fa727c9bd84d2a86e4ef13ccb03bc9bff11))
- **ui:** align MUI theme palette with Claude design and make home page theme-aware ([c0658f8](https://github.com/AnyNoteInc/AnyNote/commit/c0658f8cc18e614dedbc21db9e6da4b35a6e0474))
- **ui:** ChatMessageContent supports renderLink prop ([f43bed5](https://github.com/AnyNoteInc/AnyNote/commit/f43bed5ffb01e80a1628a7cedf0efd7c36700d66))
- **ui:** export KeyboardDoubleArrowLeftIcon, MenuIcon, Popper ([61619e6](https://github.com/AnyNoteInc/AnyNote/commit/61619e6060451f45aa32f3bd797f50e1455bfb8e))
- **ui:** propagate renderLink through ChatMessageList and ChatThread ([add0d95](https://github.com/AnyNoteInc/AnyNote/commit/add0d9503ec74fbd23526b3370c76248cf8da271))
- **ui:** re-export TablePagination and file-type icons ([2a3ad8a](https://github.com/AnyNoteInc/AnyNote/commit/2a3ad8a6ebd8662cce6178009ef112d14bcc5d1c))
- **ui:** refresh auth widgets for extended auth ([5b6350d](https://github.com/AnyNoteInc/AnyNote/commit/5b6350d7bb80fcdf295ad0e990231afdb7a96e2c))
- **ui:** rotate loading phrases while assistant is streaming ([7ab5697](https://github.com/AnyNoteInc/AnyNote/commit/7ab569720e84e3bc7a0df62c396a36cbd99fd7b5))
- **ui:** system theme preference with prefers-color-scheme ([8719e9d](https://github.com/AnyNoteInc/AnyNote/commit/8719e9d33a1054537087bfceedbd5880b6f689e0))
- **ui:** thin typography weights and extended palette tokens ([89488b9](https://github.com/AnyNoteInc/AnyNote/commit/89488b9fe692a59a52e444397eb8bac19fe64986))
- **web:** "AI чаты" link in workspace sidebar ([331e7b1](https://github.com/AnyNoteInc/AnyNote/commit/331e7b1f41219b1f8f2463a9b0ed3efa4b0e4810))
- **web:** /settings/account with sign out and sessions table ([10ac3d1](https://github.com/AnyNoteInc/AnyNote/commit/10ac3d13eb7d8625794eb7d4a87b1bfb82ef4108))
- **web:** /settings/billing with current plan and history ([60d732d](https://github.com/AnyNoteInc/AnyNote/commit/60d732d24dfe7375638272230c5f4ca498146453))
- **web:** /settings/general page with profile, theme, notifications ([9aaa2da](https://github.com/AnyNoteInc/AnyNote/commit/9aaa2dab79ce3167123075dae30681c63fb32f57))
- **web:** /settings/integrations with provider grid ([3227330](https://github.com/AnyNoteInc/AnyNote/commit/322733074e2048c2ef868abb61d3631695f70d37))
- **web:** /workspaces/[workspaceId] onboarding page ([6c0b406](https://github.com/AnyNoteInc/AnyNote/commit/6c0b4069649465aa8a419f118d373acc58bd32a9))
- **web:** /workspaces/new creation form ([236cb8e](https://github.com/AnyNoteInc/AnyNote/commit/236cb8eb87560c026d6f37a0615592f3209ccb3e))
- **web:** add (protected) route group with auth gate and tRPC provider ([f56256b](https://github.com/AnyNoteInc/AnyNote/commit/f56256b02c7ff63c6b38a719b15de27030d5df00))
- **web:** add @repo/storage dependency ([042732d](https://github.com/AnyNoteInc/AnyNote/commit/042732d767c95d19592b773d57ed7650a593751b))
- **web:** add /api/health route for container healthchecks ([293cb6e](https://github.com/AnyNoteInc/AnyNote/commit/293cb6e576d537a22be6e49efc85db179264fabd))
- **web:** add /api/yjs/token JWT issuer for yjs server ([c091212](https://github.com/AnyNoteInc/AnyNote/commit/c09121267e0df65b365a10caaf4c9acd6717af97))
- **web:** add /profile page with avatar and workspaces ([5a58927](https://github.com/AnyNoteInc/AnyNote/commit/5a58927fb50f26fb3e6663148046a72f88dd137e))
- **web:** add FileExtIcon component ([806d0d8](https://github.com/AnyNoteInc/AnyNote/commit/806d0d8ced2bb6ba134496800a3ee5f4eea8ec0c))
- **web:** add files tab to workspace settings nav ([b86bb33](https://github.com/AnyNoteInc/AnyNote/commit/b86bb33b499881d0001fb65d7a569223c3d4bb8a))
- **web:** add FilesDeleteDialog ([4e753fc](https://github.com/AnyNoteInc/AnyNote/commit/4e753fc9270b064a1ea378c41c217628749b145d))
- **web:** add FilesFilters chip row ([d241af0](https://github.com/AnyNoteInc/AnyNote/commit/d241af0475349ab0fe8e45a0a857c8d129044229))
- **web:** add FilesTableRow ([7d4b067](https://github.com/AnyNoteInc/AnyNote/commit/7d4b067b82c0af948de719cc4c588e027335e5f0))
- **web:** add Lora serif font and rebrand metadata ([c74ed4c](https://github.com/AnyNoteInc/AnyNote/commit/c74ed4ca66495fafd398a1c650989200a8b8fbec))
- **web:** add settings layout with 2-pane shell and left nav ([759ac52](https://github.com/AnyNoteInc/AnyNote/commit/759ac52807ad43c5b2eb7fea5718c2b2cffb0d2a))
- **web:** add workspace embedding model settings ([8fd2597](https://github.com/AnyNoteInc/AnyNote/commit/8fd2597ea6e7dbe28cc45c74f12df8ce3edddfe4))
- **web:** add workspace settings files page ([cc36b4c](https://github.com/AnyNoteInc/AnyNote/commit/cc36b4c4a7236d11ca74d0d362db272f4eb85901))
- **web:** add WorkspaceFilesSection ([db0eb17](https://github.com/AnyNoteInc/AnyNote/commit/db0eb179a4f90c4c2299eebc75fbccea16b020a4))
- **web:** allow creating pages of TEXT or EXCALIDRAW type ([21a4a2d](https://github.com/AnyNoteInc/AnyNote/commit/21a4a2daaa45ddef5383a885ed77824f12536294))
- **web:** chat links use Next Link for internal hrefs, sanitize external ([c0cb745](https://github.com/AnyNoteInc/AnyNote/commit/c0cb7451ab67bc125a650a7804021d7ea6f7f09d))
- **web:** chat list page ([03cb304](https://github.com/AnyNoteInc/AnyNote/commit/03cb3049324f78ce3f31e3d53b841dfb81902cfc))
- **web:** EditorContentSkeleton matches loading.tsx geometry ([b023a51](https://github.com/AnyNoteInc/AnyNote/commit/b023a51a92eeb74214dc9c96beaec46a52f85e4e))
- **web:** favorite star, full-width hook, page actions menu ([2933cb5](https://github.com/AnyNoteInc/AnyNote/commit/2933cb5caed11c717633e6bc24e1d398020e818b))
- **web:** GET /api/files/[id] download route ([f2c9ecd](https://github.com/AnyNoteInc/AnyNote/commit/f2c9ecd8701fd9afd626adb3dc89c169a4532591))
- **web:** page actions toolbar in breadcrumbs (star + more menu) ([28ae370](https://github.com/AnyNoteInc/AnyNote/commit/28ae370a3d244d7deea108e9ec010b66d23c601d))
- **web:** page export dialog — PDF (print), Markdown (turndown), HTML ([cee30d6](https://github.com/AnyNoteInc/AnyNote/commit/cee30d6d45b10eca80497ab155750a928958ca6e))
- **web:** PageView and BlockRenderer for data-driven pages ([acbb9fd](https://github.com/AnyNoteInc/AnyNote/commit/acbb9fd26f6560b8602c013471cdda1496659df6))
- **web:** persist chat history (Chat + ChatMessage) ([7ca5239](https://github.com/AnyNoteInc/AnyNote/commit/7ca5239a70bcbeb079944e8944c9bb3abd47e9d0))
- **web:** POST /api/files/upload route ([15179e4](https://github.com/AnyNoteInc/AnyNote/commit/15179e4ef398d01ddb79c034759a6bccaaf6b9bd))
- **web:** profile avatar upload UI ([73c1c01](https://github.com/AnyNoteInc/AnyNote/commit/73c1c01fa6132401cb3ecc9dfcab82f2e7b271f2))
- **web:** redirect /settings and /workspaces index routes ([ab39a4e](https://github.com/AnyNoteInc/AnyNote/commit/ab39a4efd0f70c11dfd146846e8d45909ed075b7))
- **web:** render workspace root via PageView from seeded blocks ([6caf851](https://github.com/AnyNoteInc/AnyNote/commit/6caf85119c1c30ba648fd616ec6738b39c537011))
- **web:** search chat view with echo pipeline ([bc07a93](https://github.com/AnyNoteInc/AnyNote/commit/bc07a9372e1f0dbe0fd221e96bf648520a6182f3))
- **web:** search index redirects to latest chat ([08825e1](https://github.com/AnyNoteInc/AnyNote/commit/08825e12d4e99d86e458e514ae6d6ed730a4dd9d))
- **web:** SSR theme from user preferences with cookie fallback ([98d352b](https://github.com/AnyNoteInc/AnyNote/commit/98d352bca4c9057fdddb4553c49e238cdb0f396e))
- **web:** TEXT page skeleton + hash-anchor scroll/highlight ([0afcbb4](https://github.com/AnyNoteInc/AnyNote/commit/0afcbb4f2aba0dea3a5433086accbc8195128f79))
- **web:** thread contentYjs through PageRenderer to editor/board ([8790c97](https://github.com/AnyNoteInc/AnyNote/commit/8790c97ca1d7c61087ca40e9d02d9500fb224d0d))
- **web:** wire extended auth pages and recaptcha ([6c5e720](https://github.com/AnyNoteInc/AnyNote/commit/6c5e7202db88304cafd035b22437bc7edd7739b5))
- **web:** wire packages/chat to apps/agents (real SSE chat) ([02d256b](https://github.com/AnyNoteInc/AnyNote/commit/02d256bdb2c0625bbd9eec516a380f3034661fa4))
- **web:** workspace AI settings page (Pillar F-mini) ([a5c15fc](https://github.com/AnyNoteInc/AnyNote/commit/a5c15fc0c84e2bad118607553a2ff5c4cb0bc535))
- **web:** workspace footer user menu ([13839fa](https://github.com/AnyNoteInc/AnyNote/commit/13839fac1932063a1fa26eb121d61b8586d51e56))
- **web:** workspace settings danger zone (delete) ([b45ffe6](https://github.com/AnyNoteInc/AnyNote/commit/b45ffe63b1fe778d5cc591d9a544d1b50c41821c))
- **web:** workspace settings general (rename, plan-gated) ([37ab7a8](https://github.com/AnyNoteInc/AnyNote/commit/37ab7a84963323631424eedb779b66eae63ab847))
- **web:** workspace settings layout and nav ([9c5c748](https://github.com/AnyNoteInc/AnyNote/commit/9c5c7485798e79447ebd008d67de5f69a5c7b8fb))
- **web:** workspace settings members (invite/remove, gated) ([e0758d8](https://github.com/AnyNoteInc/AnyNote/commit/e0758d82006697d3c1dd3dcc6db2b094bda2477b))
- **web:** workspace shell layout with forced dark theme ([06e7d59](https://github.com/AnyNoteInc/AnyNote/commit/06e7d593ab95bfc413e495398ef388e2baba5683))
- **web:** workspace sidebar with search section and collapse ([53d2bf5](https://github.com/AnyNoteInc/AnyNote/commit/53d2bf5837964d87355e1f74f07785571da0e494))
- **web:** workspace sidebar, toolbar, onboarding, AI panel, cookie banner ([2c233c2](https://github.com/AnyNoteInc/AnyNote/commit/2c233c268e2a0546bfca5946398781c94a174f5a))
- **web:** yjs/upload helpers and PageRenderer factory ([e7a8606](https://github.com/AnyNoteInc/AnyNote/commit/e7a86066b2297b10ea8480318477a04260d711b7))
- wire two-state sidebar model in WorkspaceLayoutClient ([25bbb89](https://github.com/AnyNoteInc/AnyNote/commit/25bbb89eb99f709c5707b6dd26fce3e74cfb7e26))
- wire userId and expanded page data through layout ([b6b6d0e](https://github.com/AnyNoteInc/AnyNote/commit/b6b6d0e4c25889d9a2d19d30555c02a973284c29))
- work ai agent ([d82d3b3](https://github.com/AnyNoteInc/AnyNote/commit/d82d3b33018b2cdbbe4737d0db72436e38eff848))
- work graph ([ba4bfad](https://github.com/AnyNoteInc/AnyNote/commit/ba4bfad028d150e88b12be8b35889aeaf5cbc16d))
- **workspace:** gate /chats route by features.chatsEnabled ([82f1d8e](https://github.com/AnyNoteInc/AnyNote/commit/82f1d8efc2751005cf2fd68c12cb0b70c397ac8c))
- **workspace:** gate /settings/members and /settings/ai by plan features ([b049ff2](https://github.com/AnyNoteInc/AnyNote/commit/b049ff2d7214e7257027fbfbe888c4703c3cea5f))
- **workspace:** resolve PlanFeatures at layout level and provide via context ([b863e9c](https://github.com/AnyNoteInc/AnyNote/commit/b863e9c5d9658852758790c553fde37a4194b90c))
- WorkspaceToolbar MenuIcon with hover Popper for hidden sidebar ([9f5011e](https://github.com/AnyNoteInc/AnyNote/commit/9f5011efe6ff593d8e84dd6e214c32f15b3243ba))
- **yjs:** canAccessPage returns workspaceId ([39ce760](https://github.com/AnyNoteInc/AnyNote/commit/39ce760e5213355c0fd594dab3e5c9a02b4f5aba))
- **yjs:** hocuspocus server with JWT auth and prisma persistence ([b2282e1](https://github.com/AnyNoteInc/AnyNote/commit/b2282e1628faff04a41970023fb7da2f5cec9c4f))
- **yjs:** outbox insert + excalidraw snapshot + atomic tx ([a385535](https://github.com/AnyNoteInc/AnyNote/commit/a385535f309cb16167a31e483ec217f6fac0cdaa))
- **yjs:** propagate workspaceId through AuthContext and onStoreDocument ([df4ea65](https://github.com/AnyNoteInc/AnyNote/commit/df4ea655b3e82c77d4d920351bd4f6f2d69856aa))
- **yookassa:** add createRefund and getRefund methods ([7d337f7](https://github.com/AnyNoteInc/AnyNote/commit/7d337f7fa42eaae26a6ca31b804879d9d6c568f6))
- **yookassa:** add saved-method charge and payment lookup ([d80e866](https://github.com/AnyNoteInc/AnyNote/commit/d80e86657a95a172c5c5c66aa4202f9f788d0d2b))
- **yookassa:** add webhook event parser and IPv4 CIDR allowlist check ([f8f8a2d](https://github.com/AnyNoteInc/AnyNote/commit/f8f8a2d2cb461d4839cb716d6f4408a2bc1d7956))
- **yookassa:** implement YookassaClient.createPayment with Basic auth + idempotency ([8726603](https://github.com/AnyNoteInc/AnyNote/commit/872660356375cab8fd191d7f2d4fdf17b58f0953))
- **yookassa:** scaffold YooKassa workspace package ([cc74ec2](https://github.com/AnyNoteInc/AnyNote/commit/cc74ec2084b73661e927d059f1fa7ffede59cf4e))

### Performance Improvements

- **agents:** batch embed calls in VectorizePageUseCase (Fix 4) ([6c518a4](https://github.com/AnyNoteInc/AnyNote/commit/6c518a4eb729c8aff0c378599107ca869a9b5c1b))
- **engines:** parallelize processBatch with Promise.all (Fix 5) ([0e91f11](https://github.com/AnyNoteInc/AnyNote/commit/0e91f110cabc575d0b2b6be020329e84846ad6de))
