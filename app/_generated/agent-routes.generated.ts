// Generated from model manifests. Do not edit manually.

export const agentModelRoutes = {
  "account_card": {
    listPath: "/report/account_card/list",
    type: "report"
  },
  "audit_log": {
    listPath: "/admin/audit_log/list",
    type: "admin"
  },
  "bank": {
    editPath: "/catalog/bank/edit",
    listPath: "/catalog/bank/list",
    type: "catalog"
  },
  "chart_of_account": {
    editPath: "/catalog/chart_of_account/edit",
    listPath: "/catalog/chart_of_account/list",
    type: "catalog"
  },
  "counterparty": {
    editPath: "/catalog/counterparty/edit",
    listPath: "/catalog/counterparty/list",
    type: "catalog"
  },
  "currency": {
    editPath: "/catalog/currency/edit",
    listPath: "/catalog/currency/list",
    type: "catalog"
  },
  "document_movements": {
    listPath: "/report/document_movements/list",
    type: "report"
  },
  "invoice": {
    editPath: "/document/invoice/edit",
    listPath: "/document/invoice/list",
    type: "document"
  },
  "manual_entry": {
    editPath: "/operation/manual_entry/edit",
    listPath: "/operation/manual_entry/list",
    type: "document"
  },
  "menu": {
    editPath: "/admin/menu/edit",
    listPath: "/admin/menu/list",
    type: "catalog"
  },
  "nomenclature": {
    editPath: "/catalog/nomenclature/edit",
    listPath: "/catalog/nomenclature/list",
    type: "catalog",
    allow: true,
    allowCommands: ["get","save","list","lookup"],
    aliases: ["номенклатура","товар","товари","послуга","послуги"],
    priority: 10
  },
  "numerator": {
    editPath: "/admin/numerator/edit",
    listPath: "/admin/numerator/list",
    type: "admin"
  },
  "organization": {
    editPath: "/catalog/organization/edit",
    listPath: "/catalog/organization/list",
    type: "catalog"
  },
  "print_template": {
    editPath: "/admin/print_template/edit",
    listPath: "/admin/print_template/list",
    type: "admin"
  },
  "turnover_balance": {
    listPath: "/report/turnover_balance/list",
    type: "report"
  },
  "user": {
    editPath: "/admin/user/edit",
    listPath: "/admin/user/list",
    type: "catalog"
  },
  "user_group": {
    editPath: "/admin/user_group/edit",
    listPath: "/admin/user_group/list",
    type: "catalog"
  }
};

