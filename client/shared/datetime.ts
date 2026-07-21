/**
 * Формат дати/часу для UI — єдине джерело правди для форм і списків.
 *
 * У моделі дата завжди живе в ISO (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`) — саме
 * так її віддає і приймає PostgreSQL. Формат нижче керує ЛИШЕ відображенням
 * та розбором вводу, тому одна й та сама дата може показуватись по-різному в
 * різних місцях (`DD.MM.YY` у списку, `DD.MM.YYYY HH:mm` у формі).
 *
 * Шаблон — рядок із токенів: `YYYY` `YY` `MM` `DD` `HH` `mm` `ss`.
 * Роздільники довільні. Набір токенів визначає, яку частину дати показуємо:
 * `MM.YYYY` — тільки місяць, `HH:mm` — тільки час.
 */

/** Токени шаблона та їх ширина в цифрах (для розбору «злитого» вводу). */
const TOKEN_WIDTH: Record<string, number> = {
  YYYY: 4, YY: 2, MM: 2, DD: 2, HH: 2, mm: 2, ss: 2,
};

const TOKEN_RE = /YYYY|YY|MM|DD|HH|mm|ss/g;

/** Межа для дворічного року: `69` → 2069, `70` → 1970. */
const CENTURY_PIVOT = 70;

/** Типові шаблони. Змінюй тут — зміниться в усій системі. */
export const dateFormat = {
  /** Дата у формі та списку за замовчуванням. */
  date: "DD.MM.YY",
  /** Дата з повним роком — для друкованих форм і звітів. */
  dateFull: "DD.MM.YYYY",
  /** Дата з часом. */
  dateTime: "DD.MM.YY HH:mm",
  /** Тільки час. */
  time: "HH:mm",
  /** Тільки період (місяць/рік) — для регістрів і залишків. */
  month: "MM.YYYY",
} as const;

/** Розібрана дата у «календарних» числах (без часових поясів). */
export interface DateParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * ISO-рядок (або Date) → частини дати.
 *
 * Значення розбирається ЯК Є, без переведення в часовий пояс: `2026-07-20`
 * лишається 20 липня в будь-якій зоні. Суфікс `Z`/`+03:00` ігнорується —
 * у системі час зберігається без зони.
 */
export function toParts(value: string | Date | null | undefined): DateParts | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds(),
    };
  }

  const s = String(value);

  const time = TIME_RE.exec(s);
  if (time) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: Number(time[1]),
      minute: Number(time[2]),
      second: Number(time[3] ?? 0),
    };
  }

  const m = ISO_RE.exec(s);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
  };
}

/** Частини дати → ISO-рядок. Наявність часу визначає шаблон. */
export function fromParts(p: DateParts, format: string): string {
  const hasDate = /YYYY|YY|MM|DD/.test(format);
  const hasTime = /HH|mm|ss/.test(format);
  const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  if (!hasDate) return time;
  return hasTime ? `${date}T${time}` : date;
}

/** Чи існує така дата (`31.02` — ні). */
export function isValidParts(p: DateParts): boolean {
  if (p.month < 1 || p.month > 12 || p.day < 1) return false;
  if (p.hour > 23 || p.minute > 59 || p.second > 59) return false;
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day));
  // Date «перекочує» 31.02 на 03.03 — порівнюємо, чи день лишився тим самим
  return dt.getUTCDate() === p.day && dt.getUTCMonth() === p.month - 1;
}

/**
 * ISO → текст за шаблоном. Невалідне/порожнє значення → `""`.
 *
 * ```ts
 * formatDate("2026-07-20")                      // "20.07.26"
 * formatDate("2026-07-20", dateFormat.dateFull) // "20.07.2026"
 * formatDate("2026-07-20T09:05:00", dateFormat.dateTime) // "20.07.26 09:05"
 * ```
 */
export function formatDate(
  value: string | Date | null | undefined,
  format: string = dateFormat.date,
): string {
  const p = toParts(value);
  if (!p) return "";
  return format.replace(TOKEN_RE, (tok) => {
    switch (tok) {
      case "YYYY": return pad(p.year, 4);
      case "YY": return pad(p.year % 100);
      case "MM": return pad(p.month);
      case "DD": return pad(p.day);
      case "HH": return pad(p.hour);
      case "mm": return pad(p.minute);
      case "ss": return pad(p.second);
      default: return tok;
    }
  });
}

/**
 * Текст користувача → ISO. Повертає `""`, якщо розібрати не вдалося.
 *
 * Приймає як розділений, так і злитий ввід; відсутні частини бере з `base`
 * (поточне значення поля), а якщо його немає — з сьогоднішньої дати:
 *
 * ```ts
 * parseDate("20.07.26")  // "2026-07-20"
 * parseDate("200726")    // "2026-07-20"  — злитий ввід за ширинами токенів
 * parseDate("20.07")     // "2026-07-20"  — рік із base/сьогодні
 * parseDate("20")        // "2026-07-20"  — місяць і рік із base/сьогодні
 * ```
 */
export function parseDate(
  text: string,
  format: string = dateFormat.date,
  base?: string | null,
): string {
  const raw = text.trim();
  if (!raw) return "";

  const tokens = format.match(TOKEN_RE) ?? [];
  if (!tokens.length) return "";

  const groups = raw.match(/\d+/g) ?? [];
  if (!groups.length) return "";

  const width = (tok: string | undefined): number => (tok ? TOKEN_WIDTH[tok] ?? 2 : 2);

  let values: string[];
  if (groups.length === 1 && groups[0].length > width(tokens[0])) {
    // «200726» — ріжемо один довгий ланцюжок за ширинами токенів
    values = [];
    let rest = groups[0];
    for (const tok of tokens) {
      // «20072026» під `DD.MM.YYYY` — 4 цифри року; «200726» — стільки, скільки лишилось
      const w = tok === "YYYY" && rest.length === 2 ? 2 : width(tok);
      if (!rest.length) break;
      values.push(rest.slice(0, w));
      rest = rest.slice(w);
    }
    if (rest.length) return ""; // зайві цифри — ввід не за шаблоном
  } else {
    values = groups.slice(0, tokens.length);
  }

  const fallback = toParts(base) ?? toParts(new Date())!;
  const p: DateParts = { ...fallback, hour: 0, minute: 0, second: 0 };
  // з base переносимо тільки те, що шаблон показує; решта — нулі
  if (/HH/.test(format)) p.hour = fallback.hour;
  if (/mm/.test(format)) p.minute = fallback.minute;
  if (/ss/.test(format)) p.second = fallback.second;

  values.forEach((v, i) => {
    const n = Number(v);
    switch (tokens[i]) {
      // «20.07.26» у полі з YYYY — теж рік, просто скорочений
      case "YYYY":
      case "YY":
        p.year = v.length > 2 ? n : n < CENTURY_PIVOT ? 2000 + n : 1900 + n;
        break;
      case "MM": p.month = n; break;
      case "DD": p.day = n; break;
      case "HH": p.hour = n; break;
      case "mm": p.minute = n; break;
      case "ss": p.second = n; break;
    }
  });

  // шаблон без дня (напр. `MM.YYYY`) — перше число місяця
  if (!/DD/.test(format)) p.day = 1;

  return isValidParts(p) ? fromParts(p, format) : "";
}

/** Сьогоднішня дата в ISO (локальна, без часу). */
export function todayIso(): string {
  const n = new Date();
  return `${pad(n.getFullYear(), 4)}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** Кількість днів у місяці (1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
