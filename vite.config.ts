import { defineConfig } from "npm:vite@^6.3.5";
import { resolve } from "node:path";
import { viteStaticCopy } from "npm:vite-plugin-static-copy@^2.3.0";
import tailwindcss from "npm:@tailwindcss/vite@^4.3.0";
import { appModulesPlugin } from "./vite-plugin-app-modules.ts";

export default defineConfig({
  // Корінь — застосунок: index.html і main.ts належать йому, а не бібліотеці.
  root: "app",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    manifest: true,
    // top-level await у точці входу (setLocale, динамічний preload) потребує
    // es2022; інакше rollup-мініфікація падає з дефолтним es2020-таргетом.
    target: "es2022",
    rollupOptions: {
      input: {
        client: "app/index.html",
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [resolve(".")],
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  esbuild: {
    target: "es2022",
  },
  // Явна entry для dep-сканера: інакше оптимізатор бере build.rollupOptions.input
  // ("client/index.html" — шлях відносно кореня репо) і не може його зрезолвити
  // відносно root:"client", що валить холодний старт (masked TypeError у Vite).
  //
  // include: view-модулі з app/ вантажаться динамічно (@vite-ignore /@fs), тож їх
  // залежності (@lit-labs/signals, @sinclair/typebox) не потрапляють у стартовий
  // scan і виявляються пізно → Vite дооптимізовує й робить full-reload, а до
  // перезавантаження виникає другий екземпляр Lit ("Multiple versions of Lit")
  // і роздвоєний граф (другий bus → "немає обробника для data.load").
  // Пре-бандлимо весь набір залежностей одразу, щоб не було пізнього re-optimize.
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
    ],
  },
  resolve: {
    alias: {
      "@app": resolve("app"),
      "@client": resolve("client"),
      "@shared": resolve("app/shared"),
    },
  },
  plugins: [
    tailwindcss(),
    appModulesPlugin(),
    viteStaticCopy({
      targets: [
        {
          src: resolve("app/_public").replaceAll("\\", "/") + "/*",
          dest: ".",
        },
        {
          src: resolve("client/_locales").replaceAll("\\", "/") + "/*",
          dest: "locales/client",
        },
        {
          src: resolve("app/_locales").replaceAll("\\", "/") + "/*",
          dest: "locales/app",
        },
      ],
    }),
  ],
});
