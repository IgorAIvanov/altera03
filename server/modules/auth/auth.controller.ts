import { Body, Controller, Get, Param, Post, Req } from "@danet/core";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthFlowService } from "./auth-flow.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { AuthService } from "./auth.service.ts";
import { clearSessionCookieHeaders, sessionCookieHeaders } from "./auth-cookie.ts";
import {
  AUTH_ERROR_PARAM,
  AuthRedirectService,
  redirectFailureMessage,
} from "./auth-redirect.service.ts";
import { htmlResponse, redirectBouncePage } from "./auth-redirect-page.ts";
import { err, ok, rows } from "../../common/response.ts";
import { type HttpRequest, jsonResponse } from "../../common/http.ts";
import type { AuthLoginRequest, AuthSessionInfo } from "./auth.types.ts";

/**
 * Сесія без токена: усе, крім самого секрету.
 *
 * Свідомо функція модуля, а не метод контролера: Danet вважає маршрутом кожен
 * метод класу і на першому ж без метаданих шляху падає ще під час bootstrap
 * (`trimSlash` на undefined). Допоміжним методам у контролері не місце.
 */
function publicSession(session: AuthSessionInfo): Omit<AuthSessionInfo, "token"> {
  const { token: _token, ...rest } = session;
  return rest;
}

/** Query-параметри запиту плоским об'єктом: провайдери додають свої поля. */
function queryParams(request: HttpRequest): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/** Шлях повернення з причиною відмови — її покаже екран входу. */
function withAuthError(path: string, message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${AUTH_ERROR_PARAM}=${encodeURIComponent(message)}`;
}

/**
 * Авторизація. Відповідає тим самим конвертом, що й команди моделей:
 * одиночний об'єкт — у `data.item`, список — у `data.rows`.
 *
 * Токен сесії назовні не віддається — він їде httpOnly-cookie. У тілі
 * лишається все, що потрібне інтерфейсу: хто увійшов, яким методом і доки.
 */
@Controller("api/auth")
export class AuthController {
  constructor(
    private authBootstrapService: AuthBootstrapService,
    private authFlowService: AuthFlowService,
    private authSessionService: AuthSessionService,
    private authService: AuthService,
    private authRedirectService: AuthRedirectService,
  ) {}

  @Get("bootstrap-state")
  async bootstrapState() {
    return ok(await this.authBootstrapService.getBootstrapState());
  }

  @Post("bootstrap")
  async bootstrap(@Body() body: { login: string; password: string; fullName: string }) {
    const result = await this.authBootstrapService.createFirstUser(body);
    if (!result.ok) {
      return jsonResponse(err(result.message), 400);
    }

    const { user } = result;
    const session = await this.authSessionService.createSession(user, "password");
    return jsonResponse(
      ok({ user, method: "password", session: publicSession(session) }),
      200,
      sessionCookieHeaders(session.token),
    );
  }

  @Post("login")
  async login(@Body() body: AuthLoginRequest) {
    const result = await this.authFlowService.login(body);
    if (!result) {
      return jsonResponse(err("Невірний логін або пароль"), 401);
    }

    return jsonResponse(
      ok({ user: result.user, method: result.method, session: publicSession(result.session) }),
      200,
      sessionCookieHeaders(result.session.token),
    );
  }

  @Get("methods")
  methods() {
    return rows(this.authFlowService.getAvailableMethods());
  }

  /**
   * Початок входу через зовнішнього провайдера. Це навігація браузера, а не
   * fetch: у відповідь — 302 на провайдера, тому й GET.
   *
   * `?redirect=/шлях` — куди повернути після входу; приймається лише шлях від
   * кореня (див. `safeRedirectPath`), інакше вхід став би відкритим редиректом.
   */
  @Get("authorize/:method")
  async authorize(@Req() req: HttpRequest, @Param("method") method: string) {
    const params = queryParams(req);
    const result = await this.authRedirectService.begin(req, method, params.redirect ?? null);

    if (!result.ok) {
      return htmlResponse(
        redirectBouncePage(withAuthError("/", redirectFailureMessage(result.reason))),
        400,
      );
    }

    return new Response(null, { status: 302, headers: { location: result.authorizeUrl } });
  }

  /**
   * Повернення від провайдера.
   *
   * Відповідь — документ, а не 302: cookie сесії має `SameSite=Strict`, і
   * редирект із крос-сайтового ланцюжка не доніс би її до наступного запиту.
   * Подробиці — в `auth-redirect-page.ts`.
   */
  @Get("callback/:method")
  async callback(@Req() req: HttpRequest, @Param("method") method: string) {
    const result = await this.authRedirectService.complete(req, method, queryParams(req));

    if (!result.ok) {
      return htmlResponse(
        redirectBouncePage(withAuthError(result.returnTo, redirectFailureMessage(result.reason))),
        200,
        // Cookie гасимо: на цьому шляху могла лишитися чужа або мертва сесія,
        // а показувати екран входу з живою cookie — найкоротший шлях до плутанини.
        clearSessionCookieHeaders(),
      );
    }

    return htmlResponse(
      redirectBouncePage(result.returnTo),
      200,
      sessionCookieHeaders(result.session.token),
    );
  }

  @Get("me")
  async me(@Req() req: HttpRequest) {
    const sessionUser = await this.authSessionService.resolveSessionUser(req);
    // Немає сесії — це не помилка, а порожній item: клієнт просто показує вхід.
    return ok(
      sessionUser
        ? { user: sessionUser.user, session: publicSession(sessionUser.session) }
        : null,
    );
  }

  /** Права поточного користувача — щоб інтерфейс гасив кнопки локально. */
  @Get("permissions")
  async permissions(@Req() req: HttpRequest) {
    const sessionUser = await this.authSessionService.resolveSessionUser(req);
    if (!sessionUser) {
      return jsonResponse(err("Необхідна авторизація"), 401);
    }

    return rows(await this.authService.getEffectivePermissions(sessionUser.user.id));
  }

  @Post("logout")
  async logout(@Req() req: HttpRequest) {
    await this.authSessionService.revokeSession(req);
    return jsonResponse(ok({ loggedOut: true }), 200, clearSessionCookieHeaders());
  }

  @Post("refresh")
  async refresh(@Req() req: HttpRequest) {
    const session = await this.authSessionService.refreshSession(req);
    if (!session) {
      // Сесії немає або вона мертва — гасимо cookie, щоб браузер не носив
      // непотріб і клієнт одразу побачив «не авторизований».
      return jsonResponse(err("Необхідна авторизація"), 401, clearSessionCookieHeaders());
    }

    return jsonResponse(
      ok({ session: publicSession(session) }),
      200,
      sessionCookieHeaders(session.token),
    );
  }
}
