import { Controller, Get, Param, Post, Req } from "@danet/core";
import { AuthenticationRequiredError, getRequestHeaders, jsonResponse } from "../../common/http.ts";
import { RequestUserService } from "../../common/request-user.service.ts";
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
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    try {
      const auth = await this.requestUserService.resolveAuthContext(req);

      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonResponse(errorEnvelope("Файл не передано (поле 'file')"), 400);
      }

      const maxBytes = getMaxUploadBytes();
      if (file.size > maxBytes) {
        return jsonResponse(
          errorEnvelope(`Розмір файлу перевищує ${Math.round(maxBytes / 1024 / 1024)} МБ`),
          413,
        );
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      // Дубль-перевірка після читання: file.size — те, що заявив клієнт.
      if (bytes.length > maxBytes) {
        return jsonResponse(
          errorEnvelope(`Розмір файлу перевищує ${Math.round(maxBytes / 1024 / 1024)} МБ`),
          413,
        );
      }

      const ownerModel = typeof form.get("ownerModel") === "string"
        ? String(form.get("ownerModel")).trim() || null
        : null;
      const ownerIdRaw = typeof form.get("ownerId") === "string" ? String(form.get("ownerId")).trim() : "";
      const ownerId = /^\d+$/.test(ownerIdRaw) ? ownerIdRaw : null;

      const created = await this.blobService.create({
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
   */
  @Get(":id")
  async download(
    @Param("id") id: string,
    // @ts-expect-error Danet exports Req as a decorator factory, but its published types are incorrect.
    @Req() req: Request,
  ) {
    try {
      const url = new URL(req.url);
      const token = url.searchParams.get("token") ?? "";
      if (!token) {
        return new Response("Forbidden", { status: 403 });
      }

      const attachment = await this.blobService.resolveByToken(token);
      // Токен видано на інше вкладення — не 200 з чужими байтами.
      if (!attachment || attachment.id !== String(id)) {
        return new Response("Not found", { status: 404 });
      }

      const wantsInline = (url.searchParams.get("disp") ?? "inline") !== "attachment";
      const disposition = wantsInline && isInlineSafe(attachment.mime) ? "inline" : "attachment";

      const etag = `"${attachment.id}-${attachment.sha256 ?? attachment.size}"`;
      if (getRequestHeaders(req)?.get("if-none-match") === etag) {
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
      // Роздача байтів не має віддавати деталі назовні: у відповідь — сухий
      // 500, подробиці в лог сервера.
      console.error("[blob] download failed:", error);
      return new Response("Internal error", { status: 500 });
    }
  }
}
