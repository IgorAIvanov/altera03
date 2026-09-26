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

/**
 * Чи знає агент таку модель. Знає — якщо вона є в маршрутах АБО має хоч один
 * інструмент.
 *
 * Друге потрібне не для краси: запис маршрутів генератор довго писав лише
 * моделям з екраном, тож у застосунку, зібраному старшим `@altera/tools`,
 * модель «лише команди» має інструменти й не має маршруту. Відбивати її
 * виклик означало б розвести два білі списки — перелік показує інструмент,
 * диспетчер його не пускає.
 */
export function isAgentModel(model: string): boolean {
  if (getAgentRoutes()[model]) return true;
  const prefix = `${model}.`;
  return Object.keys(getServerConfig().agentTools).some((name) => name.startsWith(prefix));
}
