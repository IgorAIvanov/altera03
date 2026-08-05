// Уся машинерія Vite — у пресеті фреймворку; тут лишається тільки те, що
// специфічне для цього застосунку. У застосунку-з-пакетом імпорт буде
// `@altera/client/vite`; у монорепо — той самий модуль через import-map.
//
// Обидва порти читаються з оточення (`--env-file` у задачах `*:front`), щоб на
// одній машині могло жити кілька застосунків: PORT задає бекенд, і той самий
// PORT тут наводить проксі `/api` — розійтися вони не можуть за побудовою.
import { defineAlteraConfig } from "@client/vite.ts";

export default defineAlteraConfig({
  appDir: "app",
  apiPort: Number(Deno.env.get("PORT") || 3000),
  devPort: Number(Deno.env.get("VITE_PORT") || 5173),
});
