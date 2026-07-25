import ts_bank_ping from "../catalog/bank/db/bank.commands.ts";
import ts_user_setPassword from "../admin/user/db/user.commands.ts";

// Generated from model manifests. Do not edit manually.

export const generatedModelRegistry = {
  "account_card": {
    type: "report",
    schema: "app",
    sqlCommands: {
    "index": "account_card_index"
    },
    access: {
    "index": "view"
    }
  },
  "bank": {
    type: "catalog",
    schema: "app",
    access: {
    "ping": "view"
    }
  },
  "chart_of_account": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "analytics": "chart_of_account_analytics"
    },
    access: {
    "analytics": "view"
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
    },
    access: {
    "index": "view"
    }
  },
  "invoice": {
    type: "document",
    schema: "app",
    sqlCommands: {
    "printData": "invoice_print_data"
    },
    access: {
    "printData": "view",
    "printPdf": "view"
    }
  },
  "manual_entry": {
    type: "document",
    schema: "app"
  },
  "menu": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "copy": "menu_copy",
    "current": "menu_current"
    },
    access: {
    "copy": "create",
    "current": "authenticated"
    }
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
    },
    access: {
    "index": "view"
    }
  },
  "user": {
    type: "catalog",
    schema: "app",
    access: {
    "setPassword": "edit"
    }
  },
  "user_group": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "get": "user_group_get_ext",
    "save": "user_group_save_ext"
    }
  }
};

export const generatedTsCommandBindings = [
  { model: "bank", command: "ping", handler: ts_bank_ping },
  { model: "invoice", command: "printPdf", handlerKey: "runtime.printPdf" },
  { model: "print_template", command: "preview", handlerKey: "runtime.printPreview" },
  { model: "user", command: "setPassword", handler: ts_user_setPassword }
];

