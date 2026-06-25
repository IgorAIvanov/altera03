import { Injectable } from "@danet/core";
import { ModelRuntimeService } from "../model-runtime/model-runtime.service.ts";
import { agentModelRoutes } from "./agent-routes.ts";
import type {
  AgentChatRequest,
  AgentCommandResult,
  AgentResponse,
  AgentUiAction,
} from "./agent.types.ts";

const SAFE_COMMANDS = new Set(["list", "get", "save", "delete", "lookup"]);
const CONFIRM_COMMANDS = new Set(["post", "unpost"]);

@Injectable()
export class AgentService {
  constructor(private modelRuntime: ModelRuntimeService) {}

  async chat(request: AgentChatRequest, userId: string): Promise<AgentResponse> {
    const { model, command, payload } = request;

    const routes = agentModelRoutes[model];
    if (!routes) {
      return this.errorResponse(`Модель '${model}' не знайдена або не підтримується агентом`);
    }

    if (!SAFE_COMMANDS.has(command) && !CONFIRM_COMMANDS.has(command)) {
      return this.errorResponse(`Команда '${command}' не дозволена для агента`);
    }

    let rawResult: unknown;
    try {
      rawResult = await this.modelRuntime.execute(model, command, payload, userId);
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
      messages,
      data,
    };

    if (!ok) {
      return {
        ok: false,
        result,
        uiActions: [],
        messages,
      };
    }

    const uiActions = this.buildUiActions(model, command, id, routes);

    return {
      ok: true,
      result,
      uiActions,
      messages,
    };
  }

  private buildUiActions(
    model: string,
    command: string,
    id: string | undefined,
    routes: { editPath?: string; listPath?: string; type: string },
  ): AgentUiAction[] {
    const actions: AgentUiAction[] = [];

    if ((command === "save" || command === "post") && id && routes.editPath) {
      const route = `${routes.editPath}?id=${id}`;
      actions.push({ type: "openRoute", route, model, id });
      return actions;
    }

    if (command === "delete" && routes.listPath) {
      actions.push({ type: "openList", route: routes.listPath, model });
      return actions;
    }

    if (routes.editPath && id) {
      const route = `${routes.editPath}?id=${id}`;
      actions.push({ type: "openRoute", route, model, id });
    } else if (routes.listPath) {
      actions.push({ type: "openList", route: routes.listPath, model });
    }

    return actions;
  }

  private errorResponse(message: string): AgentResponse {
    return {
      ok: false,
      result: null,
      uiActions: [{ type: "showToast", level: "error", message }],
      messages: [message],
    };
  }
}
