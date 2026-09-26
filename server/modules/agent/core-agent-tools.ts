/**
 * Інструменти агента, які дає САМЕ ЯДРО, а не застосунок.
 *
 * Перелік агента збирається з манифестів моделей (`app/_generated/agent-tools`),
 * і моделі ядра туди не потрапляють за побудовою: у `attachment` манифеста
 * немає — вона інфраструктурна, живе в `server/sql/attachment` і працює
 * стандартним маршрутом `app.attachment_<команда>`. Наслідок був тихий і
 * незручний: агент бачив накладну, але не бачив жодного прикріпленого до неї
 * файлу — навіть імені.
 *
 * ЧОМУ ЛИШЕ ЧИТАННЯ. `list` і `get` віддають метадані й ключ доступу, яким
 * обгортка забирає байти (`GET /api/blob/:id?token=…`). Прив'язку (`save`) і
 * видалення (`delete`) сюди не пускаємо свідомо: прив'язка — робота форми, яка
 * щойно зберегла запис, а видалення файлу незворотне й не має ані позначки, ані
 * `confirm`. Коли знадобиться — це окреме рішення, а не дописаний рядок.
 *
 * ПРАВО ЗВИЧАЙНЕ — `attachment:view`. Тобто модель ядра керується тим самим
 * механізмом, що й будь-яка інша: перелік звужується правами користувача, від
 * імені якого працює агент, а відмовляє рантайм. Своєї перевірки тут немає й
 * не має бути.
 *
 * Схеми написані руками, і це не виняток із D4 («опис генерується зі схем»):
 * генерувати нема з чого — TypeBox-схеми у моделі ядра немає, бо немає й
 * екранів. Обидві схеми — три поля, і живуть вони поруч із SQL, який їх читає.
 */
import type { AgentModelRoute } from "./agent-routes.ts";

/** JSON Schema payload-ів команд ядра. Ключ той самий: `"<модель>.<команда>"`. */
export const coreAgentToolSchemas: Record<string, unknown> = {
  "attachment.list": {
    type: "object",
    properties: {
      ownerModel: {
        type: "string",
        description: "Модель-власник запису: invoice, counterparty…",
      },
      ownerId: { type: "string", description: "ID запису-власника" },
    },
    required: ["ownerModel", "ownerId"],
  },
  "attachment.get": {
    type: "object",
    properties: { id: { type: "string", description: "ID вкладення" } },
    required: ["id"],
  },
  "job.list": {
    type: "object",
    properties: {
      filters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Модель, чиї завдання цікавлять" },
          state: {
            type: "string",
            description: "queued | running | done | failed | cancelled",
          },
          activeOnly: {
            type: "boolean",
            description: "Лише ті, що в черзі або виконуються",
          },
        },
      },
    },
  },
  "job.get": {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "ID завдання — його віддала команда, яку ти запустив. Коли state стане " +
          "done, у result лежить звичайний конверт відповіді цієї команди",
      },
    },
    required: ["id"],
  },
  "agent_note.propose": {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "Домовленість ЦЬОГО підприємства, одним реченням. Те, що правда й на іншому " +
          "підприємстві, сюди не пишеться: загальну методологію ти й так знаєш, а пам'ятка " +
          "лежить у контексті кожної розмови й тим дорога",
      },
      model: {
        type: "string",
        description:
          "Модель, якої це стосується. Без неї записка про всю базу — так і треба, " +
          "коли домовленість не про один документ",
      },
      kind: {
        type: "string",
        enum: ["note", "topic"],
        description:
          "note (умовчання) — одна думка, вона лежить у контексті завжди й тому мусить " +
          "бути короткою. topic — процедура на сторінку-другу («Порядок закриття місяця»): " +
          "завжди лежить лише покажчик, тіло читають командою topic",
      },
      slug: { type: "string", description: "Ім'я теми латиницею: close-month. Лише для topic" },
      title: { type: "string", description: "Назва теми для людини. Лише для topic" },
      summary: {
        type: "string",
        description:
          "КОЛИ ця тема потрібна — рядок, який лежить у контексті завжди й вирішує, чи " +
          "відкриють тіло. Пиши привід, а не заголовок: «close-month» у голові нічого не " +
          "запускає, «що робимо перед закриттям місяця й у якому порядку» — запускає. " +
          "Лише для topic",
      },
    },
    required: ["content"],
  },
  // Рішення про об'єкти джерела перенесення. Агент читає й ПРОПОНУЄ;
  // `confirm` і `delete` сюди не входять і токену не дістаються взагалі
  // (`HUMAN_ONLY_COMMANDS` у рантаймі): підтверджене рішення — єдине в
  // перенесенні, що створила людина.
  "source_decision.list": {
    type: "object",
    properties: {
      filters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Джерело: bas, excel…" },
          kind: {
            type: "string",
            description: "Вид об'єкта в термінах ДЖЕРЕЛА: «Справочник.Контрагенты»",
          },
          ref: { type: "string", description: "Ключ одного об'єкта джерела (GUID)" },
          state: { type: "string", enum: ["proposed", "confirmed"] },
          decision: {
            type: "object",
            description:
              "Відбір за входженням: {\"bucket\": \"skip\"} знайде всі рішення, що " +
              "кладуть об'єкт у цей кошик",
          },
        },
      },
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 500 },
    },
  },
  "source_decision.get": {
    type: "object",
    properties: {
      id: { type: "string", description: "ID рішення" },
      source: { type: "string" },
      kind: { type: "string" },
      ref: { type: "string" },
    },
    description: "За id або за ключем об'єкта джерела (source + kind + ref).",
  },
  "source_decision.propose": {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            source: { type: "string", maxLength: 50 },
            kind: { type: "string", description: "«Справочник.Контрагенты»" },
            ref: { type: "string", description: "Ключ об'єкта в джерелі (GUID)" },
            decision: {
              type: "object",
              description:
                "Зміст рішення. Форму задає застосунок разом із правилами " +
                "конвертації — спитай пам'ятку бази, якщо вона не названа",
            },
            reason: {
              type: "string",
              description: "Чому саме так. Без доводу (свого чи загального) пункт не приймається",
            },
          },
          required: ["source", "kind", "ref", "decision"],
        },
      },
      reason: {
        type: "string",
        description: "Довід для пунктів, у яких немає власного",
      },
    },
    required: ["items"],
    description:
      "Записати ПРОПОЗИЦІЮ: стан завжди proposed, застосовується лише після підтвердження " +
      "людиною. Уже підтверджене не переписується — воно повертається в skipped. Пачка " +
      "атомарна: зіпсований пункт відбиває всю пачку.",
  },
  "agent_note.topic": {
    type: "object",
    properties: {
      slug: { type: "string", description: "Ім'я теми з покажчика: close-month" },
    },
    required: ["slug"],
    description:
      "Тіло теми — порядок дій на ЦЬОМУ підприємстві. Кликати тоді, коли задача збіглася " +
      "з рядком покажчика, а не про всяк випадок.",
  },
};

/**
 * Маршрути тих самих моделей.
 *
 * Шляхів немає навмисно: екрана у вкладення не буде — воно показується всередині
 * форми власника, тож посилання «відкрий вкладення» вело б у нікуди. `type`
 * названий `system`, щоб агент бачив, що це не довідник і не документ.
 */
export const coreAgentRoutes: Record<string, AgentModelRoute> = {
  attachment: {
    type: "system",
    titles: { uk: "Вкладення", en: "Attachments" },
    aliases: ["вкладення", "прикріплений файл", "скан", "attachment"],
  },
  agent_note: {
    type: "system",
    titles: { uk: "Пам'ятка бази", en: "Base memo" },
    aliases: ["пам'ятка", "домовленість", "як у нас прийнято", "memo"],
  },
  // Рішення перенесення: «ці три GUID — один контрагент», «не переносити».
  // Шляху немає — екран належить застосунку, якщо він його має.
  source_decision: {
    type: "system",
    titles: { uk: "Рішення перенесення", en: "Import decisions" },
    aliases: ["рішення перенесення", "розкладка", "кошик", "відповідність об'єктів"],
  },
  // Довге завдання. Без цього маршруту агент, який запустив довгу команду,
  // дізнатися її результат не може НІЯК: у відповідь він дістав id завдання, а
  // спитати про нього нема чим. Тобто сама можливість запустити таку команду
  // від імені агента була б беззмістовною.
  //
  // Тільки читання. `cancel` сюди не входить свідомо: зупинити чужу роботу —
  // дія, яку робить людина, що бачить екран, а не крок, зроблений «щоб
  // подивитися». Знадобиться — це окреме рішення, а не дописаний рядок.
  job: {
    type: "system",
    titles: { uk: "Завдання", en: "Jobs" },
    aliases: ["завдання", "фонове завдання", "job"],
  },
};

/**
 * Право нестандартної команди моделі ЯДРА.
 *
 * Стандартні імена (`list`, `get`) рантайм виводить сам, а `propose` не
 * виведе — і оголосити його нема де: `commands.access` живе в манифесті, а в
 * моделі ядра манифеста немає. Доти це означало, що модель ядра взагалі не
 * може мати команди з власним іменем: рантайм відмовляв би 501, свідомо
 * fail-closed.
 *
 * `create`, а не `authenticated`: пропозиція пише рядок у базу. Непідтверджена
 * записка нікому не видима й тим майже нешкідлива — але «майже» тут не привід
 * пускати в запис токен «тільки читання».
 */
export const coreModelAccess: Record<string, string> = {
  "agent_note.propose": "create",
  // Читання теми — читання: право те саме, що в будь-якого перегляду, і токен
  // «тільки читання» його має.
  "agent_note.topic": "view",

  // Завдання (`app.job`) своїх прав не роздає: запустити довгу команду можна
  // лише маючи право на САМУ команду, а дивитися на результат має той, хто її
  // запустив. Тому `authenticated` — «досить бути собою», а чиє це завдання,
  // вирішує вже SQL (`app.job_may_see`). Окреме право `job:view` існує й дає
  // бачити чужі завдання — його видають адміністраторові.
  "job.get": "authenticated",
  "job.list": "authenticated",
  // Зняття — теж своє: чуже завдання зніме той, кому видали `job:view`, і
  // перевіряє це та сама функція.
  "job.cancel": "authenticated",

  // Перенесення — робота адміністративна, тож права тут звичайні, модельні:
  // `import_session:view` / `:edit` / `:delete`. Видимість «своє/чуже» сюди не
  // заводимо навмисно — сесію заводить впроваджувач, а дивиться на неї той,
  // кому дали право на цю модель.
  "import_session.close": "edit",
  "import_session.volume": "view",
  // Знесення сировини — `delete`, і це найсильніше право моделі: команда
  // незворотна й зносить сотні тисяч рядків.
  "import_session.purge": "delete",

  // Рішення. `propose` — `create`: пише рядок, тож токен «тільки читання» його
  // не має. `confirm` — `edit` людини; токену він відмовляє незалежно від прав
  // (див. `HUMAN_ONLY_COMMANDS`). `list`/`get`/`delete` виводяться з імені.
  "source_decision.propose": "create",
  "source_decision.confirm": "edit",
};
