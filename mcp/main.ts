/**
 * MCP-сервер над HTTP-API Altera: шість інструментів замість дзеркала команд.
 *
 * ЧОМУ ШІСТЬ, А НЕ ШІСТДЕСЯТ П'ЯТЬ (D9). Дзеркало — по MCP-інструменту на кожну
 * команду кожної моделі — виглядало б нативніше, але опис інструментів у MCP
 * лежить у контексті ЗАВЖДИ, з першого повідомлення. Двадцять моделей це 26 КБ
 * схем, сотня — під 200 КБ у кожній розмові, ще до першого питання людини. Тут
 * агент бачить шість інструментів і бере схему тоді, коли справді збирається
 * викликати: `altera_models` → `altera_describe` → `altera_call`.
 *
 * Решта три — не виняток із цього правила, а наслідок іншого. Каналів у базі
 * два: команди возять JSON, байти ходять власним каналом (`/api/blob`), бо
 * картинка потрібна браузеру звичайним GET-URL без заголовка авторизації.
 * Канал байтів ДВОСТОРОННІЙ, і кожен напрямок — свій інструмент: `altera_attach`
 * кладе файл у базу, `altera_fetch` забирає з неї вкладення, `altera_print`
 * забирає те, чого в базі ще немає, — друковану форму, яку сервер малює на
 * вимогу. Тобто інструменти ростуть від НАПРЯМКІВ каналів, а не від моделей:
 * скільки б команд не додали, цих напрямків лишиться три.
 *
 * БАЙТИ НЕ ПОТРАПЛЯЮТЬ У КОНТЕКСТ АГЕНТА — В ОБИДВА БОКИ. Вхідний файл
 * називається шляхом, вихідний лягає на диск і теж віддається шляхом:
 * накладна на 420 КБ у base64 — це 560 КБ у розмові, за які платять щоразу,
 * коли до неї повертаються. Виняток один і навмисний — мініатюра зображення
 * (~10 КБ), бо шлях каже, ДЕ файл, і не каже, ЩО це (див. preview.ts).
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
import { type AlteraAttachment, AlteraClient, AlteraError, configFromEnv } from "./altera-client.ts";
import { saveDownload } from "./file-sink.ts";
import { imagePreview } from "./preview.ts";

/** Тримати в парі з `version` у deno.json — її видно хосту при `initialize`. */
const VERSION = "0.3.0";

/**
 * Блок відповіді MCP. Крім тексту буває `image` — ним їде мініатюра вкладення;
 * решта файлів описується самим лише текстом (шлях, ім'я, розмір).
 */
type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

interface ToolResult {
  content: ToolContent[];
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
  {
    name: "altera_fetch",
    description:
      "Забрати з бази файли, прикріплені до запису: скани, фото, підписані оригінали. " +
      "Або всі вкладення запису (model + id), або одне за його ідентифікатором (attachment). " +
      "Файли лягають у каталог, заданий у налаштуваннях обгортки; у відповідь ідуть ШЛЯХИ, " +
      "а не вміст. Зображення додатково показуються мініатюрою. Щоб лише подивитися перелік " +
      "вкладень без завантаження, є звичайна команда: altera_call attachment list.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Модель-власник: invoice, counterparty…" },
        id: { type: "string", description: "id запису-власника" },
        attachment: {
          type: "string",
          description: "id одного вкладення — замість пари model+id",
        },
        preview: {
          type: "boolean",
          description: "Мініатюри зображень. Умовчання — так",
        },
      },
    },
    annotations: { title: "Забрати файли", readOnlyHint: true },
  },
  {
    name: "altera_print",
    description:
      "Друкована форма запису в PDF: накладна, акт, рахунок — той самий бланк, який дає " +
      "кнопка друку в застосунку. Файл лягає в каталог, заданий у налаштуваннях обгортки, " +
      "і у відповідь іде ШЛЯХ до нього. Без templateCode береться активний шаблон моделі. " +
      "Друкується лише те, що вже збережене: спершу altera_call save, потім print.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Модель запису: invoice…" },
        id: { type: "string", description: "id запису, який друкуємо" },
        templateCode: {
          type: "string",
          description: "Код шаблону друку. Без нього — активний шаблон моделі",
        },
      },
      required: ["model", "id"],
    },
    annotations: { title: "Друкована форма", readOnlyHint: true },
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
    // Дві різні відмови, і ліки в них різні: `NotCapable` — обгортці не видано
    // `--allow-read` (правиться в конфізі хоста), `PermissionDenied` — права
    // самої ОС на файл. Deno 2 розвів їх на окремі класи; доти тут стояв лише
    // другий, і найчастіший випадок — забутий дозвіл — доїжджав до агента
    // сирим текстом системного виклику.
    if (error instanceof Deno.errors.NotCapable) {
      throw new AlteraError(
        `Обгортці не дозволено читати диск. Додай --allow-read в args запису MCP-хоста ` +
          `(або --allow-read=${path.split(/[\\/]/).slice(0, -1).join("/") || "/"}) і перезапусти його.`,
      );
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new AlteraError(
        `Операційна система не дає прочитати ${path}: перевір права на файл.`,
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

/**
 * Скільки мініатюр іде в одну відповідь.
 *
 * Обмеження не технічне: у записі буває десяток сканів, і десять картинок у
 * контексті — це вже не підказка «що це», а той самий мегабайт, від якого
 * рятує вивантаження на диск. Перші чотири відповідають на питання, решта
 * лежить на диску й читається за потреби.
 */
const PREVIEW_LIMIT = 4;

/**
 * Каталог вивантаження — або відмова з тим, що дописати в конфіг.
 *
 * Питається до першого запиту в базу: рахувати бланк, щоб потім не мати куди
 * його покласти, — марна робота, а для великого документа ще й повільна.
 */
function requireDownloadDir(client: AlteraClient): string {
  const dir = client.downloadDir;
  if (!dir) {
    throw new AlteraError(
      `ALTERA_DOWNLOAD_DIR не задано — обгортці нема куди покласти файл. Це налаштування ` +
        `MCP-хоста, а не аргумент виклику: додай у запис обгортки env ALTERA_DOWNLOAD_DIR ` +
        `(наприклад "C:/altera-files") і дозвіл --allow-write на той самий каталог, ` +
        `потім перезапусти хост.`,
    );
  }
  return dir;
}

/**
 * Забрати вкладення на диск і описати їх агенту.
 *
 * Два входи в одному інструменті — за id вкладення й за парою «модель + запис»
 * — бо це те саме питання з різних боків: у першому випадку агент уже знає id
 * (побачив у `attachment list`), у другому має лише документ. Розводити це на
 * два інструменти означало б, що агент мусить знати про існування моделі
 * `attachment` навіть тоді, коли йому потрібні просто «файли накладної».
 */
async function fetchAttachments(
  client: AlteraClient,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const dir = requireDownloadDir(client);
  const single = typeof args.attachment === "string" ? args.attachment.trim() : "";

  const wanted: AlteraAttachment[] = single
    ? [await client.attachment(single)]
    : await client.attachments(
      requiredString(args.model, "model"),
      requiredString(args.id, "id"),
    );

  if (wanted.length === 0) {
    // Не помилка: у запису просто немає файлів. Сказати це прямо дешевше, ніж
    // дати агенту тлумачити порожній список.
    return text({ files: [], note: "До цього запису не прикріплено жодного файлу." });
  }

  const withPreview = args.preview !== false;
  const files: Array<Record<string, unknown>> = [];
  const previews: ToolContent[] = [];

  for (const attachment of wanted) {
    const bytes = await client.blob(attachment);
    const saved = await saveDownload(dir, attachment.name, bytes, `attachment-${attachment.id}`);

    const preview = withPreview && previews.length < PREVIEW_LIMIT
      ? await imagePreview(bytes, attachment.mime)
      : null;
    if (preview) previews.push({ type: "image", ...preview });

    files.push({
      attachment: attachment.id,
      path: saved.path,
      name: saved.name,
      mime: attachment.mime,
      size: saved.size,
      // Позначка потрібна, щоб агент зіставив картинки з рядками: блоки йдуть
      // у тому самому порядку, що й помічені файли.
      preview: preview ? "нижче" : undefined,
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ files }) }, ...previews],
  };
}

/** Друкована форма на диск: PDF малює сервер, обгортка лише кладе його у файл. */
async function printToDisk(
  client: AlteraClient,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const dir = requireDownloadDir(client);
  const model = requiredString(args.model, "model");
  const id = requiredString(args.id, "id");
  const templateCode = typeof args.templateCode === "string" && args.templateCode.trim()
    ? args.templateCode.trim()
    : undefined;

  const printout = await client.print(model, id, templateCode);
  const saved = await saveDownload(dir, printout.fileName, printout.bytes, `${model}-${id}.pdf`);

  return text({
    model,
    id,
    path: saved.path,
    name: saved.name,
    mime: "application/pdf",
    size: saved.size,
    templateCode: printout.templateCode,
    templateName: printout.templateName,
  });
}

/**
 * Відповідь команди без вбудованих байтів.
 *
 * `printPdf` можна покликати й через `altera_call` — він оголошений моделі як
 * звичайна команда, — і тоді ста́ла б у контекст уся друкована форма в base64:
 * сотня-друга кілобайтів, які агент навіть не може ні відкрити, ні зберегти.
 * Тому байти звідси зрізаються, а на їхньому місці лишається вказівка на
 * інструмент, який зробить те, чого агент насправді хотів.
 */
function withoutInlineBytes(answer: unknown): unknown {
  const extra = (answer as { result?: { data?: { extra?: Record<string, unknown> } } })
    ?.result?.data?.extra;

  if (extra && typeof extra.pdfBase64 === "string") {
    extra.pdfBase64 = "⟨PDF вирізано: щоб отримати файл, поклич altera_print⟩";
  }
  return answer;
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
          return text(withoutInlineBytes(await client.call(
            requiredString(args.model, "model"),
            requiredString(args.command, "command"),
            (args.payload ?? {}) as Record<string, unknown>,
          )));

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

        case "altera_fetch":
          return await fetchAttachments(client, args);

        case "altera_print":
          return await printToDisk(client, args);

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
