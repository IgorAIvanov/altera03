/**
 * Період — пара ISO-дат `dateFrom..dateTo`, обидві включно: саме так його
 * приймають SQL-функції звітів. Тут — конструктори календарних періодів,
 * розпізнавання «це рівно місяць/квартал/рік», зсув на попередній/наступний
 * і людська підпис («Липень 2026», «III квартал 2026», «01.07.26 — 15.07.26»).
 *
 * Використовує ISO-контракт `datetime.ts`: значення без часових поясів,
 * порівнюються як рядки.
 */
import { getLocale, t } from "../locale.ts";
import {
  dateFormat,
  type DateParts,
  daysInMonth,
  formatDate,
  todayIso,
  toParts,
} from "./datetime.ts";

export interface Period {
  dateFrom: string;
  dateTo: string;
}

export type PeriodUnit = "day" | "week" | "month" | "quarter" | "year";

/**
 * Одиниця, якою період можна ВИБРАТИ, а не лише назвати.
 *
 * Вужче за `PeriodUnit` навмисно: день і тиждень сюди не входять, бо сітка для
 * них — це календар, і він уже є (`<ui-date>`). Питання «за який день» ставлять
 * датою, «за який місяць» — місяцем, і саме другого не було чим намалювати.
 */
export type PeriodPickUnit = "month" | "quarter" | "year";

const PICK_UNITS: readonly PeriodPickUnit[] = ["month", "quarter", "year"];

export interface PeriodUnitChoice {
  /** Одиниці в оголошеному порядку; порожньо — режиму одиниці немає. */
  units: PeriodPickUnit[];
  /** Чи лишається довільний відрізок як окремий вибір. */
  custom: boolean;
}

/**
 * Розбір переліку одиниць (`units="month,quarter,year"` або `"month"`).
 *
 * Порядок зберігається — він задає і порядок вкладок, і те, яка одиниця діє за
 * умовчанням. Невідоме слово ПРОПУСКАЄТЬСЯ з попередженням, а не мовчки:
 * мовчазне ковтання чужої властивості вже одного разу коштувало пошуків
 * (порожній `<ui-picker>`), і тут воно виглядало б так само — перелік просто не
 * той, який написали.
 *
 * Перелік із самого `custom` одиницею не є: це та сама пара дат, що й без
 * `units`, і вкладка з одного пункту — не вибір.
 */
export function parsePeriodUnits(spec: string): PeriodUnitChoice {
  const units: PeriodPickUnit[] = [];
  let custom = false;

  for (const raw of spec.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    if (token === "custom") {
      custom = true;
    } else if ((PICK_UNITS as readonly string[]).includes(token)) {
      if (!units.includes(token as PeriodPickUnit)) units.push(token as PeriodPickUnit);
    } else {
      console.warn(
        `[period] невідома одиниця «${token}» — очікується month | quarter | year | custom`,
      );
    }
  }

  return { units, custom };
}

/**
 * Назви місяців мовою інтерфейсу, з великої літери, від січня.
 *
 * Тут, а не в компоненті: підпис періоду вже будується цим модулем тим самим
 * `Intl`, і дві точки, де вибирається мова назви місяця, розійшлися б у
 * відмінку («Липень» проти «липня») — а це видно лише на екрані.
 */
export function monthNames(style: "long" | "short" = "short"): string[] {
  const locale = getLocale();
  const fmt = new Intl.DateTimeFormat(locale, { month: style });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(Date.UTC(2026, i, 1)));
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  });
}

const DAY_MS = 86_400_000;

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Зсув ISO-дати на `days` днів (через UTC — без стрибків переходу на літній час). */
function addDays(iso: string, days: number): string {
  const p = toParts(iso)!;
  return isoOf(new Date(Date.UTC(p.year, p.month - 1, p.day + days)));
}

/** Перше число місяця; `month` може виходити за 1..12 — Date нормалізує. */
function monthStart(year: number, month: number): string {
  return isoOf(new Date(Date.UTC(year, month - 1, 1)));
}

/** Останнє число місяця (нульовий день наступного). */
function monthEnd(year: number, month: number): string {
  return isoOf(new Date(Date.UTC(year, month, 0)));
}

function spanDays(a: DateParts, b: DateParts): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Понеділок = 0 ... неділя = 6 — тиждень у системі починається з понеділка. */
function weekday(p: DateParts): number {
  return (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
}

/**
 * Календарний період заданої одиниці, що містить дату `base` (типово сьогодні):
 * `periodOf("month")` — поточний місяць, `periodOf("quarter", "2026-05-10")` —
 * II квартал 2026.
 */
export function periodOf(unit: PeriodUnit, base: string = todayIso()): Period {
  const p = toParts(base) ?? toParts(todayIso())!;
  switch (unit) {
    case "day": {
      const iso = formatDate(base, "YYYY-MM-DD") || todayIso();
      return { dateFrom: iso, dateTo: iso };
    }
    case "week": {
      const wd = weekday(p);
      const iso = formatDate(base, "YYYY-MM-DD") || todayIso();
      return { dateFrom: addDays(iso, -wd), dateTo: addDays(iso, 6 - wd) };
    }
    case "month":
      return { dateFrom: monthStart(p.year, p.month), dateTo: monthEnd(p.year, p.month) };
    case "quarter": {
      const first = Math.floor((p.month - 1) / 3) * 3 + 1;
      return { dateFrom: monthStart(p.year, first), dateTo: monthEnd(p.year, first + 2) };
    }
    case "year":
      return { dateFrom: `${p.year}-01-01`, dateTo: `${p.year}-12-31` };
  }
}

/**
 * Якій календарній одиниці період дорівнює РІВНО. `null` — довільний відрізок.
 * Рік і квартал перевіряються раніше за місяць, бо formально вони теж
 * «з першого по останнє число».
 */
export function periodUnit(p: Period): PeriodUnit | null {
  const a = toParts(p.dateFrom);
  const b = toParts(p.dateTo);
  if (!a || !b) return null;

  if (a.year === b.year && a.month === b.month && a.day === b.day) return "day";

  const wholeMonths = a.day === 1 && b.day === daysInMonth(b.year, b.month);
  if (wholeMonths && a.year === b.year) {
    if (a.month === 1 && b.month === 12) return "year";
    if (a.month % 3 === 1 && b.month === a.month + 2) return "quarter";
    if (a.month === b.month) return "month";
  }

  if (spanDays(a, b) === 6 && weekday(a) === 0) return "week";

  return null;
}

/**
 * Попередній (`-1`) чи наступний (`+1`) період тієї ж величини.
 *
 * Період із цілих місяців (місяць, квартал, рік, а також довільні «з 1-го по
 * останнє») зсувається місяцями — інакше лютий з'їдав би дні. Решта — на
 * власну довжину в днях. Період без обох дат повертається як є.
 */
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  const a = toParts(p.dateFrom);
  const b = toParts(p.dateTo);
  if (!a || !b) return p;

  if (a.day === 1 && b.day === daysInMonth(b.year, b.month)) {
    const months = (b.year - a.year) * 12 + (b.month - a.month) + 1;
    return {
      dateFrom: monthStart(a.year, a.month + dir * months),
      dateTo: monthEnd(b.year, b.month + dir * months),
    };
  }

  const days = dir * (spanDays(a, b) + 1);
  return { dateFrom: addDays(p.dateFrom, days), dateTo: addDays(p.dateTo, days) };
}

/**
 * «III» у «III квартал 2026» — і воно ж у комірці сітки кварталів.
 *
 * Експортоване саме тому, що місць два: римська нумерація, розписана двічі,
 * розійшлася б рівно там, де її ніхто не звіряє.
 */
export const QUARTER_ROMAN: readonly string[] = ["I", "II", "III", "IV"];

/**
 * Людська підпис періоду мовою інтерфейсу: календарний період називається
 * («Липень 2026», «III квартал 2026», «2026»), довільний показується парою дат
 * за шаблоном `format`. Порожній період → порожній рядок.
 */
export function periodLabel(p: Period, format: string = dateFormat.date): string {
  const from = formatDate(p.dateFrom, format);
  const to = formatDate(p.dateTo, format);
  if (!from && !to) return "";
  if (!from || !to) return `${from || "…"} — ${to || "…"}`;

  const a = toParts(p.dateFrom)!;
  switch (periodUnit(p)) {
    case "day":
      return from;
    case "month": {
      const name = new Intl.DateTimeFormat(getLocale(), { month: "long", year: "numeric" })
        .format(new Date(Date.UTC(a.year, a.month - 1, 1)));
      return name.charAt(0).toLocaleUpperCase(getLocale()) + name.slice(1);
    }
    case "quarter": {
      const q = Math.floor((a.month - 1) / 3);
      return t("period.quarterOfYear", { q: QUARTER_ROMAN[q], year: a.year });
    }
    case "year":
      return String(a.year);
    default:
      return `${from} — ${to}`;
  }
}
