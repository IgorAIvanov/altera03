import type { ModelBackendConfig } from "./model-runtime.types.ts";

// Generated from model manifests. Do not edit manually.

export const generatedModelRegistry: Record<string, ModelBackendConfig> = {
  "account_balance": {
    type: "report",
    schema: "app"
  },
  "account_card": {
    type: "report",
    schema: "app"
  },
  "balance": {
    type: "report",
    schema: "app"
  },
  "bank": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "bank_folders",
    "picker": "bank_fetch"
    }
  },
  "bank_account": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "bank_account_fetch"
    }
  },
  "basImportProcess": {
    type: "utility",
    schema: "app"
  },
  "basModelSpecTemplate": {
    type: "utility",
    schema: "app"
  },
  "cash_flow_item": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "cash_flow_item_fetch"
    }
  },
  "chart_of_account": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "analyticsDimensions": "chart_of_account_analytics_dimensions",
    "children": { functionName: "chart_of_account_children", validate: (payload) => {
    if (typeof payload.code !== "string" || payload.code.trim() === "") {
      return "code обов'язковий для children";
    }
  
    return null;
  } },
    "picker": "chart_of_account_fetch"
    }
  },
  "construction_object": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "construction_object_folders",
    "nextCode": "catalog_next_code",
    "picker": "construction_object_fetch"
    }
  },
  "counterparty": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "counterparty_folders",
    "nextCode": "catalog_next_code",
    "picker": "counterparty_fetch"
    }
  },
  "counterparty_contract": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "counterparty_contract_folders",
    "nextCode": "catalog_next_code",
    "picker": "counterparty_contract_fetch"
    }
  },
  "currency": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "picker": "currency_fetch"
    }
  },
  "currency_rate": {
    type: "register",
    schema: "app",
    sqlCommands: {
    "actual": "currency_rate_actual",
    "history": "currency_rate_history",
    "upsert": "currency_rate_upsert"
    }
  },
  "document_movements": {
    type: "report",
    schema: "app"
  },
  "expense_item": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "expense_item_fetch"
    }
  },
  "income_item": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "income_item_fetch"
    }
  },
  "intangible_asset": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "intangible_asset_folders",
    "nextCode": "catalog_next_code",
    "picker": "intangible_asset_fetch",
    "printData": "intangible_asset_print_data"
    }
  },
  "interface": {
    type: "admin",
    schema: "app"
  },
  "journal_report": {
    type: "report",
    schema: "app"
  },
  "manual_entry": {
    type: "document",
    schema: "app",
    sqlCommands: {
    "nextNumber": "manual_entry_next_number"
    }
  },
  "nomenclature": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "nomenclature_folders",
    "nextCode": "catalog_next_code",
    "picker": "nomenclature_fetch",
    "vatRates": "vat_rate_fetch"
    }
  },
  "nomenclature_group": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "nomenclature_group_fetch"
    }
  },
  "notImplement": {
    type: "utility",
    schema: "app"
  },
  "organization": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "organization_fetch"
    }
  },
  "organization_department": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "picker": "organization_department_fetch"
    }
  },
  "physical_person": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "folders": "physical_person_folders",
    "nextCode": "catalog_next_code",
    "picker": "physical_person_fetch"
    }
  },
  "price_type": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "price_type_fetch"
    }
  },
  "print_template": {
    type: "admin",
    schema: "app"
  },
  "reserve": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "reserve_fetch"
    }
  },
  "supplier_invoice": {
    type: "document",
    schema: "app",
    sqlCommands: {
    "nextNumber": "supplier_invoice_next_number"
    }
  },
  "tax": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "tax_fetch"
    }
  },
  "tax_activity_kind": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "picker": "tax_activity_kind_fetch"
    }
  },
  "tax_declaration_item": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "tax_declaration_item_fetch"
    }
  },
  "tax_purpose": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "tax_purpose_fetch"
    }
  },
  "tax_rate_scale": {
    type: "register",
    schema: "app",
    sqlCommands: {
    "actual": "tax_rate_scale_actual",
    "history": "tax_rate_scale_history",
    "upsert": "tax_rate_scale_upsert"
    }
  },
  "unit_classifier": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "picker": "unit_classifier_fetch"
    }
  },
  "user": {
    type: "admin",
    schema: "app"
  },
  "user_group": {
    type: "admin",
    schema: "app"
  },
  "vat_rate": {
    type: "register",
    schema: "app"
  },
  "warehouse": {
    type: "catalog",
    schema: "app",
    sqlCommands: {
    "nextCode": "catalog_next_code",
    "picker": "warehouse_fetch"
    }
  }
};

export interface GeneratedTsCommandBinding {
  model: string;
  command: string;
  handlerKey: string;
}

export const generatedTsCommandBindings: GeneratedTsCommandBinding[] = [
  { model: "currency", command: "classifierFetch", handlerKey: "currency.classifierFetch" },
  { model: "currency", command: "loadRates", handlerKey: "currency.loadRates" },
  { model: "currency", command: "seedPredefined", handlerKey: "currency.seedPredefined" },
  { model: "intangible_asset", command: "printPdf", handlerKey: "runtime.printPdf" },
  { model: "manual_entry", command: "exportExcel", handlerKey: "runtime.exportExcel" },
  { model: "supplier_invoice", command: "exportExcel", handlerKey: "runtime.exportExcel" },
  { model: "supplier_invoice", command: "printPdf", handlerKey: "runtime.printPdf" },
  { model: "user", command: "exportExcel", handlerKey: "runtime.exportExcel" },
  { model: "user", command: "update", handlerKey: "user.update" }
];

