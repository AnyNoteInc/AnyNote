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
      name: 'infra-only-adapters',
      comment: 'Tier 2 (notifications/auth) import only adapters + infra.',
      severity: 'error',
      from: { path: '^packages/(notifications|auth)/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/(notifications|auth)/',
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
