/**
 * Механіка дерева ЕЛЕМЕНТІВ (самоссылка `parentId`) — самі типи й чисті
 * функції: без DOM, без стану, без імпорту компонентів.
 *
 * Окремий модуль з тієї ж причини, що `table-contract.ts`, — граф імпортів:
 * розгортка потрібна не лише списку (`ModelTreeListBase`), а згодом і діалогу
 * підбору (дві дільниці з однаковою назвою в різних цехах без дерева не
 * розрізнити), і пікер не має тягнути за собою чанк списку. Тому сюди не
 * переїжджає нічого, що імпортує компонент чи має побічний ефект.
 *
 * Це ІНШИЙ механізм, ніж дерево груп (`hierarchy: true` + `<ui-group-tree>`):
 * там вузли — рядки окремої таблиці `{model}_group`, і папка елементом моделі
 * не є. Тут вузли — САМІ записи моделі, батьком дільниці стоїть цех, такий
 * самий запис (`HierarchyOfItems` джерела), і саме він потрапляє в субконто.
 */

/** Видимий вузол розгорнутого дерева — рядок моделі плюс місце в дереві. */
export interface TreeNode<Row> {
  row: Row;
  /** Глибина вузла: 0 — корінь. */
  depth: number;
  /** Чи має вузол дітей У ЦЬОМУ наборі рядків (а не в базі взагалі). */
  hasChildren: boolean;
}

/**
 * Нормалізований покажчик «вузол → батько» для НАБОРУ: батько, якого в наборі
 * немає (відфільтрований, за стелею вибірки), — це `null`, як і порожній
 * `parentId`. Одне місце на правило: ним-таки користується `flattenTree`, а
 * компонент — для ходіння вгору (найближчий видимий предок, шлях до вузла),
 * і розійтися ці двоє не можуть.
 */
export function treeParentIndex<Row extends { id: string }>(
  rows: readonly Row[],
  parentIdOf: (row: Row) => string | null | undefined,
): Map<string, string | null> {
  const ids = new Set(rows.map((row) => row.id));
  const parents = new Map<string, string | null>();
  for (const row of rows) {
    const raw = parentIdOf(row);
    parents.set(row.id, raw != null && raw !== "" && ids.has(String(raw)) ? String(raw) : null);
  }
  return parents;
}

/**
 * Розгорнути плоский набір рядків у видимий список дерева (DFS).
 *
 * Порядок дітей усередині вузла — порядок рядків у вході: сервер сортує
 * глобально (за колонкою), а розгортка перегруповує за батьком, тож
 * «відсортовано за назвою» означає «брати й сестри відсортовані за назвою» —
 * окремого сортування дерева не існує.
 *
 * Дві властивості, на яких тримається чесність показу:
 *
 *  - **жоден рядок не губиться.** Рядок, чийого батька в наборі немає
 *    (відфільтрований, позначений на видалення, за стелею вибірки), підіймається
 *    в корінь — приїхав, отже мусить бути видимим;
 *  - **цикл у даних не вішає і не ховає.** Ланцюжок `a→b→a` не має шляху з
 *    кореня; такі рядки додаються в кінець як корені разом зі своїм піддеревом —
 *    зіпсовані дані мають бути видні, інакше їх нема як полагодити.
 *
 * Згорнутість (`isCollapsed`) ховає ЕМІСІЮ піддерева, але не обхід: сховане
 * піддерево не переплутується з недосяжним через цикл.
 */
export function flattenTree<Row extends { id: string }>(
  rows: readonly Row[],
  parentIdOf: (row: Row) => string | null | undefined,
  isCollapsed: (id: string) => boolean,
): TreeNode<Row>[] {
  const parents = treeParentIndex(rows, parentIdOf);
  /** Діти за батьком у порядку входу; ключ `null` — корені. */
  const children = new Map<string | null, Row[]>();
  for (const row of rows) {
    const parent = parents.get(row.id) ?? null;
    const list = children.get(parent);
    if (list) list.push(row);
    else children.set(parent, [row]);
  }

  const out: TreeNode<Row>[] = [];
  const seen = new Set<string>();
  const visit = (row: Row, depth: number, hidden: boolean) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const kids = children.get(row.id) ?? [];
    if (!hidden) out.push({ row, depth, hasChildren: kids.length > 0 });
    const hideKids = hidden || isCollapsed(row.id);
    for (const kid of kids) visit(kid, depth + 1, hideKids);
  };

  for (const root of children.get(null) ?? []) visit(root, 0, false);
  // Що лишилося після обходу з коренів — учасники циклу: піднімаємо коренями.
  for (const row of rows) if (!seen.has(row.id)) visit(row, 0, false);

  return out;
}
