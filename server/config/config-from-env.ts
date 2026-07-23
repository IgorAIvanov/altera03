/**
 * Збірка конфігурації зі змінних оточення.
 *
 * Свідомо окремий модуль і свідомо явний виклик: бібліотека сама оточення не
 * читає. Застосунок вирішує, звідки беруться значення — з `.env`, з секретів
 * оркестратора чи з коду, — і бачить повний перелік у типах.
 */
import type {
  AgentConfig,
  AuthConfig,
  BlobConfig,
  DatabaseConfig,
  DevBypassConfig,
} from "./server-config.ts";

/** Блоки конфігурації, які прийнято тримати в оточенні. */
export interface EnvDerivedConfig {
  database: DatabaseConfig;
  auth: AuthConfig;
  blob: BlobConfig;
  agent: AgentConfig;
}

const BIGINT_ID_PATTERN = /^\d+$/;
const PRODUCTION_MARKERS = ["production", "prod"];

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

function isProductionEnvironment(): boolean {
  return ["NODE_ENV", "APP_ENV", "DENO_ENV"].some((name) => {
    const value = Deno.env.get(name)?.trim().toLowerCase();
    return !!value && PRODUCTION_MARKERS.includes(value);
  });
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
    database: {
      host: Deno.env.get("DB_HOST") || "localhost",
      port: readPositiveInt("DB_PORT", 5432),
      database: Deno.env.get("DB_NAME") || "altera",
      username: Deno.env.get("DB_USERNAME") || "altera",
      password: Deno.env.get("DB_PASSWORD") || "",
      poolSize: readPositiveInt("DB_POOL_SIZE", 10),
    },
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
    },
    blob: {
      // Окремий секрет, інакше — той самий JWT_SECRET (однаковий рівень довіри).
      tokenSecret: readTrimmed("BLOB_TOKEN_SECRET") ?? readTrimmed("JWT_SECRET"),
      tokenTtlHours: readPositiveInt("BLOB_TOKEN_TTL_HOURS", 12),
      maxSizeMb: readPositiveInt("BLOB_MAX_SIZE_MB", 10),
    },
    agent: {
      openAiApiKey: readTrimmed("OPENAI_API_KEY"),
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
      routerModel: Deno.env.get("OPENAI_ROUTER_MODEL") || "gpt-4o-mini",
    },
  };
}
