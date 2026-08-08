import type { ModelCommandContext } from "@altera/server";

/**
 * Тестова TS-команда моделі bank.
 * Демонструє: оголошення через manifest `commands.ts`, доступ до SQL через ctx.db,
 * стандартний envelope відповіді. Викликається з форми редагування.
 */
export default async function bankPing(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const echoedId = typeof payload.id === "string" ? payload.id : null;

  const [stats] = await ctx.db.sql<
    { total: number; active: number; server_time: string }[]
  >`
    select
      count(*)::int                              as total,
      count(*) filter (where not is_deleted)::int as active,
      to_char(now(), 'YYYY-MM-DD HH24:MI:SS')    as server_time
    from app.bank
  `;

  const total = stats?.total ?? 0;
  const active = stats?.active ?? 0;

  return {
    ok: true,
    data: {
      item: {
        echoedId,
        userId: ctx.userId,
        command: ctx.command,
        total,
        active,
        serverTime: stats?.server_time ?? null,
      },
    },
    messages: [
      {
        type: "info",
        text: `TS-команда виконана на сервері: банків ${total} (активних ${active})`,
      },
    ],
  };
}
