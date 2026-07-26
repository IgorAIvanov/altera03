// Composition root клієнта — тут (і тільки тут) фреймворк зустрічається з
// конкретним застосунком.
import "./styles/app-styles.ts";

import { registerShell } from "@client/shell/shell-registry.ts";
import { initDataService } from "@client/data/data-service.ts";
import { mustChangePassword, restoreSession } from "@client/auth/session.ts";
import { setLocale } from "@client/locale.ts";

import "./header/app-header.ts";
import "./menu/app-menu.ts";
import "./home-tab.ts";
import "./login/app-login.ts";

registerShell({ header: "app-header", menu: "app-menu", home: "home-tab", login: "app-login" });
initDataService();

async function boot() {
  await setLocale("uk");

  const host = document.getElementById("app")!;
  const authorized = await restoreSession();

  // Тимчасовий пароль зупиняє тут: оболонку піднімати нема сенсу — сервер під
  // цим прапорцем не виконує жодної команди моделі. Екран зміни — той самий
  // app-login, лише в іншому стані.
  if (!authorized || mustChangePassword()) {
    host.replaceChildren(document.createElement("app-login"));
    return;
  }

  // Динамічно: неавторизований користувач не тягне граф UI. Верхньорівневого
  // await тут немає навмисно — він давав цикл entry → import → entry.
  await import("@client/tabs/tab-controller.ts");
  host.replaceChildren(document.createElement("tab-controller"));
}

boot().catch((error) => {
  console.error("[boot]", error);
  document.getElementById("app")!.replaceChildren(document.createElement("app-login"));
});
