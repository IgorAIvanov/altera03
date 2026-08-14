import { Controller, Get, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, type HttpRequest, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import { AgentService } from "./agent.service.ts";
import { AgentToolsService } from "./agent-tools.service.ts";
import type { AgentCallRequest } from "./agent.types.ts";

function agentError(message: string) {
  return { ok: false, result: null, messages: [message] };
}

@Controller("api/agent")
export class AgentController {
  constructor(
    private agentService: AgentService,
    private agentToolsService: AgentToolsService,
    private requestUserService: RequestUserService,
  ) {}

  /**
   * Що агент уміє робити в ЦІЙ базі — і рівно те, на що має право.
   *
   * Далі він кличе звичайні `POST /api/model/:model/:command`: окремого каналу
   * для агента немає, тож і розходитися з застосунком нема чому.
   */
  @Get("tools")
  async tools(@Req() req: HttpRequest) {
    try {
      const auth = await this.requestUserService.resolveAuthContext(req, {});
      const tools = await this.agentToolsService.listTools(auth.userId, {
        accessToken: auth.accessToken,
      });
      return { ok: true, data: { rows: tools, totals: { count: tools.length } }, messages: [] };
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(agentError(error.message), 401);
      }
      return agentError(error instanceof Error ? error.message : "Помилка переліку інструментів");
    }
  }

  /**
   * Виконати команду моделі від імені власника токена.
   *
   * `call`, а не `chat`: чату тут ніколи й не було — приходить `{model,
   * command, payload}`, а не репліка людини. Ім'я лишалося від LLM-агента,
   * якого вже немає, і збивало з пантелику саме тих, для кого цей вхід і
   * зроблено. Пара з `GET /api/agent/tools` тепер читається як у MCP:
   * перелік інструментів і виклик інструмента.
   */
  @Post("call")
  async call(
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
      const request = body as AgentCallRequest;

      if (!request.model || typeof request.model !== "string") {
        return agentError("model є обов'язковим");
      }
      if (!request.command || typeof request.command !== "string") {
        return agentError("command є обов'язковим");
      }

      return await this.agentService.call(
        {
          model: request.model,
          command: request.command,
          payload: (request.payload ?? {}) as Record<string, unknown>,
        },
        auth.userId,
        { accessToken: auth.accessToken },
      );
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(agentError(error.message), 401);
      }
      return agentError(error instanceof Error ? error.message : "Помилка агента");
    }
  }
}
