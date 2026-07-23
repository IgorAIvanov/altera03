import { Injectable } from "@danet/core";
import { AuthSessionService } from "./auth-session.service.ts";
import { PasswordAuthMethod } from "./password-auth.method.ts";
import { getServerConfig } from "../../config/server-config.ts";
import {
  AuthLoginRequest,
  AuthLoginResult,
  AuthMethod,
  AuthMethodDescriptor,
  AuthResolvedAttempt,
} from "./auth.types.ts";

@Injectable()
export class AuthFlowService {
  constructor(
    private passwordAuthMethod: PasswordAuthMethod,
    private authSessionService: AuthSessionService,
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
    }));
  }

  async login(request: AuthLoginRequest): Promise<AuthLoginResult | null> {
    const attempt = this.resolveAttempt(request);
    const method = this.methods.find((item) => item.key === attempt.method);
    if (!method) {
      return null;
    }

    const user = await method.authenticate(attempt.payload);
    if (!user) {
      return null;
    }

    const session = await this.authSessionService.createSession(user, method.key);

    return {
      user,
      method: method.key,
      session,
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