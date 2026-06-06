import { Controller, Param, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
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
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    try {
      let body: unknown = {};

      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const userId = await this.requestUserService.resolveUserId(req, body);
      return await this.service.execute(model, command, body ?? {}, userId);
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(modelError(error.message), 401);
      }

      return modelError(
        error instanceof Error ? error.message : "Помилка виконання model command",
      );
    }
  }
}