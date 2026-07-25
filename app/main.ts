// Composition root застосунку на клієнті — дзеркало app/server.ts: тут (і тільки тут)
// фреймворк зустрічається з конкретним застосунком. Живе в app/, а не в client/, саме
// тому: клієнт — бібліотека, і знати про `app-header` чи `home-tab` він не може.
// Стилі застосунку — у фреймворк їх кладе застосунок, а не навпаки. Порядок цього
// імпорту значення не має (аркуш мутується), але першим він стоїть за змістом.
import "./styles/app-styles.ts";

import { registerShell } from "@client/shell/shell-registry.ts";
import { initDataService } from "@client/data/data-service.ts";
import { ServerUnavailableError } from "@client/data/api.ts";
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

/**
 * Останній екран, коли застосунок не піднявся з причини, не пов'язаної із
 * сервером: недоступний сервер показує власну накладку сам (`client/data/api.ts`),
 * і дублювати її тут ні до чого. Свідомо голий DOM: будь-який компонент тут —
 * ще одна річ, яка може не завантажитися.
 */
function renderFatal(error: unknown): void {
  if (error instanceof ServerUnavailableError) return;

  const root = document.querySelector("#app");
  if (!root) return;

  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement("div");
  box.setAttribute(
    "style",
    "font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:1.5rem;" +
      "border:1px solid #e5484d;border-radius:.5rem;color:#e5484d",
  );
  box.append(
    Object.assign(document.createElement("h1"), {
      textContent: "Застосунок не запустився",
      style: "font-size:1.125rem;margin:0 0 .5rem",
    }),
    Object.assign(document.createElement("p"), { textContent: message, style: "margin:0" }),
  );
  root.replaceChildren(box);
}

// НЕ `await boot()`. Верхньорівневий await тут заморожував би цей модуль
// (entry-чанк) на весь час boot(). А `tab-controller`, який boot() підвантажує
// динамічно за живої сесії, залежить від цього ж чанка (Rollup складає сюди
// `shellTags`). Вийшов би цикл: entry → boot → import(tab-controller) → entry,
// і промис імпорту не резолвився б ніколи — біла сторінка рівно тоді, коли сесія
// є. Без await entry завершується, залежність tab-controller'а стає доступною.
// catch обов'язковий: раніше будь-який збій boot() давав німий білий екран.
boot().catch((error) => {
  console.error("[main] не вдалося підняти застосунок:", error);
  renderFatal(error);
});
