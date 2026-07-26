export interface AuthUserRow {
  id: string;
  login: string;
  full_name: string;
  is_active?: boolean;
  password_hash?: string;
  must_change_password?: boolean;
}

export interface AuthUserDto {
  id: string;
  login: string;
  fullName: string;
  /**
   * Пароль тимчасовий — інтерфейс мусить показати екран зміни, а рантайм не
   * виконає жодної команди моделі, доки прапорець стоїть (див.
   * ModelRuntimeService). Ставиться тільки для користувача, створеного з
   * BOOTSTRAP_PASSWORD.
   */
  mustChangePassword: boolean;
}

/**
 * Як метод входу поводиться на екрані:
 *   · `direct`   — форма на місці (логін і пароль), вхід через POST /api/auth/login;
 *   · `redirect` — кнопка, що веде на GET /api/auth/authorize/:method.
 *
 * Інтерфейс мусить це знати: намалювати поле пароля для Google так само
 * безглуздо, як показати кнопку «Увійти через…» для вбудованого пароля.
 */
export type AuthMethodKind = "direct" | "redirect";

export interface AuthMethodDescriptor {
  key: string;
  label: string;
  kind: AuthMethodKind;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  auth_method: string;
  expires_at: string;
}

export interface AuthSessionInfo {
  id: string;
  authMethod: string;
  token: string;
  expiresAt: string;
}

export interface AuthLoginRequest {
  method?: string;
  login?: string;
  password?: string;
  payload?: Record<string, unknown>;
}

export interface AuthResolvedAttempt {
  method: string;
  payload: Record<string, unknown>;
}

/** Спільне для будь-якого методу входу. */
export interface AuthMethodBase {
  readonly key: string;
  readonly label: string;
}

/**
 * Синхронний обмін: застосунок віддає облікові дані, метод каже, хто це.
 * Так працює вбудований пароль і будь-який метод, де немає походу в браузер.
 */
export interface AuthDirectMethod extends AuthMethodBase {
  authenticate(payload: Record<string, unknown>): Promise<AuthUserDto | null>;
}

/**
 * Особа, яку метод дізнався у зовнішнього провайдера.
 *
 * Це **не** користувач системи: `externalId` (OIDC `sub`) сам собою не дає
 * права ні на що. Перетворення особи на користувача — справа фреймворку
 * (`AuthIdentityService`), і за замовчуванням воно вимагає зв'язки, заведеної
 * адміністратором.
 */
export interface AuthExternalIdentity {
  /**
   * Стабільний ідентифікатор у провайдера. Саме стабільний: e-mail для цього
   * не годиться — його міняють, і зв'язка тихо переїхала б на іншу людину.
   */
  externalId: string;
  /** e-mail, якщо провайдер його дав. Використовується лише при bootstrap. */
  email?: string;
  /** Показове ім'я — теж лише для bootstrap і повідомлень. */
  displayName?: string;
}

export interface AuthAuthorizeInput {
  /** Разовий `state`, уже збережений фреймворком. Метод кладе його в URL. */
  state: string;
  /** Абсолютний `redirect_uri` цього методу — той самий прийде в exchange. */
  redirectUri: string;
}

export interface AuthExchangeInput {
  /** `code` із callback-запиту. */
  code: string;
  state: string;
  redirectUri: string;
  /** Решта query-параметрів callback — провайдери додають своє. */
  params: Record<string, string>;
}

/**
 * Вхід через похід у браузер: OAuth 2.0 / OIDC та все, що на них схоже.
 *
 * Межа проведена так: фреймворк дає маршрути, зберігає `state`, перевіряє його
 * одноразовість і зв'язує зовнішню особу з користувачем. Сам обмін із
 * провайдером — у методі. Інакше в ядро довелося б затягти discovery, JWKS і
 * особливості кожного провайдера, тобто рівно те знання, яке належить
 * застосунку.
 */
export interface AuthRedirectMethod extends AuthMethodBase {
  /** Куди відправити браузер. Абсолютний URL на боці провайдера. */
  authorizeUrl(input: AuthAuthorizeInput): Promise<string> | string;
  /**
   * Обмін коду на особу. `null` або кинута помилка — вхід відхиляється;
   * текст помилки користувач не бачить (він іде в лог), щоб відповідь
   * провайдера не витікала на екран входу.
   */
  exchange(input: AuthExchangeInput): Promise<AuthExternalIdentity | null>;
}

/**
 * Метод входу, який застосунок кладе в `auth.methods`.
 *
 * Об'єднання, а не один інтерфейс із необов'язковими полями: у redirect-методу
 * немає осмисленого `authenticate`, і навпаки. Звуження за наявністю
 * `authorizeUrl` ({@link isRedirectMethod}) робить це видимим у типах.
 */
export type AuthMethod = AuthDirectMethod | AuthRedirectMethod;

export function isRedirectMethod(method: AuthMethod): method is AuthRedirectMethod {
  return typeof (method as AuthRedirectMethod).authorizeUrl === "function";
}

export function authMethodKind(method: AuthMethod): AuthMethodKind {
  return isRedirectMethod(method) ? "redirect" : "direct";
}

export interface AuthLoginResult {
  user: AuthUserDto;
  method: string;
  session: AuthSessionInfo;
}

export function toAuthUserDto(user: AuthUserRow): AuthUserDto {
  return {
    id: user.id,
    login: user.login,
    fullName: user.full_name,
    mustChangePassword: user.must_change_password === true,
  };
}
