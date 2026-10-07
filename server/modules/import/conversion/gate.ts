/**
 * Шлюз перевірки правил — те, що можна сказати про правило без бази.
 *
 *   1. ціль існує й поля правила в ній є (імена ловить ще компілятор — `fields`
 *      типізовано схемою цілі; тут те саме для правила, зібраного не з TS);
 *   2. кожне обов'язкове поле цілі без умовчання отримує значення;
 *   — і на сухому прогоні: payload проходить `Value.Check` схемою цілі.
 *
 * Перевірки 3–6 плану (перелічення, ключ, покриття, розв'язність посилань)
 * тримаються за дані й метадані джерела — їх рахує команда `dryRun`, а не цей
 * модуль. `transform` статично не перевіряється: його payload видно лише
 * прогоном, і саме так він і позначається у звіті.
 */
import type { TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { isLookupMarker, isRefMarker, isSeedMarker, type Rule, type Table } from "./rule.ts";

export interface GateIssue {
  check: number;
  message: string;
}

/**
 * Заглушка на місці маркера: схема цілі чекає там id (рядок) або `{ id, name }`
 * субконто. Значення не має сенсу — лише форму.
 */
const STUB_ID = "0";

function hasDefault(schema: TSchema): boolean {
  return (schema as { default?: unknown }).default !== undefined;
}

export function staticCheck(rule: Rule): GateIssue[] {
  const issues: GateIssue[] = [];
  const schema = rule.target.schema;
  if (!schema?.properties) {
    return [{ check: 1, message: `@[core.conversion.gateNoSchema]${JSON.stringify({ model: rule.target.model })}` }];
  }
  if (rule.transform) return issues;

  const properties = schema.properties as Record<string, TSchema>;
  for (const field of Object.keys(rule.fields)) {
    if (!(field in properties)) {
      issues.push({ check: 1, message: `@[core.conversion.gateUnknownField]${JSON.stringify({ field, model: rule.target.model })}` });
    }
  }
  for (const [field, table] of Object.entries(rule.tables ?? {}) as [string, Table][]) {
    const array = properties[field] as TSchema & { items?: TSchema & { properties?: Record<string, TSchema>; required?: string[] } };
    if (array?.type !== "array" || !array.items?.properties) {
      issues.push({ check: 1, message: `@[core.conversion.gateNotTable]${JSON.stringify({ field, model: rule.target.model })}` });
      continue;
    }
    const lineProps = array.items.properties;
    for (const lineField of Object.keys(table.fields)) {
      if (!(lineField in lineProps)) {
        issues.push({
          check: 1,
          message: `@[core.conversion.gateUnknownField]${JSON.stringify({ field: `${field}.${lineField}`, model: rule.target.model })}`,
        });
      }
    }
    for (const lineField of array.items.required ?? []) {
      if (lineField in table.fields || hasDefault(lineProps[lineField])) continue;
      issues.push({ check: 2, message: `@[core.conversion.gateRequiredField]${JSON.stringify({ field: `${field}.${lineField}` })}` });
    }
  }
  for (const field of Object.keys(rule.requires ?? {})) {
    if (!(field in rule.fields)) {
      issues.push({ check: 1, message: `@[core.conversion.gateRequiresUnknown]${JSON.stringify({ field })}` });
    }
  }
  for (const field of schema.required ?? []) {
    if (field in rule.fields || field in (rule.tables ?? {})) continue;
    if (hasDefault(properties[field])) continue;
    issues.push({ check: 2, message: `@[core.conversion.gateRequiredField]${JSON.stringify({ field })}` });
  }
  return issues;
}

/** Копія payload-а з заглушками замість маркерів — для `Value.Check`. */
export function stubRefs(value: unknown): unknown {
  if (isRefMarker(value) || isSeedMarker(value) || isLookupMarker(value)) return STUB_ID;
  if (Array.isArray(value)) return value.map(stubRefs);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Субконто в аналітиці: `{ dim: marker }` → `{ dim: { id, name } }`.
      result[key] = isRefMarker(item) && key !== "id" && isAnalyticsSlot(value)
        ? { id: STUB_ID, name: item.$ref.presentation }
        : stubRefs(item);
    }
    return result;
  }
  return value;
}

/**
 * Об'єкт, у якого ВСІ значення — маркери, це набір субконто (`analytics`), а не
 * запис із полем-посиланням: там маркер стоїть на місці `{ id, name }`.
 */
function isAnalyticsSlot(value: object): boolean {
  const items = Object.values(value);
  return items.length > 0 && items.every(isRefMarker);
}

/** Шлях → повідомлення: перші помилки схеми на один об'єкт. */
export function schemaErrors(schema: TObject, payload: Record<string, unknown>, limit = 5): string[] {
  const stubbed = stubRefs(payload);
  if (Value.Check(schema, stubbed)) return [];
  const messages: string[] = [];
  for (const error of Value.Errors(schema, stubbed)) {
    messages.push(`${error.path || "/"}: ${error.message}`);
    if (messages.length >= limit) break;
  }
  return messages;
}

/** Усі маркери payload-а — для перевірки 6 (чи має вид посилання своє правило). */
export function collectRefs(value: unknown, into: Map<string, number> = new Map()): Map<string, number> {
  if (isRefMarker(value)) {
    into.set(value.$ref.type, (into.get(value.$ref.type) ?? 0) + 1);
  } else if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectRefs(item, into);
  }
  return into;
}
