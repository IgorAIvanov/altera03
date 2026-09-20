import type { ModelBackendConfig, TsModelCommandConfig } from "./model-runtime.types.ts";
import { printPdfHandler, printPreviewHandler } from "../print/print.handlers.ts";
import { postPreviewHandler } from "../document/post-preview.handler.ts";
import { documentLocateHandler } from "../document/document-locate.handler.ts";
import { importSessionStartHandler } from "../import/import.handlers.ts";
import { coreModelAccess } from "../agent/core-agent-tools.ts";
import { getServerConfig, type ModelsConfig } from "../../config/server-config.ts";

/**
 * Готові рантайм-хендлери ядра. Модель застосунку підключає їх у manifest.json
 * ключем (`"handlerKey": "runtime.printPdf"`), не знаючи шляхів усередині server/.
 */
const RUNTIME_HANDLERS: Record<string, TsModelCommandConfig["handler"]> = {
  "runtime.printPdf": printPdfHandler,
  "runtime.printPreview": printPreviewHandler,
  "runtime.postPreview": postPreviewHandler,
};

/**
 * TS-команди моделей ЯДРА, які застосунок не підключає, а отримує готовими.
 *
 * `document.locate` — `authenticated`: модель `document` права не несе (прав
 * на неї ніхто не видає), а потрібне право — `view` на модель ТИПУ знайденого
 * документа — до виклику невідоме. Його перевіряє сама `app.document_locate`.
 * В агентський перелік команда не йде: відкрити вкладку агентові нічим.
 */
const CORE_TS_COMMANDS: Record<string, { handler: TsModelCommandConfig["handler"]; access: string }> = {
  "document.locate": { handler: documentLocateHandler, access: "authenticated" },
  // Завести канал перенесення. `create`, як у будь-якого нового запису: сесія
  // відкриває чужому процесу дорогу в базу, і право на це — не «подивитися».
  "import_session.start": { handler: importSessionStartHandler, access: "create" },
};

/**
 * Прив'язка TS-команди до моделі (дані приходять з app/_generated).
 * Або власний хендлер моделі (`handler`), або ключ хендлера ядра (`handlerKey`).
 */
export interface GeneratedTsCommandBinding {
  model: string;
  command: string;
  handler?: TsModelCommandConfig["handler"];
  handlerKey?: string;
}

/**
 * Реєстр збирається на першу потребу з конфігурації і кешується. Ключ кешу —
 * тотожність самого об'єкта `models`: інший bootstrap з іншим конфігом
 * перебудує реєстр, і жодного окремого кроку «зареєструвати» не існує.
 */
let cache: { source: ModelsConfig; registry: Record<string, ModelBackendConfig> } | null = null;

function getRegistry(): Record<string, ModelBackendConfig> {
  const models = getServerConfig().models;
  if (!cache || cache.source !== models) {
    cache = { source: models, registry: buildRegistry(models.registry, models.tsCommands) };
  }

  return cache.registry;
}

function buildRegistry(
  generated: Record<string, ModelBackendConfig>,
  bindings: GeneratedTsCommandBinding[],
): Record<string, ModelBackendConfig> {
  const result: Record<string, ModelBackendConfig> = {};

  for (const [model, config] of Object.entries(generated)) {
    result[model] = {
      ...config,
      sqlCommands: config.sqlCommands ? { ...config.sqlCommands } : undefined,
      tsCommands: config.tsCommands ? { ...config.tsCommands } : undefined,
    };
  }

  // Команди моделей ЯДРА з ВЛАСНИМ іменем.
  //
  // Стандартні імена (`list`, `get`, `save`…) працюють у моделі ядра й без
  // цього: рантайм резолвить їх за домовленістю `app.<модель>_<команда>`, а
  // право виводить з імені — і робить це незалежно від того, чи є модель у
  // реєстрі застосунку. Саме тому `attachment.list` жив собі й ніколи нічого
  // тут не потребував.
  //
  // А от нестандартне ім'я в моделі ядра не мало ДЕ оголоситися взагалі:
  // маршрут задають `commands.sql`, право — `commands.access`, і обидва живуть
  // у манифесті, якого в моделі ядра немає. Тобто така команда впиралася б у
  // «не налаштовано» завжди — і з екраном у застосунку, і без нього. Тут вона
  // отримує і маршрут (за тією ж домовленістю), і право.
  for (const key of Object.keys(coreModelAccess)) {
    const separator = key.lastIndexOf(".");
    const model = key.slice(0, separator);
    const command = key.slice(separator + 1);

    const config = result[model] ??= {};
    // Оголошене застосунком сильніше: якщо він написав свою реалізацію
    // команди, вона й виконується.
    config.sqlCommands = { [command]: {}, ...config.sqlCommands };
    config.access = { [command]: coreModelAccess[key], ...config.access };
  }

  // TS-команди моделей ядра — те, яким бази мало (маршрут форми лежить у
  // view-manifest, а не в SQL). Застосунок так само сильніший.
  for (const [key, { handler, access }] of Object.entries(CORE_TS_COMMANDS)) {
    const separator = key.lastIndexOf(".");
    const model = key.slice(0, separator);
    const command = key.slice(separator + 1);

    const config = result[model] ??= {};
    config.tsCommands = { [command]: { handler }, ...config.tsCommands };
    config.access = { [command]: access, ...config.access };
  }

  for (const binding of bindings) {
    const handler = binding.handler ?? (binding.handlerKey ? RUNTIME_HANDLERS[binding.handlerKey] : undefined);
    if (!handler) {
      // Дві різні причини, які раніше зливалися в одне повідомлення про
      // handlerKey: його справді може не бути в ядрі, а може бути й так, що
      // прив'язка вказує на власний модуль, а той не має default-експорту —
      // тоді `binding.handler` приходить `undefined`, і згадка про handlerKey
      // відправляла шукати проблему не туди.
      throw new Error(
        binding.handlerKey
          ? `Команда ${binding.model}.${binding.command}: невідомий handlerKey "${binding.handlerKey}"`
          : `Команда ${binding.model}.${binding.command}: модуль команди не віддав хендлер. ` +
            `Перевірте, що він має default-експорт, і перезапустіть sql:registry.`,
      );
    }

    const modelConfig = result[binding.model] ?? {};
    modelConfig.tsCommands = {
      ...(modelConfig.tsCommands ?? {}),
      [binding.command]: { handler },
    };
    result[binding.model] = modelConfig;
  }

  return result;
}

export function getModelConfig(model: string): ModelBackendConfig | undefined {
  return getRegistry()[model];
}

export function getModelType(model: string): string | null {
  return getRegistry()[model]?.type ?? null;
}

export function isDocumentModel(model: string): boolean {
  return getModelType(model) === "document";
}

export function supportsPosting(model: string): boolean {
  return isDocumentModel(model);
}
