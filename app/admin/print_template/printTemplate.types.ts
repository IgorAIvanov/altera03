export interface LookupOption {
  value: string;
  label: string;
}

import type {
  PrintTemplateBlock,
  PrintTemplateBlockPlacement,
  PrintTemplateBlockTextOptions,
  PrintTemplateOrientation,
  PrintTemplatePaperSize,
  PrintTemplateSchema,
  PrintTemplateTableColumnItem,
  PrintTemplateTargetModel,
} from '@shared/printTemplateSchema';

export type {
  PrintTemplateBlock,
  PrintTemplateBlockPlacement,
  PrintTemplateBlockPlacementMode,
  PrintTemplateBlockType,
  PrintTemplateColumnAlign,
  PrintTemplateFieldListBlock,
  PrintTemplateFieldListItem,
  PrintTemplateFontWeight,
  PrintTemplateHorizontalLineBlock,
  PrintTemplateImageBlock,
  PrintTemplateLineStyle,
  PrintTemplateOrientation,
  PrintTemplatePaperSize,
  PrintTemplateSchema,
  PrintTemplateTableBlock,
  PrintTemplateTableColumnItem,
  PrintTemplateBlockTextOptions,
  PrintTemplateTargetModel,
  PrintTemplateTextBlock,
  PrintTemplateTextStyle,
  PrintTemplateVerticalLineBlock,
} from '@shared/printTemplateSchema';

export interface PrintTemplateItem {
  id: string | null;
  code: string;
  name: string;
  targetModel: PrintTemplateTargetModel;
  dataCommand: string;
  paperSize: PrintTemplatePaperSize;
  orientation: PrintTemplateOrientation;
  isDefault: boolean;
  isActive: boolean;
  schema: PrintTemplateSchema;
}

export interface PrintTemplateRow {
  id: string;
  code: string;
  name: string;
  targetModel: PrintTemplateTargetModel;
  dataCommand: string;
  paperSize: PrintTemplatePaperSize;
  orientation: PrintTemplateOrientation;
  isDefault: boolean;
  isActive: boolean;
}

export interface PrintTemplateIndexData {
  rows: PrintTemplateRow[];
  lookups: {
    targetModels: LookupOption[];
    orientations: LookupOption[];
  };
  totals: {
    count: number;
    page: number;
    pageSize: number;
  };
  extra: Record<string, never>;
}

export interface PrintTemplateLoadData {
  item: PrintTemplateItem | null;
  lookups: {
    targetModels: LookupOption[];
    orientations: LookupOption[];
    columnAlignments: LookupOption[];
  };
  totals: Record<string, never>;
  extra: Record<string, never>;
}

export interface PrintTemplateUpdateData {
  item: PrintTemplateItem | null;
}

export interface PrintTemplateDeleteData {
  deletedId: string;
}

export interface PrintTemplateFetchData {
  rows: LookupOption[];
}

export type PrintTemplateSortBy = 'code' | 'name' | 'targetModel' | 'isDefault' | 'isActive';
export type SortDirection = 'asc' | 'desc';

export interface PrintTemplateIndexPayload {
  search?: string;
  targetModel?: PrintTemplateTargetModel | null;
  isActive?: boolean | null;
  page?: number;
  pageSize?: number;
  sortBy?: PrintTemplateSortBy;
  sortDirection?: SortDirection;
}

export interface PrintTemplateLoadPayload {
  id: string;
}

export interface PrintTemplateUpdatePayload {
  item: PrintTemplateItem;
}

export interface PrintTemplateDeletePayload {
  id: string;
}

export interface PrintTemplateFetchPayload {
  targetModel?: PrintTemplateTargetModel;
  search?: string;
  limit?: number;
}

export function createDefaultPrintTemplateTableColumns(): PrintTemplateTableColumnItem[] {
  return [
    {
      key: crypto.randomUUID(),
      title: 'Колонка 1',
      path: '',
      widthPercent: '20',
      headerAlign: 'left',
      headerFontWeight: 'bold',
      headerFontSize: '',
      headerColor: '',
      valueAlign: 'left',
      valueFontWeight: 'normal',
      valueFontSize: '',
      valueColor: '',
    },
  ];
}

export function createDefaultPrintTemplateBlockPlacement(): PrintTemplateBlockPlacement {
  return {
    mode: 'absolute',
    xPercent: '0',
    yPercent: '0',
    widthPercent: '100',
    heightPercent: '0',
  };
}

export function createDefaultPrintTemplateBlockTextOptions(fontSize = '10'): PrintTemplateBlockTextOptions {
  return {
    fontSize,
    align: 'left',
    fontWeight: 'normal',
    color: '#262626',
  };
}

export function createDefaultPrintTemplateBlocks(): PrintTemplateBlock[] {
  return [
    {
      key: crypto.randomUUID(),
      type: 'text',
      style: 'title',
      value: 'Друкований документ',
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: { fontSize: '16', align: 'center', fontWeight: 'bold', color: '#262626' },
    },
    {
      key: crypto.randomUUID(),
      type: 'field-list',
      items: [
        { key: crypto.randomUUID(), label: 'Поле 1', path: '' },
      ],
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    },
    {
      key: crypto.randomUUID(),
      type: 'table',
      title: 'Таблиця',
      source: '',
      columns: createDefaultPrintTemplateTableColumns(),
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    },
    {
      key: crypto.randomUUID(),
      type: 'image',
      src: '',
      alt: 'Логотип',
      placement: {
        ...createDefaultPrintTemplateBlockPlacement(),
        widthPercent: '24',
        heightPercent: '12',
      },
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    },
  ];
}

export function createPrintTemplateBlock(type: 'text' | 'field-list' | 'table' | 'image' | 'horizontal-line' | 'vertical-line'): PrintTemplateBlock {
  if (type === 'text') {
    return {
      key: crypto.randomUUID(),
      type: 'text',
      style: 'body',
      value: '',
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    };
  }

  if (type === 'field-list') {
    return {
      key: crypto.randomUUID(),
      type: 'field-list',
      items: [{ key: crypto.randomUUID(), label: '', path: '' }],
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    };
  }

  if (type === 'table') {
    return {
      key: crypto.randomUUID(),
      type: 'table',
      title: '',
      source: '',
      columns: [{
        key: crypto.randomUUID(),
        title: '',
        path: '',
        widthPercent: '20',
        headerAlign: 'left',
        headerFontWeight: 'bold',
        headerFontSize: '',
        headerColor: '',
        valueAlign: 'left',
        valueFontWeight: 'normal',
        valueFontSize: '',
        valueColor: '',
      }],
      placement: createDefaultPrintTemplateBlockPlacement(),
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    };
  }

  if (type === 'image') {
    return {
      key: crypto.randomUUID(),
      type: 'image',
      src: '',
      alt: '',
      placement: {
        ...createDefaultPrintTemplateBlockPlacement(),
        widthPercent: '24',
        heightPercent: '12',
      },
      text: createDefaultPrintTemplateBlockTextOptions('10'),
    };
  }

  if (type === 'horizontal-line') {
    return {
      key: crypto.randomUUID(),
      type: 'horizontal-line',
      placement: {
        ...createDefaultPrintTemplateBlockPlacement(),
        widthPercent: '100',
        heightPercent: '1',
      },
      text: createDefaultPrintTemplateBlockTextOptions('10'),
      color: '#595959',
      lineStyle: 'solid',
      lineWidth: '2',
    };
  }

  return {
    key: crypto.randomUUID(),
    type: 'vertical-line',
    placement: {
      ...createDefaultPrintTemplateBlockPlacement(),
      widthPercent: '1',
      heightPercent: '18',
    },
    text: createDefaultPrintTemplateBlockTextOptions('10'),
    color: '#595959',
    lineStyle: 'solid',
    lineWidth: '2',
  };
}

export function createDefaultPrintTemplateSchema(): PrintTemplateSchema {
  return {
    schemaVersion: 2,
    blocks: createDefaultPrintTemplateBlocks(),
  };
}