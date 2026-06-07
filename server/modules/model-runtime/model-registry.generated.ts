import type { ModelBackendConfig } from "./model-runtime.types.ts";

// Generated from model manifests. Do not edit manually.

export const generatedModelRegistry: Record<string, ModelBackendConfig> = {
  "bank": {
    type: "catalog",
    schema: "app"
  },
  "interface": {
    type: "admin",
    schema: "app"
  },
  "print_template": {
    type: "admin",
    schema: "app"
  },
  "user": {
    type: "admin",
    schema: "app"
  },
  "user_group": {
    type: "admin",
    schema: "app"
  }
};

export interface GeneratedTsCommandBinding {
  model: string;
  command: string;
  handlerKey: string;
}

export const generatedTsCommandBindings: GeneratedTsCommandBinding[] = [
  { model: "user", command: "exportExcel", handlerKey: "runtime.exportExcel" },
  { model: "user", command: "update", handlerKey: "user.update" }
];

