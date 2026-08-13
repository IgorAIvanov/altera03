import { Controller, Get, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, type HttpRequest, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
import { AgentService } from "./agent.service.ts";
import { AgentLlmService } from "./agent-llm.service.ts";
import { AgentToolsService } from "./agent-tools.service.ts";
import type { AgentChatRequest } from "./agent.types.ts";

function agentError(message: string) {
  return { ok: false, result: null, uiActions: [], messages: [message] };
}

@Controller("api/agent")
export class AgentController {
  constructor(
    private agentService: AgentService,
    private agentLlmService: AgentLlmService,
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

  @Post("chat")
  async chat(
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
      const request = body as AgentChatRequest;

      if (!request.model || typeof request.model !== "string") {
        return agentError("model є обов'язковим");
      }
      if (!request.command || typeof request.command !== "string") {
        return agentError("command є обов'язковим");
      }

      return await this.agentService.chat(
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

  @Post("llm-chat")
  async llmChat(
    @Req() req: HttpRequest,
  ) {
    try {
      let message: string | undefined;
      let threadId: string | undefined;
      let fileUpload: { bytes: Uint8Array; filename: string; mimeType: string } | undefined;
      let bodyForAuth: unknown = {};

      const contentType = req.header("content-type") ?? "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        message = formData.get("message")?.toString();
        threadId = formData.get("threadId")?.toString();
        const userIdField = formData.get("userId")?.toString();
        if (userIdField) bodyForAuth = { userId: userIdField };

        const file = formData.get("file");
        if (file instanceof File && file.size > 0) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mimeType = file.type || "application/pdf";
          fileUpload = { bytes, filename: file.name || "document.pdf", mimeType };
        }
      } else {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        bodyForAuth = body;
        message = typeof body.message === "string" ? body.message : undefined;
        threadId = typeof body.threadId === "string" ? body.threadId : undefined;
      }

      const userId = await this.requestUserService.resolveUserId(req, bodyForAuth);

      if (!message || !message.trim()) {
        return agentError("message є обов'язковим");
      }

      return await this.agentLlmService.chat(message.trim(), userId, threadId, fileUpload);
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(agentError(error.message), 401);
      }
      return agentError(error instanceof Error ? error.message : "Помилка LLM агента");
    }
  }
}
