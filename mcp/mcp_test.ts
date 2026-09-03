/**
 * Проба обгортки — справжнім протоколом і справжнім процесом.
 *
 * Обгортка запускається підпроцесом, з нею розмовляють JSON-RPC по stdio, а базу
 * підміняє підроблена Altera на ефемерному порту. Бази й БД тут не треба:
 * перевіряється не облік, а те, чого не видно з типів, — рукостискання, склад
 * `tools/list`, передача токена, форма відповіді й поведінка на відмовах.
 *
 * Чому не «викликати функції напряму»: половина того, що тут може зламатися,
 * живе не в наших функціях. Зайвий `console.log` ламає потік повідомлень,
 * незакритий stdin вішає хост, помилка в `annotations` не видно ніде, доки хост
 * не покаже людині не те вікно. Усе це ловиться лише розмовою.
 */
import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl } from "@std/path";

const MAIN = fromFileUrl(new URL("./main.ts", import.meta.url));
const TOKEN = "probe-token";

/** Те, з чим прийшло завантаження: саме це й перевіряє проба вкладення. */
interface FakeUpload {
  fileName: string;
  mime: string;
  size: number;
  content: string;
  ownerModel: string | null;
  ownerId: string | null;
}

interface FakeAltera {
  url: string;
  /** Заголовки авторизації, які прийшли: доказ, що токен їде саме так. */
  authorizations: string[];
  paths: string[];
  uploads: FakeUpload[];
  close(): Promise<void>;
}

/** Тіло виклику команди — за ним підроблена база й вирішує, що відповісти. */
interface FakeCall {
  model: string;
  command: string;
  payload: Record<string, unknown>;
}

/** Байти, які база віддає на `GET /api/blob/:id`. Ключ — id вкладення. */
type FakeBlobs = Record<string, { bytes: Uint8Array; mime: string }>;

/**
 * Підроблена база: віддає заготовлені конверти й запам'ятовує, чим її кликали.
 *
 * `callEnvelope` буває функцією — саме тому, що вивантаження файлу це ЛАНЦЮЖОК:
 * спершу команда моделі віддає метадані з токеном, потім по токену забираються
 * байти. Одна відповідь на всі виклики перевірила б лише перший крок.
 */
/** Оголошені обмеження, які віддає підроблена база на опис моделі. */
const FAKE_RULES = {
  bank: [{ key: "bank.mfoTaken", text: "Банк із таким МФО вже заведений" }],
};

function fakeAltera(
  rows: unknown[],
  callEnvelope: unknown | ((call: FakeCall) => unknown),
  blobs: FakeBlobs = {},
): FakeAltera {
  const authorizations: string[] = [];
  const paths: string[] = [];
  const uploads: FakeUpload[] = [];
  const controller = new AbortController();

  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    async (request) => {
      const url = new URL(request.url);
      authorizations.push(request.headers.get("authorization") ?? "");
      paths.push(url.pathname + url.search);

      // Байти віддаються лише з токеном у запиті — рівно як у справжній базі:
      // право доступу несе сам URL, бо в `<img src>` заголовка не почепиш.
      const blobMatch = url.pathname.match(/^\/api\/blob\/(\d+)$/);
      if (blobMatch) {
        const blob = blobs[blobMatch[1]];
        if (!url.searchParams.get("token")) return new Response("Forbidden", { status: 403 });
        if (!blob) return new Response("Not found", { status: 404 });
        return new Response(blob.bytes as unknown as BodyInit, {
          headers: { "content-type": blob.mime },
        });
      }

      // Завантаження розбираємо по-справжньому: перевіряти треба саме те, що
      // доїхало до бази — ім'я, тип і власника, — а не те, що ми відправляли.
      if (url.pathname === "/api/blob/upload") {
        const form = await request.formData();
        const file = form.get("file") as File;
        uploads.push({
          fileName: file.name,
          mime: file.type,
          size: file.size,
          content: await file.text(),
          ownerModel: form.get("ownerModel") as string | null,
          ownerId: form.get("ownerId") as string | null,
        });

        return Response.json({
          ok: true,
          data: { item: { id: "77", name: file.name, mime: file.type, size: file.size } },
          messages: [],
        });
      }

      const body = url.pathname === "/api/agent/call"
        ? typeof callEnvelope === "function"
          ? (callEnvelope as (call: FakeCall) => unknown)(await request.json() as FakeCall)
          : callEnvelope
        : {
          ok: true,
          data: {
            rows,
            // Правила віддає лише опис названих моделей, як і справжня база:
            // у каталозі їх немає навмисно.
            ...(url.searchParams.get("model") ? { extra: { rules: FAKE_RULES } } : {}),
            totals: { count: rows.length },
          },
          messages: [],
        };

      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  return {
    url: `http://localhost:${(server.addr as Deno.NetAddr).port}`,
    authorizations,
    paths,
    uploads,
    close: async () => {
      controller.abort();
      await server.finished;
    },
  };
}

/** Клієнт MCP рівно настільки, наскільки треба пробі: рядок JSON на повідомлення. */
class McpProbe {
  private readonly process: Deno.ChildProcess;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private buffer = "";
  private nextId = 1;

  constructor(env: Record<string, string>) {
    this.process = new Deno.Command(Deno.execPath(), {
      // `--allow-write` тут повний, а не звужений до каталогу: проба щоразу
      // бере свій тимчасовий, і в реальному конфізі хоста дозвіл звужують саме
      // до ALTERA_DOWNLOAD_DIR (див. README).
      args: ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", MAIN],
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    this.writer = this.process.stdin.getWriter();
    this.reader = this.process.stdout.getReader();
  }

  async send(method: string, params?: unknown): Promise<void> {
    await this.writer.write(
      this.encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    );
  }

  async request(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    await this.writer.write(
      this.encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`),
    );

    for (;;) {
      const message = await this.message();
      // Нотифікації сервера (`notifications/*`) відповіді не є — пропускаємо.
      if (message.id === id) return message;
    }
  }

  private async message(): Promise<Record<string, unknown>> {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) return JSON.parse(line);
        continue;
      }

      const { value, done } = await this.reader.read();
      if (done) throw new Error("обгортка закрила потік, не відповівши");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async close(): Promise<void> {
    await this.writer.close().catch(() => {});
    await this.reader.cancel().catch(() => {});
    try {
      this.process.kill();
    } catch {
      // Уже завершився сам — так і має бути, коли stdin закрили.
    }
    await this.process.status;
    await this.process.stderr.cancel().catch(() => {});
  }
}

/** Рукостискання: без нього сервер не приймає жодного виклику. */
async function handshake(probe: McpProbe): Promise<Record<string, unknown>> {
  const initialized = await probe.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "altera-probe", version: "0" },
  });
  await probe.send("notifications/initialized");
  return initialized;
}

const CATALOG = [
  {
    model: "bank",
    type: "catalog",
    titles: { uk: "Банки", en: "Banks" },
    route: "/catalog/bank/list",
    commands: ["list", "get", "save", "delete", "lookup"],
  },
];

const CALL_ENVELOPE = {
  ok: true,
  result: { ok: true, model: "bank", command: "list", route: "/catalog/bank/list", messages: [] },
  messages: [],
};

function toolResult(response: Record<string, unknown>): { text: string; isError: boolean } {
  const result = response.result as {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  return { text: result?.content?.[0]?.text ?? "", isError: result?.isError === true };
}

Deno.test("обгортка: рукостискання, перелік і виклик", async () => {
  const altera = fakeAltera(CATALOG, CALL_ENVELOPE);
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    const initialized = await handshake(probe);
    const info = (initialized.result as { serverInfo?: { name?: string } }).serverInfo;
    assertEquals(info?.name, "altera");

    // Шість інструментів, а не дзеркало команд: опис лежить у контексті завжди,
    // тож його розмір і є ціна рішення. Три останні тут не тому, що моделей
    // побільшало, а тому що канал байтів двосторонній: покласти файл, забрати
    // файл, отримати намальований на вимогу бланк.
    const list = await probe.request("tools/list");
    const tools = (list.result as { tools: Array<Record<string, unknown>> }).tools;
    assertEquals(tools.map((tool) => tool.name).sort(), [
      "altera_attach",
      "altera_call",
      "altera_describe",
      "altera_fetch",
      "altera_models",
      "altera_print",
    ]);

    // Хост показує ці позначки людині у вікні підтвердження: різниця «читає»
    // проти «змінює дані» там вирішує, чи натиснуть «дозволити».
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const models = byName.get("altera_models") as { annotations: Record<string, unknown> };
    const call = byName.get("altera_call") as { annotations: Record<string, unknown> };
    assertEquals(models.annotations.readOnlyHint, true);
    assertEquals(call.annotations.destructiveHint, true);

    const catalog = await probe.request("tools/call", {
      name: "altera_models",
      arguments: {},
    });
    // Каталог їде разом із власним розміром: `shown` проти `total` — це те, що
    // дає агенту зрозуміти, чи бачить він базу цілком, чи вже звужену вибірку.
    const answer = JSON.parse(toolResult(catalog).text) as {
      total: number;
      shown: number;
      models: Array<{ model: string }>;
    };
    assertEquals(answer.models[0].model, "bank");
    assertEquals([answer.total, answer.shown], [1, 1]);

    // Токен їде заголовком і лише ним: у командний рядок він не потрапляє
    // ніколи (аргументи видно в списку процесів).
    assertEquals(altera.authorizations[0], `Bearer ${TOKEN}`);

    const describe = await probe.request("tools/call", {
      name: "altera_describe",
      arguments: { models: ["bank", "counterparty"], command: "save" },
    });
    assertEquals(toolResult(describe).isError, false);
    // Схема каже, які є ПОЛЯ, і мовчить про поведінку. Правила їдуть разом із
    // нею — інакше «поле є» від «поведінка є» через MCP не відрізнити нічим, і
    // агент упевнено радить те, що застосунок відіб'є.
    const described = JSON.parse(toolResult(describe).text) as {
      tools: unknown[];
      rules: Record<string, Array<{ key: string; text: string }>>;
    };
    assertEquals(described.tools.length > 0, true);
    assertEquals(described.rules.bank[0].text, "Банк із таким МФО вже заведений");
    // Кілька моделей — одним запитом, а не трьома обертами.
    assertEquals(
      altera.paths.at(-1),
      "/api/agent/tools?model=bank%2Ccounterparty&command=save",
    );

    const executed = await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "bank", command: "list", payload: {} },
    });
    // Посилання на вкладку доходить до агента — саме його він і дає людині.
    assertEquals(toolResult(executed).text.includes("/catalog/bank/list"), true);
    assertEquals(altera.paths.at(-1), "/api/agent/call");
  } finally {
    await probe.close();
    await altera.close();
  }
});

Deno.test("обгортка: старіша база названа прямо, а не порожнім переліком", async () => {
  // Те, що віддавав сервер до 0.19.0: плаский перелік схем без каталогу.
  const altera = fakeAltera([{ model: "bank", command: "save", input: { type: "object" } }], {});
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);
    const catalog = await probe.request("tools/call", {
      name: "altera_models",
      arguments: {},
    });

    const { text, isError } = toolResult(catalog);
    assertEquals(isError, true);
    assertEquals(text.includes("0.19.0"), true);
  } finally {
    await probe.close();
    await altera.close();
  }
});

Deno.test("обгортка: вкладення їде шляхом, а власник — разом із ним", async () => {
  const altera = fakeAltera(CATALOG, CALL_ENVELOPE);
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });
  const directory = await Deno.makeTempDir();
  const path = `${directory}/накладна.pdf`;
  await Deno.writeTextFile(path, "%PDF-1.4 проба");

  try {
    await handshake(probe);

    const attached = await probe.request("tools/call", {
      name: "altera_attach",
      arguments: { path, model: "goods_receipt", id: "1032" },
    });

    assertEquals(toolResult(attached).isError, false);
    const item = (JSON.parse(toolResult(attached).text) as { data: { item: { id: string } } }).data
      .item;
    assertEquals(item.id, "77");

    // Дійшло саме те, що треба базі: байти, ім'я з ШЛЯХУ (кирилиця включно),
    // тип за розширенням і власник. Власник тут головний: без нього вкладення
    // «сирота», і його за добу прибере attachment_gc.
    assertEquals(altera.uploads.length, 1);
    const upload = altera.uploads[0];
    assertEquals(upload.fileName, "накладна.pdf");
    assertEquals(upload.mime, "application/pdf");
    assertEquals(upload.content, "%PDF-1.4 проба");
    assertEquals(upload.ownerModel, "goods_receipt");
    assertEquals(upload.ownerId, "1032");

    // Пішло туди ж, куди ходить браузер, і з тим самим токеном.
    assertEquals(altera.paths.includes("/api/blob/upload"), true);
    assertEquals(altera.authorizations.at(-1), `Bearer ${TOKEN}`);

    // Ім'я можна назвати своє — файл на диску буває названий як завгодно.
    await probe.request("tools/call", {
      name: "altera_attach",
      arguments: { path, model: "goods_receipt", id: "1032", name: "scan.png" },
    });
    assertEquals(altera.uploads.at(-1)?.fileName, "scan.png");
    assertEquals(altera.uploads.at(-1)?.mime, "image/png");
  } finally {
    await probe.close();
    await altera.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("обгортка: файлу немає — це помилка шляху, а не бази", async () => {
  const altera = fakeAltera(CATALOG, CALL_ENVELOPE);
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);

    const missing = await probe.request("tools/call", {
      name: "altera_attach",
      arguments: { path: "/no/such/file.pdf", model: "goods_receipt", id: "1032" },
    });

    // Різницю видно з тексту: інакше агент лікує базу замість шляху.
    const result = toolResult(missing);
    assertEquals(result.isError, true);
    assertEquals(result.text.includes("Файлу немає"), true);
    assertEquals(altera.uploads.length, 0);

    // Власник обов'язковий: інструмент, який мовчки лишає файл сиротою, гірший
    // за його відсутність.
    const noOwner = await probe.request("tools/call", {
      name: "altera_attach",
      arguments: { path: "/no/such/file.pdf", model: "goods_receipt" },
    });
    assertEquals(toolResult(noOwner).isError, true);
    assertEquals(toolResult(noOwner).text.includes("id"), true);
  } finally {
    await probe.close();
    await altera.close();
  }
});

/** Найменший коректний PNG (1×1). На ньому й перевіряється мініатюра. */
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

function blocks(response: Record<string, unknown>): ContentBlock[] {
  return (response.result as { content?: ContentBlock[] })?.content ?? [];
}

/** Конверт відповіді агента навколо звичайного конверта моделі. */
function agentEnvelope(model: string, command: string, data: Record<string, unknown>) {
  return {
    ok: true,
    result: { ok: true, model, command, messages: [], data },
    messages: [],
  };
}

Deno.test("обгортка: вкладення лягають на диск, а в контекст іде шлях", async () => {
  const scan = bytesOf(PNG_1x1);
  const act = new TextEncoder().encode("%PDF-1.4 акт");

  const altera = fakeAltera(
    CATALOG,
    (call: FakeCall) =>
      call.model === "attachment" && call.command === "list"
        ? agentEnvelope("attachment", "list", {
          rows: [
            { id: "77", name: "скан.png", mime: "image/png", size: scan.length, token: "signed-77" },
            { id: "78", name: "акт.pdf", mime: "application/pdf", size: act.length, token: "signed-78" },
          ],
        })
        : { ok: false, result: null, messages: [`несподіваний виклик ${call.model}/${call.command}`] },
    {
      "77": { bytes: scan, mime: "image/png" },
      "78": { bytes: act, mime: "application/pdf" },
    },
  );

  const directory = await Deno.makeTempDir();
  const probe = new McpProbe({
    ALTERA_URL: altera.url,
    ALTERA_TOKEN: TOKEN,
    ALTERA_DOWNLOAD_DIR: directory,
  });

  try {
    await handshake(probe);
    const fetched = await probe.request("tools/call", {
      name: "altera_fetch",
      arguments: { model: "invoice", id: "42" },
    });

    const content = blocks(fetched);
    const files = (JSON.parse(content[0].text ?? "{}") as {
      files: Array<{ name: string; path: string; size: number; preview?: string }>;
    }).files;

    assertEquals(files.map((file) => file.name), ["скан.png", "акт.pdf"]);

    // Файли справді лежать на диску — і саме ті, що віддала база.
    assertEquals(await Deno.readTextFile(files[1].path), "%PDF-1.4 акт");

    // Головне цієї проби: вміст у відповідь не поїхав. Текст несе шлях і
    // метадані, і жодного base64 у ньому немає.
    assertEquals(content[0].text?.includes("JVBER"), false);
    assertEquals(content[0].text?.includes(PNG_1x1.slice(0, 24)), false);

    // Зображення описується ще й мініатюрою: шлях каже, ДЕ файл, і не каже,
    // ЩО це. PDF мініатюри не має — рендерера в обгортці немає навмисно.
    const images = content.filter((block) => block.type === "image");
    assertEquals(images.length, 1);
    assertEquals(images[0].mimeType, "image/jpeg");
    assertEquals(files[0].preview, "нижче");
    assertEquals(files[1].preview, undefined);

    // Байти забиралися тим самим каналом, що й у браузера: токеном у запиті.
    assertEquals(altera.paths.some((path) => path.startsWith("/api/blob/77?token=signed-77")), true);
  } finally {
    await probe.close();
    await altera.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("обгортка: друкована форма стає файлом, а не base64 у розмові", async () => {
  // Вміст навмисно ASCII: він їде base64, а `btoa` кирилиці не приймає — як і
  // справжній сервер, який кодує БАЙТИ, а не рядок.
  const pdf = "%PDF-1.4 invoice";
  const printed = agentEnvelope("invoice", "printPdf", {
    extra: {
      mimeType: "application/pdf",
      pdfBase64: btoa(pdf),
      fileName: "invoice-НК-000012.pdf",
      templateCode: "invoice_default",
      templateName: "Накладна",
    },
  });

  const altera = fakeAltera(CATALOG, printed);
  const directory = await Deno.makeTempDir();
  const probe = new McpProbe({
    ALTERA_URL: altera.url,
    ALTERA_TOKEN: TOKEN,
    ALTERA_DOWNLOAD_DIR: directory,
  });

  try {
    await handshake(probe);
    const result = await probe.request("tools/call", {
      name: "altera_print",
      arguments: { model: "invoice", id: "12" },
    });

    const answer = JSON.parse(toolResult(result).text) as {
      path: string;
      name: string;
      templateName: string;
    };
    assertEquals(answer.name, "invoice-НК-000012.pdf");
    assertEquals(answer.templateName, "Накладна");
    assertEquals(await Deno.readTextFile(answer.path), pdf);
    // Заради чого все й робилося: бланк не осів у контексті.
    assertEquals(toolResult(result).text.includes(btoa(pdf)), false);

    // Той самий бланк через altera_call — байти зрізані, і сказано, чим їх узяти.
    const direct = await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "invoice", command: "printPdf", payload: { id: "12" } },
    });
    assertEquals(toolResult(direct).text.includes(btoa(pdf)), false);
    assertEquals(toolResult(direct).text.includes("altera_print"), true);

    // Друге вивантаження того самого бланка не затирає перше.
    const again = await probe.request("tools/call", {
      name: "altera_print",
      arguments: { model: "invoice", id: "12" },
    });
    assertEquals(
      (JSON.parse(toolResult(again).text) as { name: string }).name,
      "invoice-НК-000012 (2).pdf",
    );
  } finally {
    await probe.close();
    await altera.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("обгортка: без каталогу вивантаження файли не забираються взагалі", async () => {
  const altera = fakeAltera(CATALOG, CALL_ENVELOPE);
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);

    for (const call of [
      { name: "altera_fetch", arguments: { model: "invoice", id: "42" } },
      { name: "altera_print", arguments: { model: "invoice", id: "42" } },
    ]) {
      const refused = await probe.request("tools/call", call);
      const { text, isError } = toolResult(refused);
      assertEquals(isError, true);
      // Причина названа налаштуванням хоста, а не помилкою бази: інакше агент
      // піде лікувати не те, а людина не дізнається, що дописати в конфіг.
      assertEquals(text.includes("ALTERA_DOWNLOAD_DIR"), true);
      assertEquals(text.includes("--allow-write"), true);
    }

    // І в базу за цим не ходили: рахувати бланк, щоб потім не мати куди його
    // покласти, — марна робота, а на великому документі ще й повільна.
    assertEquals(altera.paths.some((path) => path === "/api/agent/call"), false);
  } finally {
    await probe.close();
    await altera.close();
  }
});

Deno.test("обгортка: відмова бази стає текстом для агента, а не поламкою", async () => {
  const altera = fakeAltera(CATALOG, {
    ok: false,
    result: null,
    messages: [{
      type: "error",
      text: "Дія «delete» міняє стан документа. Повтори виклик із \"confirm\": true",
    }],
  });
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);
    const refused = await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "bank", command: "delete", payload: { id: "1" } },
    });

    const { text, isError } = toolResult(refused);
    assertEquals(isError, true);
    // Агент має прочитати причину й виправитися сам — тому текст іде як є.
    assertEquals(text.includes("confirm"), true);
  } finally {
    await probe.close();
    await altera.close();
  }
});

Deno.test("обгортка: нерозгорнутий ${…} названо помилкою конфіга, а не токена", async () => {
  // Так виглядає запис у конфізі хоста, коли змінної в його оточенні не було.
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", MAIN],
    env: { ALTERA_URL: "http://localhost:1", ALTERA_TOKEN: "${ALTERA_TOKEN}" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await command.output();
  const message = new TextDecoder().decode(stderr);

  assertEquals(code, 1);
  // Без цього перше, що бачить людина, — 401 «токен недійсний», і шукає вона
  // відкликаний токен, а не незадану змінну.
  assertEquals(message.includes("нерозгорнутим"), true);
  assertEquals(message.includes("перезапусти хост"), true);
});

Deno.test("обгортка: без токена не стартує й каже це в stderr", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", MAIN],
    // Порожнє значення, а не відсутній ключ: `Deno.Command` ДОМІШУЄ оточення
    // батька до заданого, тож на машині, де розробник підключив обгортку до
    // свого хоста (`setx ALTERA_TOKEN …`), справжній токен просочився б сюди —
    // і крок проходив би, нічого не перевіряючи. Саме так він і зламався,
    // щойно змінна з'явилася.
    env: { ALTERA_URL: "http://localhost:1", ALTERA_TOKEN: "" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  assertEquals(code, 1);
  // Стдаут належить протоколу: діагностика туди не потрапляє навіть при падінні.
  assertEquals(new TextDecoder().decode(stdout), "");
  const message = new TextDecoder().decode(stderr);
  assertEquals(message.includes("ALTERA_TOKEN"), true);
  assertExists(message);
});

/**
 * Каталог, на якому видно різницю: три моделі, два типи, синоніми в кожної.
 *
 * Синоніми тут головні — агент приходить зі словом «накладна», а не з іменем
 * `invoice`, і саме за цим збігом фільтр і має спрацьовувати.
 */
const WIDE_CATALOG = [
  {
    model: "bank",
    type: "catalog",
    titles: { uk: "Банки", en: "Banks" },
    aliases: ["банк", "банки"],
    commands: ["list", "get", "save", "lookup"],
  },
  {
    model: "counterparty",
    type: "catalog",
    titles: { uk: "Контрагенти", en: "Counterparties" },
    aliases: ["контрагент", "постачальник"],
    commands: ["list", "get", "save", "lookup"],
  },
  {
    model: "invoice",
    type: "document",
    titles: { uk: "Видаткова накладна", en: "Invoice" },
    aliases: ["накладна"],
    commands: ["list", "get", "save", "post", "unpost"],
  },
];

interface CatalogAnswer {
  total: number;
  shown: number;
  models: Array<{ model: string }>;
  note?: string;
}

Deno.test("обгортка: каталог звужується до того, про що спитали", async () => {
  const altera = fakeAltera(WIDE_CATALOG, CALL_ENVELOPE);
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  const catalog = async (args: Record<string, unknown>): Promise<CatalogAnswer> => {
    const answer = await probe.request("tools/call", { name: "altera_models", arguments: args });
    assertEquals(toolResult(answer).isError, false);
    return JSON.parse(toolResult(answer).text) as CatalogAnswer;
  };

  try {
    await handshake(probe);

    // Слово, яким модель називають люди, а не її технічне ім'я: саме з цим
    // агент і приходить.
    const byWord = await catalog({ q: "постачальник" });
    assertEquals(byWord.models.map((row) => row.model), ["counterparty"]);
    // `total` лишається завжди — інакше один рядок у відповіді агент прочитав
    // би як «більше в базі нічого немає» і пішов би вигадувати обхід.
    assertEquals(byWord.total, 3);
    assertEquals(byWord.shown, 1);

    assertEquals((await catalog({ q: "накладна" })).models.map((row) => row.model), ["invoice"]);
    assertEquals((await catalog({ type: ["document"] })).models.map((row) => row.model), [
      "invoice",
    ]);

    // Тип рядком, а не списком: агенти пишуть і так, і так.
    assertEquals((await catalog({ type: "catalog" })).shown, 2);

    // Без фільтра — усе, як і було: звуження це можливість, а не обмеження.
    assertEquals((await catalog({})).shown, 3);

    // Порожньо — це не помилка, але й не мовчання: агент має зрозуміти, що
    // справа у слові, а не в правах чи в поламаній базі.
    const nothing = await catalog({ q: "зарплата" });
    assertEquals(nothing.shown, 0);
    assertEquals(nothing.note?.includes("не підійшла жодна"), true);

    // Фільтрує обгортка: база однаково віддає каталог цілком, іншого вона не
    // вміє. Платимо ми не за байти в мережі, а за байти в контексті.
    assertEquals(altera.paths.filter((path) => path === "/api/agent/tools").length, 6);
  } finally {
    await probe.close();
    await altera.close();
  }
});

/** Тіло `save` довідника — рівно стільки, скільки треба підробленій базі. */
function savePayload(name: string): Record<string, unknown> {
  return { item: { name } };
}

interface BatchAnswer {
  count: number;
  failed: number;
  note?: string;
  results: Array<{ index: number; ok: boolean; error?: string; answer?: unknown }>;
}

Deno.test("обгортка: пакет однотипних викликів — один оберт замість восьми", async () => {
  const altera = fakeAltera(WIDE_CATALOG, (call: FakeCall) => {
    const item = (call.payload.item ?? {}) as { name?: string };
    return item.name
      ? agentEnvelope(call.model, call.command, { item: { id: `id-${item.name}`, name: item.name } })
      : { ok: false, result: null, messages: [{ type: "error", text: "Поле «name» обов'язкове" }] };
  });
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);

    const batch = await probe.request("tools/call", {
      name: "altera_call",
      arguments: {
        model: "counterparty",
        command: "save",
        payloads: [savePayload("Альфа"), { item: {} }, savePayload("Гамма")],
      },
    });

    const answer = JSON.parse(toolResult(batch).text) as BatchAnswer;
    assertEquals(answer.count, 3);
    assertEquals(answer.failed, 1);

    // Відмова посеред пакета не спиняє решту: третій запис зроблено.
    assertEquals(answer.results.map((row) => row.ok), [true, false, true]);
    assertEquals(answer.results[1].error?.includes("name"), true);
    assertEquals(altera.paths.filter((path) => path === "/api/agent/call").length, 3);

    // ГОЛОВНЕ ЦІЄЇ ПРОБИ: часткова відмова не позначається помилкою відповіді.
    // Позначена, вона змусила б агента повторити ВЕСЬ пакет — тобто завести
    // ще два записи поверх двох уже заведених.
    assertEquals(toolResult(batch).isError, false);
    assertEquals(answer.note?.includes("ok: false"), true);

    // Обидва тіла разом — промах, а не «і те, і те»: мовчки взяти одне з них
    // означало б тихо загубити запис.
    const both = await probe.request("tools/call", {
      name: "altera_call",
      arguments: {
        model: "counterparty",
        command: "save",
        payload: savePayload("Дельта"),
        payloads: [savePayload("Омега")],
      },
    });
    assertEquals(toolResult(both).isError, true);
    assertEquals(altera.paths.filter((path) => path === "/api/agent/call").length, 3);
  } finally {
    await probe.close();
    await altera.close();
  }
});

/** Документ із табличною частиною — те саме ехо, яке `save` віддає назад. */
const SAVED_DOCUMENT = {
  id: "1032",
  number: "НК-000012",
  date: "2026-08-28",
  total: 4200,
  posted: false,
  rows: [
    { lineNumber: 1, nomenclatureName: "Корпус", quantity: 6, price: 200 },
    { lineNumber: 2, nomenclatureName: "Кришка", quantity: 6, price: 300 },
    { lineNumber: 3, nomenclatureName: "Гвинт", quantity: 24, price: 50 },
  ],
  organization: { id: "1", name: "ТОВ «Проба»" },
};

Deno.test("обгортка: ехо запису вкорочується, відповідь на питання — ні", async () => {
  const altera = fakeAltera(
    WIDE_CATALOG,
    (call: FakeCall) => agentEnvelope(call.model, call.command, { item: SAVED_DOCUMENT }),
  );
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  const itemOf = (response: Record<string, unknown>) =>
    (JSON.parse(toolResult(response).text) as {
      result: { data: { item: Record<string, unknown> } };
      note?: string;
    });

  try {
    await handshake(probe);

    const saved = itemOf(await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "invoice", command: "save", payload: { item: SAVED_DOCUMENT } },
    }));

    // Скаляри лишаються — саме за ними документ і впізнають.
    assertEquals(saved.result.data.item.number, "НК-000012");
    assertEquals(saved.result.data.item.total, 4200);
    assertEquals(saved.result.data.item.posted, false);

    // Вкладене зрізано: табличну частину агент щойно надіслав сам, і повертати
    // її йому — це платити за неї вдруге.
    assertEquals(saved.result.data.item.rows, "⟨вирізано рядків: 3⟩");
    assertEquals(saved.result.data.item.organization, "⟨вирізано вкладений об'єкт⟩");

    // Зрізане має бути назване зрізаним, інакше воно читається як відсутнє.
    assertEquals(saved.note?.includes("verbose"), true);

    const verbose = itemOf(await probe.request("tools/call", {
      name: "altera_call",
      arguments: {
        model: "invoice",
        command: "save",
        payload: { item: SAVED_DOCUMENT },
        verbose: true,
      },
    }));
    assertEquals((verbose.result.data.item.rows as unknown[]).length, 3);
    assertEquals(verbose.note, undefined);

    // А от читання не чіпається взагалі: `get` віддає те, заради чого його й
    // кликали, і вкорочувати це означало б вкорочувати саму роботу.
    const read = itemOf(await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "invoice", command: "get", payload: { id: "1032" } },
    }));
    assertEquals((read.result.data.item.rows as unknown[]).length, 3);
  } finally {
    await probe.close();
    await altera.close();
  }
});

interface RoutedAnswer {
  result: { route?: string };
}

Deno.test("обгортка: посилання доїжджає повною адресою, а не шляхом", async () => {
  // База віддає ШЛЯХ і правильно робить: свого публічного адреса вона не знає.
  // Знає його обгортка — `ALTERA_URL` у власному оточенні, — і більше ніхто:
  // оточення процесу в контекст розмови не потрапляє ніколи. Тому шлях, який
  // доїхав до агента шляхом, він і віддає людині, а клікнути там нема по чому.
  const routed = (call: FakeCall, route: string) => ({
    ok: true,
    result: { ok: true, model: call.model, command: call.command, route, messages: [] },
    messages: [],
  });
  const altera = fakeAltera(CATALOG, (call: FakeCall) =>
    // `get` тут відповідає вже абсолютним: так виглядатиме база, яка колись
    // назве адресу сама (`AUTH_PUBLIC_BASE_URL`). Її знання про себе точніше
    // за наше, і чіпати його обгортка не має права.
    call.command === "get"
      ? routed(call, "https://buh.example.com/catalog/bank/edit/5")
      : routed(call, "/catalog/bank/edit/5"));
  const probe = new McpProbe({ ALTERA_URL: altera.url, ALTERA_TOKEN: TOKEN });

  try {
    await handshake(probe);

    const saved = await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "bank", command: "save", payload: { item: { name: "Проба" } } },
    });
    const answer = JSON.parse(toolResult(saved).text) as RoutedAnswer;
    assertEquals(answer.result.route, `${altera.url}/catalog/bank/edit/5`);

    const already = JSON.parse(toolResult(await probe.request("tools/call", {
      name: "altera_call",
      arguments: { model: "bank", command: "get", payload: { id: "5" } },
    })).text) as RoutedAnswer;
    assertEquals(already.result.route, "https://buh.example.com/catalog/bank/edit/5");

    // Каталог носить посилання так само: ним агент відповідає на «де подивитися
    // банки», не викликаючи взагалі нічого.
    const catalog = JSON.parse(toolResult(await probe.request("tools/call", {
      name: "altera_models",
      arguments: {},
    })).text) as { models: Array<{ route?: string }> };
    assertEquals(catalog.models[0].route, `${altera.url}/catalog/bank/list`);
  } finally {
    await probe.close();
    await altera.close();
  }
});
