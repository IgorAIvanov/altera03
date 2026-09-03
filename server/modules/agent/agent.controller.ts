import { Controller, Get, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, type HttpRequest, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import { AgentService } from "./agent.service.ts";
import { AgentToolsService } from "./agent-tools.service.ts";
import { getAgentRoutes } from "./agent-routes.ts";
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
   * Без параметрів — КАТАЛОГ моделей (без схем); `?model=bank,invoice` — схеми
   * названих моделей, `&command=save` — однієї команди. Умовчання саме каталог,
   * бо він єдиний лишається малим, коли моделей стане сотня (див.
   * agent-tools.service.ts).
   *
   * Далі агент кличе `POST /api/agent/call` — окремого каналу немає, тож і
   * розходитися з застосунком нема чому.
   */
  @Get("tools")
  async tools(@Req() req: HttpRequest) {
    try {
      const auth = await this.requestUserService.resolveAuthContext(req, {});
      const caller = { accessToken: auth.accessToken };
      const query = new URL(req.url).searchParams;
      const command = query.get("command")?.trim();

      // Кілька моделей через кому: диспетчеру звичайно треба дві-три одразу, а
      // три запити на це — три оберти замість одного. Тілом такого не передати
      // (GET його не носить), але кілька імен у рядок вкладаються з запасом.
      const models = (query.get("model") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

      if (!models.length) {
        const catalog = await this.agentToolsService.listModels(auth.userId, caller);
        return {
          ok: true,
          data: { rows: catalog, totals: { count: catalog.length } },
          messages: [],
        };
      }

      // Названу модель, якої немає, називаємо помилкою, а не порожнечею: агент
      // спитав про конкретне, і «нічого» він прочитав би як «прав немає». У
      // списку відмовляє будь-яка невідома — мовчки віддати решту означало б
      // дати агенту вважати, що він отримав усе, що просив.
      const routes = getAgentRoutes();
      const unknown = models.filter((name) => !routes[name]);
      if (unknown.length) {
        return agentError(
          `Не знайдено або не підтримується агентом: '${unknown.join("', '")}'`,
        );
      }

      const tools = await this.agentToolsService.listTools(auth.userId, caller, { models, command });
      // Схема каже, які є ПОЛЯ, і мовчить про те, чого застосунок робити не
      // стане. Правила їдуть тут, а не в каталозі: каталог мусить лишатися
      // малим на сотні моделей, а правила потрібні тому, хто вже дійшов до
      // конкретної моделі.
      const rules = this.agentToolsService.rules(models, query.get("lang")?.trim() || undefined);
      return {
        ok: true,
        data: { rows: tools, extra: { rules }, totals: { count: tools.length } },
        messages: [],
      };
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
          lang: typeof request.lang === "string" && request.lang ? request.lang : undefined,
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
