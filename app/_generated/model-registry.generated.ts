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
  "audit_log": {
    type: "admin",
    schema: "app"
  },
  "audit_setting": {
    type: "admin",
    schema: "app"
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
  "currency_rate": {
    type: "register",
    schema: "app",
    sqlCommands: {
    "at": {  },
    "history": {  },
    "set": {  }
    },
    access: {
    "at": "view",
    "history": "view",
    "set": "edit"
    }
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
  "nomenclature": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "groupDelete": "nomenclature_group_delete",
    "groupSave": "nomenclature_group_save",
    "groupTree": "nomenclature_group_tree",
    "moveToGroup": "nomenclature_move_to_group"
    },
    access: {
    "groupDelete": "delete",
    "groupSave": "edit",
    "groupTree": "view",
    "moveToGroup": "edit"
    }
  },
  "numerator": {
    type: "admin",
    schema: "app"
  },
  "organization": {
    type: "catalog",
    schema: "app"
  },
  "print_template": {
    type: "admin",
    schema: "app",
    access: {
    "preview": "view"
    }
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

