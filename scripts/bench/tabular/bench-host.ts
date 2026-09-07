/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// scripts/ не входить у workspace, тож бере compilerOptions кореня — там
// бібліотеки DOM немає. Директиви вмикають її для цих файлів, щоб
// `deno task check` (він перевіряє й ./scripts) проходив.
/**
 * Хост секції — мінімальна форма: рівно те, що робить `BaseUI` для табличної
 * частини, і нічого більше.
 *
 * `$root` тут справжній — `deep()` із signal-utils, той самий, що в
 * `BaseUI`: тисяча рядків у глибокому проксі це частина вимірюваної вартості,
 * і підмінити його простим масивом означало б заміряти не те.
 */
import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { SignalWatcher } from "@lit-labs/signals";
import { deep } from "signal-utils/deep";
import { GlobalStyledLitElement } from "@client/ui-kit/base/gsle.ts";
import { TabularSection } from "@client/ui-kit/tabular/tabular-section.ts";
import "@client/ui-kit/tabular/ui-tabular-table.ts";
import { type BenchLine, benchColumns } from "./bench-data.ts";

const Base: typeof GlobalStyledLitElement = SignalWatcher(GlobalStyledLitElement);

@customElement("bench-host")
export class BenchHost extends Base {
  readonly $root: { item: { lines: BenchLine[] } } = deep({ item: { lines: [] as BenchLine[] } });

  readonly section: TabularSection<BenchLine> = new TabularSection<BenchLine>(this, {
    rows: () => this.$root.item.lines,
    setRows: (lines) => {
      this.$root.item = { ...this.$root.item, lines };
    },
    createLine: () => ({
      id: null,
      lineNo: 0,
      nomenclatureId: "",
      nomenclature: null,
      unitId: "",
      unit: null,
      qtyAcc: "0.000",
      qtyFact: "0.000",
      price: "0.00",
    }),
    columns: benchColumns,
  });

  setLines(lines: BenchLine[]) {
    this.$root.item = { ...this.$root.item, lines };
  }

  /** Елемент таблиці — раннер чекає на його `updateComplete`. */
  get table(): (HTMLElement & { updateComplete: Promise<boolean> }) | null {
    return this.renderRoot.querySelector("ui-tabular-table");
  }

  override render(): TemplateResult {
    return html`<ui-tabular-table .section=${this.section}></ui-tabular-table>`;
  }
}
