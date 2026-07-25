import { Injectable } from "@danet/core";
import { AuthService } from "./auth.service.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password-hash.ts";
import type { AuthUserDto } from "./auth.types.ts";
import { toAuthUserDto } from "./auth.types.ts";
import { getServerConfig, type BootstrapUserConfig } from "../../config/server-config.ts";

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

  /**
   * Перший користувач: створюється лише поки їх немає жодного, і одразу
   * потрапляє в групу повного доступу — інакше після першого запуску нема кому
   * налаштувати решту.
   *
   * Пароль міряється тією ж лінійкою, що й скрізь (`MIN_PASSWORD_LENGTH`).
   * Раніше тут перевірялося тільки «непорожній», і найпривілейованіший акаунт
   * у системі виявлявся єдиним, який можна завести з паролем «1».
   *
   * Причина відмови повертається текстом: «дані некоректні» на екрані першого
   * запуску не підказує нічого, а виправити його нема кому — адміністратора
   * ще не існує.
   */
  async createFirstUser(
    input: { login: string; password: string; fullName: string },
  ): Promise<{ ok: true; user: AuthUserDto } | { ok: false; message: string }> {
    if (await this.authService.hasAnyUsers()) {
      return { ok: false, message: "Початковий користувач уже створений" };
    }

    const login = input.login?.trim() ?? "";
    const password = input.password ?? "";
    const fullName = input.fullName?.trim() ?? "";

    if (!login || !fullName) {
      return { ok: false, message: "Логін і повне ім'я обов'язкові" };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        ok: false,
        message: `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`,
      };
    }

    const passwordHash = await hashPassword(password);
    const user = await this.authService.createUser(login, passwordHash, fullName);
    await this.authService.ensureDefaultAccess(user.id);
    return { ok: true, user: toAuthUserDto(user) };
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

  private getConfiguredBootstrapUser(): BootstrapUserConfig | null {
    return getServerConfig().auth.bootstrapUser;
  }
}