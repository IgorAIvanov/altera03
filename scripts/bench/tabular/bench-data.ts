/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// scripts/ не входить у workspace, тож бере compilerOptions кореня — там
// бібліотеки DOM немає. Директиви вмикають її для цих файлів, щоб
// `deno task check` (він перевіряє й ./scripts) проходив.
/**
 * Синтетичний документ інвентаризації: рядки й опис колонок.
 *
 * Набір колонок узятий не зі стелі — це те, що реально стоїть в
 * інвентаризаційній відомості: дві ссылки (номенклатура, одиниця), три
 * десяткові поля й три обчислювані з підсумками. П'ять контролів на рядок —
 * саме та величина, через яку тисяча рядків і стає проблемою.
 */
import { dec, type TabularColumn } from "@client/ui-kit/tabular/tabular-section.ts";

export interface BenchLine {
  id: string | null;
  lineNo: number;
  nomenclatureId: string;
  nomenclature: { id: string; name: string } | null;
  unitId: string;
  unit: { id: string; name: string } | null;
  qtyAcc: string;
  qtyFact: string;
  price: string;
}

const UNITS = ["шт", "кг", "м", "л", "уп"];

const NOUNS = [
  "Кабель силовий",
  "Автомат захисту",
  "Лампа світлодіодна",
  "Розетка вбудована",
  "Вимикач одноклавішний",
  "Короб кабельний",
  "Клемна колодка",
  "Гофра ПВХ",
];

/** Один і той самий набір на кожен прогін — заміри мають бути порівнянні. */
export function makeLines(count: number): BenchLine[] {
  const lines: BenchLine[] = [];
  for (let i = 0; i < count; i++) {
    const noun = NOUNS[i % NOUNS.length];
    const unit = UNITS[i % UNITS.length];
    lines.push({
      id: String(i + 1),
      lineNo: i + 1,
      nomenclatureId: String(1000 + i),
      nomenclature: { id: String(1000 + i), name: `${noun} ${(i % 97) + 1}×${(i % 7) + 1}` },
      unitId: String(i % UNITS.length + 1),
      unit: { id: String(i % UNITS.length + 1), name: unit },
      qtyAcc: (((i * 37) % 900) / 10 + 1).toFixed(3),
      qtyFact: (((i * 41) % 900) / 10 + 1).toFixed(3),
      price: (((i * 13) % 5000) / 10 + 5).toFixed(2),
    });
  }
  return lines;
}

const amount = (qty: string, price: string) => dec(qty).mul(dec(price)).toFixed(2);

export const benchColumns: Array<TabularColumn<BenchLine>> = [
  {
    kind: "picker",
    key: "nomenclatureId",
    refKey: "nomenclature",
    title: "bench.nomenclature",
    url: "catalog/nomenclature",
    width: "22rem",
    required: true,
  },
  {
    kind: "picker",
    key: "unitId",
    refKey: "unit",
    title: "bench.unit",
    url: "catalog/unit",
    width: "6rem",
  },
  { kind: "decimal", key: "qtyAcc", title: "bench.qtyAcc", precision: 3, width: "8rem" },
  { kind: "decimal", key: "qtyFact", title: "bench.qtyFact", precision: 3, width: "8rem" },
  { kind: "decimal", key: "price", title: "bench.price", precision: 2, width: "8rem" },
  {
    kind: "computed",
    title: "bench.sumAcc",
    width: "9rem",
    total: true,
    value: (l) => amount(l.qtyAcc, l.price),
  },
  {
    kind: "computed",
    title: "bench.sumFact",
    width: "9rem",
    total: true,
    value: (l) => amount(l.qtyFact, l.price),
  },
  {
    kind: "computed",
    title: "bench.diff",
    width: "9rem",
    total: true,
    value: (l) => dec(l.qtyFact).minus(dec(l.qtyAcc)).mul(dec(l.price)).toFixed(2),
  },
];
