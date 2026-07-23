// Public API сервер-фреймворку (бібліотека). Composition root застосунку — app/server.ts —
// збирає конфігурацію (моделі, маршрути агента, view-маніфест, БД, секрети) і передає її
// одним аргументом у bootstrap(). Сам цей модуль НЕ знає про конкретний застосунок
// (нульова залежність server → app).
export { bootstrap } from "./bootstrap.ts";

export { configFromEnv } from "./config/config-from-env.ts";
export type { EnvDerivedConfig } from "./config/config-from-env.ts";

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
export { hashPassword, verifyPassword } from "./modules/auth/password-hash.ts";

// Контракт методу входу: застосунок реалізує його, щоб додати зовнішнього
// провайдера, і кладе екземпляр у `auth.methods`.
export type {
  AuthLoginResult,
  AuthMethod,
  AuthMethodDescriptor,
  AuthSessionInfo,
  AuthUserDto,
} from "./modules/auth/auth.types.ts";

// Спільний конверт відповіді — один на команди моделей і на авторизацію.
export type { Envelope, EnvelopeData } from "./common/response.ts";

export type { GeneratedTsCommandBinding } from "./modules/model-runtime/model-registry.ts";
export type { AgentModelRoute } from "./modules/agent/agent-routes.ts";
export type { ViewManifestEntry } from "./modules/model-view/model-view.registry.ts";
