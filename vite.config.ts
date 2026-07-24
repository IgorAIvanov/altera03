// Уся машинерія Vite — у пресеті фреймворку; тут лишається тільки те, що
// специфічне для цього застосунку. У застосунку-з-пакетом імпорт буде
// `@ihor/altera-client/vite`; у монорепо — той самий модуль через import-map.
import { defineAlteraConfig } from "@client/vite.ts";

export default defineAlteraConfig({ appDir: "app", apiPort: 3000 });
