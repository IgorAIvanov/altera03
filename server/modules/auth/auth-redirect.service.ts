/**
 * Redirect-потік входу: похід до зовнішнього провайдера й повернення з нього.
 *
 * Межа з методом застосунку проведена так:
 *   · фреймворк — маршрути, `state`, зв'язка особи з користувачем, сесія;
 *   · метод — власне спілкування з провайдером (`authorizeUrl`, `exchange`).
 *
 * Тому в ядрі немає ні discovery, ні JWKS, ні жодного імені провайдера.
 */
import { Injectable } from "@danet/core";
import { AuthFlowService } from "./auth-flow.service.ts";
import { AuthIdentityService } from "./auth-identity.service.ts";
import { AuthLoginStateService, safeRedirectPath } from "./auth-login-state.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { getServerConfig } from "../../config/server-config.ts";
import type { HttpRequest } from "../../common/http.ts";
import type { AuthSessionInfo } from "./auth.types.ts";

/** Куди повертати, якщо ніхто не просив конкретного місця. */
const DEFAULT_RETURN_PATH = "/";

/** Параметр, яким екран входу отримує причину відмови. */
export const AUTH_ERROR_PARAM = "authError";

export type RedirectFailure =
  | "unknown-method"
  | "bad-state"
  | "provider-error"
  | "not-linked"
  | "inactive";

export type BeginResult =
  | { ok: true; authorizeUrl: string }
  | { ok: false; reason: RedirectFailure };

export type CompleteResult =
  | { ok: true; session: AuthSessionInfo; returnTo: string }
  | { ok: false; reason: RedirectFailure; returnTo: string };

/** Текст відмови для екрана входу. Подробиць від провайдера тут немає навмисно. */
export function redirectFailureMessage(reason: RedirectFailure): string {
  switch (reason) {
    case "unknown-method":
      return "Такий спосіб входу недоступний";
    case "bad-state":
      return "Спроба входу застаріла — почніть заново";
    case "not-linked":
      return "Цей обліковий запис не пов'язаний з жодним користувачем системи";
    case "inactive":
      return "Користувача деактивовано";
    case "provider-error":
      return "Провайдер не підтвердив вхід";
  }
}

@Injectable()
export class AuthRedirectService {
  constructor(
    private authFlowService: AuthFlowService,
    private authIdentityService: AuthIdentityService,
    private authLoginStateService: AuthLoginStateService,
    private authSessionService: AuthSessionService,
  ) {}

  /**
   * Абсолютний `redirect_uri` методу. Саме він піде провайдеру і саме він має
   * бути зареєстрований у нього — тому будується в одному місці й однаково для
   * authorize та exchange: розбіжність на один символ провайдер відхиляє.
   */
  redirectUri(request: HttpRequest, methodKey: string): string {
    const configured = getServerConfig().auth.publicBaseUrl;
    const base = configured ?? new URL(request.url).origin;
    return `${base}/api/auth/callback/${encodeURIComponent(methodKey)}`;
  }

  /** Крок 1: завести `state` і сказати, куди відправити браузер. */
  async begin(request: HttpRequest, methodKey: string, redirectTo: string | null): Promise<BeginResult> {
    const method = this.authFlowService.findRedirectMethod(methodKey);
    if (!method) {
      return { ok: false, reason: "unknown-method" };
    }

    const state = await this.authLoginStateService.create(
      method.key,
      safeRedirectPath(redirectTo),
    );

    try {
      const authorizeUrl = await method.authorizeUrl({
        state,
        redirectUri: this.redirectUri(request, method.key),
      });

      return { ok: true, authorizeUrl };
    } catch (error) {
      console.error(`[auth] ${method.key}: не вдалося побудувати authorize URL`, error);
      return { ok: false, reason: "provider-error" };
    }
  }

  /**
   * Крок 2: повернення від провайдера.
   *
   * `state` гаситься **до** обміну коду: інакше повторно надісланий callback
   * встиг би сходити до провайдера ще раз, перш ніж отримати відмову.
   */
  async complete(
    request: HttpRequest,
    methodKey: string,
    params: Record<string, string>,
  ): Promise<CompleteResult> {
    const method = this.authFlowService.findRedirectMethod(methodKey);
    if (!method) {
      return { ok: false, reason: "unknown-method", returnTo: DEFAULT_RETURN_PATH };
    }

    const consumed = await this.authLoginStateService.consume(params.state ?? "", method.key);
    if (!consumed) {
      return { ok: false, reason: "bad-state", returnTo: DEFAULT_RETURN_PATH };
    }

    const returnTo = consumed.redirectTo ?? DEFAULT_RETURN_PATH;

    // Провайдер міг відмовити сам («користувач натиснув Скасувати») — тоді
    // замість code приходить error. Обміняти нічого, і це не помилка системи.
    if (params.error || !params.code) {
      if (params.error) {
        console.warn(`[auth] ${method.key}: провайдер відмовив — ${params.error}`);
      }
      return { ok: false, reason: "provider-error", returnTo };
    }

    let identity;
    try {
      identity = await method.exchange({
        code: params.code,
        state: params.state ?? "",
        redirectUri: this.redirectUri(request, method.key),
        params,
      });
    } catch (error) {
      // Текст помилки лишається в логу: у ньому бувають подробиці запиту до
      // провайдера, і виносити їх на екран входу ні до чого.
      console.error(`[auth] ${method.key}: обмін коду не вдався`, error);
      return { ok: false, reason: "provider-error", returnTo };
    }

    if (!identity?.externalId) {
      return { ok: false, reason: "provider-error", returnTo };
    }

    const resolved = await this.authIdentityService.resolve(method.key, identity);
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason, returnTo };
    }

    const session = await this.authSessionService.createSession(resolved.user, method.key);
    return { ok: true, session, returnTo };
  }
}
