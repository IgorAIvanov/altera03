import { Injectable } from "@danet/core";
import { ModelRuntimeService, type ModelCommandCaller } from "../model-runtime/model-runtime.service.ts";
import { getServerConfig } from "../../config/server-config.ts";
import { getAgentRoutes } from "./agent-routes.ts";
import type { AgentCallRequest, AgentCommandResult, AgentResponse } from "./agent.types.ts";

@Injectable()
export class AgentService {
  constructor(private modelRuntime: ModelRuntimeService) {}

  async call(
    request: AgentCallRequest,
    userId: string,
    caller: ModelCommandCaller = {},
  ): Promise<AgentResponse> {
    const { model, command, payload } = request;

    const routes = getAgentRoutes()[model];
    if (!routes) {
      return this.errorResponse(`Модель '${model}' не знайдена або не підтримується агентом`);
    }

    // Що агенту можна, каже ПЕРЕЛІК ІНСТРУМЕНТІВ — той самий, який він прочитав
    // у `/api/agent/tools`, і той самий, що зібрався з манифестів (`agent.allow`,
    // `allowCommands`). Свій другий список тут уже був — п'ятірка стандартних
    // імен, — і саме через нього агент не міг покликати звіт: перелік показував
    // би `index`, а диспетчер відмовляв. Розходження двох білих списків тихе за
    // побудовою: помітно його лише тоді, коли агент уперше спробує.
    const tools = getServerConfig().agentTools;
    if (!tools[`${model}.${command}`]) {
      return this.errorResponse(
        Object.keys(tools).length === 0
          ? "Перелік інструментів агента порожній: застосунок не передав agentTools у bootstrap()"
          : `Команда '${command}' не оголошена для агента в моделі '${model}'`,
      );
    }

    let rawResult: unknown;
    try {
      rawResult = await this.modelRuntime.execute(model, command, payload, userId, "", caller);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResponse(`Помилка виконання команди: ${message}`);
    }

    const envelope = rawResult as Record<string, unknown>;
    const ok = envelope?.ok === true;
    const data = envelope?.data as Record<string, unknown> | undefined;
    const messages = Array.isArray(envelope?.messages)
      ? (envelope.messages as string[])
      : [];

    const item = data?.item as Record<string, unknown> | undefined;
    const rawId = item?.id;
    const id = rawId !== undefined && rawId !== null ? String(rawId) : undefined;

    const result: AgentCommandResult = {
      ok,
      model,
      command,
      id,
      // Тільки на успіху: посилання на запис, якого не створилося, гірше за
      // його відсутність — людина піде дивитися й побачить порожню форму.
      route: ok ? this.routeFor(routes, id) : undefined,
      messages,
      data,
    };

    return { ok, result, messages };
  }

  /**
   * Куди подивитися людині — глибоке посилання на вкладку.
   *
   * Формат той самий, що будує клієнт (`route` + `id`, без `?id=`): адреса
   * `/catalog/bank/edit/5` вміє відкрити вкладку, а `?id=5` — ні. Стара версія
   * цього коду розходилася з клієнтом саме тут, бо писалася до того, як
   * посилання на вкладку з'явилися.
   *
   * Немає запису — веде на список: після `list`, звіту чи видалення саме він і
   * потрібен.
   */
  private routeFor(
    routes: { editPath?: string; listPath?: string },
    id: string | undefined,
  ): string | undefined {
    if (id && routes.editPath) return `${routes.editPath}/${id}`;
    return routes.listPath;
  }

  private errorResponse(message: string): AgentResponse {
    return { ok: false, result: null, messages: [message] };
  }
}
