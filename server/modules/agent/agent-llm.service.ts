import { Injectable } from "@danet/core";
import { ModelRuntimeService } from "../model-runtime/model-runtime.service.ts";
import { getModelConfig } from "../model-runtime/model-registry.ts";
import { agentModelRoutes, type AgentModelRoute } from "./agent-routes.generated.ts";
import type { AgentResponse, AgentUiAction } from "./agent.types.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_FILES_URL = "https://api.openai.com/v1/files";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TOOL_ITERATIONS = 10;
const MAX_MODELS_IN_TOOL_CONTEXT = 8;
const MAX_ROUTER_CANDIDATES = 3;
const ROUTER_HIGH_CONFIDENCE = 0.75;
const ROUTER_LOW_CONFIDENCE = 0.55;
const STANDARD_COMMANDS = new Set(["get", "lookup", "save", "list", "delete", "post", "unpost"]);

// Build agent metadata from generated routes
function getModelAliases(): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const [model, route] of Object.entries(agentModelRoutes) as Array<[string, AgentModelRoute]>) {
    if (route.aliases?.length) {
      aliases[model] = route.aliases;
    }
  }
  return aliases;
}

function getDocumentSupportModels(): string[] {
  return Object.entries(agentModelRoutes)
    .filter(([_, route]): boolean => (route as AgentModelRoute).type === "document")
    .map(([model]) => model);
}

function getDefaultModelPriority(): string[] {
  const priorityMap = new Map<number, string[]>();
  for (const [model, route] of Object.entries(agentModelRoutes) as Array<[string, AgentModelRoute]>) {
    const priority = route.priority ?? 999;
    if (!priorityMap.has(priority)) {
      priorityMap.set(priority, []);
    }
    priorityMap.get(priority)!.push(model);
  }
  const sorted: string[] = [];
  for (const priority of Array.from(priorityMap.keys()).sort((a, b) => a - b)) {
    const models = priorityMap.get(priority) ?? [];
    sorted.push(...models.sort());
  }
  return sorted;
}

interface RouterCandidate {
  model: string;
  score: number;
}

interface RouterDecision {
  primaryModel?: string;
  candidates: RouterCandidate[];
  reason?: string;
}

interface ContextSelection {
  models: string[];
  strategy: string;
  confidence: number;
}

interface ModelCatalogItem {
  model: string;
  type: string;
  routePath: string;
  commands: string[];
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface ConversationSession {
  messages: ConversationMessage[];
  updatedAt: number;
}

type AgentRouteAccess = AgentModelRoute & {
  allow?: boolean;
  allowCommands?: string[];
};

// Responses API tool format (no nested `function` object)
interface ResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Responses API input items
interface ResponsesInputTextContent {
  type: "input_text";
  text: string;
}

interface ResponsesInputFileContent {
  type: "input_file";
  file_id: string;
}

interface ResponsesInputUser {
  role: "user";
  content: string | Array<ResponsesInputTextContent | ResponsesInputFileContent>;
}

interface ResponsesInputToolResult {
  type: "function_call_output";
  call_id: string;
  output: string;
}

type ResponsesInputItem = ResponsesInputUser | ResponsesInputToolResult;

// Responses API output items
interface ResponsesOutputMessage {
  type: "message";
  role: "assistant";
  content: Array<{ type: "output_text"; text: string } | { type: string }>;
}

interface ResponsesOutputFunctionCall {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

type ResponsesOutputItem = ResponsesOutputMessage | ResponsesOutputFunctionCall;

interface ResponsesApiResponse {
  id: string;
  status: string;
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

function buildTools(): ResponsesTool[] {
  const tools: ResponsesTool[] = [];

  for (const [model, rawRoute] of Object.entries(agentModelRoutes)) {
    const route = rawRoute as AgentRouteAccess;
    if (route.allow === false) {
      continue;
    }

    const config = getModelConfig(model);
    const modelType = route.type;
    const hasCommandAllowlist = Array.isArray(route.allowCommands);
    const allowedCommands = new Set<string>((route.allowCommands ?? []).map((command: string) => command.toLowerCase()));
    const isCommandAllowed = (command: string): boolean => {
      if (!hasCommandAllowlist) return true;
      return allowedCommands.has(command.toLowerCase());
    };

    // Use the path (e.g. /catalog/nomenclature/edit → catalog/nomenclature) so the LLM can
    // match Ukrainian domain terms to the correct model (номенклатура → catalog/nomenclature).
    const routePath = (route.editPath ?? route.listPath ?? "")
      .replace(/\/(edit|list|view)$/, "")
      .replace(/^\//, "");
    const label = routePath || model.replace(/_/g, " ");

    // get – single record + options
    if (isCommandAllowed("get")) {
      tools.push({
        type: "function",
        name: `${model}__get`,
        description: `Отримати запис "${label}" (type: ${modelType}) або порожній шаблон з переліком доступних значень для полів-посилань. Викликай перед save щоб побачити структуру item та доступні id в options.`,
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID запису для завантаження існуючого. Без ID повертає порожній шаблон.",
            },
          },
        },
      });
    }

    // save – create / update
    if (isCommandAllowed("save")) {
      tools.push({
        type: "function",
        name: `${model}__save`,
        description: `Створити або зберегти запис "${label}". item – поля запису, rows – табличні рядки для документів. Суми/ціни передавай рядком ("250.00").`,
        parameters: {
          type: "object",
          properties: {
            item: {
              type: "object",
              description: "Поля головного запису. Посилання передавай як id (counterpartyId, warehouseId тощо).",
            },
            rows: {
              type: "array",
              description: "Табличні рядки (тільки для документів).",
              items: { type: "object" },
            },
          },
          required: ["item"],
        },
      });
    }

    // list – records list
    if (isCommandAllowed("list")) {
      tools.push({
        type: "function",
        name: `${model}__list`,
        description: `Отримати список записів "${label}". Можна передати fragment, page, pageSize.`,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Рядок пошуку" },
            page: { type: "number" },
            pageSize: { type: "number" },
          },
        },
      });
    }

    // post / unpost for documents
    if (modelType === "document" && isCommandAllowed("post")) {
      tools.push({
        type: "function",
        name: `${model}__post`,
        description: `Провести документ "${label}" — сформувати бухгалтерські проводки.`,
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID документа" },
          },
          required: ["id"],
        },
      });
    }

    if (modelType === "document" && isCommandAllowed("unpost")) {
      tools.push({
        type: "function",
        name: `${model}__unpost`,
        description: `Скасувати проведення документа "${label}".`,
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID документа" },
          },
          required: ["id"],
        },
      });
    }

    // lookup – picker/autocomplete search
    if (isCommandAllowed("lookup")) {
      tools.push({
        type: "function",
        name: `${model}__lookup`,
        description: `Пошук записів "${label}" за рядком запиту. Використовуй для підстановки в поля-посилання. Повертає { rows: [{id, name}] }.`,
        parameters: {
          type: "object",
          properties: {
            fragment: { type: "string", description: "Рядок пошуку (назва або код)" },
            limit: { type: "number", description: "Максимальна кількість результатів" },
          },
        },
      });
    }

    // extra sql commands (non-standard)
    if (config?.sqlCommands) {
      for (const cmd of Object.keys(config.sqlCommands)) {
        if (STANDARD_COMMANDS.has(cmd)) continue;
        if (!isCommandAllowed(cmd)) continue;
        const isPicker = cmd === "lookup";
        const isNextCode = cmd === "nextCode";
        tools.push({
          type: "function",
          name: `${model}__${cmd}`,
          description: isNextCode
            ? `Отримати наступний код для нового запису "${label}". Викликай БЕЗ аргументів { }.`
            : isPicker
            ? `Пошук записів "${label}" за рядком запиту. Використовуй для пошуку значень lookup-полів. Передай { query: "назва або код" }.`
            : `Команда ${cmd} для "${label}". Передай потрібні параметри.`,
          parameters: {
            type: "object",
            properties: isNextCode
              ? {}
              : {
                query: { type: "string", description: "Рядок пошуку" },
              },
          },
        });
      }
    }
  }

  return tools;
}

const SYSTEM_PROMPT = `Ти агент бухгалтерської системи Altera (українське законодавство).

Правила роботи:
1. Перед update або post спочатку виклич load без id — щоб побачити структуру item і доступні значення в lookups.
2. Якщо потрібні об'єкти яких немає в lookups (номенклатура, контрагент тощо) — шукай через picker: { query: "назва або код" }.
3. В item передавай лише заповнені поля, посилання — як id (наприклад counterpartyId, nomenclatureId).
4. Суми, ціни, кількості — рядком: "250.00".
5. Документи після збереження можна провести командою post.
6. Якщо задачу виконано — підсумуй коротко що зроблено.

Відповідай лаконічно, ділово, українською.`;

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 12;

function formatConversationHistory(messages: ConversationMessage[]): string {
  return messages
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map((message) => `${message.role === "user" ? "Користувач" : "Асистент"}: ${message.content}`)
    .join("\n");
}

@Injectable()
export class AgentLlmService {
  private readonly tools: ResponsesTool[];
  private readonly toolsByModel: Record<string, ResponsesTool[]>;
  private readonly availableModels: string[];
  private readonly modelCatalog: ModelCatalogItem[];
  private readonly modelAliases: Record<string, string[]>;
  private readonly documentSupportModels: string[];
  private readonly defaultModelPriority: string[];
  private readonly conversationSessions = new Map<string, ConversationSession>();

  constructor(private modelRuntime: ModelRuntimeService) {
    this.tools = buildTools();
    this.toolsByModel = this.groupToolsByModel(this.tools);
    this.availableModels = Object.keys(this.toolsByModel);
    this.modelCatalog = this.buildModelCatalog();
    this.modelAliases = getModelAliases();
    this.documentSupportModels = getDocumentSupportModels();
    this.defaultModelPriority = getDefaultModelPriority();
  }

  async chat(
    userMessage: string,
    userId: string,
    threadId?: string,
    fileUpload?: { bytes: Uint8Array; filename: string; mimeType: string },
  ): Promise<AgentResponse> {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return this.errorResponse("OPENAI_API_KEY не налаштовано в backend/.env");
    }

    if (fileUpload && fileUpload.bytes.length > MAX_FILE_SIZE_BYTES) {
      return this.errorResponse(`Файл занадто великий (максимум ${MAX_FILE_SIZE_BYTES / 1024 / 1024} МБ)`);
    }

    const routerModel = Deno.env.get("OPENAI_ROUTER_MODEL") ?? "gpt-4o-mini";
    const executorModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
    const effectiveThreadId = threadId?.trim() || crypto.randomUUID();
    const sessionKey = `${userId}:${effectiveThreadId}`;

    this.cleanupExpiredSessions();

    const existingSession = this.conversationSessions.get(sessionKey);
    const conversationHistory = existingSession?.messages ?? [];
    const instructions = conversationHistory.length > 0
      ? `${SYSTEM_PROMPT}\n\nПопередній діалог. Використовуй його як контекст і не повторюй дослівно, якщо це не потрібно:\n${formatConversationHistory(conversationHistory)}`
      : SYSTEM_PROMPT;

    // Upload file to OpenAI Files API if provided
    let fileId: string | undefined;
    if (fileUpload) {
      const uploadResult = await this.uploadFile(fileUpload.bytes, fileUpload.filename, fileUpload.mimeType, apiKey);
      if (!uploadResult.ok) {
        return this.errorResponse(uploadResult.error ?? "Помилка завантаження файлу");
      }
      fileId = uploadResult.fileId;
    }

    const userContent: ResponsesInputUser["content"] = fileId
      ? [
          { type: "input_text", text: userMessage },
          { type: "input_file", file_id: fileId },
        ]
      : userMessage;

    let input: ResponsesInputItem[] = [{ role: "user", content: userContent }];
    let previousResponseId: string | undefined;
    const routeDecision = await this.routeModels(userMessage, apiKey, routerModel);
    const contextSelection = this.assembleContextModels(routeDecision, userMessage);
    const selectedModels = contextSelection.models;
    const selectedTools = selectedModels.flatMap((model) => this.toolsByModel[model] ?? []);

    let lastText = "";
    const allUiActions: AgentUiAction[] = [];
    const traceLines: string[] = [];
    traceLines.push(
      `🧭 Router (${routerModel}): primary=${routeDecision.primaryModel ?? "n/a"}, candidates=${routeDecision.candidates.map((c) => `${c.model}:${c.score.toFixed(2)}`).join(", ") || "n/a"}, confidence=${contextSelection.confidence.toFixed(2)}, strategy=${contextSelection.strategy}, reason=${routeDecision.reason ?? "n/a"}`,
    );
    traceLines.push(`🧰 Контекст моделей: ${selectedModels.join(", ")} (tools: ${selectedTools.length})`);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const body: Record<string, unknown> = {
        model: executorModel,
        instructions,
        tools: selectedTools,
        input,
      };
      if (previousResponseId) {
        body.previous_response_id = previousResponseId;
      }

      const res = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return this.errorResponse(`OpenAI API помилка ${res.status}: ${errText}`);
      }

      const data = await res.json() as ResponsesApiResponse;

      if (data.usage) {
        totalInputTokens += data.usage.input_tokens;
        totalOutputTokens += data.usage.output_tokens;
      }

      previousResponseId = data.id;

      const functionCalls = data.output.filter(
        (item): item is ResponsesOutputFunctionCall => item.type === "function_call",
      );
      const messageItem = data.output.find(
        (item): item is ResponsesOutputMessage => item.type === "message",
      );

      if (messageItem) {
        const textContent = messageItem.content.find(
          (c): c is { type: "output_text"; text: string } => c.type === "output_text",
        );
        lastText = textContent?.text ?? "Готово";
      }

      if (functionCalls.length === 0) {
        break;
      }

      // Execute tool calls and prepare next input with results
      input = [];
      for (const call of functionCalls) {
        const toolResult = await this.executeToolCall(call, userId, allUiActions);
        const resultOk = (toolResult as Record<string, unknown>)?.ok !== false && !(toolResult as Record<string, unknown>)?.error;
        const status = resultOk ? "✅" : "❌";
        const argsPreview = this.previewArgs(call.arguments);
        traceLines.push(`${status} ${call.name}(${argsPreview})`);
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(toolResult),
        });
      }
    }

    const tokenSummary = totalInputTokens + totalOutputTokens > 0
      ? `Токени: ${totalInputTokens + totalOutputTokens} (input: ${totalInputTokens}, output: ${totalOutputTokens})`
      : "";

    const messages: string[] = [];
    if (traceLines.length > 0) {
      messages.push(traceLines.join("\n"));
    }
    messages.push(lastText);
    if (tokenSummary) messages.push(tokenSummary);

    const nextSessionMessages = [...conversationHistory, { role: "user", content: userMessage } as const];
    if (lastText) {
      nextSessionMessages.push({ role: "assistant", content: lastText });
    }
    this.conversationSessions.set(sessionKey, {
      messages: nextSessionMessages.slice(-MAX_CONVERSATION_MESSAGES),
      updatedAt: Date.now(),
    });

    return {
      ok: true,
      result: { threadId: effectiveThreadId },
      uiActions: allUiActions,
      messages,
    };
  }

  private groupToolsByModel(tools: ResponsesTool[]): Record<string, ResponsesTool[]> {
    const grouped: Record<string, ResponsesTool[]> = {};
    for (const tool of tools) {
      const sep = tool.name.indexOf("__");
      if (sep === -1) continue;
      const model = tool.name.slice(0, sep);
      if (!grouped[model]) grouped[model] = [];
      grouped[model].push(tool);
    }
    return grouped;
  }

  private buildModelCatalog(): ModelCatalogItem[] {
    const catalog: ModelCatalogItem[] = [];
    for (const model of this.availableModels) {
      const route = agentModelRoutes[model];
      const routePath = (route?.editPath ?? route?.listPath ?? "")
        .replace(/\/(edit|list|view)$/, "")
        .replace(/^\//, "");
      const commands = (this.toolsByModel[model] ?? [])
        .map((tool) => tool.name.slice(model.length + 2))
        .sort();
      catalog.push({
        model,
        type: route?.type ?? "unknown",
        routePath,
        commands,
      });
    }
    return catalog.sort((a, b) => a.model.localeCompare(b.model));
  }

  private async routeModels(userMessage: string, apiKey: string, routerModel: string): Promise<RouterDecision> {
    const catalogLines = this.modelCatalog
      .map((item) => `${item.model} | type=${item.type} | path=${item.routePath || "n/a"} | commands=${item.commands.join(",")}`)
      .join("\n");

    const routingInstructions = [
      "Ти класифікатор наміру для бухгалтерської системи.",
      "Вибери найбільш релевантні моделі для запиту користувача.",
      "Поверни ЛИШЕ валідний JSON: {\"primaryModel\":\"...\",\"candidates\":[{\"model\":\"...\",\"score\":0.0}],\"reason\":\"...\"}",
      `Обмеження: максимум ${MAX_ROUTER_CANDIDATES} candidates, score від 0 до 1.`,
      "Не вигадуй моделі поза списком.",
      "Якщо впевненість низька — все одно поверни найближчі кандидати.",
      "Список моделей:",
      catalogLines,
    ].join("\n");

    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: routerModel,
        instructions: routingInstructions,
        input: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      return {
        candidates: this.fallbackSelectModels(userMessage)
          .slice(0, MAX_ROUTER_CANDIDATES)
          .map((model, idx) => ({ model, score: 0.6 - idx * 0.1 })),
        reason: `router_http_${res.status}`,
      };
    }

    const data = await res.json() as ResponsesApiResponse;
    const rawText = this.extractOutputText(data);
    const parsed = this.safeParseRouterDecision(rawText);
    if (!parsed) {
      return {
        candidates: this.fallbackSelectModels(userMessage)
          .slice(0, MAX_ROUTER_CANDIDATES)
          .map((model, idx) => ({ model, score: 0.6 - idx * 0.1 })),
        reason: "router_parse_fallback",
      };
    }

    const validModels = new Set(this.availableModels);
    const candidates = (parsed.candidates ?? [])
      .filter((c) => validModels.has(c.model))
      .slice(0, MAX_ROUTER_CANDIDATES)
      .map((c) => ({
        model: c.model,
        score: Number.isFinite(c.score) ? Math.max(0, Math.min(1, c.score)) : 0.5,
      }));

    const primaryModel = parsed.primaryModel && validModels.has(parsed.primaryModel)
      ? parsed.primaryModel
      : candidates[0]?.model;

    if (candidates.length === 0) {
      return {
        primaryModel,
        candidates: this.fallbackSelectModels(userMessage)
          .slice(0, MAX_ROUTER_CANDIDATES)
          .map((model, idx) => ({ model, score: 0.6 - idx * 0.1 })),
        reason: "router_empty_fallback",
      };
    }

    return {
      primaryModel,
      candidates,
      reason: parsed.reason,
    };
  }

  private assembleContextModels(routeDecision: RouterDecision, userMessage: string): ContextSelection {
    const sortedCandidates = [...routeDecision.candidates].sort((a, b) => b.score - a.score);
    const selected = new Set<string>();
    let strategy = "fallback_heuristic";
    let confidence = sortedCandidates[0]?.score ?? 0;

    const primaryCandidate = routeDecision.primaryModel
      ? sortedCandidates.find((c) => c.model === routeDecision.primaryModel)
      : undefined;
    if (primaryCandidate) {
      confidence = primaryCandidate.score;
    }

    if (confidence >= ROUTER_HIGH_CONFIDENCE) {
      strategy = "high_confidence_primary";
      const primary = routeDecision.primaryModel ?? sortedCandidates[0]?.model;
      if (primary && this.availableModels.includes(primary)) {
        selected.add(primary);
      }
    } else if (sortedCandidates.length > 0 && confidence >= ROUTER_LOW_CONFIDENCE) {
      strategy = "medium_confidence_top2";
      for (const candidate of sortedCandidates.slice(0, 2)) {
        if (this.availableModels.includes(candidate.model)) {
          selected.add(candidate.model);
        }
      }
    } else if (sortedCandidates.length > 0) {
      strategy = "low_confidence_top3_plus_fallback";
      for (const candidate of sortedCandidates.slice(0, MAX_ROUTER_CANDIDATES)) {
        if (this.availableModels.includes(candidate.model)) {
          selected.add(candidate.model);
        }
      }

      const fallback = this.fallbackSelectModels(userMessage);
      for (const model of fallback) {
        selected.add(model);
        if (selected.size >= MAX_ROUTER_CANDIDATES + 1) break;
      }
    }

    const needsDocumentSupport = [...selected].some((model) => {
      const route = agentModelRoutes[model];
      return route?.type === "document";
    });
    if (needsDocumentSupport) {
      for (const model of this.documentSupportModels) {
        if (this.availableModels.includes(model)) {
          selected.add(model);
        }
      }
    }

    if (selected.size === 0) {
      for (const model of this.fallbackSelectModels(userMessage)) {
        selected.add(model);
      }
    }

    return {
      models: [...selected].slice(0, MAX_MODELS_IN_TOOL_CONTEXT),
      strategy,
      confidence,
    };
  }

  private fallbackSelectModels(userMessage: string): string[] {
    const text = userMessage.toLowerCase();
    const scored = new Map<string, number>();

    for (const model of this.availableModels) {
      let score = 0;
      const modelWords = model.split("_");
      for (const w of modelWords) {
        if (w.length >= 3 && text.includes(w)) score += 3;
      }

      const route = agentModelRoutes[model];
      const routePath = (route?.editPath ?? route?.listPath ?? "").toLowerCase();
      const routeWords = routePath.split(/[\/_-]/).filter((w) => w.length >= 3);
      for (const w of routeWords) {
        if (text.includes(w)) score += 2;
      }

      const aliases = this.modelAliases[model] ?? [];
      for (const alias of aliases) {
        if (text.includes(alias.toLowerCase())) score += 5;
      }

      if (score > 0) scored.set(model, score);
    }

    if (scored.size > 0) {
      return [...scored.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_MODELS_IN_TOOL_CONTEXT)
        .map(([model]) => model);
    }

    const fallback = this.defaultModelPriority
      .filter((m) => this.availableModels.includes(m))
      .slice(0, MAX_MODELS_IN_TOOL_CONTEXT);

    if (fallback.length > 0) return fallback;
    return this.availableModels.slice(0, MAX_MODELS_IN_TOOL_CONTEXT);
  }

  private extractOutputText(data: ResponsesApiResponse): string {
    const messageItem = data.output.find(
      (item): item is ResponsesOutputMessage => item.type === "message",
    );
    if (!messageItem) return "";
    const textParts = messageItem.content
      .filter((c): c is { type: "output_text"; text: string } => c.type === "output_text")
      .map((c) => c.text);
    return textParts.join("\n").trim();
  }

  private safeParseRouterDecision(rawText: string): RouterDecision | null {
    if (!rawText) return null;

    const direct = this.tryParseJson(rawText);
    if (direct) return direct;

    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return this.tryParseJson(rawText.slice(start, end + 1));
    }

    return null;
  }

  private tryParseJson(text: string): RouterDecision | null {
    try {
      const parsed = JSON.parse(text) as RouterDecision;
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.candidates)) parsed.candidates = [];
      return parsed;
    } catch {
      return null;
    }
  }

  private async executeToolCall(
    call: ResponsesOutputFunctionCall,
    userId: string,
    uiActions: AgentUiAction[],
  ): Promise<unknown> {
    const { name, arguments: argsStr } = call;
    const sep = name.indexOf("__");
    if (sep === -1) {
      return { error: `Невідомий інструмент: ${name}` };
    }

    const model = name.slice(0, sep);
    const command = name.slice(sep + 2);

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      args = {};
    }

    // Build payload based on command
    let payload: Record<string, unknown>;
    if (command === "get") {
      payload = args.id ? { id: String(args.id) } : {};
    } else if (command === "lookup") {
      payload = {
        fragment: args.fragment ?? args.query ?? args.search,
        ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
      };
    } else if (command === "nextCode") {
      payload = { model, tableName: model, schemaName: "app" };
    } else if (command === "save") {
      payload = { item: args.item ?? {}, ...(args.rows ? { rows: args.rows } : {}) };
    } else if (command === "post" || command === "unpost") {
      payload = { id: args.id };
    } else {
      payload = args;
    }

    let result: unknown;
    try {
      result = await this.modelRuntime.execute(model, command, payload, userId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }

    // Collect UI action for successful mutations
    if (command === "save" || command === "post") {
      const envelope = result as Record<string, unknown>;
      if (envelope?.ok) {
        const item = (envelope.data as Record<string, unknown>)?.item as Record<string, unknown> | undefined;
        const id = item?.id != null ? String(item.id) : undefined;
        const routes = agentModelRoutes[model];
        if (id && routes?.editPath) {
          uiActions.push({ type: "openRoute", route: `${routes.editPath}?id=${id}`, model, id });
        }
      }
    }

    return result;
  }

  private previewArgs(argsStr: string): string {
    try {
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      const parts: string[] = [];
      if (args.id) parts.push(`id:${args.id}`);
      if (args.query) parts.push(`query:"${args.query}"`);
      if (args.item && typeof args.item === "object") {
        const itemKeys = Object.keys(args.item as object);
        parts.push(`item:{${itemKeys.slice(0, 3).join(",")}${itemKeys.length > 3 ? ",…" : ""}}`);
      }
      return parts.join(" ") || "{}";
    } catch {
      return "{}";
    }
  }

  private async uploadFile(
    bytes: Uint8Array,
    filename: string,
    mimeType: string,
    apiKey: string,
  ): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
    const formData = new FormData();
    formData.append("purpose", "user_data");
    formData.append("file", new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), filename);

    const res = await fetch(OPENAI_FILES_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `OpenAI Files API помилка ${res.status}: ${errText}` };
    }

    const data = await res.json() as { id: string };
    return { ok: true, fileId: data.id };
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionKey, session] of this.conversationSessions.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.conversationSessions.delete(sessionKey);
      }
    }
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
