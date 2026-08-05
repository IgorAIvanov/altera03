import { dirname, join, relative, resolve, SEPARATOR } from "@std/path";

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
   * Політика аудиту моделі. `true` пише всі команди, об'єкт — лише перелічені;
   * відсутність блоку не створює записів аудиту.
   */
  audit?: boolean | {
    commands?: string[];
  };
  /**
   * Друковані форми моделі. Сам блок читає `sql:assemble` (сеє шаблони в БД);
   * тут його наявність — ознака «модель друкується», з якої виводиться
   * TS-команда `printPdf`.
   */
  prints?: Record<string, unknown>;
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
    const sqlCommands = manifest.commands?.sql ?? {};
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

    const accessEntries = Object.entries(access)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([commandName, action]) => `    ${JSON.stringify(commandName)}: ${JSON.stringify(action)}`);

    const modelTypeLine = manifest.type ? `    type: ${JSON.stringify(manifest.type)}` : null;
    const modelSchemaLine = manifest.schema ? `    schema: ${JSON.stringify(manifest.schema)}` : null;
    const audit = manifest.audit;
    const modelAuditLine = audit === true
      ? "    audit: true"
      : audit && Array.isArray(audit.commands)
      ? `    audit: { commands: ${JSON.stringify(audit.commands)} }`
      : null;
    const bodyParts = [
      modelTypeLine,
      modelSchemaLine,
      modelAuditLine,
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

function renderAgentRoutesMulti(manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>, appDirs: string[]) {
  return renderAgentRoutes(manifests, appDirs[0]!, appDirs);
}

function renderAgentRoutes(manifests: Array<{ manifestPath: string; manifest: ManifestRecord }>, appDir: string, appDirs?: string[]) {
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

async function collectManifests(appDir: string) {
  const manifests: Array<{ manifestPath: string; manifest: ManifestRecord }> = [];

  const visitDirectory = async (directoryPath: string) => {
    const manifestPath = join(directoryPath, "manifest.json");
    try {
      const raw = await Deno.readTextFile(manifestPath);
      const manifest = JSON.parse(raw) as ManifestRecord;
      if (manifest.schema !== undefined && !IDENTIFIER_PATTERN.test(manifest.schema)) {
        throw new Error(`Manifest schema must be a lowercase SQL identifier: ${toPosixPath(relative(Deno.cwd(), manifestPath))}`);
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

  const writeRegistry = async () => {
    const allManifests = (await Promise.all(appDirs.map(collectManifests))).flat();
    allManifests.sort((left, right) => (left.manifest.model ?? "").localeCompare(right.manifest.model ?? ""));

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

    await Deno.mkdir(dirname(outputPath), { recursive: true });
    await Deno.writeTextFile(outputPath, `${registrySource}\n`);

    const headerImports = tsBindings.imports.join("\n");
    const tsCommandsSource = `${headerImports ? `${headerImports}\n\n` : ""}` +
      `// Generated from model manifests. Do not edit manually.\n` +
      `// Серверний бік реєстру: тут статичні import модулів TS-команд, тому цей\n` +
      `// файл імпортує ТІЛЬКИ app/server.ts. Клієнт бере дані з model-registry.\n\n` +
      `${tsBindings.block}`;

    await Deno.mkdir(dirname(tsCommandsPath), { recursive: true });
    await Deno.writeTextFile(tsCommandsPath, `${tsCommandsSource}\n`);

    // For agent routes, use the first appDir as base for route path computation
    // Each manifest's route is computed relative to its own source appDir
    const agentRoutesSource = `// Generated from model manifests. Do not edit manually.\n\n${renderAgentRoutesMulti(allManifests, appDirs)}`;
    await Deno.mkdir(dirname(agentRoutesPath), { recursive: true });
    await Deno.writeTextFile(agentRoutesPath, `${agentRoutesSource}\n`);

    // View-manifest: route → moduleFile (відносно кореня репо) → titleKey
    const viewManifestSource = `// Generated from model manifests. Do not edit manually.\n\n${renderViewManifest(allManifests, appDirs)}`;
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