/**
 * Канал приймання: спарювання, партії, частини, підсумок.
 *
 * ХТО СЮДИ СТУКАЄ. Не людина й не браузер, а чужий процес із чужої машини —
 * обробка, запущена в базі клієнта, касове ПЗ, банк-клієнт. Він ходить лише
 * НАЗОВНІ (вхідних з'єднань не приймає), везе сотні тисяч рядків і рветься на
 * середині. Звідси всі рішення нижче.
 *
 * ЧОМУ ЦЕ В ЯДРІ. Тут немає нічого прикладного: жодного рахунку, жодної моделі,
 * жодного слова про 1С. Є транспорт — ідемпотентність, цілісність, зв'язок із
 * токеном — і ціна помилки в ньому висока й тиха: прийняли пакет без однієї
 * частини, а шукатимуть потім у правилах конвертації. До того ж застосунок на
 * Deno Deploy і застосунок бінарем мусять приймати однаково.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { getServerConfig } from "../../config/server-config.ts";
import type { ImportPlanItem, ImportSessionContext } from "./import.types.ts";
import { randomToken, sha256Hex } from "./import.codes.ts";

/** Префікс області дії токена каналу: `import:42`. */
const SCOPE_PREFIX = "import:";

/** Помилка каналу з кодом стану: відповідь читає машина, не людина. */
export class ImportChannelError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ImportChannelError";
  }
}

@Injectable()
export class ImportService {
  constructor(private db: DatabaseService) {}

  private get config() {
    return getServerConfig().import;
  }

  /**
   * Обмін коду на токен каналу.
   *
   * Єдиний вхід каналу БЕЗ автентифікації — інакше його нічим було б почати:
   * адаптер має рівно те, що людина прочитала з екрана й продиктувала.
   *
   * Тому три речі тримаються разом: код одноразовий (гасить себе тим самим
   * запитом, що й обмінює), живе хвилини, а відмова не розрізняє причин —
   * «не той», «протермінувався» і «сесію закрито» ззовні виглядають однаково.
   */
  async pair(
    code: string,
    passport: Record<string, unknown> | null,
  ): Promise<{ token: string; sessionId: string; plan: ImportPlanItem[] }> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw new ImportChannelError(403, "код спарювання не підійшов");

    const claimed = await this.db.sql<{ id: string | null }[]>`
      select app.import_pair_claim(
        ${await sha256Hex(normalized)},
        ${passport ? this.db.sql.json(passport as never) : null}::jsonb
      )::text as id
    `;

    const sessionId = claimed[0]?.id ?? null;
    if (!sessionId) throw new ImportChannelError(403, "код спарювання не підійшов");

    const token = randomToken();
    const expires = new Date(Date.now() + this.config.tokenTtlHours * 3_600_000);

    const issued = await this.db.sql<{ id: string }[]>`
      select app.import_token_issue(
        ${sessionId}::bigint,
        ${`Канал перенесення #${sessionId}`},
        ${await sha256Hex(token)},
        ${expires}::timestamptz
      )::text as id
    `;

    const tokenId = issued[0]?.id;
    if (!tokenId) throw new ImportChannelError(500, "не вдалося видати токен каналу");

    await this.db.sql`select app.import_session_attach_token(${sessionId}::bigint, ${tokenId}::bigint)`;

    return { token, sessionId, plan: await this.plan(sessionId) };
  }

  /**
   * Сесія за областю дії токена.
   *
   * Область дії — рядок `import:42`, і розбирає його саме канал: система прав
   * формату не тлумачить, бо він належить тому входу, якому канал належить.
   */
  sessionFromScope(scope: string | null | undefined): string {
    if (!scope || !scope.startsWith(SCOPE_PREFIX)) {
      throw new ImportChannelError(403, "цей токен не належить каналу перенесення");
    }
    const id = scope.slice(SCOPE_PREFIX.length);
    if (!/^\d+$/.test(id)) throw new ImportChannelError(403, "зіпсована область дії токена");
    return id;
  }

  /** План для сесії: питаємо застосунок, бо ядро не знає, що замовляти. */
  async plan(sessionId: string): Promise<ImportPlanItem[]> {
    const hook = this.config.plan;
    if (!hook) return [];

    const rows = await this.db.sql<{ session: ImportSessionContext | null; done: string[] }[]>`
      select app.import_session_channel(${sessionId}::bigint) as session,
             app.import_plan_done(${sessionId}::bigint) as done
    `;

    const session = rows[0]?.session;
    if (!session) throw new ImportChannelError(404, "сесію перенесення не знайдено");

    const items = await hook({ ...session, done: rows[0]?.done ?? [] });
    return Array.isArray(items) ? items : [];
  }

  /** Відкрити партію під пункт плану. */
  async openBatch(
    sessionId: string,
    query: string,
    passport: Record<string, unknown> | null,
  ): Promise<string> {
    if (!query.trim()) throw new ImportChannelError(400, "партія без імені запиту");

    const rows = await this.db.sql<{ id: string | null }[]>`
      select app.import_batch_open(
        ${sessionId}::bigint,
        ${query},
        ${passport ? this.db.sql.json(passport as never) : null}::jsonb,
        ${getServerConfig().version.solution ?? null}
      )::text as id
    `;

    const id = rows[0]?.id ?? null;
    // Сесії немає або її закрито. Друге важливіше: закритий канал не приймає
    // нічого, і дізнатися про це адаптер має тут, а не після того, як вивантажив
    // сто тисяч рядків.
    if (!id) throw new ImportChannelError(409, "сесію перенесення закрито");
    return id;
  }

  /**
   * Прийняти частину.
   *
   * `sha256` рахується по СИРИХ БАЙТАХ тіла запиту, а не по розібраному JSON:
   * відтворити точний текст, який сформував адаптер, ми не можемо (порядок
   * ключів, пробіли, форма чисел), а байти — можемо. Тому хеш і їде заголовком,
   * а не полем усередині тіла, яке інакше мусило б хешувати саме себе.
   */
  async putPart(
    sessionId: string,
    batchId: string,
    partNo: number,
    rawBody: Uint8Array,
    declaredSha: string,
  ): Promise<{ repeat: boolean; rows: number }> {
    if (!Number.isInteger(partNo) || partNo < 1) {
      throw new ImportChannelError(400, "номер частини має бути цілим від 1");
    }

    const actual = await sha256Hex(rawBody);
    if (declaredSha.trim().toLowerCase() !== actual) {
      // Не захист від зловмисника (він порахував би хеш сам), а свідчення, що
      // по дорозі нічого не загубилося: обрізане тіло розбирається в коректний
      // JSON рівно доти, доки не розбереться.
      throw new ImportChannelError(400, "sha256 частини не збігається з тілом запиту");
    }

    let items: unknown;
    try {
      items = JSON.parse(new TextDecoder().decode(rawBody))?.items;
    } catch {
      throw new ImportChannelError(400, "тіло частини не розібралося як JSON");
    }

    if (!Array.isArray(items)) throw new ImportChannelError(400, "у тілі частини немає items");
    if (items.length > this.config.maxPartItems) {
      throw new ImportChannelError(
        413,
        `у частині забагато елементів: ${items.length}, межа ${this.config.maxPartItems}`,
      );
    }

    const result = await this.call(
      this.db.sql<{ result: PartResult }[]>`
        select app.import_part_put(
          ${sessionId}::bigint, ${batchId}::bigint, ${partNo}, ${actual},
          ${this.db.sql.json(items as never)}::jsonb
        ) as result
      `,
    );

    return { repeat: result.repeat === true, rows: Number(result.rows ?? 0) };
  }

  /** Підсумок партії. Готовою вона стає лише коли зійшлися обидва числа. */
  async finishBatch(
    sessionId: string,
    batchId: string,
    parts: number | null,
    rows: number | null,
    error: string | null,
  ): Promise<PartResult> {
    return await this.call(
      this.db.sql<{ result: PartResult }[]>`
        select app.import_batch_done(
          ${sessionId}::bigint, ${batchId}::bigint, ${parts}, ${rows}, ${error}
        ) as result
      `,
      // Підсумок, який не зійшовся, — це не помилка запиту: партія чесно
      // позначена зіпсованою, і адаптер має прочитати стан, а не 400.
      { failOnNotOk: false },
    );
  }

  /** Стан партії: що вже прийнято й чого бракує. */
  async batchState(sessionId: string, batchId: string): Promise<PartResult> {
    return await this.call(
      this.db.sql<{ result: PartResult }[]>`
        select app.import_batch_state(${sessionId}::bigint, ${batchId}::bigint) as result
      `,
    );
  }

  /**
   * Відповідь машинерії каналу: `{ ok, error, … }`, не конверт моделі.
   *
   * Коди відмов тут технічні (`batch_not_found`, `part_mismatch`) і читає їх
   * адаптер, а не людина, — тому й маркерів перекладу в них немає.
   */
  private async call(
    query: Promise<{ result: PartResult }[]>,
    options: { failOnNotOk?: boolean } = {},
  ): Promise<PartResult> {
    const rows = await query;
    const result = rows[0]?.result;
    if (!result) throw new ImportChannelError(500, "канал не повернув відповіді");

    if (options.failOnNotOk !== false && result.ok !== true) {
      const status = result.error === "batch_not_found" ? 404 : 409;
      throw new ImportChannelError(status, String(result.error ?? "відмова каналу"));
    }
    return result;
  }
}

interface PartResult {
  ok?: boolean;
  error?: string | null;
  repeat?: boolean;
  rows?: number;
  [key: string]: unknown;
}
