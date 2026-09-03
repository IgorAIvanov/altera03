// Сухий прогін проведення: «що вийде, якщо провести» — не проводячи.
//
// Навіщо. Проводки документа видно ЛИШЕ постфактум — звітом уже проведеного.
// Сказати наперед не можна було нічим, і це б'є двічі. По-перше, агент, якого
// питають «якими документами оформити ось це», відповідає з міркування, а не
// з поведінки: правила (`agentRules`) кажуть, чого не можна, і мовчать про те,
// що вийде. По-друге, розбір «чому 281, а не 201» доводилося робити на живих
// даних — тобто проводити документ, дивитися й розпроводити.
//
// Головна властивість тут не в зручності: **прогін не може розійтися з
// поведінкою, бо він і є поведінка**. Ми не моделюємо проведення — ми кличемо
// ту саму `<model>_post`, збираємо те, що вона написала, і відкочуємо
// транзакцію. Опис, зроблений будь-яким іншим способом, застаріває мовчки;
// цей — ні.
//
// Чому окрема команда, а не прапорець `dryRun` у `post`. Прапорець видно лише
// тому, хто прочитав схему й здогадався його шукати, а вся ця робота — про
// протилежне: агент не знає того, про існування чого не здогадується. Команда
// стоїть у каталозі поруч із `post` і називає себе сама.
import { getModelConfig } from "../model-runtime/model-registry.ts";
import type { ModelCommandContext } from "../model-runtime/model-runtime.types.ts";
import { err, type Envelope } from "../../common/response.ts";

/** Проводка, як її побачить той, хто питав «що буде». */
export interface PostPreviewEntry {
  lineNo: number;
  debitAccount: string | null;
  creditAccount: string | null;
  amount: string;
  description: string | null;
  /** Субконто боку: `{ warehouse: "Основний склад" }`. Порожньо — рахунок вимірів не веде. */
  debitDims: Record<string, string>;
  creditDims: Record<string, string>;
}

/**
 * Сигнал відкоту.
 *
 * Транзакція `postgres.js` фіксується, якщо колбек завершився нормально, і
 * відкочується, якщо він кинув. Тобто відкіт тут — не аварія, а єдиний спосіб
 * сказати «ми закінчили»: результат їде в самому винятку.
 */
class PreviewRollback extends Error {
  constructor(readonly result: unknown) {
    super("post-preview rollback");
  }
}

interface AnalyticRow {
  journal_entry_id: string;
  side: string;
  dimension_code: string;
  value_presentation: string;
}

interface EntryRow {
  id: string;
  line_no: number;
  debit_account: string | null;
  credit_account: string | null;
  amount: string;
  description: string | null;
}

/** Конверт, який повернула `<model>_post`. Відмову віддаємо як є — вона і є відповідь. */
function envelopeOf(value: unknown): { ok: boolean; messages: unknown[] } {
  const envelope = value as { ok?: unknown; messages?: unknown } | null;
  return {
    ok: envelope?.ok === true,
    messages: Array.isArray(envelope?.messages) ? envelope.messages : [],
  };
}

/**
 * `runtime.postPreview` — провести в транзакції, показати проводки, відкотити.
 *
 * Три межі, які видно не одразу:
 *
 * 1. **Відкочується ВСЕ, а не тільки проводки.** Номер із нумератора,
 *    денормалізація шапки, рухи інших регістрів — усе, що зробила `_post`,
 *    зникає разом із транзакцією. Це не старання коду, а властивість:
 *    `commit` усередині plpgsql-функції, викликаної в транзакції, неможливий.
 * 2. **Гак застосунку `doc_before_write` спрацює.** Закритий період відіб'є
 *    прогін так само, як відбив би проведення, — і це плюс: прогін показує не
 *    лише проводки, а й відмову.
 * 3. **Проведений документ прогону не отримує.** Прогін по ньому означав би
 *    «розпровести, провести, відкотити» — тобто на секунду лишити базу без
 *    його проводок заради довідки. Дивитися там треба справжні рухи.
 */
export async function postPreviewHandler(
  payload: Record<string, unknown>,
  context: ModelCommandContext,
): Promise<unknown> {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("id обов'язковий для postPreview");

  const config = getModelConfig(context.model);
  if ((config?.type ?? "") !== "document") {
    return err(`Сухий прогін проведення буває лише в документа, а «${context.model}» — не документ`);
  }

  const schema = config?.schema ?? "app";
  const functionName = `${context.model}_post`;
  const sqlPayload = context.db.sql.json({ id });

  try {
    await context.db.transaction(async (sql) => {
      const [header] = await sql<{ is_posted: boolean }[]>`
        select is_posted from app.document where id = ${id}::bigint
      `;
      if (!header) throw new PreviewRollback(err(`Документ ${id} не знайдено`));
      if (header.is_posted) {
        throw new PreviewRollback(
          err(`Документ ${id} уже проведений — дивіться його справжні рухи, а не прогін`),
        );
      }

      const [posted] = await sql<{ result: unknown }[]>`
        select ${sql(schema)}.${sql(functionName)}(${context.userId}::bigint, ${sqlPayload}::jsonb) as result
      `;

      const envelope = envelopeOf(posted?.result);
      if (!envelope.ok) {
        // Відмова — це й є відповідь на питання «що вийде»; віддаємо конверт
        // як є, разом із його маркерами: агентський канал їх розгорне.
        throw new PreviewRollback(posted?.result);
      }

      const entries = await sql<EntryRow[]>`
        select id, line_no, debit_account, credit_account, amount, description
        from app.journal_entry
        where document_id = ${id}::bigint
        order by line_no
      `;

      const analytics = entries.length === 0 ? [] : await sql<AnalyticRow[]>`
        select journal_entry_id, side, dimension_code, value_presentation
        from app.journal_entry_analytic
        where journal_entry_id in ${sql(entries.map((entry) => entry.id))}
        order by journal_entry_id, side, slot_no
      `;

      throw new PreviewRollback(preview(entries, analytics, envelope.messages));
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result;
    throw error;
  }

  // Транзакція, що дійшла сюди, зафіксувалася б — тобто прогін записав би те,
  // що обіцяв лише показати. Такого шляху немає: обидві гілки вище кидають.
  throw new Error("postPreview: транзакція завершилася без відкоту");
}

/** Проводки й підсумок — те, заради чого прогін і робиться. */
function preview(
  entries: EntryRow[],
  analytics: AnalyticRow[],
  messages: unknown[],
): Envelope<{ willPost: boolean; lines: number }, PostPreviewEntry> {
  const dims = new Map<string, Record<string, string>>();
  for (const row of analytics) {
    const key = `${row.journal_entry_id}:${row.side}`;
    const bucket = dims.get(key) ?? {};
    bucket[row.dimension_code] = row.value_presentation;
    dims.set(key, bucket);
  }

  const list: PostPreviewEntry[] = entries.map((entry) => ({
    lineNo: entry.line_no,
    debitAccount: entry.debit_account,
    creditAccount: entry.credit_account,
    amount: entry.amount,
    description: entry.description,
    debitDims: dims.get(`${entry.id}:debit`) ?? {},
    creditDims: dims.get(`${entry.id}:credit`) ?? {},
  }));

  const total = list.reduce((sum, entry) => sum + Number(entry.amount), 0);

  return {
    ok: true,
    data: {
      item: { willPost: true, lines: list.length },
      rows: list,
      options: {},
      totals: { amount: total },
    },
    // Повідомлення самого проведення (попередження, які воно робить) —
    // частина відповіді: у прогоні їх видно наперед. Приписка про те, що нічого
    // не записано, лишається останньою, щоб її не загубили серед них.
    messages: [
      ...(messages as Envelope["messages"]),
      { type: "info", text: "Сухий прогін: нічого не записано, транзакцію відкочено" },
    ],
  };
}
