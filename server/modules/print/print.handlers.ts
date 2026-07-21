// Рантайм-команди друку — точки, до яких прив'язуються моделі застосунку.
//
// `runtime.printPdf` (кнопка друку у формі моделі):
//   1. app.print_template_resolve — активний шаблон для моделі;
//   2. SQL-команда, названа в шаблоні (`dataCommand`) → data.item;
//   3. рендер PDF → base64 у `data.extra`.
//
// `runtime.printPreview` (прев'ю в редакторі шаблону): шаблон приходить
// чернеткою прямо в payload, дані — вже завантаженим JSON. Так редактор не
// містить власного рендеру: те, що він показує, намальовано тим самим кодом,
// що й фінальний друк.
//
// Шаблони рантайм читає ТІЛЬКИ з БД — жодних файлів шаблонів на диску.

import { getModelConfig } from "../model-runtime/model-registry.ts";
import type { ModelCommandContext } from "../model-runtime/model-runtime.types.ts";
import { normalizePrintTemplateSchema } from "./print-template.ts";
import { renderPrintPdf } from "./print-pdf.renderer.ts";
import type { PrintTemplateRuntimeItem } from "./print-pdf.renderer.ts";

const STANDARD_COMMANDS = new Set(["list", "get", "save", "delete", "lookup"]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface Envelope<TItem> {
  ok: boolean;
  data?: { item?: TItem | null };
  messages?: Array<{ type?: string; text?: string } | string>;
}

function firstMessageText(messages: Envelope<unknown>["messages"]): string | null {
  const first = messages?.[0];
  if (!first) return null;
  return typeof first === "string" ? first : first.text ?? null;
}

function toPlainJson(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item) => toPlainJson(item));

  if (value && typeof value === "object") {
    const plain: Record<string, JsonValue> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
      plain[key] = toPlainJson(record[key]);
    }
    return plain;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return null;
}

function assertIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} має містити лише lowercase, digits та underscore`);
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Конверт відповіді з PDF у `extra` — однаковий для друку і для прев'ю. */
function pdfEnvelope(bytes: Uint8Array, extra: Record<string, unknown>) {
  return {
    ok: true,
    data: {
      item: null,
      rows: [],
      options: {},
      totals: {},
      extra: {
        mimeType: "application/pdf",
        pdfBase64: encodeBase64(bytes),
        ...extra,
      },
    },
    messages: [],
    meta: {},
  };
}

/**
 * Ім'я SQL-функції для команди даних шаблону. Правила ті самі, що в
 * ModelRuntimeService: явний sqlCommands з маніфесту, інакше `{model}_{command}`
 * для стандартної п'ятірки.
 */
function resolveDataSqlCommand(targetModel: string, dataCommand: string) {
  const config = getModelConfig(targetModel);

  if (config?.tsCommands?.[dataCommand]) {
    throw new Error(`Команда друку ${targetModel}.${dataCommand} — TS-handler; PDF-рендерер очікує SQL-команду`);
  }

  const declared = config?.sqlCommands?.[dataCommand];
  const sqlCommand = typeof declared === "string"
    ? { schema: config?.schema, functionName: declared }
    : declared ?? (STANDARD_COMMANDS.has(dataCommand)
      ? { schema: config?.schema, functionName: `${targetModel}_${dataCommand}` }
      : null);

  if (!sqlCommand) {
    throw new Error(`Команда друку ${targetModel}.${dataCommand} не налаштована`);
  }

  const schema = sqlCommand.schema ?? config?.schema ?? "app";
  const functionName = sqlCommand.functionName ?? `${targetModel}_${dataCommand}`;

  assertIdentifier(schema, "schema");
  assertIdentifier(functionName, "functionName");

  return { schema, functionName };
}

/** Активний шаблон друку моделі. */
export async function loadPrintTemplate(
  targetModel: string,
  templateCode: string | null,
  ctx: ModelCommandContext,
): Promise<PrintTemplateRuntimeItem> {
  const rows = await ctx.db.sql<{ result: Envelope<PrintTemplateRuntimeItem> }[]>`
    select app.print_template_resolve(
      ${ctx.userId}::bigint,
      ${ctx.db.sql.json(toPlainJson({ targetModel, templateCode }))}::jsonb
    ) as result
  `;

  const result = rows[0]?.result;
  if (!result?.ok || !result.data?.item) {
    throw new Error(firstMessageText(result?.messages) ?? `Не знайдено активний шаблон друку для ${targetModel}`);
  }

  const schema = normalizePrintTemplateSchema(result.data.item.schema);
  if (!schema) {
    throw new Error("Шаблон друку порожній або не у форматі schemaVersion 2");
  }

  return { ...result.data.item, schema };
}

/** Дані документа для друку — те, що команда шаблону поклала в `data.item`. */
export async function loadPrintData(
  targetModel: string,
  dataCommand: string,
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const { schema, functionName } = resolveDataSqlCommand(targetModel, dataCommand);

  const rows = await ctx.db.sql<{ result: Envelope<unknown> }[]>`
    select ${ctx.db.sql(schema)}.${ctx.db.sql(functionName)}(
      ${ctx.userId}::bigint,
      ${ctx.db.sql.json(toPlainJson(payload))}::jsonb
    ) as result
  `;

  const result = rows[0]?.result;
  if (!result?.ok || !result.data?.item) {
    throw new Error(
      firstMessageText(result?.messages) ??
        `Не вдалося завантажити дані для друку через ${targetModel}.${dataCommand}`,
    );
  }

  return result.data.item;
}

/** Ім'я файлу: `<модель>-<номер/код/id>.pdf`. */
function buildFileName(model: string, printData: unknown, fallbackId: string) {
  const root = (printData && typeof printData === "object" ? printData : {}) as Record<string, unknown>;
  const document = (root.document && typeof root.document === "object" ? root.document : {}) as Record<string, unknown>;
  const candidates = [root.number, document.number, root.code, document.code, root.id, document.id, fallbackId];

  const identifier = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
  );

  return `${model.replaceAll("_", "-")}-${(identifier ?? fallbackId).trim()}.pdf`;
}

/** `runtime.printPdf` — друк запису моделі за активним шаблоном. */
export async function printPdfHandler(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    throw new Error("id обов'язковий для printPdf");
  }

  const templateCode = typeof payload.templateCode === "string" && payload.templateCode.trim()
    ? payload.templateCode.trim()
    : null;

  const template = await loadPrintTemplate(ctx.model, templateCode, ctx);
  const printData = await loadPrintData(template.targetModel, template.dataCommand, payload, ctx);
  const bytes = await renderPrintPdf(template, printData);

  return pdfEnvelope(bytes, {
    fileName: buildFileName(ctx.model, printData, id),
    templateCode: template.code,
    templateName: template.name,
  });
}

/**
 * `runtime.printPreview` — рендер незбереженої чернетки шаблону.
 *
 * Дані беруться з payload (`item`), а не з БД: редактор уже має цей JSON —
 * він же живить список доступних шляхів прив'язки.
 */
export async function printPreviewHandler(
  payload: Record<string, unknown>,
  _ctx: ModelCommandContext,
): Promise<unknown> {
  const schema = normalizePrintTemplateSchema(payload.schema);
  if (!schema) {
    throw new Error("Чернетка шаблону порожня або не у форматі schemaVersion 2");
  }

  const template: PrintTemplateRuntimeItem = {
    code: "preview",
    name: "preview",
    targetModel: typeof payload.targetModel === "string" ? payload.targetModel : "",
    dataCommand: "",
    orientation: payload.orientation === "landscape" ? "landscape" : "portrait",
    schema,
  };

  const bytes = await renderPrintPdf(template, payload.item ?? {});

  return pdfEnvelope(bytes, { fileName: "preview.pdf" });
}
