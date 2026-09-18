/**
 * Дерево пов'язаних документів — контракт відповіді й псевдографіка.
 *
 * Окремим чистим модулем з тієї ж причини, що `split-geometry.ts` і
 * `popover.ts`: помилка в розрахунку гілок не падає, а тихо малює не те дерево
 * — «└─» там, де нижче ще брат, і лінія обривається посеред гілки. Побачити це
 * можна лише на дереві з кількома рівнями й братами, тобто саме там, де його
 * ніхто не перевірить очима.
 *
 * Рядки приходять із `app.document_related` у порядку обходу (preorder):
 * батько раніше за дітей, діти — поспіль. Цього досить, щоб усе вивести з
 * `parentKey`, не будуючи дерева об'єктів.
 */

/** Вузол відповіді команди `related` (`data.rows`). */
export interface RelatedNode {
  /** Номер рядка в порядку обходу; унікальний, на відміну від `id`. */
  key: number;
  parentKey: number | null;
  depth: number;
  isCurrent: boolean;
  /** Документ уже розкритий вище — під другим батьком лише згадується. */
  isRepeat: boolean;
  /** `false` — немає права `view` на модель вузла; реквізити тоді `null`. */
  isAvailable: boolean;
  typeCode: string;
  typeName: string;
  id: string | null;
  number: string | null;
  docDate: string | null;
  total: number | string | null;
  presentation: string | null;
  isPosted: boolean | null;
  isDeleted: boolean | null;
  /** Модель і поле, яким вузол посилається на батька. */
  viaModel: string | null;
  viaField: string | null;
}

/** `data.item` тієї ж відповіді. */
export interface RelatedSummary {
  id: string;
  nodes: number;
  limit: number;
  /** Компонента більша за межу — показано найближчі документи. */
  truncated: boolean;
}

/**
 * Префікс кожного рядка: `""` для кореня, `"├─ "`, `"│  └─ "` тощо нижче.
 *
 * Лінія предка тягнеться вниз, доки в нього є ще брати нижче; останній брат
 * закриває гілку `└─`. Кілька коренів — кілька дерев одне під одним, і
 * лінією між собою вони не з'єднуються.
 */
export function treePrefixes(rows: readonly RelatedNode[]): string[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));

  // Останній серед братів — той, після якого в порядку обходу немає рядка з
  // тим самим батьком.
  const lastChild = new Map<number | null, number>();
  for (const row of rows) lastChild.set(row.parentKey, row.key);
  const isLast = (row: RelatedNode) => lastChild.get(row.parentKey) === row.key;

  return rows.map((row) => {
    if (row.parentKey === null) return "";

    let prefix = isLast(row) ? "└─ " : "├─ ";
    // Предки, крім кореня: корінь лінії вниз не малює — він сам на рівні нуль.
    let ancestor = byKey.get(row.parentKey);
    while (ancestor && ancestor.parentKey !== null) {
      prefix = (isLast(ancestor) ? "   " : "│  ") + prefix;
      ancestor = byKey.get(ancestor.parentKey);
    }
    return prefix;
  });
}
