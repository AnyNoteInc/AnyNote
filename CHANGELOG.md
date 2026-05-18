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
