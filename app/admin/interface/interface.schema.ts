import { Type, type Static } from "@sinclair/typebox";

export const InterfaceItemSchema = Type.Object({
  id:       Type.Union([Type.String(), Type.Null()]),
  code:     Type.String({ description: "Код інтерфейсу" }),
  name:     Type.String({ description: "Назва інтерфейсу" }),
  isActive: Type.Boolean(),
  menuIds:  Type.Array(Type.String(), { description: "ID меню інтерфейсу" }),
});

export type InterfaceItem = Static<typeof InterfaceItemSchema>;

export interface LookupOption {
  value: string;
  label: string;
}

export interface InterfaceRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  menuCount: number;
}

export interface InterfaceAssignmentRow {
  id: string;
  interfaceId: string;
  menuId: string;
  menuCode: string;
  menuName: string;
  sortOrder: number;
  isActive: boolean;
}

export interface InterfaceIndexData {
  rows: InterfaceRow[];
  lookups: { activeStates: LookupOption[] };
  totals: { count: number; page: number; pageSize: number };
}

export interface InterfaceLoadData {
  item: Omit<InterfaceItem, 'menuIds'> | null;
  rows: InterfaceAssignmentRow[];
  lookups: { menus: LookupOption[]; activeStates: LookupOption[] };
}

export interface InterfaceUpdateData {
  item: Omit<InterfaceItem, 'menuIds'> | null;
  rows: InterfaceAssignmentRow[];
}

export type InterfaceSortBy = 'code' | 'name' | 'isActive' | 'menuCount';
export type SortDirection = 'asc' | 'desc';

export interface InterfaceIndexPayload {
  search?: string;
  isActive?: boolean | null;
  page?: number;
  pageSize?: number;
  sortBy?: InterfaceSortBy;
  sortDirection?: SortDirection;
}

export interface InterfaceLoadPayload { id: string }

export interface InterfaceUpdatePayload {
  item: { id: string | null; code: string; name: string; isActive: boolean };
  rows: Array<{ menuId: string; sortOrder: number; isActive: boolean }>;
}
