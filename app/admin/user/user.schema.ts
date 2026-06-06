import { Type, type Static } from "@sinclair/typebox";

export const UserItemSchema = Type.Object({
  id:       Type.Union([Type.String(), Type.Null()]),
  login:    Type.String({ description: "Логін користувача" }),
  fullName: Type.String({ description: "Повне ім'я" }),
  password: Type.String({ description: "Пароль (порожній = не змінювати)" }),
  isActive: Type.Boolean(),
  groupIds: Type.Array(Type.String(), { description: "ID груп користувача" }),
});

export type UserItem = Static<typeof UserItemSchema>;

export interface LookupOption {
  value: string;
  label: string;
}

export interface UserRow {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  groupCount: number;
}

export interface UserGroupRow {
  id: string;
  groupId: string;
  groupCode: string;
  groupName: string;
  isActive: boolean;
}

export interface UserIndexData {
  rows: UserRow[];
  lookups: { activeStates: LookupOption[] };
  totals: { count: number; page: number; pageSize: number };
}

export interface UserLoadData {
  item: UserItem | null;
  rows: UserGroupRow[];
  lookups: { groups: LookupOption[]; activeStates: LookupOption[] };
}

export interface UserUpdateData { item: UserItem | null }

export type UserSortBy = 'login' | 'fullName' | 'isActive' | 'groupCount';
export type SortDirection = 'asc' | 'desc';

export interface UserIndexPayload {
  search?: string;
  isActive?: boolean | null;
  page?: number;
  pageSize?: number;
  sortBy?: UserSortBy;
  sortDirection?: SortDirection;
}

export interface UserLoadPayload { id: string }
export interface UserUpdatePayload { item: UserItem }
