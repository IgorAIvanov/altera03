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
  /**
   * Куди класти вивантажені файли. `null` — нікуди, і тоді обгортка їх не
   * забирає взагалі.
   *
   * Каталог називає ЛЮДИНА в конфізі хоста, а не агент у виклику. Різниця не
   * церемоніальна: аргументом він означав би, що агент вибирає, у яке місце
   * диска писати, — а дозвіл `--allow-write` виданий один на процес і жодного
   * вибору вже не звужує. Не задано — інструменти чесно відмовляють і кажуть,
   * що дописати в конфіг; мовчазне «покладу в тимчасовий» лишало б файли там,
   * де їх ніхто не шукає.
   */
  downloadDir: string | null;
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

/**
 * Метадані вкладення — те, що віддають `attachment/list` і `attachment/get`.
 *
 * `token` — уже ПІДПИСАНИЙ токен доступу: сирий `access_key` рантайм міняє на
 * нього дорогою назовні. Живе він годинами (`BLOB_TOKEN_TTL_HOURS`), тож
 * зберігати його нема сенсу — беремо перед кожним завантаженням.
 */
export interface AlteraAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt?: string;
  token: string;
}

/** Готова друкована форма: байти й ім'я файлу, яке дала база. */
export interface AlteraPrintout {
  bytes: Uint8Array;
  fileName: string;
  templateCode?: string;
  templateName?: string;
}

interface ListEnvelope {
  ok: boolean;
  data?: { rows?: unknown[]; extra?: Record<string, unknown> };
  messages?: unknown[];
}

/** Рядок покажчика тем: тіло читається окремо, коли задача збіглася. */
export interface AlteraTopicEntry {
  slug: string;
  title: string;
  summary: string;
}

/** Що модель відмовиться робити: ключ правила й те, що воно скаже людині. */
export interface AlteraModelRule {
  key: string;
  text: string;
}

/** Відповідь `altera_describe`: схеми, оголошені обмеження й записки моделей. */
export interface AlteraDescription {
  tools: AlteraTool[];
  rules: Record<string, AlteraModelRule[]>;
  /** Домовленості ЦЬОГО підприємства щодо названих моделей. */
  notes: Record<string, string[]>;
}

/** Записки за моделями — форма з `data.extra.notes`, обережно розібрана. */
function asNotes(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const notes: Record<string, string[]> = {};
  for (const [model, list] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(list)) notes[model] = list.filter((line): line is string => typeof line === "string");
  }
  return notes;
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
  const downloadDir = Deno.env.get("ALTERA_DOWNLOAD_DIR")?.trim();
  return {
    url: requiredEnv("ALTERA_URL").replace(/\/+$/, ""),
    token: requiredEnv("ALTERA_TOKEN"),
    // Звіт по великому регістру рахується довго, тож умовчання щедре: обірваний
    // на півдорозі звіт агент прочитає як «не працює», а не як «повільно».
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000,
    // Порожній рядок — це «не задано», а не «поточний каталог»: у конфізі хоста
    // порожнє поле трапляється частіше за навмисний вибір, і писати від нього
    // файли туди, звідки запустили хост, було б сюрпризом. Нерозгорнутий
    // `${…}` — те саме «не задано», лише голосніше: інакше обгортка створила б
    // каталог із таким іменем і чесно поклала б у нього файл.
    downloadDir: downloadDir && !/^\$\{.*\}$/.test(downloadDir)
      ? downloadDir.replace(/[\\/]+$/, "")
      : null,
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

  /**
   * Каталог вивантаження або `null`, якщо його не задали.
   *
   * Питається ДО походу в базу: інакше відмова «нема куди класти» приходила б
   * після того, як сервер намалював стосторінковий бланк.
   */
  get downloadDir(): string | null {
    return this.config.downloadDir;
  }

  /**
   * Адреса бази — вона ж походження застосунку: API і в'ю віддає той самий
   * сервер. Потрібна не для запитів (їх будує сам клієнт), а щоб дописати
   * посилання, яке агент дасть людині.
   */
  get origin(): string {
    return this.config.url;
  }

  /**
   * Каталог моделей — і пам'ятка бази разом із ним.
   *
   * Пам'ятка їде саме тут, а не окремим інструментом: домовленості цього
   * підприємства потрібні з першого кроку, а те, що треба здогадатися
   * запитати, допомагає лише тому, хто вже підозрює, що чогось не знає.
   */
  async models(): Promise<{ models: AlteraModelEntry[]; note: string[]; topics: AlteraTopicEntry[] }> {
    const envelope = await this.request("/api/agent/tools") as ListEnvelope;
    const rows = Array.isArray(envelope.data?.rows) ? envelope.data.rows : [];
    assertCatalogShape(rows, this.config.url);

    const note = envelope.data?.extra?.note;
    const topics = envelope.data?.extra?.topics;
    return {
      models: rows as AlteraModelEntry[],
      note: Array.isArray(note) ? note.filter((line) => typeof line === "string") : [],
      // Покажчик тем: рядок на тему, тіло — окремою командою. Старший сервер
      // тем не віддає взагалі, і тоді їх просто немає.
      topics: Array.isArray(topics) ? topics as AlteraTopicEntry[] : [],
    };
  }

  /**
   * Схеми payload-ів названих моделей — і те, чого застосунок робити не стане.
   *
   * Правила їдуть саме тут, разом зі схемою: схема каже, які є ПОЛЯ, і мовчить
   * про поведінку. Поле в ній буває, а команда його відбиває — і доти
   * відрізнити «поле є» від «поведінка є» через MCP не можна було нічим.
   */
  async describe(models: string[], command?: string): Promise<AlteraDescription> {
    const query = new URLSearchParams({ model: models.join(",") });
    if (command) query.set("command", command);

    const envelope = await this.request(`/api/agent/tools?${query}`) as ListEnvelope;
    const rules = envelope.data?.extra?.rules;

    return {
      tools: Array.isArray(envelope.data?.rows) ? envelope.data.rows as AlteraTool[] : [],
      // Старший сервер правил не віддає взагалі — тоді їх просто немає, а не
      // «жодна модель нічого не забороняє».
      rules: (rules && typeof rules === "object" ? rules : {}) as Record<string, AlteraModelRule[]>,
      notes: asNotes(envelope.data?.extra?.notes),
    };
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

  /**
   * Вкладення запису — метадані, не байти: `attachment/list`.
   *
   * Через ту саму `call`, що й будь-яка інша команда: вкладення — звичайна
   * модель ядра, з правом `attachment:view` і фільтром за правами користувача.
   * Окремого входу «дай файли запису» немає навмисно — він був би другим
   * списком того, що агенту дозволено, а другий список розходиться з першим
   * мовчки (D10).
   */
  async attachments(ownerModel: string, ownerId: string): Promise<AlteraAttachment[]> {
    const answer = await this.call("attachment", "list", { ownerModel, ownerId });
    return commandRows(answer) as AlteraAttachment[];
  }

  /** Одне вкладення за його id — звідси беруться ім\'я, тип і токен доступу. */
  async attachment(id: string): Promise<AlteraAttachment> {
    const item = commandItem(await this.call("attachment", "get", { id })) as
      | AlteraAttachment
      | null;

    // База відповідає `ok: true` з порожнім `item` — вкладення могло бути
    // видалене або належати іншій установці. Для агента це не «помилка бази», а
    // «такого id немає», і сказати треба саме так.
    if (!item?.id) throw new AlteraError(`Вкладення ${id} не знайдено.`);
    return item;
  }

  /**
   * Байти вкладення: `GET /api/blob/:id?token=…`.
   *
   * Токен їде В URL, і це не недогляд, а той самий канал, яким користується
   * браузер: право доступу несе сам запит, бо в `<img src>` заголовка не
   * почепиш. Тому й ланцюжок тут двокроковий — спершу команда моделі віддає
   * підписаний токен, потім по ньому забираються байти.
   *
   * `disp=attachment` навмисно: обгортка кладе файл на диск, і `inline` для
   * неї нічого не означає.
   */
  async blob(attachment: AlteraAttachment): Promise<Uint8Array> {
    const query = new URLSearchParams({ token: attachment.token, disp: "attachment" });
    const url = `${this.config.url}/api/blob/${encodeURIComponent(attachment.id)}?${query}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AlteraError(`База ${this.config.url} не віддала файл: ${reason}`);
    }

    if (!response.ok) {
      await response.body?.cancel();
      // 404 тут означає не «немає такого id», а «токен виданий не на це
      // вкладення» — id ми щойно прочитали з бази. Найімовірніша причина —
      // протермінований токен, і другий підхід її знімає.
      throw new AlteraError(
        response.status === 404
          ? `Токен доступу до вкладення ${attachment.id} не прийнято (404): найпевніше він ` +
            `протермінований. Повтори виклик — токен береться заново.`
          : `Файл ${attachment.id} не віддано: HTTP ${response.status}.`,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Друкована форма запису: команда `printPdf` і PDF у відповіді.
   *
   * Байти приходять base64 всередині конверта — так друк влаштований у
   * застосунку, і міняти це заради агента не треба. Важливо інше: base64 не
   * виходить за межі цього методу. Обгортка декодує його, кладе файл на диск і
   * віддає агенту шлях — інакше кожен бланк осідав би в контексті розміром у
   * півтори сотні кілобайтів (це і є відповідь на Q3 плану).
   */
  async print(model: string, id: string, templateCode?: string): Promise<AlteraPrintout> {
    const payload: Record<string, unknown> = { id };
    if (templateCode) payload.templateCode = templateCode;

    const extra = commandExtra(await this.call(model, "printPdf", payload));
    const base64 = typeof extra.pdfBase64 === "string" ? extra.pdfBase64 : "";

    if (!base64) {
      throw new AlteraError(
        `Модель «${model}» не віддала PDF. Найімовірніше, у неї немає активного шаблону друку ` +
          `або команда printPdf їй не оголошена.`,
      );
    }

    return {
      bytes: decodeBase64(base64),
      fileName: typeof extra.fileName === "string" && extra.fileName ? extra.fileName : `${model}-${id}.pdf`,
      templateCode: typeof extra.templateCode === "string" ? extra.templateCode : undefined,
      templateName: typeof extra.templateName === "string" ? extra.templateName : undefined,
    };
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
 * Дані команди всередині відповіді агента.
 *
 * Шарів два: зовнішній — відповідь входу (`{ok, result, messages}`), внутрішній
 * — звичайний конверт моделі (`{item, rows, extra}`). Розбирати їх на місці
 * кожного виклику означало б чотири рівні `?.` у трьох методах; тут це сказано
 * один раз. Відмова сюди не доходить взагалі — її ловить `request`.
 */
function commandData(answer: unknown): Record<string, unknown> {
  const result = (answer as { result?: { data?: unknown } } | null)?.result;
  const data = result?.data;
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

function commandRows(answer: unknown): unknown[] {
  const rows = commandData(answer).rows;
  return Array.isArray(rows) ? rows : [];
}

function commandItem(answer: unknown): unknown {
  return commandData(answer).item ?? null;
}

function commandExtra(answer: unknown): Record<string, unknown> {
  const extra = commandData(answer).extra;
  return extra && typeof extra === "object" ? extra as Record<string, unknown> : {};
}

/**
 * base64 → байти.
 *
 * Своя реалізація замість `@std/encoding`: заради одного рядка тягти залежність
 * у пакет, який ставиться командою `deno run jsr:@altera/mcp`, не варто —
 * `atob` є в рантаймі й робить рівно те саме.
 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
