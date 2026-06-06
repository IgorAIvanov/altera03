import { encodeBase64 } from "jsr:@std/encoding/base64";
import ExcelJS from "npm:exceljs@^4.4.0";
import type { ModelCommandContext } from "../model-runtime.types.ts";

interface ModelExcelColumnConfig {
  key: string;
  title: string;
  width?: number;
  numFmt?: string;
  value: (row: Record<string, unknown>) => string | number | boolean | null;
}

interface ModelExcelExportConfig {
  fileNamePrefix: string;
  sheetName: string;
  schema?: string;
  maxRows?: number;
  columns: ModelExcelColumnConfig[];
}

interface ModelIndexEnvelope {
  ok?: boolean;
  data?: {
    rows?: unknown;
    totals?: {
      count?: number | string;
    };
  };
  messages?: string[];
  meta?: Record<string, unknown>;
}

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_MAX_ROWS = 50_000;

const exportConfigs: Record<string, ModelExcelExportConfig> = {
  manual_entry: {
    fileNamePrefix: "manual-entry",
    sheetName: "Journal",
    columns: [
      {
        key: "date",
        title: "Дата",
        width: 14,
        value: (row) => formatDateValue(row.date),
      },
      {
        key: "number",
        title: "Номер",
        width: 18,
        value: (row) => asString(row.number),
      },
      {
        key: "organizationName",
        title: "Організація",
        width: 32,
        value: (row) => asString(row.organizationName),
      },
      {
        key: "isPosted",
        title: "Статус",
        width: 16,
        value: (row) => row.isPosted ? "Проведено" : "Не проведено",
      },
      {
        key: "lineCount",
        title: "Рядків",
        width: 12,
        value: (row) => toFiniteNumber(row.lineCount),
      },
      {
        key: "amount",
        title: "Сума",
        width: 16,
        numFmt: "#,##0.00",
        value: (row) => decimalToExcelNumber(row.amount),
      },
      {
        key: "description",
        title: "Зміст",
        width: 40,
        value: (row) => asString(row.description),
      },
    ],
  },
  supplier_invoice: {
    fileNamePrefix: "supplier-invoice",
    sheetName: "SupplierInvoices",
    columns: [
      {
        key: "date",
        title: "Дата",
        width: 14,
        value: (row) => formatDateValue(row.date),
      },
      {
        key: "number",
        title: "Номер",
        width: 18,
        value: (row) => asString(row.number),
      },
      {
        key: "counterpartyName",
        title: "Контрагент",
        width: 32,
        value: (row) => asString(row.counterpartyName),
      },
      {
        key: "operationType",
        title: "Операція",
        width: 24,
        value: (row) => formatSupplierInvoiceOperationType(row.operationType),
      },
      {
        key: "isPosted",
        title: "Статус",
        width: 16,
        value: (row) => row.isPosted ? "Проведено" : "Не проведено",
      },
      {
        key: "goodsCount",
        title: "Товарів",
        width: 12,
        value: (row) => toFiniteNumber(row.goodsCount),
      },
      {
        key: "serviceCount",
        title: "Послуг",
        width: 12,
        value: (row) => toFiniteNumber(row.serviceCount),
      },
      {
        key: "amount",
        title: "Сума",
        width: 16,
        numFmt: "#,##0.00",
        value: (row) => decimalToExcelNumber(row.amount),
      },
      {
        key: "description",
        title: "Коментар",
        width: 40,
        value: (row) => asString(row.description),
      },
    ],
  },
  user: {
    fileNamePrefix: "users",
    sheetName: "Users",
    columns: [
      {
        key: "login",
        title: "Логін",
        width: 24,
        value: (row) => asString(row.login),
      },
      {
        key: "fullName",
        title: "Повне ім'я",
        width: 36,
        value: (row) => asString(row.fullName),
      },
      {
        key: "groupCount",
        title: "Груп",
        width: 12,
        value: (row) => toFiniteNumber(row.groupCount),
      },
      {
        key: "isActive",
        title: "Активний",
        width: 14,
        value: (row) => row.isActive ? "Так" : "Ні",
      },
    ],
  },
};

function asString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function decimalToExcelNumber(value: unknown) {
  const parsed = Number(asString(value));
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return asString(value);
}

function formatDateValue(value: unknown) {
  const source = asString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return source;
  }

  const [year, month, day] = source.split("-");
  return `${day}.${month}.${year}`;
}

function formatSupplierInvoiceOperationType(value: unknown) {
  switch (asString(value)) {
    case "purchase_commission":
      return "Купівля, комісія";
    case "construction_objects":
      return "Об'єкти будівництва";
    default:
      return asString(value);
  }
}

function sanitizeSheetName(value: string) {
  const normalized = value.trim().replace(/[\\/*?:\[\]]/g, " ");
  return normalized.slice(0, 31) || "Export";
}

function sanitizeFileName(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "export";
}

function buildEnvelope(extra: Record<string, unknown>, messages: string[] = []) {
  return {
    ok: true,
    data: {
      item: null,
      rows: [],
      options: {},
      totals: {},
      extra,
    },
    messages,
    meta: {},
  };
}

function asRowRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function resolveTotalCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 0;
}

async function executeListCommand(
  context: ModelCommandContext,
  schema: string,
  payload: Record<string, unknown>,
) {
  const functionName = `${context.model}_list`;
  const rows = await context.db.sql<{ result: ModelIndexEnvelope }[]>`
    select ${context.db.sql(schema)}.${context.db.sql(functionName)}(
      ${context.userId}::bigint,
      ${context.db.sql.json(payload)}::jsonb
    ) as result
  `;

  return rows[0]?.result ?? {};
}

export async function exportExcelHandler(payload: Record<string, unknown>, context: ModelCommandContext) {
  const config = exportConfigs[context.model];
  if (!config) {
    throw new Error(`Excel export не налаштований для моделі ${context.model}`);
  }

  const baseQuery = { ...payload };
  const schema = config.schema ?? "app";
  const previewResult = await executeListCommand(context, schema, {
    ...baseQuery,
    page: 1,
    pageSize: 1,
  });

  if (previewResult.ok === false) {
    return previewResult;
  }

  const totalCount = resolveTotalCount(previewResult.data?.totals?.count);
  const maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;
  const exportRowCount = Math.min(Math.max(totalCount, 1), maxRows);
  const result = totalCount <= 1
    ? previewResult
    : await executeListCommand(context, schema, {
      ...baseQuery,
      page: 1,
      pageSize: exportRowCount,
    });

  if (result.ok === false) {
    return result;
  }

  const sourceRows = asRowRecords(result.data?.rows);
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(sanitizeSheetName(config.sheetName));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.columns = config.columns.map((column) => ({
    header: column.title,
    key: column.key,
    width: column.width,
    style: column.numFmt ? { numFmt: column.numFmt } : undefined,
  }));

  for (const row of sourceRows) {
    const nextRow = Object.fromEntries(config.columns.map((column) => [column.key, column.value(row)]));
    worksheet.addRow(nextRow);
  }

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: config.columns.length },
  };

  const workbookBuffer = await workbook.xlsx.writeBuffer();
  const bytes = workbookBuffer instanceof Uint8Array ? workbookBuffer : new Uint8Array(workbookBuffer);
  const exportedAt = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(config.fileNamePrefix)}-${exportedAt}.xlsx`;
  const truncated = totalCount > maxRows;
  const messages = truncated ? [`Експорт обмежено ${maxRows} рядками`] : [];

  return buildEnvelope({
    fileName,
    mimeType: XLSX_MIME_TYPE,
    contentBase64: encodeBase64(bytes),
    rowCount: sourceRows.length,
    totalCount,
    truncated,
  }, messages);
}