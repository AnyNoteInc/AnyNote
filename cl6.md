# Imports and exports

## Описание фазы

Эта фаза добавляет migration center: imports from Markdown/Text, HTML, ZIP
folders, Notion-style export ZIPs, CSV into databases, documented third-party
service import paths, AnyNote/Yandex Wiki migration path, and exports for
workspace, collection, subtree, page and database.

## Полный ожидаемый результат

- ImportJob/ExportJob infrastructure exists with artifacts, mapping, statuses, logs and retention.
- Import Center and Export Center are available in workspace/settings UI.
- Markdown/Text, HTML and ZIP import builds page tree with files where possible.
- Workspace/collection/subtree/page export works in Markdown & CSV ZIP and HTML
  ZIP where supported.
- Notion-style export ZIP import handles Markdown/CSV or HTML exports: pages,
  subpages, assets and basic database CSV mapping.
- Documented app migration paths are represented honestly: Confluence-like page
  trees, Asana-like projects/tasks and Monday-like boards map to AnyNote pages
  and databases only where credentials, exports or fixtures make the behavior
  implementable.
- Yandex Wiki path is implemented or honestly limited with clear wizard
  messaging, and is labeled as an AnyNote/Yandex-market extension rather than
  Notion parity.
- CSV database import/export works.
- PDF export works for selected safe scopes; bulk PDF is conservative and never
  bypasses access rules.

## Scope и ограничения

Long-running operations should use jobs. If true background execution is
unavailable, MVP must clearly limit file sizes/scope and preserve job logs.
Personal/private data must be excluded unless explicitly selected and
authorized. Workspace exports must exclude pages the exporter cannot access;
owner/admin access expansion, if AnyNote has an equivalent to Enterprise content
search, must be explicit, audited and limited to future exports. Export format
availability should follow Notion behavior where it applies: pages/databases can
export as PDF, HTML, or Markdown & CSV; full-page databases export rows as CSV
with page content as Markdown; workspace export supports HTML or Markdown/CSV,
with PDF only for the safe/admin scopes AnyNote can actually support.

## Рабочее задание фазы

Цель: добавить import/export center: workspace/collection/subtree/page/database,
Markdown/Text, HTML, ZIP, Notion-style export ZIP, documented app imports,
AnyNote/Yandex Wiki, CSV database, PDF/HTML/Markdown exports.

## Prompt 6.1 - ImportJob/ExportJob infrastructure

```text
Цель: создать async job foundation for imports/exports.

Ориентиры по коду и текущей реализации:
- existing page export server code under apps/web/src/server/page-export
- file/storage package
- packages/trpc/src/routers/file.ts
- apps/engines cleanup/cron patterns if workers should live there

Сделай:
1. Добавь models:
   - ImportJob;
   - ImportArtifact;
   - ImportMapping;
   - ExportJob;
   - ExportArtifact.
2. Определи worker location:
   - if current app has background workers, use them;
   - otherwise create clear service layer and mark execution sync for MVP only
     if safe for small jobs.
3. Add tRPC:
   - listImportJobs;
   - createImportJob/upload artifact;
   - cancelImportJob if supported;
   - listExportJobs;
   - createExportJob;
   - deleteExportArtifact;
   - read job warnings/logs for progress and audit.
4. UI shell:
   - settings/import page;
   - settings/export page;
   - job lists with statuses;
   - clear source/format labels so Notion-parity paths, generic file paths and
     AnyNote-specific extensions are distinguishable.
5. Tests:
   - job lifecycle;
   - permission checks;
   - storage quota validation;
   - inaccessible/private pages are skipped and logged in export jobs.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Product has a place and API for long-running imports/exports.
```

## Prompt 6.2 - File imports and workspace/collection export

```text
Цель: реализовать first useful import/export path aligned with Notion file
import/export behavior.

Ориентиры по коду и текущей реализации:
- ImportJob/ExportJob foundation
- existing Markdown/HTML page import/export behavior
- page creation/copy services
- collection/page tree models

Сделай:
1. FileTreeImporter:
   - single .md/.markdown/.txt, .html and ZIP upload;
   - zipped folder structure -> pages tree;
   - Markdown body -> AnyNote page content;
   - HTML headings/paragraphs/lists/code/simple tables -> closest supported
     AnyNote blocks or text;
   - assets -> PageFile where feasible;
   - unsupported styling/scripts/embeds/nonstandard Markdown become warnings,
     not silent loss.
2. ExportWorker:
   - workspace scope;
   - collection scope;
   - subtree scope;
   - page scope;
   - database scope if Phase 3 exists;
   - Markdown & CSV ZIP with files/assets;
   - HTML ZIP with files/assets;
   - include subpages/folder structure option where safe;
   - workspace export excludes private/inaccessible pages and logs skipped
     paths.
3. UI:
   - ImportDropzone for Markdown/Text, HTML and ZIP;
   - ExportScopePicker;
   - ExportFormatPicker with Markdown & CSV, HTML and PDF options constrained
     by scope;
   - download prepared archive.
4. Tests:
   - import simple tree;
   - import HTML page with asset;
   - import assets if supported;
   - export collection contains expected files;
   - personal collections/private pages excluded unless explicit and
     authorized;
   - full-page database export emits CSV plus page Markdown when database
     models exist.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Teams can move basic documentation in/out of AnyNote.
```

## Prompt 6.3 - Notion-style ZIP, app imports and AnyNote/Yandex Wiki path

```text
Цель: добавить competitive migration paths without claiming false Notion parity.

Ориентиры по коду и текущей реализации:
- Notion export ZIP structure examples if available in docs/fixtures, otherwise
  create minimal Markdown & CSV and HTML fixtures manually in tests.
- Official Notion behavior to mirror: file imports include Markdown/Text, HTML,
  CSV and ZIP; app importers include documented Confluence/Asana/Monday-style
  migrations with progress/logs and known limitations; imports do not preserve
  permissions/history automatically.
- Yandex Wiki export/extension assumptions: импорт идет через ZIP/Markdown-like
  структуру или через documented limitation, если точный формат недоступен.
  Этот путь является AnyNote/Yandex-market extension, не Notion parity.
- FileTreeImporter, созданный в задаче 6.2 этой фазы

Сделай:
1. NotionExportZipParser:
   - Markdown & CSV export ZIP;
   - HTML export ZIP;
   - pages/subpages/folders/tree;
   - files/assets with relative paths;
   - database CSV detection;
   - basic property mapping to generic database when Phase 3 exists;
   - unsupported Notion blocks, comments, formulas/relations/rollups/history and
     permission gaps become warnings.
2. ThirdPartyImportWizard:
   - Confluence path: ZIP/API-like import if implementable, mapping pages,
     hierarchy, images and attachments; permissions and history are not imported.
   - Asana path: projects/tasks/subtasks/sections/assignees/due dates/comments
     and attachments map to project/task databases only if OAuth/API support is
     actually implemented; otherwise show an honest unavailable-in-MVP state.
   - Monday path: boards/groups/items/comments/files map to regular databases
     or projects/tasks only if API token support is actually implemented;
     unsupported columns/automations/dependencies are logged.
   - Every app import is one-time, scoped to what the authenticated user/export
     can access, and creates an import log.
3. YandexWikiImportWizard:
   - UI instructions;
   - label as AnyNote/Yandex-market extension;
   - importer for exported markdown/zip shape if known;
   - documented limitation if exact format or API is unavailable.
4. Generic service import wizard:
   - upload ZIP;
   - choose target collection;
   - show limitations.
5. ImportLogViewer:
   - warnings;
   - unsupported blocks;
   - skipped private/inaccessible items;
   - downloadable log.
6. Tests with fixtures:
   - Notion Markdown & CSV export page tree;
   - Notion HTML export with assets;
   - Notion database CSV -> database source;
   - Confluence-like page tree or app-unavailable state;
   - Yandex Wiki path is clearly labeled as AnyNote extension;
   - unsupported block warning.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Import flow is honest about limitations and useful for real migration.
```

## Prompt 6.4 - CSV database import/export and PDF bulk export

```text
Цель: закрыть database CSV and PDF export gaps with Notion-like constraints.

Ориентиры по коду и текущей реализации:
- Database models from Phase 3
- existing page PDF export server code
- Import/export foundation

Сделай:
1. CSV import:
   - upload CSV;
   - mapping columns -> database properties;
   - create database source/table view;
   - type inference with user override.
2. CSV export:
   - selected database/view, default view or current view only;
   - respect filters, sorts, page-level access and property visibility.
3. PDF bulk export:
   - page/database -> PDF;
   - subtree/collection -> archive of PDFs only for small safe scopes;
   - workspace all collections -> disabled unless owner/admin safe export is
     already supported; otherwise use HTML or Markdown & CSV workspace export;
   - if rendering fails, record failure and offer HTML export instead of silently
     producing incomplete PDFs.
4. Tests:
   - CSV import creates rows/properties;
   - CSV export respects hidden/inaccessible properties and current/default view
     rules;
   - PDF bulk export completes for small fixture;
   - workspace PDF export is blocked or audited according to permissions.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Export/import center covers docs and databases.
```
