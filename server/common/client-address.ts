import { getServerConfig } from "../config/server-config.ts";
import type { HttpRequest } from "./http.ts";

/**
 * Адреса клієнта для обмеження спроб входу.
 *
 * ЧОМУ ЇЇ ПРИНОСИТЬ ЗАСТОСУНОК. Адреса з'єднання є лише в `Deno.serve` — другим
 * аргументом обробника, — а `Deno.serve` належить composition root, не
 * бібліотеці. Тож застосунок віддає її сюди (`rememberClientAddress`) до того,
 * як передати запит далі, а фреймворк дістає її за тим самим об'єктом
 * `Request`: Hono кладе в `c.req.raw` рівно те, що отримав. Заголовок як
 * перевізник не годиться — його прислав би й клієнт.
 *
 * WeakMap — щоб запис жив рівно стільки, скільки запит.
 */
const addresses = new WeakMap<Request, string>();

/** Те, що `Deno.serve` дає другим аргументом обробника; нам потрібна адреса. */
export interface ClientConnectionInfo {
  remoteAddr?: { hostname?: string } | Deno.Addr;
}

/**
 * Запам'ятати адресу з'єднання для цього запиту. Кличе composition root:
 *
 * ```ts
 * const handler = (request: Request, info?: Deno.ServeHandlerInfo) => {
 *   if (info) rememberClientAddress(request, info);
 *   …
 * };
 * ```
 *
 * Без цього виклику адреса невідома, і обмеження спроб працює лише за логіном.
 */
export function rememberClientAddress(request: Request, info: ClientConnectionInfo): void {
  const remote = info.remoteAddr as { hostname?: unknown } | undefined;
  if (typeof remote?.hostname === "string" && remote.hostname) {
    addresses.set(request, remote.hostname);
  }
}

/**
 * Адреса клієнта в тому вигляді, яким її рахує обмеження спроб, або `null`.
 *
 * `null` і для петлі (`127.0.0.1`, `::1`): так виглядає власний зворотний
 * проксі без налаштованого заголовка, і тоді всі клієнти мали б одну адресу —
 * лічильник на адресу закрив би вхід усім, щойно хтось почне атаку.
 */
export function clientAddress(request: HttpRequest): string | null {
  const header = getServerConfig().auth.clientAddressHeader;
  const raw = header
    ? request.header(header)?.split(",")[0]
    : addresses.get(request.raw);
  return normalizeClientAddress(raw ?? "");
}

/**
 * Ключ адреси: IPv4 як є, IPv6 — мережа /64.
 *
 * Абонент IPv6 отримує щонайменше /64, тобто 2^64 адрес, — лічильник на
 * окрему адресу атака обходила б, міняючи її на кожну спробу. IPv4,
 * вкладений у IPv6 (`::ffff:1.2.3.4`), розгортається у звичайний IPv4.
 */
export function normalizeClientAddress(value: string): string | null {
  let text = value.trim().toLowerCase();
  if (!text) return null;
  // `[::1]:1234` і зона `fe80::1%eth0` — з заголовків трапляється всяке.
  if (text.startsWith("[")) text = text.slice(1, text.indexOf("]") > 0 ? text.indexOf("]") : undefined);
  text = text.split("%")[0];

  const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) text = mapped[1];

  if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) {
    return text.startsWith("127.") ? null : text;
  }
  // IPv4 з портом із заголовка: `1.2.3.4:5678`.
  const withPort = text.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  if (withPort) return withPort[1].startsWith("127.") ? null : withPort[1];

  const groups = expandIpv6(text);
  if (!groups) return null;
  if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return null; // ::1
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** Вісім груп IPv6 числами або `null`, якщо це не адреса. */
function expandIpv6(text: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(text) || !text.includes(":")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => part ? part.split(":") : [];
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.some((group) => group.length === 0 || group.length > 4)) return null;
  return all.map((group) => Number.parseInt(group, 16));
}
