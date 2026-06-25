import { defineConfig } from "npm:vite@^6.3.5";
import { resolve } from "node:path";
import { viteStaticCopy } from "npm:vite-plugin-static-copy@^2.3.0";
import tailwindcss from "npm:@tailwindcss/vite@^4.3.0";
import { appModulesPlugin } from "./vite-plugin-app-modules.ts";

export default defineConfig({
  root: "client",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        client: "client/index.html",
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
  optimizeDeps: {
    entries: ["index.html"],
  },
  resolve: {
    alias: {
      "@app": resolve("app"),
      "@client": resolve("client"),
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
