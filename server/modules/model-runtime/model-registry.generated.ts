import type { ModelBackendConfig, TsModelCommandConfig } from "./model-runtime.types.ts";
import ts_bank_ping from "../../../app/catalog/bank/db/bank.commands.ts";

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
  handler: TsModelCommandConfig["handler"];
}

export const generatedTsCommandBindings: GeneratedTsCommandBinding[] = [
  { model: "bank", command: "ping", handler: ts_bank_ping }
];

