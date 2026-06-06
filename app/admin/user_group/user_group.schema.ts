import { Type, type Static } from "@sinclair/typebox";

export const UserGroupItemSchema = Type.Object({
  id:           Type.Union([Type.String(), Type.Null()]),
  code:         Type.String({ description: "Код групи" }),
  name:         Type.String({ description: "Назва групи" }),
  isActive:     Type.Boolean(),
  interfaceIds: Type.Array(Type.String(), { description: "ID інтерфейсів групи" }),
  userIds:      Type.Array(Type.String(), { description: "ID користувачів групи" }),
});

export type UserGroupItem = Static<typeof UserGroupItemSchema>;

export interface LookupOption {
  value: string;
  label: string;
}

export interface UserGroupRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
  interfaceCount: number;
}

export interface UserGroupInterfaceRow {
  id: string;
  interfaceId: string;
  interfaceCode: string;
  interfaceName: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UserGroupMemberRow {
  id: string;
  userId: string;
  userLogin: string;
  userFullName: string;
  isActive: boolean;
}

export interface UserGroupIndexData {
  rows: UserGroupRow[];
  lookups: { activeStates: LookupOption[] };
  totals: { count: number; page: number; pageSize: number };
}

export interface UserGroupLoadData {
  item: UserGroupItem | null;
  rows: { interfaces: UserGroupInterfaceRow[]; users: UserGroupMemberRow[] };
  lookups: { interfaces: LookupOption[]; users: LookupOption[]; activeStates: LookupOption[] };
}

export interface UserGroupUpdateData { item: UserGroupItem | null }

export type UserGroupSortBy = 'code' | 'name' | 'isActive' | 'userCount' | 'interfaceCount';
export type SortDirection = 'asc' | 'desc';

export interface UserGroupIndexPayload {
  search?: string;
  isActive?: boolean | null;
  page?: number;
  pageSize?: number;
  sortBy?: UserGroupSortBy;
  sortDirection?: SortDirection;
}

export interface UserGroupLoadPayload { id: string }
export interface UserGroupUpdatePayload { item: UserGroupItem }
