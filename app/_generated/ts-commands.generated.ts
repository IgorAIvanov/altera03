import ts_bank_ping from "../catalog/bank/db/bank.commands.ts";
import ts_user_setPassword from "../admin/user/db/user.commands.ts";

// Generated from model manifests. Do not edit manually.
// Серверний бік реєстру: тут статичні import модулів TS-команд, тому цей
// файл імпортує ТІЛЬКИ app/server.ts. Клієнт бере дані з model-registry.

export const generatedTsCommandBindings = [
  { model: "bank", command: "ping", handler: ts_bank_ping },
  { model: "invoice", command: "postPreview", handlerKey: "runtime.postPreview" },
  { model: "invoice", command: "printPdf", handlerKey: "runtime.printPdf" },
  { model: "manual_entry", command: "postPreview", handlerKey: "runtime.postPreview" },
  { model: "print_template", command: "preview", handlerKey: "runtime.printPreview" },
  { model: "user", command: "setPassword", handler: ts_user_setPassword }
];

