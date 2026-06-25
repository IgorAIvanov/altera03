/// <reference lib="deno.ns" />
// Public API сервер-фреймворку (бібліотека). Composition root застосунку — app/server.ts —
// імпортує bootstrap + register*, наповнює реєстри даними з app/_generated і піднімає сервер.
// Сам цей модуль НЕ знає про конкретний застосунок (нульова залежність server → app).
export { bootstrap } from "./bootstrap.ts";
export { registerModelRegistry } from "./modules/model-runtime/model-registry.ts";
export type { GeneratedTsCommandBinding } from "./modules/model-runtime/model-registry.ts";
export { registerAgentRoutes } from "./modules/agent/agent-routes.ts";
export type { AgentModelRoute } from "./modules/agent/agent-routes.ts";
export { registerViewManifest } from "./modules/model-view/model-view.registry.ts";
export type { ViewManifestEntry } from "./modules/model-view/model-view.registry.ts";
