import { Body, Controller, Get, Post, Req } from "@danet/core";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthFlowService } from "./auth-flow.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { AuthService } from "./auth.service.ts";
import { clearSessionCookieHeaders, sessionCookieHeaders } from "./auth-cookie.ts";
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
  ) {}

  @Get("bootstrap-state")
  async bootstrapState() {
    return ok(await this.authBootstrapService.getBootstrapState());
  }

  @Post("bootstrap")
  async bootstrap(@Body() body: { login: string; password: string; fullName: string }) {
    const user = await this.authBootstrapService.createFirstUser(body);
    if (!user) {
      return jsonResponse(err("Початковий користувач уже створений або дані некоректні"), 400);
    }

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
