// Generated from model manifests. Do not edit manually.

export interface AgentModelRoute {
  editPath?: string;
  listPath?: string;
  type: string;
  allow?: boolean;
  allowCommands?: string[];
  aliases?: string[];
  priority?: number;
}

export const agentModelRoutes: Record<string, AgentModelRoute> = {
  "account_balance": {
    listPath: "/report/account_balance/list",
    type: "report"
  },
  "account_card": {
    listPath: "/report/account_card/list",
    type: "report"
  },
  "balance": {
    listPath: "/report/balance/list",
    type: "report"
  },
  "bank": {
    editPath: "/catalog/bank/edit",
    listPath: "/catalog/bank/list",
    type: "catalog",
    allow: true,
    aliases: ["банк"],
    priority: 5
  },
  "bank_account": {
    editPath: "/catalog/bank_account/edit",
    listPath: "/catalog/bank_account/list",
    type: "catalog",
    allow: true,
    aliases: ["рахунок","счет","iban"],
    priority: 6
  },
  "basImportProcess": {
    listPath: "/develope/basImportProcess/list",
    type: "utility"
  },
  "basModelSpecTemplate": {
    listPath: "/develope/basModelSpecTemplate/list",
    type: "utility"
  },
  "cash_flow_item": {
    editPath: "/catalog/cash_flow_item/edit",
    listPath: "/catalog/cash_flow_item/list",
    type: "catalog"
  },
  "chart_of_account": {
    listPath: "/catalog/chart_of_account/list",
    type: "catalog"
  },
  "construction_object": {
    editPath: "/catalog/construction_object/edit",
    listPath: "/catalog/construction_object/list",
    type: "catalog"
  },
  "counterparty": {
    editPath: "/catalog/counterparty/edit",
    listPath: "/catalog/counterparty/list",
    type: "catalog",
    allow: true,
    aliases: ["контрагент","поставщик","постачальник","клієнт","клиент"],
    priority: 2
  },
  "counterparty_contract": {
    editPath: "/catalog/counterparty_contract/edit",
    listPath: "/catalog/counterparty_contract/list",
    type: "catalog"
  },
  "currency": {
    editPath: "/catalog/currency/edit",
    listPath: "/catalog/currency/list",
    type: "catalog"
  },
  "currency_rate": {
    editPath: "/register/currency_rate/edit",
    listPath: "/register/currency_rate/list",
    type: "register"
  },
  "document_movements": {
    listPath: "/report/document_movements/list",
    type: "report"
  },
  "expense_item": {
    editPath: "/catalog/expense_item/edit",
    listPath: "/catalog/expense_item/list",
    type: "catalog"
  },
  "income_item": {
    editPath: "/catalog/income_item/edit",
    listPath: "/catalog/income_item/list",
    type: "catalog"
  },
  "intangible_asset": {
    editPath: "/catalog/intangible_asset/edit",
    listPath: "/catalog/intangible_asset/list",
    type: "catalog"
  },
  "interface": {
    editPath: "/admin/interface/edit",
    listPath: "/admin/interface/list",
    type: "admin"
  },
  "journal_report": {
    listPath: "/report/journal_report/list",
    type: "report"
  },
  "manual_entry": {
    editPath: "/operation/manual_entry/edit",
    listPath: "/operation/manual_entry/list",
    type: "document",
    allow: true,
    priority: 9
  },
  "nomenclature": {
    editPath: "/catalog/nomenclature/edit",
    listPath: "/catalog/nomenclature/list",
    type: "catalog",
    allow: true,
    aliases: ["номенклатура","товар","позиція","позиция","цемент","cement"],
    priority: 1
  },
  "nomenclature_group": {
    editPath: "/catalog/nomenclature_group/edit",
    listPath: "/catalog/nomenclature_group/list",
    type: "catalog"
  },
  "notImplement": {
    listPath: "/develope/notImplement/list",
    type: "utility"
  },
  "organization": {
    editPath: "/catalog/organization/edit",
    listPath: "/catalog/organization/list",
    type: "catalog"
  },
  "organization_department": {
    editPath: "/catalog/organization_department/edit",
    listPath: "/catalog/organization_department/list",
    type: "catalog"
  },
  "physical_person": {
    editPath: "/catalog/physical_person/edit",
    listPath: "/catalog/physical_person/list",
    type: "catalog"
  },
  "price_type": {
    editPath: "/catalog/price_type/edit",
    listPath: "/catalog/price_type/list",
    type: "catalog"
  },
  "print_template": {
    editPath: "/admin/print_template/edit",
    listPath: "/admin/print_template/list",
    type: "admin"
  },
  "reserve": {
    editPath: "/catalog/reserve/edit",
    listPath: "/catalog/reserve/list",
    type: "catalog"
  },
  "supplier_invoice": {
    editPath: "/operation/supplier_invoice/edit",
    listPath: "/operation/supplier_invoice/list",
    type: "document",
    allow: true,
    aliases: ["накладна","накладная","прибуткова","поступление"],
    priority: 8
  },
  "tax": {
    editPath: "/catalog/tax/edit",
    listPath: "/catalog/tax/list",
    type: "catalog"
  },
  "tax_declaration_item": {
    editPath: "/catalog/tax_declaration_item/edit",
    listPath: "/catalog/tax_declaration_item/list",
    type: "catalog"
  },
  "tax_purpose": {
    editPath: "/catalog/tax_purpose/edit",
    listPath: "/catalog/tax_purpose/list",
    type: "catalog"
  },
  "tax_rate_scale": {
    editPath: "/register/tax_rate_scale/edit",
    listPath: "/register/tax_rate_scale/list",
    type: "register"
  },
  "unit_classifier": {
    editPath: "/catalog/unit_classifier/edit",
    listPath: "/catalog/unit_classifier/list",
    type: "catalog",
    allow: true,
    aliases: ["одиниця","единица","кг","шт","м","л"],
    priority: 4
  },
  "user": {
    editPath: "/admin/user/edit",
    listPath: "/admin/user/list",
    type: "admin"
  },
  "user_group": {
    editPath: "/admin/user_group/edit",
    listPath: "/admin/user_group/list",
    type: "admin"
  },
  "vat_rate": {
    editPath: "/register/vat_rate/edit",
    listPath: "/register/vat_rate/list",
    type: "register",
    allow: true,
    priority: 7
  },
  "warehouse": {
    editPath: "/catalog/warehouse/edit",
    listPath: "/catalog/warehouse/list",
    type: "catalog",
    allow: true,
    aliases: ["склад"],
    priority: 3
  }
};

