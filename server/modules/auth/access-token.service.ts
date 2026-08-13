/**
 * Персональні токени доступу — облікові дані для МАШИНИ.
 *
 * Сесія народжується з парольного входу, живе в cookie й помирає з виходом;
 * зовнішньому агенту (Claude через MCP, скрипт, інтеграція) нічого з цього не
 * годиться — він не відкриває браузер і не вводить пароль. Токен це те саме
 * `Authorization: Bearer`, лише довгоживуче й відкликуване однією дією.
 *
 * ЧОМУ НЕ МОДЕЛЬ. Токени — це «моє», як власний пароль, а не запис, яким
 * керують за правами. Зроби їх моделлю — і щоб видати собі токен, кожен
 * користувач мусив би мати права на цю модель; забув адміністратор видати —
 * агента не завести. Тому вони живуть там само, де зміна власного пароля: на
 * `/api/auth`, поза системою прав моделей.
 *
 * ЧОМУ ГЕНЕРАЦІЯ ТУТ, А НЕ В SQL. Значення мусять давати ті самі випадкові
 * байти, що й для сесії, а в базу має лягти лише хеш. У SQL-функції сире
 * значення стало б параметром запиту — тобто потрапило б у будь-який журнал,
 * який пише параметри. Тут воно не виходить за межі процесу.
 *
 * Значення повертається ОДИН раз, другого способу дізнатися його немає: у
 * таблиці хеш. Це й є та властивість, заради якої так зроблено — вкрадений
 * дамп бази доступу не дає.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";

const TOKEN_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface AccessTokenCreateInput {
  name: string;
  isReadOnly?: boolean;
  expiresInDays?: number | null;
}

@Injectable()
export class AccessTokenService {
  constructor(private db: DatabaseService) {}

  /** Токени користувача — без значень, лише опис і стан. */
  async list(userId: string): Promise<unknown> {
    const rows = await this.db.sql<Array<{ result: unknown }>>`
      SELECT app.access_token_list(${userId}::bigint, '{}'::jsonb) AS result
    `;
    return rows[0]?.result;
  }

  /** Видати токен. Значення в `data.item.token` — і більше ніде й ніколи. */
  async create(userId: string, input: AccessTokenCreateInput): Promise<unknown> {
    const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));

    // `sql.json(...)`, а не `JSON.stringify`: рядок постгрес-драйвер віддає як
    // ТЕКСТ, і `::jsonb` робить із нього json-скаляр — рядок у лапках, у якого
    // `->>'name'` дорівнює null. Помилка тиха: функція просто бачить порожній
    // payload. Так само передає payload і рантайм моделей.
    const payload = this.db.sql.json({
      name: input.name,
      tokenHash: await sha256Hex(token),
      isReadOnly: input.isReadOnly === true,
      expiresInDays: input.expiresInDays ?? null,
    });

    const rows = await this.db.sql<Array<{ result: unknown }>>`
      SELECT app.access_token_add(${userId}::bigint, ${payload}::jsonb) AS result
    `;

    const envelope = rows[0]?.result as Record<string, unknown> | undefined;
    if (!envelope || envelope.ok !== true) {
      // Відмову віддаємо як є — у ній лежить повідомлення з полем (`name`).
      return envelope;
    }

    const data = envelope.data as Record<string, unknown>;
    const item = (data.item ?? {}) as Record<string, unknown>;
    return { ...envelope, data: { ...data, item: { ...item, token } } };
  }

  /** Відкликати СВІЙ токен. Чужий не відкликається навіть за відомим id. */
  async revoke(userId: string, id: string): Promise<unknown> {
    const rows = await this.db.sql<Array<{ result: unknown }>>`
      SELECT app.access_token_delete(
        ${userId}::bigint,
        ${this.db.sql.json({ id })}::jsonb
      ) AS result
    `;
    return rows[0]?.result;
  }
}
