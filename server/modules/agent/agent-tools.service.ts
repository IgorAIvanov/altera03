/**
 * Перелік інструментів для зовнішнього агента.
 *
 * Кожен інструмент — це команда моделі: `{model, command, input}`, де `input`
 * це JSON Schema payload-а, згенерована зі схем моделей
 * (`tools/agent-tool-schemas.ts` → `app/_generated/agent-tools.generated.ts`).
 * Окремого API для агента немає й не треба: далі він кличе ті самі
 * `POST /api/model/:model/:command`, що й застосунок.
 *
 * ПЕРЕЛІК ЗАЛЕЖИТЬ ВІД КОРИСТУВАЧА. Віддавати всі інструменти означало б
 * показати агенту те, чого його користувач не має права викликати: він витратив
 * би крок, отримав відмову й пішов пробувати інше. Тому список фільтрується
 * ефективними правами — тими самими, які потім і відмовлять. Це не захист
 * (захист нижче, у рантаймі й fail-closed), а чесність опису.
 */
import { Injectable } from "@danet/core";
import { getServerConfig } from "../../config/server-config.ts";
import { AuthService } from "../auth/auth.service.ts";

/** Право, потрібне команді. Той самий вивід, що робить рантайм. */
const COMMAND_ACTION: Record<string, string> = {
  list: "view",
  get: "view",
  lookup: "view",
  delete: "delete",
  undelete: "delete",
  post: "post",
  unpost: "unpost",
};

export interface AgentToolListItem {
  model: string;
  command: string;
  input: unknown;
}

@Injectable()
export class AgentToolsService {
  constructor(private authService: AuthService) {}

  async listTools(userId: string): Promise<AgentToolListItem[]> {
    const schemas = getServerConfig().agentTools;
    const permissions = await this.authService.getEffectivePermissions(userId);

    const allowed = new Set(permissions.map((entry) => `${entry.model}:${entry.action}`));
    const allowedEverywhere = new Set(
      permissions.filter((entry) => entry.model === "*").map((entry) => entry.action),
    );

    const tools: AgentToolListItem[] = [];
    for (const [key, input] of Object.entries(schemas)) {
      const separator = key.lastIndexOf(".");
      if (separator <= 0) continue;

      const model = key.slice(0, separator);
      const command = key.slice(separator + 1);

      // `save` — це ДВА різні права: новий запис вимагає `create`, наявний
      // `edit`. Рантайм розрізняє їх за наявністю `item.id`, а тут запису ще
      // немає, тож інструмент показуємо, якщо є бодай одне з них.
      const actions = command === "save" ? ["create", "edit"] : [COMMAND_ACTION[command]];
      const permitted = actions.some((action) =>
        action && (allowed.has(`${model}:${action}`) || allowedEverywhere.has(action))
      );

      if (permitted) tools.push({ model, command, input });
    }

    return tools;
  }
}
