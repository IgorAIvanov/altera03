/**
 * Перетворення зовнішньої особи на користувача системи.
 *
 * Політика — **тільки заведена зв'язка**: провайдер підтверджує, що людина та
 * сама, але не те, що їй тут щось можна. Для бухгалтерської системи це різниця
 * принципова: інакше будь-хто, у кого є акаунт у провайдера, отримував би рядок
 * у `app.users`, а разом із ним — слід в аудиті документів.
 *
 * Виняток один і він одноразовий: порожня база. Тоді зовнішнім входом
 * заводиться перший адміністратор — інакше після розгортання без пароля нема
 * кому завести взагалі нікого. Умова та сама, що й у решті bootstrap-шляхів:
 * `app.users` порожня. Після першого користувача гілка недосяжна назавжди.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { AuthService } from "./auth.service.ts";
import type { AuthExternalIdentity, AuthUserDto, AuthUserRow } from "./auth.types.ts";
import { toAuthUserDto } from "./auth.types.ts";

/** Чому вхід не відбувся. Текст для користувача бере контролер. */
export type IdentityRejection = "not-linked" | "inactive";

export type IdentityResolution =
  | { ok: true; user: AuthUserDto; bootstrapped: boolean }
  | { ok: false; reason: IdentityRejection };

const LOGIN_MAX_LENGTH = 100;

/**
 * Логін для користувача, якого заводить bootstrap. E-mail, якщо провайдер його
 * дав, інакше `provider:sub` — аби він був стабільний і впізнаваний. Це лише
 * ім'я в списку: увійти паролем такий користувач не може (порожній хеш).
 */
function bootstrapLogin(provider: string, identity: AuthExternalIdentity): string {
  const candidate = identity.email?.trim() || `${provider}:${identity.externalId}`;
  return candidate.slice(0, LOGIN_MAX_LENGTH);
}

function bootstrapFullName(provider: string, identity: AuthExternalIdentity): string {
  return identity.displayName?.trim() || identity.email?.trim() || `${provider} user`;
}

@Injectable()
export class AuthIdentityService {
  constructor(private db: DatabaseService, private authService: AuthService) {}

  /**
   * Хто це в наших термінах.
   *
   * Порядок навмисно такий: спершу зв'язка, і лише за повної відсутності
   * користувачів — bootstrap. Перевіряти «база порожня» першим означало б
   * ганяти зайвий запит на кожному вході в живій системі.
   */
  async resolve(provider: string, identity: AuthExternalIdentity): Promise<IdentityResolution> {
    const normalizedProvider = provider.trim().toLowerCase();
    const externalId = identity.externalId.trim();

    if (!normalizedProvider || !externalId) {
      return { ok: false, reason: "not-linked" };
    }

    const linked = await this.findLinkedUser(normalizedProvider, externalId);
    if (linked) {
      if (linked.is_active === false) {
        return { ok: false, reason: "inactive" };
      }

      await this.touchIdentity(normalizedProvider, externalId, identity);
      return { ok: true, user: toAuthUserDto(linked), bootstrapped: false };
    }

    if (await this.authService.hasAnyUsers()) {
      return { ok: false, reason: "not-linked" };
    }

    const user = await this.bootstrapFirstUser(normalizedProvider, identity);
    return { ok: true, user, bootstrapped: true };
  }

  private async findLinkedUser(provider: string, externalId: string): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT u.id, u.login, u.full_name, u.is_active
      FROM app.user_identity i
      JOIN app.users u ON u.id = i.user_id
      WHERE i.provider = ${provider} AND i.external_id = ${externalId}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  /**
   * Оновлює довідкові поля зв'язки. На рішення вони не впливають — звіряння йде
   * тільки по `external_id`, — але без них не видно, коли людина заходила
   * востаннє і під якою адресою вона в провайдера зараз.
   */
  private async touchIdentity(
    provider: string,
    externalId: string,
    identity: AuthExternalIdentity,
  ): Promise<void> {
    await this.db.sql`
      UPDATE app.user_identity
      SET email = COALESCE(${identity.email?.trim() || null}, email),
          display_name = COALESCE(${identity.displayName?.trim() || null}, display_name),
          last_login_at = NOW(),
          updated_at = NOW()
      WHERE provider = ${provider} AND external_id = ${externalId}
    `;
  }

  /**
   * Перший користувач системи через зовнішній вхід: одразу в групу повного
   * доступу — рівно як робить `createFirstUser` для пароля.
   *
   * Пароль порожній, тобто увійти ним неможливо. Це свідомо: адміністратор,
   * заведений таким шляхом, ходить провайдером, а пароль за потреби ставить
   * собі сам (`deno task passwd` або адмін-екран).
   */
  private async bootstrapFirstUser(
    provider: string,
    identity: AuthExternalIdentity,
  ): Promise<AuthUserDto> {
    const user = await this.authService.createUser(
      bootstrapLogin(provider, identity),
      "",
      bootstrapFullName(provider, identity),
    );

    await this.authService.ensureDefaultAccess(user.id);
    await this.link(user.id, provider, identity);
    return toAuthUserDto(user);
  }

  /** Заводить зв'язку. Використовується bootstrap-ом; адмін робить те саме через `user_save`. */
  async link(userId: string, provider: string, identity: AuthExternalIdentity): Promise<void> {
    await this.db.sql`
      INSERT INTO app.user_identity (user_id, provider, external_id, email, display_name, last_login_at)
      VALUES (
        ${userId}::bigint,
        ${provider.trim().toLowerCase()},
        ${identity.externalId.trim()},
        ${identity.email?.trim() || null},
        ${identity.displayName?.trim() || null},
        NOW()
      )
      ON CONFLICT (provider, external_id) DO NOTHING
    `;
  }
}
