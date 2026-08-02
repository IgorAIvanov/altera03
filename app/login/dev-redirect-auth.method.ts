/**
 * Провайдер-заглушка для redirect-входу.
 *
 * Потрібен, бо живого OAuth-провайдера в розробці немає, а перевіряти redirect
 * «коли з'явиться Google» означає не перевіряти ніколи. Заглушка проходить весь
 * шлях фреймворку — `state`, callback, обмін коду, зв'язка з користувачем,
 * cookie сесії, — і єдине, чого вона не робить, це крос-доменний перехід.
 *
 * Логіка тривіальна навмисно: `authorizeUrl` одразу повертає адресу нашого ж
 * callback із кодом. Тобто «провайдер» підтверджує особу без питань — усе, що
 * перевіряється далі, лежить на боці фреймворку, а саме його ми й тестуємо.
 *
 * Це файл **застосунку**, а не фреймворку: ядро провайдерів не постачає, воно
 * дає контракт. Заглушка заразом показує, як виглядає його реалізація.
 */
import { isProductionEnvironment } from "@altera/server";
import type {
  AuthAuthorizeInput,
  AuthExchangeInput,
  AuthExternalIdentity,
  AuthRedirectMethod,
} from "@altera/server";

/** Кого «підтверджує» заглушка, якщо не сказано інакше. */
const DEFAULT_SUBJECT = "dev-subject";

export interface DevRedirectAuthOptions {
  /** Зовнішній ідентифікатор (аналог OIDC `sub`), який віддасть заглушка. */
  subject?: string;
  email?: string;
  displayName?: string;
}

export class DevRedirectAuthMethod implements AuthRedirectMethod {
  readonly key = "dev";
  readonly label = "Тестовий провайдер (dev)";

  private readonly subject: string;
  private readonly email?: string;
  private readonly displayName?: string;

  constructor(options: DevRedirectAuthOptions = {}) {
    // Той самий запобіжник, що й у DEV_AUTH_BYPASS: краще не піднятися взагалі,
    // ніж мовчки лишити в продуктиві вхід, який пускає без жодної перевірки.
    if (isProductionEnvironment()) {
      throw new Error("Тестовий провайдер входу увімкнено у продуктивному оточенні — так не можна");
    }

    this.subject = options.subject?.trim() || DEFAULT_SUBJECT;
    this.email = options.email?.trim() || undefined;
    this.displayName = options.displayName?.trim() || `Dev ${this.subject}`;
  }

  /**
   * «Сторінка провайдера» — це наш же callback. Код несе в собі суб'єкта: так
   * видно, що фреймворк дійсно бере особу з обміну, а не з конфігурації методу.
   */
  authorizeUrl({ state, redirectUri }: AuthAuthorizeInput): string {
    const url = new URL(redirectUri);
    url.searchParams.set("code", `dev:${this.subject}`);
    url.searchParams.set("state", state);
    return url.toString();
  }

  exchange({ code }: AuthExchangeInput): Promise<AuthExternalIdentity | null> {
    const [prefix, subject] = code.split(":", 2);
    if (prefix !== "dev" || !subject) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      externalId: subject,
      email: this.email,
      displayName: this.displayName,
    });
  }
}

/**
 * Методи входу, які застосунок додає в розробці. Порожній масив — звичайний
 * стан: заглушка вмикається лише явним `DEV_AUTH_REDIRECT`.
 */
export function devAuthMethods(): AuthRedirectMethod[] {
  const raw = Deno.env.get("DEV_AUTH_REDIRECT")?.trim().toLowerCase();
  if (raw !== "1" && raw !== "true" && raw !== "yes") {
    return [];
  }

  return [
    new DevRedirectAuthMethod({
      subject: Deno.env.get("DEV_AUTH_REDIRECT_SUBJECT") ?? undefined,
      email: Deno.env.get("DEV_AUTH_REDIRECT_EMAIL") ?? undefined,
    }),
  ];
}
