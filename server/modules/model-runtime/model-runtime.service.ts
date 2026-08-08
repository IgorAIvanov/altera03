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
 * Стандартні команди, які МІНЯЮТЬ запис, — журнал пише їх за замовчуванням,
 * без оголошення в манифесті.
 *
 * Доти аудит вмикався тільки поіменним списком, і з дванадцяти моделей його
 * оголосила рівно одна. Позначка на видалення нікуди не потрапляла — тобто
 * найпотрібніша для журналу подія («хто прибрав запис») не лишала сліду саме
 * там, де слід і шукають. Це та сама пастка, що з правом `undelete` вище:
 * команду видає ГЕНЕРАТОР усім моделям одразу, а оголошувати її треба руками
 * в кожному манифесті — тож забути можна лише в один бік, і саме мовчки.
 *
 * Читання (`list`, `get`, `lookup`) сюди не входить: воно роздуло б журнал
 * так, що змін у ньому не знайти. Нестандартна команда (`copy`, `moveToGroup`,
 * TS-команда) теж — вона мусить назвати себе в манифесті сама: журнал змін не
 * знає, чи щось змінює команда з довільним іменем.
 */
const AUDITED_BY_DEFAULT = new Set(["save", "delete", "undelete", "post", "unpost"]);

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

/**
 * Чи писати цю команду в журнал. Оголошення в манифесті СИЛЬНІШЕ за умовчання
 * в обидва боки: список звужує (і може додати свою команду), `false` вимикає
 * журнал моделі цілком.
 */
function shouldAudit(config: ModelBackendConfig | undefined, command: string) {
  const declared = config?.audit;
  if (declared === true) return true;
  if (declared === false) return false;
  if (declared) return declared.commands.includes(command);
  return AUDITED_BY_DEFAULT.has(command);
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
  async execute(model: string, command: string, payload: unknown, userId: string, sessionId = "") {
    assertIdentifier(model, "model");
    assertCommandIdentifier(command);

    const normalizedPayload = normalizePayload(payload);
    const config = getModelConfig(model);
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

      const action = resolveRequiredAction(model, command, normalizedPayload, config);
      if (action === null) {
        throw ModelCommandError.accessNotDeclared(model, command);
      }

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
      if (shouldAudit(config, command)) {
        await this.writeAudit(model, command, normalizedPayload, userId, false);
      }
      throw error;
    }

    if (shouldAudit(config, command)) {
      await this.writeAudit(
        model,
        command,
        normalizedPayload,
        userId,
        (result as { ok: boolean }).ok,
        result,
      );
    }

    // Ключі доступу до вкладень (`token`, `<field>Token`) назовні не виходять —
    // рантайм міняє їх на підписані токени. Див. blob-token.ts.
    return await signEnvelopeTokens(result, { userId, sessionId });
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