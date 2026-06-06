import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Collapse, Dropdown, Form, Input, Select, Space, Spin, Typography } from 'antd';
import { AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BoldOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, HolderOutlined, MoreOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CardPageHeader } from '@shared/cardPageHeader';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { useModelCard } from '@shared/modelCard';
import { getFeatureManifestByModel } from '@shared/featureManifest';
import { requireModelViewPath } from '@shared/featureNavigation';
import { closeWorkspaceTab, emitWorkspaceTabTitle, replaceWorkspaceTabPath } from '@shared/workspaceTabs';
import { publishModelSaved } from '@shared/workspaceEvents';
import { useI18n } from '@i18n/i18n';
import manifest from './manifest.json';
import PrintTemplateForm from './printTemplateForm';
import PreviewObjectPicker from './previewObjectPicker';
import { buildPrintTemplateRenderPlan } from '@shared/printTemplateRenderPlan';
import { normalizePrintTemplateSchema, resolvePrintTemplatePath, sanitizePrintTemplateBlocks } from '@shared/printTemplateSchema';
import type {
  PrintTemplateBlock,
  PrintTemplateBlockType,
  PrintTemplateBlockTextOptions,
  PrintTemplateItem,
  PrintTemplateLoadData,
  PrintTemplateLoadPayload,
  PrintTemplateTableColumnItem,
  PrintTemplateUpdateData,
  PrintTemplateUpdatePayload,
} from './printTemplate.types';
import { createDefaultPrintTemplateSchema, createPrintTemplateBlock } from './printTemplate.types';

const runtime = createModelRuntime(manifest);
const listPath = requireModelViewPath(manifest.model, 'list');
const editPath = requireModelViewPath(manifest.model, 'edit');
const { Text } = Typography;

const emptyItem: PrintTemplateItem = {
  id: null,
  code: '',
  name: '',
  targetModel: '',
  dataCommand: 'load',
  paperSize: 'A4',
  orientation: 'portrait',
  isDefault: false,
  isActive: true,
  schema: createDefaultPrintTemplateSchema(),
};

const defaultPreviewDocument: Record<string, never> = {};
const defaultPreviewDataText = '';
const defaultPreviewRequestPayloadText = '{}\n';
type PrintTemplatePreviewDataSource = 'empty' | 'manual' | 'model';

function buildTitle(item: Partial<PrintTemplateItem>, fallback: string) {
  const parts = [item.code?.trim(), item.name?.trim()].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : fallback;
}

function normalizeLoadedItem(item: PrintTemplateItem | null): PrintTemplateItem | null {
  if (!item) {
    return null;
  }

  const schema = normalizePrintTemplateSchema(item.schema) ?? createDefaultPrintTemplateSchema();

  return {
    ...emptyItem,
    ...item,
    schema,
  };
}

function normalizePreviewRequestPayload(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractPreviewRequestId(text: string): string | undefined {
  const payload = normalizePreviewRequestPayload(text);
  return typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : undefined;
}

function stringifyPreviewRequestPayload(payload: Record<string, unknown>) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function previewAlignToText(align: PrintTemplateBlockTextOptions['align']) {
  if (align === 'right') {
    return 'right';
  }

  if (align === 'center') {
    return 'center';
  }

  return 'left';
}

function resolveColumnFontSize(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(72, Math.max(6, parsed));
}

function clampWidthPercent(value: number) {
  return Math.min(100, Math.max(5, value));
}

function clampHeightPercent(value: number) {
  return Math.min(100, Math.max(1, value));
}

function clampPositionPercent(value: number, sizePercent: number) {
  return Math.min(Math.max(0, 100 - Math.max(sizePercent, 0)), Math.max(0, value));
}

const SNAP_THRESHOLD_PERCENT = 1.2;

interface PrintTemplateSnapGuide {
  orientation: 'vertical' | 'horizontal';
  positionPercent: number;
}

interface PrintTemplateSnapTarget {
  value: number;
}

function getPlacementBounds(placement: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }) {
  const left = placement.xPercent;
  const top = placement.yPercent;
  const width = placement.widthPercent;
  const height = placement.heightPercent;

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + (width / 2),
    centerY: top + (height / 2),
  };
}

function resolveSnapDelta(anchorValues: number[], candidates: PrintTemplateSnapTarget[]) {
  let bestMatch: { delta: number; guide: number; distance: number } | null = null;

  for (const anchorValue of anchorValues) {
    for (const candidate of candidates) {
      const delta = candidate.value - anchorValue;
      const distance = Math.abs(delta);
      if (distance > SNAP_THRESHOLD_PERCENT) {
        continue;
      }

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { delta, guide: candidate.value, distance };
      }
    }
  }

  return bestMatch;
}

function getSnapTargets(blocks: PrintTemplatePreviewBlock[], currentBlockKey: string) {
  const targetsX: PrintTemplateSnapTarget[] = [{ value: 0 }, { value: 50 }, { value: 100 }];
  const targetsY: PrintTemplateSnapTarget[] = [{ value: 0 }, { value: 50 }, { value: 100 }];

  for (const block of blocks) {
    if (block.key === currentBlockKey) {
      continue;
    }

    const bounds = getPlacementBounds(block.placement);
    targetsX.push({ value: bounds.left }, { value: bounds.centerX }, { value: bounds.right });
    targetsY.push({ value: bounds.top }, { value: bounds.centerY }, { value: bounds.bottom });
  }

  return { targetsX, targetsY };
}

function applyMoveSnap(
  blockKey: string,
  visual: { blockKey: string; xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  blocks: PrintTemplatePreviewBlock[],
) {
  const { targetsX, targetsY } = getSnapTargets(blocks, blockKey);
  const bounds = getPlacementBounds(visual);
  const guides: PrintTemplateSnapGuide[] = [];

  const xMatch = resolveSnapDelta([bounds.left, bounds.centerX, bounds.right], targetsX);
  const yMatch = resolveSnapDelta([bounds.top, bounds.centerY, bounds.bottom], targetsY);

  if (xMatch) {
    guides.push({ orientation: 'vertical', positionPercent: xMatch.guide });
  }
  if (yMatch) {
    guides.push({ orientation: 'horizontal', positionPercent: yMatch.guide });
  }

  return {
    visual: {
      ...visual,
      xPercent: clampPositionPercent(visual.xPercent + (xMatch?.delta ?? 0), visual.widthPercent),
      yPercent: clampPositionPercent(visual.yPercent + (yMatch?.delta ?? 0), visual.heightPercent),
    },
    guides,
  };
}

function applyResizeSnap(
  blockKey: string,
  visual: { blockKey: string; xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  blocks: PrintTemplatePreviewBlock[],
  canResizeHeight: boolean,
) {
  const { targetsX, targetsY } = getSnapTargets(blocks, blockKey);
  const guides: PrintTemplateSnapGuide[] = [];
  let nextWidth = visual.widthPercent;
  let nextHeight = visual.heightPercent;

  const widthMatch = resolveSnapDelta([visual.xPercent + visual.widthPercent], targetsX);
  if (widthMatch) {
    nextWidth = clampWidthPercent((visual.xPercent + visual.widthPercent + widthMatch.delta) - visual.xPercent);
    guides.push({ orientation: 'vertical', positionPercent: widthMatch.guide });
  }

  if (canResizeHeight) {
    const heightMatch = resolveSnapDelta([visual.yPercent + visual.heightPercent], targetsY);
    if (heightMatch) {
      nextHeight = clampHeightPercent((visual.yPercent + visual.heightPercent + heightMatch.delta) - visual.yPercent);
      guides.push({ orientation: 'horizontal', positionPercent: heightMatch.guide });
    }
  }

  return {
    visual: {
      ...visual,
      widthPercent: nextWidth,
      heightPercent: nextHeight,
    },
    guides,
  };
}

function sanitizeTemplateFileName(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized || 'print_template';
}

function buildTemplateFilePayload(baseItem: PrintTemplateItem, nextValues?: Partial<PrintTemplateItem>) {
  const mergedValues = {
    ...baseItem,
    ...nextValues,
  } as PrintTemplateItem;

  return {
    code: mergedValues.code.trim(),
    name: mergedValues.name.trim(),
    targetModel: mergedValues.targetModel.trim(),
    dataCommand: mergedValues.dataCommand.trim(),
    paperSize: mergedValues.paperSize,
    orientation: mergedValues.orientation,
    isDefault: mergedValues.isDefault,
    isActive: mergedValues.isActive,
    schema: {
      schemaVersion: 2 as const,
      blocks: sanitizePrintTemplateBlocks(mergedValues.schema.blocks),
    },
  };
}

function buildImportedTemplateItem(source: unknown, currentId: string | null): PrintTemplateItem {
  const raw = (source && typeof source === 'object' ? source : {}) as Partial<PrintTemplateItem>;
  const schema = normalizePrintTemplateSchema(raw.schema) ?? createDefaultPrintTemplateSchema();

  return {
    ...emptyItem,
    ...raw,
    id: currentId,
    code: typeof raw.code === 'string' ? raw.code : emptyItem.code,
    name: typeof raw.name === 'string' ? raw.name : emptyItem.name,
    targetModel: typeof raw.targetModel === 'string' ? raw.targetModel : emptyItem.targetModel,
    dataCommand: typeof raw.dataCommand === 'string' ? raw.dataCommand : emptyItem.dataCommand,
    paperSize: raw.paperSize === 'A4' ? raw.paperSize : emptyItem.paperSize,
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    isDefault: typeof raw.isDefault === 'boolean' ? raw.isDefault : emptyItem.isDefault,
    isActive: typeof raw.isActive === 'boolean' ? raw.isActive : emptyItem.isActive,
    schema,
  };
}

function clonePrintTemplateBlock(block: PrintTemplateBlock): PrintTemplateBlock {
  const nextKey = crypto.randomUUID();

  if (block.type === 'field-list') {
    return {
      ...block,
      key: nextKey,
      items: block.items.map((item) => ({
        ...item,
        key: crypto.randomUUID(),
      })),
    };
  }

  if (block.type === 'table') {
    return {
      ...block,
      key: nextKey,
      columns: block.columns.map((column) => ({
        ...column,
        key: crypto.randomUUID(),
      })),
    };
  }

  return {
    ...block,
    key: nextKey,
  };
}

interface PrintTemplatePathOption {
  value: string;
  label: string;
}

function joinPrintTemplatePath(prefix: string, segment: string) {
  return prefix ? `${prefix}.${segment}` : segment;
}

function collectScalarPathOptions(source: unknown, prefix = '', options: PrintTemplatePathOption[] = []): PrintTemplatePathOption[] {
  if (source === null || source === undefined) {
    if (prefix) {
      options.push({ value: prefix, label: prefix });
    }
    return options;
  }

  if (Array.isArray(source)) {
    return options;
  }

  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      collectScalarPathOptions(value, joinPrintTemplatePath(prefix, key), options);
    }
    return options;
  }

  if (prefix) {
    options.push({ value: prefix, label: prefix });
  }

  return options;
}

function collectArrayPathOptions(source: unknown, prefix = '', options: PrintTemplatePathOption[] = []): PrintTemplatePathOption[] {
  if (Array.isArray(source)) {
    if (prefix) {
      options.push({ value: prefix, label: prefix });
    }
    return options;
  }

  if (!source || typeof source !== 'object') {
    return options;
  }

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    collectArrayPathOptions(value, joinPrintTemplatePath(prefix, key), options);
  }

  return options;
}

function sortPrintTemplatePathOptions(options: PrintTemplatePathOption[]) {
  return [...options].sort((left, right) => left.label.localeCompare(right.label, 'uk'));
}

function ensureSelectedPathOption(options: PrintTemplatePathOption[], value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue || options.some((option) => option.value === normalizedValue)) {
    return options;
  }

  return [{ value: normalizedValue, label: normalizedValue }, ...options];
}

function movePrintTemplateItem<TItem>(items: TItem[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) {
    return items;
  }

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function duplicatePrintTemplateItem<TItem extends { key: string }>(items: TItem[], itemKey: string, duplicateItem: (item: TItem) => TItem) {
  const itemIndex = items.findIndex((item) => item.key === itemKey);
  if (itemIndex === -1) {
    return items;
  }

  const sourceItem = items[itemIndex];
  if (!sourceItem) {
    return items;
  }

  const nextItems = [...items];
  nextItems.splice(itemIndex + 1, 0, duplicateItem(sourceItem));
  return nextItems;
}

function createPrintTemplateFieldItem(fieldIndex: number) {
  return {
    key: crypto.randomUUID(),
    label: `Поле ${fieldIndex}`,
    path: '',
  };
}

function clonePrintTemplateFieldItem(fieldItem: { key: string; label: string; path: string }) {
  return {
    ...fieldItem,
    key: crypto.randomUUID(),
  };
}

function createPrintTemplateTableColumn(columnIndex: number): PrintTemplateTableColumnItem {
  return {
    key: crypto.randomUUID(),
    title: `Колонка ${columnIndex}`,
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
  };
}

function clonePrintTemplateTableColumn(column: PrintTemplateTableColumnItem): PrintTemplateTableColumnItem {
  return {
    ...column,
    key: crypto.randomUUID(),
  };
}


function PrintTemplatePreviewHost({
  form,
  item,
  previewData,
  previewDataSourceLabel,
  schemaBlocks,
  onSchemaBlocksChange,
  onAddBlock,
}: {
  form: ReturnType<typeof Form.useForm<PrintTemplateItem>>[0];
  item: PrintTemplateItem;
  previewData: unknown;
  previewDataSourceLabel: string;
  schemaBlocks: PrintTemplateItem['schema']['blocks'];
  onSchemaBlocksChange: (blocks: PrintTemplateItem['schema']['blocks']) => void;
  onAddBlock?: (blockType: PrintTemplateBlockType) => void;
}) {
  // Watch scalar form fields (orientation, paperSize, etc.) to keep preview in sync
  // with those changes. Blocks are managed via the schemaBlocks state prop, not via
  // Form.useWatch, because schema.blocks is not a registered Form.Item.
  const watchedScalars = Form.useWatch([], form) as Partial<PrintTemplateItem> | undefined;
  const previewItem = useMemo(() => {
    const schema = normalizePrintTemplateSchema({ schemaVersion: 2, blocks: schemaBlocks }) ?? item.schema;
    return { ...item, ...(watchedScalars ?? {}), schema };
  }, [item, watchedScalars, schemaBlocks]);

  const updateSchemaBlocks = (nextBlocks: PrintTemplateItem['schema']['blocks']) => {
    onSchemaBlocksChange(nextBlocks);
  };

  const updatePreviewPlacement = (blockKey: string, nextPlacement: { xPercent?: string; yPercent?: string; widthPercent?: string; heightPercent?: string }) => {
    const blockIndex = schemaBlocks.findIndex((block) => block.key === blockKey);
    if (blockIndex === -1) {
      return;
    }

    updateSchemaBlocks(schemaBlocks.map((block, index) => {
      if (index !== blockIndex) {
        return block;
      }

      return {
        ...block,
        placement: {
          ...block.placement,
          ...(nextPlacement.xPercent !== undefined ? { xPercent: nextPlacement.xPercent } : null),
          ...(nextPlacement.yPercent !== undefined ? { yPercent: nextPlacement.yPercent } : null),
          ...(nextPlacement.widthPercent !== undefined ? { widthPercent: nextPlacement.widthPercent } : null),
          ...(nextPlacement.heightPercent !== undefined ? { heightPercent: nextPlacement.heightPercent } : null),
        },
      };
    }));
  };

  const updatePreviewBlockContent = (blockKey: string, nextValue: string) => {
    const blockIndex = schemaBlocks.findIndex((block) => block.key === blockKey);
    if (blockIndex === -1) {
      return;
    }

    const block = schemaBlocks[blockIndex];
    if (!block || block.type !== 'text') {
      return;
    }

    updateSchemaBlocks(schemaBlocks.map((entry, index) => {
      if (index !== blockIndex || entry.type !== 'text') {
        return entry;
      }

      return {
        ...entry,
        value: nextValue,
      };
    }));
  };

  const updatePreviewBlockTextOptions = (blockKey: string, nextTextOptions: Partial<PrintTemplateBlockTextOptions>) => {
    const blockIndex = schemaBlocks.findIndex((block) => block.key === blockKey);
    if (blockIndex === -1) {
      return;
    }

    updateSchemaBlocks(schemaBlocks.map((block, index) => {
      if (index !== blockIndex) {
        return block;
      }

      return {
        ...block,
        text: {
          ...block.text,
          ...(nextTextOptions.fontSize !== undefined ? { fontSize: nextTextOptions.fontSize } : null),
          ...(nextTextOptions.align !== undefined ? { align: nextTextOptions.align } : null),
          ...(nextTextOptions.fontWeight !== undefined ? { fontWeight: nextTextOptions.fontWeight } : null),
          ...(nextTextOptions.color !== undefined ? { color: nextTextOptions.color } : null),
        },
      };
    }));
  };

  const updatePreviewBlock = (blockKey: string, updater: (block: PrintTemplateBlock) => PrintTemplateBlock) => {
    const blockIndex = schemaBlocks.findIndex((block) => block.key === blockKey);
    if (blockIndex === -1) {
      return;
    }

    updateSchemaBlocks(schemaBlocks.map((block, index) => {
      if (index !== blockIndex) {
        return block;
      }

      return updater(block);
    }));
  };

  const duplicatePreviewBlock = (blockKey: string) => {
    const blockIndex = schemaBlocks.findIndex((block) => block.key === blockKey);
    if (blockIndex === -1) {
      return null;
    }

    const sourceBlock = schemaBlocks[blockIndex];
    if (!sourceBlock) {
      return null;
    }

    const duplicate = clonePrintTemplateBlock(sourceBlock);
    const nextBlocks = [...schemaBlocks];
    nextBlocks.splice(blockIndex + 1, 0, duplicate);
    updateSchemaBlocks(nextBlocks);
    return duplicate.key;
  };

  const deletePreviewBlock = (blockKey: string) => {
    const nextBlocks = schemaBlocks.filter((block) => block.key !== blockKey);
    if (nextBlocks.length === schemaBlocks.length) {
      return;
    }
    updateSchemaBlocks(nextBlocks);
  };

  return (
    <MemoizedPrintTemplatePreview
      item={previewItem}
      previewData={previewData}
      previewDataSourceLabel={previewDataSourceLabel}
      loading={false}
      onPlacementChange={updatePreviewPlacement}
      onBlockContentChange={updatePreviewBlockContent}
      onBlockTextOptionsChange={updatePreviewBlockTextOptions}
      onBlockChange={updatePreviewBlock}
      onBlockDuplicate={duplicatePreviewBlock}
      onBlockDelete={deletePreviewBlock}
      onAddBlock={onAddBlock}
    />
  );
}



type PrintTemplatePreviewBlock = ReturnType<typeof buildPrintTemplateRenderPlan>[number];
type PrintTemplateTransientPlacement = {
  blockKey: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
};

function PrintTemplatePreview({
  item,
  previewData,
  previewDataSourceLabel,
  loading,
  onPlacementChange,
  onBlockContentChange,
  onBlockTextOptionsChange,
  onBlockChange,
  onBlockDuplicate,
  onBlockDelete,
  onAddBlock,
}: {
  item: PrintTemplateItem;
  previewData: unknown;
  previewDataSourceLabel: string;
  loading: boolean;
  onPlacementChange?: (blockKey: string, nextPlacement: { xPercent?: string; yPercent?: string; widthPercent?: string; heightPercent?: string }) => void;
  onBlockContentChange?: (blockKey: string, nextValue: string) => void;
  onBlockTextOptionsChange?: (blockKey: string, nextTextOptions: Partial<PrintTemplateBlockTextOptions>) => void;
  onBlockChange?: (blockKey: string, updater: (block: PrintTemplateBlock) => PrintTemplateBlock) => void;
  onBlockDuplicate?: (blockKey: string) => string | null;
  onBlockDelete?: (blockKey: string) => void;
  onAddBlock?: (blockType: PrintTemplateBlockType) => void;
}) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const previewPageRef = useRef<HTMLDivElement | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadBlockKeyRef = useRef<string | null>(null);
  const dragStateRef = useRef<{
    mode: 'move' | 'resize';
    blockKey: string;
    startClientX: number;
    startClientY: number;
    startXPercent: number;
    startYPercent: number;
    startWidthPercent: number;
    startHeightPercent: number;
    canResizeHeight: boolean;
    pageWidth: number;
    pageHeight: number;
  } | null>(null);

  const [draggingBlockKey, setDraggingBlockKey] = useState<string | null>(null);
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null);
  const [selectedPreviewColumnKey, setSelectedPreviewColumnKey] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<{ blockKey: string; value: string } | null>(null);
  const [draggingEditorItem, setDraggingEditorItem] = useState<{ kind: 'field-list' | 'table'; key: string } | null>(null);
  const [dragOverEditorItemKey, setDragOverEditorItemKey] = useState<string | null>(null);
  const [draggingPreviewColumn, setDraggingPreviewColumn] = useState<{ blockKey: string; columnKey: string } | null>(null);
  const [dragOverPreviewColumnKey, setDragOverPreviewColumnKey] = useState<string | null>(null);
  const [transientPlacements, setTransientPlacements] = useState<Record<string, PrintTemplateTransientPlacement>>({});
  const [snapGuides, setSnapGuides] = useState<PrintTemplateSnapGuide[]>([]);
  const transientPlacementsRef = useRef<Record<string, PrintTemplateTransientPlacement>>({});
  const previewPageAspectRatio = item.orientation === 'landscape' ? '297 / 210' : '210 / 297';
  const previewPageMaxWidth = item.orientation === 'landscape' ? 1120 : 760;

  const renderPlan = useMemo(() => buildPrintTemplateRenderPlan(item.schema, previewData), [item.schema, previewData]);
  const absoluteBlocks = renderPlan;
  const schemaBlocks = item.schema.blocks;
  const rootScalarPathOptions = useMemo(
    () => sortPrintTemplatePathOptions(collectScalarPathOptions(previewData)),
    [previewData],
  );
  const tableSourceOptions = useMemo(
    () => sortPrintTemplatePathOptions(collectArrayPathOptions(previewData)),
    [previewData],
  );
  const selectedBlock = useMemo(
    () => absoluteBlocks.find((block) => block.key === selectedBlockKey) ?? null,
    [absoluteBlocks, selectedBlockKey],
  );
  const selectedSchemaBlock = useMemo(
    () => schemaBlocks.find((block) => block.key === selectedBlockKey) ?? null,
    [schemaBlocks, selectedBlockKey],
  );
  const selectedSchemaTableColumn = useMemo(
    () => selectedSchemaBlock?.type === 'table' && selectedPreviewColumnKey
      ? selectedSchemaBlock.columns.find((column) => column.key === selectedPreviewColumnKey) ?? null
      : null,
    [selectedPreviewColumnKey, selectedSchemaBlock],
  );

  useEffect(() => {
    if (!selectedBlockKey) {
      return;
    }

    if (!schemaBlocks.some((block) => block.key === selectedBlockKey)) {
      setSelectedBlockKey(null);
    }
  }, [schemaBlocks, selectedBlockKey]);

  useEffect(() => {
    if (!selectedPreviewColumnKey) {
      return;
    }

    if (selectedSchemaBlock?.type !== 'table') {
      setSelectedPreviewColumnKey(null);
      return;
    }

    if (!selectedSchemaBlock.columns.some((column) => column.key === selectedPreviewColumnKey)) {
      setSelectedPreviewColumnKey(null);
    }
  }, [selectedPreviewColumnKey, selectedSchemaBlock]);

  useEffect(() => {
    if (!editingContent) {
      return;
    }

    const block = renderPlan.find((entry) => entry.key === editingContent.blockKey);
    if (!block || block.type !== 'text' || selectedBlockKey !== block.key) {
      setEditingContent(null);
      return;
    }

    const blockValue = block.text;
    if (blockValue === editingContent.value) {
      setEditingContent(null);
    }
  }, [editingContent, renderPlan, selectedBlockKey]);

  const setTransientPlacement = (placement: PrintTemplateTransientPlacement) => {
    transientPlacementsRef.current = {
      ...transientPlacementsRef.current,
      [placement.blockKey]: placement,
    };
    setTransientPlacements(transientPlacementsRef.current);
  };

  const getTransientPlacement = (blockKey: string) => transientPlacementsRef.current[blockKey] ?? null;

  useEffect(() => {
    const entries = Object.entries(transientPlacements);
    if (!entries.length) {
      return;
    }

    const nextPlacements = { ...transientPlacementsRef.current };
    let changed = false;

    for (const [blockKey, placement] of entries) {
      const block = absoluteBlocks.find((entry) => entry.key === blockKey);
      if (!block) {
        delete nextPlacements[blockKey];
        changed = true;
        continue;
      }

      if (
        Math.abs(block.placement.xPercent - placement.xPercent) < 0.02 &&
        Math.abs(block.placement.yPercent - placement.yPercent) < 0.02 &&
        Math.abs(block.placement.widthPercent - placement.widthPercent) < 0.02 &&
        Math.abs(block.placement.heightPercent - placement.heightPercent) < 0.02
      ) {
        delete nextPlacements[blockKey];
        changed = true;
      }
    }

    if (changed) {
      transientPlacementsRef.current = nextPlacements;
      setTransientPlacements(nextPlacements);
    }
  }, [absoluteBlocks, transientPlacements]);

  const handlePagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) {
      return;
    }

    event.preventDefault();

    let visual: PrintTemplateTransientPlacement;
    let guides: PrintTemplateSnapGuide[] = [];

    if (state.mode === 'resize') {
      const nextWidthPercent = clampWidthPercent(
        state.startWidthPercent + (((event.clientX - state.startClientX) / Math.max(state.pageWidth, 1)) * 100),
      );
      const nextHeightPercent = state.canResizeHeight
        ? clampHeightPercent(
          state.startHeightPercent + (((event.clientY - state.startClientY) / Math.max(state.pageHeight, 1)) * 100),
        )
        : state.startHeightPercent;
      visual = {
        blockKey: state.blockKey,
        xPercent: state.startXPercent,
        yPercent: state.startYPercent,
        widthPercent: nextWidthPercent,
        heightPercent: nextHeightPercent,
      };
      const snapped = applyResizeSnap(state.blockKey, visual, absoluteBlocks, state.canResizeHeight);
      visual = snapped.visual;
      guides = snapped.guides;
    } else {
      const nextXPercent = clampPositionPercent(
        state.startXPercent + (((event.clientX - state.startClientX) / Math.max(state.pageWidth, 1)) * 100),
        state.startWidthPercent,
      );
      const nextYPercent = clampPositionPercent(
        state.startYPercent + (((event.clientY - state.startClientY) / Math.max(state.pageHeight, 1)) * 100),
        state.startHeightPercent,
      );
      visual = {
        blockKey: state.blockKey,
        xPercent: nextXPercent,
        yPercent: nextYPercent,
        widthPercent: state.startWidthPercent,
        heightPercent: state.startHeightPercent,
      };
      const snapped = applyMoveSnap(state.blockKey, visual, absoluteBlocks);
      visual = snapped.visual;
      guides = snapped.guides;
    }

    setTransientPlacement(visual);
    setSnapGuides(guides);
  };

  const handlePagePointerUp = () => {
    const activeBlockKey = dragStateRef.current?.blockKey ?? draggingBlockKey;
    const visual = activeBlockKey ? getTransientPlacement(activeBlockKey) : null;
    if (visual && onPlacementChange) {
      onPlacementChange(visual.blockKey, {
        xPercent: visual.xPercent.toFixed(2),
        yPercent: visual.yPercent.toFixed(2),
        widthPercent: visual.widthPercent.toFixed(2),
        heightPercent: visual.heightPercent.toFixed(2),
      });
    }
    dragStateRef.current = null;
    setDraggingBlockKey(null);
    setSnapGuides([]);
  };

  const commitVisualToForm = (blockKey: string) => {
    const visual = getTransientPlacement(blockKey);
    if (!visual || !onPlacementChange) {
      return;
    }

    onPlacementChange(visual.blockKey, {
      xPercent: visual.xPercent.toFixed(2),
      yPercent: visual.yPercent.toFixed(2),
      widthPercent: visual.widthPercent.toFixed(2),
      heightPercent: visual.heightPercent.toFixed(2),
    });
  };

  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize',
    block: PrintTemplatePreviewBlock,
  ) => {
    const pageBounds = previewPageRef.current?.getBoundingClientRect();
    if (!pageBounds || !onPlacementChange) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedBlockKey(block.key);
    setDraggingBlockKey(block.key);
    setSnapGuides([]);
    const pendingVisual = getTransientPlacement(block.key);
    const startXPercent = pendingVisual ? pendingVisual.xPercent : block.placement.xPercent;
    const startYPercent = pendingVisual ? pendingVisual.yPercent : block.placement.yPercent;
    const startWidthPercent = pendingVisual ? pendingVisual.widthPercent : block.placement.widthPercent;
    const startHeightPercent = pendingVisual ? pendingVisual.heightPercent : block.placement.heightPercent;
    const initialVisual = {
      blockKey: block.key,
      xPercent: startXPercent,
      yPercent: startYPercent,
      widthPercent: startWidthPercent,
      heightPercent: startHeightPercent,
    };
    setTransientPlacement(initialVisual);
    dragStateRef.current = {
      mode,
      blockKey: block.key,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startXPercent,
      startYPercent,
      startWidthPercent,
      startHeightPercent,
      canResizeHeight: block.type === 'image' || block.type === 'horizontal-line' || block.type === 'vertical-line',
      pageWidth: pageBounds.width,
      pageHeight: pageBounds.height,
    };
    // Capture the pointer so move/up events are reliably routed to the page
    // container even when the cursor moves outside the block element.
    previewPageRef.current?.setPointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (!selectedBlockKey || !onPlacementChange) {
      return;
    }

    const selectedBlock = absoluteBlocks.find((block) => block.key === selectedBlockKey);
    if (!selectedBlock) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedBlockKey(null);
        return;
      }

      const step = event.shiftKey ? 5 : 1;
      const sourcePlacement = getTransientPlacement(selectedBlock.key) ?? selectedBlock.placement;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.altKey) {
          const nextVisual = {
            blockKey: selectedBlock.key,
            xPercent: sourcePlacement.xPercent,
            yPercent: sourcePlacement.yPercent,
            widthPercent: clampWidthPercent(sourcePlacement.widthPercent - step),
            heightPercent: sourcePlacement.heightPercent,
          };
          setTransientPlacement(nextVisual);
          return;
        }

        const nextVisual = {
          blockKey: selectedBlock.key,
            xPercent: clampPositionPercent(sourcePlacement.xPercent - step, sourcePlacement.widthPercent),
          yPercent: sourcePlacement.yPercent,
          widthPercent: sourcePlacement.widthPercent,
          heightPercent: sourcePlacement.heightPercent,
        };
        setTransientPlacement(nextVisual);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.altKey) {
          const nextVisual = {
            blockKey: selectedBlock.key,
            xPercent: sourcePlacement.xPercent,
            yPercent: sourcePlacement.yPercent,
            widthPercent: clampWidthPercent(sourcePlacement.widthPercent + step),
            heightPercent: sourcePlacement.heightPercent,
          };
          setTransientPlacement(nextVisual);
          return;
        }

        const nextVisual = {
          blockKey: selectedBlock.key,
            xPercent: clampPositionPercent(sourcePlacement.xPercent + step, sourcePlacement.widthPercent),
          yPercent: sourcePlacement.yPercent,
          widthPercent: sourcePlacement.widthPercent,
          heightPercent: sourcePlacement.heightPercent,
        };
        setTransientPlacement(nextVisual);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (event.altKey && (selectedBlock.type === 'image' || selectedBlock.type === 'horizontal-line' || selectedBlock.type === 'vertical-line')) {
          const nextVisual = {
            blockKey: selectedBlock.key,
            xPercent: sourcePlacement.xPercent,
            yPercent: sourcePlacement.yPercent,
            widthPercent: sourcePlacement.widthPercent,
            heightPercent: clampHeightPercent(sourcePlacement.heightPercent - step),
          };
          setTransientPlacement(nextVisual);
          return;
        }

        const nextVisual = {
          blockKey: selectedBlock.key,
          xPercent: sourcePlacement.xPercent,
            yPercent: clampPositionPercent(sourcePlacement.yPercent - step, sourcePlacement.heightPercent),
          widthPercent: sourcePlacement.widthPercent,
          heightPercent: sourcePlacement.heightPercent,
        };
        setTransientPlacement(nextVisual);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.altKey && (selectedBlock.type === 'image' || selectedBlock.type === 'horizontal-line' || selectedBlock.type === 'vertical-line')) {
          const nextVisual = {
            blockKey: selectedBlock.key,
            xPercent: sourcePlacement.xPercent,
            yPercent: sourcePlacement.yPercent,
            widthPercent: sourcePlacement.widthPercent,
            heightPercent: clampHeightPercent(sourcePlacement.heightPercent + step),
          };
          setTransientPlacement(nextVisual);
          return;
        }

        const nextVisual = {
          blockKey: selectedBlock.key,
          xPercent: sourcePlacement.xPercent,
            yPercent: clampPositionPercent(sourcePlacement.yPercent + step, sourcePlacement.heightPercent),
          widthPercent: sourcePlacement.widthPercent,
          heightPercent: sourcePlacement.heightPercent,
        };
        setTransientPlacement(nextVisual);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.key.startsWith('Arrow') || dragStateRef.current) {
        return;
      }

      commitVisualToForm(selectedBlock.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [absoluteBlocks, onPlacementChange, selectedBlockKey, transientPlacements]);

  const selectedTableSource = useMemo(() => {
    if (!selectedSchemaBlock || selectedSchemaBlock.type !== 'table') {
      return null;
    }

    return resolvePrintTemplatePath(previewData, selectedSchemaBlock.source);
  }, [previewData, selectedSchemaBlock]);

  const handleEditorItemDrop = (kind: 'field-list' | 'table', targetKey: string) => {
    if (!selectedBlock || !draggingEditorItem || draggingEditorItem.kind !== kind || draggingEditorItem.key === targetKey) {
      setDragOverEditorItemKey(null);
      return;
    }

    onBlockChange?.(selectedBlock.key, (block) => {
      if (kind === 'field-list' && block.type === 'field-list') {
        const fromIndex = block.items.findIndex((item) => item.key === draggingEditorItem.key);
        const toIndex = block.items.findIndex((item) => item.key === targetKey);
        return {
          ...block,
          items: movePrintTemplateItem(block.items, fromIndex, toIndex),
        };
      }

      if (kind === 'table' && block.type === 'table') {
        const fromIndex = block.columns.findIndex((column) => column.key === draggingEditorItem.key);
        const toIndex = block.columns.findIndex((column) => column.key === targetKey);
        return {
          ...block,
          columns: movePrintTemplateItem(block.columns, fromIndex, toIndex),
        };
      }

      return block;
    });

    setDraggingEditorItem(null);
    setDragOverEditorItemKey(null);
  };

  const handlePreviewColumnDrop = (blockKey: string, targetKey: string) => {
    if (!draggingPreviewColumn || draggingPreviewColumn.blockKey !== blockKey || draggingPreviewColumn.columnKey === targetKey) {
      return;
    }

    onBlockChange?.(blockKey, (block) => {
      if (block.type !== 'table') {
        return block;
      }

      const fromIndex = block.columns.findIndex((column) => column.key === draggingPreviewColumn.columnKey);
      const targetIndex = block.columns.findIndex((column) => column.key === targetKey);
      if (fromIndex < 0 || targetIndex < 0) {
        return block;
      }

      return {
        ...block,
        columns: movePrintTemplateItem(block.columns, fromIndex, targetIndex),
      };
    });

    setDraggingPreviewColumn(null);
    setDragOverPreviewColumnKey(null);
  };

  const addTableColumn = (blockKey: string) => {
    const nextColumn = createPrintTemplateTableColumn(1);
    setSelectedPreviewColumnKey(nextColumn.key);
    onBlockChange?.(blockKey, (block) => (
      block.type === 'table'
        ? {
          ...block,
          columns: [...block.columns, { ...nextColumn, title: `Колонка ${block.columns.length + 1}` }],
        }
        : block
    ));
  };

  const updateTableColumn = (
    blockKey: string,
    columnKey: string,
    updater: (column: PrintTemplateTableColumnItem) => PrintTemplateTableColumnItem,
  ) => {
    onBlockChange?.(blockKey, (block) => (
      block.type === 'table'
        ? {
          ...block,
          columns: block.columns.map((column) => (column.key === columnKey ? updater(column) : column)),
        }
        : block
    ));
  };

  const duplicateTableColumn = (blockKey: string, sourceColumn: PrintTemplateTableColumnItem) => {
    const duplicatedColumn = clonePrintTemplateTableColumn(sourceColumn);
    setSelectedPreviewColumnKey(duplicatedColumn.key);
    onBlockChange?.(blockKey, (block) => {
      if (block.type !== 'table') {
        return block;
      }

      const sourceIndex = block.columns.findIndex((column) => column.key === sourceColumn.key);
      if (sourceIndex < 0) {
        return block;
      }

      const nextColumns = [...block.columns];
      nextColumns.splice(sourceIndex + 1, 0, duplicatedColumn);
      return {
        ...block,
        columns: nextColumns,
      };
    });
  };

  const deleteTableColumn = (blockKey: string, columnKey: string) => {
    setSelectedPreviewColumnKey(null);
    onBlockChange?.(blockKey, (block) => (
      block.type === 'table'
        ? {
          ...block,
          columns: block.columns.filter((column) => column.key !== columnKey),
        }
        : block
    ));
  };

  const selectedTableRowSample = useMemo(() => {
    if (!Array.isArray(selectedTableSource)) {
      return null;
    }

    return selectedTableSource.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) ?? selectedTableSource[0] ?? null;
  }, [selectedTableSource]);

  const tableColumnPathOptions = useMemo(
    () => sortPrintTemplatePathOptions(collectScalarPathOptions(selectedTableRowSample)),
    [selectedTableRowSample],
  );
  const addBlockMenuItems = useMemo(() => [
    { key: 'text', label: t('printTemplate.addTextBlock'), onClick: () => onAddBlock?.('text') },
    { key: 'field-list', label: t('printTemplate.addFieldListBlock'), onClick: () => onAddBlock?.('field-list') },
    { key: 'table', label: t('printTemplate.addTableBlock'), onClick: () => onAddBlock?.('table') },
    { key: 'image', label: t('printTemplate.addImageBlock'), onClick: () => onAddBlock?.('image') },
    { key: 'horizontal-line', label: t('printTemplate.addHorizontalLineBlock'), onClick: () => onAddBlock?.('horizontal-line') },
    { key: 'vertical-line', label: t('printTemplate.addVerticalLineBlock'), onClick: () => onAddBlock?.('vertical-line') },
  ], [onAddBlock, t]);

  const renderEditableContent = (block: Extract<PrintTemplatePreviewBlock, { type: 'text' }>, displayValue: string, fontScale: number) => {
    const isSelected = selectedBlockKey === block.key;
    const isEditing = editingContent?.blockKey === block.key;
    const value = isEditing ? editingContent.value : displayValue;

    if (!isSelected || !onBlockContentChange) {
      return (
        <div
          key={block.key}
          style={{
            color: block.textOptions.color,
            whiteSpace: 'pre-wrap',
            textAlign: previewAlignToText(block.textOptions.align),
            fontSize: block.textOptions.fontSize * fontScale,
            fontWeight: block.textOptions.fontWeight === 'bold' ? 700 : 400,
            lineHeight: 1.35,
          }}
        >
          {displayValue || t('printTemplate.previewUntitled')}
        </div>
      );
    }

    return (
      <Input.TextArea
        autoFocus
        autoSize={{ minRows: 2, maxRows: 8 }}
        value={value}
        onChange={(event) => setEditingContent({ blockKey: block.key, value: event.target.value })}
        onBlur={() => {
          const nextValue = editingContent?.blockKey === block.key ? editingContent.value : value;
          onBlockContentChange(block.key, nextValue);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            const nextValue = editingContent?.blockKey === block.key ? editingContent.value : value;
            onBlockContentChange(block.key, nextValue);
            event.currentTarget.blur();
          }
        }}
        placeholder={t('printTemplate.previewUntitled')}
        style={{
          fontSize: block.textOptions.fontSize * fontScale,
          fontWeight: block.textOptions.fontWeight === 'bold' ? 700 : 400,
          textAlign: previewAlignToText(block.textOptions.align) as 'left' | 'center' | 'right',
          color: block.textOptions.color,
          resize: 'none',
        }}
      />
    );
  };

  const renderBlock = (block: PrintTemplatePreviewBlock) => {
    if (block.type === 'text') {
      return renderEditableContent(block, block.text, 1.4);
    }

    if (block.type === 'image') {
      if (!block.src.trim()) {
        return (
          <div
            key={block.key}
            style={{
              minHeight: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed #d9d9d9',
              borderRadius: 6,
              background: '#fafafa',
              color: '#8c8c8c',
              fontSize: 12,
              textAlign: 'center',
              padding: 8,
            }}
          >
            {t('printTemplate.imagePreviewEmpty')}
          </div>
        );
      }

      return (
        <img
          key={block.key}
          src={block.src}
          alt={block.alt || t('printTemplate.blockTypeOptions.image')}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      );
    }

    if (block.type === 'horizontal-line') {
      return (
        <div
          key={block.key}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              borderTop: `${block.lineOptions.lineWidth}px ${block.lineOptions.lineStyle} ${block.lineOptions.color}`,
              borderRadius: 999,
            }}
          />
        </div>
      );
    }

    if (block.type === 'vertical-line') {
      return (
        <div
          key={block.key}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 24,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              borderLeft: `${block.lineOptions.lineWidth}px ${block.lineOptions.lineStyle} ${block.lineOptions.color}`,
              height: '100%',
              borderRadius: 999,
            }}
          />
        </div>
      );
    }

    if (block.type === 'field-list') {
      return (
        <div
          key={block.key}
          style={{
            display: 'grid',
            gap: 10,
            textAlign: previewAlignToText(block.textOptions.align),
            fontSize: block.textOptions.fontSize * 1.2,
            fontWeight: block.textOptions.fontWeight === 'bold' ? 700 : 400,
            color: block.textOptions.color,
          }}
        >
          {block.items.map((fieldItem) => (
            <div key={fieldItem.key}>
              <strong>{fieldItem.label || t('printTemplate.fieldLabel')}:</strong>{' '}
              {fieldItem.value}
            </div>
          ))}
        </div>
      );
    }

    if (block.type === 'table') {
      const columns = block.columns;
      const totalWidth = columns.reduce((sum, column) => sum + column.widthWeight, 0) || 1;
      const canReorderPreviewColumns = selectedBlockKey === block.key && Boolean(onBlockChange);
      const canManagePreviewColumns = selectedBlockKey === block.key && Boolean(onBlockChange);
      const columnFontSizeFallback = block.textOptions.fontSize * 1.15;

      return (
        <div key={block.key}>
          {block.title.trim() || canManagePreviewColumns ? (
            <div
              onPointerDown={canManagePreviewColumns ? (event) => event.stopPropagation() : undefined}
              style={{
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: (block.textOptions.fontSize + 2) * 1.2,
                  fontWeight: 600,
                  textAlign: previewAlignToText(block.textOptions.align),
                  color: block.textOptions.color,
                }}
              >
                {block.title}
              </div>
              {canManagePreviewColumns ? (
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  aria-label={t('printTemplate.addPreviewTableColumn')}
                  title={t('printTemplate.addPreviewTableColumn')}
                  onClick={() => addTableColumn(block.key)}
                />
              ) : null}
            </div>
          ) : null}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: block.textOptions.fontSize * 1.15 }}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      onDragOver={(event) => {
                        if (!canReorderPreviewColumns) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        if (draggingPreviewColumn?.blockKey === block.key) {
                          setDragOverPreviewColumnKey(column.key);
                        }
                      }}
                      onDrop={(event) => {
                        if (!canReorderPreviewColumns) {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        handlePreviewColumnDrop(block.key, column.key);
                      }}
                      onDragEnd={() => {
                        setDraggingPreviewColumn(null);
                        setDragOverPreviewColumnKey(null);
                      }}
                      onPointerDown={canReorderPreviewColumns ? (event) => event.stopPropagation() : undefined}
                      onClick={canManagePreviewColumns ? (event) => {
                        event.stopPropagation();
                        setSelectedBlockKey(block.key);
                        setSelectedPreviewColumnKey(column.key);
                      } : undefined}
                      style={{
                        width: `${(column.widthWeight / totalWidth) * 100}%`,
                        border: dragOverPreviewColumnKey === column.key && draggingPreviewColumn?.blockKey === block.key
                          ? '1px solid #1677ff'
                          : '1px solid #d9d9d9',
                        background: draggingPreviewColumn?.columnKey === column.key ? '#f0f5ff' : '#fafafa',
                        padding: '10px 8px',
                        textAlign: previewAlignToText(column.headerAlign),
                        fontSize: resolveColumnFontSize(column.headerFontSize, columnFontSizeFallback),
                        fontWeight: column.headerFontWeight === 'bold' ? 700 : 400,
                        color: column.headerColor || block.textOptions.color,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          justifyContent: column.headerAlign === 'right'
                            ? 'flex-end'
                            : column.headerAlign === 'center'
                              ? 'center'
                              : 'flex-start',
                        }}
                      >
                        {canReorderPreviewColumns ? (
                          <span
                            draggable
                            onPointerDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', `preview-table:${block.key}:${column.key}`);
                              setDraggingPreviewColumn({ blockKey: block.key, columnKey: column.key });
                              setDragOverPreviewColumnKey(column.key);
                            }}
                            onDragEnd={(event) => {
                              event.stopPropagation();
                              setDraggingPreviewColumn(null);
                              setDragOverPreviewColumnKey(null);
                            }}
                            aria-label={t('printTemplate.dragColumnPreviewHandle')}
                            title={t('printTemplate.dragColumnPreviewHandle')}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 18,
                              height: 18,
                              color: '#8c8c8c',
                              cursor: 'grab',
                              flex: '0 0 auto',
                            }}
                          >
                            <HolderOutlined />
                          </span>
                        ) : null}
                        <span>{column.title}</span>
                        {canManagePreviewColumns ? (
                          <Dropdown
                            trigger={['click']}
                            menu={{
                              items: [
                                {
                                  key: 'duplicate',
                                  icon: <CopyOutlined />,
                                  label: t('printTemplate.duplicatePreviewTableColumn'),
                                  onClick: () => duplicateTableColumn(block.key, column),
                                },
                                {
                                  key: 'align-left',
                                  icon: <AlignLeftOutlined />,
                                  label: t('printTemplate.columnHeaderAlignLeft'),
                                  onClick: () => updateTableColumn(block.key, column.key, (entry) => ({ ...entry, headerAlign: 'left' })),
                                },
                                {
                                  key: 'align-center',
                                  icon: <AlignCenterOutlined />,
                                  label: t('printTemplate.columnHeaderAlignCenter'),
                                  onClick: () => updateTableColumn(block.key, column.key, (entry) => ({ ...entry, headerAlign: 'center' })),
                                },
                                {
                                  key: 'align-right',
                                  icon: <AlignRightOutlined />,
                                  label: t('printTemplate.columnHeaderAlignRight'),
                                  onClick: () => updateTableColumn(block.key, column.key, (entry) => ({ ...entry, headerAlign: 'right' })),
                                },
                                {
                                  key: 'delete',
                                  icon: <DeleteOutlined />,
                                  label: t('printTemplate.deletePreviewTableColumn'),
                                  danger: true,
                                  disabled: columns.length <= 1,
                                  onClick: () => deleteTableColumn(block.key, column.key),
                                },
                              ],
                            }}
                          >
                            <Button
                              type="text"
                              size="small"
                              icon={<MoreOutlined />}
                              aria-label={t('printTemplate.previewColumnActions')}
                              title={t('printTemplate.previewColumnActions')}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                              style={{ marginInlineStart: 4 }}
                            />
                          </Dropdown>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${block.key}-${rowIndex + 1}`}>
                    {columns.map((column) => (
                      <td
                        key={`${rowIndex + 1}-${column.key}`}
                        style={{
                          border: '1px solid #d9d9d9',
                          padding: '9px 8px',
                          textAlign: previewAlignToText(column.valueAlign),
                          verticalAlign: 'top',
                          fontSize: resolveColumnFontSize(column.valueFontSize, columnFontSizeFallback),
                          fontWeight: column.valueFontWeight === 'bold' ? 700 : 400,
                          color: column.valueColor || block.textOptions.color,
                        }}
                      >
                        {row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderPropertyInput = (label: string, input: React.ReactNode) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      {input}
    </div>
  );

  const renderColorInput = (value: string, onChange: (nextValue: string) => void) => (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        type="color"
        value={value || '#262626'}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: 56, paddingInline: 4 }}
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Space.Compact>
  );

  const openImageFilePicker = (blockKey: string) => {
    imageUploadBlockKeyRef.current = blockKey;
    imageUploadInputRef.current?.click();
  };

  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const blockKey = imageUploadBlockKeyRef.current;
    imageUploadBlockKeyRef.current = null;

    if (!file || !blockKey) {
      return;
    }

    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      message.error(t('printTemplate.imageUploadError'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => message.error(t('printTemplate.imageUploadError'));
    reader.onload = () => {
      const imageSrc = reader.result;
      if (typeof imageSrc !== 'string') {
        message.error(t('printTemplate.imageUploadError'));
        return;
      }

      onBlockChange?.(blockKey, (block) => (
        block.type === 'image'
          ? { ...block, src: imageSrc }
          : block
      ));
    };
    reader.readAsDataURL(file);
  };

  const renderSelectedBlockProperties = () => {
    if (!selectedBlock || !selectedSchemaBlock) {
      return (
        <div
          style={{
            minHeight: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          <Text type="secondary">{t('printTemplate.previewPropertiesEmpty')}</Text>
        </div>
      );
    }

    const transientPlacement = getTransientPlacement(selectedBlock.key);
    const placement = transientPlacement
      ? {
        xPercent: transientPlacement.xPercent.toFixed(2),
        yPercent: transientPlacement.yPercent.toFixed(2),
        widthPercent: transientPlacement.widthPercent.toFixed(2),
        heightPercent: transientPlacement.heightPercent.toFixed(2),
      }
      : selectedSchemaBlock.placement;
    const supportsTextOptions = selectedBlock.type !== 'image' && selectedBlock.type !== 'horizontal-line' && selectedBlock.type !== 'vertical-line';
    const supportsHeight = selectedBlock.type === 'image' || selectedBlock.type === 'horizontal-line' || selectedBlock.type === 'vertical-line';

    if (selectedBlock.type === 'table' && selectedSchemaBlock.type === 'table' && selectedSchemaTableColumn) {
      return (
        <Space orientation="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <Text strong>{t('printTemplate.previewPropertiesSelectionColumn')}</Text>
            <Text type="secondary">{selectedSchemaTableColumn.title || t('printTemplate.columnTitle')}</Text>
          </div>

          <Space wrap>
            <Button onClick={() => setSelectedPreviewColumnKey(null)}>
              {t('printTemplate.backToTableSettings')}
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={() => duplicateTableColumn(selectedBlock.key, selectedSchemaTableColumn)}
            >
              {t('printTemplate.duplicatePreviewTableColumn')}
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={selectedSchemaBlock.columns.length <= 1}
              onClick={() => deleteTableColumn(selectedBlock.key, selectedSchemaTableColumn.key)}
            >
              {t('printTemplate.deletePreviewTableColumn')}
            </Button>
          </Space>

          {renderPropertyInput(
            t('printTemplate.columnKey'),
            <Input value={selectedSchemaTableColumn.key} readOnly />,
          )}
          {renderPropertyInput(
            t('printTemplate.columnTitle'),
            <Input
              value={selectedSchemaTableColumn.title}
              onChange={(event) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                ...column,
                title: event.target.value,
              }))}
            />,
          )}
          {renderPropertyInput(
            t('printTemplate.columnPath'),
            <>
              <Select
                value={selectedSchemaTableColumn.path}
                placeholder={t('printTemplate.columnPath')}
                showSearch
                allowClear
                optionFilterProp="label"
                options={ensureSelectedPathOption(tableColumnPathOptions, selectedSchemaTableColumn.path)}
                onChange={(value) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                  ...column,
                  path: value ?? '',
                }))}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('printTemplate.columnPathHint')}
              </Text>
            </>,
          )}
          {renderPropertyInput(
            t('printTemplate.columnWidthPercent'),
            <Input
              value={selectedSchemaTableColumn.widthPercent}
              placeholder={t('printTemplate.columnWidthPercent')}
              onChange={(event) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                ...column,
                widthPercent: event.target.value,
              }))}
            />,
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            {renderPropertyInput(
              t('printTemplate.columnHeaderFontSize'),
              <Input
                value={selectedSchemaTableColumn.headerFontSize}
                placeholder={selectedSchemaBlock.text.fontSize}
                onChange={(event) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                  ...column,
                  headerFontSize: event.target.value,
                }))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.columnHeaderColor'),
              renderColorInput(selectedSchemaTableColumn.headerColor || selectedSchemaBlock.text.color, (value) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                ...column,
                headerColor: value,
              }))),
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            {renderPropertyInput(
              t('printTemplate.columnHeaderTextSettings'),
              <Space.Compact block>
                <Button
                  type={selectedSchemaTableColumn.headerAlign === 'left' ? 'primary' : 'default'}
                  icon={<AlignLeftOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.left')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    headerAlign: 'left',
                  }))}
                />
                <Button
                  type={selectedSchemaTableColumn.headerAlign === 'center' ? 'primary' : 'default'}
                  icon={<AlignCenterOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.center')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    headerAlign: 'center',
                  }))}
                />
                <Button
                  type={selectedSchemaTableColumn.headerAlign === 'right' ? 'primary' : 'default'}
                  icon={<AlignRightOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.right')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    headerAlign: 'right',
                  }))}
                />
              </Space.Compact>,
            )}
            {renderPropertyInput(
              t('printTemplate.columnHeaderFontWeight'),
              <Button
                type={selectedSchemaTableColumn.headerFontWeight === 'bold' ? 'primary' : 'default'}
                icon={<BoldOutlined />}
                aria-label={t('printTemplate.fontWeightOptions.bold')}
                onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                  ...column,
                  headerFontWeight: column.headerFontWeight === 'bold' ? 'normal' : 'bold',
                }))}
              />,
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            {renderPropertyInput(
              t('printTemplate.columnValueFontSize'),
              <Input
                value={selectedSchemaTableColumn.valueFontSize}
                placeholder={selectedSchemaBlock.text.fontSize}
                onChange={(event) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                  ...column,
                  valueFontSize: event.target.value,
                }))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.columnValueColor'),
              renderColorInput(selectedSchemaTableColumn.valueColor || selectedSchemaBlock.text.color, (value) => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                ...column,
                valueColor: value,
              }))),
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            {renderPropertyInput(
              t('printTemplate.columnValueTextSettings'),
              <Space.Compact block>
                <Button
                  type={selectedSchemaTableColumn.valueAlign === 'left' ? 'primary' : 'default'}
                  icon={<AlignLeftOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.left')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    valueAlign: 'left',
                  }))}
                />
                <Button
                  type={selectedSchemaTableColumn.valueAlign === 'center' ? 'primary' : 'default'}
                  icon={<AlignCenterOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.center')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    valueAlign: 'center',
                  }))}
                />
                <Button
                  type={selectedSchemaTableColumn.valueAlign === 'right' ? 'primary' : 'default'}
                  icon={<AlignRightOutlined />}
                  aria-label={t('printTemplate.columnAlignOptions.right')}
                  onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                    ...column,
                    valueAlign: 'right',
                  }))}
                />
              </Space.Compact>,
            )}
            {renderPropertyInput(
              t('printTemplate.columnValueFontWeight'),
              <Button
                type={selectedSchemaTableColumn.valueFontWeight === 'bold' ? 'primary' : 'default'}
                icon={<BoldOutlined />}
                aria-label={t('printTemplate.fontWeightOptions.bold')}
                onClick={() => updateTableColumn(selectedBlock.key, selectedSchemaTableColumn.key, (column) => ({
                  ...column,
                  valueFontWeight: column.valueFontWeight === 'bold' ? 'normal' : 'bold',
                }))}
              />,
            )}
          </div>
        </Space>
      );
    }

    return (
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Text strong>{t('printTemplate.previewPropertiesSelection')}</Text>
          <Text type="secondary">
            {t(`printTemplate.blockTypeOptions.${selectedBlock.type}`)}
          </Text>
        </div>

        <Space wrap>
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              const nextKey = onBlockDuplicate?.(selectedBlock.key);
              if (nextKey) {
                setSelectedBlockKey(nextKey);
              }
            }}
          >
            {t('printTemplate.duplicateBlock')}
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              onBlockDelete?.(selectedBlock.key);
              setSelectedBlockKey(null);
            }}
          >
            {t('printTemplate.deleteBlock')}
          </Button>
        </Space>

        {renderPropertyInput(
          t('printTemplate.blockKey'),
          <Input value={selectedBlock.key} readOnly />,
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {renderPropertyInput(
            t('printTemplate.placementXPercent'),
            <Input
              value={placement.xPercent}
              onChange={(event) => onPlacementChange?.(selectedBlock.key, { xPercent: event.target.value })}
            />,
          )}
          {renderPropertyInput(
            t('printTemplate.placementYPercent'),
            <Input
              value={placement.yPercent}
              onChange={(event) => onPlacementChange?.(selectedBlock.key, { yPercent: event.target.value })}
            />,
          )}
          {renderPropertyInput(
            t('printTemplate.placementWidthPercent'),
            <Input
              value={placement.widthPercent}
              onChange={(event) => onPlacementChange?.(selectedBlock.key, { widthPercent: event.target.value })}
            />,
          )}
          {supportsHeight ? renderPropertyInput(
            t('printTemplate.placementHeightPercent'),
            <Input
              value={placement.heightPercent}
              onChange={(event) => onPlacementChange?.(selectedBlock.key, { heightPercent: event.target.value })}
            />,
          ) : (
            <div />
          )}
        </div>

        {supportsTextOptions ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 12 }}>
              {renderPropertyInput(
                t('printTemplate.fontSize'),
                <Input
                  value={selectedBlock.textOptions.fontSize}
                  onChange={(event) => onBlockTextOptionsChange?.(selectedBlock.key, { fontSize: event.target.value })}
                />,
              )}
              {renderPropertyInput(
                t('printTemplate.fontColor'),
                renderColorInput(selectedSchemaBlock.text.color, (value) => onBlockTextOptionsChange?.(selectedBlock.key, { color: value })),
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'end' }}>
              {renderPropertyInput(
                t('printTemplate.fontAlign'),
                <Space.Compact block>
                  <Button
                    type={selectedBlock.textOptions.align === 'left' ? 'primary' : 'default'}
                    icon={<AlignLeftOutlined />}
                    aria-label={t('printTemplate.columnAlignOptions.left')}
                    onClick={() => onBlockTextOptionsChange?.(selectedBlock.key, { align: 'left' })}
                  />
                  <Button
                    type={selectedBlock.textOptions.align === 'center' ? 'primary' : 'default'}
                    icon={<AlignCenterOutlined />}
                    aria-label={t('printTemplate.columnAlignOptions.center')}
                    onClick={() => onBlockTextOptionsChange?.(selectedBlock.key, { align: 'center' })}
                  />
                  <Button
                    type={selectedBlock.textOptions.align === 'right' ? 'primary' : 'default'}
                    icon={<AlignRightOutlined />}
                    aria-label={t('printTemplate.columnAlignOptions.right')}
                    onClick={() => onBlockTextOptionsChange?.(selectedBlock.key, { align: 'right' })}
                  />
                </Space.Compact>,
              )}
              {renderPropertyInput(
                t('printTemplate.fontWeight'),
                <Button
                  type={selectedBlock.textOptions.fontWeight === 'bold' ? 'primary' : 'default'}
                  icon={<BoldOutlined />}
                  aria-label={t('printTemplate.fontWeightOptions.bold')}
                  onClick={() => onBlockTextOptionsChange?.(selectedBlock.key, {
                    fontWeight: selectedBlock.textOptions.fontWeight === 'bold' ? 'normal' : 'bold',
                  })}
                />,
              )}
            </div>
          </div>
        ) : null}

        {(selectedBlock.type === 'horizontal-line' || selectedBlock.type === 'vertical-line')
        && (selectedSchemaBlock.type === 'horizontal-line' || selectedSchemaBlock.type === 'vertical-line') ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {renderPropertyInput(
              t('printTemplate.lineStyle'),
              <Select
                value={selectedSchemaBlock.lineStyle}
                options={[
                  { value: 'solid', label: t('printTemplate.lineStyleOptions.solid') },
                  { value: 'dashed', label: t('printTemplate.lineStyleOptions.dashed') },
                  { value: 'dotted', label: t('printTemplate.lineStyleOptions.dotted') },
                  { value: 'double', label: t('printTemplate.lineStyleOptions.double') },
                ]}
                onChange={(value) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'horizontal-line' || block.type === 'vertical-line'
                    ? { ...block, lineStyle: value }
                    : block
                ))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.lineWidth'),
              <Input
                value={selectedSchemaBlock.lineWidth}
                onChange={(event) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'horizontal-line' || block.type === 'vertical-line'
                    ? { ...block, lineWidth: event.target.value }
                    : block
                ))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.lineColor'),
              renderColorInput(selectedSchemaBlock.color, (value) => onBlockChange?.(selectedBlock.key, (block) => (
                block.type === 'horizontal-line' || block.type === 'vertical-line'
                  ? { ...block, color: value }
                  : block
              ))),
            )}
          </div>
        ) : null}

        {selectedBlock.type === 'text' ? (
          <>
            {renderPropertyInput(
              t('printTemplate.textStyle'),
              <Select
                value={selectedSchemaBlock.type === 'text' ? selectedSchemaBlock.style : 'body'}
                options={[
                  { value: 'title', label: t('printTemplate.textStyleOptions.title') },
                  { value: 'section', label: t('printTemplate.textStyleOptions.section') },
                  { value: 'body', label: t('printTemplate.textStyleOptions.body') },
                ]}
                onChange={(value) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'text'
                    ? { ...block, style: value }
                    : block
                ))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.textValue'),
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 8 }}
                value={selectedBlock.text}
                onChange={(event) => onBlockContentChange?.(selectedBlock.key, event.target.value)}
              />,
            )}
          </>
        ) : null}

        {selectedBlock.type === 'image' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <Button onClick={() => openImageFilePicker(selectedBlock.key)}>
              {t('printTemplate.imageSelectFile')}
            </Button>
            {renderPropertyInput(
              t('printTemplate.imageAlt'),
              <Input
                value={selectedBlock.alt}
                onChange={(event) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'image'
                    ? { ...block, alt: event.target.value }
                    : block
                ))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.imageSource'),
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 8 }}
                value={selectedBlock.src}
                onChange={(event) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'image'
                    ? { ...block, src: event.target.value }
                    : block
                ))}
              />,
            )}
          </div>
        ) : null}

        {selectedBlock.type === 'field-list' && selectedSchemaBlock.type === 'field-list' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <Space wrap>
              <Button
                icon={<PlusOutlined />}
                onClick={() => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'field-list'
                    ? {
                      ...block,
                      items: [...block.items, createPrintTemplateFieldItem(block.items.length + 1)],
                    }
                    : block
                ))}
              >
                {t('printTemplate.addFieldItem')}
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('printTemplate.reorderInPropertiesHint')}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('printTemplate.reorderItemsHint')}
            </Text>
            {selectedSchemaBlock.items.map((fieldItem, index) => (
              <div
                key={fieldItem.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (draggingEditorItem?.kind === 'field-list') {
                    setDragOverEditorItemKey(fieldItem.key);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleEditorItemDrop('field-list', fieldItem.key);
                }}
                onDragEnd={() => {
                  setDraggingEditorItem(null);
                  setDragOverEditorItemKey(null);
                }}
                style={{
                  display: 'grid',
                  gap: 8,
                  padding: 10,
                  border: dragOverEditorItemKey === fieldItem.key && draggingEditorItem?.kind === 'field-list'
                    ? '1px solid #1677ff'
                    : '1px solid #f0f0f0',
                  borderRadius: 8,
                  background: draggingEditorItem?.key === fieldItem.key ? '#f0f5ff' : '#fafafa',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <Space size={8} align="center">
                    <div
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', `field-list:${fieldItem.key}`);
                        setDraggingEditorItem({ kind: 'field-list', key: fieldItem.key });
                        setDragOverEditorItemKey(fieldItem.key);
                      }}
                      onDragEnd={(event) => {
                        event.stopPropagation();
                        setDraggingEditorItem(null);
                        setDragOverEditorItemKey(null);
                      }}
                      aria-label={t('printTemplate.dragItemHandle')}
                      title={t('printTemplate.dragItemHandle')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: '1px solid #d9d9d9',
                        background: '#fff',
                        color: '#8c8c8c',
                        cursor: 'grab',
                        flex: '0 0 auto',
                      }}
                    >
                      <HolderOutlined />
                    </div>
                    <Text type="secondary">{`${t('printTemplate.fieldLabel')} ${index + 1}`}</Text>
                  </Space>
                  <Space size={6}>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => onBlockChange?.(selectedBlock.key, (block) => (
                        block.type === 'field-list'
                          ? {
                            ...block,
                            items: duplicatePrintTemplateItem(block.items, fieldItem.key, clonePrintTemplateFieldItem),
                          }
                          : block
                      ))}
                    >
                      {t('printTemplate.duplicateItem')}
                    </Button>
                    <Button
                      size="small"
                      disabled={index === 0}
                      onClick={() => onBlockChange?.(selectedBlock.key, (block) => (
                        block.type === 'field-list'
                          ? {
                            ...block,
                            items: movePrintTemplateItem(block.items, index, index - 1),
                          }
                          : block
                      ))}
                    >
                      {t('printTemplate.moveItemUp')}
                    </Button>
                    <Button
                      size="small"
                      disabled={index === selectedSchemaBlock.items.length - 1}
                      onClick={() => onBlockChange?.(selectedBlock.key, (block) => (
                        block.type === 'field-list'
                          ? {
                            ...block,
                            items: movePrintTemplateItem(block.items, index, index + 1),
                          }
                          : block
                      ))}
                    >
                      {t('printTemplate.moveItemDown')}
                    </Button>
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      disabled={selectedSchemaBlock.items.length <= 1}
                      onClick={() => onBlockChange?.(selectedBlock.key, (block) => (
                        block.type === 'field-list'
                          ? {
                            ...block,
                            items: block.items.filter((entry) => entry.key !== fieldItem.key),
                          }
                          : block
                      ))}
                    >
                      {t('printTemplate.deleteFieldItem')}
                    </Button>
                  </Space>
                </div>
                <Input
                  value={fieldItem.label}
                  placeholder={t('printTemplate.fieldLabel')}
                  onChange={(event) => onBlockChange?.(selectedBlock.key, (block) => (
                    block.type === 'field-list'
                      ? {
                        ...block,
                        items: block.items.map((entry) => (
                          entry.key === fieldItem.key
                            ? { ...entry, label: event.target.value }
                            : entry
                        )),
                      }
                      : block
                  ))}
                />
                <Select
                  value={fieldItem.path}
                  placeholder={t('printTemplate.fieldPath')}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={ensureSelectedPathOption(rootScalarPathOptions, fieldItem.path)}
                  onChange={(value) => onBlockChange?.(selectedBlock.key, (block) => (
                    block.type === 'field-list'
                      ? {
                        ...block,
                        items: block.items.map((entry) => (
                          entry.key === fieldItem.key
                            ? { ...entry, path: value ?? '' }
                            : entry
                        )),
                      }
                      : block
                  ))}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('printTemplate.fieldPathHint')}
                </Text>
              </div>
            ))}
          </div>
        ) : null}

        {selectedBlock.type === 'table' && selectedSchemaBlock.type === 'table' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {renderPropertyInput(
              t('printTemplate.tableTitle'),
              <Input
                value={selectedSchemaBlock.title}
                onChange={(event) => onBlockChange?.(selectedBlock.key, (block) => (
                  block.type === 'table'
                    ? { ...block, title: event.target.value }
                    : block
                ))}
              />,
            )}
            {renderPropertyInput(
              t('printTemplate.tableSource'),
              <>
                <Select
                  value={selectedSchemaBlock.source}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={ensureSelectedPathOption(tableSourceOptions, selectedSchemaBlock.source)}
                  onChange={(value) => onBlockChange?.(selectedBlock.key, (block) => (
                    block.type === 'table'
                      ? { ...block, source: value ?? '' }
                      : block
                  ))}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('printTemplate.tableSourceHint')}
                </Text>
              </>,
            )}
            <Space wrap>
              <Button
                icon={<PlusOutlined />}
                onClick={() => addTableColumn(selectedBlock.key)}
              >
                {t('printTemplate.addTableColumn')}
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('printTemplate.tableContextMenuHint')}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('printTemplate.tableColumnSelectHint')}
            </Text>
          </div>
        ) : null}
      </Space>
    );
  };

  return (
    <Card
      className="app-panel-card"
      size="small"
      title={t('printTemplate.preview')}
      extra={(
        <Space size={8} wrap>
          {onAddBlock ? (
            <Dropdown trigger={['click']} menu={{ items: addBlockMenuItems }}>
              <Button size="small" icon={<PlusOutlined />}>
                {t('printTemplate.addBlock')}
              </Button>
            </Dropdown>
          ) : null}
          <Text type="secondary">{previewDataSourceLabel}</Text>
        </Space>
      )}
      styles={{ body: { padding: 20 } }}
    >
      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleImageFileChange}
        style={{ display: 'none' }}
      />
      <Spin spinning={loading}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <div
            ref={previewPageRef}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement | null;
              const clickedBlock = target?.closest('div[tabindex="0"]');
              if (!clickedBlock) {
                setSelectedBlockKey(null);
                setSelectedPreviewColumnKey(null);
              }
            }}
            onPointerMove={handlePagePointerMove}
            onPointerUp={handlePagePointerUp}
            onPointerCancel={handlePagePointerUp}
            style={{
              flex: '1 1 720px',
              margin: '0 auto',
              width: '100%',
              maxWidth: previewPageMaxWidth,
              aspectRatio: previewPageAspectRatio,
              background: '#fff',
              border: '1px solid #d9d9d9',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
              padding: 28,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ position: 'relative', height: '100%' }}>
              {snapGuides.map((guide, index) => (
                <div
                  key={`${guide.orientation}-${guide.positionPercent}-${index + 1}`}
                  style={{
                    position: 'absolute',
                    pointerEvents: 'none',
                    zIndex: 15,
                    ...(guide.orientation === 'vertical'
                      ? {
                        left: `${guide.positionPercent}%`,
                        top: 0,
                        bottom: 0,
                        width: 0,
                        borderLeft: '1px dashed rgba(250, 140, 22, 0.9)',
                      }
                      : {
                        top: `${guide.positionPercent}%`,
                        left: 0,
                        right: 0,
                        height: 0,
                        borderTop: '1px dashed rgba(250, 140, 22, 0.9)',
                      }),
                  }}
                />
              ))}
              {absoluteBlocks.map((block, blockAbsIndex) => {
                const vp = getTransientPlacement(block.key) ?? block.placement;
                const supportsBlockHeight = block.type === 'image' || block.type === 'horizontal-line' || block.type === 'vertical-line';
                return (
                  <div
                    key={block.key}
                    tabIndex={0}
                    onFocus={() => {
                      setSelectedBlockKey(block.key);
                      setSelectedPreviewColumnKey(null);
                    }}
                    onPointerDown={(event) => {
                      event.currentTarget.focus();
                      startDrag(event, 'move', block);
                    }}
                    style={{
                      position: 'absolute',
                      left: `${vp.xPercent}%`,
                      top: `${vp.yPercent}%`,
                      width: `${vp.widthPercent}%`,
                      height: supportsBlockHeight && vp.heightPercent > 0 ? `${vp.heightPercent}%` : undefined,
                      cursor: onPlacementChange ? 'move' : 'default',
                      border: selectedBlockKey === block.key ? '2px solid rgba(22, 119, 255, 0.75)' : '1px dashed rgba(22, 119, 255, 0.45)',
                      background: 'rgba(255, 255, 255, 0.88)',
                      padding: block.type === 'horizontal-line' || block.type === 'vertical-line' ? 4 : 8,
                      borderRadius: 8,
                      zIndex: draggingBlockKey === block.key ? 30 : (
                        selectedBlockKey === block.key ? 20 : (10 + absoluteBlocks.length - blockAbsIndex)
                      ),
                      boxShadow: draggingBlockKey === block.key || selectedBlockKey === block.key ? '0 8px 20px rgba(22, 119, 255, 0.16)' : 'none',
                      touchAction: 'none',
                      userSelect: 'none',
                      outline: 'none',
                    }}
                  >
                    {selectedBlockKey === block.key || draggingBlockKey === block.key ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: -28,
                          right: 0,
                          padding: '4px 8px',
                          borderRadius: 999,
                          background: 'rgba(22, 119, 255, 0.12)',
                          color: '#1677ff',
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        {`${vp.xPercent.toFixed(1)}%, ${vp.yPercent.toFixed(1)}% · W ${vp.widthPercent.toFixed(1)}%${supportsBlockHeight ? ` · H ${vp.heightPercent.toFixed(1)}%` : ''}`}
                      </div>
                    ) : null}
                    {renderBlock(block)}
                    <div
                      onPointerDown={(event) => startDrag(event, 'resize', block)}
                      style={{
                        position: 'absolute',
                        right: -10,
                        bottom: -10,
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: '#1677ff',
                        cursor: 'nwse-resize',
                        boxShadow: '0 2px 8px rgba(22, 119, 255, 0.28)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      <span>+</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Card
            size="small"
            title={t('printTemplate.previewProperties')}
            style={{ flex: '0 1 340px', width: '100%', maxWidth: 340 }}
            styles={{ body: { padding: 16 } }}
          >
            {renderSelectedBlockProperties()}
          </Card>
        </div>
      </Spin>
    </Card>
  );
}

const MemoizedPrintTemplatePreview = memo(PrintTemplatePreview);

export default function PrintTemplateCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { message } = App.useApp();
  const [form] = Form.useForm<PrintTemplateItem>();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingPreviewData, setLoadingPreviewData] = useState(false);
  const [previewData, setPreviewData] = useState<unknown>(defaultPreviewDocument);
  const [previewDataText, setPreviewDataText] = useState(defaultPreviewDataText);
  const [previewDataError, setPreviewDataError] = useState<string | null>(null);
  const [previewDataSource, setPreviewDataSource] = useState<PrintTemplatePreviewDataSource>('empty');
  const [previewRequestPayloadText, setPreviewRequestPayloadText] = useState(defaultPreviewRequestPayloadText);
  const [showPreviewDataEditor, setShowPreviewDataEditor] = useState(false);
  // schemaBlocks is kept in React state (not as a Form field) so that mutations
  // are reactive. Form.useWatch does not fire for setFieldsValue on paths that
  // are not registered as Form.Item, so blocks must live in their own state.
  const [schemaBlocks, setSchemaBlocks] = useState<PrintTemplateItem['schema']['blocks']>(() => emptyItem.schema.blocks);
  const schemaBlocksRef = useRef(schemaBlocks);
  schemaBlocksRef.current = schemaBlocks;
  const loadedId = searchParams.get('id') ?? undefined;
  const isNew = !loadedId;
  const pageTitle = isNew ? t('printTemplate.newTitle') : t('printTemplate.editTitle');
  const currentPath = `${location.pathname}${location.search}`;
  const skipPreviewResetOnNextLoadRef = useRef(false);

  const resetPreviewState = (options?: { includeRequestPayload?: boolean }) => {
    setPreviewData(defaultPreviewDocument);
    setPreviewDataText(defaultPreviewDataText);
    setPreviewDataError(null);
    setPreviewDataSource('empty');
    setShowPreviewDataEditor(false);

    if (options?.includeRequestPayload) {
      setPreviewRequestPayloadText(defaultPreviewRequestPayloadText);
    }
  };

  const previewDataSourceLabel = previewDataSource === 'model'
    ? t('printTemplate.previewDataSourceModel')
    : previewDataSource === 'manual'
      ? t('printTemplate.previewDataSourceManual')
      : t('printTemplate.previewDataSourceEmpty');

  const { item, setItem, loading, loadError } = useModelCard<
    PrintTemplateItem,
    PrintTemplateLoadData,
    PrintTemplateLoadPayload | Record<string, never>
  >({
    form,
    runtime,
    loadedId,
    emptyItem,
    currentPath,
    isNew,
    newTitle: t('printTemplate.newTitle'),
    singularTitle: t('printTemplate.titleOne'),
    notFoundMessage: t('printTemplate.notFound'),
    loadErrorMessage: t('printTemplate.loadOneError'),
    loadOnNew: true,
    buildTitle,
    getLoadPayload: (id) => (id ? { id } : {}) as PrintTemplateLoadPayload | Record<string, never>,
    mapResponseToItem: (data, fallbackItem, nextIsNew) => {
      if (nextIsNew) {
        return fallbackItem;
      }

      return normalizeLoadedItem(data.item);
    },
    onLoadData: () => {
      if (skipPreviewResetOnNextLoadRef.current) {
        skipPreviewResetOnNextLoadRef.current = false;
        return;
      }

      resetPreviewState({ includeRequestPayload: true });
    },
  });

  // Sync schemaBlocks state from item whenever item changes (load / save / import).
  useEffect(() => {
    setSchemaBlocks(item.schema.blocks);
  }, [item]);

  const applyPreviewData = () => {
    const trimmed = previewDataText.trim();

    if (!trimmed) {
      resetPreviewState();
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPreviewDataError(t('printTemplate.previewDataObjectRequired'));
        return;
      }

      setPreviewData(parsed);
      setPreviewDataError(null);
      setPreviewDataSource('manual');
    } catch {
      setPreviewDataError(t('printTemplate.previewDataInvalid'));
    }
  };

  const resetPreviewData = () => {
    resetPreviewState();
  };

  const addSchemaBlock = (blockType: PrintTemplateBlockType) => {
    setSchemaBlocks((currentBlocks) => [...currentBlocks, createPrintTemplateBlock(blockType)]);
  };

  const buildPreviewRequestPayloadTextWithId = (nextId: string | undefined) => {
    const nextPayload = normalizePreviewRequestPayload(previewRequestPayloadText);

    if (nextId?.trim()) {
      nextPayload.id = nextId.trim();
    } else {
      delete nextPayload.id;
    }

    return stringifyPreviewRequestPayload(nextPayload);
  };

  const applyPreviewRequestId = (nextId: string | undefined) => {
    const nextPayloadText = buildPreviewRequestPayloadTextWithId(nextId);
    setPreviewRequestPayloadText(nextPayloadText);
    if (previewDataError) {
      setPreviewDataError(null);
    }
    return nextPayloadText;
  };

  const loadPreviewDataFromModel = async (requestPayloadTextOverride?: string) => {
    const currentValues = form.getFieldsValue(['targetModel', 'dataCommand']) as Partial<PrintTemplateItem>;
    const targetModel = typeof currentValues.targetModel === 'string' ? currentValues.targetModel.trim() : '';
    const dataCommand = typeof currentValues.dataCommand === 'string' ? currentValues.dataCommand.trim() : '';
    const requestPayloadText = (requestPayloadTextOverride ?? previewRequestPayloadText).trim();

    if (!targetModel) {
      setPreviewDataError(t('printTemplate.previewTargetModelRequired'));
      return;
    }

    if (!dataCommand) {
      setPreviewDataError(t('printTemplate.previewDataCommandRequired'));
      return;
    }

    let requestPayload: Record<string, unknown>;
    try {
      const parsedPayload: unknown = requestPayloadText ? JSON.parse(requestPayloadText) : {};
      if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        setPreviewDataError(t('printTemplate.previewRequestPayloadObjectRequired'));
        return;
      }

      requestPayload = parsedPayload as Record<string, unknown>;
    } catch {
      setPreviewDataError(t('printTemplate.previewRequestPayloadInvalid'));
      return;
    }

    const targetManifest = getFeatureManifestByModel(targetModel);
    if (!targetManifest) {
      setPreviewDataError(t('printTemplate.previewTargetModelUnknown', { model: targetModel }));
      return;
    }

    const targetRuntime = createModelRuntime(targetManifest);

    try {
      setLoadingPreviewData(true);
      setPreviewDataError(null);

      const response = dataCommand === 'load'
        ? await targetRuntime.load<Record<string, unknown>, Record<string, unknown>>(requestPayload)
        : await targetRuntime.command<Record<string, unknown>, Record<string, unknown>>(dataCommand, requestPayload);

      if (!response.ok) {
        setPreviewDataError(response.messages[0] ?? t('printTemplate.previewDataLoadError'));
        return false;
      }

      const loadedItem = response.data?.item;
      if (!loadedItem || typeof loadedItem !== 'object' || Array.isArray(loadedItem)) {
        setPreviewDataError(t('printTemplate.previewDataEmpty'));
        return false;
      }

      const nextPreviewText = `${JSON.stringify(loadedItem, null, 2)}\n`;
      setPreviewData(loadedItem);
      setPreviewDataText(nextPreviewText);
      setPreviewDataError(null);
      setPreviewDataSource('model');
      message.success(t('printTemplate.previewDataLoadSuccess'));
      return true;
    } catch (error) {
      setPreviewDataError(error instanceof Error ? error.message : t('printTemplate.previewDataLoadError'));
      return false;
    } finally {
      setLoadingPreviewData(false);
    }
  };

  const handlePreviewSampleObjectChange = async (nextValue: string | undefined) => {
    const nextPayloadText = applyPreviewRequestId(nextValue);
    if (!nextValue?.trim()) {
      return;
    }

    const loaded = await loadPreviewDataFromModel(nextPayloadText);
    if (loaded) {
      setShowPreviewDataEditor(false);
    }
  };

  const hasPreviewSampleData = previewDataText.trim().length > 0;

  const saveItem = async (values: PrintTemplateItem, closeAfterSave = false) => {
    try {
      setSaving(true);
      const currentBlocks = schemaBlocksRef.current;
      const payload: PrintTemplateItem = {
        ...item,
        ...values,
        code: values.code.trim(),
        name: values.name.trim(),
        targetModel: values.targetModel.trim(),
        dataCommand: values.dataCommand.trim(),
        schema: {
          schemaVersion: 2,
          blocks: sanitizePrintTemplateBlocks(currentBlocks),
        },
      };

      const response = await runtime.update<PrintTemplateUpdateData, PrintTemplateUpdatePayload>({ item: payload });
      if (!response.ok || !response.data.item?.id) {
        message.error(response.messages[0] ?? t('printTemplate.saveError'));
        return;
      }

      const savedItem = normalizeLoadedItem({
        ...payload,
        ...response.data.item,
        schema: payload.schema,
      });
      if (!savedItem) {
        message.error(t('printTemplate.saveError'));
        return;
      }

      const nextTitle = buildTitle(savedItem, t('printTemplate.titleOne'));
      setItem(savedItem);
      form.setFieldsValue(savedItem);
      message.success(t('printTemplate.saveSuccess'));
      publishModelSaved(manifest.model, savedItem.id, currentPath);

      if (closeAfterSave) {
        closeWorkspaceTab(currentPath);
        return;
      }

      if (isNew) {
        skipPreviewResetOnNextLoadRef.current = true;
        const nextPath = `${editPath}?id=${savedItem.id}`;
        replaceWorkspaceTabPath(currentPath, nextPath, nextTitle);
        navigate(nextPath, { replace: true });
        return;
      }

      emitWorkspaceTabTitle(currentPath, nextTitle);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('printTemplate.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const saveTemplateToFile = async () => {
    try {
      const currentValues = form.getFieldsValue(true) as Partial<PrintTemplateItem>;
      const valuesWithBlocks: Partial<PrintTemplateItem> = {
        ...currentValues,
        schema: { schemaVersion: 2, blocks: schemaBlocksRef.current },
      };
      const exportPayload = buildTemplateFilePayload(item, valuesWithBlocks);
      const fileName = `${sanitizeTemplateFileName(exportPayload.code)}.template.json`;
      const blob = new Blob([`${JSON.stringify(exportPayload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      message.success(t('printTemplate.saveToFileSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('printTemplate.saveToFileError'));
    }
  };

  const importTemplateFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const importedItem = buildImportedTemplateItem(parsed, item.id);
      setItem(importedItem);
      setSchemaBlocks(importedItem.schema.blocks);
      resetPreviewState({ includeRequestPayload: true });
      form.setFieldsValue(importedItem);
      emitWorkspaceTabTitle(currentPath, buildTitle(importedItem, t('printTemplate.titleOne')));
      message.success(t('printTemplate.loadFromFileSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('printTemplate.loadFromFileError'));
    }
  };

  return (
    <div className="app-card-page">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={(event) => { void importTemplateFromFile(event); }}
        style={{ display: 'none' }}
      />
      <CardPageHeader
        title={pageTitle}
        actions={(
          <>
            <Button icon={<UploadOutlined />} onClick={() => importInputRef.current?.click()}>
              {t('printTemplate.loadFromFile')}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void saveTemplateToFile()}>
              {t('printTemplate.saveToFile')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
              {t('common.save')}
            </Button>
            <Button icon={<SaveOutlined />} loading={saving} onClick={() => void form.validateFields().then((values) => saveItem(values, true))}>
              {t('common.saveAndClose')}
            </Button>
            <Button onClick={() => { closeWorkspaceTab(currentPath); }}>
              {t('supplierInvoice.close')}
            </Button>
          </>
        )}
      />

      {loadError ? (
        <Alert
          className="app-inline-alert"
          type="error"
          showIcon
          title={t('printTemplate.loadOneError')}
          description={loadError}
          action={(
            <Space>
              {!isNew && <Button size="small" onClick={() => navigate(0)}>{t('app.retry')}</Button>}
              <Button size="small" onClick={() => navigate(listPath)}>{t('printTemplate.backToList')}</Button>
            </Space>
          )}
        />
      ) : (
        <Spin spinning={loading}>
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Card className="app-panel-card" size="small" styles={{ body: { paddingBottom: 12 } }}>
              <PrintTemplateForm
                form={form}
                showDetailedBlockEditors={false}
                showAddBlockControl={false}
                schemaBlocks={schemaBlocks}
                onSchemaBlocksChange={setSchemaBlocks}
                orientationOptions={[
                  { value: 'portrait', label: t('printTemplate.orientationOptions.portrait') },
                  { value: 'landscape', label: t('printTemplate.orientationOptions.landscape') },
                ]}
                columnAlignmentOptions={[
                  { value: 'left', label: t('printTemplate.columnAlignOptions.left') },
                  { value: 'center', label: t('printTemplate.columnAlignOptions.center') },
                  { value: 'right', label: t('printTemplate.columnAlignOptions.right') },
                ]}
                onFinish={(values) => void saveItem(values)}
              />
            </Card>

            <Card className="app-panel-card" size="small" styles={{ body: { padding: 0 } }}>
              <Collapse
                ghost
                items={[
                  {
                    key: 'preview-data-tools',
                    label: t('printTemplate.previewDataTools'),
                    extra: <Text type="secondary">{t('printTemplate.previewDataHint')}</Text>,
                    children: (
                      <Space orientation="vertical" size={12} style={{ width: '100%', padding: '4px 0 0' }}>
                        {!hasPreviewSampleData ? (
                          <Alert type="info" showIcon title={t('printTemplate.previewSampleDataMissing')} />
                        ) : null}
                        <div style={{ display: 'grid', gap: 6 }}>
                          <Text type="secondary">{t('printTemplate.previewSampleObjectHint')}</Text>
                          <PreviewObjectPicker
                            targetModel={typeof form.getFieldValue('targetModel') === 'string' ? form.getFieldValue('targetModel') : ''}
                            value={extractPreviewRequestId(previewRequestPayloadText)}
                            disabled={!String(form.getFieldValue('targetModel') ?? '').trim()}
                            onChange={(nextValue) => { void handlePreviewSampleObjectChange(nextValue); }}
                          />
                        </div>
                        <Input.TextArea
                          value={previewRequestPayloadText}
                          onChange={(event) => {
                            setPreviewRequestPayloadText(event.target.value);
                            if (previewDataError) {
                              setPreviewDataError(null);
                            }
                          }}
                          autoSize={{ minRows: 4, maxRows: 10 }}
                          placeholder={t('printTemplate.previewRequestPayloadPlaceholder')}
                          spellCheck={false}
                          style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
                        />
                        {hasPreviewSampleData && !showPreviewDataEditor ? (
                          <Button onClick={() => setShowPreviewDataEditor(true)}>
                            {t('printTemplate.showPreviewJsonEditor')}
                          </Button>
                        ) : null}
                        {!hasPreviewSampleData || showPreviewDataEditor ? (
                          <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                            {hasPreviewSampleData ? (
                              <Button onClick={() => setShowPreviewDataEditor(false)}>
                                {t('printTemplate.hidePreviewJsonEditor')}
                              </Button>
                            ) : null}
                            <Input.TextArea
                              value={previewDataText}
                              onChange={(event) => {
                                setPreviewDataText(event.target.value);
                                if (previewDataError) {
                                  setPreviewDataError(null);
                                }
                              }}
                              autoSize={{ minRows: 8, maxRows: 18 }}
                              spellCheck={false}
                              style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
                            />
                          </Space>
                        ) : null}
                        <Space wrap>
                          <Button loading={loadingPreviewData} onClick={() => void loadPreviewDataFromModel()}>
                            {t('printTemplate.loadPreviewData')}
                          </Button>
                          <Button onClick={applyPreviewData}>{t('printTemplate.applyPreviewData')}</Button>
                          <Button onClick={resetPreviewData}>{t('printTemplate.resetPreviewData')}</Button>
                          <Button onClick={() => setPreviewRequestPayloadText(defaultPreviewRequestPayloadText)}>
                            {t('printTemplate.resetPreviewRequestPayload')}
                          </Button>
                        </Space>
                        {previewDataError ? (
                          <Alert type="error" showIcon title={previewDataError} />
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            <PrintTemplatePreviewHost
              form={form}
              item={item}
              previewData={previewData}
              previewDataSourceLabel={previewDataSourceLabel}
              schemaBlocks={schemaBlocks}
              onSchemaBlocksChange={setSchemaBlocks}
              onAddBlock={addSchemaBlock}
            />
          </Space>
        </Spin>
      )}
    </div>
  );
}
