/**
 * Збірка конфігурації зі змінних оточення.
 *
 * Свідомо окремий модуль і свідомо явний виклик: бібліотека сама оточення не
 * читає. Застосунок вирішує, звідки беруться значення — з `.env`, з секретів
 * оркестратора чи з коду, — і бачить повний перелік у типах.
 */
import type {
  AuthConfig,
  BlobConfig,
  DatabaseConfig,
  DatabaseSslMode,
  DevBypassConfig,
} from "./server-config.ts";

/** Блоки конфігурації, які прийнято тримати в оточенні. */
export interface EnvDerivedConfig {
  database: DatabaseConfig;
  auth: AuthConfig;
  blob: BlobConfig;
}

const BIGINT_ID_PATTERN = /^\d+$/;
const PRODUCTION_MARKERS = ["production", "prod", "staging"];
const ENVIRONMENT_VARIABLES = ["NODE_ENV", "APP_ENV", "DENO_ENV"];

function readPositiveInt(name: string, fallback: number): number {
  const raw = Number.parseInt(Deno.env.get(name) ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function readTrimmed(name: string): string | null {
  return Deno.env.get(name)?.trim() || null;
}

function isTruthy(name: string): boolean {
  const raw = Deno.env.get(name)?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Тризначний прапорець: `null` — не задано, тоді діє дефолт виклику. */
function readBoolean(name: string): boolean | null {
  const raw = Deno.env.get(name)?.trim().toLowerCase();
  if (!raw) return null;
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Єдине означення «продуктивного» оточення на всю систему: ним користуються
 * дефолт Secure-cookie й заборона DEV_AUTH_BYPASS тут, dev-guard інструментів
 * (`@altera/tools`) і дев-заглушки входу застосунку. `staging` теж рахується:
 * дані там такі ж чужі, як у продуктиві. Повертає знайдений маркер у вигляді
 * `NODE_ENV=production` — готовий рядок для повідомлення про відмову.
 */
export function findProductionMarker(): string | null {
  for (const name of ENVIRONMENT_VARIABLES) {
    const value = Deno.env.get(name)?.trim().toLowerCase();
    if (value && PRODUCTION_MARKERS.includes(value)) {
      return `${name}=${value}`;
    }
  }

  // Deno Deploy позначає себе сам. Без цього рядка забутий у панелі
  // `NODE_ENV=production` означав би cookie без `Secure` і дозволений
  // `DEV_AUTH_BYPASS` — причому мовчки. Прев'ю-розгортання рахується так само:
  // воно теж публічне, теж по HTTPS і теж не локальна розробка.
  const deploy = Deno.env.get("DENO_DEPLOY")?.trim();
  if (deploy) {
    return `DENO_DEPLOY=${deploy}`;
  }

  return null;
}

export function isProductionEnvironment(): boolean {
  return findProductionMarker() !== null;
}

/**
 * `sslmode` у термінах libpq → опція драйвера.
 *
 * Порожнє й `disable` — без TLS: саме так виглядає локальний PostgreSQL у
 * контейнері. `verify-ca` зводиться до `verify-full`: окремого режиму драйвер
 * не має, а помилятися тут треба в бік суворішої перевірки. Незнайоме значення
 * не мовчить — краще впасти на старті, ніж піти в керовану базу відкритим
 * з'єднанням, вважаючи, що воно шифроване.
 */
export function parseSslMode(raw: string | null | undefined): DatabaseSslMode {
  const mode = raw?.trim().toLowerCase();
  if (!mode || mode === "disable") return false;
  if (mode === "allow" || mode === "prefer" || mode === "require") return mode;
  if (mode === "verify-ca" || mode === "verify-full") return "verify-full";
  throw new Error(
    `Невідомий sslmode «${mode}». Припустимі: disable, allow, prefer, require, verify-ca, verify-full`,
  );
}

const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

/**
 * Чи є хост бази локальним. Одне означення на систему: тут із нього виводиться
 * дефолт TLS, а запобіжник дев-інструментів (`@altera/tools`) тим самим списком
 * вирішує, чи можна запускати `smoke`/`api`/`passwd`/`sql:publish`.
 */
export function isLocalDatabaseHost(host: string): boolean {
  return LOCAL_DATABASE_HOSTS.includes(host.trim().toLowerCase());
}

/**
 * TLS за замовчуванням — за розташуванням бази.
 *
 * Локальний PostgreSQL шифрування не пропонує взагалі, керований без нього не
 * пустить. Тобто «правильне» значення однозначно виводиться з хоста, а
 * помилитися можна лише в один бік — забути `PGSSLMODE` й піти в керовану базу
 * відкритим з'єднанням. Дефолт закриває саме цей випадок; явно задане значення
 * (включно з `disable`) завжди сильніше.
 */
function defaultSslMode(host: string): DatabaseSslMode {
  return isLocalDatabaseHost(host) ? false : "require";
}

/**
 * Розбір `DATABASE_URL` (`postgres://user:pass@host:5432/db?sslmode=require`).
 *
 * Керовані бази — Neon, Render, Prisma — віддають підключення однією стрічкою,
 * і зібрати його з `PG*` там нема з чого. Розбір тут, а не в драйвері, щоб
 * `DatabaseConfig` лишався однієї форми: сервіси бачать компоненти, а не «або
 * компоненти, або рядок».
 *
 * Логін і пароль декодуються: у згенерованому паролі трапляється `@` чи `/`, і
 * в URL вони приїжджають екранованими.
 *
 * **Порожній шлях — не помилка.** `postgres://user:pass@host:5432/?sslmode=require`
 * видає, зокрема, Prisma Postgres на Deno Deploy: ім'я бази там мається на увазі
 * обліковкою. За libpq у такому разі базою вважається ім'я користувача — це і
 * робимо, замість того щоб відмовитися працювати з коректним рядком провайдера.
 */
export function parseDatabaseUrl(raw: string): Omit<DatabaseConfig, "poolSize"> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL не є коректним URL");
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`DATABASE_URL: очікувалася схема postgres://, а не ${url.protocol}//`);
  }

  const username = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || username;
  if (!database) {
    throw new Error("DATABASE_URL не містить ані імені бази, ані користувача");
  }

  const sslmode = url.searchParams.get("sslmode");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
    username,
    password: decodeURIComponent(url.password),
    ssl: sslmode ? parseSslMode(sslmode) : defaultSslMode(url.hostname),
  };
}

/**
 * Підключення до бази — з `PG*` цілком або з `DATABASE_URL` цілком.
 *
 * Джерело вибирається **весь**, а не по полях: інакше хост приїхав би з одного,
 * пароль з іншого, і зрозуміти, куди насправді ходить застосунок, було б ніяк.
 * Імена — libpq (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
 * `PGSSLMODE`), тобто ті самі, що розуміють `psql`, `pg_dump` і керовані бази.
 * `DB_POOL_SIZE` лишається своїм: поняття пулу в libpq немає.
 *
 * **Компоненти сильніші за рядок**, коли задані обидва. Deno Deploy підставляє
 * і `PG*`, і `DATABASE_URL` — але в рядку там немає імені бази, а в `PGDATABASE`
 * воно є. Компоненти повніші за побудовою, тож вони й виграють; `DATABASE_URL`
 * лишається для провайдерів, які нічого, крім рядка, не дають.
 */
function readDatabaseConfig(): DatabaseConfig {
  const poolSize = readPositiveInt("DB_POOL_SIZE", 10);
  const url = readTrimmed("DATABASE_URL");
  const hasComponents = !!(readTrimmed("PGHOST") && readTrimmed("PGDATABASE"));

  if (url && !hasComponents) {
    return { ...parseDatabaseUrl(url), poolSize };
  }

  const host = Deno.env.get("PGHOST") || "localhost";
  const sslmode = readTrimmed("PGSSLMODE");

  return {
    host,
    port: readPositiveInt("PGPORT", 5432),
    database: Deno.env.get("PGDATABASE") || "altera",
    username: Deno.env.get("PGUSER") || "altera",
    password: Deno.env.get("PGPASSWORD") || "",
    ssl: sslmode ? parseSslMode(sslmode) : defaultSslMode(host),
    poolSize,
  };
}

function normalizeUserId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && BIGINT_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Обхід авторизації. Раніше несумісність із продуктивом виявлялася на першому
 * запиті — тепер сервер не підніметься взагалі: краще впасти на старті, ніж
 * пустити анонімний трафік.
 */
function readDevBypass(): DevBypassConfig | null {
  if (!isTruthy("DEV_AUTH_BYPASS")) {
    return null;
  }

  if (isProductionEnvironment()) {
    throw new Error("DEV_AUTH_BYPASS увімкнено у продуктивному оточенні — так не можна");
  }

  return {
    userId: normalizeUserId(Deno.env.get("DEV_AUTH_USER_ID") ?? Deno.env.get("DEFAULT_USER_ID")),
  };
}

const PLACEHOLDER_SECRET = "change-me-in-production";

/**
 * Секрет підпису токенів вкладень. Основна змінна — BLOB_TOKEN_SECRET;
 * JWT_SECRET читається як legacy-фолбек. Плейсхолдер з .env.example —
 * загальновідомий рядок: з ним будь-хто, хто знає id вкладення, підпише
 * собі `?token=` і обійде права. Тому в продуктиві плейсхолдер або
 * відсутній секрет валить старт, а не мовчки підписує посилання.
 */
function readBlobTokenSecret(): string | null {
  const secret = readTrimmed("BLOB_TOKEN_SECRET") ?? readTrimmed("JWT_SECRET");

  if (isProductionEnvironment() && (!secret || secret === PLACEHOLDER_SECRET)) {
    throw new Error(
      "BLOB_TOKEN_SECRET не задано або лишився плейсхолдер 'change-me-in-production' " +
        "у продуктивному оточенні — згенеруй власний секрет",
    );
  }

  if (secret === PLACEHOLDER_SECRET) {
    console.warn(
      "⚠ BLOB_TOKEN_SECRET — плейсхолдер з .env.example; у продуктивному оточенні сервер із ним не стартує",
    );
  }

  return secret;
}

function readBootstrapUser(): AuthConfig["bootstrapUser"] {
  const login = readTrimmed("BOOTSTRAP_LOGIN");
  const password = Deno.env.get("BOOTSTRAP_PASSWORD") || null;
  if (!login || !password) {
    return null;
  }

  return {
    login,
    password,
    fullName: readTrimmed("BOOTSTRAP_FULL_NAME") ?? "Bootstrap administrator",
  };
}

/**
 * Читає оточення один раз. Кидає помилку, якщо налаштування суперечать одне
 * одному (наприклад, dev-обхід у продуктиві).
 */
export function configFromEnv(): EnvDerivedConfig {
  return {
    database: readDatabaseConfig(),
    auth: {
      sessionTtlHours: readPositiveInt("AUTH_SESSION_TTL_HOURS", 24 * 30),
      cookie: {
        name: readTrimmed("AUTH_COOKIE_NAME") ?? "altera_session",
        // У продуктиві — завжди тільки HTTPS; локально по http браузер cookie
        // з Secure просто не збереже, тому там за замовчуванням вимкнено.
        secure: readBoolean("AUTH_COOKIE_SECURE") ?? isProductionEnvironment(),
        sameSite: "Strict",
        path: "/",
      },
      bootstrapUser: readBootstrapUser(),
      devBypass: readDevBypass(),
      passwordEnabled: (Deno.env.get("AUTH_PASSWORD_ENABLED")?.trim().toLowerCase() ?? "") !== "false",
      // Зовнішні провайдери оточенням не задаються — це код. Застосунок
      // додає їх сам: `auth: { ...env.auth, methods: [...] }`.
      methods: [],
      // Потрібна лише за зворотним проксі: без неї redirect_uri будується з
      // походження запиту, а це `http://localhost:3000`, а не публічна адреса.
      publicBaseUrl: readTrimmed("AUTH_PUBLIC_BASE_URL")?.replace(/\/+$/, "") ?? null,
    },
    blob: {
      tokenSecret: readBlobTokenSecret(),
      tokenTtlHours: readPositiveInt("BLOB_TOKEN_TTL_HOURS", 12),
      maxSizeMb: readPositiveInt("BLOB_MAX_SIZE_MB", 10),
    },
  };
}
