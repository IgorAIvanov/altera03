---
name: model-feature-architecture
description: Design or refactor a model into a feature-centered structure where frontend UI files and database SQL source live together under frontend/src/app/<model>.
argument-hint: Describe the model name and what screens, dialogs, pickers, and DB functions it needs.
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
- shared frontend localization infrastructure should live outside the model folder, for example under app/i18n/

Recommended model contents:
- manifest.json
- optional prints/<template>.template.json files when the model ships seeded print forms through manifest `prints` metadata
- <Model>Edit.ts
- <Model>List.ts — extend `ModelListBase` via the [model-list-form](../model-list-form/SKILL.md) skill; the subclass only declares model, edit route, and columns
- <Model>Dialog.ts
- <Model>Picker.ts
- optional <Model>CardPage.ts when create/edit lives on its own routed card page
- optional <Model>PickerDialog.ts when picker and nested create flow need one host component
- optional <model>.api.ts when the feature has non-standard frontend transport or extra model-specific commands
- <model>.schema.ts — the TypeBox single source of truth for item, row, lookup, payload, and response shapes. Define it with the [typebox-model-schema](../typebox-model-schema/SKILL.md) skill. Do not hand-write parallel `<model>.types.ts` interfaces.
- db/struc.sql
- db/migration.sql
- db/data.sql
- db/<model>.sql
- ../sql.json entry in /app

Recommended backend contents for the generic runtime pattern:
- model-runtime/model-runtime.controller.ts
- model-runtime/model-runtime.service.ts
- model-runtime/model-registry.ts
- model-runtime/models/<model>.config.ts only when the model needs explicit backend configuration

Workflow:
1. Identify the model boundary and its screens.
2. Group all model-specific UI and contract files together.
3. Add manifest.json and declare the model key, required `type`, SQL `schema`, routed views such as list, picker and edit.
4. Define `<model>.schema.ts` with the [typebox-model-schema](../typebox-model-schema/SKILL.md) skill before writing UI or SQL. This TypeBox file is the single source of truth: every UI component imports its types from here, and the SQL function contract mirrors its payload and response shapes. Do not start a model without it.
5. Identify the model family before locking the SQL contract: catalog-style models usually use List, Pick, Edit, Delete. Loockup; document models use the same base contract plus standard `post` and `unpost`; information registers may need history, slice, actual-on-date, or bulk-record commands.
6. Assume the backend generic runtime can serve the standard commands without a dedicated model module.
7. Use the shared frontend model runtime helper directly for standard commands unless a thin model-local wrapper adds real value.
8. Add a backend model config file only when the model needs extra domain commands or backend-side customization.
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
- `schema` identifies the SQL schema that owns the model objects and should normally be `app` unless the feature deliberately lives in another lowercase SQL schema.
- `type: document` is reserved for true editable document models and must declare `views.edit`.
- An information-register model is still a first-class model in the same architecture, but it may have a different SQL command set than a catalog or document card.
- The app shell can build routes from model-local manifest.json files at build time. Standard models should fit that routed-feature contract instead of registering routes manually.
- For standard model commands, direct use of the shared frontend runtime client is preferred over duplicating identical <model>.api.ts wrappers in every model folder.
- A dedicated backend controller/service/module should be treated as an exception path for specialized behavior, not as the default for every model.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — define the model's `<model>.schema.ts` (TypeBox single source of truth for types, validation, and UI roles). Always pair with this skill when building a model.
- [model-list-form](../model-list-form/SKILL.md) — build `<Model>List.ts` by extending the shared `ModelListBase` instead of hand-writing the toolbar, table, sort, and pagination.
- [db-function-contract](../db-function-contract/SKILL.md) — SQL function naming and the JSON response envelope.
- [TypeBox on GitHub](https://github.com/sinclairzx81/typebox) — schema library reference.
