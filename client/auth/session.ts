/**
 * Стан сесії на клієнті.
 *
 * Токена тут немає й бути не може — він у httpOnly-cookie, недосяжний для JS.
 * Зберігаємо лише те, що потрібне інтерфейсу: хто увійшов і що йому дозволено.
 *
 * Права беремо один раз при вході (`app.access_effective`) і питаємо локально:
 * інакше кожна кнопка ходила б на сервер.
 */
import { Signal } from "signal-polyfill";
import { apiFetch, readEnvelope, setSessionLostHandler } from "../data/api.ts";

export interface SessionUser {
  id: string;
  login: string;
  fullName: string;
}

export interface SessionInfo {
  id: string;
  authMethod: string;
  expiresAt: string;
}

/** Перший запуск: чи треба створювати адміністратора. */
export interface BootstrapState {
  needsSetup: boolean;
  predefinedUserAvailable: boolean;
  predefinedLogin: string | null;
}

export interface AuthMethodOption {
  key: string;
  label: string;
}

/** Пара «модель + дія» з app.access_effective. */
interface PermissionRow {
  model: string;
  action: string;
}

const _user = new Signal.State<SessionUser | null>(null);
const _session = new Signal.State<SessionInfo | null>(null);

export const currentUser = (): SessionUser | null => _user.get();
export const currentSession = (): SessionInfo | null => _session.get();

let permissions = new Set<string>();

function permissionKey(model: string, action: string): string {
  return `${model}:${action}`;
}

/** Чи дозволена дія над моделлю. `*` у правах означає «всі моделі». */
export function can(model: string, action: string): boolean {
  return permissions.has(permissionKey("*", action)) || permissions.has(permissionKey(model, action));
}

function firstMessage(messages: string[]): string {
  return messages[0] ?? "Не вдалося виконати запит";
}

async function loadPermissions(): Promise<void> {
  try {
    const response = await apiFetch("/api/auth/permissions");
    const envelope = await readEnvelope<never, PermissionRow>(response);
    permissions = new Set((envelope.data?.rows ?? []).map((row) => permissionKey(row.model, row.action)));
  } catch {
    // Права не критичні для входу: без них інтерфейс просто обережніший.
    permissions = new Set();
  }
}

function applySession(item: { user: SessionUser; session: SessionInfo } | null): boolean {
  _user.set(item?.user ?? null);
  _session.set(item?.session ?? null);
  if (!item) permissions = new Set();
  return !!item;
}

/** Чи є жива сесія. Викликається на старті ДО підняття оболонки. */
export async function restoreSession(): Promise<boolean> {
  const response = await apiFetch("/api/auth/me");
  const envelope = await readEnvelope<{ user: SessionUser; session: SessionInfo }>(response);

  // `ok: false` тут не розбираємо навмисно: сесії однаково немає, і показати
  // причину краще на екрані входу — у нього для цього є місце, а тут немає.
  if (!applySession(envelope.data?.item ?? null)) {
    return false;
  }

  await loadPermissions();
  return true;
}

export async function fetchBootstrapState(): Promise<BootstrapState> {
  const response = await apiFetch("/api/auth/bootstrap-state");
  const envelope = await readEnvelope<BootstrapState>(response);

  // Раніше відмова мовчки ставала дефолтом, і зламаний сервер виглядав як
  // звичайний екран входу: користувач вводив пароль і отримував таку саму
  // мовчанку. Причина від сервера є — її й показуємо.
  if (!envelope.ok || !envelope.data?.item) {
    throw new Error(firstMessage(envelope.messages ?? []));
  }

  return envelope.data.item;
}

export async function fetchAuthMethods(): Promise<AuthMethodOption[]> {
  const response = await apiFetch("/api/auth/methods");
  const envelope = await readEnvelope<never, AuthMethodOption>(response);
  return envelope.data?.rows ?? [];
}

/** Вхід. Кидає помилку з текстом від сервера, якщо не вийшло. */
export async function login(payload: Record<string, unknown>): Promise<void> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const envelope = await readEnvelope<{ user: SessionUser; session: SessionInfo }>(response);
  if (!envelope.ok) {
    throw new Error(firstMessage(envelope.messages));
  }

  applySession(envelope.data.item);
  await loadPermissions();
}

/** Створення першого адміністратора. Після успіху сесія вже є. */
export async function createFirstUser(input: {
  login: string;
  password: string;
  fullName: string;
}): Promise<void> {
  const response = await apiFetch("/api/auth/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  const envelope = await readEnvelope<{ user: SessionUser; session: SessionInfo }>(response);
  if (!envelope.ok) {
    throw new Error(firstMessage(envelope.messages));
  }

  applySession(envelope.data.item);
  await loadPermissions();
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    applySession(null);
  }
}

/**
 * Сесія померла посеред роботи (транспорт не зміг її продовжити). Скидаємо
 * стан і перезавантажуємо сторінку — так гарантовано зникає все, що встигло
 * намалюватися для попереднього користувача.
 */
setSessionLostHandler(() => {
  applySession(null);
  globalThis.location?.reload();
});
