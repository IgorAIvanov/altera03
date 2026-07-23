// Composition root застосунку: тут (і тільки тут на клієнті) фреймворк зустрічається
// з конкретним застосунком. Реєструємо компоненти оболонки ДО завантаження tab-controller.
import { registerShell } from "./shell/shell-registry.ts";
import { initDataService } from "./data/data-service.ts";
import { setLocale, type Locale } from "./locale.ts";

// App-компоненти оболонки — визначають кастомні елементи (@customElement).
import "@app/header/app-header.ts";
import "@app/menu/app-menu.ts";
import "@app/home-tab.ts";

registerShell({ header: "app-header", menu: "app-menu", home: "home-tab" });
initDataService();

// Динамічний імпорт: tab-controller визначається ПІСЛЯ registerShell,
// тож його connectedCallback вже бачить зареєстровані теги оболонки.
await import("./tabs/tab-controller.ts");

const savedLocale = (localStorage.getItem("locale") ?? "uk") as Locale;
await setLocale(savedLocale);
