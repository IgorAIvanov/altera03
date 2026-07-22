import ts_bank_ping from "../catalog/bank/db/bank.commands.ts";

// Generated from model manifests. Do not edit manually.

export const generatedModelRegistry = {
  "account_card": {
    type: "report",
    schema: "app",
    sqlCommands: {
    "index": "account_card_index"
    }
  },
  "bank": {
    type: "catalog",
    schema: "app"
  },
  "chart_of_account": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "analytics": "chart_of_account_analytics"
    }
  },
  "counterparty": {
    type: "catalog",
    schema: "app"
  },
  "currency": {
    type: "catalog",
    schema: "app"
  },
  "document_movements": {
    type: "report",
    schema: "app",
    sqlCommands: {
    "index": "document_movements_index"
    }
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
  "manual_entry": {
    type: "document",
    schema: "app"
  },
  "organization": {
    type: "catalog",
    schema: "app"
  },
  "print_template": {
    type: "admin",
    schema: "app"
  },
  "turnover_balance": {
    type: "report",
    schema: "app",
    sqlCommands: {
    "index": "turnover_balance_index"
    }
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

