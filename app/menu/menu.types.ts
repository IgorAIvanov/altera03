export interface MenuItem {
  id: string;
  label: string;
  icon: string;       // SVG path (d атрибут)
  route?: string;     // если лист — маршрут для tab.open
  children?: MenuItem[];
}
