// Токен доступу до вкладення.
//
// Навіщо він узагалі. Зображення й файли віддаються звичайним GET-запитом
// (`<img src>`, `<a download>`), а туди не можна почепити заголовок
// Authorization. Тому право доступу несе сам URL: підписаний токен, у якому
// зашито, ЩО віддавати (id + ключ доступу вкладення) і КОМУ (користувач і
// сесія). Підпис — HMAC-SHA256 серверним секретом, тому токен не підробити й
// не вгадати за id.
//
// Наслідки, які варто розуміти:
//  · токен різний у різних сесіях — рівно як в A2v10;
//  · вихід із сесії знецінює всі її токени (перевіряємо сесію на кожен GET);
//  · ротація `access_key` вкладення знецінює всі його токени одразу;
//  · термін життя обмежений (BLOB_TOKEN_TTL_HOURS), тому «вічне» посилання з
//    чужого чату не працює.

const encoder = new TextEncoder();

/** Полезне навантаження токена. Ключі однолітерні — токен їде в URL. */
interface AccessTokenClaims {
  /** id вкладення. */
  a: string;
  /** access_key вкладення (uuid). */
  k: string;
  /** id користувача. */
  u: string;
  /** id сесії; порожній — сесії немає (dev-bypass або агент). */
  s: string;
  /** Час протермінування, unix seconds. */
  e: number;
}

export interface AccessTokenPayload {
  attachmentId: string;
  accessKey: string;
  userId: string;
  sessionId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getTtlSeconds(): number {
  const raw = Number.parseInt(Deno.env.get("BLOB_TOKEN_TTL_HOURS") ?? "12", 10);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 12;
  return hours * 60 * 60;
}

let cachedKey: Promise<CryptoKey> | null = null;

/**
 * Секрет підпису. Окремий BLOB_TOKEN_SECRET, інакше — JWT_SECRET (той самий
 * рівень довіри). Якщо не задано жодного, генеруємо разовий на процес: у dev
 * усе працює, а після рестарту старі посилання просто перестають діяти.
 */
function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  let secret = Deno.env.get("BLOB_TOKEN_SECRET")?.trim() || Deno.env.get("JWT_SECRET")?.trim();
  if (!secret) {
    secret = crypto.randomUUID() + crypto.randomUUID();
    console.warn(
      "⚠ BLOB_TOKEN_SECRET/JWT_SECRET не задано — токени вкладень підписані разовим ключем процесу",
    );
  }

  cachedKey = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return cachedKey;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function sign(data: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await getSigningKey(), encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

/** Порівняння сталого часу — щоб підпис не можна було підібрати побайтово. */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Видати токен доступу до вкладення. */
export async function mintAccessToken(payload: AccessTokenPayload): Promise<string> {
  const claims: AccessTokenClaims = {
    a: payload.attachmentId,
    k: payload.accessKey,
    u: payload.userId,
    s: payload.sessionId,
    e: Math.floor(Date.now() / 1000) + getTtlSeconds(),
  };

  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${body}.${await sign(body)}`;
}

/**
 * Перевірити токен. Повертає null на будь-якому відхиленні (зіпсований,
 * підроблений, протермінований) — виклик не має розрізняти причини.
 * Перевірка живості сесії — вище, у BlobService: тут немає доступу до БД.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  const [body, signature] = token.split(".", 2);
  if (!body || !signature) return null;

  if (!timingSafeEqual(await sign(body), signature)) return null;

  const raw = fromBase64Url(body);
  if (!raw) return null;

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(raw)) as AccessTokenClaims;
  } catch {
    return null;
  }

  if (!claims?.a || !claims?.k || typeof claims.e !== "number") return null;
  if (claims.e < Math.floor(Date.now() / 1000)) return null;

  return {
    attachmentId: String(claims.a),
    accessKey: String(claims.k),
    userId: String(claims.u ?? ""),
    sessionId: String(claims.s ?? ""),
  };
}

/**
 * Підміна ключів доступу на підписані токени у відповіді моделі.
 *
 * Правило (прямий аналог типу `!Token` в A2v10): поле, чиє ім'я — `token` або
 * закінчується на `Token`, і в якому лежить uuid, — це ключ доступу до
 * вкладення. Рантайм замінює його підписаним токеном, прив'язаним до поточної
 * сесії. Id вкладення береться з поля-побратима: `token` → `id`,
 * `logoToken` → `logoId`.
 *
 * Тому SQL-функції моделей віддають сирий `access_key`, а UI ніколи його не
 * бачить: у нього приходить уже готовий токен, і в різних сесіях він різний.
 */
export async function signEnvelopeTokens(
  envelope: unknown,
  auth: { userId: string; sessionId: string },
): Promise<unknown> {
  const tasks: Promise<void>[] = [];

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (value && typeof value === "object") {
        walk(value);
        continue;
      }

      if (key !== "token" && !key.endsWith("Token")) continue;
      if (!isUuid(value)) continue;

      const idKey = key === "token" ? "id" : `${key.slice(0, -"Token".length)}Id`;
      const attachmentId = record[idKey];
      if (attachmentId === null || attachmentId === undefined || attachmentId === "") {
        // Немає до чого прив'язати токен — не віддаємо назовні ключ доступу.
        record[key] = null;
        continue;
      }

      tasks.push(
        mintAccessToken({
          attachmentId: String(attachmentId),
          accessKey: value,
          userId: auth.userId,
          sessionId: auth.sessionId,
        }).then((token) => {
          record[key] = token;
        }),
      );
    }
  };

  walk(envelope);
  if (tasks.length) await Promise.all(tasks);
  return envelope;
}
