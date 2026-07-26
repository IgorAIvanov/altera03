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
import type { ViewManifestEntry } from "../modules/model-view/model-view.registry.ts";
import type { AuthMethod } from "../modules/auth/auth.types.ts";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Розмір пулу з'єднань. */
  poolSize: number;
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

export interface AgentConfig {
  /** `null` — LLM-агент вимкнений і чесно про це каже. */
  openAiApiKey: string | null;
  model: string;
  routerModel: string;
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

/** Те, що застосунок передає в {@link bootstrap}. Необов'язкові блоки мають дефолти. */
export interface ServerOptions {
  database: DatabaseConfig;
  models: ModelsConfig;
  views: ViewsConfig;
  agentRoutes?: Record<string, AgentModelRoute>;
  auth?: Partial<AuthConfig>;
  blob?: Partial<BlobConfig>;
  agent?: Partial<AgentConfig>;
}

/** Повна конфігурація після застосування дефолтів. Такою її бачать сервіси. */
export interface ServerConfig {
  database: DatabaseConfig;
  models: ModelsConfig;
  views: ViewsConfig;
  agentRoutes: Record<string, AgentModelRoute>;
  auth: AuthConfig;
  blob: BlobConfig;
  agent: AgentConfig;
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

const DEFAULT_BLOB: BlobConfig = {
  tokenSecret: null,
  tokenTtlHours: 12,
  maxSizeMb: 10,
};

const DEFAULT_AGENT: AgentConfig = {
  openAiApiKey: null,
  model: "gpt-4o-mini",
  routerModel: "gpt-4o-mini",
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
    agentRoutes: options.agentRoutes ?? {},
    auth: { ...DEFAULT_AUTH, ...options.auth },
    blob: { ...DEFAULT_BLOB, ...options.blob },
    agent: { ...DEFAULT_AGENT, ...options.agent },
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
