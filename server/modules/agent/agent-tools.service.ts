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
import { isChangingCall, type ModelCommandCaller } from "../model-runtime/model-runtime.service.ts";
import { messageText } from "../../common/messages.ts";
import { coreAgentRules } from "./core-agent-rules.generated.ts";
import { coreModelAccess } from "./core-agent-tools.ts";

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

/** Оголошене обмеження моделі: ключ правила й те, що воно скаже людині. */
export interface AgentModelRule {
  key: string;
  text: string;
}

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

  /**
   * Що модель ВІДМОВИТЬСЯ робити — перелік її оголошених обмежень.
   *
   * Схема каже, які є поля, і мовчить про поведінку: `depreciationMethod`
   * приймає `production` за типом, а закриття місяця цей спосіб відбиває. Не
   * знаючи цього, агент упевнено розписує ланцюжок документів, і людина
   * впирається в нього через місяць роботи. Побачити правило доти можна було
   * лише спрацьованим — тобто на живих даних.
   *
   * Їде разом зі схемами (`?model=…`), а не в каталозі: каталог мусить лишатися
   * малим на сотні моделей, а правила потрібні саме тому, хто вже дійшов до
   * конкретної моделі. Ціна — кілька сотень байтів на модель.
   *
   * Ключ лишається поруч із текстом: ним же позначена й сама відмова, коли вона
   * станеться (`messages[].key`), тож агент може сказати, що впирається саме в
   * це правило, а не в щось схоже.
   */
  rules(models: string[], locale?: string): Record<string, AgentModelRule[]> {
    const { agentRules, messages } = getServerConfig();
    const texts = locale ? { ...messages, locale } : messages;
    const routes = getAgentRoutes();
    const found: Record<string, AgentModelRule[]> = {};

    for (const model of models) {
      // Спершу власні правила моделі, потім ядрові. Найважчі обмеження — те,
      // що відбиває ПРОВЕДЕННЯ (немає рахунку, не заповнене субконто, нульова
      // сума), — написані в ядрі один раз на всі документи всіх застосунків, і
      // з реєстру застосунку їх не видно взагалі. Стосуються вони не «моделі
      // document_core», а будь-якого документа, тому й підбираються за типом.
      const keys = [
        ...(agentRules[model] ?? []),
        ...(coreAgentRules[routes[model]?.type ?? ""] ?? []),
        ...(coreAgentRules["*"] ?? []),
      ];

      const rules = [...new Set(keys)]
        .map((key) => ({ key, text: messageText(key, texts) }))
        // Ключ без перекладу не показуємо: у переліку правил він читався б як
        // текст правила. Порожнього ключа тут бути не мусить — за цим стежить
        // проба маркерів, — але покладатися на це в рантаймі нема потреби.
        .filter((rule): rule is AgentModelRule => typeof rule.text === "string");

      if (rules.length) found[model] = rules;
    }

    return found;
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
      const declared = models.registry[model]?.access?.[command] ??
        coreModelAccess[`${model}.${command}`];

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

      // Сухий прогін проведення просить право `post`, а не змінює нічого —
      // і саме тому токен «тільки читання» його бачить: агент-порадник має
      // показувати наслідок, не маючи права його спричинити.
      const changing = actions.some((action) => action && isChangingCall(action, command));
      if (readOnly && changing) continue;

      if (permitted) tools.push({ model, command, input });
    }

    return tools;
  }
}
