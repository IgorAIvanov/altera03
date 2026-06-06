import { Injectable } from "@danet/core";
import { AuthBootstrapService } from "./auth-bootstrap.service.ts";
import { AuthService } from "./auth.service.ts";
import type { AuthMethod, AuthUserDto } from "./auth.types.ts";
import { toAuthUserDto } from "./auth.types.ts";
import { verifyPassword } from "./password-hash.ts";

@Injectable()
export class PasswordAuthMethod implements AuthMethod {
  readonly key = "password";
  readonly label = "Логін і пароль";

  constructor(
    private authService: AuthService,
    private authBootstrapService: AuthBootstrapService,
  ) {}

  async authenticate(payload: Record<string, unknown>): Promise<AuthUserDto | null> {
    const login = typeof payload.login === "string" ? payload.login.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";

    if (!login || !password) {
      return null;
    }

    const user = await this.authService.findUserByLogin(login);
    if (!user) {
      return await this.authBootstrapService.tryBootstrapLogin(login, password);
    }

    if (!user.password_hash) {
      return null;
    }

    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return null;
    }

    return toAuthUserDto(user);
  }
}