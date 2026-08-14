/**
 * MCP-сервер над HTTP-API Altera: три інструменти замість дзеркала команд.
 *
 * ЧОМУ ТРИ, А НЕ ШІСТДЕСЯТ П'ЯТЬ (D9). Дзеркало — по MCP-інструменту на кожну
 * команду кожної моделі — виглядало б нативніше, але опис інструментів у MCP
 * лежить у контексті ЗАВЖДИ, з першого повідомлення. Двадцять моделей це 26 КБ
 * схем, сотня — під 200 КБ у кожній розмові, ще до першого питання людини. Тут
 * агент бачить три інструменти й бере схему тоді, коли справді збирається
 * викликати: `altera_models` → `altera_describe` → `altera_call`.
 *
 * СТДАУТ НАЛЕЖИТЬ ПРОТОКОЛУ. Транспорт stdio — це JSON-RPC у стандартному
 * виводі, тож будь-який `console.log` ламає потік повідомлень. Усе, що треба
 * сказати людині, йде в stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AlteraClient, AlteraError, configFromEnv } from "./altera-client.ts";

/** Тримати в парі з `version` у deno.json — її видно хосту при `initialize`. */
const VERSION = "0.1.0";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Описи інструментів — те, що агент читає замість документації.
 *
 * `annotations` не косметика: хост показує їх людині у вікні підтвердження, і
 * різниця «читає» проти «змінює дані» там вирішує, чи натиснуть «дозволити».
 */
const TOOLS = [
  {
    name: "altera_models",
    description:
      "Каталог моделей облікової бази: імена, назви людською мовою, синоніми та перелік " +
      "доступних команд. Без схем — з цього починають, щоб зрозуміти, що в базі є. " +
      "Перелік уже звужений правами користувача, якому належить токен.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Каталог моделей", readOnlyHint: true },
  },
  {
    name: "altera_describe",
    description:
      "Схеми payload-ів команд названих моделей (JSON Schema). Кілька моделей одним " +
      "викликом — так дешевше, ніж по одній. Викликати перед altera_call, якщо склад " +
      "полів невідомий: вгадувати поля не треба, вони описані точно.",
    inputSchema: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: { type: "string" },
          description: "Імена моделей із altera_models, напр. [\"bank\", \"invoice\"]",
        },
        command: {
          type: "string",
          description: "Лише одна команда замість усіх (`list`, `save`, `index`…)",
        },
      },
      required: ["models"],
    },
    annotations: { title: "Схеми команд", readOnlyHint: true },
  },
  {
    name: "altera_call",
    description:
      "Виконати команду моделі від імені власника токена. Стандартні команди: list, get, " +
      "save, delete, lookup; документи додатково post/unpost; звіти — index. " +
      "Команди, що змінюють стан (delete, undelete, post, unpost), вимагають \"confirm\": true " +
      "у payload. У відповіді є `route` — посилання на вкладку застосунку, яке можна дати людині.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Ім'я моделі з altera_models" },
        command: { type: "string", description: "Команда моделі" },
        payload: { type: "object", description: "Тіло команди за схемою з altera_describe" },
      },
      required: ["model", "command"],
    },
    annotations: { title: "Виклик команди", readOnlyHint: false, destructiveHint: true },
  },
];

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function stringList(value: unknown, field: string): string[] {
  const list = Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  if (list.length === 0) {
    throw new AlteraError(`${field}: очікується непорожній список імен моделей.`);
  }
  return list as string[];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AlteraError(`${field}: обов'язкове поле.`);
  }
  return value.trim();
}

/** Сервер із прив'язаними інструментами. Клієнт приходить аргументом — заради проб. */
export function createMcpServer(client: AlteraClient): Server {
  const server = new Server(
    { name: "altera", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  // Тип аргументу — явно: `setRequestHandler` виводить його зі zod-схеми SDK, і
  // при перевірці типів наскрізь (`deno check ./mcp`) вивід не доїжджає — виходить
  // неявний `any`, тобто перевірка мовчки перестає перевіряти найголовніше місце.
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (request.params.name) {
        case "altera_models":
          return text(await client.models());

        case "altera_describe":
          return text(await client.describe(
            stringList(args.models, "models"),
            typeof args.command === "string" ? args.command : undefined,
          ));

        case "altera_call":
          return text(await client.call(
            requiredString(args.model, "model"),
            requiredString(args.command, "command"),
            (args.payload ?? {}) as Record<string, unknown>,
          ));

        default:
          return failure(`Невідомий інструмент: ${request.params.name}`);
      }
    } catch (error) {
      // Відмова бази — це не поламка обгортки: агент має прочитати причину й
      // вирішити сам (додати `confirm`, узяти інший токен, виправити поле).
      if (error instanceof AlteraError) return failure(error.message);
      return failure(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

async function main(): Promise<void> {
  try {
    const client = new AlteraClient(configFromEnv());
    await createMcpServer(client).connect(new StdioServerTransport());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
