/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

/** Pagination parameters */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** Standard list query params */
export interface ListQuery extends PaginationParams {
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** Date range filter */
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export function ok<T>(data: T, meta?: ApiResponse<T>["meta"]): ApiResponse<T> {
  return { success: true, data, meta };
}

export function err(error: string): ApiResponse<never> {
  return { success: false, error };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): ApiResponse<T[]> {
  return { success: true, data, meta: { total, page, pageSize } };
}
