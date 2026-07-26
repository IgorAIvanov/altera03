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
  PrintTemplateTableColumn,
} from "../../../server/modules/print/print-template.ts";
import { createCell, createRow } from "./printTemplate.grid.ts";

export const BLOCK_TYPES: PrintTemplateBlockType[] = [
  "text",
  "field-list",
  "table",
  "image",
  "barcode",
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
  return { key: newKey(), widthPercent: "20" };
}

export function createFieldItem(index: number) {
  return { key: newKey(), label: `Поле ${index}`, path: "" };
}

export function createBlock(type: PrintTemplateBlockType): PrintTemplateBlock {
  if (type === "text") {
    return {
      key: newKey(),
      type: "text",
      style: "body",
      value: "Текст",
      placement: createPlacement({ heightPercent: "6" }),
      text: createTextOptions(),
    };
  }

  if (type === "field-list") {
    return {
      key: newKey(),
      type: "field-list",
      items: [createFieldItem(1)],
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
        header: [{ key: newKey(), cells: ["Колонка 1", "Колонка 2", "Колонка 3"].map((text) => createCell({ text, fontWeight: "bold" })) }],
        row: [createRow(columns.length)],
        footer: [],
      },
      placement: createPlacement({ heightPercent: "20" }),
      text: createTextOptions(),
    };
  }

  if (type === "image") {
    return {
      key: newKey(),
      type: "image",
      src: "",
      alt: "",
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
      placement: createPlacement({ widthPercent: "30", heightPercent: "7" }),
      text: createTextOptions({ fontSize: "8", align: "center" }),
    };
  }

  if (type === "horizontal-line") {
    return {
      key: newKey(),
      type: "horizontal-line",
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
      rows.map((row) => ({ key: newKey(), cells: row.cells.map((cell) => ({ ...cell, key: newKey() })) }));

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
      placement: createPlacement({ heightPercent: "8" }),
      text: createTextOptions({ fontSize: "16", align: "center", fontWeight: "bold" }),
    },
  ];
}
