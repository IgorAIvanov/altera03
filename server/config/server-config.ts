/**
 * Конфігурація сервера — єдиний вхід налаштувань бібліотеки.
 *
 * До цього server/ читав `Deno.env` у 29 місцях (23 різні змінні), а моделі,
 * маршрути агента й view-маніфест приходили трьома окремими `register*` ДО
 * `bootstrap()`. Обидва механізми — прихований контракт: із типів не видно ні
 * що треба задати `BLOB_TOKEN_SECRET`, ні що забути `registerViewManifest`
 * означає падіння на першому запиті.
 *
 * Тепер усе це — один аргумент `bootstrap()`. Змінні оточення нікуди не
 * поділися, але бібліотека їх сама не читає: застосунок явно кличе
 * {@link configFromEnv} і за потреби перекриває поля.
 */
import type { ModelBackendConfig } from "../modules/model-runtime/model-runtime.types.ts";
import type { GeneratedTsCommandBinding } from "../modules/model-runtime/model-registry.ts";
import type { AgentModelRoute } from "../modules/agent/agent-routes.ts";
import { coreAgentRoutes, coreAgentToolSchemas } from "../modules/agent/core-agent-tools.ts";
import type { ViewManifestEntry } from "../modules/model-view/model-view.registry.ts";
import type { AuthMethod } from "../modules/auth/auth.types.ts";
import type { MessagesConfig } from "../common/messages.ts";
import type { ImportConfig } from "../modules/import/import.types.ts";

/**
 * Режим TLS у термінах libpq (`sslmode`). Драйвер окремого `verify-ca` не має,
 * тому він зводиться до `verify-full` — у бік суворішої перевірки, а не м'якшої.
 */
export type DatabaseSslMode = false | "allow" | "prefer" | "require" | "verify-full";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Розмір пулу з'єднань. */
  poolSize: number;
  /**
   * TLS до бази. `false` — без шифрування (локальний PostgreSQL); керований
   * PostgreSQL без цього не пустить. Необов'язкове: застосунок, що збирає
   * конфігурацію руками, лишається на локальному розкладі без правок.
   */
  ssl?: DatabaseSslMode;
}

/** Перший користувач системи; `null` — не створювати автоматично. */
export interface BootstrapUserConfig {
  login: string;
  password: string;
  fullName: string;
}

/**
 * Обхід авторизації для розробки. `null` — вимкнено (єдине припустиме
 * значення для продуктиву). Непорожній об'єкт означає, що застосунок свідомо
 * дозволив анонімні запити.
 */
export interface DevBypassConfig {
  /** Кого підставляти. `null` — перший активний користувач у БД. */
  userId: string | null;
}

/**
 * Cookie сесії. Токен їде саме тут і саме httpOnly: так його не дістане
 * жоден скрипт на сторінці, включно з чужим, що потрапив туди через XSS.
 */
export interface SessionCookieConfig {
  name: string;
  /** Тільки через HTTPS. Локально по http має бути false, інакше браузер її не збереже. */
  secure: boolean;
  /**
   * `Strict` — cookie не піде з чужого сайту взагалі. Це можливо, бо застосунок
   * односторінковий і зовнішніх переходів у авторизовану зону не має.
   */
  sameSite: "Strict" | "Lax" | "None";
  path: string;
}

export interface AuthConfig {
  sessionTtlHours: number;
  cookie: SessionCookieConfig;
  bootstrapUser: BootstrapUserConfig | null;
  devBypass: DevBypassConfig | null;
  /**
   * Чи доступний вхід за логіном і паролем. Вимикається, коли вхід має йти
   * лише через зовнішнього провайдера.
   */
  passwordEnabled: boolean;
  /**
   * Додаткові методи входу — застосунок підкладає свої реалізації
   * {@link AuthMethod}. Пароль сюди не входить: він вбудований і керується
   * прапорцем вище.
   *
   * ```ts
   * auth: { ...env.auth, methods: [new GoogleAuthMethod(...)] }
   * ```
   */
  methods: AuthMethod[];
  /**
   * Зовнішня адреса застосунку — з неї будується `redirect_uri` для провайдерів
   * входу (`https://облік.example/api/auth/callback/google`).
   *
   * `null` — брати походження з самого запиту. Локально цього досить, а за
   * зворотним проксі — ні: там запит приходить як `http://localhost:3000`, і
   * провайдер відхилив би такий `redirect_uri` як незареєстрований. Заголовкам
   * `X-Forwarded-*` навмисно не віримо: їх підставляє хто завгодно, а тут з них
   * будується адреса, на яку прилетить код авторизації.
   */
  publicBaseUrl: string | null;
}

export interface BlobConfig {
  /**
   * Секрет підпису токенів вкладень. `null` — згенерувати разовий на процес:
   * у розробці працює, після рестарту старі посилання помирають.
   */
  tokenSecret: string | null;
  tokenTtlHours: number;
  maxSizeMb: number;
}

export interface ModelsConfig {
  registry: Record<string, ModelBackendConfig>;
  tsCommands: GeneratedTsCommandBinding[];
}

export interface ViewsConfig {
  manifest: ViewManifestEntry[];
  /** Корінь репозиторію: від нього рахуються шляхи модулів у маніфесті. */
  projectRoot: string;
  /**
   * Корінь Vite відносно `projectRoot` (`"app"`). Потрібен саме для prod:
   * `dist/.vite/manifest.json` ключується шляхами відносно кореня Vite
   * (`catalog/bank/bankList.ts`), а маніфест в'ю — відносно кореня репозиторію
   * (`app/catalog/bank/bankList.ts`). Без цього префікса жодне в'ю в маніфесті
   * не знаходиться, і prod-режим мовчки лишається з нулем маршрутів.
   *
   * Порожній рядок означає, що корені збігаються.
   */
  appDir?: string;
  /**
   * dev — віддавати `/@fs/`-посилання на вихідні модулі (Vite їх обслуговує);
   * prod — шукати зібрані чанки у `dist/.vite/manifest.json`.
   */
  dev: boolean;
}

/**
 * Як звуть цю установку — назва рішення і версія фреймворку, під яким воно
 * працює.
 *
 * Називає їх ЗАСТОСУНОК, як і версію SQL ядра: бібліотека не має вирішувати за
 * нього, чим він є. Значення їде з кожним зауваженням (`ctxSolution`,
 * `ctxFramework`) — без них «не проводиться накладна» не прив'язане ні до якої
 * поставки, і на питання «у якій версії це було» відповіді немає.
 *
 * Рядки вільні: у пакетній поставці їх дає `app/.solution.json`, у розгортанні
 * з репозиторію — карта імпортів, а de facto годиться будь-що, що людина
 * упізнає.
 */
export interface VersionInfo {
  /** Рішення: `«erp 1.4.0»`. */
  solution?: string;
  /** Фреймворк: пін `@altera/server`. */
  framework?: string;
}

/** Те, що застосунок передає в {@link bootstrap}. Необов'язкові блоки мають дефолти. */
export interface ServerOptions {
  database: DatabaseConfig;
  models: ModelsConfig;
  views: ViewsConfig;
  agentRoutes?: Record<string, AgentModelRoute>;
  /**
   * JSON Schema payload-ів агентських команд — ключ `"<модель>.<команда>"`.
   * Застосунок передає згенероване `app/_generated/agent-tools.generated.ts`;
   * без цього поля перелік інструментів порожній, і зовнішній агент не бачить
   * ані складу полів, ані типів.
   */
  agentTools?: Record<string, unknown>;
  auth?: Partial<AuthConfig>;
  blob?: Partial<BlobConfig>;
  version?: VersionInfo;
  /**
   * Тексти повідомлень для каналу зовнішнього агента: маркер `@[ключ]` сервер
   * розгортає сам лише там, де його нема кому розгорнути (див.
   * `common/messages.ts`).
   *
   * Словники приходять від ЗАСТОСУНКУ, бо тільки він має обидва: рядки ядра
   * лежать у локалях `@altera/client`, рядки моделей — у власних `_locales/`.
   * Не передав — поведінка та сама, що була: агент отримує маркер як є.
   */
  messages?: Partial<MessagesConfig>;
  /**
   * Оголошені обмеження моделей: `"month_close"` → ключі її відмов.
   *
   * Тексти сюди не передаються — вони беруться зі словників `messages` у
   * рантаймі, тобто мовою виклику й без жодного дубля перекладу. Застосунок
   * передає згенероване `app/_generated/agent-rules.generated.ts`.
   */
  agentRules?: Record<string, string[]>;
  /**
   * Довге виконання команди у фоні (`app.job`).
   *
   * Поле існує через одну властивість середовища, якої бібліотека сама знати
   * не може: чи доживе процес до кінця роботи ПІСЛЯ того, як віддав відповідь
   * на запит. На машині з бінарем або в Docker — доживе; на безсерверній
   * платформі (Deno Deploy) гарантії немає жодної, і завдання може обірватися
   * на середині, не лишивши сліду ніде, крім наполовину перенесених даних.
   *
   * Тому рішення приймає `configFromEnv()` — єдине місце, яке має право
   * дивитися на оточення, — а ядро лише виконує його: відмовою при спробі
   * запуску, а не мовчанням.
   */
  jobs?: Partial<JobsConfig>;
  /**
   * Канал приймання даних ззовні (`@core/import`).
   *
   * Головне тут — `plan`: ЄДИНЕ місце, де застосунок каже, що замовити в
   * джерела. Ядро возить байти й стереже цілісність, а що саме вивантажувати,
   * знає тільки той, хто написав набір правил конвертації.
   */
  import?: Partial<ImportConfig>;
}

/** Налаштування фонового виконання. */
export interface JobsConfig {
  /** Чи можна виконувати довгі команди у фоні. `false` — відмова при запуску. */
  background: boolean;
  /** Як часто виконавець підтверджує, що живий (мс). */
  heartbeatMs: number;
  /** Після якого мовчання завдання вважається покинутим (мс). */
  staleMs: number;
}

/** Повна конфігурація після застосування дефолтів. Такою її бачать сервіси. */
export interface ServerConfig {
  database: DatabaseConfig;
  models: ModelsConfig;
  views: ViewsConfig;
  agentRoutes: Record<string, AgentModelRoute>;
  agentTools: Record<string, unknown>;
  auth: AuthConfig;
  blob: BlobConfig;
  version: VersionInfo;
  messages: MessagesConfig;
  agentRules: Record<string, string[]>;
  jobs: JobsConfig;
  import: ImportConfig;
}

const DEFAULT_AUTH: AuthConfig = {
  sessionTtlHours: 24 * 30,
  cookie: { name: "altera_session", secure: false, sameSite: "Strict", path: "/" },
  bootstrapUser: null,
  devBypass: null,
  passwordEnabled: true,
  methods: [],
  publicBaseUrl: null,
};

/**
 * Порожній словник — свідоме умовчання: без нього перший же застосунок, який
 * оновив пакет і нічого не передав, почав би отримувати голі ключі там, де
 * доти був маркер. Промах по словнику лишає маркер недоторканим, тобто
 * сьогоднішня поведінка і є запасний варіант.
 */
const DEFAULT_MESSAGES: MessagesConfig = {
  dictionaries: {},
  locale: "uk",
  fallback: "en",
};

/**
 * Умовчання — фон ДОЗВОЛЕНИЙ.
 *
 * Fail-open тут навмисний і протилежний до умовчань у правах: застосунок, що
 * оновив пакет і нічого не передав, живе на звичайному сервері (саме там його
 * й запускали досі), а заборона за умовчанням зламала б йому команду, яка
 * працювала. Безсерверна платформа — випадок, який треба НАЗВАТИ, і називає
 * його `configFromEnv()`, бо тільки він бачить оточення.
 *
 * Інтервали: підтвердження раз на 15 с, покинутим завдання стає після хвилини
 * мовчання. Хвилина — це чотири пропущені стуки: одиночна затримка на довгому
 * запиті чи паузі збирача сміття не повинна вбивати живу роботу.
 */
const DEFAULT_JOBS: JobsConfig = {
  background: true,
  heartbeatMs: 15_000,
  staleMs: 60_000,
};

/**
 * Умовчання каналу приймання.
 *
 * `plan: null` — робоча конфігурація, а не заглушка: канал лишається придатним
 * для джерел, які самі знають, що везти (файл, вивантаження з каси). План
 * потрібен тому джерелу, яким ми КЕРУЄМО.
 *
 * П'ять хвилин на код спарювання — стільки, скільки людина йде до сусіднього
 * комп'ютера. Доба на токен: перенесення роблять за день-два, і токен, що живе
 * місяцями в чужій базі, — саме те, чого область дії й уникає.
 */
const DEFAULT_IMPORT: ImportConfig = {
  plan: null,
  pairingTtlMinutes: 5,
  tokenTtlHours: 24,
  maxPartItems: 5_000,
};

const DEFAULT_BLOB: BlobConfig = {
  tokenSecret: null,
  tokenTtlHours: 12,
  maxSizeMb: 10,
};

/** Доповнює необов'язкові блоки дефолтами. */
export function resolveServerConfig(options: ServerOptions): ServerConfig {
  return {
    database: options.database,
    models: options.models,
    views: {
      ...options.views,
      projectRoot: options.views.projectRoot.replaceAll("\\", "/").replace(/\/$/, ""),
    },
    // Інструменти ядра йдуть ПЕРШИМИ, застосунок їх перекриває: перелік
    // збирається з манифестів, а моделі ядра манифеста не мають (див.
    // core-agent-tools.ts). Порядок значущий — застосунок, який завів свою
    // модель з тим самим іменем, має лишитися головним.
    agentRoutes: { ...coreAgentRoutes, ...(options.agentRoutes ?? {}) },
    agentTools: { ...coreAgentToolSchemas, ...(options.agentTools ?? {}) },
    auth: { ...DEFAULT_AUTH, ...options.auth },
    blob: { ...DEFAULT_BLOB, ...options.blob },
    version: options.version ?? {},
    messages: { ...DEFAULT_MESSAGES, ...options.messages },
    agentRules: options.agentRules ?? {},
    jobs: { ...DEFAULT_JOBS, ...options.jobs },
    import: { ...DEFAULT_IMPORT, ...options.import },
  };
}

let current: ServerConfig | null = null;

/**
 * Кладе конфігурацію туди, звідки її беруть сервіси. Викликає лише
 * `bootstrap()` — назовні з `main.ts` не експортується, щоб не повторити
 * історію з `register*`: це деталь реалізації, а не контракт.
 */
export function setServerConfig(config: ServerConfig): void {
  current = config;
}

export function getServerConfig(): ServerConfig {
  if (!current) {
    throw new Error(
      "Конфігурацію сервера не встановлено — bootstrap() не викликано або впав до кінця ініціалізації",
    );
  }

  return current;
}
