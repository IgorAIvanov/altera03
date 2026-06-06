import { Body, Controller, Get, Post, Req } from "@danet/core";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthFlowService } from "./auth-flow.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { ok, err } from "../../common/response.ts";
import type { AuthLoginRequest } from "./auth.types.ts";

@Controller("api/auth")
export class AuthController {
  constructor(
    private authBootstrapService: AuthBootstrapService,
    private authFlowService: AuthFlowService,
    private authSessionService: AuthSessionService,
  ) {}

  @Get("bootstrap-state")
  async bootstrapState() {
    return ok(await this.authBootstrapService.getBootstrapState());
  }

  @Post("bootstrap")
  async bootstrap(@Body() body: { login: string; password: string; fullName: string }) {
    const user = await this.authBootstrapService.createFirstUser(body);
    if (!user) {
      return err("Початковий користувач уже створений або дані некоректні");
    }

    const session = await this.authSessionService.createSession(user, "password");
    return ok({ user, method: "password", session });
  }

  @Post("login")
  async login(@Body() body: AuthLoginRequest) {
    const result = await this.authFlowService.login(body);
    if (!result) {
      return err("Невірний логін або пароль");
    }

    return ok(result);
  }

  @Get("methods")
  methods() {
    return ok({ methods: this.authFlowService.getAvailableMethods() });
  }

  @Get("me")
  async me(
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    const sessionUser = await this.authSessionService.resolveSessionUser(req);
    if (sessionUser) {
      return ok({ user: sessionUser.user, session: sessionUser.session });
    }

    return ok(null);
  }

  @Post("logout")
  async logout(
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    await this.authSessionService.revokeSession(req);
    return ok({ loggedOut: true });
  }

  @Post("refresh")
  async refresh(
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    const session = await this.authSessionService.refreshSession(req);
    if (!session) {
      return new Response(JSON.stringify(err("Необхідна авторизація")), {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    return ok({ session });
  }
}
