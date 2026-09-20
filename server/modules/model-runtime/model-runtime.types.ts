import type { DatabaseService } from "../../database/database.service.ts";

export interface ModelCommandContext {
  db: DatabaseService;
  model: string;
  command: string;
  userId: string;
  /**
   * Є лише тоді, коли команда виконується у фоні (`app.job`).
   *
   * Той самий хендлер мусить працювати й без цього поля: довгою команду
   * оголошує МАНИФЕСТ, а не код, і та сама команда може бути викликана прямо
   * (у пробі, на маленькій базі, з `deno task api`). Тому прогрес пишеться як
   * `ctx.job?.progress(...)` — необов'язковою дією, а не обов'язковим кроком.
   */
  job?: ModelCommandJob;
}

/** Ручки довгого завдання, доступні хендлеру. */
export interface ModelCommandJob {
  id: string;
  /**
   * Записати прогрес. Форму об'єкта обирає сама команда: «розділ 7 із 16» і
   * «оброблено 12 400 рядків» — різні речі, і спільного набору колонок під них
   * немає.
   *
   * Запис іде окремим з'єднанням, поза транзакцією роботи, — інакше прогрес
   * було б видно лише після коміту, тобто ніколи.
   */
  progress(value: unknown): Promise<void>;
  /**
   * Чи просили зняти завдання. Дивитися сюди між кроками — справа команди:
   * ядро не перериває чужу транзакцію ззовні, бо «зняв» означало б тоді
   * «відкотив половину невідомо чого».
   */
  isCancelled(): Promise<boolean>;
}

export interface SqlModelCommandConfig {
  schema?: string;
  functionName?: string;
  validate?: (payload: Record<string, unknown>) => string | null;
}

export type SqlModelCommandDefinition = string | SqlModelCommandConfig;

export interface TsModelCommandConfig {
  validate?: (payload: Record<string, unknown>) => string | null;
  handler: (
    payload: Record<string, unknown>,
    context: ModelCommandContext,
  ) => Promise<unknown>;
}

export interface ModelBackendConfig {
  type?: string;
  schema?: string;
  // Політики журналу тут немає навмисно: що журналювати — налаштування
  // УСТАНОВКИ (`app.audit_setting`, екран `admin/audit_setting`), а не
  // властивість моделі. Поки вона жила в манифесті, увімкнути журнал не можна
  // було, не правлячи рішення й не викочуючи його заново.
  sqlCommands?: Record<string, SqlModelCommandDefinition>;
  tsCommands?: Record<string, TsModelCommandConfig>;
  /**
   * Право нестандартної команди: назва дії (`view`, `create`, `edit`,
   * `delete`, `post`, `unpost`) або `"authenticated"` — «досить бути
   * авторизованим». Стандартні команди тут не оголошуються: їхня дія виводиться
   * з імені (див. `resolveRequiredAction`).
   *
   * Неоголошена нестандартна команда НЕ виконується — fail-closed. Забути
   * оголошення можна, і тоді помилка вилізе на першому виклику; мовчазний
   * дозвіл же не вилазить ніколи.
   */
  access?: Record<string, string>;
  /**
   * Команди, які виконуються у фоні (`commands.long` у манифесті).
   *
   * Оголошення живе в манифесті, а не в коді хендлера, навмисно: довгою
   * команду робить не її реалізація, а розмір бази, на якій вона працює.
   * Перенесення в демо-наборі йде секунду, а в клієнта — двадцять хвилин; це
   * та сама команда.
   */
  longCommands?: string[];
}