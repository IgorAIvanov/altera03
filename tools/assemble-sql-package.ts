import { basename, join, relative, resolve, SEPARATOR } from "@std/path";
// Тільки SQL ядра, окремим експортом: тягнути сюди весь граф сервера (Danet,
// postgres, pdf-lib) заради текстових констант ні до чого.
import { type CoreSqlStep, getCoreSqlPackage } from "@scope/server/sql";

type PackageStep = {
  key: string;
  defaultOutput: string;
  // Список файлів-кандидатів моделі для цього кроку (у порядку підключення).
  // Відсутні файли пропускаються — усі файли необов'язкові.
  resolveFiles: (appDir: string, model: string) => Promise<string[]>;
};

const PACKAGE_STEPS: PackageStep[] = [
  {
    key: "structure",
    defaultOutput: "struc_app.sql",
    resolveFiles: (_appDir, model) => Promise.resolve([`${model}/db/struc.sql`]),
  },
  {
    key: "migrations",
    defaultOutput: "migration_app.sql",
    resolveFiles: (_appDir, model) => Promise.resolve([`${model}/db/migration.sql`]),
  },
  {
    // Порядок підключення: згенерована п'ятірка → custom-override.
    // Legacy-файл <model>.sql береться ЛИШЕ якщо генерації немає
    // (інфраструктурні пакети _sqlinit/* та ще не мігровані моделі).
    key: "models",
    defaultOutput: "models_app.sql",
    resolveFiles: async (appDir, model) => {
      const name = basename(model);
      const generated = `${model}/db/_generated/${name}.crud.gen.sql`;
      const custom = `${model}/db/${name}.custom.sql`;
      const legacy = `${model}/db/${name}.sql`;
      const files: string[] = [];
      const hasGenerated = await fileExists(join(appDir, generated));
      if (hasGenerated) files.push(generated);
      if (await fileExists(join(appDir, custom))) files.push(custom);
      if (!hasGenerated && await fileExists(join(appDir, legacy))) files.push(legacy);
      return files;
    },
  },
  {
    key: "data",
    defaultOutput: "data_app.sql",
    resolveFiles: (_appDir, model) => Promise.resolve([`${model}/db/data.sql`]),
  },
];

type SqlManifest = {
  output?: string;
  outputs?: Record<string, string>;
  models?: string[];
  order?: string[];
};

type FeaturePrintManifest = {
  templateFile: string;
  dataCommand: string;
};

type FeatureDocumentManifest = {
  name?: string;
  shortName?: string;
  prefix?: string;
  sortOrder?: number;
};

type FeatureManifest = {
  model: string;
  type?: string;
  schema?: string;
  document?: FeatureDocumentManifest;
  prints?: Record<string, FeaturePrintManifest>;
};

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const MODEL_SQL_PLACEHOLDERS = {
  schema: /\{\{schema\}\}/g,
  model: /\{\{model\}\}/g,
} as const;

type PrintTemplateSource = {
  name: string;
  paperSize?: string;
  orientation?: string;
  isDefault?: boolean;
  isActive?: boolean;
  republishOnPublish?: boolean;
  schema: unknown;
};

type CollectedPrintTemplate = {
  code: string;
  targetModel: string;
  dataCommand: string;
  relativeTemplateFile: string;
  source: PrintTemplateSource;
};

function buildSection(relativeFile: string, fileContent: string) {
  return [
    `-- >>> BEGIN ${relativeFile}`,
    fileContent.trimEnd(),
    `-- <<< END ${relativeFile}`,
    "",
  ];
}

async function writeOutputFile(outputDir: string, outputName: string, chunks: string[]) {
  const outputPath = join(outputDir, outputName);
  const finalSql = `${chunks.join("\n")}\n`;

  await Deno.writeTextFile(outputPath, finalSql);

  return outputPath;
}

function toPosixPath(value: string) {
  return value.split(SEPARATOR).join("/");
}

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlBooleanLiteral(value: boolean) {
  return value ? "true" : "false";
}

async function readManifest(appDir: string): Promise<SqlManifest> {
  const manifestPath = join(appDir, "sql.json");
  const manifestRaw = await Deno.readTextFile(manifestPath);
  return JSON.parse(manifestRaw) as SqlManifest;
}

async function readFeatureManifest(manifestPath: string): Promise<FeatureManifest> {
  const manifestRaw = await Deno.readTextFile(manifestPath);
  return JSON.parse(manifestRaw) as FeatureManifest;
}

async function resolveModelSqlContext(appDir: string, modelPath: string) {
  const manifestPath = join(appDir, modelPath, "manifest.json");
  if (!await fileExists(manifestPath)) {
    return {
      model: basename(modelPath),
      schema: "app",
    };
  }

  const featureManifest = await readFeatureManifest(manifestPath);
  return {
    model: featureManifest.model,
    schema: getModelSchema(featureManifest, manifestPath),
  };
}

function getModelSchema(manifest: FeatureManifest, manifestPath: string) {
  const schema = manifest.schema?.trim() || "app";
  if (!IDENTIFIER_PATTERN.test(schema)) {
    throw new Error(`Manifest ${manifestPath} contains invalid schema ${schema}`);
  }

  return schema;
}

function applyModelSqlPlaceholders(sqlText: string, context: { model: string; schema: string }) {
  return sqlText
    .replace(MODEL_SQL_PLACEHOLDERS.schema, context.schema)
    .replace(MODEL_SQL_PLACEHOLDERS.model, context.model);
}

async function fileExists(path: string) {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function validatePrintDefinition(manifestPath: string, printCode: string, definition: FeaturePrintManifest) {
  if (!definition || typeof definition !== "object") {
    throw new Error(`Print definition ${printCode} in ${manifestPath} must be an object.`);
  }

  if (typeof definition.templateFile !== "string" || !definition.templateFile.startsWith("./")) {
    throw new Error(`Print definition ${printCode} in ${manifestPath} must use a relative templateFile starting with './'.`);
  }

  if (typeof definition.dataCommand !== "string" || !definition.dataCommand.trim()) {
    throw new Error(`Print definition ${printCode} in ${manifestPath} must contain a non-empty dataCommand.`);
  }
}

function validatePrintSource(templatePath: string, source: PrintTemplateSource) {
  if (!source || typeof source !== "object") {
    throw new Error(`Print template source ${templatePath} must be a JSON object.`);
  }

  if (typeof source.name !== "string" || !source.name.trim()) {
    throw new Error(`Print template source ${templatePath} must contain a non-empty name.`);
  }

  if (!("schema" in source)) {
    throw new Error(`Print template source ${templatePath} must contain schema.`);
  }

  if ("republishOnPublish" in source && typeof source.republishOnPublish !== "boolean") {
    throw new Error(`Print template source ${templatePath} must use boolean republishOnPublish when provided.`);
  }
}

async function collectManifestPrintTemplates(appDir: string, models: string[], options?: { republishOnly?: boolean }) {
  const templates: CollectedPrintTemplate[] = [];

  for (const model of models) {
    const manifestPath = join(appDir, model, "manifest.json");
    if (!await fileExists(manifestPath)) {
      continue;
    }

    const manifest = await readFeatureManifest(manifestPath);

    for (const [printCode, definition] of Object.entries(manifest.prints ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      validatePrintDefinition(manifestPath, printCode, definition);

      const templatePath = resolve(join(appDir, model), definition.templateFile);
      const templateRaw = await Deno.readTextFile(templatePath);
      const source = JSON.parse(templateRaw) as PrintTemplateSource;
      validatePrintSource(templatePath, source);

      if (options?.republishOnly && !source.republishOnPublish) {
        continue;
      }

      templates.push({
        code: printCode,
        targetModel: manifest.model,
        dataCommand: definition.dataCommand.trim(),
        relativeTemplateFile: toPosixPath(relative(appDir, templatePath)),
        source,
      });
    }
  }

  return templates;
}

function renderPrintTemplateSeedSql(template: CollectedPrintTemplate) {
  const payload = JSON.stringify(template.source.schema);

  return [
    `-- Generated from ${template.relativeTemplateFile}`,
    "insert into app.print_template (",
    "  code,",
    "  name,",
    "  target_model,",
    "  data_command,",
    "  paper_size,",
    "  orientation,",
    "  is_default,",
    "  is_active,",
    "  template_schema",
    ")",
    "values (",
    `  ${sqlStringLiteral(template.code)},`,
    `  ${sqlStringLiteral(template.source.name.trim())},`,
    `  ${sqlStringLiteral(template.targetModel)},`,
    `  ${sqlStringLiteral(template.dataCommand)},`,
    `  ${sqlStringLiteral(template.source.paperSize ?? "A4")},`,
    `  ${sqlStringLiteral(template.source.orientation ?? "portrait")},`,
    `  ${sqlBooleanLiteral(template.source.isDefault ?? false)},`,
    `  ${sqlBooleanLiteral(template.source.isActive ?? true)},`,
    `  ${sqlStringLiteral(payload)}::jsonb`,
    ")",
    "on conflict (code) do nothing;",
    "",
  ].join("\n");
}

function renderPrintTemplateRepublishSql(template: CollectedPrintTemplate) {
  const payload = JSON.stringify(template.source.schema);
  const statements: string[] = [
    `-- Republish from ${template.relativeTemplateFile}`,
  ];

  if (template.source.isDefault ?? false) {
    statements.push(
      "update app.print_template",
      "set is_default = false,",
      "    updated_at = now()",
      `where target_model = ${sqlStringLiteral(template.targetModel)}`,
      `  and code <> ${sqlStringLiteral(template.code)};`,
      "",
    );
  }

  statements.push(
    "insert into app.print_template (",
    "  code,",
    "  name,",
    "  target_model,",
    "  data_command,",
    "  paper_size,",
    "  orientation,",
    "  is_default,",
    "  is_active,",
    "  template_schema",
    ")",
    "values (",
    `  ${sqlStringLiteral(template.code)},`,
    `  ${sqlStringLiteral(template.source.name.trim())},`,
    `  ${sqlStringLiteral(template.targetModel)},`,
    `  ${sqlStringLiteral(template.dataCommand)},`,
    `  ${sqlStringLiteral(template.source.paperSize ?? "A4")},`,
    `  ${sqlStringLiteral(template.source.orientation ?? "portrait")},`,
    `  ${sqlBooleanLiteral(template.source.isDefault ?? false)},`,
    `  ${sqlBooleanLiteral(template.source.isActive ?? true)},`,
    `  ${sqlStringLiteral(payload)}::jsonb`,
    ")",
    "on conflict (code) do update",
    "set name = excluded.name,",
    "    target_model = excluded.target_model,",
    "    data_command = excluded.data_command,",
    "    paper_size = excluded.paper_size,",
    "    orientation = excluded.orientation,",
    "    is_default = excluded.is_default,",
    "    is_active = excluded.is_active,",
    "    template_schema = excluded.template_schema,",
    "    updated_at = now();",
    "",
  );

  return statements.join("\n");
}

/**
 * Типи документів — з манифестів моделей `type: "document"`, а не з рукописного
 * data.sql: код типу дорівнює ключу моделі, і розійтися вони не можуть.
 */
async function collectDocumentTypes(appDir: string, models: string[]) {
  const rows: { code: string; name: string; shortName: string; prefix: string; sortOrder: number }[] = [];

  for (const model of models) {
    const manifestPath = join(appDir, model, "manifest.json");
    if (!await fileExists(manifestPath)) continue;

    const manifest = await readFeatureManifest(manifestPath);
    if (manifest.type !== "document") continue;

    const doc = manifest.document ?? {};
    if (!doc.name?.trim()) {
      throw new Error(
        `${manifestPath}: модель типу "document" повинна мати document.name — з нього формується app.document_type.`,
      );
    }

    rows.push({
      code: manifest.model,
      name: doc.name.trim(),
      shortName: (doc.shortName ?? doc.name).trim(),
      prefix: (doc.prefix ?? "").trim(),
      sortOrder: doc.sortOrder ?? 0,
    });
  }

  return rows.sort((left, right) => left.code.localeCompare(right.code));
}

function renderDocumentTypesSql(rows: Awaited<ReturnType<typeof collectDocumentTypes>>) {
  const values = rows.map((row) =>
    `  (${sqlStringLiteral(row.code)}, ${sqlStringLiteral(row.name)}, ` +
    `${sqlStringLiteral(row.shortName)}, ${row.prefix ? sqlStringLiteral(row.prefix) : "null"}, ${row.sortOrder})`
  ).join(",\n");

  return [
    "-- Generated from model manifests (type: \"document\").",
    "insert into app.document_type (code, name, short_name, prefix, sort_order)",
    "values",
    values,
    "on conflict (code) do update",
    "set name = excluded.name,",
    "    short_name = excluded.short_name,",
    "    prefix = excluded.prefix,",
    "    sort_order = excluded.sort_order;",
    "",
  ].join("\n");
}

async function buildGeneratedDataSections(appDir: string, models: string[]) {
  const sections: string[] = [];

  const documentTypes = await collectDocumentTypes(appDir, models);
  if (documentTypes.length) {
    sections.push(...buildSection("_generated/document-types.data.sql", renderDocumentTypesSql(documentTypes)));
  }

  const templates = await collectManifestPrintTemplates(appDir, models);
  if (templates.length) {
    const generatedSql = templates
      .sort((left, right) => `${left.targetModel}:${left.code}`.localeCompare(`${right.targetModel}:${right.code}`))
      .map(renderPrintTemplateSeedSql)
      .join("\n");
    sections.push(...buildSection("_generated/print-templates.data.sql", generatedSql));
  }

  return sections;
}

export async function buildRepoPrintTemplateRepublishSql(appDirArg = "./src/app"): Promise<string> {
  const appDir = resolve(Deno.cwd(), appDirArg);
  const manifest = await readManifest(appDir);

  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    return "";
  }

  const templates = await collectManifestPrintTemplates(appDir, manifest.models, { republishOnly: true });
  if (!templates.length) {
    return "";
  }

  return templates
    .sort((left, right) => `${left.targetModel}:${left.code}`.localeCompare(`${right.targetModel}:${right.code}`))
    .map(renderPrintTemplateRepublishSql)
    .join("\n");
}

export async function assembleSqlPackage(appDirArg = "./src/app", options?: { verbose?: boolean }) {
  const verboseMode = options?.verbose ?? false;
  const appDir = resolve(Deno.cwd(), appDirArg);
  const manifest = await readManifest(appDir);
  const outputDir = join(appDir, "_sqlpackage");
  const outputName = manifest.output || "app.sql";

  await Deno.mkdir(outputDir, { recursive: true });

  if (Array.isArray(manifest.models) && manifest.models.length > 0) {
    const sectionOutputNames = manifest.outputs ?? {};
    const appChunks: string[] = [];

    for (const step of PACKAGE_STEPS) {
      const sectionChunks: string[] = [];

      for (const model of manifest.models) {
        // Пакети ядра (`@core/<назва>`) їдуть із серверного пакета, а не з appDir.
        // Стоять вони там само, де й раніше: `document_core` посилається на
        // chart_of_account/currency/organization, тож порядок задає застосунок.
        const corePackage = getCoreSqlPackage(model);
        if (corePackage) {
          for (const coreFile of corePackage.files[step.key as CoreSqlStep] ?? []) {
            const fileContent = applyModelSqlPlaceholders(coreFile.sql, {
              model: corePackage.name,
              schema: "app",
            });
            sectionChunks.push(...buildSection(`@core/${coreFile.path}`, fileContent));
          }
          continue;
        }

        const relativeFiles = await step.resolveFiles(appDir, model);
        const sqlContext = await resolveModelSqlContext(appDir, model);
        for (const relativeFile of relativeFiles) {
          const filePath = join(appDir, relativeFile);
          if (!await fileExists(filePath)) continue;
          const fileContent = applyModelSqlPlaceholders(await Deno.readTextFile(filePath), {
            model: sqlContext.model,
            schema: sqlContext.schema,
          });
          sectionChunks.push(...buildSection(relativeFile, fileContent));
        }
      }

      if (step.key === "data") {
        sectionChunks.push(...await buildGeneratedDataSections(appDir, manifest.models));
      }

      const sectionOutputName = sectionOutputNames[step.key] || step.defaultOutput;
      const sectionOutputPath = await writeOutputFile(outputDir, sectionOutputName, sectionChunks);
      const relativeSectionOutput = toPosixPath(relative(appDir, sectionOutputPath));
      const sectionOutputContent = await Deno.readTextFile(sectionOutputPath);

      appChunks.push(...buildSection(relativeSectionOutput, sectionOutputContent));
    }

    const appOutputPath = await writeOutputFile(outputDir, outputName, appChunks);
    if (verboseMode) {
      console.log(`Assembled SQL package: ${appOutputPath}`);
    }
    return;
  }

  if (!Array.isArray(manifest.order) || manifest.order.length === 0) {
    throw new Error("sql.json must contain either a non-empty models array or a non-empty order array.");
  }

  const chunks: string[] = [];

  for (const relativeFile of manifest.order) {
    const filePath = join(appDir, relativeFile);
    const fileContent = await Deno.readTextFile(filePath);
    chunks.push(...buildSection(relativeFile, fileContent));
  }

  const outputPath = await writeOutputFile(outputDir, outputName, chunks);
  if (verboseMode) {
    console.log(`Assembled SQL package: ${outputPath}`);
  }
}

async function main() {
  const flags = Deno.args.filter((a) => a.startsWith("--"));
  const appDirArgs = Deno.args.filter((a) => !a.startsWith("--"));
  const verboseMode = flags.includes("--verbose");
  const dirs = appDirArgs.length > 0 ? appDirArgs : ["./src/app"];

  for (const appDirArg of dirs) {
    await assembleSqlPackage(appDirArg, { verbose: verboseMode });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}