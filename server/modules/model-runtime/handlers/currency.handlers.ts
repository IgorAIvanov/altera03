import type { ModelCommandContext } from "../model-runtime.types.ts";

interface CurrencyClassifierItem {
  code: string;
  symbolCode: string;
  fullName: string;
  financeLoading: boolean;
  multiplicity: number;
  spellingParamsRu: string | null;
  spellingParamsUk: string | null;
}

interface NbuRateItem {
  r030?: number;
  rate?: number;
  cc?: string;
  exchangedate?: string;
}

async function readClassifierItems(db: ModelCommandContext["db"]) {
  const rows = await db.sql<{
    code: string;
    symbolCode: string;
    fullName: string;
    financeLoading: boolean;
    multiplicity: string;
    spellingParamsRu: string | null;
    spellingParamsUk: string | null;
  }[]>`
    select
      code,
      symbol_code as "symbolCode",
      full_name as "fullName",
      finance_loading as "financeLoading",
      multiplicity::text as multiplicity,
      spelling_params_ru as "spellingParamsRu",
      spelling_params_uk as "spellingParamsUk"
    from app.currency_classifier
    order by code
  `;

  if (rows.length === 0) {
    throw new Error("Currency classifier is empty. Publish SQL package first.");
  }

  return rows.map((row) => ({
    ...row,
    multiplicity: Number(row.multiplicity),
  })) as CurrencyClassifierItem[];
} 

function asString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function toNbuDate(onDate: string) {
  return onDate.replaceAll("-", "");
}

function normalizeExchangeDate(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    return fallback;
  }

  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function buildEnvelope(extra: Record<string, unknown>, messages: string[] = []) {
  return {
    ok: true,
    data: {
      item: null,
      rows: [],
      lookups: {},
      totals: {},
      extra,
    },
    messages,
    meta: {},
  };
}

function toPositiveInt(value: unknown, fallback: number, max: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(1, Math.trunc(value)));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(1, parsed));
    }
  }

  return fallback;
}

export async function currencyClassifierFetchHandler(payload: Record<string, unknown>, context: ModelCommandContext) {
  const search = asString(payload.search);
  const page = toPositiveInt(payload.page, 1, 10_000);
  const pageSize = toPositiveInt(payload.pageSize, 20, 100);
  const offset = (page - 1) * pageSize;
  const searchPattern = `%${search}%`;

  const counted = await context.db.sql<{ total: string }[]>`
    select count(*)::text as total
    from app.currency_classifier classifier
    where (
      ${search} = ''
      or classifier.code ilike ${searchPattern}
      or classifier.symbol_code ilike ${searchPattern}
      or classifier.full_name ilike ${searchPattern}
    )
  `;

  const rows = await context.db.sql<{
    value: string;
    label: string;
    code: string;
    symbolCode: string;
    fullName: string;
    financeLoading: boolean;
    spellingParamsRu: string | null;
    spellingParamsUk: string | null;
  }[]>`
    select
      classifier.code as value,
      classifier.symbol_code || ' · ' || classifier.full_name as label,
      classifier.code,
      classifier.symbol_code as "symbolCode",
      classifier.full_name as "fullName",
      classifier.finance_loading as "financeLoading",
      classifier.spelling_params_ru as "spellingParamsRu",
      classifier.spelling_params_uk as "spellingParamsUk"
    from app.currency_classifier classifier
    where (
      ${search} = ''
      or classifier.code ilike ${searchPattern}
      or classifier.symbol_code ilike ${searchPattern}
      or classifier.full_name ilike ${searchPattern}
    )
    order by classifier.symbol_code asc, classifier.code asc
    limit ${pageSize}
    offset ${offset}
  `;

  return {
    ok: true,
    data: {
      item: null,
      rows,
      lookups: {},
      totals: {
        count: Number(counted[0]?.total ?? "0"),
        page,
        pageSize,
      },
      extra: {},
    },
    messages: [],
    meta: {},
  };
}

export async function currencySeedPredefinedHandler(_payload: Record<string, unknown>, context: ModelCommandContext) {
  const classifierItems = await readClassifierItems(context.db);

  const result = await context.db.transaction(async (sql) => {
    let created = 0;
    let updated = 0;

    for (const item of classifierItems) {
      const existing = await sql<{
        id: string;
        rate_mode: string | null;
      }[]>`
        select id::text as id, rate_mode
        from app.currency
        where code = ${item.code}
        limit 1
      `;

      const targetRateMode = item.financeLoading ? "internet" : "manual";
      const targetLoadFromInternet = item.financeLoading;
      const targetRateSourceMethod = item.financeLoading ? "nbu" : null;

      if (!existing[0]?.id) {
        await sql`
          insert into app.currency (
            code,
            name,
            full_name,
            rate_mode,
            load_from_internet,
            rate_source_method,
            spelling_params_ru,
            spelling_params_uk,
            is_active
          )
          values (
            ${item.code},
            ${item.symbolCode},
            ${item.fullName},
            ${targetRateMode},
            ${targetLoadFromInternet},
            ${targetRateSourceMethod}::text,
            ${item.spellingParamsRu}::text,
            ${item.spellingParamsUk}::text,
            true
          )
        `;
        created += 1;
        continue;
      }

      await sql`
        update app.currency
        set
          name = case when coalesce(nullif(trim(name), ''), '') = '' then ${item.symbolCode} else name end,
          full_name = case when coalesce(nullif(trim(full_name), ''), '') = '' then ${item.fullName} else full_name end,
          spelling_params_ru = coalesce(spelling_params_ru, ${item.spellingParamsRu}::text),
          spelling_params_uk = coalesce(spelling_params_uk, ${item.spellingParamsUk}::text),
          rate_mode = case
            when rate_mode in ('manual', 'internet') or rate_mode is null then ${targetRateMode}
            else rate_mode
          end,
          load_from_internet = case
            when rate_mode in ('manual', 'internet') or rate_mode is null then ${targetLoadFromInternet}
            else load_from_internet
          end,
          rate_source_method = case
            when (${targetRateSourceMethod}::text is not null) and (rate_mode in ('manual', 'internet') or rate_mode is null) then coalesce(rate_source_method, ${targetRateSourceMethod}::text)
            else rate_source_method
          end,
          updated_at = now()
        where code = ${item.code}
      `;
      updated += 1;
    }

    return { created, updated };
  });

  return buildEnvelope({
    created: result.created,
    updated: result.updated,
    totalClassifier: classifierItems.length,
  }, ["Currencies synchronized from BAS classifier"]);
}

export async function currencyLoadRatesHandler(payload: Record<string, unknown>, context: ModelCommandContext) {
  const requestedDate = asString(payload.onDate) || new Date().toISOString().slice(0, 10);
  const classifierItems = await readClassifierItems(context.db);
  const classifierByCode = new Map(classifierItems.map((item) => [item.code, item]));
  const response = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${toNbuDate(requestedDate)}&json`);
  if (!response.ok) {
    throw new Error(`НБУ повернув статус ${response.status}`);
  }

  const sourceRates = await response.json() as NbuRateItem[];
  const byCode = new Map<string, NbuRateItem>();
  for (const item of sourceRates) {
    const key = typeof item.r030 === "number"
      ? item.r030.toString().padStart(3, "0")
      : asString(item.cc);
    if (key) {
      byCode.set(key, item);
    }
  }

  const summary = await context.db.transaction(async (sql) => {
    const currencies = await sql<{
      id: string;
      code: string;
      rate_source_method: string | null;
    }[]>`
      select id::text as id, code, rate_source_method
      from app.currency
      where is_active = true
        and coalesce(rate_mode, case when load_from_internet then 'internet' else 'manual' end) = 'internet'
    `;

    let loadedRates = 0;
    let missingRates = 0;
    let skippedCurrencies = 0;
    let effectiveRateDate: string | null = null;

    for (const currency of currencies) {
      const sourceMethod = (currency.rate_source_method ?? "nbu").trim().toLowerCase();
      if (sourceMethod !== "nbu") {
        skippedCurrencies += 1;
        continue;
      }

      const sourceRate = byCode.get(currency.code);
      if (!sourceRate || typeof sourceRate.rate !== "number") {
        missingRates += 1;
        continue;
      }

      const classifierItem = classifierByCode.get(currency.code);
      const multiplicity = Number.isFinite(classifierItem?.multiplicity)
        ? Number(classifierItem?.multiplicity)
        : 1;

      const rateDate = normalizeExchangeDate(sourceRate.exchangedate, requestedDate);
      effectiveRateDate = effectiveRateDate ?? rateDate;

      await sql`
        insert into app.currency_rate (
          currency_id,
          rate_date,
          rate,
          multiplicity
        )
        values (
          ${currency.id}::bigint,
          ${rateDate}::date,
          ${sourceRate.rate.toString()}::numeric,
          ${multiplicity.toString()}::numeric
        )
        on conflict (currency_id, rate_date)
        do update
        set
          rate = excluded.rate,
          multiplicity = excluded.multiplicity,
          updated_at = now()
      `;
      loadedRates += 1;
    }

    return {
      selectedCurrencies: currencies.length,
      loadedRates,
      missingRates,
      skippedCurrencies,
      effectiveRateDate,
    };
  });

  return buildEnvelope({
    provider: "nbu",
    requestedDate,
    effectiveRateDate: summary.effectiveRateDate,
    selectedCurrencies: summary.selectedCurrencies,
    loadedRates: summary.loadedRates,
    missingRates: summary.missingRates,
    skippedCurrencies: summary.skippedCurrencies,
  }, ["Currency rates loaded from NBU"]);
}