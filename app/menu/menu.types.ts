/** Рядок, як його віддає `app.menu_current`: плоский список, дерево — за parentId. */
export interface MenuRow {
  id: string;              // шлях із code від кореня: "catalog/bank"
  parentId: string | null;
  name: string;
  icon: string | null;     // ключ у menuIcons, не розмітка
  route: string | null;    // null → тека
}

export interface MenuItem {
  id: string;
  label: string;
  icon: string;       // SVG path (d атрибут)
  route?: string;     // если лист — маршрут для tab.open
  children?: MenuItem[];
}
