// Фабрики блоків для редактора шаблону друку.
//
// Формат блоків визначає ядро (server/modules/print/print-template.ts) — звідси
// беруться ТІЛЬКИ типи, цей import стирається при збірці. Тут — те, що потрібно
// редактору: створення нового блока з дефолтами та клонування.

import type {
  BarcodeSymbology,
  PrintTemplateBlock,
  PrintTemplateBlockPlacement,
  PrintTemplateBlockTextOptions,
  PrintTemplateBlockType,
  PrintTemplateFieldListItem,
  PrintTemplateTableColumn,
} from "@altera/server/print";
import { createCell, createRow } from "./printTemplate.grid.ts";

export const BLOCK_TYPES: PrintTemplateBlockType[] = [
  "text",
  "field-list",
  "table",
  "repeat",
  "image",
  "barcode",
  "char-cells",
  "horizontal-line",
  "vertical-line",
];

/**
 * Символіки для випадайки. Список повторює ядро свідомо: тип імпортується, тож
 * зайве значення тут не скомпілюється, а рантайм-коду ядра в бандл не тягнемо.
 */
export const BARCODE_SYMBOLOGIES: BarcodeSymbology[] = ["code128", "ean13", "qr"];

function newKey() {
  return crypto.randomUUID();
}

export function createPlacement(patch?: Partial<PrintTemplateBlockPlacement>): PrintTemplateBlockPlacement {
  return {
    mode: "absolute",
    xPercent: "0",
    yPercent: "0",
    widthPercent: "100",
    heightPercent: "0",
    gapPt: "",
    ...patch,
  };
}

export function createTextOptions(patch?: Partial<PrintTemplateBlockTextOptions>): PrintTemplateBlockTextOptions {
  return {
    fontSize: "10",
    align: "left",
    fontWeight: "normal",
    color: "#262626",
    ...patch,
  };
}

/** Колонка сітки — лише ключ і ширина: заголовки живуть у комірках секцій. */
export function createTableColumn(): PrintTemplateTableColumn {
  // Обидва поля ширини заповнені однаково: `width` читає рендерер, `widthPercent`
  // лишається для шаблонів, збережених старішою версією редактора.
  return { key: newKey(), width: "20", minPt: "", widthPercent: "20", visibleWhen: "" };
}

export function createFieldItem(index: number): PrintTemplateFieldListItem {
  return { key: newKey(), label: `Поле ${index}`, path: "", format: "", visibleWhen: "" };
}

export function createBlock(type: PrintTemplateBlockType): PrintTemplateBlock {
  if (type === "text") {
    return {
      key: newKey(),
      type: "text",
      style: "body",
      value: "Текст",
      path: "",
      format: "",
      textOrientation: "0",
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ heightPercent: "6" }),
      text: createTextOptions(),
    };
  }

  if (type === "field-list") {
    return {
      key: newKey(),
      type: "field-list",
      items: [createFieldItem(1)],
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ heightPercent: "12" }),
      text: createTextOptions(),
    };
  }

  if (type === "table") {
    // Стартова сітка 3×(шапка+рядок): є що виділяти й об'єднувати одразу.
    const columns = [createTableColumn(), createTableColumn(), createTableColumn()];
    return {
      key: newKey(),
      type: "table",
      title: "",
      source: "",
      columns,
      sections: {
        header: [{ key: newKey(), visibleWhen: "", cells: ["Колонка 1", "Колонка 2", "Колонка 3"].map((text) => createCell({ text, fontWeight: "bold" })) }],
        row: [createRow(columns.length)],
        footer: [],
      },
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ heightPercent: "20" }),
      text: createTextOptions(),
    };
  }

  if (type === "repeat") {
    return {
      key: newKey(),
      type: "repeat",
      source: "",
      pageBreakBetween: true,
      blocks: [],
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      // Рамка повторювача на папір не йде — він розкривається в план рендеру, а
      // не малюється. На полотні вона потрібна лише щоб блок було за що вхопити
      // й видно, де він у стосі стоїть.
      placement: createPlacement({ mode: "flow", gapPt: "0", heightPercent: "4" }),
      text: createTextOptions(),
    };
  }

  if (type === "image") {
    return {
      key: newKey(),
      type: "image",
      src: "",
      path: "",
      alt: "",
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ widthPercent: "24", heightPercent: "12" }),
      text: createTextOptions(),
    };
  }

  if (type === "barcode") {
    return {
      key: newKey(),
      type: "barcode",
      symbology: "code128",
      value: "",
      path: "",
      showText: true,
      // Пропорції під лінійний код: приблизно 45×15 мм на A4. Для QR ширину
      // зазвичай зменшують — він квадратний і бере меншу зі сторін.
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ widthPercent: "30", heightPercent: "7" }),
      text: createTextOptions({ fontSize: "8", align: "center" }),
    };
  }

  if (type === "char-cells") {
    return {
      key: newKey(),
      type: "char-cells",
      value: "",
      path: "",
      // 12 — ІПН: найчастіше поле по клітинках на українських бланках.
      count: "12",
      borderColor: "#262626",
      lineWidth: "1",
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ widthPercent: "40", heightPercent: "3" }),
      text: createTextOptions({ fontSize: "11" }),
    };
  }

  if (type === "horizontal-line") {
    return {
      key: newKey(),
      type: "horizontal-line",
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ widthPercent: "100", heightPercent: "1" }),
      text: createTextOptions(),
      color: "#595959",
      lineStyle: "solid",
      lineWidth: "2",
    };
  }

  return {
    key: newKey(),
    type: "vertical-line",
    visibleWhen: "",
    keepTogether: false,
    pageBreakBefore: false,
    placement: createPlacement({ widthPercent: "1", heightPercent: "18" }),
    text: createTextOptions(),
    color: "#595959",
    lineStyle: "solid",
    lineWidth: "2",
  };
}

export function cloneBlock(block: PrintTemplateBlock): PrintTemplateBlock {
  if (block.type === "field-list") {
    return { ...block, key: newKey(), items: block.items.map((item) => ({ ...item, key: newKey() })) };
  }

  if (block.type === "table") {
    const cloneRows = (rows: typeof block.sections.header) =>
      rows.map((row) => ({ ...row, key: newKey(), cells: row.cells.map((cell) => ({ ...cell, key: newKey() })) }));

    return {
      ...block,
      key: newKey(),
      columns: block.columns.map((column) => ({ ...column, key: newKey() })),
      sections: {
        header: cloneRows(block.sections.header),
        row: cloneRows(block.sections.row),
        footer: cloneRows(block.sections.footer),
      },
    };
  }

  if (block.type === "repeat") {
    return { ...block, key: newKey(), blocks: block.blocks.map((child) => cloneBlock(child)) };
  }

  return { ...block, key: newKey() };
}

/** Стартовий шаблон нового запису — щоб на аркуші одразу було що рухати. */
export function createDefaultBlocks(): PrintTemplateBlock[] {
  return [
    {
      key: newKey(),
      type: "text",
      style: "title",
      value: "Друкована форма",
      path: "",
      format: "",
      textOrientation: "0",
      visibleWhen: "",
      keepTogether: false,
      pageBreakBefore: false,
      placement: createPlacement({ heightPercent: "8" }),
      text: createTextOptions({ fontSize: "16", align: "center", fontWeight: "bold" }),
    },
  ];
}
