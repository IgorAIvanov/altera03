import { hashPassword } from "../../auth/password-hash.ts";
import type { ModelCommandContext } from "../model-runtime.types.ts";

interface PostgresLikeError {
  code?: string;
  detail?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export async function userSaveHandler(payload: Record<string, unknown>, context: ModelCommandContext) {
  const item = asRecord(payload.item);
  if (!item) {
    throw new Error("item обов'язковий для update");
  }

  const id = asString(item.id).trim();
  const login = asString(item.login).trim();
  const fullName = asString(item.fullName).trim();
  const password = asString(item.password);
  const isActive = asBoolean(item.isActive, true);
  const groupIds = asStringArray(item.groupIds);

  if (!login) {
    throw new Error("login обов'язковий для user.update");
  }

  if (!fullName) {
    throw new Error("fullName обов'язковий для user.update");
  }

  if (!id && !password.trim()) {
    throw new Error("password обов'язковий для нового користувача");
  }

  try {
    return await context.db.transaction(async (sql) => {
      let targetUserId = id;

      if (groupIds.length > 0) {
        const existingGroups = await sql<{ id: string }[]>`
          select id::text as id
          from app.user_group
          where id::text in ${sql(groupIds)}
        `;
        const existingGroupIds = new Set(existingGroups.map((row) => row.id));
        const missingGroupId = groupIds.find((groupId) => !existingGroupIds.has(groupId));
        if (missingGroupId) {
          throw new Error(`Групу користувачів ${missingGroupId} не знайдено`);
        }
      }

      if (!targetUserId) {
        const passwordHash = await hashPassword(password);
        const inserted = await sql<{ id: string }[]>`
          insert into app.users (login, password_hash, full_name, is_active)
          values (${login}, ${passwordHash}, ${fullName}, ${isActive})
          returning id
        `;
        targetUserId = inserted[0]?.id ?? "";
      } else {
        const existing = await sql<{ id: string }[]>`
          select id
          from app.users
          where id = ${targetUserId}::bigint
        `;

        if (!existing[0]?.id) {
          throw new Error(`Користувача ${targetUserId} не знайдено`);
        }

        const passwordHash = password.trim() ? await hashPassword(password) : null;
        await sql`
          update app.users
          set
            login = ${login},
            full_name = ${fullName},
            is_active = ${isActive},
            password_hash = coalesce(${passwordHash}, password_hash),
            updated_at = now()
          where id = ${targetUserId}::bigint
        `;
      }

      await sql`
        delete from app.user_group_member
        where user_id = ${targetUserId}::bigint
      `;

      for (const groupId of groupIds) {
        await sql`
          insert into app.user_group_member (user_group_id, user_id, is_active)
          values (${groupId}::bigint, ${targetUserId}::bigint, true)
        `;
      }

      const response = await sql<{ result: unknown }[]>`
        select app.user_load(${context.userId}::bigint, jsonb_build_object('id', ${targetUserId}::text)) as result
      `;

      return response[0]?.result ?? null;
    });
  } catch (error) {
    const pgError = error as PostgresLikeError;
    if (pgError?.code === "23505") {
      throw new Error("Користувач з таким логіном вже існує");
    }

    if (pgError?.code === "23503" && pgError.detail) {
      throw new Error(pgError.detail);
    }

    throw error;
  }
}