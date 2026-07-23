import type { ModelBackendConfig, TsModelCommandConfig } from "./model-runtime.types.ts";
import { printPdfHandler, printPreviewHandler } from "../print/print.handlers.ts";
import { getServerConfig, type ModelsConfig } from "../../config/server-config.ts";

/**
 * Готові рантайм-хендлери ядра. Модель застосунку підключає їх у manifest.json
 * ключем (`"handlerKey": "runtime.printPdf"`), не знаючи шляхів усередині server/.
 */
const RUNTIME_HANDLERS: Record<string, TsModelCommandConfig["handler"]> = {
  "runtime.printPdf": printPdfHandler,
  "runtime.printPreview": printPreviewHandler,
};

/**
 * Прив'язка TS-команди до моделі (дані приходять з app/_generated).
 * Або власний хендлер моделі (`handler`), або ключ хендлера ядра (`handlerKey`).
 */
export interface GeneratedTsCommandBinding {
  model: string;
  command: string;
  handler?: TsModelCommandConfig["handler"];
  handlerKey?: string;
}

/**
 * Реєстр збирається на першу потребу з конфігурації і кешується. Ключ кешу —
 * тотожність самого об'єкта `models`: інший bootstrap з іншим конфігом
 * перебудує реєстр, і жодного окремого кроку «зареєструвати» не існує.
 */
let cache: { source: ModelsConfig; registry: Record<string, ModelBackendConfig> } | null = null;

function getRegistry(): Record<string, ModelBackendConfig> {
  const models = getServerConfig().models;
  if (!cache || cache.source !== models) {
    cache = { source: models, registry: buildRegistry(models.registry, models.tsCommands) };
  }

  return cache.registry;
}

function buildRegistry(
  generated: Record<string, ModelBackendConfig>,
  bindings: GeneratedTsCommandBinding[],
): Record<string, ModelBackendConfig> {
  const result: Record<string, ModelBackendConfig> = {};

  for (const [model, config] of Object.entries(generated)) {
    result[model] = {
      ...config,
      sqlCommands: config.sqlCommands ? { ...config.sqlCommands } : undefined,
      tsCommands: config.tsCommands ? { ...config.tsCommands } : undefined,
    };
  }

  for (const binding of bindings) {
    const handler = binding.handler ?? (binding.handlerKey ? RUNTIME_HANDLERS[binding.handlerKey] : undefined);
    if (!handler) {
      throw new Error(
        `Команда ${binding.model}.${binding.command}: невідомий handlerKey "${binding.handlerKey}"`,
      );
    }

    const modelConfig = result[binding.model] ?? {};
    modelConfig.tsCommands = {
      ...(modelConfig.tsCommands ?? {}),
      [binding.command]: { handler },
    };
    result[binding.model] = modelConfig;
  }

  return result;
}

export function getModelConfig(model: string): ModelBackendConfig | undefined {
  return getRegistry()[model];
}

export function getModelType(model: string): string | null {
  return getRegistry()[model]?.type ?? null;
}

export function isDocumentModel(model: string): boolean {
  return getModelType(model) === "document";
}

export function supportsPosting(model: string): boolean {
  return isDocumentModel(model);
}
