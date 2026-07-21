import { css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import { t } from "@client/locale.ts";
import { bus } from "@client/bus/bus.ts";
import { tw } from "@client/shared/styles.ts";
import { BaseUI } from "@client/ui-kit/base/base-ui.ts";
import {
  PrintTemplateEditRootSchema,
  type PrintTemplateEditRoot,
  type PrintTemplateItem,
} from "./printTemplate.schema.ts";
import { BLOCK_TYPES, cloneBlock, createBlock, createDefaultBlocks, createFieldItem, createTableColumn } from "./printTemplate.blocks.ts";
// Тільки типи: формат шаблону визначає ядро (server/modules/print), і цей
// import стирається при збірці — рантайм-коду ядра в бандл не потрапляє.
import type {
  PrintTemplateBlock,
  PrintTemplateBlockPlacement,
  PrintTemplateBlockTextOptions,
  PrintTemplateBlockType,
  PrintTemplateColumnAlign,
  PrintTemplateTableColumnItem,
} from "../../../server/modules/print/print-template.ts";

export const tagName = "print-template-edit";

/** Пауза після правки, через яку перемальовується прев'ю. */
const PREVIEW_DEBOUNCE_MS = 700;

/**
 * Поля друку (40pt) у відсотках від аркуша A4 (595.28 × 841.89pt).
 * Ті самі числа, що в рендерері, — тому рамка на полотні стоїть там само,
 * де блок опиниться в PDF.
 */
const PAGE_PADDING_PERCENT = { x: (40 / 595.28) * 100, y: (40 / 841.89) * 100 };

/** Поріг прилипання до напрямної, у відсотках області друку. */
const SNAP_THRESHOLD_PERCENT = 1.2;

/** Крок зсуву стрілками (з Shift — більший). */
const NUDGE_STEP = 1;
const NUDGE_STEP_FAST = 5;

/** Скільки рядків таблиці показувати на схемі — решта не додає інформації. */
const SCHEMATIC_TABLE_ROWS = 8;

/** Значення для схеми: як у рендерері, прочерк замість порожнечі та об'єктів. */
function stringifyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "-";
}

interface PathOption { value: string; label: string; }

/** Геометрія блока у відсотках області друку. */
interface Box { x: number; y: number; w: number; h: number; }

interface SnapGuide { orientation: "vertical" | "horizontal"; position: number; }

function clampSize(value: number) {
  return Math.min(100, Math.max(1, value));
}

/** Позиція не має виштовхувати блок за межі аркуша. */
function clampPosition(value: number, size: number) {
  return Math.min(Math.max(0, 100 - Math.max(size, 0)), Math.max(0, value));
}

function toNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Прилипання: найближчий кандидат у межах порогу або нічого. */
function findSnap(anchors: number[], candidates: number[]) {
  let best: { delta: number; guide: number; distance: number } | null = null;

  for (const anchor of anchors) {
    for (const candidate of candidates) {
      const delta = candidate - anchor;
      const distance = Math.abs(delta);
      if (distance > SNAP_THRESHOLD_PERCENT) continue;
      if (!best || distance < best.distance) best = { delta, guide: candidate, distance };
    }
  }

  return best;
}

/** Значення за крапковим шляхом — для вибірки зразка рядка таблиці. */
function resolvePath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!segment) return current;
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return null;
  }, source);
}

/** Усі скалярні шляхи даних — джерело випадайки прив'язки поля. */
function collectScalarPaths(source: unknown, prefix = "", options: PathOption[] = []): PathOption[] {
  if (Array.isArray(source)) return options;

  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      collectScalarPaths(value, prefix ? `${prefix}.${key}` : key, options);
    }
    return options;
  }

  if (prefix) options.push({ value: prefix, label: prefix });
  return options;
}

/** Усі шляхи-масиви — джерело випадайки `source` для таблиці. */
function collectArrayPaths(source: unknown, prefix = "", options: PathOption[] = []): PathOption[] {
  if (Array.isArray(source)) {
    if (prefix) options.push({ value: prefix, label: prefix });
    return options;
  }

  if (!source || typeof source !== "object") return options;

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    collectArrayPaths(value, prefix ? `${prefix}.${key}` : key, options);
  }

  return options;
}

function sortPaths(options: PathOption[]) {
  return [...options].sort((left, right) => left.label.localeCompare(right.label, "uk"));
}

/** Вибране в шаблоні значення має бути в списку — навіть якщо даних немає. */
function withSelected(options: PathOption[], value: string) {
  const normalized = value.trim();
  if (!normalized || options.some((option) => option.value === normalized)) return options;
  return [{ value: normalized, label: normalized }, ...options];
}

/** Короткий підпис блока у списку. */
function blockLabel(block: PrintTemplateBlock): string {
  if (block.type === "text") return block.value.slice(0, 40) || t("printTemplate.blockType.text");
  if (block.type === "table") return block.title || block.source || t("printTemplate.blockType.table");
  if (block.type === "field-list") return block.items.map((item) => item.label).filter(Boolean).join(", ").slice(0, 40);
  return t(`printTemplate.blockType.${block.type}`);
}

function fileNameFor(code: string) {
  return `${code.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "print_template"}.template.json`;
}

function base64ToBlobUrl(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/**
 * Редактор шаблону друку.
 *
 * Рендеру тут немає: прев'ю малює те саме ядро, що й фінальний друк — редактор
 * шле чернетку шаблону разом із даними в команду `preview` і показує повернутий
 * PDF. Тому прев'ю не може розійтися з друком.
 *
 * Дані для прив'язки полів редактор бере командою `dataCommand` цільової моделі
 * — тією самою, яку потім виконає рантайм друку.
 *
 * Розкладку блоків видно на окремому полотні: аркуш A4 з тими самими полями, що
 * й у рендерера, і рамки блоків поверх нього. У рамках — СХЕМАТИЧНИЙ вміст
 * (див. `renderFrameContent`): достатньо, щоб компонувати форму, але це не
 * контракт вигляду — його показує вкладка PDF.
 */
@customElement(tagName)
export class PrintTemplateEdit extends BaseUI<PrintTemplateEditRoot> {
  static override styles = [tw, css`
    .sheet {
      position: relative;
      background: #fff;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
      touch-action: none;
      user-select: none;
      /* Дає одиницю cqw: 1cqw = 1% ширини аркуша. Через неї розміри шрифтів
         у пунктах перекладаються в екранні — схема виходить у масштабі. */
      container-type: inline-size;
      color: #262626;
    }
    /* Область друку. Поля задані через inset, а не padding: відсотковий padding
       CSS рахує від ШИРИНИ з усіх боків, і вертикальні поля вийшли б вужчими. */
    .sheet-content { position: absolute; }
    .frame {
      position: absolute;
      border: 1px dashed rgba(22, 119, 255, 0.5);
      border-radius: 3px;
      background: rgba(22, 119, 255, 0.04);
      cursor: move;
      overflow: hidden;
      min-height: 14px;
    }
    .frame.selected {
      border: 2px solid rgba(22, 119, 255, 0.9);
      background: rgba(22, 119, 255, 0.1);
      z-index: 20;
    }
    /* Схематичний вміст рамки: тільки щоб було видно, що і де стоїть.
       Джерело правди для вигляду — вкладка PDF. */
    .frame-body { pointer-events: none; overflow: hidden; height: 100%; line-height: 1.3; }
    .frame-fields { display: grid; gap: 0.4cqw; }
    .frame-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .frame-table th, .frame-table td {
      border: 0.1cqw solid #d9d9d9;
      padding: 0.3cqw 0.5cqw;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .frame-table th { background: #f7f7f7; }
    .frame-empty { padding: 1px 4px; font-size: 10px; color: #1c4e80; white-space: nowrap; overflow: hidden; }
    .frame-handle {
      position: absolute;
      right: -6px;
      bottom: -6px;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      background: #1677ff;
      cursor: nwse-resize;
    }
    .frame-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      padding: 0 4px;
      border-radius: 999px;
      background: rgba(22, 119, 255, 0.15);
      color: #1677ff;
      font-size: 9px;
      font-weight: 700;
      pointer-events: none;
    }
    .guide { position: absolute; pointer-events: none; z-index: 30; }
    .guide.vertical { top: 0; bottom: 0; border-left: 1px dashed rgba(250, 140, 22, 0.9); }
    .guide.horizontal { left: 0; right: 0; border-top: 1px dashed rgba(250, 140, 22, 0.9); }
  `];

  protected model = "print_template";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  /** Дані документа для прев'ю (корінь, від якого рахуються шляхи). */
  @state() private previewData: unknown = {};
  @state() private previewDataText = "";
  /** Payload команди даних, напр. `{ "id": "1" }`. */
  @state() private requestPayloadText = "{\n  \"id\": \"\"\n}";
  @state() private previewPdfUrl: string | null = null;
  @state() private previewError: string | null = null;
  /** Поки даних немає — панель відкрита: без них нема з чого будувати шляхи. */
  @state() private showDataTools = true;
  @state() private selectedBlockKey: string | null = null;
  @state() private selectedColumnKey: string | null = null;
  /** Що показуємо в правій колонці: полотно розкладки чи готовий PDF. */
  @state() private viewMode: "layout" | "pdf" = "layout";
  /** Геометрія блока під час перетягування — у $root потрапить лише на pointerup. */
  @state() private dragBox: (Box & { key: string }) | null = null;
  @state() private snapGuides: SnapGuide[] = [];

  #previewTimer?: number;
  #sheet: HTMLElement | null = null;
  /** Стан жесту: що тягнемо, звідки почали, розмір аркуша в пікселях. */
  #drag: {
    mode: "move" | "resize";
    key: string;
    startX: number;
    startY: number;
    origin: Box;
    canResizeHeight: boolean;
    sheetWidth: number;
    sheetHeight: number;
  } | null = null;

  constructor() {
    super(PrintTemplateEditRootSchema);
  }

  override connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener("keydown", this.onKeyDown);
    if (this.modelId) {
      this.load();
    } else {
      this.setBlocks(createDefaultBlocks());
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.#previewTimer);
    this.releasePreviewUrl();
    globalThis.removeEventListener("keydown", this.onKeyDown);
  }

  // ── Полотно розкладки ───────────────────────────────────────────────────────

  /** Геометрія блока: під час жесту — транзієнтна, інакше — зі схеми. */
  private boxOf(block: PrintTemplateBlock): Box {
    if (this.dragBox?.key === block.key) return this.dragBox;
    return {
      x: toNumber(block.placement.xPercent, 0),
      y: toNumber(block.placement.yPercent, 0),
      w: toNumber(block.placement.widthPercent, 100),
      h: toNumber(block.placement.heightPercent, 0),
    };
  }

  /**
   * Чи впливає висота на друк. Рендерер читає її для зображень і ліній; для
   * тексту, списку полів і таблиці вміст ллється від верху рамки, і висота
   * лишається розміткою — місцем, яке блок займає на аркуші. Міняти її можна
   * скрізь (це зручно при компонуванні), але підказку показуємо чесно.
   */
  private heightAffectsPrint(block: PrintTemplateBlock) {
    return block.type === "image" || block.type === "horizontal-line" || block.type === "vertical-line";
  }

  /** Кандидати прилипання: краї аркуша, середина та межі інших блоків. */
  private snapCandidates(exceptKey: string) {
    const x = [0, 50, 100];
    const y = [0, 50, 100];

    for (const block of this.blocks) {
      if (block.key === exceptKey) continue;
      const box = this.boxOf(block);
      x.push(box.x, box.x + box.w / 2, box.x + box.w);
      y.push(box.y, box.y + box.h / 2, box.y + box.h);
    }

    return { x, y };
  }

  private applySnap(box: Box, key: string, mode: "move" | "resize", canResizeHeight: boolean) {
    const candidates = this.snapCandidates(key);
    const guides: SnapGuide[] = [];
    const next = { ...box };

    if (mode === "move") {
      const hit = findSnap([box.x, box.x + box.w / 2, box.x + box.w], candidates.x);
      if (hit) {
        next.x = clampPosition(box.x + hit.delta, box.w);
        guides.push({ orientation: "vertical", position: hit.guide });
      }

      const hitY = findSnap([box.y, box.y + box.h / 2, box.y + box.h], candidates.y);
      if (hitY) {
        next.y = clampPosition(box.y + hitY.delta, box.h);
        guides.push({ orientation: "horizontal", position: hitY.guide });
      }
    } else {
      const hit = findSnap([box.x + box.w], candidates.x);
      if (hit) {
        next.w = clampSize(box.w + hit.delta);
        guides.push({ orientation: "vertical", position: hit.guide });
      }

      if (canResizeHeight) {
        const hitY = findSnap([box.y + box.h], candidates.y);
        if (hitY) {
          next.h = clampSize(box.h + hitY.delta);
          guides.push({ orientation: "horizontal", position: hitY.guide });
        }
      }
    }

    return { box: next, guides };
  }

  private startDrag(event: PointerEvent, mode: "move" | "resize", block: PrintTemplateBlock) {
    const sheet = this.#sheet;
    if (!sheet) return;

    event.preventDefault();
    event.stopPropagation();
    this.selectedBlockKey = block.key;
    this.selectedColumnKey = null;

    const bounds = sheet.getBoundingClientRect();
    const origin = this.boxOf(block);

    this.#drag = {
      mode,
      key: block.key,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      canResizeHeight: true,
      // Рухаємось у координатах ОБЛАСТІ ДРУКУ, а не всього аркуша:
      // відсотки блока рахуються саме від неї.
      sheetWidth: bounds.width * (1 - (PAGE_PADDING_PERCENT.x * 2) / 100),
      sheetHeight: bounds.height * (1 - (PAGE_PADDING_PERCENT.y * 2) / 100),
    };
    this.dragBox = { key: block.key, ...origin };
    this.snapGuides = [];
    // Захоплюємо вказівник: жест не загубиться, якщо курсор вийде за рамку.
    sheet.setPointerCapture(event.pointerId);
  }

  private onSheetPointerMove = (event: PointerEvent) => {
    const drag = this.#drag;
    if (!drag) return;

    event.preventDefault();
    const dx = ((event.clientX - drag.startX) / Math.max(drag.sheetWidth, 1)) * 100;
    const dy = ((event.clientY - drag.startY) / Math.max(drag.sheetHeight, 1)) * 100;

    const raw: Box = drag.mode === "move"
      ? {
        x: clampPosition(drag.origin.x + dx, drag.origin.w),
        y: clampPosition(drag.origin.y + dy, drag.origin.h),
        w: drag.origin.w,
        h: drag.origin.h,
      }
      : {
        x: drag.origin.x,
        y: drag.origin.y,
        w: clampSize(drag.origin.w + dx),
        h: drag.canResizeHeight ? clampSize(drag.origin.h + dy) : drag.origin.h,
      };

    const snapped = this.applySnap(raw, drag.key, drag.mode, drag.canResizeHeight);
    this.dragBox = { key: drag.key, ...snapped.box };
    this.snapGuides = snapped.guides;
  };

  private onSheetPointerUp = () => {
    if (this.#drag) this.commitDragBox();
    this.#drag = null;
    this.snapGuides = [];
  };

  /** Транзієнтна геометрія → у шаблон (і, як наслідок, у прев'ю). */
  private commitDragBox() {
    const box = this.dragBox;
    if (!box) return;

    this.updatePlacement(box.key, {
      xPercent: box.x.toFixed(2),
      yPercent: box.y.toFixed(2),
      widthPercent: box.w.toFixed(2),
      heightPercent: box.h.toFixed(2),
    });
    this.dragBox = null;
  }

  /** Стрілки — точний зсув, Alt+стрілки — розмір, Escape — зняти виділення. */
  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.selectedBlockKey || this.#drag) return;

    if (event.key === "Escape") {
      this.selectedBlockKey = null;
      return;
    }

    if (!event.key.startsWith("Arrow")) return;

    // Не перехоплюємо стрілки, поки користувач редагує поле у формі.
    const active = this.shadowRoot?.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;

    const block = this.selectedBlock;
    if (!block) return;

    event.preventDefault();
    const step = event.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP;
    const box = this.dragBox?.key === block.key ? this.dragBox : this.boxOf(block);
    const next: Box = { ...box };

    if (event.altKey) {
      if (event.key === "ArrowLeft") next.w = clampSize(box.w - step);
      if (event.key === "ArrowRight") next.w = clampSize(box.w + step);
      if (event.key === "ArrowUp") next.h = clampSize(box.h - step);
      if (event.key === "ArrowDown") next.h = clampSize(box.h + step);
    } else {
      if (event.key === "ArrowLeft") next.x = clampPosition(box.x - step, box.w);
      if (event.key === "ArrowRight") next.x = clampPosition(box.x + step, box.w);
      if (event.key === "ArrowUp") next.y = clampPosition(box.y - step, box.h);
      if (event.key === "ArrowDown") next.y = clampPosition(box.y + step, box.h);
    }

    this.dragBox = { key: block.key, ...next };
    this.commitDragBox();
  };

  // ── Дані моделі ─────────────────────────────────────────────────────────────

  private async load() {
    if (!await this.loadInto("get", { id: this.modelId })) return;
    this.schedulePreview();
  }

  private async save() {
    const item: PrintTemplateItem = {
      ...this.$root.item,
      code: this.$root.item.code.trim(),
      name: this.$root.item.name.trim(),
      targetModel: this.$root.item.targetModel.trim(),
      dataCommand: this.$root.item.dataCommand.trim() || "get",
    };

    const env = await this.run<{ item: PrintTemplateItem | null }>("save", { item }, "save");
    if (env.ok && env.data?.item) this.$root.item = env.data.item;
  }

  // ── Блоки ───────────────────────────────────────────────────────────────────

  private get blocks(): PrintTemplateBlock[] {
    return this.$root.item.schema.blocks;
  }

  private setBlocks(blocks: PrintTemplateBlock[]) {
    this.$root.item = { ...this.$root.item, schema: { schemaVersion: 2, blocks } };
    this.schedulePreview();
  }

  private setField<K extends keyof PrintTemplateItem>(field: K, value: PrintTemplateItem[K]) {
    this.$root.item = { ...this.$root.item, [field]: value };
    if (field === "orientation") this.schedulePreview();
  }

  private get selectedBlock(): PrintTemplateBlock | null {
    return this.blocks.find((block) => block.key === this.selectedBlockKey) ?? null;
  }

  /** Точкове оновлення блока — усі зміни властивостей ідуть сюди. */
  private updateBlock(blockKey: string, updater: (block: PrintTemplateBlock) => PrintTemplateBlock) {
    this.setBlocks(this.blocks.map((block) => (block.key === blockKey ? updater(block) : block)));
  }

  private updatePlacement(blockKey: string, patch: Partial<PrintTemplateBlockPlacement>) {
    this.updateBlock(blockKey, (block) => ({ ...block, placement: { ...block.placement, ...patch } }));
  }

  private updateTextOptions(blockKey: string, patch: Partial<PrintTemplateBlockTextOptions>) {
    this.updateBlock(blockKey, (block) => ({ ...block, text: { ...block.text, ...patch } }));
  }

  private updateColumn(blockKey: string, columnKey: string, patch: Partial<PrintTemplateTableColumnItem>) {
    this.updateBlock(blockKey, (block) => (
      block.type === "table"
        ? { ...block, columns: block.columns.map((c) => (c.key === columnKey ? { ...c, ...patch } : c)) }
        : block
    ));
  }

  private addBlock(type: PrintTemplateBlockType) {
    const block = createBlock(type);
    this.setBlocks([...this.blocks, block]);
    this.selectedBlockKey = block.key;
    this.selectedColumnKey = null;
  }

  private duplicateSelected() {
    const source = this.selectedBlock;
    if (!source) return;

    const copy = cloneBlock(source);
    const index = this.blocks.findIndex((block) => block.key === source.key);
    const next = [...this.blocks];
    next.splice(index + 1, 0, copy);
    this.setBlocks(next);
    this.selectedBlockKey = copy.key;
  }

  private deleteSelected() {
    if (!this.selectedBlockKey) return;
    this.setBlocks(this.blocks.filter((block) => block.key !== this.selectedBlockKey));
    this.selectedBlockKey = null;
    this.selectedColumnKey = null;
  }

  private moveBlock(from: number, to: number) {
    if (to < 0 || to >= this.blocks.length) return;
    const next = [...this.blocks];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    this.setBlocks(next);
  }

  // ── Прев'ю ──────────────────────────────────────────────────────────────────

  private releasePreviewUrl() {
    if (this.previewPdfUrl) URL.revokeObjectURL(this.previewPdfUrl);
    this.previewPdfUrl = null;
  }

  /** Правки сиплються часто — перемальовуємо, коли користувач зупинився. */
  private schedulePreview() {
    clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(() => void this.refreshPreview(), PREVIEW_DEBOUNCE_MS);
  }

  /** Рендер чернетки шаблону на сервері тим самим кодом, що й друк. */
  private async refreshPreview() {
    if (!this.blocks.length) {
      this.releasePreviewUrl();
      return;
    }

    const env = await this.run<{ extra?: { pdfBase64?: string; mimeType?: string } }>("preview", {
      targetModel: this.$root.item.targetModel,
      orientation: this.$root.item.orientation,
      schema: { schemaVersion: 2, blocks: this.blocks },
      item: this.previewData,
    });

    const pdfBase64 = env.data?.extra?.pdfBase64;
    if (!env.ok || !pdfBase64) {
      this.previewError = this.messages[0]?.text ?? t("printTemplate.previewRenderError");
      return;
    }

    this.previewError = null;
    this.releasePreviewUrl();
    this.previewPdfUrl = base64ToBlobUrl(pdfBase64, env.data?.extra?.mimeType ?? "application/pdf");
  }

  // ── Дані прев'ю ─────────────────────────────────────────────────────────────

  /**
   * Виконує `dataCommand` цільової моделі і бере `data.item` — рівно те, що
   * потім побачить рантайм друку. З цього JSON будуються списки шляхів.
   */
  private async loadPreviewData() {
    const targetModel = this.$root.item.targetModel.trim();
    const dataCommand = this.$root.item.dataCommand.trim();

    if (!targetModel || !dataCommand) {
      this.previewError = t("printTemplate.previewTargetRequired");
      return;
    }

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = this.requestPayloadText.trim() ? JSON.parse(this.requestPayloadText) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.previewError = t("printTemplate.previewPayloadObjectRequired");
        return;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      this.previewError = t("printTemplate.previewPayloadInvalid");
      return;
    }

    this.previewError = null;
    this.running = "previewData";
    try {
      const env = await bus.request("data.load", { model: targetModel, command: dataCommand, payload }) as {
        ok?: boolean;
        data?: { item?: unknown };
        messages?: Array<{ text?: string }>;
      } | undefined;

      if (!env?.ok) {
        this.previewError = env?.messages?.[0]?.text ?? t("printTemplate.previewLoadError");
        return;
      }

      const item = env.data?.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        this.previewError = t("printTemplate.previewDataEmpty");
        return;
      }

      this.previewData = item;
      this.previewDataText = `${JSON.stringify(item, null, 2)}\n`;
      // Дані є — панель більше не потрібна, звільняємо місце під розкладку.
      this.showDataTools = false;
      this.schedulePreview();
    } catch (error) {
      this.previewError = error instanceof Error ? error.message : t("printTemplate.previewLoadError");
    } finally {
      this.running = null;
    }
  }

  /** Застосувати вручну відредагований JSON як дані прев'ю. */
  private applyPreviewData() {
    const text = this.previewDataText.trim();
    if (!text) {
      this.previewData = {};
      this.previewError = null;
      this.schedulePreview();
      return;
    }

    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.previewError = t("printTemplate.previewDataObjectRequired");
        return;
      }
      this.previewData = parsed;
      this.previewError = null;
      this.schedulePreview();
    } catch {
      this.previewError = t("printTemplate.previewDataInvalid");
    }
  }

  // ── Файл шаблону ────────────────────────────────────────────────────────────

  /** Експорт у той самий формат, що й репозиторний `prints/*.template.json`. */
  private exportToFile() {
    const item = this.$root.item;
    const payload = {
      name: item.name.trim(),
      paperSize: item.paperSize,
      orientation: item.orientation,
      isDefault: item.isDefault,
      isActive: item.isActive,
      schema: { schemaVersion: 2, blocks: this.blocks },
    };

    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileNameFor(item.code);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async importFromFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      const schema = (raw.schema ?? {}) as { blocks?: unknown };
      const blocks = Array.isArray(schema.blocks) ? schema.blocks as PrintTemplateBlock[] : [];

      this.$root.item = {
        ...this.$root.item,
        name: typeof raw.name === "string" ? raw.name : this.$root.item.name,
        orientation: raw.orientation === "landscape" ? "landscape" : "portrait",
        isDefault: typeof raw.isDefault === "boolean" ? raw.isDefault : this.$root.item.isDefault,
        isActive: typeof raw.isActive === "boolean" ? raw.isActive : this.$root.item.isActive,
        schema: { schemaVersion: 2, blocks },
      };
      this.selectedBlockKey = null;
      this.previewError = null;
      this.schedulePreview();
    } catch (error) {
      this.previewError = error instanceof Error ? error.message : t("printTemplate.importError");
    }
  }

  private pickImageFile(blockKey: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        // Картинка живе data:-URL прямо в шаблоні: бекенд не має доступу до
        // файлів клієнта, а шаблон і так зберігається в БД.
        if (typeof reader.result === "string") {
          this.updateBlock(blockKey, (block) => (block.type === "image" ? { ...block, src: reader.result as string } : block));
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Дрібні будівельні блоки розмітки ────────────────────────────────────────

  private field(label: string, input: TemplateResult) {
    return html`
      <label class="form-control">
        <span class="label-text text-xs text-base-content/60">${label}</span>
        ${input}
      </label>
    `;
  }

  private textInput(value: string, onInput: (value: string) => void) {
    return html`<input class="input input-sm input-bordered w-full" .value=${value}
      @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)} />`;
  }

  private colorInput(value: string, onInput: (value: string) => void) {
    return html`
      <span class="flex gap-1">
        <input type="color" class="input input-sm input-bordered w-12 px-1" .value=${value || "#262626"}
          @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)} />
        <input class="input input-sm input-bordered w-full" .value=${value}
          @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)} />
      </span>
    `;
  }

  /**
   * Випадайка шляху прив'язки. Список будується з завантажених даних прев'ю —
   * тому, коли їх немає, замість порожнього списку показуємо, що робити.
   */
  private pathSelect(value: string, options: PathOption[], onChange: (value: string) => void) {
    if (!options.length && !value.trim()) {
      return html`
        <button class="btn btn-sm btn-outline w-full justify-start font-normal"
          @click=${() => { this.showDataTools = true; }}>
          ${t("printTemplate.pathsNeedData")}
        </button>
      `;
    }

    return html`
      <select class="select select-sm select-bordered w-full"
        @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="" ?selected=${!value}>—</option>
        ${withSelected(options, value).map((option) => html`
          <option value=${option.value} ?selected=${option.value === value}>${option.label}</option>
        `)}
      </select>
    `;
  }

  private alignButtons(value: PrintTemplateColumnAlign, onChange: (value: PrintTemplateColumnAlign) => void) {
    const items: Array<[PrintTemplateColumnAlign, string]> = [["left", "⯇"], ["center", "≡"], ["right", "⯈"]];
    return html`
      <span class="join">
        ${items.map(([align, glyph]) => html`
          <button class="join-item btn btn-xs ${value === align ? "btn-primary" : ""}"
            @click=${() => onChange(align)}>${glyph}</button>
        `)}
      </span>
    `;
  }

  // ── Панель властивостей ─────────────────────────────────────────────────────

  private renderProperties(): TemplateResult {
    const block = this.selectedBlock;
    if (!block) {
      return html`<div class="p-4 text-center text-sm text-base-content/50">${t("printTemplate.propertiesEmpty")}</div>`;
    }

    const scalarPaths = sortPaths(collectScalarPaths(this.previewData));
    const arrayPaths = sortPaths(collectArrayPaths(this.previewData));
    const supportsText = block.type !== "image" && block.type !== "horizontal-line" && block.type !== "vertical-line";

    return html`
      <div class="flex flex-col gap-3 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold">${t(`printTemplate.blockType.${block.type}`)}</span>
          <span class="flex gap-1">
            <button class="btn btn-xs" @click=${this.duplicateSelected}>${t("printTemplate.duplicateBlock")}</button>
            <button class="btn btn-xs btn-error btn-outline" @click=${this.deleteSelected}>${t("common.delete")}</button>
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2">
          ${this.field(t("printTemplate.placementX"), this.textInput(block.placement.xPercent, (v) => this.updatePlacement(block.key, { xPercent: v })))}
          ${this.field(t("printTemplate.placementY"), this.textInput(block.placement.yPercent, (v) => this.updatePlacement(block.key, { yPercent: v })))}
          ${this.field(t("printTemplate.placementWidth"), this.textInput(block.placement.widthPercent, (v) => this.updatePlacement(block.key, { widthPercent: v })))}
          ${this.field(
            this.heightAffectsPrint(block)
              ? t("printTemplate.placementHeight")
              : t("printTemplate.placementHeightLayout"),
            this.textInput(block.placement.heightPercent, (v) => this.updatePlacement(block.key, { heightPercent: v })),
          )}
        </div>

        ${supportsText ? html`
          <div class="grid grid-cols-2 gap-2">
            ${this.field(t("printTemplate.fontSize"), this.textInput(block.text.fontSize, (v) => this.updateTextOptions(block.key, { fontSize: v })))}
            ${this.field(t("printTemplate.fontColor"), this.colorInput(block.text.color, (v) => this.updateTextOptions(block.key, { color: v })))}
            ${this.field(t("printTemplate.fontAlign"), this.alignButtons(block.text.align, (align) => this.updateTextOptions(block.key, { align })))}
            ${this.field(t("printTemplate.fontWeight"), html`
              <button class="btn btn-xs ${block.text.fontWeight === "bold" ? "btn-primary" : ""}"
                @click=${() => this.updateTextOptions(block.key, { fontWeight: block.text.fontWeight === "bold" ? "normal" : "bold" })}>B</button>
            `)}
          </div>
        ` : nothing}

        ${block.type === "text" ? html`
          ${this.field(t("printTemplate.textValue"), html`
            <textarea class="textarea textarea-sm textarea-bordered w-full" rows="3" .value=${block.value}
              @input=${(e: Event) => this.updateBlock(block.key, (b) => (b.type === "text" ? { ...b, value: (e.target as HTMLTextAreaElement).value } : b))}></textarea>
          `)}
          ${this.field(t("printTemplate.textStyle"), html`
            <select class="select select-sm select-bordered w-full"
              @change=${(e: Event) => this.updateBlock(block.key, (b) => (b.type === "text" ? { ...b, style: (e.target as HTMLSelectElement).value as typeof b.style } : b))}>
              ${["title", "section", "body"].map((style) => html`
                <option value=${style} ?selected=${style === block.style}>${t(`printTemplate.textStyleOption.${style}`)}</option>
              `)}
            </select>
          `)}
        ` : nothing}

        ${block.type === "image" ? html`
          <button class="btn btn-sm" @click=${() => this.pickImageFile(block.key)}>${t("printTemplate.imageSelect")}</button>
          ${this.field(t("printTemplate.imageAlt"), this.textInput(block.alt, (v) => this.updateBlock(block.key, (b) => (b.type === "image" ? { ...b, alt: v } : b))))}
        ` : nothing}

        ${block.type === "horizontal-line" || block.type === "vertical-line" ? html`
          <div class="grid grid-cols-2 gap-2">
            ${this.field(t("printTemplate.lineStyle"), html`
              <select class="select select-sm select-bordered w-full"
                @change=${(e: Event) => this.updateBlock(block.key, (b) => (
                  b.type === "horizontal-line" || b.type === "vertical-line"
                    ? { ...b, lineStyle: (e.target as HTMLSelectElement).value as typeof b.lineStyle }
                    : b
                ))}>
                ${["solid", "dashed", "dotted", "double"].map((style) => html`
                  <option value=${style} ?selected=${style === block.lineStyle}>${t(`printTemplate.lineStyleOption.${style}`)}</option>
                `)}
              </select>
            `)}
            ${this.field(t("printTemplate.lineWidth"), this.textInput(block.lineWidth, (v) => this.updateBlock(block.key, (b) => (
              b.type === "horizontal-line" || b.type === "vertical-line" ? { ...b, lineWidth: v } : b
            ))))}
            ${this.field(t("printTemplate.lineColor"), this.colorInput(block.color, (v) => this.updateBlock(block.key, (b) => (
              b.type === "horizontal-line" || b.type === "vertical-line" ? { ...b, color: v } : b
            ))))}
          </div>
        ` : nothing}

        ${block.type === "field-list" ? this.renderFieldListProperties(block, scalarPaths) : nothing}
        ${block.type === "table" ? this.renderTableProperties(block, arrayPaths) : nothing}
      </div>
    `;
  }

  private renderFieldListProperties(
    block: Extract<PrintTemplateBlock, { type: "field-list" }>,
    scalarPaths: PathOption[],
  ) {
    return html`
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">${t("printTemplate.fields")}</span>
          <button class="btn btn-xs" @click=${() => this.updateBlock(block.key, (b) => (
            b.type === "field-list" ? { ...b, items: [...b.items, createFieldItem(b.items.length + 1)] } : b
          ))}>+ ${t("printTemplate.addField")}</button>
        </div>

        ${block.items.map((fieldItem, index) => html`
          <div class="flex flex-col gap-1 rounded border border-base-300 p-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-base-content/50">${index + 1}</span>
              <span class="flex gap-1">
                <button class="btn btn-ghost btn-xs" ?disabled=${index === 0}
                  @click=${() => this.moveFieldItem(block.key, index, index - 1)}>↑</button>
                <button class="btn btn-ghost btn-xs" ?disabled=${index === block.items.length - 1}
                  @click=${() => this.moveFieldItem(block.key, index, index + 1)}>↓</button>
                <button class="btn btn-ghost btn-xs text-error"
                  @click=${() => this.updateBlock(block.key, (b) => (
                    b.type === "field-list" ? { ...b, items: b.items.filter((entry) => entry.key !== fieldItem.key) } : b
                  ))}>✕</button>
              </span>
            </div>
            ${this.textInput(fieldItem.label, (v) => this.updateBlock(block.key, (b) => (
              b.type === "field-list"
                ? { ...b, items: b.items.map((entry) => (entry.key === fieldItem.key ? { ...entry, label: v } : entry)) }
                : b
            )))}
            ${this.pathSelect(fieldItem.path, scalarPaths, (v) => this.updateBlock(block.key, (b) => (
              b.type === "field-list"
                ? { ...b, items: b.items.map((entry) => (entry.key === fieldItem.key ? { ...entry, path: v } : entry)) }
                : b
            )))}
          </div>
        `)}
      </div>
    `;
  }

  private moveFieldItem(blockKey: string, from: number, to: number) {
    this.updateBlock(blockKey, (block) => {
      if (block.type !== "field-list") return block;
      const items = [...block.items];
      const [moved] = items.splice(from, 1);
      if (!moved) return block;
      items.splice(to, 0, moved);
      return { ...block, items };
    });
  }

  private renderTableProperties(
    block: Extract<PrintTemplateBlock, { type: "table" }>,
    arrayPaths: PathOption[],
  ) {
    // Шляхи колонок відносні до ОДНОГО рядка масиву-джерела, а не до кореня.
    const sample = resolvePath(this.previewData, block.source);
    const rowSample = Array.isArray(sample) ? sample[0] ?? null : null;
    const columnPaths = sortPaths(collectScalarPaths(rowSample));
    const column = block.columns.find((c) => c.key === this.selectedColumnKey) ?? null;

    return html`
      <div class="flex flex-col gap-2">
        ${this.field(t("printTemplate.tableTitle"), this.textInput(block.title, (v) => this.updateBlock(block.key, (b) => (
          b.type === "table" ? { ...b, title: v } : b
        ))))}
        ${this.field(t("printTemplate.tableSource"), this.pathSelect(block.source, arrayPaths, (v) => this.updateBlock(block.key, (b) => (
          b.type === "table" ? { ...b, source: v } : b
        ))))}

        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">${t("printTemplate.columns")}</span>
          <button class="btn btn-xs" @click=${() => this.addColumn(block.key, block.columns.length + 1)}>
            + ${t("printTemplate.addColumn")}
          </button>
        </div>

        <div class="flex flex-wrap gap-1">
          ${block.columns.map((entry) => html`
            <button class="btn btn-xs ${entry.key === this.selectedColumnKey ? "btn-primary" : "btn-outline"}"
              @click=${() => { this.selectedColumnKey = entry.key; }}>${entry.title || "—"}</button>
          `)}
        </div>

        ${column ? html`
          <div class="flex flex-col gap-2 rounded border border-base-300 p-2">
            ${this.field(t("printTemplate.columnTitle"), this.textInput(column.title, (v) => this.updateColumn(block.key, column.key, { title: v })))}
            ${this.field(t("printTemplate.columnPath"), this.pathSelect(column.path, columnPaths, (v) => this.updateColumn(block.key, column.key, { path: v })))}
            ${this.field(t("printTemplate.columnWidth"), this.textInput(column.widthPercent, (v) => this.updateColumn(block.key, column.key, { widthPercent: v })))}

            <div class="grid grid-cols-2 gap-2">
              ${this.field(t("printTemplate.columnHeaderAlign"), this.alignButtons(column.headerAlign, (align) => this.updateColumn(block.key, column.key, { headerAlign: align })))}
              ${this.field(t("printTemplate.columnValueAlign"), this.alignButtons(column.valueAlign, (align) => this.updateColumn(block.key, column.key, { valueAlign: align })))}
              ${this.field(t("printTemplate.columnHeaderFontSize"), this.textInput(column.headerFontSize, (v) => this.updateColumn(block.key, column.key, { headerFontSize: v })))}
              ${this.field(t("printTemplate.columnValueFontSize"), this.textInput(column.valueFontSize, (v) => this.updateColumn(block.key, column.key, { valueFontSize: v })))}
            </div>

            <button class="btn btn-xs btn-error btn-outline" ?disabled=${block.columns.length <= 1}
              @click=${() => this.deleteColumn(block.key, column.key)}>${t("printTemplate.deleteColumn")}</button>
          </div>
        ` : html`<div class="text-xs text-base-content/50">${t("printTemplate.columnSelectHint")}</div>`}
      </div>
    `;
  }

  private addColumn(blockKey: string, index: number) {
    const column = createTableColumn(index);
    this.updateBlock(blockKey, (block) => (block.type === "table" ? { ...block, columns: [...block.columns, column] } : block));
    this.selectedColumnKey = column.key;
  }

  private deleteColumn(blockKey: string, columnKey: string) {
    this.updateBlock(blockKey, (block) => (
      block.type === "table" ? { ...block, columns: block.columns.filter((c) => c.key !== columnKey) } : block
    ));
    this.selectedColumnKey = null;
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────

  private renderBlockList() {
    return html`
      <div class="flex flex-col gap-1">
        ${this.blocks.map((block, index) => html`
          <div class="flex items-center gap-1">
            <button
              class="btn btn-xs flex-1 justify-start ${block.key === this.selectedBlockKey ? "btn-primary" : "btn-ghost"}"
              @click=${() => { this.selectedBlockKey = block.key; this.selectedColumnKey = null; }}
            >
              <span class="opacity-60">${t(`printTemplate.blockType.${block.type}`)}</span>
              <span class="truncate">${blockLabel(block)}</span>
            </button>
            <button class="btn btn-ghost btn-xs" ?disabled=${index === 0}
              @click=${() => this.moveBlock(index, index - 1)}>↑</button>
            <button class="btn btn-ghost btn-xs" ?disabled=${index === this.blocks.length - 1}
              @click=${() => this.moveBlock(index, index + 1)}>↓</button>
          </div>
        `)}
        ${this.blocks.length === 0
          ? html`<div class="p-2 text-center text-xs text-base-content/40">${t("common.noData")}</div>`
          : ""}
      </div>
    `;
  }

  /**
   * Схематичний вміст блока для полотна розкладки.
   *
   * Це навмисно НЕ рендер друку: перенесення рядків, розриви сторінок і точні
   * метрики шрифтів тут не відтворюються. Задача одна — щоб під час компонування
   * було видно, що саме стоїть у рамці. Точний вигляд показує вкладка PDF.
   *
   * Розміри шрифтів задані в `cqw` (1cqw = 1 % ширини аркуша), тому пункти PDF
   * лягають на екран у масштабі: 1pt = 100/595.28 cqw.
   */
  private renderFrameContent(block: PrintTemplateBlock): TemplateResult {
    const pt = (value: string | number, fallback = 10) => {
      const size = typeof value === "number" ? value : toNumber(value, fallback);
      return `${(size * 100) / 595.28}cqw`;
    };
    const common = (options: PrintTemplateBlockTextOptions) => [
      `font-size:${pt(options.fontSize)}`,
      `font-weight:${options.fontWeight === "bold" ? 700 : 400}`,
      `text-align:${options.align}`,
      `color:${options.color}`,
    ].join(";");

    if (block.type === "text") {
      return html`<div class="frame-body" style="${common(block.text)};white-space:pre-wrap">${block.value}</div>`;
    }

    if (block.type === "field-list") {
      return html`
        <div class="frame-body frame-fields" style=${common(block.text)}>
          ${block.items.map((item) => html`
            <div><strong>${item.label}:</strong> ${stringifyValue(resolvePath(this.previewData, item.path))}</div>
          `)}
        </div>
      `;
    }

    if (block.type === "table") {
      const source = resolvePath(this.previewData, block.source);
      const rows = Array.isArray(source) ? source.slice(0, SCHEMATIC_TABLE_ROWS) : [];
      const columns = block.columns.filter((column) => column.key && column.title);
      const totalWeight = columns.reduce((sum, column) => sum + (toNumber(column.widthPercent, 0) || 1), 0) || 1;

      return html`
        <div class="frame-body" style=${common(block.text)}>
          ${block.title.trim()
            ? html`<div style="font-weight:600;font-size:${pt(toNumber(block.text.fontSize, 10) + 2)}">${block.title}</div>`
            : nothing}
          <table class="frame-table">
            <thead>
              <tr>
                ${columns.map((column) => html`
                  <th style="
                    width:${((toNumber(column.widthPercent, 0) || 1) / totalWeight) * 100}%;
                    text-align:${column.headerAlign};
                    font-weight:${column.headerFontWeight === "bold" ? 700 : 400};
                    font-size:${pt(column.headerFontSize || block.text.fontSize)};
                    color:${column.headerColor || block.text.color};
                  ">${column.title}</th>
                `)}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => html`
                <tr>
                  ${columns.map((column) => html`
                    <td style="
                      text-align:${column.valueAlign};
                      font-weight:${column.valueFontWeight === "bold" ? 700 : 400};
                      font-size:${pt(column.valueFontSize || block.text.fontSize)};
                      color:${column.valueColor || block.text.color};
                    ">${stringifyValue(resolvePath(row, column.path))}</td>
                  `)}
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `;
    }

    if (block.type === "image") {
      return block.src.trim()
        ? html`<img class="frame-body" src=${block.src} alt=${block.alt}
            style="width:100%;height:100%;object-fit:contain" />`
        : html`<div class="frame-empty">${t("printTemplate.imageEmpty")}</div>`;
    }

    if (block.type === "horizontal-line") {
      return html`<div class="frame-body" style="display:flex;align-items:center">
        <div style="width:100%;border-top:${block.lineWidth}px ${block.lineStyle} ${block.color}"></div>
      </div>`;
    }

    return html`<div class="frame-body" style="display:flex;justify-content:center">
      <div style="height:100%;border-left:${block.lineWidth}px ${block.lineStyle} ${block.color}"></div>
    </div>`;
  }

  /** Аркуш із рамками блоків: перетягування, розмір, напрямні. */
  private renderLayoutSheet() {
    const landscape = this.$root.item.orientation === "landscape";
    // Область друку — абсолютний блок із відступами у відсотках: по вертикалі
    // вони рахуються від висоти аркуша, як і в рендерері.
    const contentInset = [
      `left:${PAGE_PADDING_PERCENT.x}%`,
      `right:${PAGE_PADDING_PERCENT.x}%`,
      `top:${PAGE_PADDING_PERCENT.y}%`,
      `bottom:${PAGE_PADDING_PERCENT.y}%`,
    ].join(";");

    return html`
      <div
        class="sheet w-full rounded"
        style="aspect-ratio:${landscape ? "297 / 210" : "210 / 297"}"
        ${ref((element: Element | undefined) => { this.#sheet = (element as HTMLElement) ?? null; })}
        @pointerdown=${(e: PointerEvent) => {
          // Клік по вільному місцю аркуша знімає виділення.
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.sheetArea === "content") {
            this.selectedBlockKey = null;
            this.selectedColumnKey = null;
          }
        }}
        @pointermove=${this.onSheetPointerMove}
        @pointerup=${this.onSheetPointerUp}
        @pointercancel=${this.onSheetPointerUp}
      >
        <div class="sheet-content" style=${contentInset} data-sheet-area="content">
          ${this.snapGuides.map((guide) => html`
            <div class="guide ${guide.orientation}"
              style=${guide.orientation === "vertical" ? `left:${guide.position}%` : `top:${guide.position}%`}></div>
          `)}

          ${this.blocks.map((block) => {
            const box = this.boxOf(block);
            const selected = block.key === this.selectedBlockKey;
            const style = [
              `left:${box.x}%`,
              `top:${box.y}%`,
              `width:${box.w}%`,
              box.h > 0 ? `height:${box.h}%` : "",
            ].filter(Boolean).join(";");

            return html`
              <div
                class="frame ${selected ? "selected" : ""}"
                style=${style}
                title=${`${t(`printTemplate.blockType.${block.type}`)}: ${blockLabel(block)}`}
                @pointerdown=${(e: PointerEvent) => this.startDrag(e, "move", block)}
              >
                ${this.renderFrameContent(block)}
                ${selected ? html`
                  <span class="frame-badge">
                    ${box.x.toFixed(1)}, ${box.y.toFixed(1)} · ${box.w.toFixed(1)} × ${box.h.toFixed(1)}
                  </span>
                  <span class="frame-handle" @pointerdown=${(e: PointerEvent) => this.startDrag(e, "resize", block)}></span>
                ` : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  override render() {
    if (this.running === "get") {
      return html`<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>`;
    }

    const item = this.$root.item;

    return html`
      <div class="flex flex-col gap-4 p-4">
        ${this.renderNotice()}

        <!-- Реквізити шаблону -->
        <fieldset class="grid grid-cols-2 gap-3 rounded-lg border border-base-300 px-4 pb-3 md:grid-cols-4">
          <legend class="px-2 text-sm text-base-content/60">${t("printTemplate.titleOne")}</legend>
          ${this.field(t("common.code"), this.textInput(item.code, (v) => this.setField("code", v)))}
          ${this.field(t("common.name"), this.textInput(item.name, (v) => this.setField("name", v)))}
          ${this.field(t("printTemplate.targetModel"), this.textInput(item.targetModel, (v) => this.setField("targetModel", v)))}
          ${this.field(t("printTemplate.dataCommand"), this.textInput(item.dataCommand, (v) => this.setField("dataCommand", v)))}
          ${this.field(t("printTemplate.orientation"), html`
            <select class="select select-sm select-bordered w-full"
              @change=${(e: Event) => this.setField("orientation", (e.target as HTMLSelectElement).value as PrintTemplateItem["orientation"])}>
              ${["portrait", "landscape"].map((value) => html`
                <option value=${value} ?selected=${value === item.orientation}>${t(`printTemplate.orientationOption.${value}`)}</option>
              `)}
            </select>
          `)}
          <label class="label cursor-pointer justify-start gap-2 self-end">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isDefault}
              @change=${(e: Event) => this.setField("isDefault", (e.target as HTMLInputElement).checked)} />
            <span class="label-text">${t("printTemplate.isDefault")}</span>
          </label>
          <label class="label cursor-pointer justify-start gap-2 self-end">
            <input type="checkbox" class="checkbox checkbox-sm" .checked=${item.isActive}
              @change=${(e: Event) => this.setField("isActive", (e.target as HTMLInputElement).checked)} />
            <span class="label-text">${t("common.active")}</span>
          </label>
        </fieldset>

        <!-- Тулбар -->
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-sm btn-primary" ?disabled=${!this.canSave} @click=${this.save}>
            ${this.running === "save" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
            ${t("common.save")}
          </button>
          <details class="dropdown">
            <summary class="btn btn-sm">+ ${t("printTemplate.addBlock")}</summary>
            <ul class="menu dropdown-content z-20 w-52 rounded-box bg-base-100 p-2 shadow">
              ${BLOCK_TYPES.map((type) => html`
                <li><a @click=${() => this.addBlock(type)}>${t(`printTemplate.blockType.${type}`)}</a></li>
              `)}
            </ul>
          </details>
          <button class="btn btn-sm" @click=${() => { this.showDataTools = !this.showDataTools; }}>
            ${t("printTemplate.previewDataTools")}
          </button>
          <div class="flex-1"></div>
          <label class="btn btn-sm">
            ${t("printTemplate.importFromFile")}
            <input type="file" accept="application/json,.json" class="hidden"
              @change=${(e: Event) => void this.importFromFile(e)} />
          </label>
          <button class="btn btn-sm" @click=${this.exportToFile}>${t("printTemplate.exportToFile")}</button>
        </div>

        ${this.previewError ? html`<div class="alert alert-error py-2 text-sm">${this.previewError}</div>` : ""}

        <!-- Дані прев'ю -->
        ${this.showDataTools ? html`
          <div class="flex flex-col gap-2 rounded-lg border border-base-300 p-3">
            <span class="text-sm text-base-content/60">${t("printTemplate.previewPayloadHint")}</span>
            <textarea class="textarea textarea-sm textarea-bordered font-mono" rows="4" .value=${this.requestPayloadText}
              @input=${(e: Event) => { this.requestPayloadText = (e.target as HTMLTextAreaElement).value; }}></textarea>
            <textarea class="textarea textarea-sm textarea-bordered font-mono" rows="8" .value=${this.previewDataText}
              @input=${(e: Event) => { this.previewDataText = (e.target as HTMLTextAreaElement).value; }}></textarea>
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-sm" ?disabled=${this.busy} @click=${this.loadPreviewData}>
                ${this.running === "previewData" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                ${t("printTemplate.loadPreviewData")}
              </button>
              <button class="btn btn-sm" @click=${this.applyPreviewData}>${t("printTemplate.applyPreviewData")}</button>
              <button class="btn btn-sm btn-ghost"
                @click=${() => { this.previewData = {}; this.previewDataText = ""; this.schedulePreview(); }}>
                ${t("printTemplate.resetPreviewData")}
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Блоки + властивості + прев'ю -->
        <div class="flex flex-wrap items-start gap-4">
          <div class="flex w-full max-w-sm flex-col gap-2">
            <div class="rounded-lg border border-base-300 p-2">${this.renderBlockList()}</div>
            <div class="rounded-lg border border-base-300 bg-base-100">${this.renderProperties()}</div>
          </div>

          <div class="flex min-w-[20rem] flex-1 flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="join">
                <button class="join-item btn btn-xs ${this.viewMode === "layout" ? "btn-primary" : ""}"
                  @click=${() => { this.viewMode = "layout"; }}>${t("printTemplate.viewLayout")}</button>
                <button class="join-item btn btn-xs ${this.viewMode === "pdf" ? "btn-primary" : ""}"
                  @click=${() => { this.viewMode = "pdf"; }}>${t("printTemplate.viewPdf")}</button>
              </span>
              ${this.viewMode === "pdf"
                ? html`<button class="btn btn-xs" ?disabled=${this.busy} @click=${() => void this.refreshPreview()}>
                    ${this.running === "preview" ? html`<span class="loading loading-spinner loading-xs"></span>` : ""}
                    ${t("printTemplate.refreshPreview")}
                  </button>`
                : html`<span class="text-xs text-base-content/50">${t("printTemplate.layoutHint")}</span>`}
            </div>

            ${this.viewMode === "layout"
              ? this.renderLayoutSheet()
              : this.previewPdfUrl
                ? html`<iframe class="h-[42rem] w-full rounded-lg border border-base-300" src=${this.previewPdfUrl}
                    title=${t("printTemplate.preview")}></iframe>`
                : html`<div class="flex h-[42rem] items-center justify-center rounded-lg border border-dashed border-base-300 text-sm text-base-content/40">
                    ${t("printTemplate.previewEmpty")}
                  </div>`}
          </div>
        </div>
      </div>
    `;
  }
}
