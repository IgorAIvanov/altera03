// Generated from model manifests. Do not edit manually.

export const agentModelRoutes = {
  "account_card": {
    listPath: "/report/account_card/list",
    type: "report",
    titles: {"en":"Account card","uk":"Картка рахунку"}
  },
  "agent_note": {
    editPath: "/admin/agent_note/edit",
    listPath: "/admin/agent_note/list",
    type: "admin",
    allow: false,
    titles: {"en":"Base memo","uk":"Пам'ятка бази"}
  },
  "audit_log": {
    listPath: "/admin/audit_log/list",
    type: "admin",
    titles: {"en":"Audit log","uk":"Журнал аудиту"}
  },
  "audit_setting": {
    editPath: "/admin/audit_setting/edit",
    listPath: "/admin/audit_setting/list",
    type: "admin",
    titles: {"en":"Audit settings","uk":"Налаштування журналу"}
  },
  "bank": {
    editPath: "/catalog/bank/edit",
    listPath: "/catalog/bank/list",
    type: "catalog",
    titles: {"en":"Banks","uk":"Банки"}
  },
  "chart_of_account": {
    editPath: "/catalog/chart_of_account/edit",
    listPath: "/catalog/chart_of_account/list",
    type: "catalog",
    titles: {"en":"Chart of accounts","uk":"План рахунків"}
  },
  "counterparty": {
    editPath: "/catalog/counterparty/edit",
    listPath: "/catalog/counterparty/list",
    type: "catalog",
    titles: {"en":"Counterparties","uk":"Контрагенти"}
  },
  "currency": {
    editPath: "/catalog/currency/edit",
    listPath: "/catalog/currency/list",
    type: "catalog",
    titles: {"en":"Currencies","uk":"Валюти"}
  },
  "currency_rate": {
    editPath: "/data/currency_rate/edit",
    listPath: "/data/currency_rate/list",
    type: "register",
    titles: {"en":"Exchange rates","uk":"Курси валют"}
  },
  "document_movements": {
    listPath: "/report/document_movements/list",
    type: "report",
    titles: {"en":"Document movements","uk":"Рух документа"}
  },
  "invoice": {
    editPath: "/document/invoice/edit",
    listPath: "/document/invoice/list",
    type: "document",
    titles: {"en":"Invoices","uk":"Накладні"}
  },
  "manual_entry": {
    editPath: "/operation/manual_entry/edit",
    listPath: "/operation/manual_entry/list",
    type: "document",
    titles: {"en":"Manual entries","uk":"Операції"}
  },
  "menu": {
    editPath: "/admin/menu/edit",
    listPath: "/admin/menu/list",
    type: "catalog",
    titles: {"en":"Menus","uk":"Меню"}
  },
  "nomenclature": {
    editPath: "/catalog/nomenclature/edit",
    listPath: "/catalog/nomenclature/list",
    type: "catalog",
    allow: true,
    allowCommands: ["get","save","list","lookup"],
    aliases: ["номенклатура","товар","товари","послуга","послуги"],
    priority: 10,
    titles: {"en":"Nomenclature","uk":"Номенклатура"}
  },
  "numerator": {
    editPath: "/admin/numerator/edit",
    listPath: "/admin/numerator/list",
    type: "admin",
    titles: {"en":"Numerators","uk":"Нумератори"}
  },
  "organization": {
    editPath: "/catalog/organization/edit",
    listPath: "/catalog/organization/list",
    type: "catalog",
    titles: {"en":"Organizations","uk":"Організації"}
  },
  "print_template": {
    editPath: "/admin/print_template/edit",
    listPath: "/admin/print_template/list",
    type: "admin",
    titles: {"en":"Print templates","uk":"Шаблони друку"}
  },
  "remark": {
    editPath: "/admin/remark/edit",
    listPath: "/admin/remark/list",
    type: "admin",
    allow: true,
    allowCommands: ["list","get","answer"],
    aliases: ["зауваження","зауваження до рішення","remark"],
    priority: 5,
    titles: {"en":"Remarks","uk":"Зауваження"}
  },
  "setting": {
    editPath: "/admin/setting/edit",
    type: "admin",
    allowCommands: ["get"],
    titles: {"en":"Settings","uk":"Налаштування"}
  },
  "turnover_balance": {
    listPath: "/report/turnover_balance/list",
    type: "report",
    titles: {"en":"Turnover and balance sheet","uk":"Оборотно-сальдова відомість"}
  },
  "user": {
    editPath: "/admin/user/edit",
    listPath: "/admin/user/list",
    type: "catalog",
    titles: {"en":"Users","uk":"Користувачі"}
  },
  "user_group": {
    editPath: "/admin/user_group/edit",
    listPath: "/admin/user_group/list",
    type: "catalog",
    titles: {"en":"User groups","uk":"Групи користувачів"}
  }
};

