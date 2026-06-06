import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
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

  async execute(model: string, command: string, payload: unknown, userId: string) {
    assertIdentifier(model, "model");
    assertCommandIdentifier(command);

    const normalizedPayload = normalizePayload(payload);
    const config = getModelConfig(model);
    const tsCommand = config?.tsCommands?.[command];

    if (tsCommand) {
      return await this.executeTsCommand(model, command, normalizedPayload, userId, tsCommand);
    }

    const sqlCommand = getSqlCommandConfig(model, command, config);
    if (!sqlCommand) {
      throw new Error(`Команда ${command} не налаштована для моделі ${model}`);
    }

    return await this.executeSqlCommand(model, command, normalizedPayload, userId, config, sqlCommand);
  }

  private async executeTsCommand(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    tsCommand: TsModelCommandConfig,
  ) {
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

    const rows = await this.db.sql<{ result: unknown }[]>`
      select ${this.db.sql(schema)}.${this.db.sql(functionName)}(${userId}::bigint, ${this.db.sql.json(toSqlJsonPayload(payload))}::jsonb) as result
    `;

    return rows[0]?.result ?? null;
  }
}