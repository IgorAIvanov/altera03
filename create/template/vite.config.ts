// Уся машинерія Vite — у пресеті фреймворку: root, аліаси, чанки на в'ю,
// проксі на бекенд, Tailwind, плагін Deno. Тут лишається тільки те, що
// відрізняє застосунок.
import { defineAlteraConfig } from "@altera/client/vite";

export default defineAlteraConfig({ appDir: "app", apiPort: 3000 });
