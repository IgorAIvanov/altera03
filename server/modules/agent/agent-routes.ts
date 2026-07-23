import { getServerConfig } from "../../config/server-config.ts";

/**
 * Маршрути моделей для агента. Тип належить server-бібліотеці, а дані застосунок
 * завантажує з app/_generated і передає в bootstrap() полем `agentRoutes`.
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

/** Маршрути з конфігурації. Окремого кроку реєстрації немає — читаємо на місці. */
export function getAgentRoutes(): Record<string, AgentModelRoute> {
  return getServerConfig().agentRoutes;
}
