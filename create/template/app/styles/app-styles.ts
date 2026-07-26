// Місце, де зібраний Tailwind потрапляє у фреймворк. `?inline` — фіча Vite,
// тому живе в застосунку: бібліотека такого імпорту дозволити собі не може.
import raw from "./tailwind.css?inline";
import { setAppStyles } from "@client/shared/styles.ts";

setAppStyles(raw);
