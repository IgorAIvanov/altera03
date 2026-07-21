// Фабрики блоків для редактора шаблону друку.
//
// Формат блоків визначає ядро (server/modules/print/print-template.ts) — звідси
// беруться ТІЛЬКИ типи, цей import стирається при збірці. Тут — те, що потрібно
// редактору: створення нового блока з дефолтами та клонування.

import type {
  PrintTemplateBlock,
  PrintTemplateBlockPlacement,
  PrintTemplateBlockTextOptions,
  PrintTemplateBlockType,
  PrintTemplateTableColumnItem,
} from "../../../server/modules/print/print-template.ts";

export const BLOCK_TYPES: PrintTemplateBlockType[] = [
  "text",
  "field-list",
  "table",
  "image",
  "horizontal-line",
  "vertical-line",
];

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

export function createTableColumn(index: number): PrintTemplateTableColumnItem {
  return {
    key: newKey(),
    title: `Колонка ${index}`,
    path: "",
    widthPercent: "20",
    headerAlign: "left",
    headerFontWeight: "bold",
    headerFontSize: "",
    headerColor: "",
    valueAlign: "left",
    valueFontWeight: "normal",
    valueFontSize: "",
    valueColor: "",
  };
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
    return {
      key: newKey(),
      type: "table",
      title: "",
      source: "",
      columns: [createTableColumn(1)],
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
    return { ...block, key: newKey(), columns: block.columns.map((column) => ({ ...column, key: newKey() })) };
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
