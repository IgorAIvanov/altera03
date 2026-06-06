import { currencyClassifierFetchHandler, currencyLoadRatesHandler, currencySeedPredefinedHandler } from "./handlers/currency.handlers.ts";
import { exportExcelHandler } from "./handlers/exportExcel.runtime.ts";
// import { genericPrintPdfHandler } from "./handlers/printPdf.runtime.ts";
const genericPrintPdfHandler: TsModelCommandConfig["handler"] = async () => { throw new Error("printPdf не реалізовано"); };
import { userUpdateHandler } from "./handlers/user.handlers.ts";
import { generatedModelRegistry, generatedTsCommandBindings } from "./model-registry.generated.ts";
import type { ModelBackendConfig, TsModelCommandConfig } from "./model-runtime.types.ts";

const tsCommandHandlers: Record<string, TsModelCommandConfig["handler"]> = {
  "currency.classifierFetch": currencyClassifierFetchHandler,
  "currency.loadRates": currencyLoadRatesHandler,
  "currency.seedPredefined": currencySeedPredefinedHandler,
  "runtime.exportExcel": exportExcelHandler,
  "runtime.printPdf": genericPrintPdfHandler,
  "user.update": userUpdateHandler,
};

function buildRegistry(): Record<string, ModelBackendConfig> {
  const registry: Record<string, ModelBackendConfig> = {};

  for (const [model, config] of Object.entries(generatedModelRegistry)) {
    registry[model] = {
      ...config,
      sqlCommands: config.sqlCommands ? { ...config.sqlCommands } : undefined,
      tsCommands: config.tsCommands ? { ...config.tsCommands } : undefined,
    };
  }

  for (const binding of generatedTsCommandBindings) {
    const handler = tsCommandHandlers[binding.handlerKey];
    if (!handler) {
      throw new Error(`TS command handler '${binding.handlerKey}' is not registered`);
    }

    const modelConfig = registry[binding.model] ?? {};
    modelConfig.tsCommands = {
      ...(modelConfig.tsCommands ?? {}),
      [binding.command]: {
        handler,
      },
    };
    registry[binding.model] = modelConfig;
  }

  return registry;
}

const registry = buildRegistry();

export function getModelConfig(model: string): ModelBackendConfig | undefined {
  return registry[model];
}

export function getModelType(model: string): string | null {
  return registry[model]?.type ?? null;
}

export function isDocumentModel(model: string): boolean {
  return getModelType(model) === "document";
}

export function supportsPosting(model: string): boolean {
  return isDocumentModel(model);
}