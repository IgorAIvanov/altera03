/**
 * HTTP-клієнт до однієї бази Altera.
 *
 * ОДНА БАЗА НА ПРОЦЕС (D11). Користувач один, а баз у нього багато — своя,
 * тестова, по базі на клієнта; кожна прописується в конфізі хоста окремим
 * записом. Альтернатива (параметр `base` у кожному інструменті) зручніша в
 * конфізі й програє там, де програш дорогий: промах у параметрі пише не в ту
 * базу, а в обліку це помітно не одразу й прибирається руками. Тут інструмент
 * фізично не вміє звернутися до сусідньої бази.
 *
 * ОБГОРТКА НЕ МАЄ НІ ПРАВ, НІ ВЛАСНОЇ ОСОБИ. Вона тримає токен користувача й
 * нічого більше: право рахує сервер на кожній команді, аудит пише виконавця,
 * запобіжники запису (`confirm`, токен «тільки читання») теж живуть там. Тут
 * немає й не має бути ані кешу прав, ані перевірок «а чи можна» — друга копія
 * розійшлася б із першою мовчки.
 */

/** Мінімальна версія сервера: до неї `tools` віддавав плаский перелік схем. */
export const MINIMUM_SERVER_VERSION = "0.19.0";

export interface AlteraConfig {
  /** Походження бази: `https://buh.example.com` або `http://localhost:3000`. */
  url: string;
  /** Персональний токен доступу (`/api/auth/tokens` у браузері). */
  token: string;
  timeoutMs: number;
}

/** Рядок каталогу — модель без схем. */
export interface AlteraModelEntry {
  model: string;
  type: string;
  titles?: Record<string, string>;
  route?: string;
  aliases?: string[];
  commands: string[];
}

export interface AlteraTool {
  model: string;
  command: string;
  input: unknown;
}

interface ListEnvelope {
  ok: boolean;
  data?: { rows?: unknown[] };
  messages?: unknown[];
}

/** Відмова, яку варто показати агенту словами, а не стеком. */
export class AlteraError extends Error {}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new AlteraError(
      `${name} не задано. Обгортка чекає ALTERA_URL і ALTERA_TOKEN в оточенні ` +
        `(у конфізі MCP-хоста — поле "env").`,
    );
  }

  // Хост підставляє `${ЗМІННА}` з СВОГО оточення, і якщо змінної там не було —
  // шаблон приїжджає сюди рядком. Далі все виглядає працюючим: процес стартує,
  // інструменти показуються, і лише перший виклик дає 401 «токен недійсний»,
  // за яким шукають відкликаний токен, а не незадану змінну. Сказати правду
  // тут коштує двох рядків, а мовчання коштувало півгодини.
  if (/^\$\{.*\}$/.test(value)) {
    throw new AlteraError(
      `${name} приїхав нерозгорнутим (${value}): змінної не було в оточенні хоста, ` +
        `коли той запускав обгортку. Задай її й перезапусти хост — або впиши значення ` +
        `в конфіг прямо.`,
    );
  }

  return value;
}

/**
 * Конфігурація з оточення.
 *
 * Токен саме через `env`, ніколи аргументом командного рядка: аргументи видно в
 * списку процесів будь-якому користувачу машини, і токен звідти витікає мовчки.
 */
export function configFromEnv(): AlteraConfig {
  const timeout = Number.parseInt(Deno.env.get("ALTERA_TIMEOUT_MS") ?? "", 10);
  return {
    url: requiredEnv("ALTERA_URL").replace(/\/+$/, ""),
    token: requiredEnv("ALTERA_TOKEN"),
    // Звіт по великому регістру рахується довго, тож умовчання щедре: обірваний
    // на півдорозі звіт агент прочитає як «не працює», а не як «повільно».
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000,
  };
}

/**
 * Рядки каталогу відрізняються від старого плаского переліку за складом полів:
 * у каталозі є `commands`, у старого — `command` і `input`.
 *
 * Сказати про це прямо важливо: інакше агент дістав би або порожнечу, або 200 КБ
 * схем, і жодне з двох не пояснює, що база просто старіша.
 */
export function assertCatalogShape(rows: unknown[], url: string): void {
  const first = rows[0] as Record<string, unknown> | undefined;
  if (!first) return;
  if (Array.isArray(first.commands)) return;

  if ("command" in first && "input" in first) {
    throw new AlteraError(
      `База ${url} працює на версії фреймворку, старішій за @altera/server@${MINIMUM_SERVER_VERSION}: ` +
        `GET /api/agent/tools віддає плаский перелік схем замість каталогу моделей. ` +
        `Онови сервер бази або користуйся HTTP-API напряму.`,
    );
  }

  throw new AlteraError(`База ${url} віддала перелік невідомого вигляду.`);
}

export class AlteraClient {
  constructor(private readonly config: AlteraConfig) {}

  /** Каталог моделей: що є в базі й що з цим можна робити. */
  async models(): Promise<AlteraModelEntry[]> {
    const rows = await this.rows("/api/agent/tools");
    assertCatalogShape(rows, this.config.url);
    return rows as AlteraModelEntry[];
  }

  /** Схеми payload-ів названих моделей. */
  async describe(models: string[], command?: string): Promise<AlteraTool[]> {
    const query = new URLSearchParams({ model: models.join(",") });
    if (command) query.set("command", command);
    return await this.rows(`/api/agent/tools?${query}`) as AlteraTool[];
  }

  /**
   * Виконати команду моделі.
   *
   * Через `/api/agent/call`, а не прямо в `/api/model/...`: інакше з дороги
   * зникають ворота `manifest.agent` — другий, вужчий за права список того, що
   * агенту взагалі дозволено.
   */
  async call(model: string, command: string, payload: Record<string, unknown>): Promise<unknown> {
    return await this.request("/api/agent/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, command, payload }),
    });
  }

  /**
   * Прикріпити файл до запису: `POST /api/blob/upload` (multipart).
   *
   * ЧОМУ ЦЕ ОКРЕМИЙ ІНСТРУМЕНТ, А НЕ КОМАНДА МОДЕЛІ. Байти в Altera ходять
   * власним каналом — команда моделі возить JSON, а картинка потрібна браузеру
   * звичайним GET-URL без заголовка авторизації. Тобто `altera_call` фізично не
   * має чим передати файл, і скільки б команд не додали в модель, це не
   * зміниться.
   *
   * ФАЙЛ БЕРЕТЬСЯ ШЛЯХОМ, А НЕ ВМІСТОМ. Аргументи інструмента їдуть у JSON-RPC і
   * лишаються в контексті агента: накладна на 420 КБ у base64 — це 560 КБ у
   * розмові, за які платять щоразу, коли до неї повертаються. Обгортка працює на
   * тій самій машині, що й хост, тож шлях коштує сорок байтів, а файл читає вона
   * сама. Ціна рішення названа чесно: обгортка читає БУДЬ-ЯКИЙ файл, доступний
   * користувачу, і відправляє його в базу — тобто `--allow-read` у конфізі це
   * саме те, на що схоже.
   *
   * ВЛАСНИК ЗАДАЄТЬСЯ ОДРАЗУ. Вкладення без власника — «сирота», і його за добу
   * прибирає `attachment_gc`; у браузері власника проставляє збереження форми,
   * а агенту тієї форми нема де зберігати. Тому `model` і `id` тут обов'язкові:
   * інструмент, який мовчки лишає файл на видалення, гірший за його відсутність.
   */
  async attach(
    bytes: Uint8Array,
    name: string,
    mime: string,
    ownerModel: string,
    ownerId: string,
  ): Promise<unknown> {
    const form = new FormData();
    form.set("file", new File([bytes as BufferSource], name, { type: mime }));
    form.set("ownerModel", ownerModel);
    form.set("ownerId", ownerId);

    // `content-type` не задаємо: його разом із межею частин ставить fetch, і
    // заданий руками він розійшовся б із тілом.
    return await this.request("/api/blob/upload", { method: "POST", body: form });
  }

  private async rows(path: string): Promise<unknown[]> {
    const envelope = await this.request(path) as ListEnvelope;
    return Array.isArray(envelope.data?.rows) ? envelope.data.rows : [];
  }

  /**
   * Один запит до бази — і єдине місце, де відмова стає текстом для агента.
   *
   * Конверт застосунку (`{ok, messages}`) і код HTTP тут зводяться до одного:
   * агенту однаково, чим саме йому відмовили, — йому треба знати, що робити
   * далі. 401 окремо, бо це єдина відмова, яку виправляє людина, а не агент.
   */
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = `${this.config.url}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AlteraError(`База ${this.config.url} не відповідає: ${reason}`);
    }

    if (response.status === 401) {
      await response.body?.cancel();
      throw new AlteraError(
        `База ${this.config.url} не прийняла токен (401): він недійсний, відкликаний або протермінований. ` +
          `Видай новий у застосунку — «Мої токени».`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AlteraError(`База ${this.config.url} відповіла не-JSON (HTTP ${response.status}).`);
    }

    const envelope = body as { ok?: boolean; messages?: unknown[] };
    if (envelope?.ok === false) {
      throw new AlteraError(messagesToText(envelope.messages) ?? `Відмова бази (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new AlteraError(`База відповіла HTTP ${response.status}.`);
    }

    return body;
  }
}

/**
 * Повідомлення конверта — рядками або об'єктами `{type, text, field}`.
 *
 * Маркери перекладу (`@[core.…]`) лишаються як є: розгортає їх клієнт, і
 * підміняти цю роботу тут означало б завести другий словник поруч із першим.
 */
function messagesToText(messages: unknown[] | undefined): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const parts = messages.map((message) => {
    if (typeof message === "string") return message;
    const record = message as { text?: unknown; field?: unknown };
    const text = typeof record?.text === "string" ? record.text : JSON.stringify(message);
    return typeof record?.field === "string" ? `${text} (поле «${record.field}»)` : text;
  });

  return parts.join("; ");
}
