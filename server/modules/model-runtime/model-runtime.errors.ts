/**
 * Помилки рантайму моделей, у яких винен не запит, а стан сервера.
 *
 * Ці випадки досі доходили до клієнта сирими: `function app.bank_list(bigint,
 * jsonb) does not exist` замість «команду не реалізовано», або `handler is not a
 * function`, або взагалі `null` замість конверта — форма при цьому мовчки
 * ламалася. Спільне в них те, що користувач нічого виправити не може: SQL моделі
 * не опубліковано, TS-модуль не той, функція повернула не те. Тому вони окремий
 * тип із власним статусом, а не текст усередині загального `Error`.
 */
export class ModelCommandError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ModelCommandError";
  }

  /** Команди немає: ані TS-хендлера, ані SQL-функції для неї не оголошено. */
  static notConfigured(model: string, command: string): ModelCommandError {
    return new ModelCommandError(404, `Команду «${model}/${command}» не налаштовано.`);
  }

  /**
   * Команда оголошена, але виконувати нічого: у базі немає функції або
   * TS-хендлер не є функцією. 501 — саме той випадок, коли сервер знає, чого від
   * нього хочуть, і не вміє цього зробити.
   */
  static notImplemented(model: string, command: string): ModelCommandError {
    return new ModelCommandError(
      501,
      `Команду «${model}/${command}» не реалізовано на сервері.`,
    );
  }

  /**
   * Команда є, але яке право їй потрібне — не оголошено. Це вада конфігурації,
   * а не запиту, тому 501, а не відмова в конверті: користувач тут нічого не
   * виправить, а той, хто додав команду, побачить, чого бракує в manifest.json.
   *
   * Fail-closed: мовчки пропустити невідому команду означало б, що будь-яка
   * нова команда з'являється без прав і ніхто цього не помічає.
   */
  static accessNotDeclared(model: string, command: string): ModelCommandError {
    return new ModelCommandError(
      501,
      `Команда «${model}/${command}» не оголошує потрібного права. ` +
        `Додайте її в commands.access у manifest.json моделі й виконайте sql:registry.`,
    );
  }

  /** Виконалося, але повернуло не конверт — довіряти такій відповіді не можна. */
  static badResponse(model: string, command: string): ModelCommandError {
    return new ModelCommandError(
      500,
      `Команда «${model}/${command}» повернула неочікувану відповідь.`,
    );
  }
}

/**
 * Чи схожа відповідь на стандартний конверт.
 *
 * Свідомо м'яка перевірка — тільки `ok`. Жорсткіша (обов'язкові `data`,
 * `messages`) відкинула б рукописні SQL-функції, які повертають скорочений
 * конверт і роками працюють; мета тут — упіймати `null`, рядок і забутий
 * `return`, а не вирівняти всі функції під один шаблон.
 */
export function looksLikeEnvelope(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { ok?: unknown }).ok === "boolean";
}
