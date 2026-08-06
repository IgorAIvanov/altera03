import { Controller, Get } from "@danet/core";

import { jsonResponse } from "../../common/http.ts";
import { SolutionService } from "./solution.service.ts";

function envelope(item: unknown) {
  return { ok: true, data: { item, rows: [], options: {}, totals: {} }, messages: [], meta: {} };
}

/**
 * Стан підтримки прикладного рішення — читання, і тільки.
 *
 * Установки тут немає навмисно: її робить окремий інструмент
 * (`deno task solution:update`), бо той, кого заміняють, не має заміняти себе
 * сам — а заразом серверу не потрібні ані `--allow-write`, ані `--allow-run`.
 *
 * Права цей маршрут не перевіряє: він не віддає нічого, чого користувач не
 * бачить і так (назва рішення, версія, скільки файлів розійшлося з поставкою),
 * і нічого не змінює. Перелік розбіжностей поіменно лишається в консольній
 * команді — там, де ним і користуються.
 */
@Controller("api/solution")
export class SolutionController {
  constructor(private solutionService: SolutionService) {}

  @Get("status")
  async status() {
    return jsonResponse(envelope(await this.solutionService.readState()), 200);
  }
}
