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
    schema: "app",
    sqlCommands: {
    "printData": "invoice_print_data"
    }
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
  { model: "bank", command: "ping", handler: ts_bank_ping },
  { model: "invoice", command: "printPdf", handlerKey: "runtime.printPdf" },
  { model: "print_template", command: "preview", handlerKey: "runtime.printPreview" }
];

