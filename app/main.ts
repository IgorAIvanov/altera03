// Composition root застосунку на клієнті — дзеркало app/server.ts: тут (і тільки тут)
// фреймворк зустрічається з конкретним застосунком. Живе в app/, а не в client/, саме
// тому: клієнт — бібліотека, і знати про `app-header` чи `home-tab` він не може.
import { registerShell } from "@client/shell/shell-registry.ts";
import { initDataService } from "@client/data/data-service.ts";
import { restoreSession } from "@client/auth/session.ts";
import { setLocale, type Locale } from "@client/locale.ts";

// Компоненти оболонки застосунку — визначають кастомні елементи (@customElement).
import "./header/app-header.ts";
import "./menu/app-menu.ts";
import "./home-tab.ts";
import "./login/app-login.ts";

registerShell({ header: "app-header", menu: "app-menu", home: "home-tab", login: "app-login" });
initDataService();

const savedLocale = (localStorage.getItem("locale") ?? "uk") as Locale;
await setLocale(savedLocale);

/**
 * Оболонка піднімається лише після того, як з'ясувалося, що сесія є.
 *
 * `tab-controller` імпортується динамічно й саме тут: він тягне за собою весь
 * граф UI-модулів, і неавторизованому користувачеві качати його ні до чого.
 */
async function boot(): Promise<void> {
  const root = document.querySelector("#app");
  if (!root) return;

  if (await restoreSession()) {
    await import("@client/tabs/tab-controller.ts");
    root.replaceChildren(document.createElement("tab-controller"));
    return;
  }

  const login = document.createElement("app-login");
  // Успішний вхід — просто повторюємо boot: сесія вже є, підніметься оболонка.
  login.addEventListener("auth.success", () => void boot());
  root.replaceChildren(login);
}

await boot();
