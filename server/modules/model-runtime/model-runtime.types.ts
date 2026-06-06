import type { DatabaseService } from "../../database/database.service.ts";

export interface ModelCommandContext {
  db: DatabaseService;
  model: string;
  command: string;
  userId: string;
}

export interface SqlModelCommandConfig {
  schema?: string;
  functionName?: string;
  validate?: (payload: Record<string, unknown>) => string | null;
}

export type SqlModelCommandDefinition = string | SqlModelCommandConfig;

export interface TsModelCommandConfig {
  validate?: (payload: Record<string, unknown>) => string | null;
  handler: (
    payload: Record<string, unknown>,
    context: ModelCommandContext,
  ) => Promise<unknown>;
}

export interface ModelBackendConfig {
  type?: string;
  schema?: string;
  sqlCommands?: Record<string, SqlModelCommandDefinition>;
  tsCommands?: Record<string, TsModelCommandConfig>;
}