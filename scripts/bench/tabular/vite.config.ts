// Конфіг СТЕНДА, окремий від застосунку навмисно: пресет `defineAlteraConfig`
// збирає всі в'ю застосунку, копіює локалі й пише нотиси — стендові з того
// потрібен лише Tailwind, а решта коштувала б хвилини на кожен прогін.
//
// Заголовки COOP/COEP — заради `performance.measureUserAgentSpecificMemory()`:
// без crossOriginIsolated він недоступний, і замір пам'яті скотився б до
// нестандартного `performance.memory`.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "npm:vite@^8.2.0";
import deno from "npm:@deno/vite-plugin@^2";
import tailwindcss from "npm:@tailwindcss/vite@^4.3.0";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

export default defineConfig({
  root: here,
  // Кеш — поза каталогом стенда: інакше Vite клав би `.vite/deps` просто в
  // `scripts/`, а `deno task check` перевіряє `./scripts` цілком і почав би
  // ходити по пре-бандлених залежностях.
  cacheDir: resolve(repo, "node_modules/.vite-bench"),
  plugins: [deno(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@client\/(.*)/, replacement: resolve(repo, "client") + "/$1" },
      { find: /^@app\/(.*)/, replacement: resolve(repo, "app") + "/$1" },
      { find: /^@shared\/(.*)/, replacement: resolve(repo, "app/shared") + "/$1" },
    ],
  },
  // Ті самі, що в пресеті застосунку: Oxc мовчки відкидає `target` зі старого
  // ключа `esbuild`, а пре-бандл усіх залежностей одразу рятує від пізнього
  // re-optimize — він дає ДВА екземпляри Lit у графі, і замір після цього
  // нічого не вартий.
  oxc: { target: "es2022" },
  optimizeDeps: {
    entries: ["index.html"],
    include: [
      "lit",
      "lit/decorators.js",
      "@lit-labs/signals",
      "@sinclair/typebox",
      "@sinclair/typebox/value",
      "signal-utils/deep",
      "signal-polyfill",
      "decimal.js",
    ],
  },
  server: {
    port: 5299,
    strictPort: true,
    fs: { allow: [repo] },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
