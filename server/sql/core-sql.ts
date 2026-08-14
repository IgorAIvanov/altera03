/**
 * SQL ядра — схема, без якої не працює жоден застосунок на цьому фреймворку:
 * користувачі й сесії, вкладення, документи з проводками, шаблони друку, довідка.
 *
 * Файли лишаються звичайними `.sql` — їх редагують і читають як SQL. У модуль
 * текст потрапляє через згенерований `core-sql.generated.ts`
 * (`deno task core:sql`), а НЕ text-імпортами `with { type: "text" }`: це
 * експериментальна можливість Deno (`--unstable-raw-imports`), і граф на боці
 * JSR її не розбирає — публікація пакета падає з «The import attribute type of
 * "text" is unsupported». Локальний `deno publish --dry-run` цього не показує,
 * бо граф там будує наш Deno, а не реєстр.
 *
 * Порядок підключення задає НЕ цей файл, а `sql.json` застосунку: `document_core`
 * посилається на `chart_of_account`, `currency` і `organization`, тобто ядро й
 * моделі застосунку чергуються за FK. Тому кожен пакет ядра підключається
 * окремим записом `@core/<назва>`, і застосунок ставить його туди, куди треба.
 */





import { CORE_SQL_TEXT } from "./core-sql.generated.ts";

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

function file(path: string): CoreSqlFile {
  const sql = CORE_SQL_TEXT[path];
  if (sql === undefined) {
    throw new Error(
      `SQL ядра «${path}» немає в core-sql.generated.ts — виконай \`deno task core:sql\`.`,
    );
  }
  return { path, sql };
}

export const CORE_SQL_PACKAGES: CoreSqlPackage[] = [
  {
    name: "base",
    files: {
      structure: [file("base/db/struc.sql")],
      migrations: [file("base/db/migration.sql")],
      models: [file("base/db/base.sql")],
      data: [file("base/db/data.sql")],
    },
  },
  // access іде одразу за base: attachment і document посилаються на app.users.
  {
    name: "access",
    files: {
      structure: [file("access/db/struc.sql")],
      migrations: [file("access/db/migration.sql")],
      models: [file("access/db/access.sql")],
      data: [file("access/db/data.sql")],
    },
  },
  // audit залежить лише від app.users, тому йде відразу за access.
  {
    name: "audit",
    files: {
      structure: [file("audit/db/struc.sql")],
      data: [file("audit/db/data.sql")],
    },
  },
  // setting — теж лише за app.users. Сіду в ядрі немає навмисно, як і в меню:
  // ЩО можна налаштувати, називає застосунок, тому каталог (він же умовчання)
  // лежить у нього — app/admin/setting/db/data.sql.
  {
    name: "setting",
    files: {
      structure: [file("setting/db/struc.sql")],
      models: [file("setting/db/setting.sql")],
    },
  },
  // menu — одразу за access: app.user_group_menu посилається на app.user_group.
  // Сід меню в ядрі відсутній навмисно: склад пунктів — це маршрути конкретного
  // застосунку, тож data.sql лишається в нього (app/admin/menu/db/data.sql).
  {
    name: "menu",
    files: {
      structure: [file("menu/db/struc.sql")],
      models: [file("menu/db/menu.sql")],
    },
  },
  {
    name: "attachment",
    files: {
      structure: [file("attachment/db/struc.sql")],
      models: [file("attachment/db/attachment.sql")],
    },
  },
  // numerator — перед document_core: doc_next_number став обгорткою над ним.
  // Порядок тут не про FK (їх між пакетами немає), а про читабельність пакета:
  // спершу з'являється механізм номерів, потім ті, хто ним користується.
  {
    name: "numerator",
    files: {
      structure: [file("numerator/db/struc.sql")],
      migrations: [file("numerator/db/migration.sql")],
      models: [file("numerator/db/numerator.sql")],
    },
  },
  {
    name: "document_core",
    files: {
      structure: [file("document_core/db/struc.sql")],
      migrations: [file("document_core/db/migration.sql")],
      models: [file("document_core/db/document_core.sql")],
      data: [file("document_core/db/data.sql")],
    },
  },
  // Шар читання регістру. Окремим пакетом, а не всередині document_core: своїх
  // таблиць у нього немає (лише функції над чужими), а застосунок без
  // бухгалтерського контуру не мусить його везти. Іде ПІСЛЯ document_core —
  // читає його таблиці — і після плану рахунків застосунку.
  {
    name: "ledger",
    files: {
      models: [file("ledger/db/ledger.sql")],
    },
  },
  {
    name: "help_content",
    files: {
      structure: [file("help_content/db/struc.sql")],
      migrations: [file("help_content/db/migration.sql")],
      models: [file("help_content/db/help_content.sql")],
      data: [file("help_content/db/data.sql")],
    },
  },
  {
    name: "help_scenario",
    files: {
      structure: [file("help_scenario/db/struc.sql")],
      migrations: [file("help_scenario/db/migration.sql")],
      models: [file("help_scenario/db/help_scenario.sql")],
      data: [file("help_scenario/db/data.sql")],
    },
  },
  {
    name: "print_template",
    files: {
      structure: [file("print_template/db/struc.sql")],
      migrations: [file("print_template/db/migration.sql")],
      models: [file("print_template/db/print_template.sql")],
      data: [file("print_template/db/data.sql")],
    },
  },
  // Зауваження до рішення. Залежність одна — app.users (автор і той, хто
  // закрив), тож ставити пакет можна одразу за access. Своїх даних не сіє:
  // склад журналу пишуть люди, а не деплой.
  {
    name: "remark",
    files: {
      structure: [file("remark/db/struc.sql")],
      models: [file("remark/db/remark.sql")],
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
