/**
 * Спільні дані двох демо дерева на домашній вкладці (список і пікер) —
 * структура підприємства. Окремий файл, а не експорт із демо-списку: пікер,
 * що імпортує дані з модуля списку, тягнув би за собою і його чанк — рівно
 * та залежність, від якої `ModelTreePickerBase` звільнений за побудовою.
 */
export interface DemoRow {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
}

export const DEMO_ROWS: DemoRow[] = [
  { id: "1", parentId: null, name: "Адміністрація", code: "001" },
  { id: "2", parentId: null, name: "Цех №1 (механічний)", code: "010" },
  { id: "21", parentId: "2", name: "Дільниця токарна", code: "011" },
  { id: "22", parentId: "2", name: "Дільниця фрезерна", code: "012" },
  { id: "221", parentId: "22", name: "Бригада №1", code: "012.1" },
  { id: "222", parentId: "22", name: "Бригада №2", code: "012.2" },
  { id: "3", parentId: null, name: "Цех №2 (складальний)", code: "020" },
  { id: "31", parentId: "3", name: "Дільниця складання", code: "021" },
  { id: "32", parentId: "3", name: "Дільниця фарбування", code: "022" },
  { id: "4", parentId: null, name: "Склад готової продукції", code: "030" },
];

/** Відповідь демо-«сервера» на list/lookup: фільтр, сортування, сторінка. */
export function serveDemoRows(payload: unknown): {
  rows: DemoRow[];
  totals: { count: number; page: number; pageSize: number };
} {
  const p = payload as {
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: string;
  };

  const q = (p.search ?? "").trim().toLowerCase();
  const rows = DEMO_ROWS.filter(
    (row) => !q || row.name.toLowerCase().includes(q) || row.code.includes(q),
  );

  const sortBy = p.sortBy === "code" ? "code" : "name";
  const dir = p.sortDir === "desc" ? -1 : 1;
  rows.sort((a, b) => a[sortBy].localeCompare(b[sortBy], "uk") * dir);

  const page = Math.max(p.page ?? 1, 1);
  const pageSize = Math.max(p.pageSize ?? 20, 1);
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    totals: { count: rows.length, page, pageSize },
  };
}
