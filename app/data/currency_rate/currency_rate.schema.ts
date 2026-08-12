import { type Static, Type } from "@sinclair/typebox";
import { SortDirSchema } from "@client/shared/schema.ts";

// Курс валюти — перший ПЕРІОДИЧНИЙ регістр: ключ (валюта), дата, значення.
// Блок `periodic` у манифесті дає до звичайного CRUD ще `at` (зріз на дату),
// `history` і `set` — писати їх руками не треба.

// ── 1. Item — форма редагування та payload для save ───────────────────────────

export const CurrencyRateItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint", default: null }),
  currencyId: Type.String({
    title: "Валюта",
    "x-db-type": "bigint",
    "x-ref": { model: "currency", display: "name", as: "currency", sortable: true, searchable: true },
    "x-form": { order: 1, width: "sm" },
    "x-list": { width: "sm", sortable: true },
  }),
  period: Type.String({
    title: "Діє з",
    "x-db-type": "date",
    "x-form": { order: 2, width: "sm" },
    "x-list": { width: "sm", sortable: true },
  }),
  rate: Type.Number({
    title: "Курс",
    "x-db-type": "numeric",
    "x-form": { order: 3, width: "sm" },
    "x-list": { width: "sm" },
  }),
  // Кратність: курс задають за 100 одиниць там, де валюта дрібна. Без неї
  // довелося б тримати курс із зайвими знаками й округлювати на кожному вжитку.
  multiplicity: Type.Number({
    title: "Кратність",
    default: 1,
    "x-db-type": "int",
    "x-form": { order: 4, width: "sm" },
    "x-list": { width: "sm" },
  }),
});
export type CurrencyRateItem = Static<typeof CurrencyRateItemSchema>;

// ── 2. Row — рядок списку ─────────────────────────────────────────────────────

export const CurrencyRateRowSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
  currency: Type.Object({ id: Type.String(), name: Type.String() }),
  period: Type.String(),
  rate: Type.Number(),
  multiplicity: Type.Number(),
});
export type CurrencyRateRow = Static<typeof CurrencyRateRowSchema>;

// LookupRowSchema немає навмисно: на регістр ніхто не посилається, тож і
// підбирати його в пікері нема кому — генератор `lookup` йому не робить.

// ── 3. Payloads ───────────────────────────────────────────────────────────────

export const CurrencyRateListPayloadSchema = Type.Object({
  search: Type.Optional(Type.String()),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy: Type.Optional(Type.Union([
    Type.Literal("period"),
    Type.Literal("currency"),
  ])),
  sortDir: Type.Optional(SortDirSchema),
});
export type CurrencyRateListPayload = Static<typeof CurrencyRateListPayloadSchema>;

/** `at` — зріз останнього на дату; без `currencyId` віддає всі валюти. */
export const CurrencyRateAtPayloadSchema = Type.Object({
  onDate: Type.Optional(Type.String()),
  currencyId: Type.Optional(Type.String({ "x-db-type": "bigint" })),
});
export type CurrencyRateAtPayload = Static<typeof CurrencyRateAtPayloadSchema>;

// ── 4. $root екранів ──────────────────────────────────────────────────────────

export const CurrencyRateEditRootSchema = Type.Object({
  item: CurrencyRateItemSchema,
  options: Type.Object({}),
});
export type CurrencyRateEditRoot = Static<typeof CurrencyRateEditRootSchema>;
