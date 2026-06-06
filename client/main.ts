import { setLocale } from "./locale.ts";
import { initDataService } from "./data/data-service.ts";
import "./tabs/tab-controller.ts";
import type { Locale } from "./locale.ts";

// инициализируем сервис данных (регистрирует обработчики data.load / data.save)
initDataService();

// восстанавливаем локаль
const savedLocale = (localStorage.getItem("locale") ?? "ru") as Locale;
if (savedLocale !== "ru") await setLocale(savedLocale);
