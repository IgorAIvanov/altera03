import { Injectable } from "@danet/core";
import { AuthSessionService } from "./auth-session.service.ts";
import { PasswordAuthMethod } from "./password-auth.method.ts";
import { AuthLoginThrottleService } from "./auth-login-throttle.service.ts";
import { getServerConfig } from "../../config/server-config.ts";
import {
  AuthLoginRequest,
  AuthLoginResult,
  AuthMethod,
  AuthMethodDescriptor,
  authMethodKind,
  AuthRedirectMethod,
  AuthResolvedAttempt,
  isRedirectMethod,
} from "./auth.types.ts";

/**
 * Чим закінчився вхід. Відмову за обмеженням спроб відрізняємо від невірного
 * пароля: їй потрібні 429 і `Retry-After`, а людині — знати, що чекати, а не
 * перевіряти розкладку.
 */
export type AuthLoginOutcome =
  | { ok: true; result: AuthLoginResult }
  | { ok: false; retryAfterSeconds: number | null };

@Injectable()
export class AuthFlowService {
  constructor(
    private passwordAuthMethod: PasswordAuthMethod,
    private authSessionService: AuthSessionService,
    private loginThrottle: AuthLoginThrottleService,
  ) {}

  /**
   * Доступні методи входу: вбудований пароль (якщо не вимкнений) плюс те, що
   * підклав застосунок через `auth.methods`. Читаємо конфігурацію на місці —
   * так немає ані окремого кроку реєстрації, ані питання про порядок.
   */
  private get methods(): AuthMethod[] {
    const { passwordEnabled, methods } = getServerConfig().auth;
    return passwordEnabled ? [this.passwordAuthMethod, ...methods] : [...methods];
  }

  getAvailableMethods(): AuthMethodDescriptor[] {
    return this.methods.map((method) => ({
      key: method.key,
      label: method.label,
      kind: authMethodKind(method),
    }));
  }

  /** Redirect-метод за ключем — для маршрутів authorize/callback. */
  findRedirectMethod(key: string): AuthRedirectMethod | null {
    const method = this.methods.find((item) => item.key === key);
    return method && isRedirectMethod(method) ? method : null;
  }

  /**
   * `address` — адреса клієнта (`clientAddress`), `null` — невідома; тоді
   * обмеження спроб діє лише за логіном.
   */
  async login(request: AuthLoginRequest, address: string | null): Promise<AuthLoginOutcome> {
    const attempt = this.resolveAttempt(request);
    const method = this.methods.find((item) => item.key === attempt.method);
    // Redirect-метод сюди не ходить: у нього немає облікових даних, які можна
    // прислати тілом. Спроба увійти ним через /login — помилка виклику, а не
    // невірний пароль, але назовні різниці немає навмисно: підказувати, який
    // саме метод існує, ні до чого.
    if (!method || isRedirectMethod(method)) {
      return { ok: false, retryAfterSeconds: null };
    }

    // Лічильник ведеться на кожен direct-метод, не лише на пароль: PIN чи
    // одноразовий код перебираються так само. Метод без логіна рахується
    // своїм ключем — інакше лишався б без лічильника за логіном зовсім.
    const login = typeof attempt.payload.login === "string" ? attempt.payload.login : "";
    const throttle = await this.loginThrottle.begin(login.trim() || `@${method.key}`, address);
    if (!throttle.allowed) {
      return { ok: false, retryAfterSeconds: throttle.retryAfterSeconds };
    }

    const user = await method.authenticate(attempt.payload);
    if (!user) {
      return { ok: false, retryAfterSeconds: null };
    }

    await this.loginThrottle.succeeded(throttle.id);
    const session = await this.authSessionService.createSession(user, method.key);

    return {
      ok: true,
      result: {
        user,
        method: method.key,
        session,
      },
    };
  }

  private resolveAttempt(request: AuthLoginRequest): AuthResolvedAttempt {
    const method = typeof request.method === "string" && request.method.trim()
      ? request.method.trim()
      : "password";

    if (request.payload && typeof request.payload === "object") {
      return {
        method,
        payload: request.payload,
      };
    }

    return {
      method,
      payload: {
        login: request.login,
        password: request.password,
      },
    };
  }
}