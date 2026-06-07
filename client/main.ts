import { setLocale } from "./locale.ts";
import { initDataService } from "./data/data-service.ts";
import "./tabs/tab-controller.ts";
import type { Locale } from "./locale.ts";

initDataService();

const savedLocale = (localStorage.getItem("locale") ?? "uk") as Locale;
await setLocale(savedLocale);
