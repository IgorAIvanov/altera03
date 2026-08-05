// Public API сервер-фреймворку (бібліотека). Composition root застосунку — app/server.ts —
// збирає конфігурацію (моделі, маршрути агента, view-маніфест, БД, секрети) і передає її
// одним аргументом у bootstrap(). Сам цей модуль НЕ знає про конкретний застосунок
// (нульова залежність server → app).
export { bootstrap } from "./bootstrap.ts";

export { configFromEnv } from "./config/config-from-env.ts";
export type { EnvDerivedConfig } from "./config/config-from-env.ts";

// Єдине означення «продуктивного» оточення (production/prod/staging у
// NODE_ENV/APP_ENV/DENO_ENV). Локальні копії цієї перевірки в інструментах і
// застосунку розповзалися — тепер усі беруть її звідси.
export { findProductionMarker, isProductionEnvironment } from "./config/config-from-env.ts";

// Так само з «локальною» базою: список локальних хостів потрібен і тут (дефолт
// TLS виводиться з розташування бази), і запобіжнику дев-інструментів. Дві копії
// розійшлися б мовчки — і розходження було б видно аж на чужій базі.
export { isLocalDatabaseHost } from "./config/config-from-env.ts";

export type {
  AgentConfig,
  AuthConfig,
  BlobConfig,
  BootstrapUserConfig,
  DatabaseConfig,
  DevBypassConfig,
  ModelsConfig,
  ServerConfig,
  ServerOptions,
  SessionCookieConfig,
  ViewsConfig,
} from "./config/server-config.ts";

// Хешування паролів. Єдина схема на систему (PBKDF2-SHA256): SQL паролів не
// торкається, тож усе, що їх встановлює — від адмін-екрана застосунку до
// консольного скидання, — має користуватися саме цим.
export { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./modules/auth/password-hash.ts";

// Контракт методу входу: застосунок реалізує його, щоб додати зовнішнього
// провайдера, і кладе екземпляр у `auth.methods`. Два різновиди —
// `AuthDirectMethod` (обмін на місці) і `AuthRedirectMethod` (похід у браузер:
// OAuth/OIDC). Другий фреймворк веде сам: маршрути, `state`, зв'язка з
// користувачем — його, обмін коду на особу — метода.
export type {
  AuthAuthorizeInput,
  AuthDirectMethod,
  AuthExchangeInput,
  AuthExternalIdentity,
  AuthLoginResult,
  AuthMethod,
  AuthMethodDescriptor,
  AuthMethodKind,
  AuthRedirectMethod,
  AuthSessionInfo,
  AuthUserDto,
} from "./modules/auth/auth.types.ts";

// Спільний конверт відповіді — один на команди моделей і на авторизацію.
export type { Envelope, EnvelopeData } from "./common/response.ts";

// Контекст TS-команди моделі: те, що хендлер отримує другим аргументом (зокрема
// `db` — SQL-контекст). Без цього експорту нестандартна команда не виражається у
// ВСТАНОВЛЕНОМУ застосунку взагалі: у монорепо тип брали відносним імпортом у
// server/, а туди застосунок дотягується лише тут, у репозиторії. Шаблон scaffold
// жодної TS-команди не містив, тому дірка не виявлялася ніде.
export type { ModelCommandContext } from "./modules/model-runtime/model-runtime.types.ts";
export type { GeneratedTsCommandBinding } from "./modules/model-runtime/model-registry.ts";
export type { AgentModelRoute } from "./modules/agent/agent-routes.ts";
export type { ViewManifestEntry } from "./modules/model-view/model-view.registry.ts";
