import { dirname, join, relative, resolve, SEPARATOR } from "@std/path";
import { buildAgentToolsForModel, renderAgentTools } from "./agent-tool-schemas.ts";
import { documentHeaderSpecifier } from "./generate-model-sql.ts";

type ManifestSqlCommand = string | {
  schema?: string;
  functionName?: string;
  validate?: {
    requiredStringFields?: string[];
  };
};

type ManifestTsCommand = {
  /** Шлях до TS-файлу команди відносно каталогу моделі (поряд із SQL). */
  module?: string;
  /** Імʼя експорту в module-файлі. За замовчуванням "default". */
  export?: string;
  /**
   * Альтернатива `module` — ключ готового рантайм-хендлера ядра,
   * напр. `"runtime.printPdf"`. Застосунок не знає шляхів усередині server/:
   * ключ резолвиться реєстром (`server/modules/model-runtime/model-registry.ts`).
   */
  handlerKey?: string;
};

type ManifestRecord = {
  model?: string;
  type?: string;
  schema?: string;
  /**
   * Застарілий блок політики аудиту. Більше не читається: рівень журналу — це
   * налаштування установки (`app.audit_setting`), яке правлять на екрані
   * `admin/audit_setting`, а не властивість рішення. Лишився в типі, щоб
   * генератор міг сказати про нього вголос, а не мовчки проковтнути.
   */
  audit?: unknown;
  /**
   * Друковані форми моделі. Сам блок читає `sql:assemble` (сеє шаблони в БД);
   * тут його наявність — ознака «модель друкується», з якої виводиться
   * TS-команда `printPdf`.
   */
  prints?: Record<string, unknown>;
  /**
   * Періодичні дані. Блок читає `sql:gen` (він генерує `_at`/`_history`/`_set`);
   * тут його наявність — ознака «ці три команди є», з якої виводяться права.
   */
  periodic?: unknown;
  commands?: {
    sql?: Record<string, ManifestSqlCommand>;
    ts?: Record<string, ManifestTsCommand>;
    /**
     * Право нестандартної команди: дія (`view`/`create`/`edit`/`delete`/
     * `post`/`unpost`) або `"authenticated"`. Стандартні команди тут не
     * потрібні — рантайм виводить їхню дію з імені. Неоголошена нестандартна
     * команда не виконується взагалі (fail-closed).
     */
    access?: Record<string, string>;
  };
  views?: Record<string, { module: string; titleKey?: string }>;
  agent?: {
    allow?: boolean;
    allowCommands?: string[];
    aliases?: string[];
    priority?: number;
  };
};

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Команди, які модель віддає агенту.
 *
 * Умовчання — стандартна п'ятірка плюс проведення для документів; це рівно те,
 * що пропускає `AgentService`. `manifest.agent` звужує: `allow: false` знімає
 * модель цілком, `allowCommands` лишає перелічене.
 */
/** `DocumentHeaderSchema` фреймворку — спільна шапка всіх документів. */
async function loadDocumentHeaderSchema(appDir: string): Promise<Record<string, unknown> | null> {
  try {
    const specifier = await documentHeaderSpecifier(appDir);
    const mod = await import(specifier) as Record<string, unknown>;
    const header = mod.DocumentHeaderSchema;
    return header && typeof header === "object" ? header as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Команди типу моделі, які має сенс показувати агенту.
 *
 * Набір саме за типом, а не «п'ятірка всім»: описати admin-екрану стандартний
 * CRUD означало б показати інструменти, які повернуть 501. Мовчання чесніше за
 * опис навмання — тому невідомий тип не дає нічого.
 *
 * Звіт віддає свій `index`, і він тут не з міркувань повноти: агентська робота
 * починається з того, щоб ПОДИВИТИСЯ. Звірка виписки, питання «скільки винні
 * цьому контрагенту», перевірка перед проведенням — усе це читання регістру, а
 * не запис. Доти агент умів створити й провести документ, але не міг подивитися
 * оборотку, тобто мав рівно протилежний до потрібного набір.
 */
function agentBaseCommands(type: string): string[] {
  if (type === "report") return ["index"];
  // Регістр не має підбору — у нього нема чого підбирати.
  if (type === "register") return ["list", "get", "save", "delete"];
  if (type === "catalog") return ["list", "get", "save", "delete", "lookup"];
  if (type === "document") return ["list", "get", "save", "delete", "lookup", "post", "unpost"];
  return [];
}

function agentCommandsFor(manifest: ManifestRecord): string[] {
  const agent = manifest.agent ?? {};
  if (agent.allow === false) return [];

  const base = agentBaseCommands(manifest.type ?? "catalog");

  if (Array.isArray(agent.allowCommands)) {
    return base.filter((command) => agent.allowCommands!.includes(command));
  }
  return base;
}

function toPosixPath(value: string) {
  return value.split(SEPARATOR).join("/");
}

function createRequiredStringValidatorSource(fields: string[], commandName: string) {
  const checks = fields.map((field) => `
    if (typeof payload.${field} !== "string" || payload.${field}.trim() === "") {
      return ${JSON.stringify(`${field} обов'язковий для ${commandName}`)};
    }
  `).join("");

  return `(payload: Record<string, unknown>) => {${checks}
    return null;
  }`;
}

function renderSqlCommandConfig(commandName: string, definition: ManifestSqlCommand) {
  if (typeof definition === "string") {
    return JSON.stringify(definition);
  }

  const parts: string[] = [];
  if (definition.schema) {
    parts.push(`schema: ${JSON.stringify(definition.schema)}`);
  }
  if (definition.functionName) {
    parts.push(`functionName: ${JSON.stringify(definition.functionName)}`);
  }

  const requiredStringFields = definition.validate?.requiredStringFields;
  if (Array.isArray(requiredStringFields) && requiredStringFields.length > 0) {
    parts.push(`validate: ${createRequiredStringValidatorSource(requiredStringFields, commandName)}`);
  }

  return `{ ${parts.join(", ")} }`;
}

function renderModelRegistry(manifests: Array<{ manifest: ManifestRecord }>) {
  const entries = manifests.flatMap(({ manifest }) => {
    // Періодичні команди рантайм сам не виводить: авто-маршрут є лише в
    // стандартної п'ятірки й у команд документа. Оголошуємо їх ТУТ, з того
    // самого блока `periodic`, з якого `sql:gen` створює самі функції — інакше
    // застосунок мусив би переписувати в манифест те, що вже там сказано, і
    // забута трійка виглядала б як «команди немає» на першому виклику.
    const periodicCommands = manifest.periodic
      ? { at: {}, history: {}, set: {} } as Record<string, ManifestSqlCommand>
      : {};
    const sqlCommands = { ...periodicCommands, ...manifest.commands?.sql };
    const sqlCommandEntries = Object.entries(sqlCommands)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([commandName, definition]) => `    ${JSON.stringify(commandName)}: ${renderSqlCommandConfig(commandName, definition)}`);

    // `printPdf` виводиться з непорожнього `prints` так само, як і сам хендлер,
    // тож і право їй виводиться тут: друк — це перегляд. Явне оголошення в
    // манифесті це перекриває.
    const access: Record<string, string> = { ...manifest.commands?.access };
    if (Object.keys(manifest.prints ?? {}).length > 0 && !access.printPdf) {
      access.printPdf = "view";
    }

    // Періодичні команди генерує `sql:gen` з того самого блока `periodic`, тож
    // і право їм виводиться звідти: `_at`/`_history` — читання, `_set` — запис.
    // Вимагати повторного оголошення в `commands.access` означало б лишити
    // рантайму 501 на команді, яку сам же фреймворк і створив. Явне оголошення
    // в манифесті це перекриває.
    if (manifest.periodic) {
      if (!access.at) access.at = "view";
      if (!access.history) access.history = "view";
      if (!access.set) access.set = "edit";
    }

    const accessEntries = Object.entries(access)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([commandName, action]) => `    ${JSON.stringify(commandName)}: ${JSON.stringify(action)}`);

    const modelTypeLine = manifest.type ? `    type: ${JSON.stringify(manifest.type)}` : null;
    const modelSchemaLine = manifest.schema ? `    schema: ${JSON.stringify(manifest.schema)}` : null;
    const bodyParts = [
      modelTypeLine,
      modelSchemaLine,
      sqlCommandEntries.length ? `    sqlCommands: {\n${sqlCommandEntries.join(",\n")}\n    }` : null,
      accessEntries.length ? `    access: {\n${accessEntries.join(",\n")}\n    }` : null,
    ]
      .filter((value): value is string => Boolean(value));

    if (!bodyParts.length || !manifest.model) {
      return [];
    }

    return [`  ${JSON.stringify(manifest.model)}: {\n${bodyParts.join(",\n")}\n  }`];
  });

  return `export const generatedModelRegistry = {\n${entries.join(",\n")}\n};\n`;
}

function resolveAppDirForManifest(manifestPath: string, appDirs: string[]): string {
  for (const appDir of appDirs) {
    if (manifestPath.startsWith(appDir)) return appDir;
  }
  return appDirs[0]!;
}

/**
 * Ім'я моделі — ГЛОБАЛЬНИЙ ідентифікатор, а не назва в межах теки: під ним
 * лежать SQL-функції однієї схеми (`app.bank_list`), рядки прав («група →
 * модель → дія») і записи аудиту. Тому воно й не має префікса родини — родина
 * їде окремим полем (`type`, `route`), а ім'я лишається сталим, навіть коли
 * модель переїде з довідників у регістри.
 *
 * Ціна цього рішення — обов'язок перевірити унікальність тут: доти два
 * манифести з однаковим `model` мовчки перетирали один одного в реєстрі, а
 * зіткнення вилазило аж при публікації SQL. Або не вилазило зовсім, і
 * застосунок працював не з тією моделлю, з якою здавалося.
 */
export function assertUniqueModels(
  manifests: Array<{ manifestPath: string; manifest: { model?: string } }>,
): void {
  const firstSeen = new Map<string, string>();
  const clashes: string[] = [];

  for (const { manifestPath, manifest } of manifests) {
    const model = manifest.model;
    if (!model) continue;

    const first = firstSeen.get(model);
    if (first) {
      clashes.push(
        `  '${model}': ${toPosixPath(relative(Deno.cwd(), first))} ↔ ` +
          toPosixPath(relative(Deno.cwd(), manifestPath)),
      );
    } else {
      firstSeen.set(model, manifestPath);
    }
  }

  if (clashes.length > 0) {
    throw new Error(
      `Ім'я моделі мусить бути унікальним на весь застосунок — під ним лежать ` +
        `SQL-функції, права й аудит:\n${clashes.join("\n")}`,
    );
  }
}

/**
 * Словники застосунку — щоб агент бачив не лише `nomenclature`, а й
 * «Номенклатура».
 *
 * Беруться зі ЗБІРКИ локалей (`deno task locales:build`), тобто того самого
 * джерела, з якого їх читає екран. Немає збірки — немає назв, і це не помилка:
 * реєстр генерують і до першої збірки локалей.
 */
async function loadLocaleDictionaries(appDirs: string[]): Promise<Record<string, Record<string, string>>> {
  const dictionaries: Record<string, Record<string, string>> = {};

  for (const appDir of appDirs) {
    const localesDir = join(appDir, "_locales");
    let locales: string[];
    try {
      const index = JSON.parse(await Deno.readTextFile(join(localesDir, "_index.json")));
      locales = Array.isArray(index?.locales) ? index.locales : [];
    } catch {
      continue;
    }

    for (const locale of locales) {
      try {
        const dictionary = JSON.parse(await Deno.readTextFile(join(localesDir, `${locale}.json`)));
        dictionaries[locale] = { ...dictionaries[locale], ...dictionary };
      } catch {
        // Мови немає у зборі — решта лишається чинною.
      }
    }
  }

  return dictionaries;
}

/**
 * Назва моделі всіма мовами, які має застосунок.
 *
 * Саме всіма, а не однією: мову називає застосунок, і фреймворку не годиться
 * вибирати за нього — тим паче що агент і людина можуть розмовляти різними.
 * Ключ беремо зі списку (`titleMany` — «Банки»), бо каталог перелічує моделі, а
 * не записи.
 */
function titlesFor(
  manifest: ManifestRecord,
  dictionaries: Record<string, Record<string, string>>,
): Record<string, string> | null {
  const key = manifest.views?.list?.titleKey ?? manifest.views?.edit?.titleKey;
  if (!key) return null;

  const titles: Record<string, string> = {};
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    const text = dictionary[key];
    if (typeof text === "string" && text.trim() !== "") titles[locale] = text;
  }

  return Object.keys(titles).length > 0 ? titles : null;
}

function renderAgentRoutesMulti(
  manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>,
  appDirs: string[],
  dictionaries: Record<string, Record<string, string>> = {},
) {
  return renderAgentRoutes(manifests, appDirs[0]!, appDirs, dictionaries);
}

function renderAgentRoutes(
  manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>,
  appDir: string,
  appDirs?: string[],
  dictionaries: Record<string, Record<string, string>> = {},
) {
  const entries = manifests.flatMap(({ manifestPath, manifest }) => {
    if (!manifest.model) return [];
    const effectiveAppDir = appDirs ? resolveAppDirForManifest(manifestPath, appDirs) : appDir;
    const rel = toPosixPath(relative(effectiveAppDir, dirname(manifestPath)));
    const hasEdit = manifest.views && "edit" in manifest.views;
    const hasList = manifest.views && "list" in manifest.views;
    const editPath = hasEdit ? `/${rel}/edit` : null;
    const listPath = hasList ? `/${rel}/list` : null;
    if (!editPath && !listPath) return [];
    const parts: string[] = [];
    if (editPath) parts.push(`    editPath: ${JSON.stringify(editPath)}`);
    if (listPath) parts.push(`    listPath: ${JSON.stringify(listPath)}`);
    parts.push(`    type: ${JSON.stringify(manifest.type ?? "catalog")}`);
    
    // Add agent metadata
    const agentMeta = manifest.agent ?? {};
    if (typeof agentMeta.allow === "boolean") {
      parts.push(`    allow: ${agentMeta.allow}`);
    }
    if (Array.isArray(agentMeta.allowCommands)) {
      parts.push(`    allowCommands: ${JSON.stringify(agentMeta.allowCommands)}`);
    }
    if (agentMeta.aliases && agentMeta.aliases.length > 0) {
      parts.push(`    aliases: ${JSON.stringify(agentMeta.aliases)}`);
    }
    if (typeof agentMeta.priority === "number") {
      parts.push(`    priority: ${agentMeta.priority}`);
    }
    const titles = titlesFor(manifest, dictionaries);
    if (titles) {
      parts.push(`    titles: ${JSON.stringify(titles)}`);
    }

    return [`  ${JSON.stringify(manifest.model)}: {\n${parts.join(",\n")}\n  }`];
  });

  return `export const agentModelRoutes = {\n${entries.join(",\n")}\n};\n`;
}

function renderViewManifest(
  manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>,
  appDirs: string[],
) {
  const entries = manifests.flatMap(({ manifestPath, manifest }) => {
    if (!manifest.model || !manifest.views) return [];
    const modelDir = dirname(manifestPath);
    const appDir = resolveAppDirForManifest(manifestPath, appDirs);
    const routeBase = toPosixPath(relative(appDir, modelDir));

    return Object.entries(manifest.views).map(([viewName, view]) => {
      const route = `${routeBase}/${viewName}`;
      // Промах у формі запису називаємо разом із манифестом і ключем: далі шлях
      // іде в `resolve()`, і той скаже лише «Path must be a string».
      if (!view || typeof view !== "object" || typeof view.module !== "string") {
        throw new Error(
          `${toPosixPath(relative(Deno.cwd(), manifestPath))}: в'ю «${viewName}» має бути ` +
            `{ "module": "./…", "titleKey": "…" }`,
        );
      }
      const moduleAbs = resolve(modelDir, view.module);
      // moduleFile — відносно кореня репо, .tsx нормалізуємо в .ts (як у model-view)
      const moduleFile = toPosixPath(relative(Deno.cwd(), moduleAbs)).replace(/\.tsx?$/, ".ts");
      const parts = [`route: ${JSON.stringify(route)}`, `moduleFile: ${JSON.stringify(moduleFile)}`];
      if (view.titleKey) parts.push(`titleKey: ${JSON.stringify(view.titleKey)}`);
      return `  { ${parts.join(", ")} }`;
    });
  });

  return `export const viewManifest = [\n${entries.join(",\n")}\n];\n`;
}


function sanitizeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function toModuleSpecifier(outputPath: string, manifestPath: string, modulePath: string) {
  const moduleAbs = resolve(dirname(manifestPath), modulePath);
  let specifier = toPosixPath(relative(dirname(outputPath), moduleAbs));
  if (!specifier.startsWith(".")) {
    specifier = `./${specifier}`;
  }
  return specifier;
}

function renderTsBindings(
  manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>,
  outputPath: string,
): { imports: string[]; block: string } {
  const imports: string[] = [];
  const bindings: string[] = [];

  for (const { manifestPath, manifest } of manifests) {
    const tsCommands = Object.entries(manifest.commands?.ts ?? {})
      .sort(([left], [right]) => left.localeCompare(right));

    // Модель із блоком `prints` друкується — команду друку виводимо з нього,
    // щоб маніфест не повторював те, що вже сказав. Явне оголошення в
    // commands.ts лишається можливим: воно перекриває хендлер ядра.
    if (Object.keys(manifest.prints ?? {}).length > 0 && !manifest.commands?.ts?.printPdf) {
      tsCommands.push(["printPdf", { handlerKey: "runtime.printPdf" }]);
    }

    for (const [command, definition] of tsCommands) {
      if (definition.handlerKey) {
        // Хендлер ядра: імпорту немає, реєстр резолвить ключ у рантаймі.
        bindings.push(
          `  { model: ${JSON.stringify(manifest.model)}, command: ${JSON.stringify(command)}, handlerKey: ${JSON.stringify(definition.handlerKey)} }`,
        );
        continue;
      }

      if (!definition.module) {
        throw new Error(`TS command '${manifest.model}.${command}' must declare 'module' or 'handlerKey'`);
      }

      const ident = `ts_${sanitizeIdentifier(manifest.model ?? "")}_${sanitizeIdentifier(command)}`;
      const specifier = toModuleSpecifier(outputPath, manifestPath, definition.module);
      const exportName = definition.export ?? "default";
      imports.push(
        exportName === "default"
          ? `import ${ident} from ${JSON.stringify(specifier)};`
          : `import { ${exportName} as ${ident} } from ${JSON.stringify(specifier)};`,
      );
      bindings.push(
        `  { model: ${JSON.stringify(manifest.model)}, command: ${JSON.stringify(command)}, handler: ${ident} }`,
      );
    }
  }

  const block = `export const generatedTsCommandBindings = [\n${bindings.join(",\n")}\n];\n`;

  return { imports, block };
}

/**
 * Ключі-коментарі (`"//picker": "…"`) — домовленість усього репозиторію: у JSON
 * коментарів немає, а пояснити рядок треба. Генератор про неї не знав і обходив
 * ключі `views` підряд, тож на коментарі діставав рядок замість опису в'ю й
 * падав із `Path must be a string, received "undefined"` — повідомленням, яке
 * не називає ні манифеста, ні ключа.
 *
 * Прибираємо при читанні, а не в кожному обході: інакше коментар у `views` не
 * ламав би нічого, а той самий коментар у `commands.sql` тихо став би командою
 * з іменем «//…» у реєстрі.
 */
export function stripCommentKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCommentKeys);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("//"))
      .map(([key, nested]) => [key, stripCommentKeys(nested)]),
  );
}

async function collectManifests(appDir: string) {
  const manifests: Array<{ manifestPath: string; manifest: ManifestRecord }> = [];

  const visitDirectory = async (directoryPath: string) => {
    const manifestPath = join(directoryPath, "manifest.json");
    try {
      const raw = await Deno.readTextFile(manifestPath);
      const manifest = stripCommentKeys(JSON.parse(raw)) as ManifestRecord;
      if (manifest.schema !== undefined && !IDENTIFIER_PATTERN.test(manifest.schema)) {
        throw new Error(`Manifest schema must be a lowercase SQL identifier: ${toPosixPath(relative(Deno.cwd(), manifestPath))}`);
      }
      // Політика журналу переїхала в базу (`app.audit_setting`, екран
      // `admin/audit_setting`). Мовчки проковтнути залишений блок не можна:
      // модель виглядала б журнальованою, а журнал би не писався — і побачив
      // би це лише той, хто піде його шукати після події.
      if (manifest.audit !== undefined) {
        console.warn(
          `⚠ ${toPosixPath(relative(Deno.cwd(), manifestPath))}: блок "audit" більше не читається — ` +
            `рівень журналу задається на екрані «Налаштування журналу» (app.audit_setting). Приберіть його з манифеста.`,
        );
      }

      if (typeof manifest.model === "string" && manifest.model.trim()) {
        manifests.push({ manifestPath, manifest });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    for await (const entry of Deno.readDir(directoryPath)) {
      if (!entry.isDirectory || entry.name.startsWith("_")) {
        continue;
      }

      await visitDirectory(join(directoryPath, entry.name));
    }
  };

  await visitDirectory(appDir);

  manifests.sort((left, right) => (left.manifest.model ?? "").localeCompare(right.manifest.model ?? ""));
  return manifests;
}

/**
 * Ключі моделей застосунку — усе, що оголосило себе в `manifest.json`.
 *
 * Той самий обхід, що будує реєстр, а не перелік із `sql.json`: у `sql.json`
 * лежать моделі, які везуть СВІЙ SQL, і моделі без нього туди не потрапляють
 * (`admin/user` живе на функціях ядра, звіти власних таблиць не мають). Для
 * налаштувань журналу потрібні саме ті моделі, що доходять до рантайму, — тобто
 * реєстрові.
 */
export async function collectAppModelKeys(appDirArg = "./app"): Promise<string[]> {
  const manifests = await collectManifests(resolve(Deno.cwd(), appDirArg));
  const keys = new Set(manifests.map(({ manifest }) => manifest.model!.trim()).filter(Boolean));
  return [...keys].sort((left, right) => left.localeCompare(right));
}

export async function generateModelRuntimeRegistry(
  appDirArgs: string | string[] = "./app",
  outputPathArg = "./app/_generated/model-registry.generated.ts",
  agentRoutesPathArg = "./app/_generated/agent-routes.generated.ts",
  viewManifestPathArg = "./app/_generated/view-manifest.generated.ts",
  options?: { watch?: boolean; verbose?: boolean },
) {
  const watchMode = options?.watch ?? false;
  const verboseMode = options?.verbose ?? false;
  const appDirs = (Array.isArray(appDirArgs) ? appDirArgs : [appDirArgs])
    .map((d) => resolve(Deno.cwd(), d));
  const outputPath = resolve(Deno.cwd(), outputPathArg);
  const agentRoutesPath = resolve(Deno.cwd(), agentRoutesPathArg);
  const viewManifestPath = resolve(Deno.cwd(), viewManifestPathArg);
  // Шлях виводиться з реєстру, а не приймається аргументом: рядки задач у
  // застосунках пінені за версією інструмента, і четвертий позиційний аргумент
  // означав би, що кожен застосунок мусить його дописати, інакше файл мовчки
  // не з'явиться. Ім'я фіксоване, сусідом реєстру.
  const tsCommandsPath = join(dirname(outputPath), "ts-commands.generated.ts");
  // Те саме міркування, що й для ts-commands: ім'я фіксоване, сусідом реєстру.
  const agentToolsPath = join(dirname(outputPath), "agent-tools.generated.ts");

  const writeRegistry = async () => {
    const allManifests = (await Promise.all(appDirs.map(collectManifests))).flat();
    allManifests.sort((left, right) => (left.manifest.model ?? "").localeCompare(right.manifest.model ?? ""));

    // До будь-якої генерації: далі все ключується іменем моделі, тож дублікат
    // тихо переміг би останнім записом.
    assertUniqueModels(allManifests);

    // Реєстр — ЧИСТІ ДАНІ, окремо від прив'язок TS-команд, і це не косметика.
    // Реєстр читає не лише сервер: екран admin/user_group бере з нього перелік
    // моделей для прав. Поки статичні `import` модулів TS-команд лежали в тому
    // самому файлі, кожна серверна команда їхала у бандл КЛІЄНТА разом із усім,
    // що вона імпортує. У монорепо це проявлялося як 23 «Decorators are not
    // valid here» (через барель @altera/server), а у встановленому застосунку —
    // як «Rolldown failed to resolve import "@altera/server/password"»:
    // підшляхи пакета резолвить Deno, але не бандлер. Обидва рази винен був не
    // імпорт, а те, що дані й код лежали в одному файлі.
    const tsBindings = renderTsBindings(allManifests, tsCommandsPath);
    const registrySource = `// Generated from model manifests. Do not edit manually.\n\n${renderModelRegistry(allManifests)}`;

    const headerImports = tsBindings.imports.join("\n");
    const tsCommandsSource = `${headerImports ? `${headerImports}\n\n` : ""}` +
      `// Generated from model manifests. Do not edit manually.\n` +
      `// Серверний бік реєстру: тут статичні import модулів TS-команд, тому цей\n` +
      `// файл імпортує ТІЛЬКИ app/server.ts. Клієнт бере дані з model-registry.\n\n` +
      `${tsBindings.block}`;

    // For agent routes, use the first appDir as base for route path computation
    // Each manifest's route is computed relative to its own source appDir
    // Назви моделей людською мовою — з зібраних локалей застосунку.
    const dictionaries = await loadLocaleDictionaries(appDirs);
    const agentRoutesSource =
      `// Generated from model manifests. Do not edit manually.\n\n${
        renderAgentRoutesMulti(allManifests, appDirs, dictionaries)
      }`;

    // Опис інструментів агента: JSON Schema payload-ів із TypeBox-схем моделей.
    // Без нього агент бачить `item` як `{type: "object"}` — тобто не знає ні
    // складу полів, ні типів, ні куди веде посилання.
    // Шапку документа резолвимо ОДИН раз і тим самим кодом, що генератор SQL:
    // у монорепо `@client/` веде на сусідній каталог, у встановленому
    // застосунку — на пакет із реєстру, і промах тут тихий (тип `document`
    // просто не згенерувався б).
    const documentHeader = await loadDocumentHeaderSchema(appDirs[0]!);

    const agentTools = (await Promise.all(
      allManifests.map(({ manifestPath, manifest }) =>
        buildAgentToolsForModel(
          manifest.model ?? "",
          join(dirname(manifestPath), `${manifest.model}.schema.ts`),
          agentCommandsFor(manifest),
          manifest.type === "document" ? documentHeader : null,
        )
      ),
    )).flat();

    const agentToolsSource = `// Generated from model schemas. Do not edit manually.
` +
      `// JSON Schema payload-ів агентських команд — див. tools/agent-tool-schemas.ts.

` +
      `${renderAgentTools(agentTools)}`;

    // View-manifest: route → moduleFile (відносно кореня репо) → titleKey
    const viewManifestSource = `// Generated from model manifests. Do not edit manually.\n\n${renderViewManifest(allManifests, appDirs)}`;

    // Записи — усі разом і аж тепер, коли впасти вже нічому. Доти помилка в
    // ОДНОМУ манифесті лишала застосунок із частково оновленою генерацією:
    // реєстр, ts-commands, agent-routes й agent-tools уже на диску, а
    // view-manifest — ні. Виглядає це як зламаний застосунок, а не як помилка
    // в манифесті, і причини в повідомленні немає.
    await Deno.mkdir(dirname(outputPath), { recursive: true });
    await Deno.writeTextFile(outputPath, `${registrySource}\n`);

    await Deno.mkdir(dirname(tsCommandsPath), { recursive: true });
    await Deno.writeTextFile(tsCommandsPath, `${tsCommandsSource}\n`);

    await Deno.mkdir(dirname(agentRoutesPath), { recursive: true });
    await Deno.writeTextFile(agentRoutesPath, `${agentRoutesSource}\n`);

    await Deno.mkdir(dirname(agentToolsPath), { recursive: true });
    await Deno.writeTextFile(agentToolsPath, `${agentToolsSource}\n`);

    await Deno.mkdir(dirname(viewManifestPath), { recursive: true });
    await Deno.writeTextFile(viewManifestPath, `${viewManifestSource}\n`);

    if (verboseMode) {
      console.log(`Generated model runtime registry: ${toPosixPath(relative(Deno.cwd(), outputPath))}`);
      console.log(`Generated TS command bindings: ${toPosixPath(relative(Deno.cwd(), tsCommandsPath))}`);
      console.log(`Generated agent routes: ${toPosixPath(relative(Deno.cwd(), agentRoutesPath))}`);
      console.log(`Generated view manifest: ${toPosixPath(relative(Deno.cwd(), viewManifestPath))}`);
    }
  };

  await writeRegistry();

  if (!watchMode) {
    return;
  }

  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRegeneration = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(() => {
      void writeRegistry().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }, 75);
  };

  for (const appDir of appDirs) {
    const watcher = Deno.watchFs(appDir);
    console.log(`Watching manifests in ${toPosixPath(relative(Deno.cwd(), appDir))}`);

    Deno.addSignalListener("SIGINT", () => {
      watcher.close();
      Deno.exit(0);
    });

    (async () => {
      for await (const event of watcher) {
        if (!event.paths.some((pathValue) => pathValue.endsWith("manifest.json"))) {
          continue;
        }
        scheduleRegeneration();
      }
    })();
  }

  await new Promise(() => {});
}

async function main() {
  const flags = Deno.args.filter((a) => a.startsWith("--"));
  const positional = Deno.args.filter((a) => !a.startsWith("--"));
  const outputArgs = positional.filter((a) => a.endsWith(".ts"));
  const appDirArgsList = positional.filter((a) => !a.endsWith(".ts"));

  const appDirsResolved = appDirArgsList.length > 0 ? appDirArgsList : ["./app"];
  const outputPathArg = outputArgs[0] ?? "./app/_generated/model-registry.generated.ts";
  const agentRoutesPathArg = outputArgs[1] ?? "./app/_generated/agent-routes.generated.ts";
  const viewManifestPathArg = outputArgs[2] ?? "./app/_generated/view-manifest.generated.ts";
  const watchMode = flags.includes("--watch");
  const verboseMode = flags.includes("--verbose");

  await generateModelRuntimeRegistry(appDirsResolved, outputPathArg, agentRoutesPathArg, viewManifestPathArg, { watch: watchMode, verbose: verboseMode });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
