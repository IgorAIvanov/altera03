/**
 * Реєстр оболонки: точка розширення, через яку застосунок повідомляє фреймворку,
 * які кастомні елементи використовувати для шапки, меню та домашньої вкладки.
 *
 * Завдяки цьому `tab-controller` (фреймворк) не імпортує конкретні app-компоненти —
 * їх реєструє composition root застосунку (client/main.ts) до визначення tab-controller.
 */
export interface ShellTags {
  /** Тег елемента шапки, напр. "app-header". */
  header: string;
  /** Тег елемента бічного меню, напр. "app-menu". */
  menu: string;
  /** Тег елемента домашньої вкладки, напр. "home-tab". */
  home: string;
  /**
   * Тег екрана входу, напр. "app-login". Показується замість оболонки, доки
   * сесії немає. Вигляд цього екрана — обличчя конкретного продукту, тому він
   * належить застосунку, а не бібліотеці.
   */
  login: string;
}

let _tags: ShellTags = { header: "", menu: "", home: "", login: "" };

export function registerShell(tags: ShellTags): void {
  _tags = tags;
}

export function shellTags(): ShellTags {
  return _tags;
}
