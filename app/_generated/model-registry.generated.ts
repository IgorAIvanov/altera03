import ts_bank_ping from "../catalog/bank/db/bank.commands.ts";

// Generated from model manifests. Do not edit manually.

export const generatedModelRegistry = {
  "bank": {
    type: "catalog",
    schema: "app"
  },
  "counterparty": {
    type: "catalog",
    schema: "app"
  },
  "interface": {
    type: "admin",
    schema: "app"
  },
  "invoice": {
    type: "document",
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

export const generatedTsCommandBindings = [
  { model: "bank", command: "ping", handler: ts_bank_ping }
];

