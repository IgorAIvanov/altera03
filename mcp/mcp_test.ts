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

interface FakeAltera {
  url: string;
  /** Заголовки авторизації, які прийшли: доказ, що токен їде саме так. */
  authorizations: string[];
  paths: string[];
  close(): Promise<void>;
}

/** Підроблена база: віддає заготовлені конверти й запам'ятовує, чим її кликали. */
function fakeAltera(rows: unknown[], callEnvelope: unknown): FakeAltera {
  const authorizations: string[] = [];
  const paths: string[] = [];
  const controller = new AbortController();

  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    (request) => {
      const url = new URL(request.url);
      authorizations.push(request.headers.get("authorization") ?? "");
      paths.push(url.pathname + url.search);

      const body = url.pathname === "/api/agent/call"
        ? callEnvelope
        : { ok: true, data: { rows, totals: { count: rows.length } }, messages: [] };

      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  );

  return {
    url: `http://localhost:${(server.addr as Deno.NetAddr).port}`,
    authorizations,
    paths,
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
      args: ["run", "--allow-net", "--allow-env", "--allow-read", MAIN],
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

    // Три інструменти, а не дзеркало команд: опис лежить у контексті завжди,
    // тож його розмір і є ціна рішення.
    const list = await probe.request("tools/list");
    const tools = (list.result as { tools: Array<Record<string, unknown>> }).tools;
    assertEquals(tools.map((tool) => tool.name).sort(), [
      "altera_call",
      "altera_describe",
      "altera_models",
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
    const rows = JSON.parse(toolResult(catalog).text) as Array<{ model: string }>;
    assertEquals(rows[0].model, "bank");

    // Токен їде заголовком і лише ним: у командний рядок він не потрапляє
    // ніколи (аргументи видно в списку процесів).
    assertEquals(altera.authorizations[0], `Bearer ${TOKEN}`);

    const describe = await probe.request("tools/call", {
      name: "altera_describe",
      arguments: { models: ["bank", "counterparty"], command: "save" },
    });
    assertEquals(toolResult(describe).isError, false);
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
