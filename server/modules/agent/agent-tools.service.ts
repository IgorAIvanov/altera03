/**
 * Що агент уміє робити в цій базі — у двох режимах, і це поділ за розміром.
 *
 * КАТАЛОГ (`GET /api/agent/tools`) — моделі, їхні синоніми й перелік команд,
 * БЕЗ схем. ~120 байтів на модель, тобто дванадцять кілобайтів на сотню: його
 * можна тримати цілком.
 *
 * ОПИС (`?model=bank`, `?model=bank&command=save`) — схеми на вимогу.
 *
 * Поділ не передчасна оптимізація, а арифметика: двадцять моделей дають 65
 * інструментів і 26 КБ, повне рішення — сотню моделей, тобто 400–600
 * інструментів і 200 КБ в одній відповіді. Причому нелінійно: `save` документа
 * з табличною частиною важить у рази більше за `lookup` довідника. Віддавати це
 * одним шматком означало б, що заради схеми одного `save` агент стягує всю базу
 * знань — рівно те, від чого рятує диспетчер на боці MCP.
 *
 * ПЕРЕЛІК ЗАЛЕЖИТЬ ВІД КОРИСТУВАЧА, обидва режими однаково. Віддавати все
 * означало б показати агенту те, чого його користувач не має права викликати:
 * він витратив би крок, отримав відмову й пішов пробувати інше. Це не захист
 * (захист нижче, у рантаймі й fail-closed), а чесність опису.
 */
import { Injectable } from "@danet/core";
import { getServerConfig } from "../../config/server-config.ts";
import { AuthService } from "../auth/auth.service.ts";
import { getAgentRoutes } from "./agent-routes.ts";
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

const CHANGING_ACTIONS = ["create", "edit", "delete", "post", "unpost"];

export interface AgentToolListItem {
  model: string;
  command: string;
  input: unknown;
}

/** Рядок каталогу: модель без схем — те, з чого агент вибирає, куди дивитися. */
export interface AgentModelListItem {
  model: string;
  type: string;
  /** Назва мовами застосунку: `{uk: "Банки", en: "Banks"}`. */
  titles?: Record<string, string>;
  /** Маршрут списку — щоб агент міг дати людині посилання, не викликаючи нічого. */
  route?: string;
  /** Слова, якими цю модель називають люди («банк», «банки»). */
  aliases?: string[];
  priority?: number;
  commands: string[];
}

@Injectable()
export class AgentToolsService {
  constructor(private authService: AuthService) {}

  /**
   * Каталог моделей. Порядок — за `priority` з манифеста, далі за іменем: на
   * сотні моделей перше, що бачить агент, має бути найужитковішим.
   */
  async listModels(userId: string, caller: ModelCommandCaller = {}): Promise<AgentModelListItem[]> {
    const routes = getAgentRoutes();
    const byModel = new Map<string, string[]>();

    for (const tool of await this.permittedTools(userId, caller)) {
      const commands = byModel.get(tool.model);
      if (commands) commands.push(tool.command);
      else byModel.set(tool.model, [tool.command]);
    }

    const models: AgentModelListItem[] = [];
    for (const [model, commands] of byModel) {
      const route = routes[model];
      models.push({
        model,
        type: route?.type ?? "",
        // Технічне ім'я нічого не каже тому, хто цієї бази не бачив: назва — це
        // те, чим модель називають люди, і саме за нею агент її й упізнає.
        titles: route?.titles,
        route: route?.listPath,
        // Синоніми лежали в маршрутах і не доїжджали до агента взагалі. Поки
        // моделей два десятки, він угадує за іменем; на сотні саме синонім і
        // відрізняє «номенклатуру» від «номенклатурної групи».
        aliases: route?.aliases,
        priority: route?.priority,
        commands,
      });
    }

    return models.sort((a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) || a.model.localeCompare(b.model)
    );
  }

  /**
   * Схеми названих моделей (і, за потреби, однієї команди). Без моделі не
   * віддається нічого.
   *
   * Моделей саме СПИСОК: диспетчеру звичайно потрібні дві-три одразу («опиши
   * рахунок, контрагента й номенклатуру»), і три окремі запити на це — три
   * оберти там, де вистачає одного.
   */
  async listTools(
    userId: string,
    caller: ModelCommandCaller = {},
    filter: { models?: string[]; command?: string } = {},
  ): Promise<AgentToolListItem[]> {
    const wanted = filter.models?.length ? new Set(filter.models) : null;
    const tools = await this.permittedTools(userId, caller);
    return tools.filter((tool) =>
      (!wanted || wanted.has(tool.model)) &&
      (!filter.command || tool.command === filter.command)
    );
  }

  /** Усе, що цьому користувачу цим викликом дозволено. Спільне для обох режимів. */
  private async permittedTools(
    userId: string,
    caller: ModelCommandCaller,
  ): Promise<AgentToolListItem[]> {
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

      const changing = actions.some((action) => action && CHANGING_ACTIONS.includes(action));
      if (readOnly && changing) continue;

      if (permitted) tools.push({ model, command, input });
    }

    return tools;
  }
}
