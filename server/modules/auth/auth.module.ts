import { Module } from "@danet/core";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthFlowService } from "./auth-flow.service.ts";
import { AuthIdentityService } from "./auth-identity.service.ts";
import { AuthLoginStateService } from "./auth-login-state.service.ts";
import { AuthRedirectService } from "./auth-redirect.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { AuthService } from "./auth.service.ts";
import { AuthTokenService } from "./auth-token.service.ts";
import { PasswordAuthMethod } from "./password-auth.method.ts";

@Module({
  controllers: [AuthController],
  injectables: [
    AuthService,
    AuthBootstrapService,
    AuthTokenService,
    AuthSessionService,
    PasswordAuthMethod,
    AuthFlowService,
    AuthLoginStateService,
    AuthIdentityService,
    AuthRedirectService,
  ],
})
export class AuthModule {}
