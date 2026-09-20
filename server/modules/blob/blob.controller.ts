import { Controller, Get, Param, Post, Req } from "@danet/core";
import {
  AuthenticationRequiredError,
  assertTokenHasNoScope,
  assertTokenMayWrite,
  type HttpRequest,
  jsonResponse,
  ReadOnlyTokenError,
  ScopedTokenError,
  resolveSessionToken,
} from "../../common/http.ts";
import { type RequestAuthContext, RequestUserService } from "../../common/request-user.service.ts";
import { BlobService, getMaxUploadBytes, isInlineSafe } from "./blob.service.ts";

/** Конверт моделі — щоб клієнт розбирав відповідь так само, як будь-яку іншу. */
function envelope(item: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: { item, rows: [], options: {}, totals: {}, extra },
    messages: [],
    meta: {},
  };
}

function errorEnvelope(message: string) {
  return {
    ok: false,
    data: { item: null, rows: [], options: {}, totals: {}, extra: {} },
    messages: [message],
    meta: {},
  };
}

/** Ім'я файлу в Content-Disposition: ASCII-фолбек + RFC 5987 для кирилиці. */
function contentDisposition(disposition: "inline" | "attachment", name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replaceAll('"', "'");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Персональний токен запиту, якщо він є. Без `Bearer` — `null` і жодного
 * походу в базу: так ходить браузер, тобто майже кожен запит сюди.
 *
 * Функцією поза класом, а не методом контролера: Danet вважає маршрутом кожен
 * метод прототипу, і метод без декоратора валить реєстрацію роутера.
 */
async function bearerAccessToken(
  users: RequestUserService,
  req: HttpRequest,
): Promise<{ userId: string; accessTokenId: string } | null> {
  if (resolveSessionToken(req)?.source !== "bearer") return null;
  const auth = await users.resolveAuthContext(req);
  return auth.accessToken ? { userId: auth.userId, accessTokenId: auth.accessToken.id } : null;
}

/**
 * Роздача та приймання бінарних даних.
 *
 * Свідомо окремий контролер, а не команда моделі: `/api/model/:model/:command`
 * возить JSON, а зображення потрібне браузеру як звичайний GET-URL
 * (`<img src>`), без заголовка Authorization. Право доступу несе токен у
 * запиті — див. blob-token.ts.
 */
@Controller("api/blob")
export class BlobController {
  constructor(private blobService: BlobService, private requestUserService: RequestUserService) {}

  /**
   * Завантаження на сервер. multipart/form-data:
   *   file        — сам файл (обов'язково);
   *   ownerModel  — модель-власник (необов'язково);
   *   ownerId     — id запису-власника (необов'язково).
   *
   * Повертає id і токен. Id потрапляє в модель лише при збереженні самої
   * форми — до того вкладення лишається «сиротою» (див. attachment_gc).
   */
  @Post("upload")
  async upload(
    @Req() req: HttpRequest,
  ) {
    // Поза `try`: відмову токену журнал мусить зберегти й з блоку `catch`.
    let auth: RequestAuthContext | null = null;
    // Відмова на вході — теж дія агента, і з відмов якраз видно, як він
    // поводиться. Запис, що дійшов до `create`, журналюється там.
    const refuse = async (response: Response) => {
      if (auth?.accessToken) await this.blobService.recordTokenRefusal(auth.userId, auth.accessToken.id);
      return response;
    };
    try {
      auth = await this.requestUserService.resolveAuthContext(req);
      // Вкладення — це запис, хай і не командою моделі. Перевірка мусить стояти
      // ДО читання тіла: інакше токен для читання змусив би сервер прийняти й
      // розібрати файл на десятки мегабайт, щоб потім його відкинути.
      assertTokenHasNoScope(auth, "завантаження файлу");
      assertTokenMayWrite(auth, "завантаження файлу");

      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return await refuse(jsonResponse(errorEnvelope("Файл не передано (поле 'file')"), 400));
      }

      const maxBytes = getMaxUploadBytes();
      if (file.size > maxBytes) {
        return await refuse(jsonResponse(
          errorEnvelope(`Розмір файлу перевищує ${Math.round(maxBytes / 1024 / 1024)} МБ`),
          413,
        ));
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      // Дубль-перевірка після читання: file.size — те, що заявив клієнт.
      if (bytes.length > maxBytes) {
        return await refuse(jsonResponse(
          errorEnvelope(`Розмір файлу перевищує ${Math.round(maxBytes / 1024 / 1024)} МБ`),
          413,
        ));
      }

      const ownerModel = typeof form.get("ownerModel") === "string"
        ? String(form.get("ownerModel")).trim() || null
        : null;
      const ownerIdRaw = typeof form.get("ownerId") === "string" ? String(form.get("ownerId")).trim() : "";
      const ownerId = /^\d+$/.test(ownerIdRaw) ? ownerIdRaw : null;

      const created = await this.blobService.create({
        // Токен — виклик агента: запис і рядок журналу однією транзакцією.
        accessTokenId: auth.accessToken?.id ?? null,
        // Ім'я приходить від клієнта — лишаємо тільки базове, без шляху.
        name: (file.name || "file").split(/[\\/]/).pop() ?? "file",
        mime: file.type || "application/octet-stream",
        bytes,
        userId: auth.userId,
        sessionId: auth.sessionId,
        ownerModel,
        ownerId,
      });

      return jsonResponse(envelope(created));
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return jsonResponse(errorEnvelope(error.message), 401);
      }
      if (error instanceof ReadOnlyTokenError || error instanceof ScopedTokenError) {
        return await refuse(jsonResponse(errorEnvelope(error.message), error.status));
      }
      return jsonResponse(
        errorEnvelope(error instanceof Error ? error.message : "Помилка завантаження файлу"),
        500,
      );
    }
  }

  /**
   * Віддача байтів: `/api/blob/:id?token=…&disp=inline|attachment`.
   *
   * Авторизація — тільки токен: цей URL підставляється в `<img src>` і
   * `<a download>`, куди заголовки не почепиш.
   *
   * Але агент (`mcp/altera-client.ts`) шле ще й `Authorization: Bearer`, і
   * тоді віддача журналюється — під своїм токеном, у транзакції з читанням.
   * Браузер заголовка не шле, тож для людини тут ні запиту більше, ні рядка.
   * Недійсний Bearer — 401, а не тиха віддача за підписом URL: відкликаний
   * токен не має забирати файли, навіть маючи видане раніше посилання.
   */
  @Get(":id")
  async download(
    @Param("id") id: string,
    @Req() req: HttpRequest,
  ) {
    try {
      const url = new URL(req.url);
      const token = url.searchParams.get("token") ?? "";
      if (!token) {
        return new Response("Forbidden", { status: 403 });
      }

      const accessToken = await bearerAccessToken(this.requestUserService, req);
      const attachment = accessToken
        ? await this.blobService.resolveByTokenAudited(token, String(id), accessToken)
        : await this.blobService.resolveByToken(token);
      // Токен видано на інше вкладення — не 200 з чужими байтами.
      if (!attachment || attachment.id !== String(id)) {
        return new Response("Not found", { status: 404 });
      }

      const wantsInline = (url.searchParams.get("disp") ?? "inline") !== "attachment";
      const disposition = wantsInline && isInlineSafe(attachment.mime) ? "inline" : "attachment";

      const etag = `"${attachment.id}-${attachment.sha256 ?? attachment.size}"`;
      if (req.header("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }

      return new Response(attachment.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": attachment.mime,
          "content-length": String(attachment.bytes.length),
          "content-disposition": contentDisposition(disposition, attachment.name),
          // Файл користувача на нашому origin: не даємо браузеру ані вгадувати
          // тип, ані виконувати вміст як сторінку.
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'",
          // Приватний кеш: URL містить токен, у спільні кеші йому не можна.
          "cache-control": "private, max-age=300",
          etag,
        },
      });
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        return new Response("Unauthorized", { status: 401 });
      }
      // Роздача байтів не має віддавати деталі назовні: у відповідь — сухий
      // 500, подробиці в лог сервера.
      console.error("[blob] download failed:", error);
      return new Response("Internal error", { status: 500 });
    }
  }
}
