import { generatedModelRegistry, generatedTsCommandBindings } from "./model-registry.generated.ts";
import type { ModelBackendConfig } from "./model-runtime.types.ts";

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
    const modelConfig = registry[binding.model] ?? {};
    modelConfig.tsCommands = {
      ...(modelConfig.tsCommands ?? {}),
      [binding.command]: {
        handler: binding.handler,
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