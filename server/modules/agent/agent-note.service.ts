/**
 * Пам'ятка бази — те, чого агент вивести не може нізвідки.
 *
 * Він знає бухгалтерію; він не знає, що на цьому підприємстві ТЗР у вартості
 * запасу, склад №3 — відповідальне зберігання, а «Транзит» у контрагентах це
 * перевізник. Реєстр обмежень каже, чого не можна; сухий прогін — що вийде;
 * обидва про механіку. Це про звички.
 *
 * Доставка влаштована як у вкладених `CLAUDE.md`, і це не аналогія заради
 * краси, а вибір проти пошуку: пам'ятка, яку треба здогадатися пошукати,
 * допомагає лише тому агентові, який уже підозрює, що чогось не знає. А не
 * знає він якраз того, про існування чого не здогадується. Тому:
 *
 *   - коренева (`'*'`) їде з КАТАЛОГОМ моделей, тобто з першого виклику розмови;
 *   - по-модельна — з описом моделі, поруч із оголошеними обмеженнями.
 *
 * У контекст іде тільки `confirmed`. Чернетку міг написати сам агент, і
 * непідтверджена вона означала б, що наступний прочитає його догадку як
 * домовленість підприємства й пошлеться на неї.
 */
import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";

/** Область пам'ятки: `'*'` — уся база, інакше ключ моделі. */
export const AGENT_NOTE_ROOT = "*";

interface NoteRow {
  model_key: string;
  content: string;
}

/** Рядок покажчика тем — те, що лежить у контексті завжди. */
export interface AgentTopicIndexEntry {
  slug: string;
  title: string;
  /** Коли ця тема потрібна. Найважливіше поле: воно й вирішує, чи відкриють. */
  summary: string;
}

@Injectable()
export class AgentNoteService {
  constructor(private db: DatabaseService) {}

  /** Чи скаржилися вже на відсутню таблицю. Одного разу досить. */
  private warned = false;

  /**
   * Підтверджені записки названих областей: `{ "*": [...], "invoice": [...] }`.
   *
   * Область без записок у відповіді відсутня, а не порожня масивом: споживач
   * однаково перевіряє наявність, а зайві ключі роздували б відповідь на
   * кожній моделі, у якої пам'ятки немає (тобто майже на кожній).
   */
  async forScopes(scopes: string[]): Promise<Record<string, string[]>> {
    const wanted = [...new Set(scopes.filter(Boolean))];
    if (wanted.length === 0) return {};

    let rows: NoteRow[];
    try {
      rows = await this.db.sql<NoteRow[]>`
        select model_key, content
        from app.agent_note
        where kind = 'note' and status = 'confirmed' and model_key in ${this.db.sql(wanted)}
        order by model_key, id
      `;
    } catch (error) {
      // Таблиці немає — застосунок не опублікував SQL ядра цієї версії. Це не
      // привід валити перелік інструментів: без пам'ятки агент працює рівно
      // так, як працював досі. Той самий вибір, що з рівнем журналу.
      if (!this.warned) {
        this.warned = true;
        console.warn(
          "⚠ app.agent_note недоступна — пам'ятка бази агенту не доїде. " +
            `Найімовірніше не виконано sql:assemble && sql:publish. ${
              error instanceof Error ? error.message : error
            }`,
        );
      }
      return {};
    }

    const notes: Record<string, string[]> = {};
    for (const row of rows) (notes[row.model_key] ??= []).push(row.content);
    return notes;
  }

  /** Коренева пам'ятка — те, що їде з каталогом моделей. */
  async root(): Promise<string[]> {
    return (await this.forScopes([AGENT_NOTE_ROOT]))[AGENT_NOTE_ROOT] ?? [];
  }

  /**
   * Покажчик тем — назви й «коли потрібно», без тіл.
   *
   * Тема це процедура на півтори-три сторінки, і їх буде десяток: віддавати їх
   * усі завжди означало б вивалювати в кожну розмову те, що знадобиться в одній
   * із двадцяти. Тому як у скіла: рядок завжди, тіло — командою
   * `agent_note.topic`, коли задача збіглася.
   */
  async topics(): Promise<AgentTopicIndexEntry[]> {
    try {
      return await this.db.sql<AgentTopicIndexEntry[]>`
        select slug, title, summary
        from app.agent_note
        where kind = 'topic' and status = 'confirmed'
        order by slug
      `;
    } catch {
      // Таблиці немає — те саме, що з записками: без пам'ятки агент працює як
      // працював. Скаржиться на це `forScopes`, двічі в консоль не пишемо.
      return [];
    }
  }
}
