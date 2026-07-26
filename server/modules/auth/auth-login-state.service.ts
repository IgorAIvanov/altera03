/**
 * Разовий `state` redirect-потоку.
 *
 * Навіщо: callback приходить від провайдера звичайним GET, і без `state`
 * будь-хто міг би підсунути користувачеві посилання на наш callback зі *своїм*
 * кодом — і тихо посадити його у свою сесію (session fixation). `state`
 * прив'язує callback до authorize, який починав саме цей браузер.
 *
 * Зберігається в БД, а не в пам'яті процесу: `dev:server` ходить із `--watch`,
 * і стан у пам'яті помирав би при кожному перезапуску рівно посеред
 * відлагодження. Плюс так потік переживає кілька інстансів сервера.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { AuthTokenService } from "./auth-token.service.ts";

/** Скільки живе незавершений вхід. Похід до провайдера — це хвилини, не години. */
const LOGIN_STATE_TTL_MINUTES = 10;

interface LoginStateRow {
  state: string;
  auth_method: string;
  redirect_to: string | null;
}

export interface ConsumedLoginState {
  method: string;
  redirectTo: string | null;
}

/**
 * Куди повертати після входу. Тільки шлях від кореня і без `//` на початку:
 * інакше `?redirect=https://evil` перетворив би вхід на відкритий редирект —
 * причому такий, що спрацьовує вже після створення сесії.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }

  return raw.slice(0, 500);
}

@Injectable()
export class AuthLoginStateService {
  constructor(private db: DatabaseService, private tokenService: AuthTokenService) {}

  /** Заводить новий `state` під конкретний метод. */
  async create(method: string, redirectTo: string | null): Promise<string> {
    // Прибирання на місці: окремого прибиральника заводити ні до чого, а рядків
    // тут стільки ж, скільки незавершених входів.
    await this.db.sql`DELETE FROM app.auth_login_state WHERE expires_at < NOW()`;

    const state = this.tokenService.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + LOGIN_STATE_TTL_MINUTES * 60 * 1000).toISOString();

    await this.db.sql`
      INSERT INTO app.auth_login_state (state, auth_method, redirect_to, expires_at)
      VALUES (${state}, ${method}, ${redirectTo}, ${expiresAt}::timestamptz)
    `;

    return state;
  }

  /**
   * Гасить `state` і віддає те, що з ним пов'язано. `null` — стан невідомий,
   * протухлий або вже погашений; у всіх трьох випадках вхід відхиляється.
   *
   * Погашення й читання — один UPDATE ... RETURNING навмисно: два запити
   * лишали б вікно, в якому один і той самий callback проходить двічі.
   */
  async consume(state: string, method: string): Promise<ConsumedLoginState | null> {
    if (!state) {
      return null;
    }

    const rows = await this.db.sql<LoginStateRow[]>`
      UPDATE app.auth_login_state
      SET consumed_at = NOW()
      WHERE state = ${state}
        AND auth_method = ${method}
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING state, auth_method, redirect_to
    `;

    const row = rows[0];
    return row ? { method: row.auth_method, redirectTo: row.redirect_to } : null;
  }
}
