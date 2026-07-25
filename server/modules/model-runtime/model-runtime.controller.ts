import { Controller, Param, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, type HttpRequest, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import {
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailable,
} from "../../database/database-error.ts";
import { ModelCommandError } from "./model-runtime.errors.ts";
import { ModelRuntimeService } from "./model-runtime.service.ts";

function modelError(message: string) {
  return {
    ok: false,
    data: {
      item: null,
      rows: [],
      options: {},
      totals: {},
      extra: {},
    },
    messages: [message],
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

      return modelError(
        error instanceof Error ? error.message : "Помилка виконання model command",
      );
    }
  }
}