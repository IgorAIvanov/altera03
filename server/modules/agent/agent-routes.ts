/**
 * Маршрути моделей для агента. Тип належить server-бібліотеці, а дані застосунок
 * завантажує з app/_generated і реєструє у composition root (app/server.ts).
 */
export interface AgentModelRoute {
  editPath?: string;
  listPath?: string;
  type: string;
  allow?: boolean;
  allowCommands?: string[];
  aliases?: string[];
  priority?: number;
}

/** Живий обʼєкт-холдер: заповнюється ДО обробки запитів, читається сервісами агента. */
export const agentModelRoutes: Record<string, AgentModelRoute> = {};

export function registerAgentRoutes(routes: Record<string, AgentModelRoute>): void {
  for (const key of Object.keys(agentModelRoutes)) {
    delete agentModelRoutes[key];
  }
  Object.assign(agentModelRoutes, routes);
}
