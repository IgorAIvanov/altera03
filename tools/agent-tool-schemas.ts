/**
 * Опис інструментів агента — JSON Schema payload-ів, зібрана з TypeBox-схем
 * моделей.
 *
 * ЧОМУ ЦЕ ПОТРІБНО. Готовий зовнішній агент добре працює зі схемою й погано —
 * з умовляннями в описі. Доти інструмент виглядав так:
 *
 * ```ts
 * item: { type: "object", description: "Поля головного запису…" }
 * ```
 *
 * Складу реквізитів немає, типів немає, обов'язковості немає, куди дивиться
 * посилання — немає. Агент мусив угадувати або довідуватися методом спроб.
 *
 * ЧОМУ ЦЕ ДЕШЕВО. TypeBox і Є JSON Schema: серіалізація віддає готовий опис
 * разом із `title`, довжинами й обмеженнями. Писати тут нічого не треба —
 * треба лише донести його до сервера, куди схеми моделей ніколи не доїжджали.
 *
 * ЩО ВІДКИДАЄТЬСЯ. Анотації, які описують ЕКРАН (`x-form`, `x-list`,
 * `x-lookup`, `x-search`, `x-db-type`), у контекст агента не йдуть: вони
 * коштують місця й нічого йому не кажуть. Лишаються ті, що описують ДАНІ —
 * `x-ref` (куди веде посилання), `x-blob`, `x-transient`.
 */
import { toFileUrl } from "@std/path";

/** Анотації, корисні лише екрану. */
const UI_ONLY_ANNOTATIONS = new Set([
  "x-form",
  "x-list",
  "x-lookup",
  "x-search",
  "x-db-type",
  "x-filter",
]);

/** Опис одного інструмента: модель, команда і схема payload-а. */
export interface AgentToolDescriptor {
  model: string;
  command: string;
  /** JSON Schema того, що приймає команда. */
  input: Record<string, unknown>;
}

/** Стандартний запит списку — коли модель не оголосила свого. */
function listPayloadFallback(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      search: { type: "string", description: "Пошук по рядкових полях" },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 200 },
      sortBy: { type: "string" },
      sortDir: { type: "string", enum: ["asc", "desc"] },
      filters: { type: "object", description: "Оголошені відбори моделі" },
    },
  };
}

function idPayloadFallback(): Record<string, unknown> {
  return {
    type: "object",
    properties: { id: { type: "string", description: "ID запису" } },
    required: ["id"],
  };
}

/**
 * Рекурсивно прибирає екранні анотації. Копія, а не правка на місці: схема
 * належить модулю моделі, і зіпсувати її означало б зіпсувати форму.
 */
function stripUiAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUiAnnotations);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (UI_ONLY_ANNOTATIONS.has(key)) continue;
    result[key] = stripUiAnnotations(entry);
  }
  return result;
}

/** Дві об'єктні схеми в одну: шапка документа плюс власні реквізити. */
function mergeObjectSchemas(
  header: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  const headerProps = (header.properties ?? {}) as Record<string, unknown>;
  const ownProps = (own.properties ?? {}) as Record<string, unknown>;
  const headerRequired = Array.isArray(header.required) ? header.required as string[] : [];
  const ownRequired = Array.isArray(own.required) ? own.required as string[] : [];

  return {
    type: "object",
    properties: { ...headerProps, ...ownProps },
    required: [...new Set([...headerRequired, ...ownRequired])],
  };
}

function pascalCase(model: string): string {
  return model.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

/**
 * Схема payload-а команди.
 *
 * Порядок джерел: оголошена схема моделі → складена з `ItemSchema` (для
 * `save`) → типове умовчання команди. Середня ланка не запасна, а найкорисніша:
 * `save` без оголошеного payload-а трапляється часто, а саме він і несе поля,
 * заради яких усе робиться.
 */
function payloadSchemaFor(
  model: string,
  command: string,
  exports: Record<string, unknown>,
  documentHeader: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const pascal = pascalCase(model);
  const declared = exports[`${pascal}${pascalCase(command)}PayloadSchema`];
  if (declared && typeof declared === "object") {
    return stripUiAnnotations(declared) as Record<string, unknown>;
  }

  if (command === "save") {
    const item = exports[`${pascal}ItemSchema`];
    if (!item || typeof item !== "object") return null;

    // У документа `ItemSchema` несе ЛИШЕ власні реквізити: спільна шапка (дата,
    // організація, номер, сума, проведення) живе в `app.document`, і генератор
    // SQL підмішує її з `DocumentHeaderSchema`. Без такої ж домішки агент не
    // побачив би ані дати, ані організації — тобто не зміг би створити документ.
    const merged = documentHeader
      ? mergeObjectSchemas(documentHeader, item as Record<string, unknown>)
      : item;

    const properties: Record<string, unknown> = {
      item: stripUiAnnotations(merged),
    };

    // Табличні рядки документа. Ім'я за конвенцією; немає — немає й ключа,
    // вигадувати порожній масив гірше, ніж мовчати.
    const line = exports[`${pascal}LineSchema`];
    if (line && typeof line === "object") {
      properties.rows = { type: "array", items: stripUiAnnotations(line) };
    }

    return { type: "object", properties, required: ["item"] };
  }

  if (command === "list") return listPayloadFallback();
  if (command === "lookup") {
    return {
      type: "object",
      properties: {
        search: { type: "string" },
        pageSize: { type: "integer", minimum: 1, maximum: 200 },
        filters: { type: "object" },
      },
    };
  }
  if (command === "get" || command === "delete" || command === "undelete") return idPayloadFallback();
  if (command === "post" || command === "unpost") return idPayloadFallback();

  return null;
}

/**
 * Інструменти однієї моделі.
 *
 * `schemaPath` може не існувати — модель із рукописним SQL або admin-екран без
 * TypeBox. Тоді описів немає, і це не помилка: агент просто не побачить цієї
 * моделі, що чесніше за опис навмання.
 */
export async function buildAgentToolsForModel(
  model: string,
  schemaPath: string,
  commands: string[],
  documentHeader: Record<string, unknown> | null = null,
): Promise<AgentToolDescriptor[]> {
  let exports: Record<string, unknown>;
  try {
    exports = await import(toFileUrl(schemaPath).href) as Record<string, unknown>;
  } catch {
    return [];
  }

  const tools: AgentToolDescriptor[] = [];
  for (const command of commands) {
    const input = payloadSchemaFor(model, command, exports, documentHeader);
    if (input) tools.push({ model, command, input });
  }
  return tools;
}

/** Модуль `agent-tools.generated.ts` — чисті дані, без жодного імпорту. */
export function renderAgentTools(tools: AgentToolDescriptor[]): string {
  const entries = tools.map((tool) =>
    `  ${JSON.stringify(`${tool.model}.${tool.command}`)}: ${JSON.stringify(tool.input)}`
  );
  return `export const agentToolSchemas: Record<string, unknown> = {\n${entries.join(",\n")}\n};\n`;
}
