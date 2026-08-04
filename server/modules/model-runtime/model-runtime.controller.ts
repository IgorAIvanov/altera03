import { Controller, Param, Post, Req } from "@danet/core";
import {
  AuthenticationRequiredError,
  type HttpRequest,
  jsonResponse,
  SESSION_CHANGED_HEADER,
  SessionChangedError,
} from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import {
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailable,
  isPostgresError,
  postgresErrorClientMessage,
  postgresErrorField,
} from "../../database/database-error.ts";
import { ModelCommandError } from "./model-runtime.errors.ts";
import { ModelRuntimeService } from "./model-runtime.service.ts";

/**
 * Відмова команди. `field` — ім'я поля форми, якого стосується помилка: коли
 * воно відоме, повідомлення їде об'єктом, і клієнт підсвічує саме те поле
 * замість самого лише банера. Без нього форма лишається як була — голим
 * рядком, який клієнт розуміє так само.
 */
function modelError(message: string, field?: string | null) {
  return {
    ok: false,
    data: {
      item: null,
      rows: [],
      options: {},
      totals: {},
      extra: {},
    },
    messages: [field ? { type: "error", text: message, field } : message],
    meta: {},
  };
}

@Controller("api/model")
export class ModelRuntimeController {
  constructor(private service: ModelRuntimeService, private requestUserService: RequestUserService) {}

  @Post(":model/:command")
  async execute(
    @Param("model") model: string,
    @Param("command") command: string,
    @Req() req: HttpRequest,
  ) {
    try {
      let body: unknown = {};

      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const auth = await this.requestUserService.resolveAuthContext(req, body);
      return await this.service.execute(model, command, body ?? {}, auth.userId, auth.sessionId);
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(modelError(error.message), 401);
      }

      // Раніше за все інше: команда до бази ще не дійшла, і саме в цьому суть —
      // запис не має піти під користувачем, якого на екрані ніхто не бачив.
      if (error instanceof SessionChangedError) {
        return jsonResponse(modelError(error.message), error.status, {
          [SESSION_CHANGED_HEADER]: "1",
        });
      }

      // Недоступна БД — не помилка команди, і повідомлення драйвера
      // (`ETIMEDOUT`, `CONNECTION_REFUSED`) користувачеві нічого не пояснює.
      // Той самий текст і статус, що й у глобального фільтра.
      if (isDatabaseUnavailable(error)) {
        console.error(`❌ ${model}/${command}: ${DATABASE_UNAVAILABLE_MESSAGE}`);
        return jsonResponse(modelError(DATABASE_UNAVAILABLE_MESSAGE), 503);
      }

      // Стан сервера, а не запиту: команди немає, SQL не опубліковано, хендлер
      // зламаний. Статус несе сама помилка — деталі вже в консолі.
      if (error instanceof ModelCommandError) {
        return jsonResponse(modelError(error.message), error.status);
      }

      // Помилка PostgreSQL, що дійшла аж сюди, — вже не «функції немає» (її
      // перехопив сервіс) і не недоступна БД. Навмисний `raise exception` і
      // відомі порушення даних (унікальність, довжина, формат) перекладаються
      // за SQLSTATE — сирий текст називає таблиці й констрейнти і назовні не
      // виходить. Невідомий код — загальна помилка: деталі лишаються в консолі.
      if (isPostgresError(error)) {
        const message = postgresErrorClientMessage(error);
        if (message !== null) {
          return modelError(message, postgresErrorField(error));
        }
        console.error(`❌ ${model}/${command}: PostgreSQL ${error.code}: ${error.message}`);
        return jsonResponse(modelError("Внутрішня помилка сервера"), 500);
      }

      return modelError(
        error instanceof Error ? error.message : "Помилка виконання model command",
      );
    }
  }
}