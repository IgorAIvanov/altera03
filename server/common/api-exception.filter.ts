import { HttpException, type ExceptionFilter } from "@danet/core";
import {
  AuthenticationRequiredError,
  jsonResponse,
  SESSION_CHANGED_HEADER,
  SessionChangedError,
} from "./http.ts";
import { err } from "./response.ts";
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from "../database/database-error.ts";
import { ModelCommandError } from "../modules/model-runtime/model-runtime.errors.ts";

/**
 * Останній рубіж: будь-яка помилка, що дійшла до HTTP-межі, стає конвертом.
 *
 * Конверт у цього API один — `{ ok, data, messages }` — але виняток, який ніхто
 * не спіймав, обробляв Danet, і назовні летіла його власна форма
 * `{ code, status, message: "Internal server error!" }`. Клієнт такого не читає:
 * `envelope.messages` порожній, `envelope.data` немає, тож у браузері лишалося
 * голе 500 без жодного пояснення. Тепер форма відповіді не залежить від того,
 * чи передбачили помилку в контролері.
 *
 * Текст помилки назовні НЕ віддається — там може бути SQL, шлях чи ім'я
 * внутрішньої функції. Виняток — випадки, де повідомлення написане нами для
 * користувача: недоступна БД і вимога авторизації.
 */
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown): Response | undefined {
    if (isDatabaseUnavailable(exception)) {
      // Не `console.error(exception)`: стек тут ні про що не говорить, а от
      // рядок «БД недоступна» в консолі сервера — перше, що треба побачити.
      console.error(`❌ ${DATABASE_UNAVAILABLE_MESSAGE}`, describe(exception));
      // 503, а не 500: сервер живий, недоступна залежність. Різниця не
      // косметична — на 500 проксі й моніторинг реагують інакше, ніж на 503.
      return jsonResponse(err(DATABASE_UNAVAILABLE_MESSAGE), 503);
    }

    if (exception instanceof AuthenticationRequiredError) {
      return jsonResponse(err(exception.message), exception.status);
    }

    if (exception instanceof SessionChangedError) {
      return jsonResponse(err(exception.message), exception.status, {
        [SESSION_CHANGED_HEADER]: "1",
      });
    }

    // Рантайм моделей ловить їх сам, але команду може викликати й агент —
    // тоді єдиний, хто лишається між помилкою і клієнтом, це фільтр.
    if (exception instanceof ModelCommandError) {
      return jsonResponse(err(exception.message), exception.status);
    }

    // Danet кидає їх сам (404, 400 від валідації) — статус уже правильний,
    // лишається перекласти на конверт.
    if (exception instanceof HttpException) {
      return jsonResponse(err(exception.description), exception.status);
    }

    console.error("❌ Необроблена помилка запиту:", exception);
    return jsonResponse(err("Внутрішня помилка сервера"), 500);
  }
}

/** Короткий опис для консолі: причина без стека, який тут нічого не додає. */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(describe).join("; ");
  }

  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}
