// Дерево блоків шаблону: обхід і точкові правки.
//
// Доти список блоків був ПЛОСКИМ, і редактор скрізь працював індексом у масиві.
// Повторювач (`type: "repeat"`) тримає власні блоки, тож «знайти блок за
// ключем» і «пересунути блок» перестали виражатися індексом: блок може лежати
// на будь-якій глибині.
//
// Функції тут чисті й нічого не знають ані про Lit, ані про полотно: редактор
// кличе їх на масив зі схеми й кладе назад те, що повернули. Формат блоків
// визначає ядро — звідси беруться ТІЛЬКИ типи, цей import стирається при
// збірці.

import type { PrintTemplateBlock } from "@altera/server/print";

/**
 * Дочірні блоки контейнера — або `null`, якщо блок нічого не містить.
 *
 * Окремою функцією, а не перевіркою `type === "repeat"` по місцях: контейнер у
 * форматі поки один, і саме тому місце, де це сказано, має бути одне. Другий
 * контейнер інакше довелося б дописувати в десяти галузках, і дев'ять із них
 * знайшлися б не одразу.
 */
export function childBlocksOf(block: PrintTemplateBlock): PrintTemplateBlock[] | null {
  return block.type === "repeat" ? block.blocks : null;
}

function withChildren(block: PrintTemplateBlock, blocks: PrintTemplateBlock[]): PrintTemplateBlock {
  return block.type === "repeat" ? { ...block, blocks } : block;
}

export interface BlockTreeEntry {
  block: PrintTemplateBlock;
  /** Глибина вкладеності: 0 — верхній рівень. */
  depth: number;
  /** Ключ повторювача, усередині якого блок лежить; порожньо — верхній рівень. */
  parentKey: string;
  /** Місце серед СВОЇХ сусідів і скільки їх усього — щоб знати, чи є куди рухати. */
  index: number;
  siblingCount: number;
}

/** Обхід згори вниз у порядку друку: батько, далі його діти, далі наступний. */
export function flattenBlocks(blocks: PrintTemplateBlock[], depth = 0, parentKey = ""): BlockTreeEntry[] {
  return blocks.flatMap((block, index) => {
    const entry: BlockTreeEntry = { block, depth, parentKey, index, siblingCount: blocks.length };
    const children = childBlocksOf(block);
    return children ? [entry, ...flattenBlocks(children, depth + 1, block.key)] : [entry];
  });
}

export function findBlockDeep(blocks: PrintTemplateBlock[], key: string): PrintTemplateBlock | null {
  return flattenBlocks(blocks).find((entry) => entry.block.key === key)?.block ?? null;
}

/** Ланцюжок повторювачів, що ведуть до блока, — згори вниз. */
export function repeatAncestorsOf(blocks: PrintTemplateBlock[], key: string): PrintTemplateBlock[] {
  for (const block of blocks) {
    if (block.key === key) return [];

    const children = childBlocksOf(block);
    if (!children) continue;

    if (flattenBlocks(children).some((entry) => entry.block.key === key)) {
      return [block, ...repeatAncestorsOf(children, key)];
    }
  }

  return [];
}

export function mapBlockDeep(
  blocks: PrintTemplateBlock[],
  key: string,
  updater: (block: PrintTemplateBlock) => PrintTemplateBlock,
): PrintTemplateBlock[] {
  return blocks.map((block) => {
    if (block.key === key) return updater(block);

    const children = childBlocksOf(block);
    return children ? withChildren(block, mapBlockDeep(children, key, updater)) : block;
  });
}

export function removeBlockDeep(blocks: PrintTemplateBlock[], key: string): PrintTemplateBlock[] {
  return blocks
    .filter((block) => block.key !== key)
    .map((block) => {
      const children = childBlocksOf(block);
      return children ? withChildren(block, removeBlockDeep(children, key)) : block;
    });
}

/** Вставити блок одразу за іншим — на тому ж рівні, що й той. */
export function insertAfterDeep(
  blocks: PrintTemplateBlock[],
  key: string,
  added: PrintTemplateBlock,
): PrintTemplateBlock[] {
  const index = blocks.findIndex((block) => block.key === key);
  if (index >= 0) {
    const next = [...blocks];
    next.splice(index + 1, 0, added);
    return next;
  }

  return blocks.map((block) => {
    const children = childBlocksOf(block);
    return children ? withChildren(block, insertAfterDeep(children, key, added)) : block;
  });
}

/** Додати блок у кінець списку: у названий повторювач або, з порожнім ключем, на верхній рівень. */
export function appendBlockDeep(
  blocks: PrintTemplateBlock[],
  parentKey: string,
  added: PrintTemplateBlock,
): PrintTemplateBlock[] {
  if (!parentKey) return [...blocks, added];

  return blocks.map((block) => {
    const children = childBlocksOf(block);
    if (!children) return block;

    return withChildren(block, block.key === parentKey ? [...children, added] : appendBlockDeep(children, parentKey, added));
  });
}

/**
 * Пересунути блок СЕРЕД СУСІДІВ. Перестрибнути рівень цим не можна навмисно:
 * «вище/нижче» — про порядок друку, а перенесення в повторювач міняє корінь
 * шляхів усередині блока, і робити це стрілкою означало б мовчки поламати
 * прив'язки.
 */
export function moveBlockDeep(blocks: PrintTemplateBlock[], key: string, delta: number): PrintTemplateBlock[] {
  const index = blocks.findIndex((block) => block.key === key);
  if (index >= 0) {
    const to = index + delta;
    if (to < 0 || to >= blocks.length) return blocks;

    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    if (!moved) return blocks;
    next.splice(to, 0, moved);
    return next;
  }

  return blocks.map((block) => {
    const children = childBlocksOf(block);
    return children ? withChildren(block, moveBlockDeep(children, key, delta)) : block;
  });
}

/**
 * Перенести блок в інший повторювач (порожній ключ — на верхній рівень).
 *
 * Це саме те, чого не роблять стрілки: разом із рівнем міняється корінь шляхів
 * усередині блока, тож дію названо окремо й вибирають її списком, а не
 * ненароком тягнучи мишею. Повторювач у себе самого не переноситься — інакше
 * піддерево зникло б із дерева разом із ним.
 */
export function moveBlockToParent(
  blocks: PrintTemplateBlock[],
  key: string,
  parentKey: string,
): PrintTemplateBlock[] {
  const moved = findBlockDeep(blocks, key);
  if (!moved || key === parentKey) return blocks;

  const children = childBlocksOf(moved);
  if (children && parentKey && flattenBlocks(children).some((entry) => entry.block.key === parentKey)) {
    return blocks;
  }

  return appendBlockDeep(removeBlockDeep(blocks, key), parentKey, moved);
}
