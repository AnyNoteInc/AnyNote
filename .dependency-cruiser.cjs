// Tier model — see docs/superpowers/specs/2026-05-29-architecture-layering-design.md
// Imports may only point downward. `$1` in `to.pathNot` back-references the package
// name captured in `from.path`, allowing intra-package imports while forbidding peers.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No cyclic dependencies between modules.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable-repo-import',
      comment:
        'A @repo/* import depcruise cannot resolve is otherwise dropped silently, blinding the ' +
        'tier rules below. Surface it. (check-types co-guards: an unresolved import is also TS2307.)',
      severity: 'error',
      from: { path: '^(packages|apps)/' },
      to: { couldNotResolve: true, path: '^@repo/' },
    },
    {
      name: 'adapters-are-pure',
      comment: 'Tier 1 (db/mail/storage/yookassa) import no other @repo package (db ok).',
      severity: 'error',
      from: { path: '^packages/(db|mail|storage|yookassa)/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/db/', '^packages/$1/', '^packages/(eslint-config|typescript-config)/'],
      },
    },
    {
      name: 'infra-auth-tier',
      comment:
        'Tier 2 top (auth) imports only adapters + lower infra (notifications). Not the reverse.',
      severity: 'error',
      from: { path: '^packages/auth/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/(auth|notifications)/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'infra-notifications-tier',
      comment: 'Tier 2 mid (notifications) imports only adapters — never upward to auth.',
      severity: 'error',
      from: { path: '^packages/notifications/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/notifications/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'infra-page-export-tier',
      comment:
        'Tier 2 (page-export) imports only adapters — @repo/editor stays out (the engines Node runtime loads this package as raw .ts).',
      severity: 'error',
      from: { path: '^packages/page-export/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/page-export/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'domain-only-adapters',
      comment: 'Tier 3 (domain) imports only adapters.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/domain/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'domain-dto-no-upward',
      comment: 'Domain DTO layer imports nothing from repositories/services (data has no internal deps).',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/dto/' },
      to: { path: '^packages/domain/src/[^/]+/(repositories|services)/' },
    },
    {
      name: 'domain-dto-no-inversify',
      comment: 'Domain DTO leaves stay client-safe — never import inversify.',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/dto/' },
      to: { path: '^inversify($|/)' },
    },
    {
      name: 'domain-repo-no-services',
      comment: 'Domain repositories never import services (no upward edge).',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/repositories/' },
      to: { path: '^packages/domain/src/[^/]+/services/' },
    },
    {
      name: 'domain-services-no-db-value',
      comment: 'Domain services never import @repo/db as a value (type-only ok) — I/O lives in repositories.',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/services/' },
      to: { path: '^packages/db/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'domain-module-isolation',
      comment: 'A domain module reaches another module only via its index.ts barrel or shared/, not deep internals.',
      severity: 'error',
      from: { path: '^packages/domain/src/([^/]+)/(dto|repositories|services)/' },
      to: {
        path: '^packages/domain/src/([^/]+)/',
        pathNot: [
          '^packages/domain/src/$1/',
          '^packages/domain/src/shared/',
          '^packages/domain/src/[^/]+/index\\.ts$',
        ],
      },
    },
    {
      name: 'ui-foundation-pure',
      comment: 'ui & diagram-board import no other @repo package.',
      severity: 'error',
      from: { path: '^packages/(ui|diagram-board)/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/$1/', '^packages/(eslint-config|typescript-config)/'],
      },
    },
    {
      name: 'feature-ui-foundation-only',
      comment: 'Feature UI imports only the UI foundation (ui/diagram-board).',
      severity: 'error',
      from: { path: '^packages/(drawio|excalidraw|genogram|likec4|mermaid|plantuml)/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(ui|diagram-board)/',
          '^packages/$1/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'editor-composite-ui',
      comment: 'editor (composite) imports only ui/diagram-board/mermaid/plantuml.',
      severity: 'error',
      from: { path: '^packages/editor/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(ui|diagram-board|mermaid|plantuml|editor)/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'engines-no-trpc',
      comment: 'engines reaches business logic via @repo/domain, never @repo/trpc.',
      severity: 'error',
      from: { path: '^apps/engines/src' },
      to: { path: '^packages/trpc/' },
    },
    {
      name: 'packages-no-import-apps',
      comment: 'Library packages must never import a presentation app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^(packages|apps)/',
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
}
