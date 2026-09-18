import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { isUuid, mintAccessToken, verifyAccessToken } from "./blob-token.ts";
import { getServerConfig } from "../../config/server-config.ts";
import { withTokenAudit, writeAuditEntry } from "../../common/token-audit.ts";

/** Під цими іменами канал байтів лягає в журнал: модель ядра й «команда» входу. */
const UPLOAD_AUDIT = { model: "attachment", command: "upload" } as const;
const DOWNLOAD_AUDIT = { model: "attachment", command: "download" } as const;

/** Рядок app.attachment_load — метадані разом із потоком даних. */
interface AttachmentRow {
  id: string;
  name: string;
  mime: string;
  size: string;
  sha256: string | null;
  access_key: string;
  stream: Uint8Array | null;
}

export interface AttachmentBytes {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string | null;
  bytes: Uint8Array;
}

export interface CreatedAttachment {
  id: string;
  token: string;
  name: string;
  mime: string;
  size: number;
}

/** Максимальний розмір завантаження, байт. */
export function getMaxUploadBytes(): number {
  return getServerConfig().blob.maxSizeMb * 1024 * 1024;
}

/**
 * Типи, які безпечно показувати в браузері прямо (inline). Усе інше
 * віддається як завантаження: інакше користувач міг би залити .html і
 * відкрити його на нашому origin — це готовий XSS.
 */
const INLINE_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "application/pdf",
]);

export function isInlineSafe(mime: string): boolean {
  return INLINE_MIME_ALLOWLIST.has(mime.toLowerCase().split(";")[0].trim());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

@Injectable()
export class BlobService {
  constructor(private db: DatabaseService) {}

  /**
   * Створити вкладення. Власник необов'язковий — його можна прив'язати пізніше.
   *
   * `accessTokenId` — завантаження персональним токеном: тоді запис і рядок
   * журналу йдуть однією транзакцією (`withTokenAudit`), як і команди моделей.
   * Байти ходять повз рантайм, тож без цього агент міг би залити файл, не
   * лишивши сліду.
   */
  async create(input: {
    name: string;
    mime: string;
    bytes: Uint8Array;
    userId: string;
    sessionId: string;
    ownerModel?: string | null;
    ownerId?: string | null;
    accessTokenId?: string | null;
  }): Promise<CreatedAttachment> {
    if (!input.accessTokenId) return await this.insert(this.db, input);

    return await withTokenAudit(
      this.db,
      { userId: input.userId, ...UPLOAD_AUDIT, accessTokenId: input.accessTokenId },
      (db) => this.insert(db, input),
      (created) => ({ isSuccess: true, recordId: created.id }),
    );
  }

  /**
   * Відмова токену на вході завантаження (токен «тільки читання», завеликий
   * файл). Окремим записом, fail-open: нічого не сталося, тож і відкочувати нема
   * чого, а слід про спробу агенту журнал зберегти мусить.
   */
  async recordTokenRefusal(userId: string, accessTokenId: string): Promise<void> {
    await writeAuditEntry(this.db, {
      userId,
      ...UPLOAD_AUDIT,
      recordId: null,
      isSuccess: false,
      accessTokenId,
    });
  }

  private async insert(
    db: DatabaseService,
    input: {
      name: string;
      mime: string;
      bytes: Uint8Array;
      userId: string;
      sessionId: string;
      ownerModel?: string | null;
      ownerId?: string | null;
    },
  ): Promise<CreatedAttachment> {
    const hash = await sha256Hex(input.bytes);

    const rows = await db.sql<{ id: string; access_key: string }[]>`
      select id::text, access_key
      from app.attachment_update(
        ${input.userId}::bigint,
        ${input.name}::varchar,
        ${input.mime}::varchar,
        ${input.bytes}::bytea,
        ${input.ownerModel ?? null}::varchar,
        ${input.ownerId ?? null}::bigint,
        ${hash}::varchar
      )
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Не вдалося зберегти вкладення");
    }

    return {
      id: row.id,
      token: await mintAccessToken({
        attachmentId: row.id,
        accessKey: row.access_key,
        userId: input.userId,
        sessionId: input.sessionId,
      }),
      name: input.name,
      mime: input.mime,
      size: input.bytes.length,
    };
  }

  /**
   * Віддати байти за токеном.
   *
   * Токен самодостатній (його неможливо підробити), але одного підпису мало:
   * перевіряємо ще, що сесія жива і що ключ доступу вкладення не змінився.
   * Саме ці дві перевірки роблять «розшарене» посилання недовговічним.
   */
  async resolveByToken(token: string, db: DatabaseService = this.db): Promise<AttachmentBytes | null> {
    const claims = await verifyAccessToken(token);
    if (!claims) return null;

    if (claims.sessionId && !await this.isSessionActive(db, claims.sessionId)) return null;

    const attachment = await this.load(db, claims.attachmentId, claims.userId);
    if (!attachment) return null;

    if (attachment.accessKey !== claims.accessKey) return null;

    return {
      id: attachment.id,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      sha256: attachment.sha256,
      bytes: attachment.bytes,
    };
  }

  /**
   * Те саме, але запит прийшов персональним токеном: байти віддаються лише
   * після коміту рядка журналу (`attachment/download`). Питання «що агент
   * бачив» тут законне — файл іде в сторонню LLM, — а команда, що видала
   * підписаний токен, каже лише, що доступ був, не що файл забрали.
   */
  async resolveByTokenAudited(
    token: string,
    attachmentId: string,
    auth: { userId: string; accessTokenId: string },
  ): Promise<AttachmentBytes | null> {
    const recordId = /^\d+$/.test(attachmentId) ? attachmentId : null;
    return await withTokenAudit(
      this.db,
      { userId: auth.userId, ...DOWNLOAD_AUDIT, accessTokenId: auth.accessTokenId },
      (db) => this.resolveByToken(token, db),
      // Токен виданий на інше вкладення — відмова, як і в контролері.
      (attachment) => ({ isSuccess: attachment?.id === attachmentId, recordId }),
      recordId,
    );
  }

  private async load(
    db: DatabaseService,
    id: string,
    userId: string,
  ): Promise<(AttachmentBytes & { accessKey: string }) | null> {
    if (!/^\d+$/.test(id)) return null;

    const rows = await db.sql<AttachmentRow[]>`
      select id, name, mime, size, sha256, access_key, stream
      from app.attachment_load(${/^\d+$/.test(userId) ? userId : "0"}::bigint, ${id}::bigint)
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      id: String(row.id),
      name: row.name,
      mime: row.mime,
      size: Number(row.size),
      sha256: row.sha256,
      accessKey: row.access_key,
      bytes: row.stream ?? new Uint8Array(),
    };
  }

  private async isSessionActive(db: DatabaseService, sessionId: string): Promise<boolean> {
    // Підроблений токен сюди не дійде (перевірено підписом), але в БД усе одно
    // не йдемо з не-uuid: інакше запит впаде на касті замість чистого 404.
    if (!isUuid(sessionId)) return false;

    const rows = await db.sql<{ id: string }[]>`
      select s.id::text
      from app.auth_session s
      join app.users u on u.id = s.user_id
      where s.id = ${sessionId}::uuid
        and s.revoked_at is null
        and s.expires_at > now()
        and u.is_active = true
      limit 1
    `;

    return rows.length > 0;
  }
}
