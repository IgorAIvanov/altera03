/**
 * Виконавець довгих команд: запустити, пережити запит, розповісти, чим скінчилося.
 *
 * ЩО ТУТ ВІДБУВАЄТЬСЯ. Команда, оголошена довгою, не виконується всередині
 * HTTP-запиту. Рантайм кладе рядок у `app.job`, одразу віддає його id, а саму
 * роботу запускає збоку — без `await`. Запит на цьому закінчується; робота
 * живе далі, у процесі. Хто чекає на результат, питає `job/get`.
 *
 * ДВІ ЗАДАЧІ, ЯКІ ЛЕГКО СПЛУТАТИ. Виконання й доставка прогресу — різні речі й
 * лікуються різним. Виконання живе тут. Доставка — опитування: агент через MCP
 * і скрипт по HTTP інакше не вміють, а раз читання стану все одно потрібне,
 * екрану його ж і досить. WebSocket був би покращенням екрана, не механізму, і
 * на критичному шляху його немає.
 *
 * ЧОМУ ПРОГРЕС ПИШЕТЬСЯ ІНШИМ З'ЄДНАННЯМ. Робота йде у своїй транзакції; усе,
 * що записано всередині неї, видно лише після коміту — тобто прогрес був би
 * видно рівно тоді, коли він уже не потрібен. Тому `progress()` ходить у базу
 * через ПУЛ, а не через транзакцію команди. Це не оптимізація, а єдиний спосіб
 * зробити прогрес прогресом; та сама причина, з якої журнал помилок прогону
 * пишеться поза його транзакцією.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { getServerConfig } from "../../config/server-config.ts";
import { isMissingCorePackage } from "../../database/database-error.ts";
import { ModelCommandError } from "./model-runtime.errors.ts";

/**
 * Ідентифікатор цього екземпляра застосунку.
 *
 * Потрібен рівно для одного: відрізнити «виконавець помер» від «виконує
 * сусідній екземпляр». На одній машині застосунків буває кілька (різні бази,
 * різні порти), і прибирати при своєму старті всі чужі `running` означало б
 * рубати живу роботу сусіда.
 */
const RUNNER_ID = crypto.randomUUID();

/** Конверт відповіді команди — рівно те, що повернув би звичайний виклик. */
export interface JobEnvelope {
  ok: boolean;
  [key: string]: unknown;
}

/** Як виконати команду насправді. Передає рантайм, щоб не мати циклу залежностей. */
export type JobRunner = () => Promise<JobEnvelope>;

@Injectable()
export class JobService {
  constructor(private db: DatabaseService) {}

  private heartbeat: number | null = null;
  private running = 0;

  /**
   * Прибирання покинутих завдань при старті.
   *
   * Без нього одне падіння сервера посеред роботи робило б команду
   * недоступною НАЗАВЖДИ: рядок лишається в `running`, а унікальний індекс
   * `uq_job_active` не дає запустити її вдруге. Вилікувати це можна було б
   * тільки руками в базі, і саме так виглядає найгірший різновид поломки —
   * той, де система правильна, а працювати не можна.
   *
   * Помилка тут нічого не валить: не вдалося прибрати — сервер усе одно
   * піднімається, слід лишається в консолі. Таблиці може ще не бути (схему не
   * накотили), і це не привід не пускати людей у застосунок.
   */
  async onAppBootstrap() {
    if (!getServerConfig().jobs.background) return;

    try {
      const stale = `${Math.ceil(getServerConfig().jobs.staleMs / 1000)} seconds`;
      const rows = await this.db.sql<{ reaped: number }[]>`
        select app.job_reap(${stale}::interval) as reaped
      `;
      const reaped = rows[0]?.reaped ?? 0;
      if (reaped > 0) {
        console.log(`♻️  Покинутих завдань прибрано: ${reaped}`);
      }
    } catch (error) {
      // Пакета `@core/job` в установці немає — і це її право, а не поломка:
      // довгих команд вона не вживає. Один рядок-підказка з ліками, і більше
      // ніколи; ❌ зі стеком тут привчав би прогортати консоль старту.
      if (isMissingCorePackage(error)) {
        console.warn(
          "⚠ Довгі команди вимкнені: у базі немає app.job_reap. " +
            'Додайте "@core/job" в app/sql.json і виконайте sql:assemble && sql:publish.',
        );
        return;
      }

      // Усе інше — справжня аварія: немає зв'язку, немає права, впала сама
      // функція. Тут стек потрібен.
      console.error("❌ job: не вдалося прибрати покинуті завдання:", error);
    }
  }

  async onAppClose() {
    this.stopHeartbeat();
  }

  /** Чи можна тут виконувати довгі команди взагалі. */
  get isSupported(): boolean {
    return getServerConfig().jobs.background;
  }

  /**
   * Поставити команду в чергу й почати її виконувати.
   *
   * Повертає конверт із рядком `app.job` — той самий, що віддає `job/get`.
   * Викликач (рантайм) уже перевірив право: завдання не має бути способом
   * виконати те, чого не можна виконати прямо.
   */
  async start(
    model: string,
    command: string,
    payload: Record<string, unknown>,
    userId: string,
    run: (jobId: string) => JobRunner,
  ): Promise<unknown> {
    if (!this.isSupported) {
      // Відмова, а не мовчання: застосунок має дізнатися про межу платформи
      // від ядра й одразу, а не з обірваного посеред роботи перенесення.
      throw ModelCommandError.forbidden("@[core.jobNotSupportedHere]");
    }

    const params = this.db.sql.json(payload as never);
    const rows = await this.db.sql<{ result: unknown }[]>`
      select app.job_enqueue(${userId}::bigint, ${model}, ${command}, ${params}::jsonb) as result
    `;

    const envelope = rows[0]?.result as { ok?: boolean; data?: { item?: { id?: string } } } | null;
    if (!envelope || envelope.ok !== true) {
      // «Вже виконується» — звичайна відмова в конверті, а не виняток: її
      // показує форма, і читає її людина.
      return envelope;
    }

    const jobId = envelope.data?.item?.id;
    if (!jobId) throw new Error("job_enqueue повернув конверт без id завдання");

    // Ось тут запит і робота розходяться. `void` навмисний і єдиний у файлі:
    // усе, що може впасти всередині, впіймано в `execute`, тож незловленої
    // відмови промісу звідси не буде.
    void this.execute(jobId, run(jobId));

    return envelope;
  }

  /**
   * Життєвий цикл одного завдання.
   *
   * Помилка команди — це `failed` із текстом, а не падіння процесу: ніхто не
   * чекає на цей проміс, і незловлений виняток тут поклав би застосунок
   * цілком.
   */
  private async execute(jobId: string, run: JobRunner) {
    const claimed = await this.claim(jobId);
    if (!claimed) return;

    this.running += 1;
    this.startHeartbeat();

    try {
      const envelope = await run();
      // Знятим завдання вважається лише тоді, коли робота справді зупинилася
      // на прохання: саме тому стан ставиться ПІСЛЯ неї, а не в момент, коли
      // натиснули кнопку.
      const cancelled = await this.isCancelRequested(jobId);
      await this.finish(
        jobId,
        cancelled ? "cancelled" : envelope.ok ? "done" : "failed",
        envelope,
        null,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error(`❌ job ${jobId}: ${text}`);
      await this.finish(jobId, "failed", null, text);
    } finally {
      this.running -= 1;
      if (this.running === 0) this.stopHeartbeat();
    }
  }

  private async claim(jobId: string): Promise<boolean> {
    try {
      const rows = await this.db.sql<{ claimed: boolean }[]>`
        select app.job_claim(${jobId}::bigint, ${RUNNER_ID}) as claimed
      `;
      return rows[0]?.claimed === true;
    } catch (error) {
      console.error(`❌ job ${jobId}: не вдалося взятися за завдання:`, error);
      return false;
    }
  }

  private async finish(
    jobId: string,
    state: "done" | "failed" | "cancelled",
    result: unknown,
    error: string | null,
  ) {
    try {
      const resultJson = result === null || result === undefined
        ? null
        : this.db.sql.json(result as never);
      await this.db.sql`
        select app.job_finish(${jobId}::bigint, ${state}, ${resultJson}::jsonb, ${error})
      `;
    } catch (writeError) {
      // Завдання доробило, а записати про це не вийшло. Рядок лишиться в
      // `running` і його прибере сторож за відсутністю стуку — тобто система
      // сходиться сама, а слід у консолі пояснює, чому «впало» те, що не падало.
      console.error(`❌ job ${jobId}: не вдалося записати результат:`, writeError);
    }
  }

  /** Прогрес завдання. Пише ПУЛОМ — поза транзакцією роботи, див. шапку файла. */
  async writeProgress(jobId: string, progress: unknown) {
    try {
      const json = this.db.sql.json((progress ?? {}) as never);
      await this.db.sql`select app.job_progress(${jobId}::bigint, ${json}::jsonb)`;
    } catch (error) {
      // Прогрес — не робота. Не записався — робота триває далі, і валити її
      // через показник для екрана було б дорогою помилкою.
      console.error(`❌ job ${jobId}: не вдалося записати прогрес:`, error);
    }
  }

  /** Чи просили зняти завдання. Виконавець дивиться сюди між кроками. */
  async isCancelRequested(jobId: string): Promise<boolean> {
    try {
      const rows = await this.db.sql<{ requested: boolean }[]>`
        select app.job_cancel_requested(${jobId}::bigint) as requested
      `;
      return rows[0]?.requested === true;
    } catch (error) {
      console.error(`❌ job ${jobId}: не вдалося прочитати ознаку зняття:`, error);
      return false;
    }
  }

  /**
   * Стук «я живий», поки в цьому процесі є хоч одне завдання.
   *
   * Потрібен для кроків, які довго не звітують про прогрес: без стуку сторож
   * вважав би таку роботу покинутою й позначив би її як `failed` просто за те,
   * що вона мовчки рахує.
   */
  private startHeartbeat() {
    if (this.heartbeat !== null) return;
    const { heartbeatMs } = getServerConfig().jobs;

    // Через `unknown`: у Deno `setInterval` віддає число, але в дереві типів
    // поруч живе й нодівський `Timeout`, і перевірка типів застосунку бачить
    // саме його. Значення при цьому число в обох випадках.
    const timer = setInterval(() => {
      this.db.sql`select app.job_heartbeat(${RUNNER_ID})`.catch((error) => {
        console.error("❌ job: стук виконавця не дійшов:", error);
      });
    }, heartbeatMs) as unknown as number;

    this.heartbeat = timer;

    // Таймер не має тримати процес живим: коли робота скінчилася, застосунок
    // мусить мати право завершитися.
    Deno.unrefTimer(timer);
  }

  private stopHeartbeat() {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
