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
  /**
   * Право нестандартної команди: назва дії (`view`, `create`, `edit`,
   * `delete`, `post`, `unpost`) або `"authenticated"` — «досить бути
   * авторизованим». Стандартні команди тут не оголошуються: їхня дія виводиться
   * з імені (див. `resolveRequiredAction`).
   *
   * Неоголошена нестандартна команда НЕ виконується — fail-closed. Забути
   * оголошення можна, і тоді помилка вилізе на першому виклику; мовчазний
   * дозвіл же не вилазить ніколи.
   */
  access?: Record<string, string>;
}