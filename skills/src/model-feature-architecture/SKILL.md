---
name: model-feature-architecture
description: Design or refactor a model into a feature-centered structure where frontend UI files and database SQL source live together under app/<family>/<model>.
argument-hint: Describe the model name and what screens, dialogs, pickers, and DB functions it needs.
metadata:
  audience: app
---

# Model Feature Architecture Skill

Use this skill when:
- creating a new model feature
- refactoring flat pages into model folders
- defining the file layout for a BAS-like screen set
- deciding where to place page, form, dialog, picker, types, and SQL source files
- defining manifest-driven routes for a feature and keeping shell metadata ownership explicit

Target structure:
- /app/<family>/<model>/
- UI files stay with the model
- manifest.json in the model folder declares the model key, required model family `type`, SQL `schema`, routed views
- model-local print template source files belong under app/<model>/prints/ when the model owns system print forms
- when shell menu is driven from SQL, keep shell menu ownership in SQL
- DB SQL source for model functions also stays with the model
- backend only calls published PostgreSQL functions
- backend generic model runtime lives separately from model UI folders
- translation strings belong to the model too: `app/<family>/<model>/_locales/<code>.json` holds every key the model's screens use. `app/_locales/*.json` is the merged build output (`deno task locales:build`) — never edit it by hand, the next build overwrites it. Keys that genuinely belong to no single model (`common.*`, `document.*`) go to `app/shared/_locales/`. Framework-wide keys already ship inside `@altera/client`; do not redefine them.

Recommended model contents:
- manifest.json
- optional prints/<template>.template.json files when the model ships seeded print forms through manifest `prints` metadata
- <Model>Edit.ts
- <Model>List.ts — extend `ModelListBase` via the [model-list-form](../model-list-form/SKILL.md) skill; the subclass only declares model, edit route, and columns
- <Model>Dialog.ts
- <Model>Picker.ts — extend `ModelPickerBase` via the [model-picker-form](../model-picker-form/SKILL.md) skill; the subclass only declares model and columns
- optional <Model>CardPage.ts when create/edit lives on its own routed card page
- optional <Model>PickerDialog.ts when picker and nested create flow need one host component
- optional <model>.api.ts when the feature has non-standard frontend transport or extra model-specific commands
- <model>.schema.ts — the TypeBox single source of truth for item, row, lookup, payload, and response shapes. Define it with the [typebox-model-schema](../typebox-model-schema/SKILL.md) skill. Do not hand-write parallel `<model>.types.ts` interfaces.
- _locales/<code>.json — one file per language, holding the model's own keys; run `deno task locales:build` after editing
- db/struc.sql
- db/migration.sql
- db/data.sql
- db/<model>.sql
- ../sql.json entry in /app

Recommended backend contents for the generic runtime pattern:
- model-runtime/model-runtime.controller.ts
- model-runtime/model-runtime.service.ts
- model-runtime/model-registry.ts
- a TS command file colocated with the model (`app/<family>/<model>/db/<model>.commands.ts`) only when the model needs an extra command that cannot be a plain SQL function; declare it in `manifest.json` under `commands.ts` (see [db-function-contract](../db-function-contract/SKILL.md))

Workflow:
1. Identify the model boundary and its screens.
2. Group all model-specific UI and contract files together.
3. Add manifest.json and declare the model key, required `type`, SQL `schema`, routed views such as list, picker and edit.
4. Define `<model>.schema.ts` with the [typebox-model-schema](../typebox-model-schema/SKILL.md) skill before writing UI or SQL. This TypeBox file is the single source of truth: every UI component imports its types from here, and the SQL function contract mirrors its payload and response shapes. Do not start a model without it.
5. Identify the model family before locking the SQL contract — `deno task sql:gen` generates a different set per `type`: `catalog` → `list`/`get`/`save`/`delete`(/`undelete`)/`lookup`; `document` → the same plus `post`/`unpost`; `register` → the same as a catalog but **without** `lookup`; `report` → the `index` wrapper only, the query itself stays hand-written. A register's own period-based reading (history, slice, actual-on-date) is not generated — write it in `db/<model>.custom.sql`.
6. Assume the backend generic runtime can serve the standard commands without a dedicated model module.
7. Use the shared frontend model runtime helper directly for standard commands unless a thin model-local wrapper adds real value.
8. Add a TS command (manifest `commands.ts` → colocated `db/<model>.commands.ts`) only when the model needs an extra command that cannot be a plain SQL function; standard commands stay SQL-backed.
9. Add extra domain commands only when the model needs them.
10. Keep app shell concerns such as router, layout, providers, and shared localization dictionaries outside the model folder.
11. Keep app-shell route resolution, menu highlighting, and workspace-tab recognition tied to the same generated feature route list from buildFeatureRoutes(); do not use an empty or manually stubbed route map in layout code.

Localization notes:
- Keep translatable business UI text in shared locale JSON files rather than embedding permanent user-facing strings in feature components.
- Components should request localized text through a shared frontend hook/provider such as t('model.key').
- Do not design runtime text replacement around marker syntax such as @[Key]; it is harder to trace, type, and maintain than direct translation key usage.

Output expectations:
- target folder tree
- file responsibilities
- function naming convention
- JSON response contract for list, form, and picker screens

Architecture notes:
- A standard model can be fully functional with frontend model files, SQL package files, published PostgreSQL functions, and a generic backend runtime.
- Current manifest contract requires `model`, `type`, and `schema` for routed features.
- Manifest may optionally include `agent.allow`, `agent.allowCommands`, `agent.aliases`, and `agent.priority` for LLM access control, model discovery, and fallback ordering.

Agent discovery — `agent.aliases` and `agent.priority`:
- An external agent picks a model out of the catalog it reads from `GET /api/agent/tools`: technical name, titles taken from the locales, and these aliases. On a real solution that catalog is fifty to a hundred models, and the technical name is the least useful of the three — a person asks for «оборотка» or «расходная накладная», never for `turnover_balance`. Fill aliases when you add the model; retrofitting them across a finished solution is a separate chore nobody schedules.
- Aliases are the words the trade actually uses, not translations of the technical name. Take them from the domain, and include the other language the users speak: an alias is not a translation, it is what someone will actually type.
- Singular and plural both, when both are used.
- **An alias must be unique across the whole application.** A word that fits two models helps with neither — the agent cannot choose, and ambiguity is worse than absence. Check after regenerating: duplicates are silent, because each manifest is edited on its own day.
- Three to six per model. A longer list adds nothing: the agent matches, it does not read a dictionary.
- Do not repeat the title. It is already in the catalog next to the aliases, so `"картка рахунку"` on a model titled «Картка рахунку» buys nothing and costs bytes on every read — measured at a quarter of all aliases on the first solution that filled them. What earns its place is what the title is not: the short form («осв по рахунку»), the other language, the word from habit rather than from the form's caption.
- `priority` (default 0) orders the catalog. Set it to 10 for the dozen models used daily; leave the rest alone. What the agent sees first should be what people work with most.
- Both fields reach the catalog through `deno task sql:registry` — the generated `agent-routes` file is what the server serves, so a manifest edit without regeneration changes nothing.
- `schema` identifies the SQL schema that owns the model objects and should normally be `app` unless the feature deliberately lives in another lowercase SQL schema.
- `type: document` is reserved for true editable document models and must declare `views.edit`.
- An information-register model is a first-class model in the same architecture and gets the same generated CRUD as a catalog (minus `lookup`); what differs is the reading it adds on top — value on a date, history, slice.
- Every generated table needs `created_at` and `updated_at`: `save` writes `updated_at = now()` unconditionally. Without them generation is green, publishing is green, and the first write fails.
- The app shell can build routes from model-local manifest.json files at build time. Standard models should fit that routed-feature contract instead of registering routes manually.
- For standard model commands, direct use of the shared frontend runtime client is preferred over duplicating identical <model>.api.ts wrappers in every model folder.
- A dedicated backend controller/service/module should be treated as an exception path for specialized behavior, not as the default for every model.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — define the model's `<model>.schema.ts` (TypeBox single source of truth for types, validation, and UI roles). Always pair with this skill when building a model.
- [model-list-form](../model-list-form/SKILL.md) — build `<Model>List.ts` by extending the shared `ModelListBase` instead of hand-writing the toolbar, table, sort, and pagination.
- [model-list-filters](../model-list-filters/SKILL.md) — the filter panel of that list: the `x-filter` annotation, the generated SQL and the markup, wired together.
- [model-picker-form](../model-picker-form/SKILL.md) — build `<Model>Picker.ts` by extending the shared `ModelPickerBase`.
- [db-function-contract](../db-function-contract/SKILL.md) — SQL function naming and the JSON response envelope.
- [TypeBox on GitHub](https://github.com/sinclairzx81/typebox) — schema library reference.
