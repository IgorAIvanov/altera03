import type { MenuItem } from "./menu.types.ts";

// SVG paths из Material Design Icons (viewBox 0 0 24 24)
const icons = {
  catalog:       "M20 6h-2.18c.07-.44.18-.88.18-1a3 3 0 0 0-6 0c0 .12.11.56.18 1H10c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-1a1 1 0 0 1 2 0c0 .12-.11.56-.18 1h-1.64c-.07-.44-.18-.88-.18-1zm-3 3h10v12H10V8z",
  bank:          "M11.5 1L2 6v2h19V6l-9.5-5zm-7 8v8H2v2h20v-2h-2.5v-8h-2v8h-3v-8h-2v8h-3v-8h-2z",
  counterparty:  "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  nomenclature:  "M20 4H4v2l8 5 8-5V4zM4 13h16v5H4v-5z",
  document:      "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  invoice:       "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z",
  report:        "M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2.5 2.1h-15V5h15v14.1zm0-16.1h-15c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  balance:       "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93V18h-2v1.93C7.06 19.48 4.52 16.94 4.07 14H6v-2H4.07C4.52 9.06 7.06 6.52 10 6.07V8h2V6.07c2.94.45 5.48 2.99 5.93 5.93H16v2h1.93c-.45 2.94-2.99 5.48-5.93 5.93z",
  settings:      "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
};

export const menuMock: MenuItem[] = [
  {
    id: "catalog",
    label: "Довідники",
    icon: icons.catalog,
    children: [
      { id: "bank",         label: "Банки",          icon: icons.bank,         route: "catalog/bank/list" },
      { id: "counterparty", label: "Контрагенти",    icon: icons.counterparty, route: "catalog/counterparty/list" },
      { id: "nomenclature", label: "Номенклатура",   icon: icons.nomenclature, route: "catalog/nomenclature/list" },
    ],
  },
  {
    id: "document",
    label: "Документи",
    icon: icons.document,
    children: [
      { id: "supplier_invoice", label: "Надходження товарів", icon: icons.invoice, route: "operation/supplier_invoice/list" },
    ],
  },
  {
    id: "report",
    label: "Звіти",
    icon: icons.report,
    children: [
      { id: "balance", label: "Баланс", icon: icons.balance, route: "report/balance/view" },
    ],
  },
  {
    id: "settings",
    label: "Налаштування",
    icon: icons.settings,
    route: "admin/settings/main",
  },
];
