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

const STANDARD_COMMANDS = new Set(["list", "get", "save", "delete", "lookup"]);
const STANDARD_DOCUMENT_COMMANDS = new Set(["post", "unpost"]);
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
  if (command === "delete") {
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
    const tsCommand = config?.tsCommands?.[command];

    const result = tsCommand
      ? await this.executeTsCommand(model, command, normalizedPayload, userId, tsCommand)
      : await this.executeSqlCommandFor(model, command, normalizedPayload, userId, config);

    // Відповідь мусить бути конвертом. Найчастіша причина, чому вона ним не є —
    // SQL-функція без `return` або з `return null`: клієнт діставав `null`
    // замість `{ ok, data, messages }`, форма мовчки не наповнювалася, і слідів
    // не лишалося ніде. Краще голосна помилка тут, ніж порожня форма там.
    if (!looksLikeEnvelope(result)) {
      console.error(
        `❌ ${model}/${command}: відповідь не є конвертом:`,
        result === undefined ? "undefined" : JSON.stringify(result)?.slice(0, 200),
      );
      throw ModelCommandError.badResponse(model, command);
    }

    // Ключі доступу до вкладень (`token`, `<field>Token`) назовні не виходять —
    // рантайм міняє їх на підписані токени. Див. blob-token.ts.
    return await signEnvelopeTokens(result, { userId, sessionId });
  }

  private async executeSqlCommandFor(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    config: ModelBackendConfig | undefined,
  ) {
    const sqlCommand = getSqlCommandConfig(model, command, config);
    if (!sqlCommand) {
      throw ModelCommandError.notConfigured(model, command);
    }

    // Перевірки «чи є така модель у реєстрі» тут свідомо немає. Моделі ядра
    // (attachment) живуть у server/sql і манифеста в застосунку не мають — вони
    // доходять сюди з `config === undefined` і працюють стандартним маршрутом
    // `app.<model>_<command>`. Неіснуючу модель відсіє сама база: функції немає,
    // і нижче це стане зрозумілою 501.
    return await this.executeSqlCommand(model, command, payload, userId, config, sqlCommand);
  }

  private async executeTsCommand(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    tsCommand: TsModelCommandConfig,
  ) {
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
  ) {
    const validationError = sqlCommand.validate?.(payload) ?? null;
    if (validationError) {
      throw new Error(validationError);
    }

    const schema = sqlCommand.schema ?? config?.schema ?? "app";
    const functionName = sqlCommand.functionName ?? `${model}_${command}`;

    assertIdentifier(schema, "schema");
    assertIdentifier(functionName, "functionName");

    try {
      const rows = await this.db.sql<{ result: unknown }[]>`
        select ${this.db.sql(schema)}.${this.db.sql(functionName)}(${userId}::bigint, ${this.db.sql.json(toSqlJsonPayload(payload))}::jsonb) as result
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