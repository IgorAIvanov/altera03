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

/** Команди, які рантайм пропускає лише з `"confirm": true` (див. §4.3 плану). */
const CONFIRM_REQUIRED_COMMANDS = new Set(["delete", "undelete", "post", "unpost"]);

/**
 * Дописує обов'язкове підтвердження — ПОВЕРХ будь-якої схеми.
 *
 * Саме поверх, а не замість: `confirm` це правило РАНТАЙМУ, а не вибір моделі,
 * тож оголошений моделлю `DeletePayloadSchema` про нього не знає й знати не
 * повинен. Складати їх у порядку «оголошене виграє» означало б, що вимога
 * зникає рівно в тих моделей, які найретельніше описали свій payload.
 *
 * Вимога стоїть У СХЕМІ, а не лише в перевірці на сервері: інакше агент
 * дізнавався б про неї відмовою — тобто витрачав крок і міг би вважати відмову
 * випадковою. `const: true` не лишає місця для тлумачення.
 */
function withConfirm(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...(schema.properties ?? {}) as Record<string, unknown> };
  properties.confirm = {
    type: "boolean",
    const: true,
    description: "Підтвердження зміни стану. Без нього команда відмовить.",
  };

  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  return {
    ...schema,
    type: "object",
    properties,
    required: [...new Set([...required, "confirm"])],
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
  const confirmable = CONFIRM_REQUIRED_COMMANDS.has(command);

  const declared = exports[`${pascal}${pascalCase(command)}PayloadSchema`];
  if (declared && typeof declared === "object") {
    const schema = stripUiAnnotations(declared) as Record<string, unknown>;
    return confirmable ? withConfirm(schema) : schema;
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

  // Звіт приймає рівно `filters` — розбирає їх згенерована обгортка
  // `app.<report>_index`, і схема фільтрів тут та сама, з якої вона зроблена.
  // Обов'язковим `filters` не роблю: звіт без власних відборів існує
  // (`document_movements`), і вимагати від агента порожній об'єкт — вигадана
  // перешкода. Чого бракує насправді, скаже сам звіт.
  if (command === "index") {
    const filters = exports[`${pascal}FiltersSchema`];
    return {
      type: "object",
      properties: {
        filters: filters && typeof filters === "object"
          ? stripUiAnnotations(filters)
          : { type: "object", description: "Відбори звіту" },
      },
    };
  }

  // Сухий прогін: тільки `id`. Payload належить рантайму, а не моделі, —
  // рівно як у друку.
  if (command === "postPreview") {
    return {
      type: "object",
      properties: {
        id: { type: "string", description: "ID документа, який прогоняємо" },
      },
      required: ["id"],
      additionalProperties: false,
      description:
        "Що вийде, якщо провести: проводки з субконто, без запису. Транзакцію відкочено, " +
        "у базі нічого не змінюється. Документ, який уже проведений, прогону не отримує — " +
        "у нього дивляться справжні рухи.",
    };
  }

  // Друк: `id` записи плюс необов'язковий код шаблону. Схеми в моделі немає й
  // бути не може — payload належить рантайму друку, а не моделі, і однаковий у
  // всіх. Порожній `templateCode` означає активний шаблон, і саме це потрібно
  // в дев'яти випадках із десяти.
  if (command === "printPdf") {
    return {
      type: "object",
      properties: {
        id: { type: "string", description: "ID запису, який друкуємо" },
        templateCode: {
          type: "string",
          description: "Код шаблону друку. Без нього — активний шаблон моделі",
        },
      },
      required: ["id"],
    };
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
  // `delete` тут — позначка на видалення, `undelete` — її зняття; обидві
  // ходять під правом `delete`, тож підтвердження вимагають однаково.
  if (command === "get" || confirmable) {
    const schema = idPayloadFallback();
    return confirmable ? withConfirm(schema) : schema;
  }

  // Сюди доходить лише НЕСТАНДАРТНА команда, яку модель відкрила агенту сама
  // (`agent.allowCommands`): стандартні розібрані вище, а решти в переліку не
  // буває. Своєї схеми в неї може не бути — TypeBox описує форми, а `at`,
  // `groupTree` чи `moveToGroup` форми не мають.
  //
  // Доти тут стояв `return null`, і команда мовчки зникала з переліку —
  // оголошення в манифесті не давало нічого, а сказати про це було нікому:
  // `altera_describe` віддавав `[]`, що читається як «схема порожня», а не як
  // «команди немає». Тобто найдорожче в цьому місці — не бідний опис, а два
  // мовчання поспіль.
  //
  // Опису навмання не пишемо: об'єкт довільного складу — це чесно, і в
  // описі сказано, чого бракує. Оголошена `<Model><Command>PayloadSchema`
  // перекриває це першою ж гілкою — і саме її варто написати, щойно команду
  // почнуть кликати всерйоз.
  return {
    type: "object",
    description: `Склад payload-а модель не оголосила — очікується ${pascal}${pascalCase(command)}PayloadSchema ` +
      `у ${model}.schema.ts. Поля приймаються як є.`,
  };
}

/**
 * Схема моделі Є на диску, але не завантажилася.
 *
 * Окремий тип, а не рядок: генератор мусить відрізнити цей випадок від
 * «схеми немає» — і зупинитися, а не дописати порожньо (див. нижче).
 */
export class AgentSchemaLoadError extends Error {
  constructor(
    readonly model: string,
    readonly schemaPath: string,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AgentSchemaLoadError";
  }
}

/**
 * Інструменти однієї моделі.
 *
 * `schemaPath` може не існувати — модель із рукописним SQL або admin-екран без
 * TypeBox. Тоді описів немає, і це не помилка: агент просто не побачить цієї
 * моделі, що чесніше за опис навмання.
 *
 * А от схема, яка Є, але не завантажилася, — помилка, і мовчати про неї не
 * можна. Доти тут стояв `catch { return [] }` на обидва випадки, і найдешевший
 * спосіб у нього потрапити — запустити `sql:registry` до `deno install`: жоден
 * імпорт не резолвиться, кожна модель віддає порожньо, файл виходить розміром
 * 14 КБ замість 376 КБ, і код виходу нуль. Установка при цьому працює екранами
 * й мовчки лишається з агентом БЕЗ інструментів; помітити це можна тільки
 * звіривши розмір файлу з тим, що приїхав у поставці. Тихий неповний вихідник
 * гірший за відмову: він переживає поставку й виглядає як норма.
 */
export async function buildAgentToolsForModel(
  model: string,
  schemaPath: string,
  commands: string[],
  documentHeader: Record<string, unknown> | null = null,
): Promise<AgentToolDescriptor[]> {
  // Наявність питаємо ОКРЕМО, до імпорту: `import()` на обидва випадки кидає
  // однаково, і розрізнити їх за текстом помилки — це вгадувати формулювання
  // Deno.
  try {
    await Deno.stat(schemaPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw new AgentSchemaLoadError(model, schemaPath, error);
  }

  let exports: Record<string, unknown>;
  try {
    exports = await import(toFileUrl(schemaPath).href) as Record<string, unknown>;
  } catch (error) {
    throw new AgentSchemaLoadError(model, schemaPath, error);
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
