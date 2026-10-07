/**
 * Шифрування секретів моделей — AES-256-GCM з WebCrypto.
 *
 * Модуль чистий навмисно (ні бази, ні конфігурації): помилка тут не падає
 * голосно, а тихо робить секрет нечитаним, тож він тримається окремо й під
 * пробами — та сама причина, що в `common/messages.ts`.
 *
 * Додаткові дані (AAD) — «модель:id:поле». Без них шифротекст, переставлений
 * рукою в інший рядок `app.secret` (токен рахунку A в рахунок B), розшифрувався
 * б мовчки; з ними він не розшифрується зовсім.
 */

/** Ключ, готовий до роботи, і його відбиток для `app.secret.key_id`. */
export interface SecretKey {
  id: string;
  key: CryptoKey;
}

/** Зашифрований секрет — рівно те, що лягає в рядок таблиці. */
export interface SealedSecret {
  iv: Uint8Array<ArrayBuffer>;
  cipher: Uint8Array<ArrayBuffer>;
  keyId: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.trim());
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Ключ із рядка оточення: base64 рівно 32 байтів. Інша довжина — помилка, а
 * не «підрізати й працювати»: короткий ключ, мовчки доповнений нулями, давав
 * би шифр, слабший за обіцяний, і ніхто б цього не побачив.
 */
export async function importSecretKey(base64: string): Promise<SecretKey> {
  const raw = decodeBase64(base64);
  if (!raw || raw.length !== KEY_BYTES) {
    throw new Error(
      `ключ секретів мусить бути base64 рівно ${KEY_BYTES} байтів — згенеруй: ` +
        `deno eval "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"`,
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const id = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id, key };
}

function aad(model: string, ownerId: string, field: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`${model}:${ownerId}:${field}`));
}

export async function sealSecret(
  key: SecretKey,
  value: string,
  owner: { model: string; id: string; field: string },
): Promise<SealedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(owner.model, owner.id, owner.field) },
      key.key,
      new TextEncoder().encode(value),
    ),
  );
  return { iv, cipher, keyId: key.id };
}

/**
 * Розшифрувати тим ключем, яким зашифровано. Ключа з таким відбитком немає —
 * помилка з назвою відбитка: найчастіше це замінений `SECRET_KEY` без
 * `SECRET_KEY_PREVIOUS`, і людині треба знати саме це, а не «не вдалося».
 */
export async function openSecret(
  keys: SecretKey[],
  sealed: SealedSecret,
  owner: { model: string; id: string; field: string },
): Promise<string> {
  const key = keys.find((candidate) => candidate.id === sealed.keyId);
  if (!key) {
    throw new Error(
      `секрет ${owner.model}:${owner.id}:${owner.field} зашифровано ключем ${sealed.keyId}, ` +
        `якого немає ні в SECRET_KEY, ні в SECRET_KEY_PREVIOUS`,
    );
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv, additionalData: aad(owner.model, owner.id, owner.field) },
    key.key,
    sealed.cipher,
  );
  return new TextDecoder().decode(plain);
}
