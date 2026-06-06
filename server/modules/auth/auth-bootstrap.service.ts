import { Injectable } from "@danet/core";
import { AuthService } from "./auth.service.ts";
import { hashPassword } from "./password-hash.ts";
import type { AuthUserDto } from "./auth.types.ts";
import { toAuthUserDto } from "./auth.types.ts";

interface BootstrapConfig {
  login: string;
  password: string;
  fullName: string;
}

@Injectable()
export class AuthBootstrapService {
  constructor(private authService: AuthService) {}

  async getBootstrapState() {
    const needsSetup = !(await this.authService.hasAnyUsers());
    const configuredUser = this.getConfiguredBootstrapUser();

    return {
      needsSetup,
      predefinedUserAvailable: Boolean(configuredUser),
      predefinedLogin: configuredUser?.login ?? null,
    };
  }

  async createFirstUser(input: { login: string; password: string; fullName: string }): Promise<AuthUserDto | null> {
    if (await this.authService.hasAnyUsers()) {
      return null;
    }

    const login = input.login.trim();
    const password = input.password;
    const fullName = input.fullName.trim();

    if (!login || !password || !fullName) {
      return null;
    }

    const passwordHash = await hashPassword(password);
    const user = await this.authService.createUser(login, passwordHash, fullName);
    await this.authService.ensureDefaultAccess(user.id);
    return toAuthUserDto(user);
  }

  async tryBootstrapLogin(login: string, password: string): Promise<AuthUserDto | null> {
    if (await this.authService.hasAnyUsers()) {
      return null;
    }

    const configuredUser = this.getConfiguredBootstrapUser();
    if (!configuredUser) {
      return null;
    }

    if (configuredUser.login !== login.trim() || configuredUser.password !== password) {
      return null;
    }

    const existingUser = await this.authService.findUserByLogin(configuredUser.login);
    if (existingUser) {
      await this.authService.ensureDefaultAccess(existingUser.id);
      return toAuthUserDto(existingUser);
    }

    const passwordHash = await hashPassword(configuredUser.password);
    const user = await this.authService.createUser(
      configuredUser.login,
      passwordHash,
      configuredUser.fullName,
    );
    await this.authService.ensureDefaultAccess(user.id);
    return toAuthUserDto(user);
  }

  private getConfiguredBootstrapUser(): BootstrapConfig | null {
    const login = Deno.env.get("BOOTSTRAP_LOGIN")?.trim() ?? "";
    const password = Deno.env.get("BOOTSTRAP_PASSWORD") ?? "";
    const fullName = Deno.env.get("BOOTSTRAP_FULL_NAME")?.trim() || "Bootstrap administrator";

    if (!login || !password) {
      return null;
    }

    return {
      login,
      password,
      fullName,
    };
  }
}