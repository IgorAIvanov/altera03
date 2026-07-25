/**
 * Клієнт до застосунку, піднятого в цьому ж процесі.
 *
 * Ходить не по мережі, а напряму в обробник застосунку, тому: порт не потрібен,
 * чекати на готовність нема чого, а у відповідь приходить справжній `Response` —
 * зі справжнім статусом (включно з 304, який HTTP-клієнти люблять з'їдати) і
 * справжніми заголовками.
 *
 * Це пакетний інструмент, тож `createServer` він НЕ імпортує (це означало б
 * залежність від конкретного застосунку) — застосунок **інжектить** його у
 * `start()`. Тонкі обгортки `scripts/api.ts` і `scripts/smoke_test.ts` передають
 * сюди `createServer` зі свого `app/server.ts`.
 */
import { assertDevEnvironment } from "./dev-guard.ts";

/** Обробник застосунку — те саме, що бачить `Deno.serve`. */
export type AppHandler = (request: Request) => Promise<Response>;

/** Піднятий застосунок: обробник + коректне згортання (закриття пулу БД). */
export interface AppServer {
  handler: AppHandler;
  close(): Promise<void>;
}

/** Фабрика застосунку — те, що застосунок інжектить у {@link AppClient.start}. */
export type CreateServer = () => Promise<AppServer>;

/** Хост неважливий: обробник дивиться лише на шлях. */
const BASE_URL = "http://in-process";

export interface ApiResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

/** Конверт моделі — той самий, що описаний у CLAUDE.md. */
export interface Envelope {
  ok: boolean;
  data: {
    item: unknown;
    rows: unknown[];
    options: Record<string, unknown>;
    totals: Record<string, unknown>;
    extra?: Record<string, unknown>;
  };
  messages: string[];
}

export interface UploadFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface StartOptions {
  /** Від імені якого користувача ходити (заголовок dev-bypass). */
  userId?: string | null;
  /**
   * Глушити шум підняття та згортання. Danet розуміє `NO_LOG`, але застосунок
   * пише і повз його логер (пул БД, model-view), тому на час bootstrap/close
   * підміняємо ще й `console.log` — інакше `--raw` не спрямуєш у `jq`.
   */
  quiet?: boolean;
}

async function withoutOutput<T>(quiet: boolean, fn: () => Promise<T>): Promise<T> {
  if (!quiet) {
    return await fn();
  }

  const previousNoLog = Deno.env.get("NO_LOG");
  const originalLog = console.log;
  Deno.env.set("NO_LOG", "1");
  console.log = () => {};

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    if (previousNoLog === undefined) {
      Deno.env.delete("NO_LOG");
    } else {
      Deno.env.set("NO_LOG", previousNoLog);
    }
  }
}

export class AppClient {
  private constructor(
    private readonly server: AppServer,
    private userId: string | null,
    private readonly quiet: boolean,
  ) {}

  /**
   * Піднімає застосунок через передану фабрику. Запобіжник оточення спрацьовує
   * ДО bootstrap, щоб на чужій базі ми навіть не відкривали з'єднання.
   */
  static async start(
    tool: string,
    createServer: CreateServer,
    options: StartOptions = {},
  ): Promise<AppClient> {
    assertDevEnvironment(tool);

    const quiet = options.quiet ?? false;
    const server = await withoutOutput(quiet, createServer);
    return new AppClient(server, options.userId ?? null, quiet);
  }

  /** Від імені якого користувача ходити (заголовок dev-bypass). */
  asUser(userId: string | null): this {
    this.userId = userId;
    return this;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    if (this.userId && !headers.has("x-dev-user-id")) {
      headers.set("x-dev-user-id", this.userId);
    }

    return headers;
  }

  /** Сирий запит — коли потрібні заголовки або нетекстове тіло. */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return await this.server.handler(
      new Request(`${BASE_URL}${path}`, { ...init, headers: this.buildHeaders(init.headers) }),
    );
  }

  /** Запит із розбором тіла: JSON, якщо сервер так каже, інакше текст. */
  async json<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    const response = await this.fetch(path, init);
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    const body = isJson ? await response.json() : await response.text();

    return { status: response.status, headers: response.headers, body: body as T };
  }

  /** Команда моделі: `POST /api/model/:model/:command`. */
  async model(
    model: string,
    command: string,
    payload: Record<string, unknown> = {},
  ): Promise<ApiResult<Envelope>> {
    return await this.json<Envelope>(`/api/model/${model}/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /** Завантаження вкладення: `POST /api/blob/upload` (multipart). */
  async upload(file: UploadFile, fields: Record<string, string> = {}): Promise<ApiResult<Envelope>> {
    const form = new FormData();
    form.set("file", new File([file.bytes as BufferSource], file.name, { type: file.type }));
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, value);
    }

    return await this.json<Envelope>("/api/blob/upload", { method: "POST", body: form });
  }

  /** Згортає застосунок: APP_CLOSE-хуки, зокрема закриття пулу БД. */
  async close(): Promise<void> {
    await withoutOutput(this.quiet, () => this.server.close());
  }
}
