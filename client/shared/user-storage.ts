/**
 * `localStorage`, розділений за користувачем.
 *
 * Інтерфейсний стан — відкриті вкладки, обрана організація — переживає
 * перезавантаження свідомо: повертатися до роботи там, де її лишив, зручно.
 * Але зберігався він під спільним ключем, і на спільній машині наступний
 * користувач отримував чужий набір вкладок і чужу організацію. Дані при цьому
 * підтягувалися його власні (права перевіряє сервер), та бачити, з чим працював
 * попередній, він не мав.
 *
 * Чистити при виході — неправильна відповідь: тоді той самий користувач
 * втрачав би свої вкладки щоразу, а це якраз корисна поведінка. Правильна —
 * ключ із ідентифікатором користувача, що тут і зроблено.
 *
 * Без відомого користувача не читаємо й не пишемо взагалі. Це не крайній
 * випадок, а норма: до входу сесії ще немає, і будь-яке значення в цей момент
 * належало б невідомо кому.
 */
import { currentUser } from "../auth/session.ts";

function scopedKey(base: string): string | null {
  const user = currentUser();
  return user ? `${base}:${user.id}` : null;
}

/** Значення поточного користувача або `null` — і якщо його немає, і якщо немає користувача. */
export function readUserScoped(base: string): unknown {
  const key = scopedKey(base);
  if (!key) return null;

  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Зіпсований JSON або приватний режим — поводимося як за відсутності значення.
    return null;
  }
}

export function writeUserScoped(base: string, value: unknown): void {
  const key = scopedKey(base);
  if (!key) return;

  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // приватний режим / переповнене сховище — не критично для роботи
  }
}

export function removeUserScoped(base: string): void {
  const key = scopedKey(base);
  if (!key) return;

  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // те саме: втрата запису тут ні на що не впливає
  }
}

/**
 * Прибрати значення, збережене до поділу за користувачем.
 *
 * Не переносимо його на поточного користувача навмисно: невідомо, чий він, а
 * привласнити чуже — рівно та вада, яку цей модуль і закриває. Ціна — один раз
 * втрачені відкриті вкладки; вони однаково не знайшлися б за новим ключем.
 */
export function dropLegacyKey(base: string): void {
  try {
    globalThis.localStorage?.removeItem(base);
  } catch {
    // нічого не вдієш і нічого не втрачаємо
  }
}
