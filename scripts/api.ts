/**
 * Дьоргання команди моделі з консолі: `deno task api <model> <command> [payload]`.
 *
 * Застосунок піднімається в цьому ж процесі — не треба ні вільного порту, ні
 * запущеного `dev:server`, ні HTTP-клієнта. Зручно, коли пишеш SQL-функцію
 * моделі й хочеш побачити конверт, не клацаючи по UI.
 *
 *   deno task api bank list
 *   deno task api bank get '{"id":"1"}'
 *   deno task api bank list --user 5
 *   deno task api invoice list --raw          # без прикрас, чистий JSON
 *
 * Запис у БД тут можливий (save/delete — звичайні команди), тому інструмент
 * підпорядкований тому самому запобіжнику оточення, що й smoke.
 */
import { AppClient } from "@scope/tools/app-client";
import { assertDevEnvironmentOrExit } from "@scope/tools/dev-guard";
import { createServer } from "../app/server.ts";

const USAGE = `Використання:
  deno task api <model> <command> [payload-json] [--user <id>] [--raw] [--verbose]

  --user <id>  ходити від імені цього користувача (заголовок dev-bypass)
  --raw        друкувати тільки конверт одним рядком (під jq)
  --verbose    показати лог підняття застосунку

Приклади:
  deno task api bank list
  deno task api bank get '{"id":"1"}'
  deno task api bank list --user 5
  deno task api bank list --raw | jq .data.rows`;

interface Options {
  model: string;
  command: string;
  payload: Record<string, unknown>;
  userId: string | null;
  raw: boolean;
  verbose: boolean;
}

function fail(message: string): never {
  console.error(`⛔ ${message}\n\n${USAGE}`);
  Deno.exit(2);
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let userId: string | null = null;
  let raw = false;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--raw") {
      raw = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--user") {
      userId = argv[++i] ?? fail("--user потребує значення");
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      Deno.exit(0);
    } else if (arg.startsWith("--")) {
      fail(`невідомий прапорець: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [model, command, payloadJson] = positional;
  if (!model || !command) {
    fail("треба вказати model і command");
  }

  let payload: Record<string, unknown> = {};
  if (payloadJson) {
    try {
      const parsed = JSON.parse(payloadJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("payload має бути JSON-об'єктом");
      }
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      fail(`payload не розібрався як JSON: ${error instanceof Error ? error.message : error}`);
    }
  }

  return { model, command, payload, userId, raw, verbose };
}

const options = parseArgs(Deno.args);
assertDevEnvironmentOrExit("api");

const client = await AppClient.start("api", createServer, {
  userId: options.userId,
  quiet: !options.verbose,
});

// Код виходу рахуємо тут, а Deno.exit() — після close(): вихід із try обірвав би
// finally, і пул БД лишився б незакритим.
let exitCode = 1;
try {
  const { status, body } = await client.model(options.model, options.command, options.payload);
  exitCode = body?.ok ? 0 : 1;

  if (options.raw) {
    console.log(JSON.stringify(body));
  } else {
    const rows = Array.isArray(body?.data?.rows) ? body.data.rows.length : 0;
    console.log(`\n${body?.ok ? "✅" : "❌"} ${options.model}/${options.command} — HTTP ${status}, rows: ${rows}`);
    for (const message of body?.messages ?? []) {
      console.log(`   • ${message}`);
    }
    console.log(JSON.stringify(body, null, 2));
  }
} finally {
  await client.close();
}

Deno.exit(exitCode);
