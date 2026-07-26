/**
 * Екран «сервера немає» — остання лінія, коли не працює саме API.
 *
 * Свідомо накладка поверх застосунку, а не заміна вмісту `#app`: сервер може
 * відвалитися посеред роботи, і затерти заповнену форму означало б покарати
 * користувача за чужий збій. Під накладкою все лишається на місці й повертається,
 * щойно вона зникне.
 *
 * Так само свідомо — власні стилі, а не класи daisyUI. Це єдиний екран, який
 * зобов'язаний намалюватися тоді, коли зламано все інше: якби він залежав від
 * зібраного CSS застосунку, то невдале завантаження стилів дало б замість
 * пояснення купу неоформленого тексту. Тому — shadow root і повний набір правил
 * усередині, включно з темною темою.
 *
 * Перезавантаження ніколи не відбувається саме. Сервер, що моргнув під `--watch`,
 * не привід втратити незбережене — рішення лишається за користувачем.
 */

/** Як часто питати сервер, чи він повернувся. */
const PROBE_INTERVAL_MS = 5_000;

/**
 * Найдешевший запит, що доводить живий API: він не пише, не потребує сесії й
 * відповідає конвертом навіть анонімному.
 */
const PROBE_URL = "/api/auth/me";

interface OverlayRefs {
  root: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
}

let refs: OverlayRefs | null = null;
// ReturnType, а не number: у програмі публікації разом із цим файлом типізується
// `vite.ts`, і типи Node роблять поверненням `Timeout`, а не число.
let timer: ReturnType<typeof setInterval> | null = null;
let serverIsBack = false;

/**
 * Сторінка закривається. Перервані нею запити відхиляються так само, як
 * недоступний сервер, — без цієї позначки кожен перехід за посиланням блимав би
 * панікою «сервер недоступний».
 */
let unloading = false;
globalThis.addEventListener?.("pagehide", () => unloading = true);
globalThis.addEventListener?.("beforeunload", () => unloading = true);

const STYLES = `
  :host { all: initial; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center; padding: 1rem;
    background: rgba(0, 0, 0, .45);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .card {
    width: 100%; max-width: 26rem; box-sizing: border-box;
    background: #fff; color: #1a1a1a;
    border-radius: .75rem; padding: 1.5rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, .3);
  }
  .title { margin: 0 0 .5rem; font-size: 1.125rem; font-weight: 600; }
  .text { margin: 0 0 1rem; font-size: .875rem; line-height: 1.5; opacity: .8; }
  .detail {
    margin: 0 0 1rem; font-size: .75rem; line-height: 1.5; opacity: .6;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word;
  }
  .status { display: flex; align-items: center; gap: .5rem; margin-bottom: 1rem; font-size: .8125rem; }
  .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #e5484d; flex: none; }
  .dot.back { background: #30a46c; }
  button {
    width: 100%; padding: .625rem 1rem; font: inherit; font-size: .875rem; font-weight: 500;
    color: #fff; background: #3b82f6; border: 0; border-radius: .5rem; cursor: pointer;
  }
  button:hover { background: #2563eb; }
  button:disabled { opacity: .5; cursor: default; }
  @media (prefers-color-scheme: dark) {
    .card { background: #1c1c1e; color: #f2f2f2; }
  }
`;

function build(detail?: string): OverlayRefs {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-live", "assertive");

  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = "Сервер недоступний";

  const text = document.createElement("p");
  text.className = "text";
  text.textContent =
    "Застосунок не може зв'язатися з сервером. Перевіряємо кожні кілька секунд — " +
    "щойно він відповість, ви зможете продовжити. Дані на екрані нікуди не зникли.";

  const status = document.createElement("div");
  status.className = "status";
  const dot = document.createElement("span");
  dot.className = "dot";
  const statusText = document.createElement("span");
  statusText.textContent = "Немає зв'язку із сервером";
  status.append(dot, statusText);

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Спробувати ще раз";

  card.append(title, text);

  if (detail) {
    const detailNode = document.createElement("p");
    detailNode.className = "detail";
    detailNode.textContent = detail;
    card.append(detailNode);
  }

  card.append(status, button);
  backdrop.append(card);
  shadow.append(style, backdrop);
  document.body.append(host);

  return { root: host, status, button };
}

/** Чи відповідає API. Навмисно голий `fetch`: обгортка веде сюди ж. */
async function serverResponds(): Promise<boolean> {
  try {
    const response = await fetch(PROBE_URL, { credentials: "same-origin", cache: "no-store" });
    // Не `response.ok`: 401 теж означає, що сервер живий і відповідає — саме це
    // ми й перевіряємо. Не годиться лише сторінка помилки проксі, яка не JSON.
    return (response.headers.get("content-type") ?? "").includes("json");
  } catch {
    return false;
  }
}

function markBack(): void {
  if (!refs || serverIsBack) return;
  serverIsBack = true;

  const dot = refs.status.querySelector(".dot");
  dot?.classList.add("back");
  const label = refs.status.lastElementChild;
  if (label) label.textContent = "Сервер знову доступний";

  refs.button.textContent = "Перезавантажити сторінку";
  refs.button.disabled = false;
}

function stopProbing(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Показати екран. Викликати можна скільки завгодно разів — накладка одна,
 * бо падає зазвичай не один запит, а всі одразу.
 */
export function showServerUnavailable(detail?: string): void {
  if (unloading) return;
  if (refs) return;

  serverIsBack = false;
  refs = build(detail);

  refs.button.addEventListener("click", async () => {
    if (serverIsBack) {
      globalThis.location.reload();
      return;
    }

    refs!.button.disabled = true;
    if (await serverResponds()) {
      markBack();
    } else {
      refs!.button.disabled = false;
    }
  });

  timer = setInterval(async () => {
    if (await serverResponds()) {
      markBack();
      stopProbing();
    }
  }, PROBE_INTERVAL_MS);
}

/** Прибрати екран — на випадок, якщо застосунок оговтався сам. */
export function hideServerUnavailable(): void {
  stopProbing();
  refs?.root.remove();
  refs = null;
  serverIsBack = false;
}
