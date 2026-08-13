// Composition root застосунку на клієнті — дзеркало app/server.ts: тут (і тільки тут)
// фреймворк зустрічається з конкретним застосунком. Живе в app/, а не в client/, саме
// тому: клієнт — бібліотека, і знати про `app-header` чи `home-tab` він не може.
// Стилі застосунку — у фреймворк їх кладе застосунок, а не навпаки. Порядок цього
// імпорту значення не має (аркуш мутується), але першим він стоїть за змістом.
import "./styles/app-styles.ts";

import { registerShell } from "@client/shell/shell-registry.ts";
import { initDataService } from "@client/data/data-service.ts";
import { ServerUnavailableError } from "@client/data/api.ts";
import { mustChangePassword, restoreSession } from "@client/auth/session.ts";
import { dropLegacyKey } from "@client/shared/user-storage.ts";
import { setLocale } from "@client/locale.ts";
import { setOrganizationContext } from "@client/shared/organization-context.ts";
import { currentOrg, hydrateCurrentOrg, knownOrgs, loadOrgs } from "@shared/current-organization.ts";

// Компоненти оболонки застосунку — визначають кастомні елементи (@customElement).
import "./header/app-header.ts";
import "./menu/app-menu.ts";
import "./home-tab.ts";
import "./login/app-login.ts";

registerShell({ header: "app-header", menu: "app-menu", home: "home-tab", login: "app-login" });
initDataService();

// Значення, збережені до поділу сховища за користувачем. Не переносимо їх на
// того, хто увійде першим: невідомо, чий це стан, а привласнити чуже — рівно та
// вада, заради якої поділ і робився. Рядки можна прибрати, коли всі машини
// відкриють застосунок хоча б раз.
dropLegacyKey("altera.open-tabs");
dropLegacyKey("altera.current-organization");

// Мову називає застосунок, а не фреймворк: щоб додати ще одну, досить покласти
// `app/_locales/<код>.json` — переліку, який треба десь оголосити, немає.
// Ключі, яких у цій мові немає, беруться з англійської (див. FALLBACK_LOCALE).
await setLocale(localStorage.getItem("locale") ?? "uk");

/**
 * Оболонка піднімається лише після того, як з'ясувалося, що сесія є.
 *
 * `tab-controller` імпортується динамічно й саме тут: він тягне за собою весь
 * граф UI-модулів, і неавторизованому користувачеві качати його ні до чого.
 */
async function boot(): Promise<void> {
  const root = document.querySelector("#app");
  if (!root) return;

  // Тимчасовий пароль (створений із BOOTSTRAP_PASSWORD) зупиняє тут: оболонку
  // піднімати нема сенсу — сервер під цим прапорцем не виконує жодної команди
  // моделі. Екран зміни — той самий app-login, лише в іншому стані.
  if (await restoreSession() && !mustChangePassword()) {
    // Порядок важливий: обидва читають сховище за ключем із id користувача,
    // тому мають іти після відновлення сесії й до підняття оболонки.
    hydrateCurrentOrg();
    // Фреймворк не має власного поняття організації — воно приходить сюди
    // ЗЗОВНІ, як і все на сервері приходить аргументом bootstrap(). З цього
    // журнал документів бере умовчання відбору й рішення, чи показувати його
    // взагалі (одна організація — механізму немає). Обидва методи читаються на
    // кожен рендер, тож перемикання організації в шапці доходить саме собою.
    setOrganizationContext({ current: () => currentOrg(), list: () => knownOrgs() });
    // Не чекаємо: вхід не має впиратися в перелік організацій, а екрани
    // перемалюються самі — і шапка, і відбір читають сигнал.
    void loadOrgs();
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
