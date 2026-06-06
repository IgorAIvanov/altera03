const PBKDF2_PREFIX = "pbkdf2_sha256";
const PBKDF2_ITERATIONS = 310000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_SALT_LENGTH = 16;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    PBKDF2_KEY_LENGTH * 8,
  );

  return new Uint8Array(derivedBits);
}

export async function hashPassword(password: string): Promise<string> {
  const trimmedPassword = password.normalize("NFKC");
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_LENGTH));
  const hash = await derivePbkdf2(trimmedPassword, salt, PBKDF2_ITERATIONS);
  return [
    PBKDF2_PREFIX,
    String(PBKDF2_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(hash),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const normalizedHash = storedHash.trim();
  if (!normalizedHash) {
    return false;
  }

  const [prefix, iterationsValue, saltValue, hashValue] = normalizedHash.split("$");
  if (!prefix || !iterationsValue || !saltValue || !hashValue) {
    return false;
  }

  if (prefix !== PBKDF2_PREFIX) {
    return false;
  }

  const iterations = Number.parseInt(iterationsValue, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const salt = base64ToBytes(saltValue);
  const expectedHash = base64ToBytes(hashValue);
  const actualHash = await derivePbkdf2(password.normalize("NFKC"), salt, iterations);
  return constantTimeEqual(actualHash, expectedHash);
}