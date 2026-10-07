import type { ModelCommandContext } from "@altera/server";

/**
 * Перевірити токен: чи задано й чи розшифровується він на сервері.
 *
 * Еталон `ctx.secret` — єдиного шляху до відкритого значення. Справжня
 * інтеграція тут зробила б запит до API з цим токеном; назовні ж не їде НІЧОГО
 * від нього — ні значення, ні довжини, ні маски: лише «так» або «ні».
 */
export default async function externalServiceCheck(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const id = typeof payload.id === "string" && /^\d+$/.test(payload.id) ? payload.id : null;
  if (!id) {
    return { ok: false, data: { item: null }, messages: [{ type: "error", text: "@[common.notFound]" }] };
  }

  const token = await ctx.secret(id, "token");
  const configured = token !== null && token !== "";
  return {
    ok: true,
    data: { item: { configured } },
    messages: [{
      type: "info",
      text: configured ? "@[externalService.checkSet]" : "@[externalService.checkNotSet]",
    }],
  };
}
