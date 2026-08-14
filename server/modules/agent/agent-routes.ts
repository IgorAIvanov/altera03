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
  /**
   * Назва моделі мовами застосунку (`{uk: "Банки", en: "Banks"}`) — з локалей,
   * узята при генерації. Агент інакше бачить лише технічне ім'я, а на сотні
   * моделей саме назва й каже, що це таке. Мов кілька, бо мову називає
   * застосунок: агент і людина можуть розмовляти різними.
   */
  titles?: Record<string, string>;
}

/** Маршрути з конфігурації. Окремого кроку реєстрації немає — читаємо на місці. */
export function getAgentRoutes(): Record<string, AgentModelRoute> {
  return getServerConfig().agentRoutes;
}
