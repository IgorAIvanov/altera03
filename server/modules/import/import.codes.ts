/**
 * Код спарювання й хешування — окремим модулем, бо ним користуються двоє:
 * команда моделі, що заводить сесію, і сам канал, що код перевіряє.
 */

/**
 * Абетка коду.
 *
 * Без `0`, `O`, `1`, `I` і `5`/`S`: код диктують голосом і набирають у чужій
 * програмі, часто не дивлячись. Втрата ентропії тут дешевша за повторний
 * обмін, а того, що лишилося, з запасом вистачає: 30 знаків у шостому степені
 * при житті в кілька хвилин і одноразовому обміні.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
const LENGTH = 6;

/**
 * Шість знаків із криптографічно випадкових байтів.
 *
 * Модуль від 256 до 30 дає невеликий перекіс на початок абетки, і це прийнято
 * свідомо: код живе хвилини, одноразовий і не захищає нічого, крім самого
 * обміну. Рівномірність коштувала б циклу відкидання заради різниці, якої тут
 * не видно навіть у теорії.
 */
export function randomPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** sha256 у hex — і для коду, і для сирих байтів частини пакета. */
export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Випадковий токен каналу — ті самі байти, що й у звичайного токена. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
