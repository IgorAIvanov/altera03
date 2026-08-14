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
import type { ModelCommandCaller } from "../model-runtime/model-runtime.service.ts";

/**
 * Право, потрібне СТАНДАРТНІЙ команді. Той самий вивід, що робить рантайм.
 *
 * Нестандартна (звітний `index`, TS-команда, друк) свого права звідси не
 * дістає — вона оголошує його в манифесті, і саме оголошене має силу. Порядок
 * джерел тут той самий, що в `resolveRequiredAction`: спершу оголошене,
 * потім вивід з імені.
 */
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

  async listTools(userId: string, caller: ModelCommandCaller = {}): Promise<AgentToolListItem[]> {
    // Токен «тільки читання» не має бачити інструментів запису: вони йому
    // однаково відмовлять, а показані — виглядають як доступні.
    const readOnly = caller.accessToken?.readOnly === true;
    const { agentTools: schemas, models } = getServerConfig();
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

      // Оголошене право сильніше за вивід з імені — інакше звіт (`index`),
      // друк і будь-яка TS-команда лишалися б невидимі для агента, хоч і
      // виконувані: вивід знає лише вісім стандартних дій.
      const declared = models.registry[model]?.access?.[command];

      // `save` — це ДВА різні права: новий запис вимагає `create`, наявний
      // `edit`. Рантайм розрізняє їх за наявністю `item.id`, а тут запису ще
      // немає, тож інструмент показуємо, якщо є бодай одне з них.
      const actions = declared
        ? [declared]
        : command === "save"
        ? ["create", "edit"]
        : [COMMAND_ACTION[command]];

      // `authenticated` — «досить бути авторизованим»: права не питаємо.
      const permitted = declared === "authenticated" || actions.some((action) =>
        action && (allowed.has(`${model}:${action}`) || allowedEverywhere.has(action))
      );

      const changing = actions.some((action) =>
        action && ["create", "edit", "delete", "post", "unpost"].includes(action)
      );
      if (readOnly && changing) continue;

      if (permitted) tools.push({ model, command, input });
    }

    return tools;
  }
}
