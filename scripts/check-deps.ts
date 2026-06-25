/// <reference lib="deno.ns" />
// Guardrail напрямку залежностей: бібліотеки (client/server) НЕ залежать від застосунку.
//   - client/* (крім composition root client/main.ts) не імпортує @app
//   - server/* не імпортує конкретний застосунок (@app або ../app/)
// Запуск: deno task check:deps

const violations: string[] = [];

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(path);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      yield path;
    }
  }
}

async function scan(root: string, isViolation: (file: string, line: string) => boolean) {
  for await (const file of walk(root)) {
    const text = await Deno.readTextFile(file);
    text.split("\n").forEach((line, i) => {
      if (/^\s*import\b/.test(line) && isViolation(file, line)) {
        violations.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

// client/*: лише composition root (client/main.ts) має право знати про застосунок.
await scan("client", (file, line) =>
  !file.endsWith("client/main.ts") && /["']@app\//.test(line)
);

// server/*: жодних рантайм-імпортів застосунку.
await scan("server", (_file, line) =>
  /["']@app\//.test(line) || /["'][^"']*\.\.\/app\//.test(line)
);

if (violations.length > 0) {
  console.error("❌ Порушення напрямку залежностей (бібліотека → застосунок):");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nФреймворк не повинен залежати від конкретного застосунку. Винеси залежність " +
      "через точку розширення (реєстр), а наповнюй її в composition root (client/main.ts, app/server.ts).",
  );
  Deno.exit(1);
}

console.log("✅ Напрямок залежностей коректний: client/server не залежать від app.");
