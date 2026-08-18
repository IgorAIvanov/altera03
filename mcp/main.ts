/**
 * MCP-сервер над HTTP-API Altera: чотири інструменти замість дзеркала команд.
 *
 * ЧОМУ ЧОТИРИ, А НЕ ШІСТДЕСЯТ П'ЯТЬ (D9). Дзеркало — по MCP-інструменту на кожну
 * команду кожної моделі — виглядало б нативніше, але опис інструментів у MCP
 * лежить у контексті ЗАВЖДИ, з першого повідомлення. Двадцять моделей це 26 КБ
 * схем, сотня — під 200 КБ у кожній розмові, ще до першого питання людини. Тут
 * агент бачить чотири інструменти й бере схему тоді, коли справді збирається
 * викликати: `altera_models` → `altera_describe` → `altera_call`.
 *
 * Четвертий — `altera_attach` — не виняток із цього правила, а наслідок іншого:
 * байти в Altera ходять власним каналом, не командою моделі, тож передати файл
 * через `altera_call` неможливо в принципі. Кількість інструментів росте від
 * КАНАЛІВ, а не від моделей, і каналів рівно два.
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
const VERSION = "0.2.0";

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
  {
    name: "altera_attach",
    description:
      "Прикріпити файл із диска до вже збереженого запису: скан накладної до документа, " +
      "фото до картки, підписаний оригінал до акта. Файл називається ШЛЯХОМ на цій машині " +
      "— вміст читає обгортка. Запис має існувати: спершу altera_call save, потім attach " +
      "до отриманого id. Байти не є командою моделі, тому altera_call цього не вміє.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Шлях до файлу на машині, де працює обгортка" },
        model: { type: "string", description: "Модель-власник: goods_receipt, counterparty…" },
        id: { type: "string", description: "id запису-власника, отриманий від altera_call" },
        name: {
          type: "string",
          description: "Ім'я файлу в базі. Без нього — ім'я з шляху",
        },
      },
      required: ["path", "model", "id"],
    },
    annotations: { title: "Прикріпити файл", readOnlyHint: false },
  },
];

/**
 * Тип за розширенням — рівно стільки, скільки треба бланкам і сканам.
 *
 * Не бібліотека й не повна таблиця IANA: усе незнайоме їде
 * `application/octet-stream`, і це чесно — база все одно віддає такий файл
 * вкладенням, а не показує в сторінці.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  xml: "application/xml",
  json: "application/json",
  zip: "application/zip",
  p7s: "application/pkcs7-signature",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "file";
}

function mimeOf(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Прочитати файл, назвавши причину людською мовою.
 *
 * Deno кидає `NotFound` і `PermissionDenied` текстом про системний виклик; агент
 * із нього робить висновок «база не працює» й починає лікувати не те. Різниця
 * важлива: шлях виправляє агент сам, а от `--allow-read` у конфізі хоста —
 * тільки людина.
 */
async function readFileForUpload(path: string): Promise<Uint8Array> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new AlteraError(`Файлу немає: ${path}`);
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new AlteraError(
        `Немає дозволу прочитати ${path}. Обгортку запускають із --allow-read; ` +
          `перевір конфіг MCP-хоста.`,
      );
    }
    throw new AlteraError(
      `Не вдалося прочитати ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

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

        case "altera_attach": {
          // Аргументи звіряються ДО читання файлу: інакше неповний виклик
          // спершу підняв би з диска сотні мегабайтів, щоб потім відмовити на
          // порожньому `id`, — і сказав би при цьому не про `id`, а про шлях.
          const path = requiredString(args.path, "path");
          const ownerModel = requiredString(args.model, "model");
          const ownerId = requiredString(args.id, "id");
          const name = typeof args.name === "string" && args.name.trim()
            ? args.name.trim()
            : baseName(path);

          return text(await client.attach(
            await readFileForUpload(path),
            name,
            mimeOf(name),
            ownerModel,
            ownerId,
          ));
        }

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
