import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { isMissingDatabaseFunction } from "../../database/database-error.ts";
import { signEnvelopeTokens } from "../blob/blob-token.ts";
import { looksLikeEnvelope, ModelCommandError } from "./model-runtime.errors.ts";
import { getModelConfig, supportsPosting } from "./model-registry.ts";
import type {
  ModelBackendConfig,
  ModelCommandContext,
  SqlModelCommandDefinition,
  SqlModelCommandConfig,
  TsModelCommandConfig,
} from "./model-runtime.types.ts";

// `undelete` тут разом із `delete`: генератор видає обидві функції одній і тій
// самій моделі, тож знати про одну й не знати про другу рантайм не може.
const STANDARD_COMMANDS = new Set(["list", "get", "save", "delete", "undelete", "lookup"]);
const STANDARD_DOCUMENT_COMMANDS = new Set(["post", "unpost"]);

/**
 * Дія, потрібна стандартній команді. `save` тут немає: вона `create` або
 * `edit` залежно від payload, і рахується окремо.
 */
const STANDARD_COMMAND_ACTIONS: Record<string, string> = {
  list: "view",
  get: "view",
  lookup: "view",
  delete: "delete",
  // Зняття позначки — те саме право, що й її встановлення: обидві команди
  // керують однією ознакою `is_deleted`, і розділяти їх правами означало б, що
  // хтось може позначити запис, але не може передумати.
  //
  // Тут, а не в `manifest.commands.access` кожної моделі: команду видає
  // ГЕНЕРАТОР усім моделям одразу, і вимагати оголошення в дванадцяти
  // манифестах — гарантовано забути в тринадцятому. Fail-closed від цього не
  // страждає: нове ім'я в цьому переліку додають свідомо.
  undelete: "delete",
  post: "post",
  unpost: "unpost",
};

/**
 * Рівень журналу моделі — значення `app.audit_setting.level`.
 *
 * Це НАЛАШТУВАННЯ УСТАНОВКИ, а не властивість моделі: рівень лежить у базі й
 * міняється на екрані `admin/audit_setting`. Доти політика жила в
 * `manifest.json`, тобто в рішенні, — увімкнути журнал не можна було, не
 * правлячи застосунок і не викочуючи його заново (а на встановленій системі
 * така правка ще й знімає рішення з підтримки).
 */
type AuditLevel = "none" | "changes" | "all";

/**
 * Дії, які МІНЯЮТЬ запис. Рівень `changes` пише саме їх.
 *
 * Кошик визначає ПРАВО команди, а не її ім'я, і це головне тут: право рантайм
 * і так рахує для перевірки доступу (`resolveRequiredAction`), тож нестандартна
 * команда (`copy`, `moveToGroup`, будь-яка TS-команда) потрапляє в потрібний
 * кошик сама — з того самого оголошення `commands.access`. Другий перелік імен
 * розійшовся б із першим, і мовчки.
 *
 * `view` і `authenticated` сюди не входять: читання роздуло б журнал так, що
 * змін у ньому не знайти. Кому потрібне й воно — той ставить рівень `all`.
 */
const CHANGING_ACTIONS = new Set(["create", "edit", "delete", "post", "unpost"]);

/**
 * Дії, які агент мусить підтвердити словом (`"confirm": true` у payload).
 *
 * Не всі зміни, а лише ті, що міняють СТАН документа або ховають запис:
 * створити чернетку можна й помилково — її видно й виправно, а проведений
 * заднім числом документ уже вплинув на облік.
 *
 * Людини це не стосується: вона підтвердила натисканням кнопки. Тому перевірка
 * діє лише на виклики персональним токеном.
 */
const CONFIRM_REQUIRED_ACTIONS = new Set(["delete", "post", "unpost"]);

/**
 * Команди, які ВИМАГАЮТЬ права зміни, але нічого не змінюють.
 *
 * Сухий прогін проведення кличе ту саму `<model>_post` і відкочує транзакцію —
 * права він просить як у проведення (питати «що буде, якщо я проведу» має сенс
 * тому, хто проводить), а наслідків не лишає жодних. Тому три речі, які
 * дивляться на дію, мусять дивитися ще й на команду:
 *
 *   - **токен «тільки читання» прогін виконує.** Це не послаблення, а те, що
 *     робить прогін корисним: агент-порадник може показати наслідок, не маючи
 *     права його спричинити;
 *   - **підтвердження не питається.** Воно є тому, що проведений заднім числом
 *     документ уже вплинув на облік; прогін не впливає ні на що;
 *   - **у журнал змін не пише.** Інакше «зміни» рясніли б записами, після яких
 *     нічого не змінилося.
 */
const NON_WRITING_COMMANDS = new Set(["postPreview"]);

/** Чи міняє щось ця пара «дія + команда». Одне джерело для всіх трьох перевірок. */
export function isChangingCall(action: string | null, command: string): boolean {
  return action !== null && CHANGING_ACTIONS.has(action) && !NON_WRITING_COMMANDS.has(command);
}

/**
 * Скільки живе прочитаний перелік рівнів.
 *
 * Кеш тут є, хоча в перевірці ПРАВ його свідомо немає: право стосується одного
 * користувача й одного виклику, а налаштування журналу — це десяток рядків на
 * всю установку, що міняються раз на місяць з одного екрана. Без кешу кожна
 * команда коштувала б зайвого round-trip рівно заради того, щоб дізнатися
 * «журнал вимкнено». Свій процес скидає кеш одразу, щойно екран зберіг
 * налаштування, тож TTL потрібен лише сусіднім екземплярам.
 */
const AUDIT_SETTINGS_TTL_MS = 30_000;

/** Модель, чиї команди міняють самі налаштування журналу (скидає кеш). */
const AUDIT_SETTING_MODEL = "audit_setting";

/** Оголошення «досить бути авторизованим»: право моделі не перевіряється. */
const AUTHENTICATED = "authenticated";
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const COMMAND_IDENTIFIER_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function toPlainJson(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toPlainJson(item));
  }

  if (value && typeof value === "object") {
    const plain: Record<string, JsonValue> = {};
    const record = value as Record<string, unknown>;

    for (const key of Object.getOwnPropertyNames(value)) {
      plain[key] = toPlainJson(record[key]);
    }

    return plain;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return null;
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  const plain = toPlainJson(payload ?? {});
  return plain && typeof plain === "object" && !Array.isArray(plain)
    ? plain as Record<string, unknown>
    : {};
}

function toSqlJsonPayload(payload: unknown): JsonValue {
  return toPlainJson(payload ?? {});
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function auditRecordId(payload: Record<string, unknown>, result?: unknown): string | null {
  const data = asRecord(asRecord(result)?.data);
  const item = asRecord(data?.item);
  const extra = asRecord(data?.extra);
  const payloadItem = asRecord(payload.item);
  const candidates = [item?.id, extra?.id, payloadItem?.id, payload.id];

  for (const candidate of candidates) {
    const id = typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : "";
    if (/^\d+$/.test(id)) return id;
  }
  return null;
}

function assertIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} має містити лише lowercase, digits та underscore`);
  }
}

function assertCommandIdentifier(value: string) {
  if (!COMMAND_IDENTIFIER_PATTERN.test(value)) {
    throw new Error("command має містити лише latin letters, digits та underscore");
  }
}

function validateStandardCommand(command: string, payload: Record<string, unknown>) {
  if (command === "delete" || command === "undelete") {
    if (typeof payload.id !== "string" || payload.id.trim() === "") {
      return `id обов'язковий для ${command}`;
    }
  }

  if (command === "save") {
    if (!payload.item || typeof payload.item !== "object" || Array.isArray(payload.item)) {
      return "item обов'язковий для save";
    }
  }

  return null;
}

function resolveSqlCommandConfig(
  sqlCommand: SqlModelCommandDefinition | undefined,
): SqlModelCommandConfig | null {
  if (!sqlCommand) {
    return null;
  }

  if (typeof sqlCommand === "string") {
    return {
      functionName: sqlCommand,
    };
  }

  return sqlCommand;
}

function getSqlCommandConfig(
  model: string,
  command: string,
  config?: ModelBackendConfig,
): SqlModelCommandConfig | null {
  const configuredCommand = resolveSqlCommandConfig(config?.sqlCommands?.[command]);

  // Explicit sqlCommands always override standard auto-routing
  if (configuredCommand) {
    return configuredCommand;
  }

  if (STANDARD_COMMANDS.has(command)) {
    return {
      schema: config?.schema,
      functionName: `${model}_${command}`,
      validate: (payload) => validateStandardCommand(command, payload),
    };
  }

  if (supportsPosting(model) && STANDARD_DOCUMENT_COMMANDS.has(command)) {
    return {
      schema: config?.schema,
      functionName: `${model}_${command}`,
    };
  }

  return null;
}

/**
 * Яке право потрібне цій команді. `null` — не визначено, і це відмова: краще
 * голосна помилка конфігурації, ніж команда, що працює без перевірки.
 *
 * Оголошення в манифесті має пріоритет над виведенням з імені: модель може
 * навмисно послабити `list` до `authenticated` (як `menu/current`, яку кличе
 * кожен вхід) або посилити його.
 */
/** Хто викликає команду. Порожньо — застосунок або внутрішній виклик. */
export interface ModelCommandCaller {
  /** Виклик персональним токеном (агент). */
  accessToken?: { readOnly: boolean };
}

/**
 * Запобіжники, що діють ЛИШЕ на агента.
 *
 * Обидва свідомо не є заміною правам: право відмовляє тому, кому не можна
 * взагалі, а це — тому, кому можна, але не отак. Токен «тільки читання» дає
 * видати агенту доступ на задачу, де запис не потрібен, не забираючи прав у
 * самої людини; підтвердження робить зміну стану документа навмисною дією, а
 * не побічним ефектом кроку, який агент зробив «щоб подивитися».
 *
 * Текст відмови звичайний, без маркера перекладу: його читає агент, а не
 * людина, і `@[core.…]` для нього був би шумом.
 */
function assertCallerMayRun(
  action: string,
  command: string,
  payload: Record<string, unknown>,
  caller: ModelCommandCaller,
): void {
  const token = caller.accessToken;
  if (!token) return;
  if (NON_WRITING_COMMANDS.has(command)) return;

  if (token.readOnly && CHANGING_ACTIONS.has(action)) {
    throw ModelCommandError.forbidden(
      `Цей токен доступу — тільки для читання: дія «${action}» заборонена.`,
    );
  }

  if (CONFIRM_REQUIRED_ACTIONS.has(action) && payload.confirm !== true) {
    throw ModelCommandError.forbidden(
      `Дія «${action}» міняє стан документа. Повтори виклик із "confirm": true, ` +
        "якщо це справді те, що потрібно.",
    );
  }
}

function resolveRequiredAction(
  model: string,
  command: string,
  payload: Record<string, unknown>,
  config: ModelBackendConfig | undefined,
): string | null {
  const declared = config?.access?.[command];
  if (declared) return declared;

  // `save` — це створення або зміна, і різниця видна лише з payload: новий
  // запис приходить без id. Без цього поділу право `create` не мало б сенсу:
  // будь-хто з `edit` створював би записи.
  if (command === "save") {
    const item = payload.item as Record<string, unknown> | undefined;
    const id = item?.id;
    return id === null || id === undefined || id === "" ? "create" : "edit";
  }

  if (STANDARD_DOCUMENT_COMMANDS.has(command) && !supportsPosting(model)) {
    return null;
  }

  return STANDARD_COMMAND_ACTIONS[command] ?? null;
}

@Injectable()
export class ModelRuntimeService {
  constructor(private db: DatabaseService) {}

  /**
   * @param sessionId — сесія виклику. Потрібна тільки для токенів вкладень:
   * ними підписуються ключі доступу у відповіді, тому токен живе рівно
   * стільки, скільки сесія. Порожній рядок — сесії немає (агент, dev-bypass).
   */
  async execute(
    model: string,
    command: string,
    payload: unknown,
    userId: string,
    sessionId = "",
    caller: ModelCommandCaller = {},
  ) {
    assertIdentifier(model, "model");
    assertCommandIdentifier(command);

    const normalizedPayload = normalizePayload(payload);
    const config = getModelConfig(model);

    // Право рахуємо ДО спроби виконання: воно ж називає рівень журналу
    // (`CHANGING_ACTIONS`), а журнал пише і невдалі виклики — включно з тими,
    // що впали до перевірки доступу. Функція чиста, тож зайвого тут немає, а
    // порядок відмов нижче лишається старим: спершу «немає команди», потім
    // «право не оголошене».
    const action = resolveRequiredAction(model, command, normalizedPayload, config);
    const audited = await this.shouldAudit(model, command, action);

    let result: unknown;
    try {
      const tsCommand = config?.tsCommands?.[command];

      // Перевірки «чи є така модель у реєстрі» тут свідомо немає. Моделі ядра
      // (attachment) живуть у server/sql і манифеста в застосунку не мають — вони
      // доходять сюди з `config === undefined` і працюють стандартним маршрутом
      // `app.<model>_<command>`. Неіснуючу модель відсіє сама база: функції немає,
      // і нижче це стане зрозумілою 501.
      const sqlCommand = tsCommand ? null : getSqlCommandConfig(model, command, config);

      // Спершу з'ясовуємо, чи команда взагалі є, і лише потім — чи є право.
      // Зворотний порядок перетворював би друкарську помилку в імені команди на
      // «немає доступу», і шукали б її не там.
      if (!tsCommand && !sqlCommand) {
        throw ModelCommandError.notConfigured(model, command);
      }

      if (action === null) {
        throw ModelCommandError.accessNotDeclared(model, command);
      }

      assertCallerMayRun(action, command, normalizedPayload, caller);

      const candidate = tsCommand
        ? await this.executeTsCommand(model, command, normalizedPayload, userId, tsCommand, action)
        : await this.executeSqlCommand(model, command, normalizedPayload, userId, config, sqlCommand!, action);

      // Відповідь мусить бути конвертом. Найчастіша причина, чому вона ним не є —
      // SQL-функція без `return` або з `return null`: клієнт діставав `null`
      // замість `{ ok, data, messages }`, форма мовчки не наповнювалася, і слідів
      // не лишалося ніде. Краще голосна помилка тут, ніж порожня форма там.
      if (!looksLikeEnvelope(candidate)) {
        console.error(
          `❌ ${model}/${command}: відповідь не є конвертом:`,
          candidate === undefined ? "undefined" : JSON.stringify(candidate)?.slice(0, 200),
        );
        throw ModelCommandError.badResponse(model, command);
      }
      result = candidate;
    } catch (error) {
      if (audited) {
        await this.writeAudit(model, command, normalizedPayload, userId, false);
      }
      throw error;
    }

    if (audited) {
      await this.writeAudit(
        model,
        command,
        normalizedPayload,
        userId,
        (result as { ok: boolean }).ok,
        result,
      );
    }

    // Налаштування журналу щойно могли змінитися — читаємо їх заново, не
    // чекаючи TTL. Своєму процесу цього досить; сусіднім екземплярам лишається
    // TTL, і затримка в півхвилини на екрані налаштувань нікому не шкодить.
    if (model === AUDIT_SETTING_MODEL) {
      this.auditLevelsExpireAt = 0;
    }

    // Ключі доступу до вкладень (`token`, `<field>Token`) назовні не виходять —
    // рантайм міняє їх на підписані токени. Див. blob-token.ts.
    return await signEnvelopeTokens(result, { userId, sessionId });
  }

  // ── Журнал змін ───────────────────────────────────────────────────────────

  /** Рівні журналу по моделях: лише рядки, де журнал справді ввімкнений. */
  private auditLevels = new Map<string, AuditLevel>();
  private auditLevelsExpireAt = 0;

  /**
   * Чи писати цю команду в журнал. `action === null` (команда без оголошеного
   * права — тобто зламана конфігурація) рахується читанням: такий виклик і так
   * не виконається, а рівень `all` його все одно збереже.
   */
  private async shouldAudit(model: string, command: string, action: string | null) {
    const level = await this.auditLevel(model);
    if (level === "all") return true;
    if (level === "changes") return isChangingCall(action, command);
    return false;
  }

  private async auditLevel(model: string): Promise<AuditLevel> {
    if (Date.now() >= this.auditLevelsExpireAt) {
      // Позначку рухаємо ДО запиту: інакше кожна команда, поки база не
      // відповіла, бачила б кеш простроченим і слала свій запит.
      this.auditLevelsExpireAt = Date.now() + AUDIT_SETTINGS_TTL_MS;
      try {
        const rows = await this.db.sql<{ model: string; level: string }[]>`
          select model, level from app.audit_setting where level <> 'none'
        `;
        this.auditLevels = new Map(rows.map((row) => [row.model, row.level as AuditLevel]));
      } catch (error) {
        // Таблиці ще немає (схему не накотили) або база недоступна. Журнал —
        // не привід валити команду, тому мовчки лишаємося без нього; слід у
        // консолі є, а наступна спроба буде через TTL, а не на кожен виклик.
        console.error("❌ audit: не вдалося прочитати app.audit_setting:", error);
        this.auditLevels = new Map();
      }
    }

    // Моделі, якої в таблиці немає, журнал не ведеться: умовчання — «не
    // логувати», і воно однакове для незасіяної моделі та для явного `none`.
    return this.auditLevels.get(model) ?? "none";
  }

  /** Аудит не може змінювати результат команди, але збій журналу лишає слід у консолі. */
  private async writeAudit(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    isSuccess: boolean,
    result?: unknown,
  ) {
    try {
      await this.db.sql`
        insert into app.audit_log (user_id, model, command, record_id, is_success)
        values (
          ${userId}::bigint,
          ${model},
          ${command},
          ${auditRecordId(payload, result)}::bigint,
          ${isSuccess}
        )
      `;
    } catch (error) {
      console.error(`❌ audit ${model}/${command}: не вдалося записати подію:`, error);
    }
  }

  /**
   * Право для TS-команди — окремим запитом: вкласти перевірку в її виклик
   * нікуди, хендлер виконується в Deno. Один round-trip: `access_can` і готова
   * відмова приходять разом, тому текст відмови лишається в одному місці — у
   * `app.access_denied`.
   */
  private async assertAccess(model: string, action: string, userId: string) {
    const rows = await this.db.sql<{ allowed: boolean; denied: unknown; password_denied: unknown }[]>`
      select
        app.access_can(${userId}::bigint, ${model}, ${action})   as allowed,
        app.access_denied(${model}, ${action})                   as denied,
        app.password_change_denied(${userId}::bigint)            as password_denied
    `;

    const row = rows[0];
    if (!row) throw ModelCommandError.badResponse(model, "access_can");

    // Тимчасовий пароль важить більше за право: доки він не змінений, не
    // виконується жодна команда, навіть дозволена.
    if (row.password_denied) return row.password_denied;

    return row.allowed ? null : row.denied;
  }

  private async executeTsCommand(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    tsCommand: TsModelCommandConfig,
    action: string,
  ) {
    if (action !== AUTHENTICATED) {
      const denied = await this.assertAccess(model, action, userId);
      if (denied) return denied;
    }

    // Реєстр зібрався, а виконувати нема чого: модуль команди не має default-
    // експорту або експортує не функцію. Без цієї перевірки виходив
    // `TypeError: tsCommand.handler is not a function` — повідомлення, з якого
    // не видно ні моделі, ні команди, ні того, що винен саме модуль.
    if (typeof tsCommand.handler !== "function") {
      console.error(
        `❌ ${model}/${command}: TS-хендлер не є функцією (${typeof tsCommand.handler}). ` +
          `Перевірте default-експорт модуля команди й перезапустіть sql:registry.`,
      );
      throw ModelCommandError.notImplemented(model, command);
    }

    const validationError = tsCommand.validate?.(payload) ?? null;
    if (validationError) {
      throw new Error(validationError);
    }

    const context: ModelCommandContext = {
      db: this.db,
      model,
      command,
      userId,
    };

    return await tsCommand.handler(payload, context);
  }

  private async executeSqlCommand(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    config: ModelBackendConfig | undefined,
    sqlCommand: SqlModelCommandConfig,
    action: string,
  ) {
    const validationError = sqlCommand.validate?.(payload) ?? null;
    if (validationError) {
      throw new Error(validationError);
    }

    const schema = sqlCommand.schema ?? config?.schema ?? "app";
    const functionName = sqlCommand.functionName ?? `${model}_${command}`;

    assertIdentifier(schema, "schema");
    assertIdentifier(functionName, "functionName");

    const payloadJson = this.db.sql.json(toSqlJsonPayload(payload));

    try {
      // Перевірка вкладена в той самий `select`, а не зроблена окремим
      // запитом: один round-trip, права завжди свіжі (жодного кешу для
      // інвалідації), а при відмові команда навіть не виконується — CASE не
      // обчислює невибрану гілку, і аргументи тут не згортаються в константи.
      // coalesce поверх усього: тимчасовий пароль блокує будь-яку команду, і
      // `authenticated` теж — інакше «команди про себе» лишалися б відкритими
      // під паролем, який відомий кожному, хто бачив .env. Coalesce не
      // обчислює другий аргумент, коли перший не NULL, тож round-trip
      // лишається один, а команда не виконується.
      const rows = action === AUTHENTICATED
        ? await this.db.sql<{ result: unknown }[]>`
            select coalesce(
              app.password_change_denied(${userId}::bigint),
              ${this.db.sql(schema)}.${this.db.sql(functionName)}(${userId}::bigint, ${payloadJson}::jsonb)
            ) as result
          `
        : await this.db.sql<{ result: unknown }[]>`
            select coalesce(
              app.password_change_denied(${userId}::bigint),
              case
                when app.access_can(${userId}::bigint, ${model}, ${action})
                  then ${this.db.sql(schema)}.${this.db.sql(functionName)}(${userId}::bigint, ${payloadJson}::jsonb)
                else app.access_denied(${model}, ${action})
              end
            ) as result
          `;

      return rows[0]?.result ?? null;
    } catch (error) {
      // Функції немає в базі. Раніше сюди приходило сире повідомлення
      // PostgreSQL (`function app.bank_list(bigint, jsonb) does not exist`) —
      // воно доходило аж до форми й нічого не пояснювало тому, хто його бачив.
      // Ім'я функції потрібне тому, хто читає консоль сервера, — там воно й
      // лишається; клієнтові вистачає моделі й команди, які він і так знає.
      if (isMissingDatabaseFunction(error)) {
        console.error(
          `❌ ${model}/${command}: у базі немає функції ${schema}.${functionName}(bigint, jsonb). ` +
            `Найімовірніше не виконано sql:assemble && sql:publish.`,
        );
        throw ModelCommandError.notImplemented(model, command);
      }

      throw error;
    }
  }
}