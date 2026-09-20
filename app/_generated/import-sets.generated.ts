// Generated from app/_import/**. Do not edit manually.
//
// Статичні import — не стиль, а вимога: `deno compile` і Deno Deploy беруть
// лише те, що видно в графі модулів, тож набір, підключений динамічно, у
// встановленому застосунку просто відсутній. Та сама пастка, що з
// TS-командами моделей.
//
// Тип вмісту — `unknown` навмисно: формат правила належить прикладному
// рішенню, а реєстр описує ФАЙЛИ набору, а не те, що в них написано.

export interface ImportSetModules {
  /** Каталог набору відносно кореня застосунку. */
  dir: string;
  rules: Record<string, unknown>;
  queries: Record<string, unknown>;
  /** Файли набору, які модулями не є: еталон метаданих, зібрана обробка. */
  files: string[];
}

export const importSets: Record<string, ImportSetModules> = {};
