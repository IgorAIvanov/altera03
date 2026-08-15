import { Signal } from "signal-polyfill";

/**
 * Сеанс знімків екрана — один дозвіл на всю перевірку.
 *
 * `getDisplayMedia` показує системний діалог вибору джерела на КОЖЕН виклик.
 * Сорок зауважень означали б сорок таких діалогів, і знімки вимкнули б на
 * п'ятому. Тому потік беруть один раз, тримають живим, і кожен кадр дістають із
 * нього мовчки — перевірено спайком (див. `docs/review-remarks-plan.md`).
 *
 * Знімається ВКЛАДКА, а не екран: `preferCurrentTab` плюс `selfBrowserSurface:
 * "include"`. Без другого поточної вкладки в переліку джерел просто немає —
 * Chrome ховає її за умовчанням, тобто зняти застосунок, не попросивши про це
 * прямо, неможливо. А з ними обома зникають дві помилки, яких інакше не
 * уникнути: поділитися не тим монітором і показати в кадрі чуже вікно.
 *
 * У Firefox і Safari цих параметрів немає — там лишається звичайний вибір
 * джерела. Тому код не має права вважати кадр рівним вкладці.
 */

/** Ширина, з якої кадр має сенс зменшувати. Заміряно: 1438×1200 → JPEG ~100 КБ. */
const MAX_WIDTH = 1920;
/** Якість JPEG. PNG на тому самому екрані важить учетверо більше. */
const JPEG_QUALITY = 0.85;

const _active = new Signal.State(false);

/** Чи живий сеанс. Читається компонентом шапки — звідси й сигнал. */
export const capturing = (): boolean => _active.get();

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;

/**
 * Скільки має бути в кадрі після зменшення.
 *
 * Окремою чистою функцією, щоб перевірятися пробами: помилка тут не падає, а
 * тихо псує пропорції — це видно лише очима й лише потім.
 */
export function targetSize(
  width: number,
  height: number,
  maxWidth: number = MAX_WIDTH,
): { width: number; height: number } {
  if (width <= maxWidth || width <= 0) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.round(height * scale) };
}

/**
 * Почати сеанс. `false` — людина відмовила або браузер не вміє.
 *
 * Відмову не показуємо помилкою: «не хочу ділитися екраном» — це відповідь, а не
 * поламка.
 */
export async function startCapture(): Promise<boolean> {
  if (stream) return true;
  const media = navigator.mediaDevices;
  if (!media?.getDisplayMedia) return false;

  try {
    stream = await media.getDisplayMedia({
      video: { frameRate: 5 },
      audio: false,
      // Обидва параметри — Chromium; інші браузери їх просто не побачать.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
  } catch {
    return false;
  }

  const track = stream.getVideoTracks()[0];
  // Потік помирає й сам — коли людина тисне «Зупинити доступ» у смузі браузера.
  // Без цього зауваження мовчки пішли б без картинок, а шапка й далі показувала
  // б, що сеанс іде.
  track?.addEventListener("ended", () => stopCapture());

  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  // Поза потоком розкладки, але в документі: від'єднаний елемент у частині
  // браузерів не декодує кадри взагалі.
  video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0";
  document.body.appendChild(video);
  video.srcObject = stream;
  await video.play().catch(() => {});

  _active.set(true);
  return true;
}

export function stopCapture(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video?.remove();
  video = null;
  _active.set(false);
}

/**
 * Зняти кадр. `null` — сеансу немає або відео ще не має розмірів.
 *
 * Кличеться ДО того, як відкриється діалог: знімається вкладка, тож у кадр
 * потрапило б і саме вікно зауваження — тобто замість екрана з поламкою людина
 * надіслала б екран із власною скаргою.
 */
export async function grabFrame(): Promise<File | null> {
  if (!stream || !video) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const size = targetSize(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return null;

  return new File([blob], `remark-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, {
    type: "image/jpeg",
  });
}
