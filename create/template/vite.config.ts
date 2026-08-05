// Уся машинерія Vite — у пресеті фреймворку: root, аліаси, чанки на в'ю,
// проксі на бекенд, Tailwind, плагін Deno. Тут лишається тільки те, що
// відрізняє застосунок.
//
// Обидва порти читаються з оточення (`--env-file` у задачах `*:front`), щоб на
// одній машині могло жити кілька застосунків: PORT задає бекенд, і той самий
// PORT тут наводить проксі `/api` — розійтися вони не можуть за побудовою.
import { defineAlteraConfig } from "@altera/client/vite";

export default defineAlteraConfig({
  appDir: "app",
  apiPort: Number(Deno.env.get("PORT") || 3000),
  devPort: Number(Deno.env.get("VITE_PORT") || 5173),
});
