/**
 * SQL ядра — схема, без якої не працює жоден застосунок на цьому фреймворку:
 * користувачі й сесії, вкладення, документи з проводками, шаблони друку, довідка.
 *
 * Файли лишаються звичайними `.sql` (їх редагують і читають як SQL), а сюди
 * потрапляють text-імпортами. Завдяки цьому вони їдуть у складі опублікованого
 * пакета й резолвляться однаково — і з робочої копії, і з jsr.
 *
 * Порядок підключення задає НЕ цей файл, а `sql.json` застосунку: `document_core`
 * посилається на `chart_of_account`, `currency` і `organization`, тобто ядро й
 * моделі застосунку чергуються за FK. Тому кожен пакет ядра підключається
 * окремим записом `@core/<назва>`, і застосунок ставить його туди, куди треба.
 */

import baseStruc from "./base/db/struc.sql" with { type: "text" };
import baseMigration from "./base/db/migration.sql" with { type: "text" };
import baseModel from "./base/db/base.sql" with { type: "text" };
import baseData from "./base/db/data.sql" with { type: "text" };

import accessStruc from "./access/db/struc.sql" with { type: "text" };
import accessMigration from "./access/db/migration.sql" with { type: "text" };
import accessModel from "./access/db/access.sql" with { type: "text" };
import accessData from "./access/db/data.sql" with { type: "text" };

import attachmentStruc from "./attachment/db/struc.sql" with { type: "text" };
import attachmentModel from "./attachment/db/attachment.sql" with { type: "text" };

import documentCoreStruc from "./document_core/db/struc.sql" with { type: "text" };
import documentCoreMigration from "./document_core/db/migration.sql" with { type: "text" };
import documentCoreModel from "./document_core/db/document_core.sql" with { type: "text" };
import documentCoreData from "./document_core/db/data.sql" with { type: "text" };

import helpContentStruc from "./help_content/db/struc.sql" with { type: "text" };
import helpContentMigration from "./help_content/db/migration.sql" with { type: "text" };
import helpContentModel from "./help_content/db/help_content.sql" with { type: "text" };
import helpContentData from "./help_content/db/data.sql" with { type: "text" };

import helpScenarioStruc from "./help_scenario/db/struc.sql" with { type: "text" };
import helpScenarioMigration from "./help_scenario/db/migration.sql" with { type: "text" };
import helpScenarioModel from "./help_scenario/db/help_scenario.sql" with { type: "text" };
import helpScenarioData from "./help_scenario/db/data.sql" with { type: "text" };

import printTemplateStruc from "./print_template/db/struc.sql" with { type: "text" };
import printTemplateMigration from "./print_template/db/migration.sql" with { type: "text" };
import printTemplateModel from "./print_template/db/print_template.sql" with { type: "text" };
import printTemplateData from "./print_template/db/data.sql" with { type: "text" };

/** Кроки складання пакета — ті самі, що й у моделей застосунку. */
export type CoreSqlStep = "structure" | "migrations" | "models" | "data";

/** Один файл ядра: шлях (для заголовка секції) і текст. */
export interface CoreSqlFile {
  /** Шлях відносно кореня пакета — потрапляє в коментар-заголовок секції. */
  path: string;
  sql: string;
}

/** Пакет ядра: назва (як у `@core/<назва>`) і файли по кроках. */
export interface CoreSqlPackage {
  name: string;
  files: Partial<Record<CoreSqlStep, CoreSqlFile[]>>;
}

function file(path: string, sql: string): CoreSqlFile {
  return { path, sql };
}

export const CORE_SQL_PACKAGES: CoreSqlPackage[] = [
  {
    name: "base",
    files: {
      structure: [file("base/db/struc.sql", baseStruc)],
      migrations: [file("base/db/migration.sql", baseMigration)],
      models: [file("base/db/base.sql", baseModel)],
      data: [file("base/db/data.sql", baseData)],
    },
  },
  // access іде одразу за base: attachment і document посилаються на app.users.
  {
    name: "access",
    files: {
      structure: [file("access/db/struc.sql", accessStruc)],
      migrations: [file("access/db/migration.sql", accessMigration)],
      models: [file("access/db/access.sql", accessModel)],
      data: [file("access/db/data.sql", accessData)],
    },
  },
  {
    name: "attachment",
    files: {
      structure: [file("attachment/db/struc.sql", attachmentStruc)],
      models: [file("attachment/db/attachment.sql", attachmentModel)],
    },
  },
  {
    name: "document_core",
    files: {
      structure: [file("document_core/db/struc.sql", documentCoreStruc)],
      migrations: [file("document_core/db/migration.sql", documentCoreMigration)],
      models: [file("document_core/db/document_core.sql", documentCoreModel)],
      data: [file("document_core/db/data.sql", documentCoreData)],
    },
  },
  {
    name: "help_content",
    files: {
      structure: [file("help_content/db/struc.sql", helpContentStruc)],
      migrations: [file("help_content/db/migration.sql", helpContentMigration)],
      models: [file("help_content/db/help_content.sql", helpContentModel)],
      data: [file("help_content/db/data.sql", helpContentData)],
    },
  },
  {
    name: "help_scenario",
    files: {
      structure: [file("help_scenario/db/struc.sql", helpScenarioStruc)],
      migrations: [file("help_scenario/db/migration.sql", helpScenarioMigration)],
      models: [file("help_scenario/db/help_scenario.sql", helpScenarioModel)],
      data: [file("help_scenario/db/data.sql", helpScenarioData)],
    },
  },
  {
    name: "print_template",
    files: {
      structure: [file("print_template/db/struc.sql", printTemplateStruc)],
      migrations: [file("print_template/db/migration.sql", printTemplateMigration)],
      models: [file("print_template/db/print_template.sql", printTemplateModel)],
      data: [file("print_template/db/data.sql", printTemplateData)],
    },
  },
];

/** Префікс запису в `sql.json`, який означає «це пакет ядра, а не модель застосунку». */
export const CORE_SQL_PREFIX = "@core/";

/** Пакет ядра за назвою з `sql.json` (`@core/base` → пакет `base`). */
export function getCoreSqlPackage(entry: string): CoreSqlPackage | undefined {
  if (!entry.startsWith(CORE_SQL_PREFIX)) return undefined;
  const name = entry.slice(CORE_SQL_PREFIX.length);
  return CORE_SQL_PACKAGES.find((pkg) => pkg.name === name);
}
